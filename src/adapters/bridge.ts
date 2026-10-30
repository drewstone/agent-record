/** Retained cli-bridge exports (`trace/bridge-sessions/*.jsonl` in a run): rows of `{table, row}` from the bridge store. */
import { basename } from 'node:path'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, filesUnder, isoAt, readLines, splitLines, str, type Json, type Line, type SessionReader } from './harness-reader.js'

/** A bridge export: its rows, and the bridge session id its `sessions` row names. */
export interface BridgeStream {
  rel: string
  rows: Line[]
  sessionId: string | null
  sessionLine: number | null
}

/** One bridge export. A line that is not a table row is skipped without a gap. */
function bridgeStream(ingest: Ingest, rel: string): BridgeStream {
  const rows = splitLines(ingest.file(rel).bytes).filter((row) => typeof row.value?.table === 'string')
  const session = rows.find((row) => row.value.table === 'sessions')
  return { rel, rows, sessionId: str(session?.value?.row?.external_id) || null, sessionLine: session?.line ?? null }
}

/** Every bridge export a run retained. */
export const bridgeStreams = (ingest: Ingest) => filesUnder(ingest.runDir, 'trace/bridge-sessions', '.jsonl').map((rel) => bridgeStream(ingest, rel))

/** A bundle's bridge export, one node per bridge session id (or file name). */
export const readBridgeBundle: SessionReader = (main, session) => {
  const stream = bridgeStream(main, session.path)
  const id = `bridge:${session.sessionId ?? stream.sessionId ?? basename(session.path, '.jsonl')}`
  const node = main.ensureNode(id, { label: session.label ?? id })
  readBridgeStream(main, node, stream)
  return node
}

/** A bridge export's rows as events: false when another node already holds it. Prompts and tool results are not exported. */
export function readBridgeStream(ingest: Ingest, node: NodeDraft, stream: BridgeStream) {
  const read = readLines(ingest, node, stream, {
    unit: 'rows',
    at(value) {
      const fields = value.row ?? {}
      return isoAt(fields.occurred_at) ?? isoAt(fields.received_at) ?? isoAt(Number(fields.created_at)) ?? isoAt(Number(fields.updated_at))
    },
    line({ value, at, source, full, emit }) {
      const fields = value.row ?? {}
      if (value.table !== 'retained_events') return ingest.emitRecord(node, at, source, { type: `bridge ${value.table.replaceAll('_', ' ')}`, ...fields })
      let event: Json
      try {
        event = JSON.parse(str(fields.event_json))
      } catch {
        event = null
      }
      const inner = event?.event ?? {}
      const native = typeof fields.event_id === 'string' ? { nativeRecordId: fields.event_id } : {}
      if (typeof inner.content === 'string' && inner.content) {
        emit({ kind: 'message', category: 'reasoning', label: 'assistant', detail: { role: 'assistant', ...native, ...ingest.shown('publicText', inner.content, full) } })
      } else if (Array.isArray(inner.tool_calls) && inner.tool_calls.length) {
        inner.tool_calls.forEach((call: Json, index: number) => {
          const input = typeof call?.arguments === 'string' ? call.arguments : JSON.stringify(call?.arguments ?? {})
          emit({
            kind: 'message',
            category: categoryOf(str(call?.name), call?.arguments),
            label: `assistant · ${str(call?.name)}`,
            item: inner.tool_calls.length > 1 ? index : undefined,
            detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(call?.id), name: str(call?.name), ...ingest.shown('input', input, full) }] },
          })
        })
      } else {
        const kind = Object.keys(inner)[0] ?? str(event?.type) ?? 'event'
        ingest.emitRecord(node, at, source, { type: `bridge ${kind.replaceAll('_', ' ')}`, ...inner }, { ...native, ...(inner.error ? { isError: true } : {}) })
      }
    },
  })
  if (!read) return false
  node.harness ??= 'opencode'
  node.capture = { channel: 'bridge', status: 'lossy', reason: 'bridge-stream-without-prompts-or-results' }
  return true
}
