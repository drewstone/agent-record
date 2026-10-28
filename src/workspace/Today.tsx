import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { PageHeader, SegmentedControl } from '@tangle-network/ui/primitives'
import type { OverviewAttention, OverviewDocument, OverviewPlayWeek, OverviewRun } from '../overview-model.js'
import { useDocument } from './data.js'
import { shortRun } from './play-standing.js'
import type { HostView, ViewBar } from './view.js'
import { Icon, Picker } from './run/ui.js'

/**
 * Today answers three questions, in order (Drew 2026-10-26: "decide what Drew should see first"): what needs you, what
 * moved since you last looked, and how far each play is from its target, with its trend. Everything else is a link.
 */
type Play = { play: string; title: string; view: HostView }
type Group = 'running' | 'stopped' | 'solved'
const groupOf = (p: Play, live: boolean): Group => (p.view.status.key === 'solved' ? 'solved' : live || p.view.status.key === 'live' ? 'running' : 'stopped')
const playHref = (play: string) => `/play/${encodeURIComponent(play)}`
const runHref = (run: string) => `/run/${encodeURIComponent(run)}`
const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '—')
const ago = (iso: string | null | undefined, now: number) => {
  if (!iso) return ''
  const m = Math.max(0, (now - Date.parse(iso)) / 60_000)
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const VISIT = 'discovery.today.visit'

/** The viewer's mark: their last visit (kept in this browser only), else a day. */
function useMark(now: number) {
  const [last] = useState<string | null>(() => { try { return window.localStorage.getItem(VISIT) } catch { return null } })
  useEffect(() => { try { window.localStorage.setItem(VISIT, new Date().toISOString()) } catch { /* private window: no visit kept */ } }, [])
  const recent = last && now - Date.parse(last) < 7 * 86_400_000 && now - Date.parse(last) > 60_000 ? last : null
  const [choice, setChoice] = useState<'visit' | 'day' | 'week'>(recent ? 'visit' : 'day')
  const at = choice === 'visit' && recent ? Date.parse(recent) : now - (choice === 'week' ? 7 : 1) * 86_400_000
  return { at, choice, setChoice, last: recent }
}

/** A measured value in its unit's words: 1,436/s, 88.7 ms, 7.1 GiB, 530 KiB. */
export function measure(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return '—'
  const n = (v: number, d = v < 10 ? 2 : v < 100 ? 1 : 0) => v.toLocaleString('en-US', { maximumFractionDigits: d })
  if (unit === 'B' || unit === 'KiB') {
    const bytes = unit === 'KiB' ? value * 1024 : value
    const k = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    const i = Math.min(k.length - 1, Math.max(0, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024))))
    return `${n(bytes / 1024 ** i, 1)} ${k[i]}`
  }
  if (unit === 'cycles/s') return `${n(value, 0)}/s`
  if (unit === 'ms') return `${n(value, 1)} ms`
  return `${n(value)} ${unit}`
}
const target = (bar: ViewBar) => {
  const t = bar.target
  if (!t) return ''
  if (t.approx) return `≈ ${measure(t.approx, bar.unit)}`
  if (t.min && t.max) return `${measure(t.min, bar.unit)}–${measure(t.max, bar.unit)}`
  return t.min ? `≥ ${measure(t.min, bar.unit)}` : t.max ? `≤ ${measure(t.max, bar.unit)}` : ''
}
/** How far from its target: `5,014× below`, `6.8× over`, `on target`. */
const distance = (bar: ViewBar) => (!bar.ratio || bar.ratio.side === 'met' ? 'on target' : `${bar.ratio.x >= 100 ? Math.round(bar.ratio.x).toLocaleString('en-US') : bar.ratio.x.toFixed(1)}× ${bar.direction === 'down' ? 'over' : 'below'}`)
const DECADES = 4

type Chip = { text: string; tone: 'ok' | 'neutral' }
type Move = { at: string; play: string; title: string; text: ReactNode; badge?: Chip }

/** A metric's move over the trend's window as a chip: better in the success ink, worse in plain grey (amber is for what needs
 * you, judges 10-27), and no chip under 1%. */
function changeChip(bar: ViewBar): Chip | null {
  const change = bar.change && bar.change.from ? ((bar.change.to - bar.change.from) / bar.change.from) * 100 : null
  if (change === null || Math.abs(change) < 1) return null
  const better = bar.direction === 'down' ? change < 0 : change > 0
  return { text: `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(0)}% ${better ? 'better' : 'worse'}`, tone: better ? 'ok' : 'neutral' }
}
/** A play's 7-day move: its primary metric's change, else the steps its newest check gained or lost since the window began. */
function weekChip(p: Play, primary: ViewBar | undefined): Chip | null {
  if (primary) { const chip = changeChip(primary); if (chip) return chip }
  const passed = p.view.trend?.passed.filter((v): v is number => v !== null) ?? []
  const delta = passed.length > 1 ? passed[passed.length - 1]! - passed[0]! : 0
  return delta ? { text: `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} step${Math.abs(delta) === 1 ? '' : 's'}`, tone: delta > 0 ? 'ok' : 'neutral' } : null
}

/** What moved since the mark: checks with their steps, metric moves, runs started, and new holds. */
function moves(doc: OverviewDocument, plays: Play[], mark: number): Move[] {
  const out: Move[] = []
  const after = (iso: string | null | undefined) => Boolean(iso && Date.parse(iso) > mark)
  for (const p of plays) {
    const series = p.view.trend?.series ?? []
    series.forEach((s, i) => {
      if (!after(s.at)) return
      const prev = series[i - 1]
      const delta = prev ? s.passed - prev.passed : 0
      out.push({ at: s.at, play: p.play, title: p.title, text: <><b>{s.release}</b>{s.runId ? ` of run ${shortRun(p.play, s.runId)}` : ''} checked: <b>{s.passed}/{p.view.trend!.total}</b> steps</>, ...(delta ? { badge: { text: `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} step${Math.abs(delta) === 1 ? '' : 's'}`, tone: delta > 0 ? 'ok' : 'neutral' } } : {}) })
    })
    for (const bar of p.view.bars ?? []) {
      if (!bar.latest || !after(bar.latest.at)) continue
      const chip = changeChip(bar)
      out.push({ at: bar.latest.at!, play: p.play, title: p.title, text: <><b>{bar.label}</b> {measure(bar.latest.value, bar.unit)}{bar.latest.release ? ` at ${bar.latest.release}` : ''} · {distance(bar)}</>, ...(chip ? { badge: chip } : {}) })
    }
    const since = p.view.blocker?.since
    if (p.view.blocker && after(since)) out.push({ at: since!, play: p.play, title: p.title, text: <>{p.view.blocker.kind === 'stopped' ? 'Stopped' : 'Held'}: {clip((p.view.blocker.sentence ?? p.view.blocker.text).replace(/^(?:Stopped|Held) by [\w ]+: /, ''), 12)}</> })
  }
  for (const r of doc.now ?? []) if (after(r.startedAt)) out.push({ at: r.startedAt!, play: r.play, title: r.title, text: <>Run <a href={runHref(r.runId)}><b>{shortRun(r.play, r.runId)}</b></a> started{r.agents ? ` · ${r.agents} agents` : ''}</> })
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}
/** Moves under their play, plays in the order of their newest move. */
function byPlay(list: Move[]) {
  const groups = new Map<string, { play: string; title: string; moves: Move[] }>()
  for (const m of list) {
    const g = groups.get(m.play) ?? { play: m.play, title: m.title, moves: [] }
    g.moves.push(m)
    groups.set(m.play, g)
  }
  return [...groups.values()]
}
/** Page text: a host's sentence cut to its words, without host paths or key identifiers. */
const scrub = (text: string) => text.replace(/\/(home|mnt|Users)\/\S+/g, '').replace(/\bkey_[A-Za-z0-9]+\b\s*·?\s*/g, '').replace(/\s{2,}/g, ' ').trim()
const clip = (text: string, words = 14) => { const w = scrub(text).split(/\s+/); return w.length > words ? `${w.slice(0, words).join(' ')}…` : w.join(' ') }

export function TodayPage({ api }: { api: string }) {
  const doc = useDocument<OverviewDocument>(`${api}/overview`, 60_000, true)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">Today is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Reading what needs you…</p>
  return <TodayView doc={doc.data} />
}

function TodayView({ doc }: { doc: OverviewDocument }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const mark = useMark(now)
  const plays = (doc.plays ?? []) as Play[]
  const live = useMemo(() => new Map<string, OverviewRun[]>(plays.map((p) => [p.play, (doc.now ?? []).filter((r) => r.play === p.play)])), [doc, plays])
  const week = useMemo(() => new Map<string, OverviewPlayWeek>((doc.week ?? []).map((w) => [w.play, w])), [doc])
  const needs = (doc.attention ?? []).filter((a) => a.needsYou || a.tone === 'crit' || a.tone === 'warn')
  const mine = needs.filter((a) => a.needsYou || !a.owner || a.owner === 'The operator')
  const others = needs.length - mine.length
  const moved = useMemo(() => moves(doc, plays, mark.at), [doc, plays, mark.at])
  const agentsLive = (doc.now ?? []).reduce((t, r) => t + (r.agents ?? 0), 0)
  const running = plays.filter((p) => groupOf(p, (live.get(p.play)?.length ?? 0) > 0) === 'running').length
  const markWords = mark.choice === 'visit' ? `your last visit, ${hhmm(new Date(mark.at).toISOString())} UTC` : mark.choice === 'week' ? '7 days ago' : '24 hours ago'
  return (
    <div className="rp td2" data-mode="today">
      <PageHeader className="rp-head" title="Today"
        description={
          <Picker label="Since" value={mark.choice} onChange={(value) => value && mark.setChoice(value as 'visit' | 'day' | 'week')} width={260} placeholder="Show changes since"
            options={[...(mark.last ? [{ id: 'visit', label: 'Your last visit', meta: `${hhmm(mark.last)} UTC` }] : []), { id: 'day', label: 'The last 24 hours' }, { id: 'week', label: 'The last 7 days' }]}>
            <span className="dim">Since </span>{markWords}
          </Picker>
        }
        actions={<ul className="rp-stats"><li><b>{running}</b> {running === 1 ? 'play' : 'plays'} running</li><li><b>{agentsLive}</b> {agentsLive === 1 ? 'agent' : 'agents'} live</li></ul>} />
      <div className="td2-top">
        <section className="rp-card" aria-label="Needs you">
          <div className="rp-hd"><h2>Needs you<span className="ct">{mine.length}</span></h2></div>
          <ul className="td2-needs rp-scroll">
            {mine.length ? mine.map((item, i) => <Need key={i} item={item} />) : <li className="td2-none"><Icon name="check" />Nothing needs you.</li>}
          </ul>
          {others > 0 && <div className="td2-foot"><span>{others} more for other owners</span><a className="rp-link" href="/fleet">Fleet <Icon name="arrow" size={14} /></a></div>}
        </section>
        <section className="rp-card" aria-label={`Moved since ${markWords}`}>
          <div className="rp-hd"><h2>Moved since {mark.choice === 'visit' ? `${hhmm(new Date(mark.at).toISOString())} UTC` : markWords}<span className="ct">{moved.length}</span></h2></div>
          {/* Grouped by play: the play is named once, its changes under it on one shared grid (time, change, delta). */}
          <div className="td2-moves rp-scroll">
            {moved.length ? byPlay(moved.slice(0, 60)).map((g) => (
              <section key={g.play}>
                <h3><a href={playHref(g.play)}>{g.title}</a><span className="ct">{g.moves.length}</span></h3>
                <ol>{g.moves.map((m, i) => <li key={i}><time>{hhmm(m.at)}</time><span className="tx">{m.text}</span>{m.badge && <span><span className={`td2-badge ${m.badge.tone}`}>{m.badge.text}</span></span>}</li>)}</ol>
              </section>
            )) : <p className="td2-none">Nothing moved since {markWords}.</p>}
          </div>
        </section>
      </div>
      <Board plays={plays} live={live} week={week} now={now} />
    </div>
  )
}

function Need({ item }: { item: OverviewAttention }) {
  const body = <><Icon name="alert" className={item.tone === 'crit' ? 'f' : 'warn'} /><span><b>{item.text}</b>{(item.next || item.detail) && <span className="sub">{scrub([item.next, item.detail].filter(Boolean).join(' · '))}</span>}</span>{item.href && <Icon name="chevron" className="go" />}</>
  return <li>{item.href ? <a href={item.href.startsWith('#') ? `/${item.href}` : item.href}>{body}</a> : <div>{body}</div>}</li>
}

const SHOWN = 8
function Board({ plays, live, week, now }: { plays: Play[]; live: Map<string, OverviewRun[]>; week: Map<string, OverviewPlayWeek>; now: number }) {
  const [filter, setFilter] = useState<'all' | Group>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<Group, boolean>>({ running: true, stopped: true, solved: true })
  const [more, setMore] = useState<Record<Group, boolean>>({ running: false, stopped: false, solved: false })
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const by: Record<Group, Play[]> = { running: [], stopped: [], solved: [] }
    for (const p of plays) if (!q || `${p.title} ${p.play}`.toLowerCase().includes(q)) by[groupOf(p, (live.get(p.play)?.length ?? 0) > 0)].push(p)
    for (const g of Object.values(by)) g.sort((a, b) => (week.get(b.play)?.lastActiveAt ?? '').localeCompare(week.get(a.play)?.lastActiveAt ?? ''))
    return by
  }, [plays, live, week, query])
  const counts = { all: plays.length, running: grouped.running.length, stopped: grouped.stopped.length, solved: grouped.solved.length }
  return (
    <section className="rp-card td2-board" aria-label="Plays">
      <div className="rp-hd">
        <h2>Plays<span className="ct">{plays.length}</span></h2>
        <SegmentedControl aria-label="Show" value={filter} onValueChange={setFilter}
          options={(['all', 'running', 'stopped', 'solved'] as const).map((v) => ({ value: v, label: v === 'all' ? 'All' : v[0]!.toUpperCase() + v.slice(1), adornment: <span className="ct">{counts[v]}</span> }))} />
        <span className="end"><label className="rp-field td2-find"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a play" aria-label="Find a play" /></label></span>
      </div>
      {/* The axis is one grid with the rows: its ticks sit over the same column as every row's distance bar. */}
      <div className="td2-grid">
        <div className="td2-cols" aria-hidden="true">
          <span>Play</span><span>Steps</span><span>Metric</span>
          <span className="axis">{Array.from({ length: DECADES }, (_, i) => <i key={i} style={{ left: `${(i / DECADES) * 100}%` }}>{(10 ** (DECADES - i)).toLocaleString('en-US')}×</i>)}<i style={{ left: '100%' }} className="t">target</i></span>
          <span>Now</span><span>7 days</span><span className="r">Live</span>
        </div>
        {(['running', 'stopped', 'solved'] as const).filter((g) => (filter === 'all' || filter === g) && grouped[g].length).map((g) => {
          const rows = grouped[g]
          const shown = more[g] || query ? rows : rows.slice(0, SHOWN)
          return (
            <div key={g} className="td2-group">
              <button type="button" className="td2-gh" aria-expanded={open[g]} onClick={() => setOpen({ ...open, [g]: !open[g] })}><Icon name="chevron" />{g[0]!.toUpperCase() + g.slice(1)}<span className="ct">{rows.length}</span></button>
              {open[g] && shown.map((p) => <PlayRow key={p.play} p={p} group={g} runs={live.get(p.play) ?? []} week={week.get(p.play)} now={now} />)}
              {open[g] && shown.length < rows.length && <button type="button" className="rp-more-row" onClick={() => setMore({ ...more, [g]: true })}>Show {rows.length - shown.length} more</button>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * One play on one line (Drew 10-26: "how far each play is from its target, with its trend", for 20 plays at a glance): its name
 * and state, steps passed, its first metric's distance on the shared log axis, the 7-day move and its live agents. Its other
 * metrics open under it on request; a stopped play's reason is the line's tooltip, not a paragraph.
 */
function PlayRow({ p, group, runs, week, now }: { p: Play; group: Group; runs: OverviewRun[]; week?: OverviewPlayWeek; now: number }) {
  const [open, setOpen] = useState(false)
  const trend = p.view.trend
  const newest = trend?.newest
  const agents = runs.reduce((t, r) => t + (r.agents ?? 0), 0)
  const bars = (p.view.bars ?? []).filter((b) => b.latest)
  const [primary, ...rest] = bars
  const chip = weekChip(p, primary)
  const why = p.view.blocker ? scrub(p.view.blocker.sentence ?? p.view.blocker.text) : undefined
  const sub = group === 'stopped' && p.view.blocker ? `${p.view.blocker.kind === 'stopped' ? 'Stopped' : 'Held'} ${hhmm(p.view.blocker.since)}`
    : group === 'running' && p.view.blocker ? 'Held'
      : week ? `${week.runCount ?? week.runs.length} ${(week.runCount ?? week.runs.length) === 1 ? 'run' : 'runs'} this week${week.lostHours >= 0.1 ? ` · ${week.lostHours.toFixed(week.lostHours < 10 ? 1 : 0)} h lost` : ''}`
        : p.view.status.label
  return (
    <div className={`td2-row ${group}`}>
      <div className="nm">
        <a href={playHref(p.play)}>{p.title}</a>
        <span className="sub" title={why}>{sub}</span>
      </div>
      <div className="steps">
        {trend && newest ? <span className="st" title={`${newest.release}, ${ago(newest.at, now)}${newest.passed < trend.best ? `; best ${trend.best}/${trend.total}` : ''}`}><b>{newest.passed}/{trend.total}</b><Meter passed={newest.passed} total={trend.total} /></span> : <span className="dim">—</span>}
      </div>
      {primary ? <MetricCells bar={primary} more={rest.length ? <button type="button" className="td2-mx" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${rest.length} more ${rest.length === 1 ? 'metric' : 'metrics'}`} onClick={() => setOpen(!open)}>{open ? '−' : `+${rest.length}`}</button> : null} />
        : <><span className="ml dim">{why ? <span title={why}>{clip(why, 8)}</span> : 'No metric'}</span><span /><span /></>}
      <div className="wk">{chip ? <span className={`td2-badge ${chip.tone}`}>{chip.text}</span> : <span className="dim">—</span>}</div>
      <div className="live">
        {runs.length ? <span className="lv" title={runs.map((r) => shortRun(p.play, r.runId)).join(', ')}><span className="rp-dot live" /><a href={runHref(runs[0]!.runId)}><b>{agents || runs.length}</b> {agents ? (agents === 1 ? 'agent' : 'agents') : runs.length === 1 ? 'run' : 'runs'}</a></span>
          : <span className="sub">{week?.lastActiveAt ? ago(week.lastActiveAt, now) : ''}</span>}
      </div>
      {open && rest.map((b) => <div key={b.metric} className="td2-extra"><MetricCells bar={b} /></div>)}
    </div>
  )
}

function Meter({ passed, total }: { passed: number; total: number }) {
  return <span className="td2-meter" aria-hidden="true">{Array.from({ length: Math.min(total, 12) }, (_, i) => <i key={i} className={i < passed ? 'on' : ''} />)}</span>
}

/** One metric as three cells of the board's grid: its name, its distance on the shared axis (10,000× away at the left, the
 * target at the right), and its value with the distance in words. */
function MetricCells({ bar, more }: { bar: ViewBar; more?: ReactNode }) {
  const met = !bar.ratio || bar.ratio.side === 'met'
  const d = met ? 0 : Math.min(DECADES, Math.log10(Math.max(1, bar.ratio!.x)))
  const title = `${bar.label}: ${measure(bar.latest?.value, bar.unit)}${bar.latest?.release ? ` at ${bar.latest.release}` : ''}; target ${target(bar)}`
  return (
    <>
      <span className="ml"><span title={title}>{bar.label} {bar.direction === 'down' ? '↓' : '↑'}</span>{more}</span>
      <span className="ax" title={title}><i className="track" />{!met && <i className="dist" style={{ left: `${(1 - d / DECADES) * 100}%` }} />}<i className="tick" /></span>
      <span className="mv" title={`target ${target(bar)}`}><b>{measure(bar.latest?.value, bar.unit)}</b> <span className={met ? 'ok' : 'dim'}>{distance(bar)}</span></span>
    </>
  )
}
