import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@tangle-network/ui/primitives'
import { shortRun } from '../play-standing.js'
import { goalText } from '../plain-words.js'
import { agentParam, type TabProps } from './RunPage.js'
import { type Agent, type CheckDoc, checkVerdict, clockOf, abbr, count, finished, type RunModel, elapsed, stampOf } from './model.js'
import { AgentCard, StateDot, Icon, useHoverTarget } from './ui.js'

/**
 * The first clause of a host message, without the program prefixes, host paths and commit hashes
 * (`bridgeExecutor: …: opencode: Free usage exceeded`). A cut clause ends on a word and one ellipsis, never `,…`.
 */
export function clause(text: string | null | undefined, words = Infinity): string {
  if (!text) return ''
  let t = text.replace(/\/(home|mnt|Users|tmp|private)\/\S+/g, '').replace(/:?\s*\b[0-9a-f]{10,40}\b/g, '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^(?:[\w-]+(?: [\w-]+){0,3}: )+(?=\S)/, (prefix) => (prefix.split(': ').length > 2 ? '' : prefix))
  t = t.split(/(?<=[.;])\s|;\s|, the |, starting /)[0] ?? t
  const cut = t.split(' ')
  return cut.length > words ? `${cut.slice(0, words).join(' ').replace(/[.;,:]+$/, '')}…` : t.replace(/[.;,:]$/, '')
}

/** Busy intervals of every agent, merged: when anything was working. */
function workIntervals(m: RunModel): [number, number][] {
  const spans = m.steps.filter(({ step }) => step.kind !== 'waiting').map(({ step }) => [step.t, step.t + step.d] as [number, number]).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [a, b] of spans) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 30_000) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** How many agents worked in each of `n` equal slices of the run: the whole-run strip's bar heights. */
function concurrency(m: RunModel, n: number) {
  const slice = Math.max(1, m.duration) / n
  const sets = Array.from({ length: n }, () => new Set<string>())
  for (const { agent, step } of m.steps) {
    if (step.kind === 'waiting') continue
    for (let i = Math.max(0, Math.floor(step.t / slice)); i <= Math.min(n - 1, Math.floor((step.t + step.d) / slice)); i++) sets[i].add(agent.id)
  }
  return sets.map((s) => s.size)
}

export function Overview(props: TabProps) {
  const { m, doc, play, route } = props
  const view = doc.view
  const run = doc.run as typeof doc.run & { check?: CheckDoc; ending?: { at?: string | null; reason?: string | null; sentence?: string | null } }
  const execution = doc.execution as unknown as { failedAttempts?: number; lastAttempt?: { at?: string; error?: string | null } | null } | undefined
  const newer = (play?.runs ?? []).filter((r) => r.id !== doc.run.id && r.startedAt && doc.run.startedAt && r.startedAt > doc.run.startedAt).sort((a, b) => (a.startedAt! < b.startedAt! ? -1 : 1))[0]
  const work = useMemo(() => workIntervals(m), [m])
  // A run that crosses a UTC midnight names the day on its clocks, so its end never reads as its start.
  const days = new Date(m.t0).toISOString().slice(0, 10) !== new Date(m.t0 + m.duration).toISOString().slice(0, 10)
  const working = work.reduce((t, [a, b]) => t + (b - a), 0)
  const best = m.best
  const solved = best && best.passed !== null && best.passed !== undefined && best.total && best.passed === best.total
  const status = view?.status.label ?? doc.run.state
  const verdict = m.live
    ? `Running for ${elapsed(m.duration)}${best ? `; best release ${best.release} passed ${best.passed}/${best.total} steps` : ', no release checked yet'}.`
    : solved ? `Solved in ${elapsed(m.duration)}: ${best!.release} passed every step.`
      : `${status} after ${elapsed(m.duration)}${best ? `; best release ${best.release} passed ${best.passed ?? 0}/${best.total ?? '?'} steps` : ' with no release checked'}.`
  const why = clause(run.ending?.reason ?? view?.blocker?.why ?? view?.blocker?.sentence, 26)
  const failed = execution?.failedAttempts ?? 0
  const lede = [why && `${why}.`, failed && m.totals.lastStep !== null ? `Agents worked for ${elapsed(working)}; ${failed} later tries failed${execution?.lastAttempt?.error ? `, the last on “${clause(execution.lastAttempt.error, 8)}”` : ''}.` : ''].filter(Boolean).join(' ')
  // When it ran, on one line under the verdict (the milestone strip repeated the header and the verdict, judges 10-27).
  const ended = m.live ? null : run.ending?.at ?? doc.run.settledAt ?? null
  const span = [doc.run.startedAt ? stampOf(doc.run.startedAt, days).replace(' UTC', '') : null, m.live ? 'now' : ended ? stampOf(ended, days) : null].filter(Boolean).join(' → ')
  const meta = [span, `${m.agents.length} agents${m.root?.model ? ` on ${m.root.model}` : ''}`, m.live ? `${m.agents.filter((a) => a.state.tone === 'live').length} working now` : newer ? `continued in run ${shortRun(doc.run.play, newer.id)}` : null].filter(Boolean).join(' · ')
  return (
    <div className="rp-ov">
      <section className="rp-card rp-vd" aria-label="Verdict">
        <div className="rp-vd-top">
          <div>
            <h2 className="rp-verdict">{verdict}</h2>
            {lede && <p className="rp-lede">{lede}</p>}
            <p className="rp-vd-meta">{meta}</p>
          </div>
          <div className="rp-vd-act">
            {/* Every verdict has a next step: follow a live run, open the run that continued it, read its best release, or its files. */}
            {m.live ? <a className="rp-btn primary" href={route.href('timeline')}>Watch the timeline<Icon name="arrow" /></a>
              : newer ? <a className="rp-btn primary" href={`/run/${encodeURIComponent(newer.id)}`}>Open run {shortRun(doc.run.play, newer.id)}<Icon name="arrow" /></a>
                : best ? <a className="rp-btn primary" href={route.href('checks')}>Review {best.release}<Icon name="arrow" /></a>
                  : <a className="rp-btn primary" href={route.href('files')}>Open the files<Icon name="arrow" /></a>}
            {(m.live || newer || best) && <a className="rp-btn framed" href={route.href('files')}>Files</a>}
          </div>
        </div>
      </section>
      <Summary {...props} />
      <div className="rp-ov-b">
        <TimeCard m={m} working={working} failed={failed} />
        <AgentsCard {...props} />
      </div>
    </div>
  )
}

function Summary({ m, doc, route }: TabProps) {
  const check = (doc.run as unknown as { check?: CheckDoc }).check
  // The checker the Checks tab names: the current one, else the first recorded.
  const checker = check?.checkerNames?.find((c) => c.current) ?? check?.checkerNames?.[0]
  const goal = goalText(doc.input?.objective)
  const pages = (doc.findings?.items ?? []).filter((item) => item.path)
  const branches = m.agents.filter((a) => a.node.hasCode).length
  const commits = m.agents.reduce((t, a) => t + (a.commits ?? 0), 0)
  const best = m.best
  const verdict = checkVerdict(check)
  const ran = check?.counts?.checks ? `${checker ? `Checker ${checker.label}` : 'The checker'} ran ${count(check.counts.checks)} times` : 'No check has run'
  return (
    <section className="rp-card rp-sum" aria-label="Summary">
      <div>
        <h3>Goal</h3>
        <div className="goal">{clause(goal) || 'Not recorded'}</div>
        {goal && (
          <Popover>
            <PopoverTrigger asChild><button type="button" className="rp-link">Read the goal</button></PopoverTrigger>
            <PopoverContent className="rp-pop wide" align="start"><div className="ph"><b>Goal</b><span>as pressed</span></div><div className="rp-pop-goal">{goal}</div></PopoverContent>
          </Popover>
        )}
      </div>
      <div>
        <h3>Check</h3>
        <div className="v"><StateDot tone={verdict.tone} />{verdict.word}</div>
        <div className="sub">{verdict.note ? `${verdict.note}.` : `${ran}.`}</div>
        <a className="rp-link" href={route.href('checks')}>See the checks</a>
      </div>
      <div>
        <h3>Best release</h3>
        <div className="v">{best ? `${best.release}${best.total ? ` · ${best.passed ?? 0}/${best.total}` : ''}` : 'None'}</div>
        <div className="sub">{best ? (best.sentence ? clause(best.sentence, 14) : `${m.releases.length} releases checked`) : m.releases.length ? `${m.releases.length} releases, none scored` : `${count(commits)} commits, none tagged`}</div>
      </div>
      <div>
        <h3>Work kept</h3>
        <div className="v">{count(pages.length)} pages · {count(branches)} branches</div>
        <div className="files">
          {pages.slice(0, 3).map((item, _, shown) => (
            <a key={item.path} href={route.href('files', { file: `page:${item.path}` })} title={item.path}><Icon name="file" size={14} /><span>{tellApart(item.path!, shown.map((p) => p.path!))}</span></a>
          ))}
          {pages.length > 3 && <a href={route.href('files')}><span>{pages.length - 3} more</span></a>}
        </div>
      </div>
    </section>
  )
}

/** A path's file name, with as many parent folders as it takes to tell it from the other paths shown ("state.md" three times read as one file). */
function tellApart(path: string, shown: string[]) {
  const parts = path.split('/')
  const tail = (p: string, n: number) => p.split('/').slice(-n).join('/')
  let n = 1
  while (n < parts.length && shown.some((p) => p !== path && tail(p, n) === tail(path, n))) n++
  return tail(path, n)
}

function TimeCard({ m, working, failed }: { m: RunModel; working: number; failed: number }) {
  const conc = useMemo(() => concurrency(m, 96), [m])
  const peak = Math.max(1, ...conc)
  const X = (t: number) => `${Math.max(0, Math.min(100, (t / Math.max(1, m.duration)) * 100))}%`
  const hours = m.duration > 3_600_000 ? Math.floor(m.duration / 3_600_000) : 0
  const days = new Date(m.t0).toISOString().slice(0, 10) !== new Date(m.t0 + m.duration).toISOString().slice(0, 10)
  // Hour ticks clear the end clocks, which are wider when they name the day.
  const clear = m.duration * (days ? 0.16 : 0.08)
  const step = hours <= 10 ? 1 : Math.ceil(hours / 8), ticks = hours ? Array.from({ length: hours }, (_, i) => i + 1).filter((h) => h % step === 0 && h * 3_600_000 >= clear && (h + step) * 3_600_000 <= m.duration && h * 3_600_000 <= m.duration - clear) : []
  // Only agents that restarted, and agents restarted on the same schedule (the same minutes) as one row: 26a drew six identical
  // rows of nine evenly spaced marks (judges 10-27). A run where none restarted shows no restart section at all.
  const restarters = useMemo(() => {
    const by = new Map<string, Agent[]>()
    for (const a of m.tree) if (a.restarts.length) { const key = a.restarts.map((t) => Math.round(t / 60_000)).join(','); by.set(key, [...(by.get(key) ?? []), a]) }
    return [...by.values()].sort((x, y) => y[0]!.restarts.length - x[0]!.restarts.length || y.length - x.length).slice(0, 10)
  }, [m])
  const clock = (t: number) => (days ? stampOf(new Date(m.t0 + t).toISOString(), true).replace(' UTC', '') : clockOf(m.t0)(t))
  return (
    <section className="rp-card" aria-label="Where the time went">
      <div className="rp-hd sm">
        <h2>Where the {elapsed(m.duration)} went</h2>
        <span className="end rp-keys">
          <span className="rp-key"><i className="work" /><b>{elapsed(working)}</b> agents working</span>
          <span className="rp-key"><i className="hatch" /><b>{elapsed(Math.max(0, m.duration - working))}</b> idle</span>
          {failed > 0 && <span className="rp-key"><span className="x">✕</span><b>{failed}</b> tries failed</span>}
        </span>
      </div>
      <div className="rp-twrap">
        <div className="rp-tg">
          <span className="nm h">Agents at once</span>
          <div className="rp-strip" role="img" aria-label={`Agents working at once over the run, peak ${peak}; they worked ${elapsed(working)} of ${elapsed(m.duration)}`}>
            {conc.map((n, i) => <i key={i} className={n ? undefined : 'idle'} title={`${clock((i * m.duration) / conc.length)}: ${n} working`} style={{ left: `${(i * 100) / conc.length}%`, width: `${100 / conc.length}%`, height: n ? `${Math.max(10, (n / peak) * 100)}%` : undefined }} />)}
          </div>
          <span className="ct">peak {peak}</span>
          <span />
          <div className="rp-strip-ax">
            <span className="first" style={{ left: 0 }}>{clock(0)}</span>
            {ticks.map((h) => <span key={h} className={h % 4 ? 'ph-hide' : undefined} style={{ left: X(h * 3_600_000) }}>{h}h</span>)}
            <span className="last" style={{ left: '100%' }}>{clock(m.duration)}</span>
          </div>
          <span />
          {restarters.length > 0 && (
            <>
              <div className="rp-tries-h"><b>Restarts by agent</b><span className="end rp-keys"><span className="rp-key"><span className="x">✕</span>Restart</span><span className="rp-key"><span className="rp-dot ok" />Finished</span></span></div>
              {restarters.map((group) => <RestartRow key={group[0]!.id} m={m} group={group} X={X} />)}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function RestartRow({ m, group, X }: { m: RunModel; group: Agent[]; X: (t: number) => string }) {
  const a = group[0]!
  const hover = useHoverTarget(() => group.length > 1
    ? <div className="rp-card-h"><div className="t"><span className="nm">{group.length} agents, one schedule</span><span className="v">{a.restarts.length} restarts each</span></div><div className="s">{group.map((g) => g.name).join(', ')}</div></div>
    : <AgentCard m={m} a={a} />, { wide: group.length === 1 && a.tools.length > 0 })
  const name = group.length > 1 ? `${group.length} agents` : a.name
  return (
    <>
      <span className="nm" title={group.map((g) => g.name).join(', ')}>{name}</span>
      <div className="rp-tr-row" tabIndex={0} aria-label={`${name}: ${a.restarts.length} restarts${group.length > 1 ? ' each, at the same minutes' : ''}`} {...hover}>
        <span className="life" style={{ left: X(Math.max(0, a.start ?? 0)), right: `calc(100% - ${X(a.end ?? m.duration)})` }} />
        {a.restarts.map((t, i) => <span key={i} className="mk" style={{ left: X(t) }}>✕</span>)}
        {finished(a.state.tone) && a.end !== null && <span className="mk ok" style={{ left: X(a.end) }} />}
      </div>
      <span className="ct">{group.length > 1 ? `${a.restarts.length}× each` : a.restarts.length}</span>
    </>
  )
}

const AGENTS_SHOWN = 12
function AgentsCard({ m, route, doc }: TabProps) {
  const rows = useMemo(() => [...m.agents].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1)), [m])
  // The card is as tall as its rows: the top agents by tokens, then every agent on request, so no row is cut by an edge.
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, AGENTS_SHOWN)
  const end = m.totals.lastStep ?? m.duration
  const bins = 28
  const peak = useMemo(() => {
    let p = 1
    for (const a of m.agents) {
      const c = new Array(bins).fill(0)
      for (const s of a.steps) if (s.t <= end) c[Math.min(bins - 1, Math.floor((s.t / Math.max(1, end)) * bins))]++
      p = Math.max(p, ...c)
    }
    return p
  }, [m, end])
  return (
    <section className="rp-card" aria-label="Agents">
      <div className="rp-hd sm"><h2>Agents<span className="ct">{m.agents.length}</span></h2><span className="end"><a className="rp-btn sm" href={route.href('topology')}>Topology<Icon name="arrow" size={14} /></a></span></div>
      <div className="rp-agt-h"><span /><span>Agent</span><span className="ph-hide" title={`When each agent worked, over the run's ${elapsed(end)}`}>Activity · {elapsed(end).split(' ')[0]}</span><span>Steps</span><span>Tokens</span></div>
      <div className="rp-agt-l">
        {shown.map((a) => <AgentRow key={a.id} m={m} a={a} bins={bins} end={end} peak={peak} href={route.href('timeline', { agent: agentParam(doc.run.id, a.id) })} />)}
      </div>
      {rows.length > AGENTS_SHOWN && <button type="button" className="rp-more-row" onClick={() => setAll(!all)}>{all ? 'Show the top 12' : `Show all ${rows.length} agents`}</button>}
    </section>
  )
}

function AgentRow({ m, a, bins, end, peak, href }: { m: RunModel; a: Agent; bins: number; end: number; peak: number; href: string }) {
  const hover = useHoverTarget(() => <AgentCard m={m} a={a} />, { wide: a.tools.length > 0 })
  const counts = new Array(bins).fill(0)
  for (const s of a.steps) if (s.t <= end) counts[Math.min(bins - 1, Math.floor((s.t / Math.max(1, end)) * bins))]++
  const w = 120 / bins
  return (
    <a className="rp-agt" href={href} {...hover}>
      <StateDot tone={a.state.tone} />
      <span className="nm">{a.name}</span>
      <svg className="ph-hide" viewBox="0 0 120 16" aria-hidden="true">
        <line x1="0" x2="120" y1="15.5" y2="15.5" className="base" />
        {counts.map((n, i) => { const h = n ? 6 + Math.sqrt(n / peak) * 10 : 0; return h ? <rect key={i} x={i * w + 0.5} width={w - 1.2} y={16 - h} height={h} rx="1" /> : null })}
      </svg>
      <span className="v">{a.steps.length ? count(a.steps.length) : '—'}</span>
      <span className="v">{a.tokens === null ? '—' : abbr(a.tokens)}</span>
    </a>
  )
}
