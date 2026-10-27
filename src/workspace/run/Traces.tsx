import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { SegmentedControl } from '@tangle-network/ui/primitives'
import { agentParam, type TabProps } from './RunPage.js'
import { clockSecondsOf, abbr, count, lat, offset } from './model.js'
import { agentGroups, agentOptions, agentCost, nameFit, Picker, useRows } from './ui.js'

type Kind = 'all' | 'model' | 'tool' | 'failed'
const ROW = 34

/** Every recorded span as one table, filtered by agent and kind, with the selected span's JSON beside it. */
export function Traces({ m, doc, agent, route }: TabProps) {
  const asked = route.params.get('agent')
  const who = asked ? agent : null
  const [kind, setKind] = useState<Kind>('all')
  const [at, setAt] = useState(0)
  const base = useMemo(() => m.steps.filter((s) => !who || s.agent.id === who), [m, who])
  const counts = useMemo(() => ({ all: base.length, model: base.filter((s) => s.step.kind === 'model').length, tool: base.filter((s) => s.step.kind === 'tool').length, failed: base.filter((s) => s.step.failed).length }), [base])
  const rows = useMemo(() => base.filter(({ step }) => kind === 'all' || (kind === 'failed' ? step.failed : step.kind === kind)), [base, kind])
  const longest = useMemo(() => Math.log10(Math.max(10, ...rows.map((r) => r.step.d))), [rows])
  const table = useRef<HTMLDivElement>(null)
  const win = useRows(table, rows.length, ROW, 8)
  useEffect(() => { setAt(0); if (table.current) table.current.scrollTop = 0 }, [kind, who])
  const clock = clockSecondsOf(m.t0)
  const pick = (i: number, focus = false) => {
    const next = Math.max(0, Math.min(rows.length - 1, i))
    setAt(next)
    const el = table.current
    if (el && focus) {
      const top = next * ROW
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW + 36 > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW + 36 - el.clientHeight
      requestAnimationFrame(() => el.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus())
    }
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pick(at + (e.key === 'ArrowDown' ? 1 : -1), true) }
  }
  const row = rows[at]
  const options = agentOptions(m, (a) => a.steps.length > 0, (a) => `${count(a.steps.length)} steps`)
  return (
    <section className="rp-card rp-traces" aria-label="Traces">
      <div className="rp-hd" style={{ paddingLeft: 8 }}>
        <Picker label="Agent" options={options} groups={agentGroups(m)} all={{ label: 'All agents', meta: `${count(m.totals.steps)} steps` }} value={who} width={340} placeholder={`Search ${options.length} agents`} style={{ width: 260 }}
          onChange={(id) => route.go('traces', { agent: id ? agentParam(doc.run.id, id) : null })}>
          {who ? m.byId.get(who)?.name : 'All agents'}
        </Picker>
        <SegmentedControl aria-label="Kind" value={kind} onValueChange={setKind}
          options={(['all', 'model', 'tool', 'failed'] as const).map((v) => ({ value: v, label: v === 'all' ? 'All' : v[0]!.toUpperCase() + v.slice(1), adornment: <span className="ct">{count(counts[v])}</span> }))} />
      </div>
      <div className="rp-trw">
        <div className="rp-tbl" ref={table} role="grid" aria-label="Spans" aria-rowcount={rows.length} onKeyDown={keys}>
          <div className="rp-tr th" role="row"><span role="columnheader">Start (UTC)</span><span role="columnheader">Offset</span><span role="columnheader">Agent</span><span role="columnheader">Kind</span><span role="columnheader">Name</span><span role="columnheader" className="r">Duration</span><span role="columnheader">Status</span></div>
          <div style={{ height: win.before }} />
          {rows.slice(win.first, win.last).map(({ agent: a, step: s }, k) => {
            const i = win.first + k
            return (
              <div key={i} data-i={i} className="rp-tr" role="row" aria-selected={i === at} tabIndex={i === at ? 0 : -1} onClick={() => pick(i)}>
                <span className="m">{clock(s.t)}</span>
                <span className="m muted">{offset(s.t)}</span>
                <span title={a.name}>{nameFit(a, 30)}</span>
                <span className="kind"><i className={s.kind} />{s.kind}</span>
                <span className="m nm" title={s.kind === 'tool' ? `${s.tool}${s.target ? ` ${s.target}` : ''}` : undefined}>{s.kind === 'model' ? (s.model?.split('/').pop() ?? a.model ?? 'model') : s.kind === 'tool' ? <>{s.tool}{s.target && <span className="muted"> {s.target}</span>}</> : <span className="muted">waiting on a spawned agent</span>}</span>
                <span className="m r dur"><b style={{ width: Math.max(2, (Math.log10(Math.max(s.d, 1)) / longest) * 56) }} />{lat(s.d)}</span>
                <span>{s.failed ? <span className="f">✕ failed</span> : <span className="dim">ok</span>}</span>
              </div>
            )
          })}
          <div style={{ height: win.after }} />
        </div>
        <aside className="rp-trd" aria-label="Span">
          <div className="rp-trd-h">Span</div>
          <div className="rp-scroll">
            {row ? (
              <>
                <pre className="rp-json">{JSON.stringify({
                  run: doc.run.id, agent: row.agent.name, agentId: row.agent.id, kind: row.step.kind,
                  ...(row.step.kind === 'tool' ? { tool: row.step.tool } : row.step.kind === 'model' ? { model: row.step.model ?? row.agent.node.model } : {}),
                  ...(row.step.target ? { target: row.step.target } : {}),
                  startedAt: new Date(m.t0 + row.step.t).toISOString(), durationMs: row.step.d, failed: row.step.failed,
                  ...(row.step.latency !== null ? { latencyMs: row.step.latency } : {}),
                  tokens: row.step.tokens, ...(row.step.usd !== null ? { billedUsd: row.step.usd } : {}),
                }, null, 2)}</pre>
                <h5 className="rp-subh">{row.agent.name} · whole run</h5>
                <dl className="rp-kv">
                  <dt>Tokens</dt><dd>{abbr(row.agent.tokens)}{row.agent.byClass ? ` · ${abbr(row.agent.byClass.input)} in · ${abbr(row.agent.byClass.output)} out · ${abbr(row.agent.byClass.cacheRead)} cached` : ''}</dd>
                  <dt>Cost</dt><dd>{agentCost(row.agent)}</dd>
                  <dt>Model calls</dt><dd>{count(row.agent.modelCalls)} · p50 {lat(row.agent.latency.p50)} · p99 {lat(row.agent.latency.p99)}</dd>
                  <dt>Tool calls</dt><dd>{count(row.agent.toolCalls)} · {row.agent.toolFailures} failed</dd>
                  <dt>Restarts</dt><dd>{row.agent.restarts.length}</dd>
                </dl>
              </>
            ) : <p className="ws-status">No span matches.</p>}
          </div>
        </aside>
      </div>
    </section>
  )
}
