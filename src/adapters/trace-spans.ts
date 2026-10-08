/**
 * Project already-normalized OpenInference/OTLP spans into agent-record.v1.
 * The trace producer owns parsing and span relationships. This adapter never
 * reads native logs or treats span containment as agent delegation.
 */
import { parseRecord, type RecordClaim, type RecordEvent, type RecordPublication, type RecordProfileVersion, type RecordVerdict, type RunRecord } from '../record.js'

/** Structural subset emitted by @tangle-network/traces and chatgpt-fleet/otlp_export.py. */
export interface TraceSpanInput {
  trace_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  start_time: string
  end_time: string
  status: { code: string; message?: string }
  attributes: Record<string, unknown>
  kind?: string
  links?: readonly { trace_id: string; span_id: string; attributes?: Record<string, unknown> }[]
}

export interface TraceSpanProjectionOptions {
  recordId: string
  title: string
  /** A location supplied by the caller from retained evidence, keyed by recorded span ID. */
  sourceForSpan?: (span: TraceSpanInput) => RecordEvent['source']
  /** Evidence links must use recorded page, claim, session, run and digest IDs. */
  claims?: readonly RecordClaim[]
  verdicts?: readonly RecordVerdict[]
  publications?: readonly RecordPublication[]
  profileVersions?: readonly RecordProfileVersion[]
}

/** Structural subset of @tangle-network/agent-eval's TraceSchema Span. */
export interface StoryboardSpanInput {
  spanId: string
  parentSpanId?: string
  runId: string
  kind: string
  name: string
  startedAt: number
  endedAt?: number
  status?: string
  error?: string
  attributes?: Record<string, unknown>
  model?: string
  messages?: readonly { role: string; content: string }[]
  output?: string
  toolName?: string
  args?: unknown
  result?: unknown
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  cacheWriteTokens?: number
}

export interface StoryboardSpanProjectionOptions extends Omit<TraceSpanProjectionOptions, 'sourceForSpan'> {
  sourceForSpan?: (span: StoryboardSpanInput) => RecordEvent['source']
}

const nodeId = (traceId: string) => `trace:${encodeURIComponent(traceId)}`
const eventId = (traceId: string, spanId: string) => `${nodeId(traceId)}:span:${encodeURIComponent(spanId)}`
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const instant = (value: string): string | undefined => {
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined
}
const status = (code: string): string => code.replace(/^STATUS_CODE_/, '').toLowerCase()
const spanKind = (span: TraceSpanInput): string => string(span.attributes['openinference.span.kind']) ?? span.kind ?? 'UNKNOWN'

/** One record can combine independently captured traces without guessing cross-trace joins. */
export function fromTraceSpans(spans: readonly TraceSpanInput[], options: TraceSpanProjectionOptions): RunRecord {
  const byTrace = new Map<string, TraceSpanInput[]>()
  for (const span of spans) {
    if (!span.trace_id || !span.span_id) throw new Error('A trace span needs recorded trace_id and span_id')
    byTrace.set(span.trace_id, [...(byTrace.get(span.trace_id) ?? []), span])
  }
  const nodes: RunRecord['nodes'] = []
  const events: RunRecord['events'] = []
  const gaps: Array<{ nodeId: string; code: string; detail: string }> = []
  for (const [traceId, trace] of byTrace) {
    const id = nodeId(traceId)
    const ids = new Set(trace.map((span) => span.span_id))
    if (ids.size !== trace.length) throw new Error(`Trace ${traceId} repeats a span_id`)
    const gapStart = gaps.length
    const roots = trace.filter((span) => span.parent_span_id === null)
    const root = roots.length === 1 ? roots[0] : undefined
    if (!root) gaps.push({ nodeId: id, code: 'trace-root-unresolved', detail: `${roots.length} root spans recorded` })
    const sessionIds = new Set(trace.map((span) => string(span.attributes['tangle.sessionId'])).filter((value): value is string => Boolean(value)))
    if (sessionIds.size > 1) gaps.push({ nodeId: id, code: 'session-id-conflict', detail: 'Spans in one trace record different session IDs' })
    const starts = trace.map((span) => instant(span.start_time)).filter((value): value is string => Boolean(value)).sort()
    const ends = trace.map((span) => instant(span.end_time)).filter((value): value is string => Boolean(value)).sort()
    const node: RunRecord['nodes'][number] = {
      id, kind: 'session', parent: null, label: root?.name ?? traceId,
      ...(sessionIds.size === 1 ? { nativeSessionId: [...sessionIds][0] } : {}),
      ...(string(root?.attributes['service.name']) ? { harness: string(root?.attributes['service.name']) } : {}),
      ...(starts[0] ? { start: starts[0] } : {}),
      ...(ends.at(-1) ? { end: ends.at(-1) } : {}),
      ...(root ? { status: status(root.status.code) } : {}),
      capture: { channel: 'trace-spans', status: 'complete', reason: null },
    }
    nodes.push(node)
    for (const span of trace) {
      if (span.parent_span_id !== null && !ids.has(span.parent_span_id))
        gaps.push({ nodeId: id, code: 'parent-span-unresolved', detail: `Span ${span.span_id} names absent parent ${span.parent_span_id}` })
      const at = instant(span.start_time)
      if (!at) {
        gaps.push({ nodeId: id, code: 'span-untimed', detail: `Span ${span.span_id} has no valid start time` })
        continue
      }
      const kind = spanKind(span).toLowerCase()
      const content = string(span.attributes.content)
      const input = string(span.attributes['input.value'])
      const output = string(span.attributes['output.value'])
      const usage = {
        input: count(span.attributes['llm.token_count.prompt']),
        output: count(span.attributes['llm.token_count.completion']),
        cacheRead: count(span.attributes['llm.token_count.prompt_cache_hit']),
        cacheWrite: count(span.attributes['llm.token_count.prompt_cache_write']),
      }
      const toolName = string(span.attributes['tool.name']) ?? string(span.attributes['gen_ai.tool.name'])
      events.push({
        id: eventId(traceId, span.span_id), node: id, at, kind: `trace-${kind}`, category: 'other', label: span.name,
        source: options.sourceForSpan?.(span) ?? null,
        detail: {
          traceId, spanId: span.span_id, parentSpanId: span.parent_span_id, end: instant(span.end_time) ?? null,
          status: status(span.status.code), ...(span.status.message ? { responseStatus: span.status.message } : {}),
          spanAttributes: span.attributes, ...(span.links ? { spanLinks: span.links } : {}),
          ...(content || input || output ? { publicText: [content, input, output].filter(Boolean).join('\n') } : {}),
          ...(toolName ? { toolCallId: span.span_id, toolNames: [toolName] } : {}),
          ...(Object.values(usage).some((value) => value !== undefined) ? { usage } : {}),
          ...(kind === 'tool' ? { isError: status(span.status.code) === 'error' } : {}),
        },
      })
    }
    if (gaps.length > gapStart) node.capture = { channel: 'trace-spans', status: 'lossy', reason: 'span-integrity' }
  }
  return parseRecord({
    schema: 'agent-record.v1', runId: options.recordId, title: options.title, idScheme: 'trace-span.v1',
    nodes, events,
    claims: options.claims ? [...options.claims] : undefined,
    verdicts: options.verdicts ? [...options.verdicts] : undefined,
    publications: options.publications ? [...options.publications] : undefined,
    profileVersions: options.profileVersions ? [...options.profileVersions] : undefined,
    coverage: { completeOriginalCapture: false, publicContent: 'Unreviewed normalized trace content', categoryMethod: 'trace span kind', cost: 'Unknown', gaps },
  })
}

/** The storyboard/run-capsule Span[] contract projected without changing its input array. */
export function fromStoryboardSpans(spans: readonly StoryboardSpanInput[], options: StoryboardSpanProjectionOptions): RunRecord {
  const original = new Map<string, StoryboardSpanInput>()
  const normalized: TraceSpanInput[] = spans.map((span) => {
    const key = eventId(span.runId, span.spanId)
    original.set(key, span)
    const attributes: Record<string, unknown> = { ...span.attributes,
      'openinference.span.kind': span.kind.toUpperCase(), 'agent_eval.span_kind': span.kind }
    if (span.model !== undefined) attributes['llm.model_name'] = span.model
    if (span.toolName !== undefined) attributes['tool.name'] = span.toolName
    if (span.inputTokens !== undefined) attributes['llm.token_count.prompt'] = span.inputTokens
    if (span.outputTokens !== undefined) attributes['llm.token_count.completion'] = span.outputTokens
    if (span.cachedTokens !== undefined) attributes['llm.token_count.prompt_cache_hit'] = span.cachedTokens
    if (span.cacheWriteTokens !== undefined) attributes['llm.token_count.prompt_cache_write'] = span.cacheWriteTokens
    if (span.messages?.length) attributes.content = span.messages.map((message) => `${message.role}: ${message.content}`).join('\n')
    if (span.output !== undefined) attributes['output.value'] = span.output
    if (span.args !== undefined) attributes['input.value'] = typeof span.args === 'string' ? span.args : JSON.stringify(span.args)
    if (span.result !== undefined) attributes['output.value'] = typeof span.result === 'string' ? span.result : JSON.stringify(span.result)
    return {
      trace_id: span.runId, span_id: span.spanId, parent_span_id: span.parentSpanId ?? null,
      name: span.name, kind: span.kind.toUpperCase(),
      start_time: Number.isFinite(span.startedAt) ? new Date(span.startedAt).toISOString() : '',
      end_time: span.endedAt !== undefined && Number.isFinite(span.endedAt) ? new Date(span.endedAt).toISOString() : '',
      status: { code: span.status === 'error' ? 'ERROR' : span.status === 'ok' ? 'OK' : 'UNSET', ...(span.error ? { message: span.error } : {}) },
      attributes,
    }
  })
  const record = fromTraceSpans(normalized, { ...options,
    sourceForSpan: options.sourceForSpan ? (span) => options.sourceForSpan!(original.get(eventId(span.trace_id, span.span_id))!) : undefined,
  })
  return { ...record, idScheme: 'storyboard-span.v1' }
}
