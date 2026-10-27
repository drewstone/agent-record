import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { agentParam, type TabProps } from './RunPage.js'
import { type Agent, clockOf, abbr, count, lat, type RunModel } from './model.js'
import { AgentCard, agentGroups, agentOptions, Bar, agentCost, StateDot, Icon, middle, Picker, TeamCard, useCard, useNarrow } from './ui.js'

type Box = { x: number; y: number; w: number; h: number; sm?: boolean; team?: string }
type Frame = { id: string; x: number; y: number; w: number; h: number; open: boolean }

/** A spawn tree, left to right; a lead with more than eight spawned agents draws them in one team frame that folds. */
function layout(m: RunModel, width: number, height: number, open: ReadonlySet<string>, narrow: boolean) {
  const teams = new Set(m.teams.map((t) => t.id))
  const NW = narrow ? Math.min(280, width - 32) : teams.size ? 216 : 272
  const NH = 58, GAP = 10, COL = NW + (teams.size ? 56 : 72), SMW = 210, SMH = 44, SMG = 8, HEAD = 48
  const pos = new Map<string, Box>()
  const frames: Frame[] = []
  const place = (a: Agent, depth: number, y: number): number => {
    const x = 24 + depth * COL
    if (a.children.length > 8 && teams.has(a.id)) {
      const fx = 24 + (depth + 1) * COL
      const cols = Math.max(1, Math.floor((width - fx - 48 + SMG) / (SMW + SMG)))
      const isOpen = open.has(a.id)
      const rows = Math.ceil(a.children.length / cols)
      const fh = isOpen ? HEAD + rows * (SMH + SMG) - SMG + 12 : HEAD
      frames.push({ id: a.id, x: fx, y, w: cols * (SMW + SMG) - SMG + 24, h: fh, open: isOpen })
      if (isOpen) a.children.forEach((c, i) => pos.set(c, { x: fx + 12 + (i % cols) * (SMW + SMG), y: y + HEAD + Math.floor(i / cols) * (SMH + SMG), w: SMW, h: SMH, sm: true, team: a.id }))
      pos.set(a.id, { x, y: y + HEAD / 2 - NH / 2 + 4, w: NW, h: NH })
      return Math.max(fh, NH) + 16
    }
    if (!a.children.length) { pos.set(a.id, { x, y, w: NW, h: NH }); return NH + GAP }
    let cy = y
    for (const c of a.children) cy += place(m.byId.get(c)!, depth + 1, cy)
    const used = cy - y - GAP
    const first = pos.get(a.children[0]!)!
    pos.set(a.id, { x, y: used > height - 48 ? first.y : y + Math.max(0, used / 2 - NH / 2), w: NW, h: NH })
    return Math.max(cy - y, NH + GAP)
  }
  if (narrow) {
    let y = 16
    for (const a of m.tree) { pos.set(a.id, { x: 12 + Math.min(a.depth, 4) * 20, y, w: NW - Math.min(a.depth, 4) * 20, h: NH }); y += NH + 8 }
  } else {
    let y = 24
    for (const a of m.agents.filter((x) => !x.parent)) y += place(a, 0, y)
  }
  const all = [...pos.values(), ...frames]
  const maxX = Math.max(0, ...all.map((p) => p.x + p.w)) + 24
  const maxY = Math.max(0, ...all.map((p) => p.y + p.h)) + 24
  const dx = narrow ? 0 : Math.max(0, (width - maxX) / 2)
  const dy = narrow ? 0 : Math.max(0, (height - maxY) / 2)
  for (const p of all) { p.x += dx; p.y += dy }
  return { pos, frames, W: Math.max(width, maxX + dx), H: Math.max(height, maxY + dy), over: maxY > height + 160 || maxX > width + 160 }
}

/**
 * Who spawned whom and what each cost: the spawn tree on the recessed canvas, with the selected agent's ancestors and
 * descendants in full ink and the rest faded. Nodes past a screen from the viewport are not in the document; a minimap
 * appears once the graph outgrows the canvas.
 */
export function Topology({ m, agent, selectAgent, route, doc }: TabProps) {
  const host = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const [size, setSize] = useState({ w: 1000, h: 700 })
  const [view, setView] = useState({ top: 0, left: 0 })
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(m.teams.length === 1 ? [m.teams[0]!.id] : []))
  const card = useCard()
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const r = new ResizeObserver(update)
    r.observe(el)
    return () => r.disconnect()
  }, [])
  const L = useMemo(() => layout(m, size.w, size.h, open, narrow), [m, size, open, narrow])
  const selected = agent ?? m.root?.id ?? null
  const { anc, desc } = useMemo(() => {
    const anc = new Set<string>(), desc = new Set<string>()
    for (let p = selected ? m.byId.get(selected)?.parent : null; p; p = m.byId.get(p)?.parent ?? null) anc.add(p)
    const walk = (id: string) => { for (const c of m.byId.get(id)?.children ?? []) { desc.add(c); walk(c) } }
    if (selected) walk(selected)
    return { anc, desc }
  }, [m, selected])
  const focus = selected !== null && selected !== m.root?.id
  const related = (id: string) => !focus || id === selected || anc.has(id) || desc.has(id)
  const center = (id: string) => {
    const p = L.pos.get(id)
    if (p && host.current) host.current.scrollTo({ left: p.x + p.w / 2 - size.w / 2, top: p.y + p.h / 2 - size.h / 2, behavior: 'smooth' })
  }
  useEffect(() => { if (selected) { const t = m.byId.get(selected)?.team; if (t && t !== selected && !open.has(t)) setOpen(new Set([...open, t])) } }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const right = (p: Box) => [p.x + p.w, p.y + p.h / 2] as const
  const left = (p: Box) => [p.x, p.y + p.h / 2] as const
  const edge = (from: Box, to: Box, hot: boolean, key: string) => {
    if (narrow) {
      const [x2, y2] = left(to)
      return <path key={key} d={`M${from.x + 16} ${from.y + from.h} V${y2 - 8} q0 8 8 8 H${x2}`} className={hot ? 'hot' : ''} />
    }
    const [x1, y1] = right(from), [x2, y2] = left(to), mx = (x1 + x2) / 2
    return <path key={key} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} className={hot ? 'hot' : focus ? 'fade' : ''} />
  }
  const edges: ReactNode[] = []
  for (const a of m.agents) {
    const p = L.pos.get(a.id), q = a.parent ? L.pos.get(a.parent) : null
    if (!p || !q || p.team) continue
    edges.push(edge(q, p, a.id === selected || a.parent === selected || (anc.has(a.id) && (anc.has(a.parent!) || a.parent === selected)), a.id))
  }
  for (const f of L.frames) { const lead = L.pos.get(f.id); if (lead) edges.push(edge(lead, { x: f.x, y: f.y, w: f.w, h: 48 }, f.id === selected || L.pos.get(selected ?? '')?.team === f.id, `f:${f.id}`)) }
  const margin = 400
  const visible = m.agents.filter((a) => { const p = L.pos.get(a.id); return p && p.y + p.h >= view.top - margin && p.y <= view.top + size.h + margin && p.x + p.w >= view.left - margin && p.x <= view.left + size.w + margin })
  const bounds = () => host.current?.getBoundingClientRect()
  const sel = selected ? m.byId.get(selected) ?? null : null
  return (
    <div className="rp-topo">
      <section className="rp-card" aria-label="Spawn tree">
        <div className="rp-hd">
          <div className="rp-legend">
            <span className="rp-key"><StateDot tone="ok" />Done</span><span className="rp-key"><StateDot tone="live" />Running</span><span className="rp-key"><StateDot tone="" />Stopped</span><span className="rp-key"><StateDot tone="none" />Never ran</span>
          </div>
          <span className="end">
            {m.teams.length > 0 && (
              <span className="rp-group" role="group" aria-label="Teams">
                <button type="button" className="rp-btn" onClick={() => setOpen(new Set(m.teams.map((t) => t.id)))}>Expand all</button>
                <button type="button" className="rp-btn" onClick={() => setOpen(new Set())}>Collapse all</button>
              </span>
            )}
            <Picker label="Go to agent" options={agentOptions(m)} groups={agentGroups(m)} value={selected} placeholder={`Search ${m.agents.length} agents`} width={340} style={{ width: 220 }}
              onChange={(id) => { if (id) { selectAgent(id); window.setTimeout(() => center(id), 60) } }}>
              <span className="dim">Go to agent</span>
            </Picker>
          </span>
        </div>
        <div className="rp-topo-wrap">
          <div className="rp-topo-canvas" ref={host} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}>
            <svg className="edges" width={L.W} height={L.H} aria-hidden="true">{edges}</svg>
            {L.frames.map((f) => {
              const team = m.teams.find((t) => t.id === f.id)!
              const members = team.members.map((id) => m.byId.get(id)!)
              const run = members.filter((a) => a.state.tone === 'live').length, done = members.filter((a) => a.state.tone === 'ok').length
              const fade = focus && !(f.id === selected || anc.has(f.id) || L.pos.get(selected ?? '')?.team === f.id)
              return (
                <div key={f.id} className={`rp-team${fade ? ' fade' : ''}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
                  <button type="button" className="rp-team-h" aria-expanded={f.open} onClick={() => setOpen((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}
                    onPointerEnter={(e) => card.show({ content: <TeamCard m={m} team={team} />, rect: e.currentTarget.getBoundingClientRect(), bounds: bounds(), vertical: true, wide: true })} onPointerLeave={() => card.hide()}>
                    <span className="cv"><Icon name="chevron" /></span><b>{team.label}</b><span className="ct">{members.length}</span>
                    <span className="st"><span className="mb"><i className="ok" style={{ width: `${(done / members.length) * 100}%` }} /><i className="live" style={{ width: `${(run / members.length) * 100}%` }} /></span>{run ? `${run} running · ` : ''}{abbr(members.reduce((t, a) => t + (a.tokens ?? 0), 0))}</span>
                  </button>
                </div>
              )
            })}
            {visible.map((a) => {
              const p = L.pos.get(a.id)!
              const cls = `rp-node${p.sm ? ' sm' : ''}${a.id === selected ? ' sel' : ''}${related(a.id) || (p.team && L.pos.get(selected ?? '')?.team === p.team) ? '' : ' fade'}${a.state.tone === 'none' ? ' ghost' : ''}`
              return (
                <button key={a.id} type="button" className={cls} style={{ left: p.x, top: p.y, width: p.w }} aria-pressed={a.id === selected}
                  onClick={() => selectAgent(a.id)}
                  onPointerEnter={(e) => card.show({ content: <AgentCard m={m} a={a} />, rect: e.currentTarget.getBoundingClientRect(), bounds: bounds(), vertical: true, wide: a.tools.length > 0 })}
                  onPointerLeave={() => card.hide()}
                  onFocus={(e) => card.show({ content: <AgentCard m={m} a={a} />, rect: e.currentTarget.getBoundingClientRect(), bounds: bounds(), vertical: true, wide: a.tools.length > 0 })}
                  onBlur={() => card.hide()}>
                  <span className="r1"><StateDot tone={a.state.tone} /><span className="nm" title={a.name}>{middle(p.sm && a.parent && a.name.startsWith(`${m.byId.get(a.parent)?.name}-`) ? a.name.slice((m.byId.get(a.parent)?.name.length ?? 0) + 1) : a.name.length <= (p.sm ? 20 : 30) ? a.name : a.short, p.sm ? 20 : 30)}</span><span className="dim">{p.sm ? abbr(a.tokens) : a.state.label}</span></span>
                  {!p.sm && <span className="r2">{a.tokens === null ? 'no usage recorded' : `${abbr(a.tokens)} tokens · ${count(a.steps.length)} steps${a.failedSteps ? ` · ${a.failedSteps} failed` : ''}`}</span>}
                </button>
              )
            })}
            <div style={{ position: 'absolute', left: 0, top: L.H - 1, width: L.W, height: 1 }} />
          </div>
          {L.over && !narrow && <Minimap m={m} L={L} view={view} size={size} selected={selected} onJump={(x, y) => host.current?.scrollTo({ left: x - size.w / 2, top: y - size.h / 2 })} />}
        </div>
      </section>
      {sel && <TopoInspector m={m} a={sel} onSelect={(id) => { selectAgent(id); window.setTimeout(() => center(id), 60) }} href={route.href('conversations', { agent: agentParam(doc.run.id, sel.id) })} />}
    </div>
  )
}

function Minimap({ m, L, view, size, selected, onJump }: { m: RunModel; L: ReturnType<typeof layout>; view: { top: number; left: number }; size: { w: number; h: number }; selected: string | null; onJump: (x: number, y: number) => void }) {
  const w = 184, k = w / L.W, h = Math.min(160, L.H * k)
  return (
    <div className="rp-mm" onClick={(e) => { const r = e.currentTarget.querySelector('svg')!.getBoundingClientRect(); onJump((e.clientX - r.left) / k, (e.clientY - r.top) / k) }}>
      <div className="mm-h"><span>Map</span><span>{m.agents.length} agents</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ height: h }} aria-hidden="true">
        {L.frames.map((f) => <rect key={f.id} x={f.x * k} y={f.y * k} width={f.w * k} height={f.h * k} rx="1.5" className="fr" />)}
        {[...L.pos].map(([id, p]) => <rect key={id} x={p.x * k} y={p.y * k} width={Math.max(1.5, p.w * k)} height={Math.max(1.5, p.h * k)} rx="1.5" className={id === selected ? 'sel' : m.byId.get(id)?.state.tone === 'live' ? 'live' : ''} />)}
        <rect x={view.left * k} y={view.top * k} width={size.w * k} height={size.h * k} rx="2" className="vp" />
      </svg>
    </div>
  )
}

function TopoInspector({ m, a, onSelect, href }: { m: RunModel; a: Agent; onSelect: (id: string) => void; href: string }) {
  const clock = clockOf(m.t0)
  const max = Math.max(1, ...a.tools.map((t) => t.calls))
  const parent = a.parent ? m.byId.get(a.parent) : null
  const rows: [string, number | null, number | null, number | null, number][] = [[a.model ?? 'model', a.latency.p50, a.latency.p90, a.latency.p99, a.modelCalls], ...a.tools.slice(0, 5).map((t) => [t.name, t.p50, t.p90, t.p99, t.calls] as [string, number | null, number | null, number | null, number])]
  return (
    <aside className="rp-card" aria-label={a.name}>
      <div className="rp-hd"><h2><StateDot tone={a.state.tone} />{a.name}</h2><span className="end"><span className={`rp-pill ${a.state.tone}`}>{a.state.label}</span></span></div>
      <div className="rp-scroll rp-tinsp">
        <dl className="rp-kv">
          <dt>Model</dt><dd>{[a.model, a.harness].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Spawned</dt><dd>{parent ? `by ${parent.name} · ` : ''}{a.start === null ? '—' : `${clock(Math.max(0, a.start))} UTC`}</dd>
          <dt>Ended</dt><dd>{a.state.tone === 'live' ? 'running' : a.end === null ? '—' : `${clock(a.end)} UTC`}</dd>
          <dt>Cost</dt><dd>{agentCost(a)}</dd>
        </dl>
        <div className="rp-stat3">
          <div><b>{abbr(a.tokens)}</b><span>tokens</span></div><div><b>{count(a.modelCalls)}</b><span>model calls</span></div><div><b>{count(a.toolCalls)}</b><span>tool calls</span></div>
          <div><b>{a.failedSteps}</b><span>failed steps</span></div><div><b>{a.restarts.length}</b><span>restarts</span></div><div><b>{a.commits ?? '—'}</b><span>commits</span></div>
        </div>
        {a.modelCalls > 0 && (
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
        <p><a className="rp-btn sm outline" href={href}>Conversation<Icon name="arrow" size={14} /></a></p>
      </div>
    </aside>
  )
}
