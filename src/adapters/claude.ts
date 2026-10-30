/** Claude Code session files (`.claude/projects/<project>/<session>.jsonl`): a node's stored copies, and their events. */
import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, hexOf, isoAt, num, readLines, splitLines, str, type Json, type SessionFile, type SessionReader } from './harness-reader.js'

// A Claude Code main session file inside a harness home; subagent transcripts under `<session>/subagents/` are not.
const CLAUDE_SESSION = /(^|\/)\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/
const sessionKey = (path: string) => (CLAUDE_SESSION.test(path) ? path.slice(path.lastIndexOf('.claude/projects/')) : null)

/**
 * Every stored copy of each of a node's Claude Code session files, keyed by its path inside the harness home
 * (`.claude/projects/<project>/<session>.jsonl`). A session file is append-only, so every copy is a prefix of the
 * same bytes and the longest copy is the most complete one; an equal-length tie keeps the earlier source below.
 *   1. a turn's retained-harness-transcript archive (spawn journal transcriptRef), under the native cache;
 *   2. the latest copy in the run's native index (`evidence/native-index.jsonl`, disco.native-capture.v1: a capture
 *      taken while the turn runs and when it ends), under the native cache.
 */
export function nativeFiles(ingest: Ingest, node: NodeDraft): SessionFile[] | 'not-cached' | null {
  const copies = new Map<string, { rel: string; abs: string; bytes: number; order: number }>()
  let missing = false
  const offer = (key: string, rel: string, abs: string) => {
    let bytes: number
    try {
      bytes = statSync(abs).size
    } catch {
      return
    }
    const held = copies.get(key)
    if (!held || bytes > held.bytes) copies.set(key, { rel, abs, bytes, order: held?.order ?? copies.size })
  }

  for (const ref of node.transcriptRefs) {
    const blob = ingest.blob(ref)
    if (blob?.value?.kind !== 'retained-harness-transcript') continue
    const manifest = blob.value
    ingest.fileSource(blob.rel)
    const hex = hexOf(manifest.snapshot?.archive?.sha256 ?? manifest.snapshot?.archive?.locator?.digest)
    const sessionId = typeof manifest.source?.nativeSessionId === 'string' ? manifest.source.nativeSessionId : null
    node.nativeSessionId ??= sessionId ?? undefined
    if (typeof manifest.harness === 'string') node.harness ??= manifest.harness
    ingest.addSandbox(node, manifest.source?.environmentId)
    const main = (Array.isArray(manifest.files) ? manifest.files : []).filter(
      (file: Json) => typeof file?.path === 'string' && CLAUDE_SESSION.test(file.path) && (!sessionId || file.path.endsWith(`/${sessionId}.jsonl`)),
    )
    if (!hex || !main.length) continue
    const dir = ingest.nativeCacheDir(hex)
    if (!dir) {
      missing = true
      continue
    }
    for (const file of main) {
      const segments = file.path.split('/')
      const candidates = [file.path, ['workspace/__retention__/sessions', segments[0], 'native', ...segments.slice(1)].join('/')]
      const relInside = candidates.find((candidate) => existsSync(join(dir, candidate)))
      if (!relInside) {
        ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:native-file-missing', detail: `${file.path} is not in archive ${hex}` })
        continue
      }
      const abs = join(dir, relInside)
      const rel = `native:${hex}/${relInside}`
      const entry = ingest.file(rel, abs)
      const expected = hexOf(file.sha256)
      if (expected && expected !== entry.sha256) {
        ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:native-sha256-mismatch', detail: `${rel} does not match its manifest` })
        continue
      }
      offer(sessionKey(file.path)!, rel, abs)
    }
  }

  const indexed = ingest.nativeIndex().get(node.id)
  if (indexed) {
    const hex = hexOf(indexed.snapshot?.archive)
    ingest.addSandbox(node, indexed.environmentId)
    if (typeof indexed.harness === 'string') node.harness ??= indexed.harness
    const dir = hex ? ingest.nativeCacheDir(hex) : undefined
    if (hex && !dir) missing = true
    for (const session of dir && Array.isArray(indexed.native?.sessions) ? indexed.native.sessions : []) {
      const key = typeof session?.path === 'string' ? sessionKey(session.path) : null
      if (!key || typeof session.sandboxSessionId !== 'string' || typeof session.rootScope !== 'string') continue
      const relInside = ingest.nativePath(session)
      offer(key, `native:${hex}/${relInside}`, join(dir!, relInside))
    }
  }

  if (!copies.size) return missing ? 'not-cached' : null
  const found = [...copies.values()].sort((a, b) => a.order - b.order)
  for (const copy of found) ingest.fileSource(copy.rel, copy.abs)
  return found
}

/** A node's native session files, read in order: lossy when any line is not JSON. */
export function readNative(ingest: Ingest, node: NodeDraft, files: SessionFile[]) {
  let lossy = false
  for (const file of files) if (readSession(ingest, node, file)?.unparsable) lossy = true
  node.capture = { channel: 'native', status: lossy ? 'lossy' : 'complete', reason: lossy ? 'unparsable-lines' : null }
  if (node.harness === null) node.harness = 'claude-code'
}

/**
 * A bundle's Claude Code session. A workflow agent's `agent-<id>.jsonl` beside its `agent-<id>.meta.json` joins the
 * agent its workflow journal started (workflow-agent-id); any other session is its own node.
 */
export const readClaudeBundle: SessionReader = (main, session, agents) => {
  const rows = splitLines(main.file(session.path).bytes)
  const carried = rows.find((row) => typeof row.value?.agentId === 'string')
  const agentId = session.agentId ?? (carried ? str(carried.value.agentId) : '')
  const sessionId = session.sessionId ?? str(rows.find((row) => typeof row.value?.sessionId === 'string')?.value?.sessionId)
  const meta = session.path.replace(/\.jsonl$/, '.meta.json')
  const joined = agentId ? agents.get(agentId) : undefined
  let node: NodeDraft
  if (joined && carried && basename(session.path) === `agent-${agentId}.jsonl` && existsSync(join(main.runDir, meta))) {
    node = main.nodes.get(joined.node)!
    node.joinBasis = 'workflow-agent-id'
    node.joinProof = { journal: { path: joined.rel, line: joined.line }, session: { path: session.path, line: carried.line }, meta: { path: meta } }
    node.nativeSessionId = sessionId || undefined
    main.fileSource(meta)
  } else {
    const id = `claude-code:${agentId || sessionId || basename(session.path, '.jsonl')}`
    node = main.ensureNode(id, { label: session.label ?? `claude code ${(agentId || sessionId).slice(0, 8)}`, nativeSessionId: sessionId || undefined })
  }
  node.harness ??= 'claude-code'
  if (session.label) node.label = session.label
  const read = readSession(main, node, { rel: session.path, window: session.lines })
  if (read) node.capture = { channel: 'native', status: read.unparsable ? 'lossy' : 'complete', reason: read.unparsable ? 'unparsable-lines' : session.lines ? 'line-window' : null }
  return node
}

/**
 * One Claude Code session file. Every timestamped line inside its window becomes one event, or one per item when a
 * line carries several tool results. Null when another node already holds the file.
 */
function readSession(ingest: Ingest, node: NodeDraft, file: SessionFile) {
  const seenMessages = new Set<string>()
  let lastAssistant: Json
  return readLines(ingest, node, file, {
    at: (value, last) => isoAt(value.timestamp) ?? last ?? node.start ?? null,
    line({ value, at, source, full, emit }) {
      const native = typeof value.uuid === 'string' ? { nativeRecordId: value.uuid } : {}
      const sidechain = value.isSidechain ? { sidechain: true } : {}
      const message = value.message
      const before = ingest.events.length
      if (value.type === 'assistant' && message) {
        const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
        const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
        const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
        // Thinking the provider did not return as text: a signed block with no text (display omitted), or an
        // encrypted redacted_thinking block. Counted so a reader sees that the model thought, never invented text.
        const reasoningOmitted = blocks.filter((b) => b?.type === 'thinking' && !str(b.thinking)).length
        const reasoningRedacted = blocks.filter((b) => b?.type === 'redacted_thinking').length
        const calls = blocks.filter((b) => b?.type === 'tool_use' || b?.type === 'server_tool_use')
        const usage = message.usage
        const first = typeof message.id === 'string' ? !seenMessages.has(message.id) : true
        if (typeof message.id === 'string') seenMessages.add(message.id)
        if (typeof message.model === 'string' && message.model !== '<synthetic>') {
          node.servedModel = message.model
          node.modelSource = 'native response'
        }
        const shownText = text ? ingest.clip(text, full) : null
        const shownReasoning = reasoning ? ingest.clip(reasoning, full) : null
        emit({
          kind: 'message',
          category: calls.length ? categoryOf(str(calls[0].name), calls[0].input) : 'reasoning',
          label: calls.length ? `assistant · ${calls.map((c) => str(c.name)).join(', ')}` : 'assistant',
          detail: {
            role: 'assistant',
            ...native,
            ...(shownText ? { publicText: shownText.text } : {}),
            ...(shownReasoning ? { reasoning: shownReasoning.text } : {}),
            ...(reasoningOmitted ? { reasoningOmitted } : {}),
            ...(reasoningRedacted ? { reasoningRedacted } : {}),
            ...(shownText?.clip ?? shownReasoning?.clip ? { clip: shownText?.clip ?? shownReasoning?.clip } : {}),
            ...(calls.length ? { publicToolCalls: calls.map((call) => ({ id: str(call.id), name: str(call.name), ...ingest.shown('input', JSON.stringify(call.input ?? {}), full) })) } : {}),
            ...(usage && first
              ? { usage: { input: num(usage.input_tokens), output: num(usage.output_tokens), cacheRead: num(usage.cache_read_input_tokens), cacheWrite: num(usage.cache_creation_input_tokens) } }
              : {}),
            ...(typeof message.model === 'string' ? { responseReportedModel: message.model } : {}),
            ...(value.isApiErrorMessage ? { responseStatus: 'error' } : {}),
            ...sidechain,
          },
        })
        lastAssistant = ingest.events.at(-1)
      } else if (value.type === 'user' && message && typeof message.content === 'string') {
        emit({ kind: 'message', category: 'other', label: 'user', detail: { role: 'user', ...native, ...ingest.shown('publicText', message.content, full), ...sidechain } })
      } else if (value.type === 'user' && message) {
        const blocks: Json[] = Array.isArray(message.content) ? message.content : []
        const items: { index: number; block?: Json; text?: string }[] = []
        blocks.forEach((block, index) => {
          if (block?.type === 'tool_result') items.push({ index, block })
        })
        const textIndex = blocks.findIndex((b) => b?.type === 'text' || b?.type === 'image')
        const text = blocks.filter((b) => b?.type === 'text' || b?.type === 'image').map((b) => (b.type === 'image' ? '[image]' : str(b.text))).join('\n\n')
        if (text) items.push({ index: textIndex, text })
        items.sort((a, b) => a.index - b.index)
        for (const { index, block, text } of items) {
          const item = items.length > 1 ? index : undefined
          if (!block) {
            emit({ kind: 'message', category: 'other', label: 'user', item, detail: { role: 'user', ...native, ...ingest.shown('publicText', text!, full), ...sidechain } })
            continue
          }
          const body = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((part: Json) => (part?.type === 'text' ? str(part.text) : part?.type === 'image' ? '[image]' : JSON.stringify(part))).join('\n')
              : str(block.content)
          const detail = { role: 'toolResult', ...native, toolCallId: str(block.tool_use_id), isError: block.is_error === true, ...ingest.shown('publicText', body, full), ...sidechain }
          emit({ kind: 'tool-result', category: 'other', label: 'tool result', item, detail })
        }
      }
      if (value.type === 'cost-state' && lastAssistant && num(value.totalCostUSD) !== undefined) {
        lastAssistant.detail.costListUsd = value.totalCostUSD
        lastAssistant.detail.usdKnown = false
        lastAssistant.detail.costScope = 'session-total'
      }
      // Every other timestamped line (system, attachment, cost state, an empty user turn) is kept as what it is.
      if (ingest.events.length === before) ingest.emitRecord(node, at, source, value, native)
    },
  })
}
