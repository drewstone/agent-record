import { useMemo, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@tangle-network/ui/primitives'
import { shortRun } from '../play-standing.js'
import { goalText } from '../plain-words.js'
import { agentParam, type TabProps } from './RunPage.js'
import { type Agent, clockOf, abbr, count, type RunModel, elapsed } from './model.js'
import { AgentCard, StateDot, Icon, type IconName, useHoverTarget, useRows } from './ui.js'

/** The first clause of a host message, without the program prefixes and host paths (`bridgeExecutor: …: opencode: Free usage exceeded`). */
export function clause(text: string | null | undefined, words = Infinity): string {
  if (!text) return ''
  let t = text.replace(/\/(home|mnt|Users|tmp|private)\/\S+/g, '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^(?:[\w-]+(?: [\w-]+){0,3}: )+(?=\S)/, (prefix) => (prefix.split(': ').length > 2 ? '' : prefix))
  t = t.split(/(?<=[.;])\s|;\s|, the |, starting /)[0] ?? t
  const cut = t.split(' ')
  return (cut.length > words ? `${cut.slice(0, words).join(' ')}…` : t).replace(/[.;,]$/, '')
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

export function Overview(props: TabProps) {
  const { m, doc, play, route } = props
  const clock = clockOf(m.t0)
  const view = doc.view
  const run = doc.run as typeof doc.run & { check?: CheckDoc; ending?: { at?: string | null; reason?: string | null; sentence?: string | null } }
  const execution = doc.execution as unknown as { failedAttempts?: number; lastAttempt?: { at?: string; error?: string | null } | null } | undefined
  const newer = (play?.runs ?? []).filter((r) => r.id !== doc.run.id && r.startedAt && doc.run.startedAt && r.startedAt > doc.run.startedAt).sort((a, b) => (a.startedAt! < b.startedAt! ? -1 : 1))[0]
  const work = useMemo(() => workIntervals(m), [m])
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
  const icon: IconName = m.live ? 'clock' : solved ? 'check' : 'stop'
  const story: { at: string | null; title: string; sub: string; tone: string }[] = [
    { at: doc.run.startedAt, title: 'Run started', sub: `${m.agents.length} agents${m.root?.model ? ` on ${m.root.model}` : ''}`, tone: '' },
    ...(m.totals.lastStep !== null ? [{ at: new Date(m.t0 + m.totals.lastStep).toISOString(), title: m.live ? 'Latest agent step' : 'Last agent step', sub: `+${elapsed(m.totals.lastStep)} into the run`, tone: m.duration - m.totals.lastStep > 1_800_000 ? 'warn' : '' }] : []),
    ...(execution?.lastAttempt?.error ? [{ at: execution.lastAttempt.at ?? null, title: 'Last try failed', sub: clause(execution.lastAttempt.error, 10), tone: 'fail' }] : []),
    m.live ? { at: new Date().toISOString(), title: 'Running now', sub: `${m.agents.filter((a) => a.state.tone === 'live').length} agents live`, tone: 'next' }
      : { at: run.ending?.at ?? doc.run.settledAt, title: status, sub: newer ? `continued in run ${shortRun(doc.run.play, newer.id)}` : clause(run.ending?.sentence, 8), tone: 'next' },
  ]
  return (
    <div className="rp-ov">
      <section className="rp-card rp-vd" aria-label="Verdict">
        <div className="rp-vd-top">
          <div className="rp-vd-ic"><Icon name={icon} size={22} /></div>
          <div>
            <h2 className="rp-verdict">{verdict}</h2>
            {lede && <p className="rp-lede">{lede}</p>}
          </div>
          <div className="rp-vd-act">
            {newer ? <a className="rp-btn primary" href={`/run/${encodeURIComponent(newer.id)}`}>Open run {shortRun(doc.run.play, newer.id)}<Icon name="arrow" /></a>
              : m.live ? <a className="rp-btn primary" href={route.href('timeline')}>Watch the timeline<Icon name="arrow" /></a> : null}
            <a className="rp-btn outline" href={route.href('files')}>Files</a>
          </div>
        </div>
        <ol className="rp-story">
          {story.map((s, i) => (
            <li key={i}><span className={`sd ${s.tone}`} /><time>{s.at ? `${s.at.slice(11, 16)} UTC` : '—'}</time><b>{s.title}</b><span title={s.sub}>{s.sub}</span></li>
          ))}
        </ol>
      </section>
      <Summary {...props} />
      <div className="rp-ov-b">
        <TimeCard m={m} work={work} working={working} failed={failed} />
        <AgentsCard {...props} clock={clock} />
      </div>
    </div>
  )
}

type CheckDoc = { latest?: { line?: string | null; verdict?: string | null; known?: boolean; solved?: boolean } | null; counts?: { checks?: number }; checkerNames?: { label: string }[] }

function Summary({ m, doc, route }: TabProps) {
  const check = (doc.run as unknown as { check?: CheckDoc }).check
  const goal = goalText(doc.input?.objective)
  const pages = (doc.findings?.items ?? []).filter((item) => item.path)
  const branches = m.agents.filter((a) => a.node.hasCode).length
  const commits = m.agents.reduce((t, a) => t + (a.commits ?? 0), 0)
  const best = m.best
  const verdict = !check?.latest ? 'Not checked' : check.latest.solved ? 'Passed' : check.latest.known ? 'Failed' : 'No verdict'
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
        <div className="v">{verdict === 'Passed' ? <StateDot tone="ok" /> : verdict === 'Failed' ? <StateDot tone="fail" /> : <StateDot tone="none" />}{verdict}</div>
        <div className="sub">
          {check?.counts?.checks ? `Checker ${check.checkerNames?.[0]?.label ?? ''} ran ${check.counts.checks} times; the latest line is in ` : 'No check has run. '}
          <a href={route.href('checks')}>Checks</a>
        </div>
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
          {pages.slice(0, 3).map((item) => (
            <a key={item.path} href={route.href('files', { file: `page:${item.path}` })} title={item.path}><Icon name="file" size={14} /><span>{item.path!.split('/').pop()}</span></a>
          ))}
          {pages.length > 3 && <a href={route.href('files')}><span>{pages.length - 3} more</span></a>}
        </div>
      </div>
    </section>
  )
}

function TimeCard({ m, work, working, failed }: { m: RunModel; work: [number, number][]; working: number; failed: number }) {
  const X = (t: number) => `${Math.max(0, Math.min(100, (t / Math.max(1, m.duration)) * 100))}%`
  const hours = m.duration > 3_600_000 ? Math.floor(m.duration / 3_600_000) : 0
  const step = hours <= 10 ? 1 : Math.ceil(hours / 8), ticks = hours ? Array.from({ length: hours }, (_, i) => i + 1).filter((h) => h % step === 0 && (h + step) * 3_600_000 <= m.duration) : []
  const restarters = m.tree.filter((a) => a.restarts.length || a.state.tone === 'ok').slice(0, 14)
  const clock = clockOf(m.t0)
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
          <span className="nm h">Whole run</span>
          <div className="rp-strip" role="img" aria-label={`Agents worked ${elapsed(working)} of ${elapsed(m.duration)}`}>
            {work.map(([a, b], i) => <i key={i} style={{ left: X(a), width: `max(1px, calc(${X(b)} - ${X(a)}))` }} />)}
          </div>
          <span className="ct">{elapsed(m.duration)}</span>
          <span />
          <div className="rp-strip-ax">
            <span className="first" style={{ left: 0 }}>{clock(0)}</span>
            {ticks.map((h) => <span key={h} className={h % 4 ? 'ph-hide' : undefined} style={{ left: X(h * 3_600_000) }}>{h}h</span>)}
            <span className="last" style={{ left: '100%' }}>{clock(m.duration)}</span>
          </div>
          <span />
          {restarters.length > 0 && (
            <>
              <div className="rp-tries-h"><b>Restarts by agent</b><span className="end rp-keys"><span className="rp-key"><span className="x">✕</span>Restart</span><span className="rp-key"><span className="rp-dot ok" />Done</span></span></div>
              {restarters.map((a) => <RestartRow key={a.id} m={m} a={a} X={X} />)}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function RestartRow({ m, a, X }: { m: RunModel; a: Agent; X: (t: number) => string }) {
  const hover = useHoverTarget(() => <AgentCard m={m} a={a} />, { wide: a.tools.length > 0 })
  return (
    <>
      <span className="nm" title={a.name}>{a.name}</span>
      <div className="rp-tr-row" tabIndex={0} aria-label={`${a.name}: ${a.restarts.length} restarts`} {...hover}>
        <span className="life" style={{ left: X(Math.max(0, a.start ?? 0)), right: `calc(100% - ${X(a.end ?? m.duration)})` }} />
        {a.restarts.map((t, i) => <span key={i} className="mk" style={{ left: X(t) }}>✕</span>)}
        {a.state.tone === 'ok' && a.end !== null && <span className="mk ok" style={{ left: X(a.end) }} />}
      </div>
      <span className="ct">{a.restarts.length || '—'}</span>
    </>
  )
}

function AgentsCard({ m, route, doc, clock }: TabProps & { clock: (ms: number) => string }) {
  const rows = useMemo(() => [...m.agents].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1)), [m])
  const scroller = useRef<HTMLDivElement>(null)
  const win = useRows(scroller, rows.length, 32)
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
      <div className="rp-agt-h"><span /><span>Agent</span><span className="ph-hide">{clock(0)}–{clock(end)}</span><span>Steps</span><span>Tokens</span></div>
      <div className="rp-scroll" ref={scroller}>
        <div style={{ height: win.before }} />
        {rows.slice(win.first, win.last).map((a) => <AgentRow key={a.id} m={m} a={a} bins={bins} end={end} peak={peak} href={route.href('timeline', { agent: agentParam(doc.run.id, a.id) })} />)}
        <div style={{ height: win.after }} />
      </div>
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
      <svg className="ph-hide" viewBox="0 0 120 20" aria-hidden="true">
        <line x1="0" x2="120" y1="19.5" y2="19.5" className="base" />
        {counts.map((n, i) => (n ? <rect key={i} x={i * w + 0.5} width={w - 1.2} y={19 - Math.max(1.5, (n / peak) * 18)} height={Math.max(1.5, (n / peak) * 18)} rx="0.8" /> : null))}
      </svg>
      <span className="v">{a.steps.length ? count(a.steps.length) : '—'}</span>
      <span className="v">{a.tokens === null ? '—' : abbr(a.tokens)}</span>
    </a>
  )
}
