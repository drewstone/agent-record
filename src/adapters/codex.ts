/** Codex rollout files (`.codex/sessions/**\/*.jsonl`): every timestamped line becomes one event. */
import { basename } from 'node:path'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, isoAt, num, readLines, str, type Json, type SessionFile, type SessionReader } from './harness-reader.js'

/** A bundle's Codex rollout, one node per session id (or file name). */
export const readCodexBundle: SessionReader = (main, session) => {
  const id = `codex:${session.sessionId ?? basename(session.path, '.jsonl')}`
  const node = main.ensureNode(id, { label: session.label ?? `codex ${(session.sessionId ?? basename(session.path)).slice(-12)}` })
  if (readCodex(main, node, { rel: session.path, window: session.lines }) && session.lines) node.capture = { ...node.capture, reason: node.capture.reason ?? 'line-window' }
  return node
}

/** One Codex rollout: every timestamped line inside its window becomes one event (one per tool call item). */
function readCodex(ingest: Ingest, node: NodeDraft, file: SessionFile) {
  const counts = readLines(ingest, node, file, {
    at: (value) => isoAt(value.timestamp),
    line({ value, at, source, full, emit }) {
      const payload = value.payload ?? {}
      if (value.type === 'session_meta' && typeof payload.id === 'string') node.nativeSessionId ??= payload.id
      if (value.type === 'turn_context' && typeof payload.model === 'string') {
        node.model ??= payload.model
        node.servedModel = payload.model
        node.modelSource ??= 'codex turn context'
      }
      if (value.type === 'response_item' && payload.type === 'message') {
        const role = str(payload.role) || 'assistant'
        const parts: Json[] = Array.isArray(payload.content) ? payload.content : []
        const text = parts.map((part) => (part?.type === 'input_image' ? '[image]' : str(part?.text))).filter(Boolean).join('\n\n')
        emit({ kind: 'message', category: role === 'assistant' ? 'reasoning' : 'other', label: role, detail: { role, ...ingest.shown('publicText', text, full) } })
        return
      }
      if (value.type === 'response_item' && payload.type === 'reasoning') {
        // Only the readable summary; encrypted reasoning is never decoded or copied.
        const summary = (Array.isArray(payload.summary) ? payload.summary : []).map((part: Json) => str(part?.text)).filter(Boolean).join('\n\n')
        emit({ kind: 'message', category: 'reasoning', label: 'reasoning', detail: { role: 'assistant', ...(summary ? ingest.shown('reasoning', summary, full) : { contentOmitted: 'encrypted reasoning' }) } })
        return
      }
      const call =
        value.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call' || payload.type === 'web_search_call')
          ? {
              id: str(payload.call_id ?? payload.id),
              name: payload.type === 'local_shell_call' ? 'shell' : payload.type === 'web_search_call' ? 'web_search' : str(payload.name),
              input: payload.type === 'function_call' ? str(payload.arguments) : payload.type === 'custom_tool_call' ? str(payload.input) : JSON.stringify(payload.action ?? {}),
            }
          : null
      if (call) {
        emit({ kind: 'message', category: categoryOf(call.name, call.input), label: `assistant · ${call.name}`, detail: { role: 'assistant', publicToolCalls: [{ id: call.id, name: call.name, ...ingest.shown('input', call.input, full) }] } })
        return
      }
      if (value.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
        const output = payload.output
        const body = typeof output === 'string' ? output : typeof output?.content === 'string' ? output.content : JSON.stringify(output ?? null)
        emit({ kind: 'tool-result', category: 'other', label: 'tool result', detail: { role: 'toolResult', toolCallId: str(payload.call_id), isError: output?.success === false, ...ingest.shown('publicText', body, full) } })
        return
      }
      if (value.type === 'event_msg' && payload.type === 'token_count' && payload.info?.last_token_usage) {
        const usage = payload.info.last_token_usage
        const cached = num(usage.cached_input_tokens) ?? 0
        const tokens = { input: Math.max(0, (num(usage.input_tokens) ?? 0) - cached), output: num(usage.output_tokens), cacheRead: cached, ...(num(usage.reasoning_output_tokens) !== undefined ? { reasoning: usage.reasoning_output_tokens } : {}) }
        emit({ kind: 'usage', category: 'other', label: 'token count', detail: { recordType: 'event_msg', recordSubtype: 'token_count', usage: tokens } })
        return
      }
      ingest.emitRecord(node, at, source, { ...payload, type: str(value.type) || 'line', ...(payload.type ? { subtype: payload.type } : {}) })
    },
  })
  if (!counts) return null
  node.harness ??= 'codex'
  node.capture = { channel: 'codex', status: counts.unparsable ? 'lossy' : 'complete', reason: counts.unparsable ? 'unparsable-lines' : null }
  return counts
}
