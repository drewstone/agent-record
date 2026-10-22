import type { FlowSpan, FlowTrace } from '@tangle-network/charts'
import type { RunRecord } from '../record.js'
import { indexRecord, ms, toolKey } from '../viewer/model.js'

const failed = (value: unknown) => value === 'error' || value === 'failed' || value === 'driver-failed'
const time = (value: unknown) => typeof value === 'string' ? ms(value) : NaN

/** Project retained identities and measured intervals; a message without a duration remains a point. */
export function recordFlowTrace(record: RunRecord, live = false, observedAt = Date.now()): FlowTrace {
  const index = indexRecord(record)
  const starts = [...index.actors.map((node) => time(node.start)), ...index.events.map((event) => ms(event.at))].filter(Number.isFinite)
  const first = starts.length ? starts.reduce((a, b) => Math.min(a, b)) : observedAt
  const ends = [...index.actors.map((node) => time(node.end)), ...index.events.map((event) => ms(event.at))].filter(Number.isFinite)
  const last = ends.reduce((a, b) => Math.max(a, b), live ? Math.max(first, observedAt) : first)
  const spans: FlowSpan[] = []
  const actors = new Set(index.actors.map((node) => node.id))
  const runningNodes = new Set(index.actors.filter((node) => live && !node.end && (!node.status || ['running', 'working', 'waiting'].includes(node.status))).map((node) => node.id))
  const offset = (at: number) => Math.max(0, at - first)
  for (const node of index.actors) {
    if (node.kind === 'finding') continue
    const events = index.byActor.get(node.id) ?? []
    const start = Number.isFinite(time(node.start)) ? time(node.start) : events[0] ? ms(events[0].at) : NaN
    if (!Number.isFinite(start)) continue
    const running = runningNodes.has(node.id)
    const end = running ? last : Number.isFinite(time(node.end)) ? time(node.end) : events.at(-1) ? ms(events.at(-1)!.at) : start
    const parent = node.parent ? index.canonical(node.parent) : undefined
    spans.push({ id: node.id, ...(parent && actors.has(parent) ? { parentId: parent } : {}), kind: 'pipeline', name: node.label, startMs: offset(start), endMs: offset(Math.max(start, end)), status: running ? 'running' : failed(node.status) ? 'failed' : 'done' })
    if (parent && actors.has(parent)) spans.push({ id: `${node.id}:handoff`, parentId: parent, kind: 'handoff', name: `Handoff to ${node.label}`, startMs: offset(start), endMs: offset(start), approx: true, meta: { timing: 'Recorded child start; handoff duration was not measured' } })
  }
  let promptTokens = 0
  let completionTokens = 0
  let cost = 0
  let costKnown = false
  let costMissing = false
  const explicitTools = new Set<string>()
  const lastResponse = new Map<string, number>()
  for (const event of index.events) {
    const detail = event.detail
    // Scoped lifecycle meters are cumulative observations, not additional model responses.
    if (detail.usageScope === undefined) {
      promptTokens += (detail.usage?.input ?? 0) + (detail.usage?.cacheRead ?? 0) + (detail.usage?.cacheWrite ?? 0)
      completionTokens += detail.usage?.output ?? 0
      if (detail.usdKnown === false) costMissing = true
      else if (typeof detail.costListUsd === 'number') { cost += detail.costListUsd; costKnown = true }
      else if (detail.usage && Object.values(detail.usage).some((value) => typeof value === 'number' && value > 0)) costMissing = true
    }
    const start = ms(event.at)
    const parentId = index.canonical(event.node)
    const response = detail.role === 'assistant' && Boolean(detail.publicText || detail.reasoning || detail.usage || detail.responseStatus)
    if (response) lastResponse.set(parentId, Math.max(lastResponse.get(parentId) ?? start, start))
    if (typeof detail.spanId === 'string') {
      const kind = event.kind.replace(/^trace-/, '').toLowerCase()
      const end = time(detail.end)
      const running = live && !Number.isFinite(end)
      const spanKind: FlowSpan['kind'] = ['llm', 'model'].includes(kind) ? 'model' : kind === 'tool' ? 'tool' : kind === 'waiting' ? 'waiting' : kind === 'handoff' ? 'handoff' : 'pipeline'
      const traceId = String(detail.traceId ?? event.node)
      spans.push({ id: `${traceId}:${detail.spanId}`, parentId: typeof detail.parentSpanId === 'string' ? `${traceId}:${detail.parentSpanId}` : parentId, kind: spanKind, name: event.label, startMs: offset(start), endMs: offset(Number.isFinite(end) ? Math.max(start, end) : running ? last : start), status: failed(detail.status) || detail.isError ? 'failed' : running ? 'running' : 'done' })
      if (spanKind === 'tool') explicitTools.add(toolKey(event.node, detail.spanId))
    } else if (response) {
      spans.push({ id: event.id, parentId, kind: 'model', name: event.label, startMs: offset(start), endMs: offset(start), approx: true, status: failed(detail.responseStatus) ? 'failed' : 'done', meta: { timing: 'Response timestamp; generation duration was not recorded' } })
    }
  }
  for (const [key, calls] of index.calls) {
    if (explicitTools.has(key)) continue
    for (let i = 0; i < calls.length; i++) {
      const { event, call } = calls[i]!
      const start = ms(event.at)
      const next = calls[i + 1] ? ms(calls[i + 1]!.event.at) : Infinity
      const result = (index.results.get(key) ?? []).find((candidate) => ms(candidate.at) >= start && ms(candidate.at) < next)
      const parentId = index.canonical(event.node)
      // A later assistant response proves this old capture gap is not the current in-flight call.
      const running = !result && runningNodes.has(parentId) && start >= (lastResponse.get(parentId) ?? start)
      spans.push({ id: `${event.id}:tool:${call.id}`, parentId, kind: 'tool', name: call.name, startMs: offset(start), endMs: offset(result ? ms(result.at) : running ? last : start), approx: !result || event.detail.atBasis === 'carried' || result.detail.atBasis === 'carried', status: result?.detail.isError ? 'failed' : running ? 'running' : result ? 'done' : undefined, ...(!result ? { meta: { timing: 'No matching tool result retained' } } : {}) })
    }
  }
  return { spans, totalMs: last - first, promptTokens, completionTokens, toolCalls: spans.filter((span) => span.kind === 'tool').length, ...(costKnown && !costMissing ? { costUsd: cost } : {}) }
}
