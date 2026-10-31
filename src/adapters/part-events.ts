/** Browser-safe native-frame projection. Retained ingest supplies its real source and clipping policy. */
import type { RecordEvent, RecordNode } from '../record.js'
export type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any
export const str = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
export const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
export const isoAt = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value)
  return Number.isFinite(date.valueOf()) && date.valueOf() >= Date.UTC(2001, 0, 1) && date.valueOf() < Date.UTC(2100, 0, 1) ? date.toISOString() : null
}
/** A producer sequence is not a physical source line. Only supplied source anchors become provenance. */
export interface PartEventRow {
  seq: number
  at?: string
  stream?: string
  attempt?: number
  type?: string
  data?: unknown
  source?: RecordEvent['source']
}
interface NativeFrame { event: Json; at?: string; row?: PartEventRow }
interface PartFrame extends NativeFrame { where(): Json; full(path: (string | number)[], value: Json): Json }
type Content = { path: (string | number)[]; value: Json; text?: string }
type Draft = { firstSeq?: number; frame: NativeFrame; at?: string; kind: string; category: string; label: string; detail: Json; item?: number; body?: Content; input?: Content }
type Seen = { part: Json; frame: NativeFrame; firstMs: number | null; firstSeq?: number }
const content = (path: (string | number)[], value: Json, text?: string): Content => ({ path, value, text })

/** Collapse updates by native identity, keeping the final frame and its first recorded clock. */
function collect(node: Json, frames: Iterable<NativeFrame>) {
  const roles = new Map<string, string>(), parts = new Map<string, Seen>(), codex = new Map<string, Seen>()
  const extras: { frame: NativeFrame; at: number | null; kind: string; data: Json }[] = []
  let clock: number | null = node.start ? Date.parse(node.start) : null, done: Json = null
  for (const frame of frames) {
    const { event } = frame, data = event?.data ?? {}, recorded = isoAt(frame.at)
    if (recorded) clock = Date.parse(recorded)
    if (event?.type === 'message.updated' && data.info?.id && data.info?.role) roles.set(data.info.id, data.info.role)
    else if (event?.type === 'message.part.updated' && data.part?.id) {
      const part = data.part, time = num(part.state?.time?.start) ?? num(part.time?.start)
      if (time !== undefined) clock = Math.max(clock ?? 0, time)
      parts.set(part.id, { part, frame, firstMs: parts.get(part.id)?.firstMs ?? clock, firstSeq: parts.get(part.id)?.firstSeq ?? frame.row?.seq })
      const end = num(part.state?.time?.end) ?? num(part.time?.end)
      if (end !== undefined) clock = Math.max(clock ?? 0, end)
    } else if (event?.type === 'raw' && data.event?.type === 'item.completed' && data.event.item?.id) {
      const part = data.event.item
      codex.set(part.id, { part, frame, firstMs: clock, firstSeq: codex.get(part.id)?.firstSeq ?? frame.row?.seq })
    } else if (event?.type === 'raw' && data.event?.role === 'tool' && typeof data.event.tool_call_id === 'string') extras.push({ frame, at: clock, kind: 'tool-result', data: data.event })
    else if (event?.type === 'raw' && data.event?.type === 'rate_limit_event') extras.push({ frame, at: clock, kind: 'rate-limit', data: data.event.rate_limit_info ?? {} })
    else if (event?.type === 'done') done = { data, usage: event.usage }
    else if (event?.type === 'result' && data.outcome && data.outcome.type !== 'completed') extras.push({ frame, at: clock, kind: 'execution-error', data: data.outcome })
  }
  return { roles, parts, codex, extras, done }
}

/** Calls from different harnesses share emission and clipping semantics, not a second parser. */
function toolDrafts(frame: NativeFrame, at: string | undefined, name: string, id: string, native: string, input: Content, result: Content | undefined, options: { category: string; error: boolean; end?: string; duration?: number; carried?: boolean; marked?: boolean }): Draft[] {
  const base = { frame, at, category: options.category }, nativeRecordId = native
  const call: Draft = { ...base, kind: 'message', label: `assistant · ${name}`, ...(options.marked ? { item: 0 } : {}), input,
    detail: { role: 'assistant', nativeRecordId, publicToolCalls: [{ id, name, input: input.text ?? JSON.stringify(input.value) }] } }
  if (!result) return [call]
  return [call, { ...base, at: options.end ?? at, kind: 'tool-result', item: 1, label: `tool result · ${name}`, body: result,
    detail: { role: 'toolResult', nativeRecordId, toolCallId: id, isError: options.error, publicText: result.text ?? str(result.value), ...(options.duration !== undefined ? { durationMs: options.duration } : {}), ...(options.carried ? { atBasis: 'carried' } : {}) } }]
}

function partDrafts(node: Json, seen: Seen, roles: Map<string, string>, categoryOf?: (name: string, input: unknown) => string): Draft[] {
  const { part, frame, firstMs } = seen, id = part.id, role = roles.get(part.messageID) === 'user' ? 'user' : 'assistant'
  const at = isoAt((part.type === 'tool' ? num(part.state?.time?.start) : num(part.time?.start)) ?? firstMs ?? undefined) ?? node.start
  if (part.type === 'text' || part.type === 'reasoning') {
    const text = str(part.text)
    return text ? [{ frame, at, kind: 'message', category: 'reasoning', label: role, body: content(['data', 'part', 'text'], text),
      detail: { role, nativeRecordId: id, [part.type === 'text' ? 'publicText' : 'reasoning']: text, ...(part.time?.start ? {} : { atBasis: 'carried' }) } }] : []
  }
  if (part.type !== 'tool') return []
  const state = part.state ?? {}, name = str(part.tool), settled = state.status === 'completed' || state.status === 'error'
  const start = num(state.time?.start) ?? firstMs, end = num(state.time?.end), field = state.status === 'error' ? 'error' : 'output'
  return toolDrafts(frame, at, name, str(part.callID || id), id, content(['data', 'part', 'state', 'input'], state.input ?? {}), settled && at ? content(['data', 'part', 'state', field], state[field]) : undefined,
    { category: categoryOf?.(name, state.input) ?? 'other', error: state.status === 'error', marked: settled, end: isoAt(end ?? start ?? undefined) ?? node.start,
      ...(end !== undefined && start !== null && start !== undefined ? { duration: Math.max(0, end - start) } : {}) })
}

function codexDrafts(node: Json, seen: Seen, categoryOf?: (name: string, input: unknown) => string): Draft[] {
  const { part: item, frame, firstMs } = seen, at = isoAt(firstMs ?? undefined) ?? node.start
  if (!at || !['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(item.type)) return []
  const name = item.type === 'mcp_tool_call' ? str(item.tool ?? item.name) : item.type
  const input = item.type === 'command_execution' ? { command: item.command } : item.type === 'web_search' ? { query: item.query } : item.type === 'file_change' ? { changes: item.changes } : item.arguments ?? {}
  const path = ['data', 'event', 'item']
  return toolDrafts(frame, at, name, str(item.id), str(item.id), content(path, item, JSON.stringify(input)), content(path, item, str(item.aggregated_output ?? item.result ?? item.output ?? item.status)),
    { category: categoryOf?.(name, input) ?? 'other', error: typeof item.exit_code === 'number' && item.exit_code !== 0 || item.status === 'failed', marked: true, carried: true })
}

function extraDraft(node: Json, extra: ReturnType<typeof collect>['extras'][number]): Draft | undefined {
  const at = isoAt(extra.at ?? undefined) ?? node.start, { frame, kind, data } = extra
  if (!at) return undefined
  if (kind === 'tool-result') {
    const body = typeof data.content === 'string' ? data.content : Array.isArray(data.content) ? data.content.map((part: Json) => str(part?.text ?? part)).join('\n') : str(data.content)
    return { frame, at, kind, category: 'other', label: 'tool result', body: content(['data', 'event', 'content'], data.content),
      detail: { role: 'toolResult', toolCallId: str(data.tool_call_id), isError: /<system>ERROR/.test(body), publicText: body, atBasis: 'carried' } }
  }
  const window = data.rateLimitType ?? null, utilization = window ? num(data.unifiedWindows?.[window]?.utilization) ?? null : null
  return { frame, at, kind, category: 'lifecycle', label: kind === 'rate-limit' ? `rate limit · ${window ?? 'window unknown'}` : 'execution error',
    detail: kind === 'rate-limit' ? { rateLimit: { window, utilization, status: data.status ?? null }, data } : { responseStatus: 'error', isError: true, publicText: str(data.error ?? data) } }
}

function project(node: Json, frames: Iterable<NativeFrame>, categoryOf?: (name: string, input: unknown) => string) {
  const state = collect(node, frames), drafts: Draft[] = []
  let produced = 0
  const append = (seen: Seen, part: Draft[], countResults = false) => {
    for (const draft of part) draft.firstSeq = draft.kind === 'tool-result' ? draft.frame.row?.seq : seen.firstSeq
    drafts.push(...part); produced += countResults ? part.length : part.filter(draft => draft.at && draft.kind === 'message').length
  }
  for (const seen of state.parts.values()) append(seen, partDrafts(node, seen, state.roles, categoryOf))
  for (const seen of state.codex.values()) append(seen, codexDrafts(node, seen, categoryOf), true)
  for (const extra of state.extras) {
    const draft = extraDraft(node, extra)
    if (draft) { drafts.push(draft); if (draft.kind === 'tool-result') produced++ }
  }
  return { drafts, done: state.done, produced }
}

function applyUsage(target: Json, done: Json) {
  const usage = done?.usage ?? done?.data?.tokenUsage, cost = num(usage?.cost) ?? num(done?.data?.totalCostUsd)
  const unmetered = done?.data?.tokensKnown === false && !num(usage?.inputTokens) && !num(usage?.outputTokens) && !num(usage?.cacheReadInputTokens) && !num(usage?.cacheCreationInputTokens) && !cost
  if (target && usage && !unmetered) Object.assign(target.detail, {
    usage: { input: num(usage.inputTokens), output: num(usage.outputTokens), cacheRead: num(usage.cacheReadInputTokens), cacheWrite: num(usage.cacheCreationInputTokens) },
    usageScope: 'execution-total', ...(cost === undefined ? {} : { costListUsd: cost, usdKnown: false }),
  })
}

/** Materialize only real retained policy: every clip still resolves its original value through the original frame. */
function retainedEvent(draft: Draft, node: Json, rel: string, entry: { sha256: string }, context: Json) {
  const { body, input } = draft, frame = draft.frame as PartFrame
  const { atBasis, durationMs, ...detail } = draft.detail
  const clipped = (text: string, value: Content) => context.clip(text, () => frame.full(value.path, value.value))
  if (input) {
    const call = detail.publicToolCalls[0], shown = clipped(call.input, input)
    detail.publicToolCalls = [{ ...call, input: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) }]
  }
  if (body) {
    const field = detail.reasoning !== undefined ? 'reasoning' : 'publicText', shown = clipped(detail[field], body)
    detail[field] = shown.text
    if (shown.clip) detail.clip = shown.clip
  }
  if (durationMs !== undefined) detail.durationMs = durationMs
  if (atBasis !== undefined) detail.atBasis = atBasis
  if (!draft.at) return undefined
  if (draft.kind === 'rate-limit') detail.data = context.compactValue(detail.data)
  if (draft.kind === 'execution-error') detail.publicText = context.clip(detail.publicText, null).text
  return { node: node.id, at: draft.at, kind: draft.kind, category: draft.category, label: draft.label,
    source: { path: rel, sha256: entry.sha256, ...frame.where(), ...(draft.item !== undefined ? { item: draft.item } : {}) }, detail }
}

/** The retained streaming importer keeps its original sink, source anchors, clipping and usage target. */
export function projectPartFrames(context: Json, node: Json, rel: string, entry: { sha256: string }, frames: Iterable<PartFrame>, categoryOf: (name: string, input: unknown) => string): number {
  const { drafts, done, produced } = project(node, frames, categoryOf)
  let lastText: Json
  for (const draft of drafts) {
    const event = retainedEvent(draft, node, rel, entry, context)
    if (!event) continue
    context.emit(event)
    if (draft.kind === 'message' && draft.detail.role === 'assistant' && draft.body) lastText = context.events.at(-1)
  }
  if (!done) return produced
  if (typeof done.data?.effectiveBackend?.model === 'string') {
    node.servedModel ??= done.data.effectiveBackend.model
    node.modelSource ??= 'effective backend'
  }
  applyUsage(lastText ?? [...context.events].reverse().find((event: Json) => event.node === node.id && event.source?.path === context.sourcePath(rel)), done)
  return produced
}

export function projectPartEvents(node: Pick<RecordNode, 'id' | 'start'>, rows: readonly PartEventRow[]): RecordEvent[]
export function projectPartEvents(context: Json, node: Json, rel: string, entry: { sha256: string }, events: Json[], loc: { where(index: number): Json; full(index: number, path: (string | number)[], value: Json): Json }, categoryOf: (name: string, input: unknown) => string): number
export function projectPartEvents(first: Json, second: Json, rel?: string, entry?: { sha256: string }, events?: Json[], loc?: Json, categoryOf?: (name: string, input: unknown) => string): number | RecordEvent[] {
  if (events && loc && entry && rel !== undefined && categoryOf) {
    function* frames(): Generator<PartFrame> {
      for (const [index, event] of events!.entries()) yield { event, where: () => loc.where(index), full: (path, value) => loc.full(index, path, value) }
    }
    return projectPartFrames(first, second, rel, entry, frames(), categoryOf)
  }
  const node = first as Pick<RecordNode, 'id' | 'start'>, groups = new Map<string, PartEventRow[]>()
  for (const row of second as readonly PartEventRow[]) {
    const key = JSON.stringify([row.stream ?? null, row.attempt ?? null]), group = groups.get(key) ?? []
    group.push(row); groups.set(key, group)
  }
  const result: RecordEvent[] = []
  for (const rows of groups.values()) {
    const frames = rows.map(row => ({ event: row, at: row.at, row }))
    const { drafts, done } = project(node, frames)
    const projected = drafts.filter(draft => draft.at).map(draft => {
      const row = draft.frame.row!, native = draft.detail.nativeRecordId ?? row.seq
      const detail = { ...draft.detail, streamSeq: draft.firstSeq ?? row.seq, ...(row.stream !== undefined ? { stream: row.stream } : {}), ...(row.attempt !== undefined ? { attempt: row.attempt } : {}) }
      return { id: JSON.stringify([node.id, row.stream ?? null, row.attempt ?? null, native, draft.kind, draft.item ?? (draft.kind === 'tool-result' ? 1 : 0)]), node: node.id, at: draft.at, kind: draft.kind, category: draft.category, label: draft.label, ...(row.source ? { source: row.source } : {}), detail } as RecordEvent
    })
    applyUsage([...projected].reverse().find(event => event.kind === 'message' && event.detail.role === 'assistant' && (event.detail.publicText || event.detail.reasoning)) ?? projected.at(-1), done)
    result.push(...projected)
  }
  return result
}
