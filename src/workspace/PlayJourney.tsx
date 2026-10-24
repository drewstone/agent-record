import { AsOfStamp } from './AnswerStrip.js'
import { PlayAgainstBar, PlayClimb } from './PlayClimb.js'
import { PlayFindings } from './PlayFindings.js'
import { PlayLedger } from './PlayLedger.js'
import { type Play, playAsOf } from './answers.js'
import { StatusPill } from './data.js'
import { plainSummary, sinceLabel } from './RunJourney.js'
import { usePhone } from './RunWorkspace.js'
import { type HostView, viewChip, type ViewTrend } from './view.js'

/**
 * The play page's two questions (BRIEF.md amendment 2026-10-24 19:55Z), in two candidate layouts for the lead's pick.
 * Q3, how close is it and what stops it: the best release's ladder and one sentence naming the open step, the blocker and
 * who acts. Q4, is it improving or stuck: the best steps passed over time under the current check (the host's trend
 * series), its flat stretch annotated; every release and earlier checks stay behind "Show every release".
 * ?layout=a: ladder hero, then the climb as its own chart. ?layout=b: one graphic, the ladder as the climb's y axis.
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

/** "Stuck at the hidden test set for 7 days, since 21c rc115." */
function headline(play: Play, m: Model) {
  const p = m.view.progress
  if (!p) return 'No release has been scored yet.'
  if (p.solved) return `Solved: ${shortRun(play.id, p.runId)} ${p.release} passes all ${p.total} steps.`
  const at = m.open ? `at the ${m.open.label}` : ''
  if (m.flatHours !== null) return `Stuck ${at} for ${ago(m.flatHours)}${m.plateau ? `, since ${shortRun(play.id, m.plateau.runId)} ${m.plateau.release}` : ''}.`
  return `${p.passed} of ${p.total} steps; next is the ${m.open?.label ?? 'last step'}.`
}

/** Who acts on what holds it, in plain words; nothing for Drew unless the host names him. */
function Hold({ view }: { view: HostView }) {
  const b = view.blocker
  if (!b) return null
  const action = b.action ?? plainSummary(b.text, 16)
  const since = sinceLabel(b.since)
  return b.owner === 'Drew'
    ? <p className="pj-hold"><b>Your decision:</b> {action}.</p>
    : <p className="pj-hold"><b>Nothing for you.</b> <span className="pj-muted">{b.owner ?? 'Its owner'}{since ? ` since ${since}` : ''}: {action.charAt(0).toLowerCase()}{action.slice(1)}.</span></p>
}

function Head({ play, m }: { play: Play; m: Model }) {
  return (
    <header className="pj-head">
      <div className="pj-title">
        <h1>{play.title}</h1>
        <StatusPill status={viewChip(m.view.status)} />
        <AsOfStamp asOf={playAsOf(play)} />
      </div>
    </header>
  )
}

/** Q4: best steps passed over time (step line), each release a dot at its own score, the flat stretch shaded and named. */
function Climb({ play, m, rows = false, h = 220 }: { play: Play; m: Model; rows?: boolean; h?: number }) {
  const phone = usePhone()
  const series = m.trend?.series ?? []
  if (!m.trend || series.length === 0) return <p className="pj-muted">No release has a score under the current check yet.</p>
  const total = m.trend.total
  // Drawn at the screen's own width so its 12-13 px labels stay 12-13 px (a 1000-wide chart on a phone shrinks them to 4).
  const w = phone ? 380 : 1000
  const left = rows ? (phone ? 120 : 190) : 34
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
  return (
    <svg className={`pj-climb pj-${m.trend.movement}`} viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Best steps passed under the current check over time; ${headline(play, m)}`}>
      {Array.from({ length: total + 1 }, (_, v) => (
        <g key={v} className={`pj-grid${rows && v === openIndex + 1 ? ' is-open' : ''}`}>
          {rows && v > 0 && v === openIndex + 1 && <rect x={left} y={y(v) - (h - 40) / total / 2} width={w - left - 16} height={(h - 40) / total} />}
          <line x1={left} x2={w - 16} y1={y(v)} y2={y(v)} />
          <text x={left - 8} y={y(v) + 4} textAnchor="end">{rows ? (v === 0 ? '' : phone ? `${v} ${(m.steps[v - 1]?.label ?? '').split(' ').slice(0, 2).join(' ')}` : `${v} · ${m.steps[v - 1]?.label ?? `step ${v}`}`) : v}</text>
        </g>
      ))}
      {m.flatHours !== null && m.trend.since && (
        <g className="pj-plateau">
          <rect x={x(ms(m.trend.since))} y={8} width={x(t1) - x(ms(m.trend.since))} height={h - 34} />
          <text x={x(t1) - 6} y={y(m.trend.best) - 10} textAnchor="end">no step gained in {ago(m.flatHours)}</text>
        </g>
      )}
      {series.map((r) => <circle key={`${r.runId}-${r.release}`} className="pj-dot" cx={x(ms(r.at))} cy={y(r.passed)} r={3}><title>{`${shortRun(play.id, r.runId)} ${r.release}: ${r.passed}/${total}, ${day(ms(r.at))}`}</title></circle>)}
      <path className="pj-line" d={path} />
      {ticks.map((t, i) => <text key={i} className="pj-tick" x={x(t)} y={h - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{i === 2 ? 'now' : day(t)}</text>)}
    </svg>
  )
}

function Ladder({ m }: { m: Model }) {
  return (
    <ol className="rj-ladder pj-ladder">
      {m.steps.map((s, i) => <li key={i} className={`rj-step rj-step-${s.state}`}><span className="rj-step-n">{i + 1}</span><span>{s.label}</span></li>)}
    </ol>
  )
}

/** A: the ladder is the hero; the climb is a chart of its own under "Is it improving?". */
export function PlayJourneyA({ play, now = Date.now() }: { play: Play; now?: number }) {
  const m = model(play, now)
  if (!m) return null
  return (
    <div className="pj pj-a">
      <Head play={play} m={m} />
      <section className="pj-q3" aria-label="How close is it, and what stops it">
        {m.steps.length > 0 && <Ladder m={m} />}
        <p className="pj-sentence">{headline(play, m)}</p>
        <Hold view={m.view} />
      </section>
      <section className="pj-q4" aria-labelledby="pj-q4">
        <h2 id="pj-q4" className="pj-label">Best steps passed over time{m.view.progress?.checker ? `, under check ${m.view.progress.checker}` : ''}</h2>
        <Climb play={play} m={m} />
      </section>
    </div>
  )
}

/** B: one sentence, then one graphic: the ladder's steps are the climb's rows, the open step's row lit. */
export function PlayJourneyB({ play, now = Date.now() }: { play: Play; now?: number }) {
  const m = model(play, now)
  if (!m) return null
  const p = m.view.progress
  return (
    <div className="pj pj-b">
      <Head play={play} m={m} />
      <section className="pj-q3" aria-label="How close is it, and what stops it">
        <p className="pj-hero">{p ? <>{p.passed}<small>/{p.total} steps</small></> : '—'}</p>
        <p className="pj-sentence">{headline(play, m)}</p>
        <Hold view={m.view} />
      </section>
      <section className="pj-q4" aria-label={`Best steps passed over time${p?.checker ? `, under check ${p.checker}` : ''}`}>
        <Climb play={play} m={m} rows h={300} />
        {p?.checker && <p className="pj-muted pj-note">Under check {p.checker}. Each dot is a release at its own score; the line is the best so far.</p>}
      </section>
    </div>
  )
}

/** Which candidate the URL asks for, on the standing tab only. */
export const journeyLayout = (layout: string | null, tab: string) => (tab === 'standing' && (layout === 'a' || layout === 'b') ? layout : null)

export function PlayJourneyHead({ layout, play }: { layout: 'a' | 'b'; play: Play }) {
  return layout === 'a' ? <PlayJourneyA play={play} /> : <PlayJourneyB play={play} />
}

/** Under the journey: every release and the bar behind one toggle, then the runs and findings as before. */
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
