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
 * The one call of an event that is a poll: an assistant turn whose only content is a single tool call, with no text,
 * thinking, note or clipped body, and with no result anywhere in the record. A call that has a result is never a poll,
 * whatever the result says, so collapsing can hide no returned content. Its arguments are empty or absent, or the
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

/**
 * Consecutive polls of the same tool with the same arguments (empty and absent arguments count as the same) become
 * one row. A run shorter than `min` stays as separate rows.
 */
export function collapsePolls(
  items: readonly RecordEvent[],
  {
    callsOf,
    answered,
    keyOf,
    min = 2,
  }: {
    callsOf: (event: RecordEvent) => readonly RowCall[]
    answered: (event: RecordEvent, callId: string) => boolean
    keyOf: (event: RecordEvent) => string
    min?: number
  },
): ConversationRow[] {
  const rows: ConversationRow[] = []
  let run: { name: string; args: string; input: string | undefined; events: RecordEvent[] } | null = null
  const close = () => {
    if (!run) return
    if (run.events.length >= min)
      rows.push({ kind: 'polls', key: `polls:${keyOf(run.events[0]!)}`, name: run.name, input: run.input, events: run.events })
    else for (const event of run.events) rows.push({ kind: 'event', key: keyOf(event), event })
    run = null
  }
  for (const event of items) {
    const call = pollCall(event, callsOf(event), (id) => answered(event, id))
    if (!call) {
      close()
      rows.push({ kind: 'event', key: keyOf(event), event })
      continue
    }
    const args = emptyArgs(call.input) ? '' : call.input!.trim()
    if (run && (run.name !== call.name || run.args !== args)) close()
    run ??= { name: call.name, args, input: call.input, events: [] }
    run.events.push(event)
  }
  close()
  return rows
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
