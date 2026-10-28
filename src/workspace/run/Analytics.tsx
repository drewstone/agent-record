import { type FocusEvent, type PointerEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SegmentedControl } from '@tangle-network/ui/primitives'
import type { TabProps } from './RunPage.js'
import { type Agent, clockOf, abbr, count, lat, mergeTools, percentile, type RunModel, elapsed, usd } from './model.js'
import { AgentCard, agentGroups, agentOptions, StateDot, Picker, useCard, useNarrow } from './ui.js'

/**
 * Where time, tokens and failures went. One multi-select agent picker scopes every chart; each chart keeps its numbers
 * beside its marks and opens a card with the full metric set on hover or focus. The two data hues are model and tool;
 * failure is the danger ink with a ✕, never colour alone.
 */
export function Analytics({ m }: TabProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const agents = useMemo(() => (chosen.size ? m.tree.filter((a) => chosen.has(a.id)) : m.tree), [m, chosen])
  const tools = useMemo(() => mergeTools(agents), [agents])
  const scope = chosen.size ? (chosen.size === 1 ? m.byId.get([...chosen][0]!)?.name : `${chosen.size} agents`) : 'All'
  return (
    <div className="rp-an">
      <div className="rp-an-f">
        <Picker label="Agents" multi options={agentOptions(m)} groups={agentGroups(m)} all={{ label: 'All agents', meta: String(m.agents.length) }} value={chosen} onChange={setChosen} width={360} placeholder={`Search ${m.agents.length} agents`} style={{ width: 280 }}>
          {chosen.size ? scope : `All ${m.agents.length} agents`}
        </Picker>
      </div>
      <Kpis m={m} agents={agents} tools={tools} />
      <div className="rp-an-g">
        <Heatmap m={m} agents={agents} tools={tools} />
        <PerMinute m={m} agents={agents} />
        <AgentsTable m={m} agents={agents} />
        <Latency m={m} agents={agents} tools={tools} />
        <Failures m={m} agents={agents} tools={tools} />
      </div>
    </div>
  )
}

function Kpis({ m, agents, tools }: { m: RunModel; agents: Agent[]; tools: ReturnType<typeof mergeTools> }) {
  const sum = (pick: (a: Agent) => number | null) => agents.reduce((t, a) => t + (pick(a) ?? 0), 0)
  const all = agents.length === m.agents.length
  const tokens = all && m.totals.tokens !== null ? m.totals.tokens : sum((a) => a.tokens)
  const by = agents.reduce((t, a) => (a.byClass ? { input: t.input + a.byClass.input, output: t.output + a.byClass.output, cacheRead: t.cacheRead + a.byClass.cacheRead } : t), { input: 0, output: 0, cacheRead: 0 })
  const model = sum((a) => a.modelCalls), tool = sum((a) => a.toolCalls), toolFail = sum((a) => a.toolFailures)
  const billed = agents.some((a) => a.billedUsd !== null) ? sum((a) => a.billedUsd) : null
  const list = agents.some((a) => a.listUsd !== null) ? sum((a) => a.listUsd) : null
  const items: [string, string][] = [
    [abbr(tokens), by.input + by.output + by.cacheRead ? `in ${abbr(by.input)} · out ${abbr(by.output)} · cached ${abbr(by.cacheRead)}` : 'tokens'],
    [count(model), 'model calls'],
    [count(tool), `tool calls · ${tools.length} tools`],
    [count(toolFail), `tool failures · ${tool ? ((toolFail / tool) * 100).toFixed(1) : '0'}%`],
    [count(sum((a) => a.retries)), 'retried steps'],
    [count(sum((a) => a.restarts.length)), 'restarts'],
    [elapsed(sum((a) => a.busy)), `busy of ${elapsed(m.duration)}`],
    [list !== null ? usd(list) : usd(billed), list !== null ? `list · ${usd(billed ?? 0)} billed` : 'billed'],
  ]
  return <section className="rp-card rp-kpis" aria-label="Totals">{items.map(([v, l]) => <div key={l}><b>{v}</b><span title={l}>{l}</span></div>)}</section>
}

// ----- Tool calls by agent and tool: a heatmap with ✕ failure counts, row totals and an "N more" column

const HM_NAME = 168, HM_COL = 76, HM_TOTAL = 88
/** The rows a card shows before "Show all": the page scrolls, no card scrolls inside (judges 10-27: four nested scrollers). */
const ROWS_SHOWN = 14
function ShowAll({ n, all, set }: { n: number; all: boolean; set: (all: boolean) => void }) {
  return n > ROWS_SHOWN ? <button type="button" className="rp-more-row" onClick={() => set(!all)}>{all ? `Show the first ${ROWS_SHOWN}` : `Show all ${n}`}</button> : null
}
/** An element's size, measured: a grid folds the columns it cannot hold, and a chart draws in its own pixels (no stretched text). */
function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    const r = new ResizeObserver(read)
    r.observe(el)
    read()
    return () => r.disconnect()
  }, [])
  return [ref, size] as const
}
function Heatmap({ m, agents, tools }: { m: RunModel; agents: Agent[]; tools: ReturnType<typeof mergeTools> }) {
  const [sort, setSort] = useState<'calls' | 'fails' | 'name'>('calls')
  const card = useCard()
  const narrow = useNarrow()
  const [wrap, { w: width }] = useSize()
  const [all, setAll] = useState(false)
  const rows = useMemo(() => {
    const withTools = agents.filter((a) => a.toolCalls > 0)
    const key = sort === 'calls' ? (a: Agent) => -a.toolCalls : sort === 'fails' ? (a: Agent) => -a.toolFailures * 1e6 - a.toolCalls : null
    return key ? [...withTools].sort((a, b) => key(a) - key(b)) : [...withTools].sort((a, b) => a.name.localeCompare(b.name))
  }, [agents, sort])
  const name = narrow ? 120 : HM_NAME
  // As many tool columns as the card holds beside the name and total columns; the rest fold into one "N more" column, so
  // no column is ever cut by the card's edge (25b showed 8 and a cut 9th at 1512 px; a phone holds none and folds them all).
  const room = Math.floor(((width || 1e4) - 32 - name - HM_TOTAL) / HM_COL)
  const fit = tools.length <= room ? tools.length : Math.max(0, room - 1)
  const cols = tools.slice(0, fit)
  const rest = tools.slice(fit)
  const max = Math.max(1, ...rows.flatMap((a) => a.tools.map((t) => t.calls)))
  const maxTotal = Math.max(1, ...rows.map((a) => a.toolCalls))
  const shade = (n: number) => (n ? `color-mix(in oklab, var(--rp-tool) ${Math.round(14 + 86 * Math.sqrt(n / max))}%, hsl(var(--hsl-card)))` : undefined)
  const ink = (n: number) => (n && Math.sqrt(n / max) > 0.55 ? 'on' : '')
  const grid = { gridTemplateColumns: `minmax(${name}px, 1.3fr) repeat(${cols.length + (rest.length ? 1 : 0)}, minmax(${narrow ? 64 : HM_COL}px, 1fr)) ${HM_TOTAL}px` }
  const cell = (a: Agent, t: { name: string; calls: number; failures: number; p50: number | null; p90: number | null; p99: number | null; ms: number } | null, label: string, target: Element) =>
    card.show({ rect: target.getBoundingClientRect(), wide: false, content: (
      <>
        <div className="rp-card-h"><div className="t"><StateDot tone={a.state.tone} /><span className="nm">{a.name}</span><span className="v">{label}</span></div><div className="s">{t ? `${count(t.calls)} calls · ${elapsed(t.ms)} in all` : 'no calls'}</div></div>
        {t && <div className="rp-card-cols"><section><dl>
          <dt>Calls</dt><dd>{count(t.calls)}</dd><dt>Failed</dt><dd>{t.failures ? <span className="f">{t.failures} ✕ · {((t.failures / t.calls) * 100).toFixed(0)}%</span> : '0'}</dd>
          <dt>p50 · p90 · p99</dt><dd>{lat(t.p50)} · {lat(t.p90)} · {lat(t.p99)}</dd><dt>Share of its tool calls</dt><dd>{((t.calls / Math.max(1, a.toolCalls)) * 100).toFixed(0)}%</dd>
        </dl></section></div>}
      </>
    ) })
  return (
    <section className="rp-card w7" aria-label="Tool calls by agent and tool">
      <div className="rp-hd sm"><h3>Tool calls by agent and tool<span className="ct">{rows.length} agents · {tools.length} tools</span></h3>
        <span className="end"><SegmentedControl aria-label="Sort" value={sort} onValueChange={setSort} options={[{ value: 'calls', label: 'By calls' }, { value: 'fails', label: 'By failures' }, { value: 'name', label: 'By name' }]} /></span></div>
      <div className="rp-chart">
        <div className="rp-hm-wrap" ref={wrap}>
          <div className="rp-hm" style={grid}>
            <span className="ch c0" />
            {cols.map((t) => <span key={t.name} className="ch" title={t.name}><span>{t.name.replace(/^agent-runtime-coordination_/, '').replaceAll('_', ' ')}</span></span>)}
            {rest.length > 0 && <span className="ch" title={rest.map((t) => t.name).join(', ')}><span>{cols.length ? `${rest.length} more` : `${rest.length} tools`}</span></span>}
            <span className="ch tot">Total</span>
            {(all ? rows : rows.slice(0, ROWS_SHOWN)).map((a) => {
              const has = new Map(a.tools.map((t) => [t.name, t]))
              const other = a.tools.filter((t) => !cols.some((c) => c.name === t.name))
              const otherCalls = other.reduce((s, t) => s + t.calls, 0), otherFails = other.reduce((s, t) => s + t.failures, 0)
              return [
                <span key={`${a.id}:n`} className="rh" title={a.name}><StateDot tone={a.state.tone} /><span className="nm">{a.name}</span></span>,
                ...cols.map((c) => {
                  const t = has.get(c.name)
                  const n = t?.calls ?? 0
                  return (
                    <span key={`${a.id}:${c.name}`} className={`c${n ? '' : ' z'} ${ink(n)}`} style={{ background: shade(n) }} tabIndex={n ? 0 : -1}
                      onPointerEnter={(e) => cell(a, t ?? null, c.name, e.currentTarget)} onPointerLeave={() => card.hide()} onFocus={(e) => cell(a, t ?? null, c.name, e.currentTarget)} onBlur={() => card.hide()}>
                      {n ? count(n) : ''}{t?.failures ? <span className="xf">✕{t.failures}</span> : null}
                    </span>
                  )
                }),
                ...(rest.length ? [<span key={`${a.id}:rest`} className={`c${otherCalls ? '' : ' z'} ${ink(otherCalls)}`} style={{ background: shade(otherCalls) }}>{otherCalls ? count(otherCalls) : ''}{otherFails ? <span className="xf">✕{otherFails}</span> : null}</span>] : []),
                <span key={`${a.id}:t`} className="tot"><b style={{ width: `${(a.toolCalls / maxTotal) * 56}px` }} />{count(a.toolCalls)}</span>,
              ]
            })}
          </div>
        </div>
        <ShowAll n={rows.length} all={all} set={setAll} />
        <div className="rp-hm-foot"><span className="ramp"><span>1</span><i /><span>{count(max)}</span></span><span><span className="x">✕</span> failed calls in the cell</span>{agents.length > rows.length && <span className="end">{agents.length - rows.length} agents made no tool calls</span>}</div>
      </div>
    </section>
  )
}

// ----- Calls (or metered tokens) over time, model and tool stacked, failures marked

const BINS = [60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000]
function PerMinute({ m, agents }: { m: RunModel; agents: Agent[] }) {
  const [measure, setMeasure] = useState<'calls' | 'tokens'>('calls')
  const card = useCard()
  const steps = useMemo(() => agents.flatMap((a) => a.steps.filter((s) => s.kind !== 'waiting')), [agents])
  const first = steps.length ? Math.min(...steps.map((s) => s.t)) : 0
  const last = steps.length ? Math.max(...steps.map((s) => s.t + s.d)) : 1
  const bin = BINS.find((b) => (last - first) / b <= 36) ?? 14_400_000
  // Bins sit on the wall clock (an hour bin starts at :00), so the axis reads 04:00, 08:00, never the run's 02:37, 06:37.
  const start = Math.floor((m.t0 + first) / bin) * bin - m.t0
  const n = Math.max(1, Math.ceil((last - start) / bin))
  const bins = useMemo(() => {
    const out = Array.from({ length: n }, () => ({ model: 0, tool: 0, failed: 0, tokens: 0 }))
    for (const s of steps) {
      const b = out[Math.min(n - 1, Math.floor((s.t - start) / bin))]!
      s.kind === 'model' ? b.model++ : b.tool++
      if (s.failed) b.failed++
      if (s.tokens) b.tokens += s.tokens.input + s.tokens.output + s.tokens.cacheRead
    }
    return out
  }, [steps, n, start, bin])
  // Only the three worst bins print their failure count; every failure is still drawn as the red base of its bar.
  const loudest = useMemo(() => new Set(bins.map((b, i) => [b.failed, i] as const).filter(([f]) => f > 0).sort((x, y) => y[0] - x[0]).slice(0, 3).map(([, i]) => i)), [bins])
  const value = (b: (typeof bins)[number]) => (measure === 'calls' ? b.model + b.tool : b.tokens)
  const peak = Math.max(1, ...bins.map(value))
  const [box, size] = useSize()
  const W = size.w || 600, H = size.h || 240, L = 40, B = 24, T = 18
  const bw = (W - L) / n
  // The scale tops out at the rounded maximum, so the top gridline is the plot's top edge, never above it.
  const nice = niceMax(peak)
  const y = (v: number) => H - B - (v / nice) * (H - B - T)
  const clock = clockOf(m.t0)
  const label = bin === 60_000 ? 'minute' : bin === 3_600_000 ? 'hour' : bin > 3_600_000 ? `${bin / 3_600_000} h` : `${bin / 60_000} min`
  // A tick every k bins, k chosen so the ticks land on round clock times (every 1, 2, 3, 4, 6 or 12 bins).
  const ticks = [1, 2, 3, 4, 6, 12, 24].find((k) => n / k <= 7) ?? Math.ceil(n / 6)
  const tickAt = (i: number) => Math.round((m.t0 + start + i * bin) / bin) % ticks === 0
  return (
    <section className="rp-card w5" aria-label={measure === 'calls' ? 'Calls over time' : 'Tokens over time'}>
      <div className="rp-hd sm"><h3>{measure === 'calls' ? `Calls per ${label}` : `Metered tokens per ${label}`}</h3>
        <span className="end"><SegmentedControl aria-label="Measure" value={measure} onValueChange={setMeasure} options={[{ value: 'calls', label: 'Calls' }, { value: 'tokens', label: 'Tokens' }]} /></span></div>
      <div className="rp-chart">
        <div className="rp-legend sm">{measure === 'calls' ? <><span className="rp-key"><i className="model" />Model call</span><span className="rp-key"><i className="tool" />Tool call</span><span className="rp-key"><i className="fail" />Failed</span></> : <span className="rp-key"><i className="model" />Tokens on calls that recorded them</span>}</div>
        <div className="rp-cpm-box" ref={box}><svg className="rp-cpm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${measure} per ${label}, peak ${count(peak)}`}>
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} className="grid" /><text x={L - 6} y={y(nice * f) + 4} textAnchor="end">{measure === 'calls' ? count(Math.round(nice * f)) : abbr(nice * f)}</text></g>)}
          {bins.map((b, i) => {
            const x = L + i * bw + 1, w = Math.max(1, bw - 2)
            const hm = measure === 'calls' ? (b.model / nice) * (H - B - T) : (b.tokens / nice) * (H - B - T)
            const ht = measure === 'calls' ? (b.tool / nice) * (H - B - T) : 0
            const hf = measure === 'calls' ? Math.min(hm + ht, (b.failed / nice) * (H - B - T)) : 0
            const show = (e: PointerEvent<SVGGElement> | FocusEvent<SVGGElement>) => card.show({ rect: e.currentTarget.getBoundingClientRect(), content: (
              <><div className="rp-card-h"><div className="t"><span className="nm">{clock(start + i * bin)}–{clock(start + (i + 1) * bin)} UTC</span></div></div>
                <div className="rp-card-cols"><section><dl><dt>Model calls</dt><dd>{count(b.model)}</dd><dt>Tool calls</dt><dd>{count(b.tool)}</dd><dt>Failed</dt><dd>{b.failed ? <span className="f">{b.failed} ✕</span> : '0'}</dd><dt>Metered tokens</dt><dd>{b.tokens ? abbr(b.tokens) : 'not recorded'}</dd></dl></section></div></>
            ) })
            return (
              <g key={i} tabIndex={value(b) ? 0 : -1} onPointerEnter={show} onPointerLeave={() => card.hide()} onFocus={show} onBlur={() => card.hide()}>
                <rect x={L + i * bw} y={T} width={bw} height={H - B - T} className="hit" />
                {hm > 0 && <rect x={x} y={H - B - hm} width={w} height={hm} rx={Math.min(2, w / 2)} className="model" />}
                {ht > 0 && <rect x={x} y={H - B - hm - ht - (hm > 0 ? 1.5 : 0)} width={w} height={ht} rx={Math.min(2, w / 2)} className="tool" />}
                {hf > 0 && <rect x={x} y={H - B - Math.max(1.5, hf)} width={w} height={Math.max(1.5, hf)} className="fail" />}
                {loudest.has(i) && measure === 'calls' && <text x={x + w / 2} y={H - B - hm - ht - 6} textAnchor="middle" className="xf">✕{b.failed}</text>}
                {tickAt(i) && <text x={x + w / 2} y={H - 6} textAnchor="middle">{clock(start + i * bin)}</text>}
              </g>
            )
          })}
        </svg></div>
      </div>
    </section>
  )
}
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= v) ?? v
}

// ----- the agents table: sortable, its rows rendered only in view

type SortKey = 'tokens' | 'model' | 'tool' | 'failed' | 'restarts' | 'spawns' | 'cost' | 'name'
function AgentsTable({ m, agents }: { m: RunModel; agents: Agent[] }) {
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'tokens', d: -1 })
  const card = useCard()
  const [all, setAll] = useState(false)
  const value = (a: Agent): number | string => ({ tokens: a.tokens ?? -1, model: a.modelCalls, tool: a.toolCalls, failed: a.failedSteps, restarts: a.restarts.length, spawns: a.children.length, cost: a.listUsd ?? a.billedUsd ?? -1, name: a.name })[sort.k]
  const rows = useMemo(() => [...agents].sort((a, b) => { const x = value(a), y = value(b); return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.d }), [agents, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxTok = Math.max(1, ...agents.map((a) => a.tokens ?? 0))
  // A count column shows only when some agent has one: 26a has no restarts, so no empty Restarts column takes the width.
  const counts = (['failed', 'restarts', 'spawns'] as const).filter((k) => agents.some((a) => (k === 'failed' ? a.failedSteps : k === 'restarts' ? a.restarts.length : a.children.length) > 0))
  const grid = { gridTemplateColumns: `minmax(96px, 1fr) 112px 52px 44px ${counts.map((k) => (k === 'restarts' ? '72px' : k === 'spawns' ? '64px' : '56px')).join(' ')} 64px` }
  const head = (k: SortKey, label: string, cls = '') => (
    <span key={k} role="columnheader" className={cls} aria-sort={sort.k === k ? (sort.d < 0 ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : k === 'name' ? 1 : -1 }))}>{label}{sort.k === k ? (sort.d < 0 ? ' ↓' : ' ↑') : ''}</button>
    </span>
  )
  return (
    <section className="rp-card w5" aria-label="Agents">
      <div className="rp-hd sm"><h3>Agents<span className="ct">{agents.length}</span></h3></div>
      <div className="rp-at-wrap" role="table" aria-label="Agents" aria-rowcount={rows.length}>
        <div className="rp-at th" role="row" style={grid}>{head('name', 'Agent')}{head('tokens', 'Tokens', 'tk')}{head('model', 'Model', 'r')}{head('tool', 'Tool', 'r')}{counts.map((k) => head(k, { failed: 'Failed', restarts: 'Restarts', spawns: 'Spawns' }[k], 'r'))}{head('cost', 'Cost', 'r')}</div>
        {(all ? rows : rows.slice(0, ROWS_SHOWN)).map((a) => (
          <div key={a.id} className="rp-at" role="row" tabIndex={0} style={grid}
            onPointerEnter={(e) => card.show({ content: <AgentCard m={m} a={a} />, rect: e.currentTarget.getBoundingClientRect(), wide: a.tools.length > 0 })} onPointerLeave={() => card.hide()}
            onFocus={(e) => card.show({ content: <AgentCard m={m} a={a} />, rect: e.currentTarget.getBoundingClientRect(), wide: a.tools.length > 0 })} onBlur={() => card.hide()}>
            <span className="nm" role="cell" title={a.name}>{a.name}</span>
            <span className="tk" role="cell"><b style={{ width: `${((a.tokens ?? 0) / maxTok) * 48}px` }} /><span>{abbr(a.tokens)}</span></span>
            <span className="r" role="cell">{count(a.modelCalls)}</span>
            <span className="r" role="cell">{count(a.toolCalls)}</span>
            {counts.map((k) => <span key={k} className="r" role="cell">{(k === 'failed' ? a.failedSteps : k === 'restarts' ? a.restarts.length : a.children.length) || ''}</span>)}
            <span className="r" role="cell">{a.listUsd !== null ? usd(a.listUsd) : a.billedUsd !== null ? usd(a.billedUsd) : '—'}</span>
          </div>
        ))}
      </div>
      <ShowAll n={rows.length} all={all} set={setAll} />
    </section>
  )
}

// ----- latency: p50 · p90 · p99 ranges on one log axis (models first), or histograms

function Latency({ m, agents, tools }: { m: RunModel; agents: Agent[]; tools: ReturnType<typeof mergeTools> }) {
  const [mode, setMode] = useState<'range' | 'dist'>('range')
  const card = useCard()
  const modelRows = useMemo(() => {
    const by = new Map<string, number[]>()
    for (const a of agents) for (const s of a.steps) if (s.kind === 'model' && s.latency !== null) { const k = s.model?.split('/').pop() ?? a.model ?? 'model'; (by.get(k) ?? by.set(k, []).get(k)!).push(s.latency) }
    return [...by].map(([name, v]) => ({ name, model: true, calls: v.length, values: v, p50: percentile(v, 50), p90: percentile(v, 90), p99: percentile(v, 99) }))
  }, [agents])
  const rows = [...modelRows, ...tools.filter((t) => t.durations.length).slice(0, 9).map((t) => ({ name: t.name, model: false, calls: t.calls, values: t.durations, p50: t.p50, p90: t.p90, p99: t.p99 }))]
  const all = rows.flatMap((r) => r.values).filter((v) => v > 0)
  const lo = 10, hi = Math.max(1000, ...all) * 1.2
  const x = (v: number) => (Math.log10(Math.max(lo, v)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))
  const decades = [10, 100, 1_000, 10_000, 100_000, 1_000_000].filter((d) => d <= hi)
  const show = (r: (typeof rows)[number], target: Element) => card.show({ rect: target.getBoundingClientRect(), content: (
    <><div className="rp-card-h"><div className="t"><i className={`rp-sw ${r.model ? 'model' : 'tool'}`} /><span className="nm">{r.name}</span><span className="v">{count(r.calls)} calls</span></div><div className="s">{r.model ? 'model call latency' : 'tool call duration'}</div></div>
      <div className="rp-card-cols"><section><dl><dt>p50</dt><dd>{lat(r.p50)}</dd><dt>p90</dt><dd>{lat(r.p90)}</dd><dt>p99</dt><dd>{lat(r.p99)}</dd><dt>Max</dt><dd>{lat(Math.max(...r.values))}</dd></dl></section></div></>
  ) })
  return (
    <section className="rp-card w4" aria-label="Latency">
      <div className="rp-hd sm"><h3>Latency</h3><span className="end"><SegmentedControl aria-label="Latency view" value={mode} onValueChange={setMode} options={[{ value: 'range', label: 'p50 · p90 · p99' }, { value: 'dist', label: 'Distribution' }]} /></span></div>
      <div className="rp-chart">
        {mode === 'range' ? (
          <div className="rp-lat">
            {rows.map((r) => (
              <div key={`${r.model}:${r.name}`} className="row" tabIndex={0} onPointerEnter={(e) => show(r, e.currentTarget)} onPointerLeave={() => card.hide()} onFocus={(e) => show(r, e.currentTarget)} onBlur={() => card.hide()}>
                <span className={`l${r.model ? ' model' : ''}`} title={r.name}>{r.name.replace(/^agent-runtime-coordination_/, '')}</span>
                <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
                  {decades.map((d) => <line key={d} x1={x(d) * 100} x2={x(d) * 100} y1="2" y2="20" className="grid" />)}
                  <line x1={x(r.p50 ?? lo) * 100} x2={x(r.p99 ?? lo) * 100} y1="11" y2="11" className={r.model ? 'model' : 'tool'} />
                </svg>
                <span className="dots" aria-hidden="true">
                  <i className={`p50 ${r.model ? 'model' : 'tool'}`} style={{ left: `${x(r.p50 ?? lo) * 100}%` }} />
                  <i className={`p90 ${r.model ? 'model' : 'tool'}`} style={{ left: `${x(r.p90 ?? lo) * 100}%` }} />
                  <i className={`p99 ${r.model ? 'model' : 'tool'}`} style={{ left: `${x(r.p99 ?? lo) * 100}%` }} />
                </span>
                <span className="v"><b>{lat(r.p50)}</b> · {lat(r.p90)} · {lat(r.p99)}</span>
              </div>
            ))}
            <div className="row axis"><span /><span className="ax">{decades.map((d) => <span key={d} style={{ left: `${x(d) * 100}%` }}>{lat(d)}</span>)}</span><span className="v dim">● p50 ○ p90 | p99</span></div>
          </div>
        ) : (
          <Histograms rows={[{ name: 'Model calls', model: true, values: modelRows.flatMap((r) => r.values) }, { name: 'Tool calls', model: false, values: tools.flatMap((t) => t.durations) }]} lo={lo} hi={hi} />
        )}
      </div>
    </section>
  )
}

function Histograms({ rows, lo, hi }: { rows: { name: string; model: boolean; values: number[] }[]; lo: number; hi: number }) {
  const card = useCard()
  const per = 4
  const edges: number[] = []
  for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e += 1 / per) edges.push(10 ** e)
  const W = 400, H = 96, L = 34
  const x = (v: number) => L + ((Math.log10(Math.max(lo, v)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - L)
  return (
    <div className="rp-hist">
      {rows.filter((r) => r.values.length).map((r) => {
        const bins = edges.slice(0, -1).map((e, i) => ({ from: e, to: edges[i + 1]!, n: r.values.filter((v) => v >= e && v < edges[i + 1]!).length }))
        const peak = Math.max(1, ...bins.map((b) => b.n))
        const marks: [string, number | null][] = [['p50', percentile(r.values, 50)], ['p90', percentile(r.values, 90)], ['p99', percentile(r.values, 99)]]
        return (
          <figure key={r.name}>
            <figcaption><i className={`rp-sw ${r.model ? 'model' : 'tool'}`} />{r.name}<span className="ct">{count(r.values.length)}</span></figcaption>
            <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`${r.name} by duration`}>
              <text x={L - 6} y={12} textAnchor="end">{peak}</text><text x={L - 6} y={H} textAnchor="end">0</text>
              <line x1={L} x2={W} y1={H} y2={H} className="grid" />
              {bins.map((b, i) => b.n ? (
                <rect key={i} x={x(b.from) + 1} width={Math.max(1, x(b.to) - x(b.from) - 2)} y={H - (b.n / peak) * (H - 8)} height={(b.n / peak) * (H - 8)} rx="1.5" className={r.model ? 'model' : 'tool'} tabIndex={0}
                  onPointerEnter={(e) => card.show({ rect: e.currentTarget.getBoundingClientRect(), content: <div className="rp-card-h"><div className="t"><span className="nm">{lat(b.from)}–{lat(b.to)}</span><span className="v">{b.n} calls</span></div><div className="s">{((b.n / r.values.length) * 100).toFixed(1)}% of {r.name.toLowerCase()}</div></div> })}
                  onPointerLeave={() => card.hide()} />
              ) : null)}
              {marks.map(([k, v]) => v !== null && <g key={k}><line x1={x(v)} x2={x(v)} y1={4} y2={H} className="rule" /><text x={x(v) + 3} y={12} className="rl">{k} {lat(v)}</text></g>)}
              {[10, 100, 1000, 10_000, 100_000].filter((d) => d <= hi).map((d) => <text key={d} x={x(d)} y={H + 14} textAnchor="middle">{lat(d)}</text>)}
            </svg>
          </figure>
        )
      })}
    </div>
  )
}

// ----- failed steps by tool and by agent, as shares

function Failures({ agents, tools }: { m: RunModel; agents: Agent[]; tools: ReturnType<typeof mergeTools> }) {
  const byTool = tools.filter((t) => t.failures).sort((a, b) => b.failures - a.failures || b.calls - a.calls)
  const byAgent = agents.filter((a) => a.failedSteps).sort((a, b) => b.failedSteps - a.failedSteps)
  const share = (label: ReactNode, failed: number, of: number, key: string, title: string) => (
    <div key={key} className="row" title={title}><span className="l">{label}</span><span className="track"><b style={{ width: `${(failed / Math.max(1, of)) * 100}%` }} /></span><span className="n">{failed} <small>of {count(of)}</small></span></div>
  )
  return (
    <section className="rp-card w3" aria-label="Failed steps">
      <div className="rp-hd sm"><h3>Failed steps</h3></div>
      <div className="rp-chart rp-fb">
        {!byTool.length && !byAgent.length ? <p className="ws-status">No step failed.</p> : (
          <>
            {byTool.length > 0 && <><h5>By tool · {byTool.length}</h5>{byTool.slice(0, 6).map((t) => share(t.name.replace(/^agent-runtime-coordination_/, ''), t.failures, t.calls, t.name, `${t.name}: ${t.failures} of ${t.calls} calls failed`))}</>}
            {byAgent.length > 0 && <><h5>By agent · {byAgent.length}</h5>{byAgent.slice(0, 6).map((a) => share(a.name, a.failedSteps, a.steps.length, a.id, `${a.name}: ${a.failedSteps} of ${a.steps.length} steps failed`))}</>}
          </>
        )}
      </div>
    </section>
  )
}
