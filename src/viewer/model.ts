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
/**
 * Recorded text names the host folders an agent ran in (`/home/<user>/.cache/disco/host/<run>/sessions/<session>/inputs/x.md`).
 * The reader needs the path inside the run, and a page must not publish the host's: a session or run folder reads as the
 * path under it (`inputs/x.md`, or `./` for the folder itself), any other home folder as `~/`.
 */
const HOST_PATH = /\/(?:home|Users)\/[^/\s"'`]+(?:\/\.cache\/disco\/host\/[^/\s"'`]+(?:\/sessions\/[^/\s"'`]+)?)?(\/?)/g
export function hostless(text: string): string
export function hostless(text: string | undefined): string | undefined
export function hostless(text: string | undefined) {
  if (!text || !(text.includes('/home/') || text.includes('/Users/'))) return text
  return text.replace(HOST_PATH, (match: string, slash: string, at: number, all: string) => {
    if (!match.includes('/.cache/disco/host/')) return slash ? '~/' : '~'
    const next = all[at + match.length]
    return slash && next !== undefined && !/[\s"'`)]/.test(next) ? '' : './'
  })
}
/** An event with every recorded text read through `hostless`; an event without a host path is returned as it is. */
function withoutHostPaths(event: RecordEvent): RecordEvent {
  const d = event.detail
  const text = hostless(d.publicText), reasoning = hostless(d.reasoning)
  const calls = d.publicToolCalls?.map((call) => (call.input && hostless(call.input) !== call.input ? { ...call, input: hostless(call.input) } : call))
  if (text === d.publicText && reasoning === d.reasoning && calls?.every((call, i) => call === d.publicToolCalls![i]) !== false) return event
  return { ...event, detail: { ...d, ...(text !== undefined ? { publicText: text } : {}), ...(reasoning !== undefined ? { reasoning } : {}), ...(calls ? { publicToolCalls: calls } : {}) } }
}
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
  if (call.input === undefined) return 'args not captured'
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
  const events = record.events.map(withoutHostPaths).sort((a, b) => ms(a.at) - ms(b.at))
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
  const end = events.reduce((latest, event) => Math.max(latest, event.end ? ms(event.end) : ms(event.at)), times.at(-1) ?? start)
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

/** Whether any event of this agent recorded token usage or a list price: a status alone measures nothing. */
export function measuredUsage(index: RecordIndex, id: string) {
  return (index.byActor.get(id) ?? []).some(
    (event) =>
      typeof event.detail.costListUsd === 'number' ||
      Object.values(event.detail.usage ?? {}).some((value) => typeof value === 'number' && value > 0),
  )
}

/** An agent's recorded state, qualified when nothing about it was measured or captured. A live agent has no terminal
 * state yet: `live` is its state while the run runs (Runtime's progress document), and it reads as working. */
export function agentState(node: RecordNode | undefined, measured: boolean, live?: string | null) {
  if (!node?.status && live) return live === 'running' ? 'working' : live.replaceAll('-', ' ')
  const status = node?.status ?? 'no terminal state recorded'
  if (measured) return status
  const capture = (node?.capture as { status?: string } | undefined)?.status
  return `${status} · no usage recorded${capture === 'absent' ? '; capture missing' : capture === 'lossy' ? '; capture partial' : ''}`
}

export function eventMatches(
  event: RecordEvent,
  index: RecordIndex,
  query: string,
  category: string,
) {
  const categoryMatches =
    category === 'all' ||
    (category === 'prompts' && (event.detail.promptKind === 'initial' || event.detail.promptKind === 'steering')) ||
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
  return lines
}

/** A declared model is configuration; only response metadata shows which model served. */
export function modelIdentity(
  node: RecordNode | undefined,
  record: RunRecord,
) {
  if (!node) return null
  const served = [
    ...new Set(
      record.nodes
        .filter(
          (session) => session.agentId === node.id || session.id === node.id,
        )
        .map((session) => session.servedModel)
        .filter((model): model is string => Boolean(model)),
    ),
  ]
  return served.length
    ? `${served.join(', ')} (served)`
    : node.model
      ? `${node.model} (declared; served model unknown)`
      : null
}

export interface TooltipSection {
  kind: 'header' | 'body' | 'usage' | 'status' | 'note'
  label?: string
  value: string
  tone?: 'default' | 'error' | 'ok' | 'warn' | 'muted' | 'accent'
}

export function tooltipSections(event: RecordEvent, index: RecordIndex, cutoff: number): { title: string; category: string; tone: string; sections: TooltipSection[] } {
  const node = index.nodes.get(index.canonical(event.node))
  const isError = event.detail.isError === true || event.detail.responseStatus === 'error'
  const category = event.detail.role ?? event.kind
  const title = event.label || category
  const sections: TooltipSection[] = [
    { kind: 'header', value: `${node?.label ?? event.node} · ${utcTime(event.at)}`, tone: 'muted' },
  ]
  if (ms(event.at) > cutoff) {
    sections.push({ kind: 'note', value: 'After the selected time. Select this event to advance.' })
    return { title, category, tone: isError ? 'error' : 'default', sections }
  }
  if (event.detail.isError) sections.push({ kind: 'status', value: 'Tool error', tone: 'error' })
  if (event.detail.responseStatus === 'error') sections.push({ kind: 'status', value: 'Request failed', tone: 'error' })
  const text = textOf(event)
  if (text) sections.push({ kind: 'body', value: text.slice(0, 200) + (text.length > 200 ? '…' : '') })
  const calls = callsOf(event)
  for (const call of calls.slice(0, 2)) {
    sections.push({ kind: 'body', label: call.name, value: preview(call).slice(0, 160) })
  }
  const usage = event.detail.usage
  if (usage && !event.detail.usageScope) {
    const parts: string[] = []
    if (usage.input !== undefined) parts.push(`↑ ${fmt(usage.input)}`)
    if (usage.output !== undefined) parts.push(`↓ ${fmt(usage.output)}`)
    if (usage.cacheRead !== undefined) parts.push(`⟳ ${fmt(usage.cacheRead)}`)
    if (usage.cacheWrite !== undefined) parts.push(`→ ${fmt(usage.cacheWrite)}`)
    if (parts.length) sections.push({ kind: 'usage', value: parts.join('  '), tone: 'accent' })
  }
  const duration = event.detail.durationMs
  if (typeof duration === 'number') sections.push({ kind: 'status', value: `⏱ ${duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}`, tone: 'muted' })
  return { title, category, tone: isError ? 'error' : 'default', sections }
}
