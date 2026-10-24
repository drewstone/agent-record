import type { OverviewAttention, OverviewDocument } from '../overview-model.js'
import { AsOfStamp } from './AnswerStrip.js'
import { hm } from './answers.js'
import { RulingButtons, sinceLabel } from './RunJourney.js'
import type { HostView, ViewTrend } from './view.js'

/**
 * Today as the journey spec's two questions (BRIEF.md amendment 2026-10-24 19:55Z), in two candidate layouts for the
 * lead's pick: ?layout=a (decisions, then one row per play) and ?layout=b (one sentence, then a chart per play).
 * Q1: what needs me, and what do I do. Q2: is research working. Clean-run health is Fleet's, not Today's.
 */
type Play = { play: string; title: string; view: HostView }
type Movement = ViewTrend['movement']

const ORDER: Record<Movement, number> = { regressed: 0, stuck: 1, moving: 2, solved: 3 }
const WORD: Record<Movement, string> = { regressed: 'Regressed', stuck: 'Stuck', moving: 'Moving', solved: 'Solved' }

/** Drew's items (owner Drew) are decisions; every other item is held by its owner and needs nothing from him. */
function split(items: OverviewAttention[]) {
  const open = items.filter((item) => item.needsYou || item.tone === 'crit')
  return { mine: open.filter((item) => item.owner === 'Drew'), held: open.filter((item) => item.owner !== 'Drew') }
}

const hoursSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / 3_600_000) : null)
const ago = (h: number | null) => (h === null ? '' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`)

/** The decision as a sentence with its control: a check dispute's two rulings, or the run to open. */
function Decision({ item }: { item: OverviewAttention }) {
  return (
    <li className="tj-decision">
      <p>{item.action ?? item.text}</p>
      {item.dispute && item.runId ? <RulingButtons runId={item.runId} dispute={item.dispute} /> : item.href && <a className="tj-go" href={item.href}>Open</a>}
    </li>
  )
}

/** One line per item its owner holds: who, since when, doing what. */
function Held({ items }: { items: OverviewAttention[] }) {
  if (!items.length) return null
  return (
    <details className="tj-held">
      <summary>{items.length === 1 ? '1 thing is with its owner' : `${items.length} things are with their owners`}</summary>
      <ul>
        {items.map((item) => (
          <li key={item.text}>
            <b>{item.owner ?? 'Discovery operator'}</b>
            <span className="tj-muted">{sinceLabel(item.since) ? ` since ${sinceLabel(item.since)}` : ''} · </span>
            {item.href ? <a href={item.href}>{item.action ?? item.text}</a> : item.action ?? item.text}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Steps passed per day as a step line, colored by the play's movement only. */
function Spark({ trend, w = 112, h = 28 }: { trend: ViewTrend; w?: number; h?: number }) {
  const n = trend.passed.length
  const x = (i: number) => 2 + (i * (w - 4)) / Math.max(1, n - 1)
  const y = (v: number) => h - 3 - (v / Math.max(1, trend.total)) * (h - 6)
  let path = ''
  trend.passed.forEach((v, i) => {
    if (v === null) return
    path += path ? ` H${x(i)} V${y(v)}` : `M${x(i)} ${y(v)}`
  })
  const last = trend.passed.at(-1)
  return (
    <svg className={`tj-spark tj-${trend.movement}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`steps passed, last ${n} days: ${trend.passed.map((v) => v ?? '–').join(', ')} of ${trend.total}`}>
      <line className="tj-spark-top" x1={2} x2={w - 2} y1={y(trend.total)} y2={y(trend.total)} />
      {path && <path d={path} />}
      {last !== null && last !== undefined && <circle cx={x(n - 1)} cy={y(last)} r={2.5} />}
    </svg>
  )
}

/** The play's movement in words: "stuck 3 days at 5/6", "regressed: rc9 passes 2/6, best 4/6". */
function moveLine(trend: ViewTrend, now: number) {
  if (trend.movement === 'stuck') return `${ago(hoursSince(trend.since, now))} at ${trend.best}/${trend.total}`
  if (trend.movement === 'regressed') return `${trend.newest.release} passes ${trend.newest.passed}/${trend.total}, best ${trend.best}/${trend.total}`
  if (trend.movement === 'moving') return `reached ${trend.best}/${trend.total} ${ago(hoursSince(trend.since, now))} ago`
  return `all ${trend.total} steps`
}

function ranked(plays: Play[]) {
  const withTrend = plays.filter((p): p is Play & { view: { trend: ViewTrend } } => Boolean(p.view.trend))
  return {
    active: withTrend.filter((p) => p.view.trend.movement !== 'solved').sort((a, b) => ORDER[a.view.trend.movement] - ORDER[b.view.trend.movement] || a.view.trend.best / a.view.trend.total - b.view.trend.best / b.view.trend.total),
    solved: withTrend.filter((p) => p.view.trend.movement === 'solved'),
    unscored: plays.filter((p) => !p.view.trend && p.view.status.key !== 'solved'),
  }
}

function tally(plays: Play[]) {
  const count = (m: Movement) => plays.filter((p) => p.view.trend?.movement === m).length
  const blind = plays.filter((p) => !p.view.trend && p.view.status.key !== 'solved').length
  return `${count('moving')} moving, ${count('stuck')} stuck, ${count('regressed')} regressed${blind ? `, ${blind} not measured` : ''}`
}

/** The stand-down, when one holds: nothing can move until it lifts, so it heads Q2. */
function Standdown({ doc, now }: { doc: OverviewDocument; now: number }) {
  const s = doc.state.standdown
  if (!s) return null
  return <p className="tj-standdown">Research is stood down{s.at ? ` for ${ago(hoursSince(s.at, now))}` : ''}: {(s.reason ?? 'no reason recorded').replace(/^[^:]*:\s*/, '')}</p>
}

/** A: the decisions, then one row per play with its ladder, its 7 days and its movement. */
export function TodayA({ doc }: { doc: OverviewDocument }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const { mine, held } = split(doc.attention ?? [])
  const plays = ranked(doc.plays ?? [])
  return (
    <div className="ws-page td tj tj-a" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: doc.composedAt, meaning: `when the host composed this page (${hm(doc.composedAt)})`, source: 'the Discovery overview' }} />
      </header>
      <section className="tj-q1" aria-label="What needs you">
        <p className="tj-hero">{mine.length ? `${mine.length} ${mine.length === 1 ? 'decision' : 'decisions'} for you` : 'Nothing needs you'}</p>
        {mine.length > 0 && <ul className="tj-decisions">{mine.map((item) => <Decision key={item.text} item={item} />)}</ul>}
        <Held items={held} />
      </section>
      <section className="tj-q2" aria-labelledby="tj-research">
        <h2 id="tj-research" className="tj-label">Research · {tally(doc.plays ?? [])} this week</h2>
        <Standdown doc={doc} now={now} />
        <table className="tj-table">
          <thead><tr><th>Play</th><th>Best release</th><th>7 days</th><th>State</th></tr></thead>
          <tbody>
            {plays.active.map(({ play, title, view }) => (
              <tr key={play}>
                <td><a href={`/play/${encodeURIComponent(play)}`}>{title}</a></td>
                <td>
                  <span className="tj-steps">{view.progress?.steps.map((step, i) => <i key={i} data-step={step.state} />)}</span>
                  <span className="tj-num">{view.trend.best}/{view.trend.total}</span>
                </td>
                <td><Spark trend={view.trend} /></td>
                <td><b className={`tj-word tj-${view.trend.movement}`}>{WORD[view.trend.movement]}</b> <span className="tj-muted">{moveLine(view.trend, now)}</span></td>
              </tr>
            ))}
            {plays.unscored.map(({ play, title, view }) => (
              <tr key={play} className="tj-blind">
                <td><a href={`/play/${encodeURIComponent(play)}`}>{title}</a></td>
                <td className="tj-muted">no release scored</td>
                <td />
                <td><b className="tj-word tj-solved">Not measured</b> <span className="tj-muted">{view.status.label.toLowerCase()}; no check counts its steps</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {plays.solved.length > 0 && <p className="tj-rest">Solved: {plays.solved.map((p, i) => <span key={p.play}>{i ? ', ' : ''}<a href={`/play/${encodeURIComponent(p.play)}`}>{p.title}</a></span>)}.</p>}
      </section>
    </div>
  )
}

/** B: one sentence answers both questions; below it, each unsolved play as a chart of its 7 days. */
export function TodayB({ doc }: { doc: OverviewDocument }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const { mine, held } = split(doc.attention ?? [])
  const plays = ranked(doc.plays ?? [])
  const stuck = plays.active.find((p) => p.view.trend.movement !== 'moving')
  const sentence = [
    mine.length ? `${mine.length} ${mine.length === 1 ? 'decision needs' : 'decisions need'} you.` : 'Nothing needs you.',
    `${tally(doc.plays ?? [])} this week`,
    stuck ? `; ${stuck.title} has been ${WORD[stuck.view.trend.movement].toLowerCase()} ${moveLine(stuck.view.trend, now)}.` : '.',
  ].join(' ').replace(' ;', ';')
  return (
    <div className="ws-page td tj tj-b" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: doc.composedAt, meaning: `when the host composed this page (${hm(doc.composedAt)})`, source: 'the Discovery overview' }} />
      </header>
      <section className="tj-q1" aria-label="What needs you and is research working">
        <p className="tj-sentence">{sentence}</p>
        {mine.length > 0 && <ul className="tj-decisions">{mine.map((item) => <Decision key={item.text} item={item} />)}</ul>}
        <Standdown doc={doc} now={now} />
        <Held items={held} />
      </section>
      <section className="tj-q2" aria-label="Each unsolved play, last 7 days">
        <ul className="tj-multiples">
          {plays.active.map(({ play, title, view }) => (
            <li key={play}>
              <a href={`/play/${encodeURIComponent(play)}`}>
                <span className="tj-title">{title}</span>
                <span className="tj-big">{view.trend.best}<small>/{view.trend.total}</small></span>
                <Spark trend={view.trend} w={220} h={56} />
                <span><b className={`tj-word tj-${view.trend.movement}`}>{WORD[view.trend.movement]}</b> <span className="tj-muted">{moveLine(view.trend, now)}</span></span>
              </a>
            </li>
          ))}
        </ul>
        {plays.unscored.length > 0 && <p className="tj-rest"><b>{plays.unscored.length} plays not measured</b>: no check counts their steps, so nothing says whether they move. {plays.unscored.map((p, i) => <span key={p.play}>{i ? ', ' : ''}<a href={`/play/${encodeURIComponent(p.play)}`}>{p.title}</a></span>)}.</p>}
        {plays.solved.length > 0 && <p className="tj-rest">Solved this week: {plays.solved.map((p, i) => <span key={p.play}>{i ? ', ' : ''}<a href={`/play/${encodeURIComponent(p.play)}`}>{p.title}</a></span>)}.</p>}
      </section>
    </div>
  )
}
