/** Pi session files (`trace/pi-sessions/**\/*.jsonl` in a run): a header line, then one line per entry. */
import { basename } from 'node:path'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, filesUnder, isoAt, num, readLines, sha, splitLines, str, type Frame, type Json, type Line, type SessionReader } from './harness-reader.js'

/** A Pi session file: its id, and the digest of its first user text that joins it to a spawned task. */
export interface PiSession {
  rel: string
  sessionId: string
  digest: string | null
  rows: Line[]
}

/**
 * Python's `json.dumps(value, sort_keys=True)` (ASCII escapes, `, ` and `: ` separators). The earlier publication
 * converter hashed native message content this way, so the same content keeps the same contentSha256.
 */
function pythonJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : value < 0 ? '-Infinity' : 'NaN'
    if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value)
    // repr(float): the shortest round-trip digits; fixed notation for exponents -4..15, otherwise d.ddde[+-]XX.
    const [mantissa, exponent] = value.toExponential().split('e') as [string, string]
    if (Number(exponent) >= -4 && Number(exponent) < 16) return /[.e]/.test(String(value)) ? String(value) : `${value}.0`
    return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, '0')}`
  }
  if (typeof value === 'string') {
    let out = '"'
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      const char = value[i]!
      if (char === '"') out += '\\"'
      else if (char === '\\') out += '\\\\'
      else if (char === '\n') out += '\\n'
      else if (char === '\r') out += '\\r'
      else if (char === '\t') out += '\\t'
      else if (char === '\b') out += '\\b'
      else if (char === '\f') out += '\\f'
      else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`
      else out += char
    }
    return `${out}"`
  }
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`
  if (typeof value === 'object')
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${pythonJson(key)}: ${pythonJson((value as Record<string, unknown>)[key])}`)
      .join(', ')}}`
  return 'null'
}
/** A native message's content digest and its character count (text, or thinking where a block has no text). */
function contentDigest(content: Json[]) {
  let characters = 0
  for (const block of content) {
    const body = block && typeof block === 'object' ? ('text' in block ? block.text : 'thinking' in block ? block.thinking : '') : ''
    characters += [...(typeof body === 'string' ? body : body === null ? 'None' : String(body))].length
  }
  return { contentSha256: sha(pythonJson(content)), contentCharacters: characters }
}

/** One Pi session file. A line that is not JSON (a torn last line) is skipped without a gap. */
function piSession(ingest: Ingest, rel: string): PiSession {
  const rows = splitLines(ingest.file(rel).bytes).filter((row) => row.value)
  const session = rows.find((row) => row.value.type === 'session')?.value
  const firstUser = rows.find((row) => row.value.type === 'message' && row.value.message?.role === 'user')?.value?.message
  const text = !firstUser
    ? null
    : typeof firstUser.content === 'string'
      ? firstUser.content
      : Array.isArray(firstUser.content)
        ? firstUser.content.filter((b: Json) => b?.type === 'text').map((b: Json) => str(b.text)).join('')
        : null
  return { rel, sessionId: str(session?.id) || basename(rel, '.jsonl'), digest: text === null ? null : `sha256:${sha(JSON.stringify(text))}`, rows }
}

/** Every Pi session a run retained. */
export const piSessions = (ingest: Ingest) => filesUnder(ingest.runDir, 'trace/pi-sessions', '.jsonl').map((rel) => piSession(ingest, rel))

/** A bundle's Pi session, one node per session id (or the header's id). */
export const readPiBundle: SessionReader = (main, session) => {
  const read = piSession(main, session.path)
  const sessionId = session.sessionId ?? read.sessionId
  const id = `pi:${sessionId}`
  const node = main.ensureNode(id, { label: session.label ?? `pi ${sessionId.slice(0, 8)}` })
  readPi(main, node, [{ ...read, sessionId }])
  return node
}

/** A node's Pi sessions: every timed line is one event; a tool call whose result no line holds makes the capture lossy. */
export function readPi(ingest: Ingest, node: NodeDraft, sessions: PiSession[]) {
  node.harness ??= 'pi'
  const callIds = new Set<string>()
  const resultIds = new Set<string>()
  const line = ({ value, at, source, full, emit }: Frame) => {
    const native = typeof value.id === 'string' ? { nativeRecordId: value.id } : {}
    if (value.type === 'model_change' && typeof value.modelId === 'string') node.model ??= value.modelId
    // The session header, model and thinking-level changes and custom entries are events too.
    if (value.type !== 'message') return ingest.emitRecord(node, at, source, value, native)
    const message = value.message ?? {}
    const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
    const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
    // Identity of the message without its body: parent, digest and size of its content (contentDigest).
    const meta = {
      ...(typeof value.parentId === 'string' ? { nativeParentId: value.parentId } : {}),
      ...contentDigest(Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]),
    }
    if (message.role === 'toolResult') {
      if (typeof message.toolCallId === 'string') resultIds.add(message.toolCallId)
      const detail = { role: 'toolResult', ...native, ...meta, toolCallId: str(message.toolCallId), isError: message.isError === true, ...ingest.shown('publicText', text, full) }
      return emit({ kind: 'tool-result', category: 'other', label: `tool result · ${str(message.toolName)}`, detail })
    }
    const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
    const calls = blocks.filter((b) => b?.type === 'toolCall' || b?.type === 'tool_use')
    for (const call of calls) if (typeof call.id === 'string') callIds.add(call.id)
    if (typeof message.model === 'string' && message.stopReason !== 'error') node.servedModel = message.model
    // What the response itself reported: its model, stop reason and id.
    const response =
      message.role === 'assistant'
        ? {
            ...(typeof message.model === 'string' ? { responseReportedModel: message.model } : {}),
            ...(typeof message.stopReason === 'string' ? { responseStatus: message.stopReason } : {}),
            ...(typeof message.responseId === 'string' ? { responseId: message.responseId } : {}),
          }
        : {}
    const shownText = text ? ingest.clip(text, full) : null
    const shownReasoning = reasoning ? ingest.clip(reasoning, full) : null
    const usage = message.usage
    emit({
      kind: 'message',
      category: calls.length ? categoryOf(str(calls[0].name), calls[0].arguments ?? calls[0].input) : message.role === 'user' ? 'other' : 'reasoning',
      label: message.stopReason === 'error' ? 'failed assistant request' : calls.length ? `${str(message.role)} · ${calls.map((c) => str(c.name)).join(', ')}` : str(message.role),
      detail: {
        role: str(message.role),
        ...native,
        ...meta,
        ...response,
        ...(shownText ? { publicText: shownText.text } : {}),
        ...(shownReasoning ? { reasoning: shownReasoning.text } : {}),
        ...(shownText?.clip ?? shownReasoning?.clip ? { clip: shownText?.clip ?? shownReasoning?.clip } : {}),
        ...(calls.length ? { publicToolCalls: calls.map((call) => ({ id: str(call.id), name: str(call.name), ...ingest.shown('input', JSON.stringify(call.arguments ?? call.input ?? {}), full) })) } : {}),
        ...(usage && message.stopReason !== 'error'
          ? { usage: { input: num(usage.input), output: num(usage.output), cacheRead: num(usage.cacheRead), cacheWrite: num(usage.cacheWrite) } }
          : {}),
        ...(num(usage?.cost?.total) !== undefined && usage.cost.total > 0 ? { costListUsd: usage.cost.total, usdKnown: false } : {}),
      },
    })
  }
  for (const session of sessions)
    if (readLines(ingest, node, session, { at: (value, last) => isoAt(value.timestamp) ?? last, line })) node.nativeSessionId ??= session.sessionId
  // A call whose result no session line holds: the call is recorded, its outcome is not (the root stream's rule).
  const unanswered = [...callIds].filter((id) => !resultIds.has(id)).length
  if (unanswered) ingest.gaps.push({ nodeId: node.id, code: 'tool-results-not-retained', detail: `${unanswered} tool calls have no result in the session` })
  node.capture = { channel: 'pi', status: unanswered ? 'lossy' : 'complete', reason: unanswered ? 'tool-results-not-retained' : null }
}
