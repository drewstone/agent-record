import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FlowMarker, FlowOutcome, FlowSpan, FlowTrace } from '@tangle-network/charts'
import { FlowWaterfall } from '@tangle-network/charts/react'
import { agentParam, type TabProps } from './RunPage.js'
import { type Agent, clockOf, abbr, agentFacts, count, lat, type RunModel, elapsed } from './model.js'
import { Bar, agentCost, StateDot, Icon } from './ui.js'

/** Each state tone as the waterfall draws it: the same hue and shape as the page's own StateDot. */
const OUTCOME: Record<Agent['state']['tone'], (label: string) => FlowOutcome> = {
  live: (label) => ({ tone: 'live', label }),
  waiting: label => ({ tone: 'neutral', label, ring: true }),
  'needs-you': label => ({ tone: 'warn', label }),
  ok: (label) => ({ tone: 'ok', label }),
  done: (label) => ({ tone: 'ok', label, ring: true }),
  fail: (label) => ({ tone: 'failed', label }),
  none: (label) => ({ tone: 'neutral', label, ring: true }),
  '': (label) => ({ tone: 'neutral', label, ring: true }),
}

/**
 * Who did what, when: the shared waterfall (charts FlowWaterfall), one lane per agent with its model and tool calls as
 * child steps, so the hover card shows the agent's tokens in · out · cached, model latency, cost, tool calls by tool, failed
 * and retried steps. An agent the reader picked shows its whole-run numbers below; the page's default root does not (round 28).
 */
export function flowTrace(m: RunModel): FlowTrace {
  const root = m.root?.model ?? null
  const spans: FlowSpan[] = []
  for (const a of m.agents) {
    if (a.start === null) continue
    const running = a.status === 'running' || a.status === 'waiting' || a.status === 'needs-you'
    const end = running ? m.duration : Math.max(a.start, a.end ?? a.last ?? a.start)
    spans.push({
      id: a.id,
      ...(a.parent ? { parentId: a.parent } : {}),
      kind: 'pipeline',
      name: a.name,
      ...(a.model && a.model !== root ? { detail: a.model } : {}),
      startMs: Math.max(0, a.start),
      endMs: end,
      status: a.status === 'succeeded' ? 'done' : a.status,
      // The lane's dot is the agent's state in the words and marks Topology and Overview use (model.ts stateOf).
      outcome: OUTCOME[a.state.tone](a.state.label),
      activityAt: a.lastActivityAt === undefined ? [] : [a.lastActivityAt - m.t0],
      medianEventGapMs: a.medianEventGapMs,
      ...(a.listUsd !== null ? { costUsd: a.listUsd, costBound: a.node.usage?.listComplete === false ? 'lower' as const : undefined } : a.billedUsd !== null ? { costUsd: a.billedUsd } : {}),
      ...(a.byClass ? { promptTokens: a.byClass.input + a.byClass.cacheRead, completionTokens: a.byClass.output, cachedTokens: a.byClass.cacheRead } : {}),
      marks: a.restarts.map((at) => ({ at, kind: 'restart', label: `Restarted ${clockOf(m.t0)(at)} UTC` })),
      facts: [
        ...(a.node.failureReason ? [{ label: 'Failure', value: a.node.failureReason }] : []),
        { label: 'Model', value: a.model ?? 'Not recorded' },
        ...agentFacts(m, a),
        ...(a.harness ? [{ label: 'Harness', value: a.harness }] : []),
      ],
    })
    a.steps.forEach((s, i) => {
      spans.push({
        id: `${a.id}#${i}`,
        parentId: a.id,
        kind: s.kind,
        name: s.kind === 'model' ? (s.model ? (s.model.split('/').pop() ?? 'model call') : 'model call') : s.kind === 'tool' ? (s.tool ?? 'tool') : 'waiting',
        ...(s.target ? { detail: s.target } : {}),
        startMs: Math.max(0, s.t),
        endMs: Math.max(0, s.t + s.d),
        status: s.failed ? 'failed' : 'done',
        ...(s.tokens ? { promptTokens: s.tokens.input + s.tokens.cacheRead, completionTokens: s.tokens.output, cachedTokens: s.tokens.cacheRead } : {}),
        ...(s.usd !== null ? { costUsd: s.usd } : {}),
      })
    })
  }
  const by = m.totals.byClass
  return {
    spans,
    totalMs: m.duration,
    ...(by ? { promptTokens: by.input + by.cacheRead, completionTokens: by.output } : {}),
    ...(m.totals.listUsd !== null ? { costUsd: m.totals.listUsd, costBasis: 'list' as const } : {}),
    ...(m.totals.billedUsd !== null ? { billedUsd: m.totals.billedUsd } : {}),
    ...(m.totals.model !== null ? { modelCalls: m.totals.model } : {}),
    ...(m.totals.tool !== null ? { toolCalls: m.totals.tool } : {}),
    errors: m.totals.failed,
    pauses: m.pauses.map((p) => ({ startMs: p.from, endMs: p.to, label: `No agent turn ${elapsed(p.to - p.from)}`, detail: p.reason })),
  }
}

export function TimelineTab({ m, agent, selectAgent, route, doc }: TabProps) {
  const trace = useMemo(() => flowTrace(m), [m])
  const markers = useMemo((): FlowMarker[] => m.releases.filter((r, i, all) => r.taggedAt && Date.parse(r.taggedAt) >= m.t0 && (i === all.length - 1 || r.passed !== all[i - 1]?.passed)).map((r) => ({
    at: Date.parse(r.taggedAt!) - m.t0,
    label: `${r.release}${r.total ? ` ${r.passed ?? 0}/${r.total}` : ''}`,
    kind: 'release',
    tone: r.total && r.passed === r.total ? 'ok' : 'neutral',
  })), [m])
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(480)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observe = new ResizeObserver(() => setHeight(el.clientHeight))
    observe.observe(el)
    return () => observe.disconnect()
  }, [])
  // The rows take what the waterfall's own header, legend, controls and axis leave: measured, so the card meets the bottom
  // of the screen (22a stopped 80 px short with a guessed 230).
  const [chrome, setChrome] = useState(196)
  useLayoutEffect(() => {
    const root = box.current?.querySelector<HTMLElement>('.fw-root'), rows = root?.querySelector<HTMLElement>('.fw-scroller')
    if (!root || !rows) return
    const next = root.offsetHeight - rows.offsetHeight
    if (next > 0 && Math.abs(next - chrome) > 1) setChrome(next)
  })
  const picked = route.params.get('agent') ? agent : null, selected = picked ? m.byId.get(picked) ?? null : null
  return (
    <div className="rp-tl">
      <section className="rp-tl-chart" aria-label="Agents over time" ref={box}>
          <FlowWaterfall
            trace={trace}
            live={m.live}
            startedAt={Number.isFinite(Date.parse(doc.run.startedAt ?? '')) || m.agents.some(a => Number.isFinite(Date.parse(a.node.start ?? ''))) ? m.t0 : undefined}
            label="Agents over time"
            defaultView="agents"
            summary={false}
            markers={markers}
            agentFill="muted"
            maxHeight={Math.max(200, height - chrome - 2)}
            selectedId={picked ?? undefined}
            onDeselect={() => selectAgent(null)}
            onSelect={(s) => { const id = s.kind === 'pipeline' ? s.id : s.parentId; if (id && m.byId.has(id)) selectAgent(id) }}
          />
      </section>
      {selected && <AgentInspector m={m} a={selected} href={(tab) => route.href(tab, { agent: agentParam(doc.run.id, selected.id) })} />}
    </div>
  )
}

/** The selected agent's whole run in four columns: tokens, model calls, tool calls, reliability. */
export function AgentInspector({ m, a, href }: { m: RunModel; a: Agent; href: (tab: 'conversations' | 'traces') => string }) {
  const clock = clockOf(m.t0)
  const max = Math.max(1, ...a.tools.map((t) => t.calls))
  return (
    <section className="rp-card rp-insp" aria-label={`${a.name}: whole run`}>
      <div className="rp-hd sm">
        <h2><StateDot tone={a.state.tone} />{a.name}</h2>
        <span className={`rp-pill ${a.state.tone}`}>{a.state.label}</span>
        <span className="muted ph-hide">{[a.model, a.harness].filter(Boolean).join(' · ')}</span>
        <span className="end">
          <a className="rp-btn sm" href={href('conversations')}>Conversation<Icon name="arrow" size={14} /></a>
          <a className="rp-btn sm ph-hide" href={href('traces')}>Traces<Icon name="arrow" size={14} /></a>
        </span>
      </div>
      <div className="rp-ig">
        <div>
          <h4>Tokens</h4>
          <div className="big">{a.tokens === null ? '—' : abbr(a.tokens)}</div>
          <dl>
            {a.byClass ? <><dt>In</dt><dd>{abbr(a.byClass.input)}</dd><dt>Out</dt><dd>{abbr(a.byClass.output)}</dd><dt>Cached</dt><dd>{abbr(a.byClass.cacheRead)}</dd></> : <><dt>In · out split</dt><dd className="dim">not recorded</dd></>}
            <dt>Cost</dt><dd>{agentCost(a)}</dd>
          </dl>
        </div>
        <div>
          <h4>Model calls</h4>
          <div className="big">{count(a.modelCalls)}</div>
          <dl><dt>p50</dt><dd>{lat(a.latency.p50)}</dd><dt>p90</dt><dd>{lat(a.latency.p90)}</dd><dt>p99</dt><dd>{lat(a.latency.p99)}</dd><dt>Busy</dt><dd>{elapsed(a.busy)}</dd></dl>
        </div>
        <div>
          <h4>Tool calls</h4>
          <div className="big">{count(a.toolCalls)}{a.toolFailures ? <small className="f"> {a.toolFailures} failed</small> : null}</div>
          {a.tools.length ? (
            <div className="rp-tbars">
              {a.tools.slice(0, 4).map((t) => (
                <div key={t.name} className="row"><span className="l" title={t.name}>{t.name}</span><Bar ok={t.calls - t.failures} failed={t.failures} max={max} /><span className="n">{count(t.calls)}</span></div>
              ))}
            </div>
          ) : <span className="dim">{a.toolCalls === null ? 'Tool calls not recorded' : 'No tool calls'}</span>}
        </div>
        <div>
          <h4>Reliability</h4>
          <div className="big">{a.failedSteps} <small>failed steps</small></div>
          <dl>
            <dt>Retried steps</dt><dd>{a.retries}</dd>
            <dt>Restarts</dt><dd>{a.restarts.length}</dd>
            <dt>Spawned · commits</dt><dd>{a.children.length} · {a.commits ?? '—'}</dd>
            <dt>Active</dt><dd>{a.first === null ? 'never' : `${clock(a.first)}–${a.state.tone === 'live' ? 'now' : clock(a.last ?? a.first)}`}</dd>
          </dl>
        </div>
      </div>
    </section>
  )
}
