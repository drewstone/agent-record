import { AsOfStamp } from './AnswerStrip.js'
import { PlayAgainstBar, PlayClimb } from './PlayClimb.js'
import { PlayFindings } from './PlayFindings.js'
import { GapChart, gapHeadline, type PlayGapFacts } from './PlayGap.js'
import { PlayLedger } from './PlayLedger.js'
import { type Play, playAsOf } from './answers.js'
import { StatusPill } from './data.js'
import { plainSummary, sinceLabel } from './plain-words.js'
import { usePhone } from './use-phone.js'
import { type HostView, viewChip, type ViewTrend } from './view.js'

/**
 * The play page's standing (BRIEF.md amendment 2026-10-24 19:55Z; the lead picked layout B at 22:20Z). One graphic answers
 * Q3 (how close is it, what stops it) and Q4 (is it improving): the best steps passed over time under the current check
 * (the host's trend series), with the ladder's step names as its y axis and the open step's row lit. Above it, the score,
 * one sentence and who acts; every release and earlier checks stay behind "Show every release".
 */
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const ago = (h: number) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`)
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

type Model = {
  view: HostView
  trend: ViewTrend | null
  steps: NonNullable<HostView['progress']>['steps']
  open: NonNullable<HostView['progress']>['steps'][number] | null
  flatHours: number | null
  plateau: NonNullable<ViewTrend['series']>[number] | null
  now: number
}

function model(play: Play, now: number): Model | null {
  const view = play.view as HostView | undefined
  if (!view) return null
  const trend = view.trend ?? null
  const steps = view.progress?.steps ?? []
  const open = steps.find((s) => s.state !== 'pass') ?? null
  const plateau = trend?.series?.find((r) => r.at === trend.since) ?? null
  const flatHours = trend && trend.movement === 'stuck' && trend.since ? (now - ms(trend.since)) / 3_600_000 : null
  return { view, trend, steps, open, flatHours, plateau, now }
}

const shortRun = (play: string, run: string | null | undefined) => (run ? run.replace(`${play}-`, '').slice(-3) : '')

/**
 * "Stuck at the hidden test set for 7 days, since Oct 18 (run 18b, rc5)." The date leads: the run page's "since rc115"
 * is the same plateau seen from one run, and two bare release names read as a contradiction (lead 22:20Z).
 */
function headline(play: Play, m: Model) {
  const p = m.view.progress
  if (!p) return 'No release has been scored yet.'
  if (p.solved) return `Solved: ${shortRun(play.id, p.runId)} ${p.release} passes all ${p.total} steps.`
  const at = m.open ? `at the ${m.open.label}` : ''
  const since = m.plateau ? `, since ${day(ms(m.plateau.at))} (run ${shortRun(play.id, m.plateau.runId)}, ${m.plateau.release})` : ''
  if (m.flatHours !== null) return `Stuck ${at} for ${ago(m.flatHours)}${since}.`
  return `${p.passed} of ${p.total} steps; next is the ${m.open?.label ?? 'last step'}.`
}

/**
 * Who acts on what holds it, in plain words. While research is paused only Drew can lift it, so the page points at
 * Today's decision rather than saying "nothing for you" beside Today's "1 decision needs you".
 */
function Hold({ view, open }: { view: HostView; open: Model['open'] }) {
  const b = view.blocker
  const paused = view.paused as { since?: string | null } | null | undefined
  const since = sinceLabel(b?.since)
  const action = b ? (b.action ?? plainSummary(b.text, 16)) : null
  const why = b?.why ? (open ? b.why.replace(/^The check/, `The ${open.label} check`) : b.why) : null
  const owner = b?.owner ?? 'Its owner'
  const held = b && action && (why
    ? <>{why}; {owner} will {action.charAt(0).toLowerCase()}{action.slice(1)}{since ? ` (on it since ${since})` : ''}.</>
    : <>{owner}{since ? ` since ${since}` : ''}: {action.charAt(0).toLowerCase()}{action.slice(1)}.</>)
  return (
    <>
      {paused && <p className="pj-hold"><b>Research is paused; lifting it is your decision</b> <a href="/today">→ Today</a></p>}
      {b && b.owner === 'Drew' && <p className="pj-hold"><b>Your decision:</b> {action}.</p>}
      {b && b.owner !== 'Drew' && <p className="pj-hold">{!paused && <b>Nothing for you. </b>}<span className="pj-muted">{held}</span></p>}
    </>
  )
}

/** Best steps passed over time (step line), each release a dot at its own score; the ladder's step names are the rows. */
function Climb({ play, m }: { play: Play; m: Model }) {
  const phone = usePhone()
  const series = m.trend?.series ?? []
  if (!m.trend || series.length === 0) return <p className="pj-muted">No release has a score under the current check yet.</p>
  const total = m.trend.total
  // Drawn at the screen's own width so its 12-13 px labels stay 12-13 px (a 1000-wide chart on a phone shrinks them to 4).
  const w = phone ? 380 : 1000
  const h = 300
  const left = phone ? 120 : 190
  const t0 = ms(series[0]!.at)
  const t1 = Math.max(m.now, ms(series.at(-1)!.at))
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (w - left - 16)
  const y = (v: number) => 14 + (1 - v / Math.max(1, total)) * (h - 40)
  let best = -1
  let path = ''
  for (const r of series) {
    const t = x(ms(r.at))
    if (r.passed > best) {
      path += path ? ` H${t} V${y(r.passed)}` : `M${t} ${y(r.passed)}`
      best = r.passed
    }
  }
  path += ` H${x(t1)}`
  const ticks = [t0, t0 + (t1 - t0) / 2, t1]
  const openIndex = m.open ? m.steps.indexOf(m.open) : -1
  const band = (h - 40) / total
  const label = (v: number) => (phone ? `${v} ${(m.steps[v - 1]?.label ?? '').split(' ').slice(0, 2).join(' ')}` : `${v} · ${m.steps[v - 1]?.label ?? `step ${v}`}`)
  return (
    <svg className={`pj-climb pj-${m.trend.movement}`} viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Best steps passed under the current check over time; ${headline(play, m)}`}>
      {Array.from({ length: total + 1 }, (_, v) => (
        <g key={v} className={`pj-grid${v > 0 && v === openIndex + 1 ? ' is-open' : ''}`}>
          {v > 0 && v === openIndex + 1 && <rect x={left} y={y(v) - band / 2} width={w - left - 16} height={band} />}
          <line x1={left} x2={w - 16} y1={y(v)} y2={y(v)} />
          <text x={left - 8} y={y(v) + 4} textAnchor="end">{v === 0 ? '' : label(v)}</text>
        </g>
      ))}
      {series.map((r) => <circle key={`${r.runId}-${r.release}`} className="pj-dot" cx={x(ms(r.at))} cy={y(r.passed)} r={3.5}><title>{`${shortRun(play.id, r.runId)} ${r.release}: ${r.passed}/${total}, ${day(ms(r.at))}`}</title></circle>)}
      <path className="pj-line" d={path} />
      {m.flatHours !== null && <text className="pj-flat" x={x(t1) - 6} y={y(m.trend.best) + 18} textAnchor="end">no step gained in {ago(m.flatHours)}</text>}
      {ticks.map((t, i) => <text key={i} className="pj-tick" x={x(t)} y={h - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{i === 2 ? 'now' : day(t)}</text>)}
    </svg>
  )
}

/** The ladder under the current check as one strip: each step a dot and its name, the open one lit. */
function StepStrip({ m }: { m: Model }) {
  if (!m.steps.length) return null
  return (
    <ol className="pj-strip" aria-label={`Steps under check ${m.view.progress?.checker ?? ''}`}>
      {m.steps.map((s, i) => <li key={i} data-step={s.state} className={s === m.open ? 'is-open' : undefined}><i />{s.label}</li>)}
    </ol>
  )
}

/**
 * The play's head on the standing tab. With a measured gap to the paper (the host's `gap`), the hero is that gap: the best
 * proving rate against the paper's band, what passed and what the current bar needs, and the rate chart; the ladder is a
 * strip above the chart. Without one, the steps passed over time stay the hero.
 */
export function PlayJourney({ play, now = Date.now() }: { play: Play; now?: number }) {
  const m = model(play, now)
  if (!m) return null
  const p = m.view.progress
  const gap = (play as { gap?: PlayGapFacts | null }).gap ?? null
  const g = gap ? gapHeadline(gap) : null
  const checkers = ((play as { checkers?: { label: string; firstAt: string }[] }).checkers ?? [])
  return (
    <div className="pj">
      <header className="pj-title">
        <h1>{play.title}</h1>
        <StatusPill status={viewChip(m.view.status)} />
        <AsOfStamp asOf={playAsOf(play)} />
      </header>
      <section className="pj-q3" aria-label="How close is it, and what stops it">
        {g ? (
          <p className="pj-hero">{g.best ? g.best.value.toLocaleString() : '—'}<small> {gap!.metric.unit}{g.target ? ` · paper ${(g.target.min / 1e6).toFixed(1)}–${(g.target.max / 1e6).toFixed(1)}M` : ''}</small></p>
        ) : (
          <p className="pj-hero">{p ? <>{p.passed}<small>/{p.total} steps</small></> : '—'}</p>
        )}
        <p className="pj-sentence">{g ? g.sentence : headline(play, m)}</p>
        <Hold view={m.view} open={m.open} />
      </section>
      <section className="pj-q4" aria-label={g ? `${gap!.metric.label} against the paper` : `Best steps passed over time${p?.checker ? `, under check ${p.checker}` : ''}`}>
        <StepStrip m={m} />
        {gap ? <GapChart gap={gap} checkers={checkers} now={now} /> : <Climb play={play} m={m} />}
      </section>
    </div>
  )
}

/** Under it: every release and the bar behind one toggle, then the runs and findings. */
export function PlayJourneyStanding({ play, onOpen, onMore }: { play: Play; onOpen: (runId: string) => void; onMore: () => void }) {
  return (
    <div className="play-standing-tab" data-section="standing">
      <details className="pj-every">
        <summary>Show every release</summary>
        <PlayClimb play={play} />
        <PlayAgainstBar play={play} />
      </details>
      <PlayLedger play={play} onOpen={onOpen} />
      <PlayFindings play={play} limit={6} onMore={onMore} />
    </div>
  )
}
