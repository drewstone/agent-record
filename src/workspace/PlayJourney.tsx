import { Tip } from './AnswerStrip.js'
import { BarStrip } from './BarStrip.js'
import { TrendChart } from './TrendChart.js'
import type { Play } from './answers.js'
import { stepWord } from './plain-words.js'
import type { HostView, ViewTrend } from './view.js'

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
  // Stuck at an open step reads from the host's trend; otherwise the host's own progress sentence (a page-composed
  // "6 of 6 steps; next is the last step" was wrong once every step passed under a disputed check).
  if (m.flatHours === null || !m.open) return p.sentence
  const since = m.plateau ? `, since ${day(ms(m.plateau.at))} (run ${shortRun(play.id, m.plateau.runId)}, ${m.plateau.release})` : ''
  return `Stuck at the ${m.open.label} for ${ago(m.flatHours)}${since}.`
}

/**
 * What holds the play, as its producer wrote it (view.blocker.sentence: the check's own line, its release named), and who
 * acts by role. The page compares no names and composes no sentence; whether it is the viewer's to act is Today's.
 */
function Hold({ view }: { view: HostView }) {
  const b = view.blocker
  const paused = view.paused as { since?: string | null } | null | undefined
  return (
    <>
      {paused && <p className="pj-hold"><b>Research is paused</b> <a href="/today">→ Today</a></p>}
      {b && <p className="pj-hold"><Tip text={b.detail ?? b.text}><span>{b.sentence ?? b.text}</span></Tip>{b.actor && <span className="pj-muted"> · {b.actor.label}</span>}</p>}
    </>
  )
}

/** The ladder under the current check as one strip: each step a dot and its name, the open one lit. */
function StepStrip({ m }: { m: Model }) {
  if (!m.steps.length) return null
  return (
    <ol className="pj-strip" aria-label={`Steps under check ${m.view.progress?.checker ?? ''}`}>
      {/* Each step says its state on hover and focus (REVIEW-6 #9: the strip read as dead). */}
      {m.steps.map((s, i) => <li key={i} data-step={s.state} className={s === m.open ? 'is-open' : undefined}><Tip text={`Step ${i + 1} of ${m.steps.length}, ${s.label}: ${stepWord(s.state)}`}><i />{s.label}</Tip></li>)}
    </ol>
  )
}

/**
 * The play's Standing: steps passed and how long since a step was gained, what holds it in its producer's words, every
 * paper metric against its bar (when the host serves view.bars), then the ladder and the steps over time.
 */
export function PlayJourney({ play, now = Date.now() }: { play: Play; now?: number }) {
  const m = model(play, now)
  if (!m) return null
  const p = m.view.progress
  const bars = m.view.bars ?? []
  return (
    <div className="pj">
      <section className="pj-q3" aria-label="How close is it, and what stops it">
        <p className="pj-hero">{p ? <>{p.passed}<small>/{p.total} steps</small></> : '—'}</p>
        <p className="pj-sentence">{headline(play, m)}</p>
        <Hold view={m.view} />
      </section>
      {/* Every paper metric against its bar, from the host (view.bars), for any play with a bar.json. */}
      {bars.length > 0 && <BarStrip bars={bars} />}
      <section className="pj-q4" aria-label={`Best steps passed over time${p?.checker ? `, under check ${p.checker}` : ''}`}>
        <StepStrip m={m} />
        {m.trend && <TrendChart trend={m.trend} />}
      </section>
    </div>
  )
}
