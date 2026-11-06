/** Retained cli-bridge exports (`trace/bridge-sessions/*.jsonl` in a run): rows of `{table, row}` from the bridge store. */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, filesUnder, isoAt, readLines, sha, splitLines, str, type Json, type Line, type SessionFile, type SessionReader } from './harness-reader.js'

/** A bridge export: its rows, and the bridge session id its `sessions` row names. */
export interface BridgeStream extends SessionFile {
  rows: Line[]
  sessionId: string | null
  sessionLine: number | null
}

/** One bridge export. A line that is not a table row is skipped without a gap. */
function bridgeStream(ingest: Ingest, rel: string): BridgeStream {
  const rows = [...splitLines(ingest.file(rel).bytes)].filter((row) => typeof row.value?.table === 'string')
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
  readBridgeStream(main, node, { ...stream, window: session.lines })
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

export function readRootStream(ingest: Ingest, node: NodeDraft) {
  const rel = 'root-stream.jsonl'
  const abs = join(ingest.runDir, rel)
  if (!existsSync(abs)) return false
  const entry = ingest.file(rel)
  const rows = [...splitLines(entry.bytes)].filter((row) => row.value?.event)
  if (!rows.length) return false
  if (!ingest.claim(entry.sha256, node.id, rel)) return false
  ingest.fileSource(rel)
  // A resumed attempt can replay its predecessor from the start; drop the replayed prefix.
  const fingerprint = (row: Line) => {
    const event = row.value.event
    return `${event.kind}\0${event.toolCallId ?? ''}\0${sha(JSON.stringify(event.text ?? event.args ?? event.result ?? ''))}`
  }
  const byAttempt = new Map<number, Line[]>()
  for (const row of rows) {
    const attempt = Number(row.value.attempt ?? 1)
    const list = byAttempt.get(attempt) ?? []
    list.push(row)
    byAttempt.set(attempt, list)
  }
  const kept: Line[] = []
  let previous: Line[] = []
  let replayed = 0
  for (const attempt of [...byAttempt.keys()].sort((a, b) => a - b)) {
    const list = byAttempt.get(attempt)!
    let skip = 0
    while (skip < list.length && skip < previous.length && fingerprint(list[skip]!) === fingerprint(previous[skip]!)) skip++
    replayed += skip
    kept.push(...list.slice(skip))
    previous = list
  }
  let block: { kind: string; rows: Line[] } | null = null
  let untimed = 0
  const callIds = new Map<string, number>()
  const resultIds = new Set<string>()
  const flush = () => {
    if (!block) return
    const first = block.rows[0]!
    const text = block.rows.map((row) => str(row.value.event.text)).join('')
    const at = isoAt(first.value.at)
    const lastRow = block.rows.at(-1)!
    if (at && text.trim()) {
      ingest.emit({
        node: node.id,
        at,
        kind: 'message',
        category: 'reasoning',
        label: 'assistant',
        source: { path: rel, sha256: entry.sha256, line: first.line },
        detail: {
          role: 'assistant',
          ...(first.value.seq !== undefined ? { nativeRecordId: String(first.value.seq) } : {}),
          ...ingest.shown(block.kind === 'text_delta' ? 'publicText' : 'reasoning', text, block.rows.length === 1 ? () => ingest.lineSource(rel, first.line, first.raw) : null),
          ...(block.rows.length > 1 ? { anchorRange: [first.line, lastRow.line] } : {}),
        },
      })
    }
    block = null
  }
  for (const row of kept) {
    const event = row.value.event
    const kind = str(event.kind)
    if (kind === 'text_delta' || kind === 'reasoning_delta') {
      if (block && block.kind !== kind) flush()
      block ??= { kind, rows: [] }
      block.rows.push(row)
      continue
    }
    flush()
    const at = isoAt(row.value.at)
    if (!at) {
      untimed++
      continue
    }
    const source = { path: rel, sha256: entry.sha256, line: row.line }
    const native = row.value.seq !== undefined ? { nativeRecordId: String(row.value.seq) } : {}
    const full = () => ingest.lineSource(rel, row.line, row.raw)
    if (kind === 'tool_call') {
      // A stream row without args says nothing about them: the call omits `input` rather than claiming `{}`.
      callIds.set(str(event.toolCallId), Date.parse(at))
      ingest.emit({
        node: node.id,
        at,
        kind: 'message',
        category: categoryOf(str(event.toolName), event.args),
        label: `assistant · ${str(event.toolName)}`,
        source,
        detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(event.toolCallId), name: str(event.toolName), ...(event.args === undefined || event.args === null ? {} : ingest.shown('input', JSON.stringify(event.args), full)) }] },
      })
    } else if (kind === 'tool_result') {
      const result = event.result
      const body = typeof result === 'string' ? result : result && typeof result === 'object' && typeof result.error === 'string' && Object.keys(result).length === 1 ? result.error : JSON.stringify(result ?? null)
      resultIds.add(str(event.toolCallId))
      ingest.emit({
        node: node.id,
        at,
        kind: 'tool-result',
        category: categoryOf(str(event.toolName), null),
        label: `tool result · ${str(event.toolName)}`,
        source,
        detail: {
          role: 'toolResult',
          ...native,
          toolCallId: str(event.toolCallId),
          ...(callIds.has(str(event.toolCallId)) ? { durationMs: Math.max(0, Date.parse(at) - callIds.get(str(event.toolCallId))!) } : {}),
          isError: Boolean(result && typeof result === 'object' && ('error' in result || result.isError === true)),
          ...ingest.shown('publicText', body, full),
        },
      })
    } else {
      // Turn boundaries, usage and status rows are events of their own kind.
      ingest.emitRecord(node, at, source, { ...event, type: kind || 'event' }, native)
    }
  }
  flush()
  if (untimed) ingest.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} rows of ${ingest.sourcePath(rel)} carry no time` })
  if (replayed) ingest.gaps.push({ nodeId: node.id, code: 'root-replay-dropped', detail: `${replayed} rows of a resumed attempt repeat its predecessor and are not events` })
  const unanswered = [...callIds.keys()].filter((id) => !resultIds.has(id)).length
  node.capture = {
    channel: 'root',
    status: unanswered || replayed ? 'lossy' : 'complete',
    reason: unanswered ? 'tool-results-not-streamed' : replayed ? 'resumed-attempt-replay-dropped' : null,
  }
  return true
}
