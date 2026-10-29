import { toolGlyph } from '@tangle-network/charts/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentGraph, type AgentGraphNode } from '@tangle-network/sandbox-ui/workflows'
import { agentParam, type TabProps } from './RunPage.js'
import { type Agent, abbr, agentFacts, count, lat, type RunModel, stampOf } from './model.js'
import { Bar, agentCost, StateDot, Icon, Picker, agentOptions, agentGroups } from './ui.js'

/** The host's recorded identities, status and event clocks feed the shared graph. */
export function graphNodes(m: RunModel): AgentGraphNode[] {
  return m.agents.map(a => {
    const events = a.events
    return {
      id: a.id, label: a.name, status: a.status, model: a.model, harness: a.harness,
      costUsd: a.listUsd ?? a.billedUsd, tokens: a.tokens, commits: a.commits,
      facts: agentFacts(m, a),
      startedAt: Number.isFinite(Date.parse(a.node.start ?? '')) ? Date.parse(a.node.start!) : undefined, lastActivityAt: a.lastActivityAt, medianEventGapMs: a.medianEventGapMs, turn: a.node.turn, events,
      result: a.status === 'failed' ? a.node.failureReason || `Failure cause not recorded${events.at(-1)?.label ? `. Last event: ${events.at(-1)!.label}` : ''}` : a.commits ? `${a.commits} commits shipped` : a.state.label,
    }
  })
}

export function Topology({ m, agent, selectAgent, route, doc }: TabProps) {
  const nodes = useMemo(() => graphNodes(m), [m])
  const edges = useMemo(() => m.agents.flatMap(a => a.parent ? [{ from: a.parent, to: a.id, kind: 'spawn' as const }] : []), [m])
  const [selection, setSelection] = useState(0)
  const revealAgent = (id: string) => { selectAgent(id); setSelection(value => value + 1) }
  const selected = agent ?? m.root?.id ?? null
  const sel = selected ? m.byId.get(selected) ?? null : null
  return <div className="rp-topo">
    <section className="rp-card" aria-label="Spawn tree">
      <div className="rp-hd rp-hd-tools">
        <h2>Agents</h2>
        <span className="end"><Picker label="Go to agent" options={agentOptions(m)} groups={agentGroups(m)} value={selected} placeholder={`Search ${m.agents.length} agents`} width={340} onChange={id => { if (id) revealAgent(id) }}><span className="dim">Go to agent</span></Picker></span>
      </div>
      <AgentGraph renderEventIcon={event => toolGlyph(event.label)} nodes={nodes} edges={edges} selectedId={selected} onSelect={revealAgent} live={m.live} showLatestEvents={false} title="Agents" className="rp-topo-graph" />
    </section>
    {sel && <TopoInspector m={m} a={sel} reveal={route.params.has('agent')} selection={selection} onSelect={revealAgent} href={route.href('conversations', { agent: agentParam(doc.run.id, sel.id) })} />}
  </div>
}

function TopoInspector({ m, a, reveal, selection, onSelect, href }: { m: RunModel; a: Agent; reveal: boolean; selection: number; onSelect: (id: string) => void; href: string }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!reveal || !matchMedia('(max-width: 720px)').matches) return
    panel.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [a.id, reveal, selection])
  // A run longer than a day, or one that crosses a UTC midnight, names the day on every clock ("02:37 to 02:39" read as minutes).
  const days = m.duration > 20 * 3_600_000 || new Date(m.t0).toISOString().slice(0, 10) !== new Date(m.t0 + m.duration).toISOString().slice(0, 10)
  const clock = (value: string | null | undefined) => Number.isFinite(Date.parse(value ?? '')) ? stampOf(value!, days) : '—'
  const max = Math.max(1, ...a.tools.map((t) => t.calls))
  const parent = a.parent ? m.byId.get(a.parent) : null
  const rows: [string, number | null, number | null, number | null, number | null][] = [[a.model ?? 'model', a.latency.p50, a.latency.p90, a.latency.p99, a.modelCalls], ...a.tools.slice(0, 5).map((t) => [t.name, t.p50, t.p90, t.p99, t.calls] as [string, number | null, number | null, number | null, number | null])]
  return (
    <aside ref={panel} tabIndex={-1} className="rp-card" aria-label={a.name} style={{ scrollMarginTop: 'calc(var(--ar-sticky-top, 0px) + 44px)' }}>
      <div className="rp-hd"><h2><StateDot tone={a.state.tone} />{a.name}</h2><span className="end"><span className={`rp-pill ${a.state.tone}`}>{a.state.label}</span></span></div>
      <div className="rp-scroll rp-tinsp">
        <dl className="rp-kv">
          {a.status === 'failed' && <><dt>Failure</dt><dd className="f">{a.node.failureReason || 'Cause not recorded'}</dd></>}
          {a.status === 'needs-you' && <><dt>Request</dt><dd>{a.node.turn || 'Request not recorded'}</dd></>}
          <dt>Model</dt><dd>{[a.model, a.harness].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Spawned</dt><dd>{parent ? `by ${parent.name} · ` : ''}{clock(a.node.start)}</dd>
          <dt>Ended</dt><dd>{clock(a.node.end)}</dd>
          <dt>Cost</dt><dd>{agentCost(a)}</dd>
        </dl>
        <div className="rp-stat3">
          {([[abbr(a.tokens), 'tokens'], [count(a.modelCalls), a.modelCalls === 1 ? 'model call' : 'model calls'], [count(a.toolCalls), a.toolCalls === 1 ? 'tool call' : 'tool calls'],
            [String(a.failedSteps), a.failedSteps === 1 ? 'failed step' : 'failed steps'], [String(a.restarts.length), a.restarts.length === 1 ? 'restart' : 'restarts'], [a.commits === null ? '—' : String(a.commits), a.commits === 1 ? 'commit' : 'commits']] as const).map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}
        </div>
        {(a.modelCalls ?? 0) > 0 && (
          <>
            <h5 className="rp-subh">Latency</h5>
            <table className="rp-lt"><thead><tr><th /><th>calls</th><th>p50</th><th>p90</th><th>p99</th></tr></thead>
              <tbody>{rows.map(([n, p50, p90, p99, c]) => <tr key={n}><td title={n}>{n}</td><td>{count(c)}</td><td>{lat(p50)}</td><td>{lat(p90)}</td><td>{lat(p99)}</td></tr>)}</tbody></table>
          </>
        )}
        {a.tools.length > 0 && (
          <>
            <h5 className="rp-subh">Tool calls</h5>
            <div className="rp-tbars four">{a.tools.slice(0, 8).map((t) => <div key={t.name} className="row"><span className="l" title={t.name}>{t.name}</span><Bar ok={t.calls - t.failures} failed={t.failures} max={max} /><span className="n">{count(t.calls)}</span><span className="n f">{t.failures ? `${t.failures} ✕` : ''}</span></div>)}</div>
          </>
        )}
        {a.children.length > 0 && (
          <>
            <h5 className="rp-subh">Spawned · {a.children.length}</h5>
            <div className="rp-chips">{a.children.slice(0, 14).map((id) => { const c = m.byId.get(id)!; return <button key={id} type="button" className="rp-chip" onClick={() => onSelect(id)}><StateDot tone={c.state.tone} />{c.name}</button> })}{a.children.length > 14 && <span className="rp-chip dim">{a.children.length - 14} more</span>}</div>
          </>
        )}
        <p><a className="rp-btn sm framed" href={href}>Conversation<Icon name="arrow" size={14} /></a></p>
      </div>
    </aside>
  )
}
