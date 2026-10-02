import type { RecordEvent, RecordNode, RunRecord } from '../record.js'

export interface ToolCall {
  id: string
  name: string
  input?: string
  publicationNote?: string | null
}

export const ms = (value: string) => Date.parse(value)
/** Normalize labels to UTC without rewriting the source timestamp. */
export function utcTime(value: string, includeDate = false) {
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return 'Unknown time'
  const iso = date.toISOString()
  return `${includeDate ? iso.slice(0, 19).replace('T', ' ') : iso.slice(11, 19)} UTC`
}
export const compact = (value: string) => value.replace(/\s+/g, ' ').trim()
export const fmt = (value: number) =>
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
export const interval = (value: number) =>
  value < 1000
    ? `${Math.round(value)} ms`
    : value < 60000
      ? `${(value / 1000).toFixed(1)} s`
      : `${(value / 60000).toFixed(1)} min`
export const roleOf = (node?: RecordNode) =>
  node?.role ??
  (node?.kind === 'session'
    ? 'Session'
    : node?.kind === 'finding'
      ? 'Finding'
      : 'Agent')
export const textOf = (event: RecordEvent) =>
  event.detail.publicText ?? event.detail.recordedClaim ?? ''
export const toolKey = (node: string, id: string) => JSON.stringify([node, id])

export function callsOf(event: RecordEvent): ToolCall[] {
  const published = event.detail.publicToolCalls ?? []
  const byId = new Map(published.map((call) => [call.id, call]))
  const ids = [
    ...new Set([
      ...(event.detail.toolCallIds ?? []),
      ...published.map((call) => call.id),
    ]),
  ]
  return ids.map(
    (id) =>
      byId.get(id) ?? {
        id,
        name:
          event.detail.toolNames?.length === 1
            ? event.detail.toolNames[0]!
            : 'Tool call',
      },
  )
}

export function preview(call: ToolCall) {
  if (call.input === undefined) return 'Arguments unavailable'
  try {
    const value: unknown = JSON.parse(call.input)
    if (value && typeof value === 'object') {
      const args = value as Record<string, unknown>
      for (const key of ['command', 'cmd', 'path', 'query', 'task'])
        if (typeof args[key] === 'string') return compact(args[key])
    }
  } catch {
    /* Tool inputs can be plain text. */
  }
  return compact(call.input)
}

/** Identity is established by the importer, never inferred from labels or timestamps. */
export function indexRecord(record: RunRecord) {
  const nodes = new Map(record.nodes.map((node) => [node.id, node]))
  const canonical = (id: string) => nodes.get(id)?.agentId ?? id
  const actors = record.nodes.filter(
    (node) => node.kind !== 'session' || !node.agentId,
  )
  const events = [...record.events].sort((a, b) => ms(a.at) - ms(b.at))
  const byEvent = new Map(events.map((event) => [event.id, event]))
  const recordedOrder = new Map(record.events.map((event, i) => [event.id, i]))
  const byActor = new Map<string, RecordEvent[]>()
  const results = new Map<string, RecordEvent[]>()
  const calls = new Map<string, { event: RecordEvent; call: ToolCall }[]>()
  for (const event of events) {
    const actor = canonical(event.node)
    const lane = byActor.get(actor) ?? []
    lane.push(event)
    byActor.set(actor, lane)
    for (const call of callsOf(event)) {
      const key = toolKey(event.node, call.id)
      const matching = calls.get(key) ?? []
      matching.push({ event, call })
      calls.set(key, matching)
    }
    if (event.detail.toolCallId !== undefined) {
      const key = toolKey(event.node, event.detail.toolCallId)
      const matching = results.get(key) ?? []
      matching.push(event)
      results.set(key, matching)
    }
  }
  const times = events.map((event) => ms(event.at))
  const start = times[0] ?? 0
  const end = times.at(-1) ?? start
  return {
    nodes,
    canonical,
    actors,
    events,
    byEvent,
    recordedOrder,
    byActor,
    calls,
    results,
    start,
    end,
  }
}
export type RecordIndex = ReturnType<typeof indexRecord>

export function eventMatches(
  event: RecordEvent,
  index: RecordIndex,
  query: string,
  category: string,
) {
  const categoryMatches =
    category === 'all' ||
    event.category === category ||
    (category === 'findings' &&
      (event.kind === 'finding-record' ||
        event.detail.recordedClaim !== undefined))
  return (
    categoryMatches &&
    (!query ||
      JSON.stringify({
        label: event.label,
        node: index.nodes.get(index.canonical(event.node)),
        detail: event.detail,
      })
        .toLowerCase()
        .includes(query))
  )
}

export function eventSource(
  event: RecordEvent,
  record: RunRecord,
  index: RecordIndex,
) {
  const node = index.nodes.get(event.node)
  return {
    ...event.source,
    runId: record.runId,
    at: event.at,
    observedNodeId: event.node,
    agentId: node?.kind === 'agent' ? node.id : (node?.agentId ?? null),
    nativeSessionId: node?.nativeSessionId ?? null,
    joinBasis: node?.joinBasis ?? null,
    joinProof: node?.joinProof ?? null,
  }
}

export function hoverLines(
  event: RecordEvent,
  index: RecordIndex,
  cutoff: number,
) {
  const lines = [
    `${index.nodes.get(index.canonical(event.node))?.label ?? event.node} · ${utcTime(event.at)}`,
    `${event.detail.role ?? event.kind}${event.detail.isError ? ' · tool error' : event.detail.responseStatus === 'error' ? ' · request failed' : ''}`,
  ]
  if (ms(event.at) > cutoff)
    return [...lines, 'After the selected time. Select this event to advance.']
  const usage = event.detail.usage
  if (usage)
    lines.push(
      `Input ${usage.input === undefined ? 'unknown' : fmt(usage.input)} · output ${usage.output === undefined ? 'unknown' : fmt(usage.output)} · cache read ${usage.cacheRead === undefined ? 'unknown' : fmt(usage.cacheRead)} · cache write ${usage.cacheWrite === undefined ? 'unknown' : fmt(usage.cacheWrite)}`,
    )
  const text = textOf(event)
  if (text) lines.push(text.slice(0, 220) + (text.length > 220 ? '…' : ''))
  for (const call of callsOf(event).slice(0, 3))
    lines.push(`${call.name}: ${preview(call).slice(0, 220)}`)
  if (!text && !callsOf(event).length && event.detail.role)
    lines.push(
      event.detail.contentOmitted ??
        event.detail.publicationNote ??
        'No text body is present in this record.',
    )
  lines.push('Select to inspect the event and its source.')
  return lines
}

export function actorDescription(
  node: RecordNode | undefined,
  record: RunRecord,
) {
  if (!node) return ''
  const sessions = record.nodes.filter(
    (session) => session.agentId === node.id || session.id === node.id,
  )
  const served = [
    ...new Set(
      sessions
        .map((session) => session.servedModel)
        .filter((model): model is string => Boolean(model)),
    ),
  ]
  return [
    roleOf(node),
    node.assignment,
    served.length
      ? `${served.join(', ')} (response metadata)`
      : node.model
        ? `${node.model} (configured; served identity unknown)`
        : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
