import type { RecordEvent } from '../record.js'

/**
 * Pure rules for the conversation rows. This module imports types only, so the node tests load it directly.
 */

export interface RowCall {
  id: string
  name: string
  input?: string
  publicationNote?: string | null
  clip?: unknown
}

/**
 * A key that survives a live record growing. Event ids hash the whole source file, so every append renames every
 * event of that file. The harness's own record id (`nativeRecordId`, one per session line or part) does not change;
 * a call and its result can share one, so the kind and source item are part of the key. Without it, the node, source
 * path and position inside the file are stable too; without either, the event id is all there is.
 */
export function anchorOf(event: RecordEvent): string {
  const source = event.source as { path?: string; line?: number; pointer?: string; item?: number } | null | undefined
  const native = event.detail.nativeRecordId
  if (typeof native === 'string' && native)
    return JSON.stringify([event.node, 'native', native, event.kind, source?.item ?? null])
  if (source?.path) return JSON.stringify([event.node, source.path, source.line ?? null, source.pointer ?? null, source.item ?? null])
  return event.id
}

/** Anchors for events in recorded order; a repeated position gets an occurrence suffix so keys stay unique. */
export function anchorsOf(events: readonly RecordEvent[]): Map<string, string> {
  const seen = new Map<string, number>()
  const result = new Map<string, string>()
  for (const event of events) {
    const base = anchorOf(event)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    result.set(event.id, n ? `${base}#${n}` : base)
  }
  return result
}

/** Arguments the record holds no value for, or an empty object, are not distinguishable as content. */
export const emptyArgs = (input: string | undefined) => input === undefined || /^\s*(\{\s*\}|null)?\s*$/.test(input)

/** The argument text shown on a collapsed call row, or the honest absence of it. */
export function argsLabel(input: string | undefined): string | null {
  if (input === undefined) return 'args not captured'
  if (emptyArgs(input)) return 'empty args'
  return null
}

export type CallState = 'returned' | 'error' | 'pending' | 'ambiguous' | 'missing'

/** The status word for a call. A missing result is pending while its agent can still answer it. */
export function callStatus(state: CallState, live: boolean): string {
  switch (state) {
    case 'error':
      return 'Error'
    case 'returned':
      return 'Returned'
    case 'pending':
      return 'Not returned'
    case 'ambiguous':
      return 'Ambiguous'
    default:
      return live ? 'Pending' : 'Result not captured'
  }
}

/**
 * A turn that holds only withheld thinking is shown when it produced at least this many output tokens: Claude Code
 * writes one line per content block, so most such turns are a few hundred tokens of glue before a tool call, while the
 * turns where the work happens (a 13-minute, 80K-token plan) are rare. Hidden turns stay in the usage charts.
 */
export const THINKING_SHOWN_TOKENS = 2000
/** The output tokens a turn recorded, or null when its usage was not recorded. */
export function outputTokens(detail: RecordEvent['detail']): number | null {
  const usage = detail.usage as { output?: unknown } | undefined
  return typeof usage?.output === 'number' && Number.isFinite(usage.output) ? usage.output : null
}
/** A withheld-thinking turn is quiet glue when it recorded fewer output tokens than THINKING_SHOWN_TOKENS. */
export function quietThinking(detail: RecordEvent['detail']): boolean {
  const output = outputTokens(detail)
  return output !== null && output < THINKING_SHOWN_TOKENS
}

/** Thinking whose text the record lacks, said as what happened. Never a reconstruction of the text. */
export function thinkingMarkers(detail: RecordEvent['detail']): string[] {
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  const omitted = count(detail.reasoningOmitted)
  const redacted = count(detail.reasoningRedacted)
  const marks: string[] = []
  if (omitted) marks.push(omitted === 1 ? 'thinking not returned by provider' : `${omitted} thinking blocks not returned by provider`)
  if (redacted) marks.push(redacted === 1 ? 'thinking redacted (encrypted)' : `${redacted} thinking blocks redacted (encrypted)`)
  return marks
}

const WAITING = /await|wait|poll|sleep|observe|status/i

/**
 * A result that only says the call is still running: a JSON object with `pending: true` (Runtime's coordination tools
 * answer a long call this way, with its elapsed time, before its real answer). It carries no answer, so a call whose
 * every result is one still counts as unanswered for collapsing.
 */
export function pendingReceipt(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trimStart().startsWith('{')) return false
  try {
    const value = JSON.parse(text)
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.pending === true
  } catch {
    return false
  }
}

/** Whether any of a call's results answers it: a result that is not a pending receipt. */
export const answeredBy = (results: readonly RecordEvent[] | undefined) =>
  (results ?? []).some((result) => !pendingReceipt(result.detail.publicText))

/**
 * The one call of an event that is a poll: an assistant turn whose only content is a single tool call, with no text,
 * thinking, note or clipped body, and with no answer anywhere in the record: no result, or only pending receipts
 * (pendingReceipt). A call with any other result is never a poll, so collapsing can hide no returned answer. Its arguments are empty or absent, or the
 * tool is a waiting tool (await, wait, poll, sleep, observe, status).
 */
export function pollCall(event: RecordEvent, calls: readonly RowCall[], answered: (callId: string) => boolean): RowCall | null {
  const detail = event.detail
  if (detail.role !== 'assistant' || event.category === 'lifecycle' || detail.lifecycle !== undefined) return null
  if (
    detail.publicText ||
    detail.recordedClaim ||
    detail.reasoning ||
    detail.responseStatus === 'error' ||
    detail.contentOmitted ||
    detail.publicationNote ||
    detail.clip ||
    thinkingMarkers(detail).length
  )
    return null
  if (calls.length !== 1) return null
  const call = calls[0]!
  if (call.clip || call.publicationNote || answered(call.id)) return null
  // Repeating a read with arguments is work; only a waiting tool repeats arguments as a poll.
  if (!emptyArgs(call.input) && !WAITING.test(call.name)) return null
  return call
}

export type ConversationRow =
  | { kind: 'event'; key: string; event: RecordEvent }
  | { kind: 'polls'; key: string; name: string; input: string | undefined; events: RecordEvent[] }
  | { kind: 'hollow'; key: string; events: RecordEvent[]; calls: Array<{ name: string; count: number }>; spanMs: number }
  | { kind: 'idle'; key: string; events: RecordEvent[] }

/** Whether any paired result carries answer text; injected so this module stays types-only. */
export type ResultCaptured = (event: RecordEvent, callId: string) => boolean

/**
 * The calls of a hollow turn: an assistant tool turn with no text, thinking, or notes whose every call has neither
 * captured arguments nor a captured answer. Nothing in it can be shown but the fact that it ran, so a run of them
 * collapses to one row. A call with any captured side keeps its own row.
 */
export function hollowCalls(
  event: RecordEvent,
  calls: readonly RowCall[],
  captured: ResultCaptured,
): readonly RowCall[] | null {
  const detail = event.detail
  if (detail.role !== 'assistant' || event.category === 'lifecycle' || detail.lifecycle !== undefined) return null
  if (
    detail.publicText ||
    detail.recordedClaim ||
    detail.reasoning ||
    detail.responseStatus === 'error' ||
    detail.contentOmitted ||
    detail.publicationNote ||
    detail.clip ||
    thinkingMarkers(detail).length
  )
    return null
  if (!calls.length) return null
  if (calls.some((call) => call.input !== undefined || call.clip || call.publicationNote || captured(event, call.id))) return null
  return calls
}

/** Fold consecutive rows only; a user message, error or substantive work always breaks the group. */
function foldRows<T>(
  rows: readonly ConversationRow[],
  identify: (event: RecordEvent) => T | null,
  same: (a: T, b: T) => boolean,
  build: (events: RecordEvent[], value: T) => ConversationRow,
  min = 2,
): ConversationRow[] {
  const out: ConversationRow[] = []
  let run: { rows: Extract<ConversationRow, { kind: 'event' }>[]; value: T } | null = null
  const close = () => {
    if (run) out.push(...(run.rows.length >= min ? [build(run.rows.map(r => r.event), run.value)] : run.rows))
    run = null
  }
  for (const row of rows) {
    const value = row.kind === 'event' ? identify(row.event) : null
    if (value === null) { close(); out.push(row); continue }
    if (run && !same(run.value, value)) close()
    run ??= { rows: [], value }
    run.rows.push(row as Extract<ConversationRow, { kind: 'event' }>)
  }
  close()
  return out
}

export function collapseHollowTurns(rows: readonly ConversationRow[], { callsOf, captured, keyOf, min = 2 }: { callsOf: (event: RecordEvent) => readonly RowCall[]; captured: ResultCaptured; keyOf: (event: RecordEvent) => string; min?: number }): ConversationRow[] {
  return foldRows(rows, event => hollowCalls(event, callsOf(event), captured), () => true, events => {
    const counts = new Map<string, number>()
    for (const event of events) for (const call of callsOf(event)) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
    const times = events.map(event => Date.parse(event.at)).filter(Number.isFinite)
    return { kind: 'hollow', key: `hollow:${keyOf(events[0]!)}`, events, calls: [...counts].map(([name, count]) => ({ name, count })), spanMs: times.length > 1 ? Math.max(...times) - Math.min(...times) : 0 }
  }, min)
}

export function hollowSummary(calls: readonly { name: string; count: number }[]): string {
  const total = calls.reduce((sum, entry) => sum + entry.count, 0)
  return `${total} tool call${total === 1 ? '' : 's'} · ${calls.map(entry => entry.count > 1 ? `${entry.name} ×${entry.count}` : entry.name).join(' · ')}`
}

export function collapsePolls(items: readonly RecordEvent[], { callsOf, answered, keyOf, min = 2 }: { callsOf: (event: RecordEvent) => readonly RowCall[]; answered: (event: RecordEvent, callId: string) => boolean; keyOf: (event: RecordEvent) => string; min?: number }): ConversationRow[] {
  return foldRows(items.map(event => ({ kind: 'event', key: keyOf(event), event })), event => pollCall(event, callsOf(event), id => answered(event, id)), (a, b) => a.name === b.name && (emptyArgs(a.input) ? '' : a.input!.trim()) === (emptyArgs(b.input) ? '' : b.input!.trim()), (events, call) => ({ kind: 'polls', key: `polls:${keyOf(events[0]!)}`, name: call.name, input: call.input, events }), min)
}

/** Exact repeated idle replies fold without hiding changed statements, tools, errors, prompts or source evidence. */
export function collapseIdleTurns(rows: readonly ConversationRow[], callsOf: (event: RecordEvent) => readonly RowCall[]): ConversationRow[] {
  return foldRows(rows, event => {
    const d = event.detail
    if (d.role !== 'assistant' || event.category === 'lifecycle' || d.lifecycle || d.reasoning || d.recordedClaim || d.responseStatus === 'error' || d.isError || d.contentOmitted || d.publicationNote || d.clip || thinkingMarkers(d).length || callsOf(event).length) return null
    const text = typeof d.publicText === 'string' ? d.publicText.trim() : ''
    return text.length <= 280 && /\b(waiting|ending the turn|end turn|no new updates|nothing new)\b/i.test(text) ? text : null
  }, (a, b) => a === b, events => ({ kind: 'idle', key: `idle:${anchorOf(events[0]!)}`, events }))
}

/** `6m 12s`, `45s`, `1h 3m`. */
export function waited(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * The collapsed row's facts. Tokens count only per-response usage recorded on the polls themselves; with none
 * recorded the count is unknown, never zero.
 */
export function pollSummary(events: readonly RecordEvent[]) {
  const times = events.map((event) => Date.parse(event.at)).filter(Number.isFinite)
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0
  let tokens = 0
  let measured = 0
  for (const event of events) {
    const usage = event.detail.usage
    if (!usage || event.detail.usageScope !== undefined) continue
    const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].filter((value): value is number => typeof value === 'number')
    if (!parts.length) continue
    measured++
    tokens += parts.reduce((sum, value) => sum + value, 0)
  }
  const count = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  const tokenText = !measured
    ? 'tokens unknown'
    : measured < events.length
      ? `~${count.format(tokens)} tokens (${measured} of ${events.length} measured)`
      : `~${count.format(tokens)} tokens`
  return {
    polls: events.length,
    spanMs: span,
    tokens: measured ? tokens : null,
    measured,
    label: `waited ${waited(span)} · ${events.length} polls · ${tokenText}`,
  }
}
