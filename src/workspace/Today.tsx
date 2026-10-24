import type { OverviewAttention, OverviewDocument } from '../overview-model.js'
import { AsOfStamp } from './AnswerStrip.js'
import { hm } from './answers.js'
import { useDocument } from './data.js'
import { plainSummary, sinceLabel } from './plain-words.js'
import type { HostView, ViewTrend } from './view.js'

/**
 * Today answers two questions (BRIEF.md amendment 2026-10-24 19:55Z; the lead's hybrid pick at 22:05Z).
 * Q1, what needs me and what do I do: a 48 px line from the host's needs-you items, Drew's own first, each with its control.
 * Q2, is research working: one row per play with a measured state (moving, stuck, regressed) from the host's trend, the
 * plays no check measures as one finding, and the solved ones as one line. Clean-run health is Fleet's, not Today's.
 */
type Play = { play: string; title: string; view: HostView }
type Movement = ViewTrend['movement']

const ORDER: Record<Movement, number> = { regressed: 0, stuck: 1, moving: 2, solved: 3 }
const WORD: Record<Movement, string> = { regressed: 'Regressed', stuck: 'Stuck', moving: 'Moving', solved: 'Solved' }
const playHref = (play: string, tab?: string) => `/play/${encodeURIComponent(play)}${tab ? `?tab=${tab}` : ''}`

const hoursSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / 3_600_000) : null)
const ago = (h: number | null) => (h === null ? '' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`)

/** A recorded reason in plain words: its "who:" prefix, parentheses and later clauses dropped (the full text is its title). */
const plainReason = (reason: string) => reason.replace(/^[^:]{0,80}:\s*/, '').replace(/\s*\([^)]*\)/g, '').split(/;\s*/)[0]!.replace(/^./, (c) => c.toUpperCase())

/** Drew's items are decisions; every other open item is held by its owner and needs nothing from him. */
function split(items: OverviewAttention[]) {
  const open = items.filter((item) => item.needsYou || item.tone === 'crit')
  return { mine: open.filter((item) => item.owner === 'Drew'), held: open.filter((item) => item.owner !== 'Drew') }
}

/** One of Drew's decisions: the action, why, and the control that does it (the host is read-only, so a control copies its command). */
function Decision({ item, now }: { item: OverviewAttention; now: number }) {
  const why = item.kind === 'standdown'
    ? `Research paused ${ago(hoursSince(item.since, now))}: ${plainReason(item.text.replace(/^Research is stood down:?\s*/, ''))}. Only you can lift it.`
    : plainSummary(item.text, 24)
  return (
    <li className="tj-decision">
      <p><b>{item.action ?? item.text}</b> <span className="tj-muted" title={item.text}>{why}</span></p>
      <span className="rj-decide">
        {(item.options ?? []).map((option) => <CopyButton key={option.verdict} label={option.label} command={option.command} title={option.consequence} />)}
        {!item.options?.length && item.href && <a className="tj-go" href={item.href}>Open</a>}
      </span>
    </li>
  )
}

function CopyButton({ label, command, title }: { label: string; command: string; title?: string }) {
  return <button type="button" title={`${title ? `${title}\n` : ''}${command}`} onClick={(event) => {
    const button = event.currentTarget
    void navigator.clipboard?.writeText(command).then(() => { button.textContent = 'Copied' })
  }}>{label}</button>
}

/** Items their owners hold, one line each: who, since when, doing what. */
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

/** Steps passed at the end of each day as a step line, the flat stretch since the best was reached shaded and labelled. */
function Spark({ trend, now, w = 280, h = 56 }: { trend: ViewTrend; now: number; w?: number; h?: number }) {
  const n = trend.passed.length
  const x = (i: number) => 4 + (i * (w - 8)) / Math.max(1, n - 1)
  const y = (v: number) => h - 6 - (v / Math.max(1, trend.total)) * (h - 22)
  let path = ''
  trend.passed.forEach((v, i) => {
    if (v === null) return
    path += path ? ` H${x(i)} V${y(v)}` : `M${x(i)} ${y(v)}`
  })
  const last = trend.passed.at(-1)
  const flatDays = trend.movement === 'stuck' ? Math.min(n - 1, Math.floor((hoursSince(trend.since, now) ?? 0) / 24)) : 0
  const from = x(n - 1 - flatDays)
  return (
    <svg className={`tj-spark tj-${trend.movement}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`steps passed at the end of each of the last ${n} days: ${trend.passed.map((v) => v ?? 'none').join(', ')} of ${trend.total}`}>
      {flatDays > 0 && (
        <g className="tj-plateau">
          <rect x={from} y={12} width={x(n - 1) - from} height={h - 14} />
          <text x={x(n - 1)} y={10} textAnchor="end">no step gained in {ago(hoursSince(trend.since, now))}</text>
        </g>
      )}
      <line className="tj-spark-top" x1={4} x2={w - 4} y1={y(trend.total)} y2={y(trend.total)} />
      {path && <path d={path} />}
      {last !== null && last !== undefined && <circle cx={x(n - 1)} cy={y(last)} r={3} />}
    </svg>
  )
}

function moveLine(trend: ViewTrend, now: number) {
  if (trend.movement === 'stuck') return `${ago(hoursSince(trend.since, now))} at ${trend.best}/${trend.total}`
  if (trend.movement === 'regressed') return `${trend.newest.release} passes ${trend.newest.passed}/${trend.total}, best ${trend.best}/${trend.total}`
  if (trend.movement === 'moving') return `reached ${trend.best}/${trend.total} ${ago(hoursSince(trend.since, now))} ago`
  return `all ${trend.total} steps`
}

/** What holds the play, in plain words with who acts: the host's blocker action and owner. */
function holdLine(view: HostView) {
  const blocker = view.blocker
  if (!blocker) return null
  const action = blocker.action ?? plainSummary(blocker.text, 16)
  return `${blocker.owner === 'Drew' ? 'You' : blocker.owner ?? 'Its owner'}: ${action.charAt(0).toLowerCase()}${action.slice(1)}.`
}

function TodayView({ doc }: { doc: OverviewDocument }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const { mine, held } = split(doc.attention ?? [])
  const plays = (doc.plays ?? []) as Play[]
  const measured = plays.filter((p): p is Play & { view: { trend: ViewTrend } } => Boolean(p.view.trend) && p.view.trend!.movement !== 'solved')
    .sort((a, b) => ORDER[a.view.trend.movement] - ORDER[b.view.trend.movement])
  const solved = plays.filter((p) => p.view.status.key === 'solved')
  const blind = plays.filter((p) => !p.view.trend && p.view.status.key !== 'solved')
  const active = measured.length + blind.length
  const count = (m: Movement) => measured.filter((p) => p.view.trend.movement === m).length
  return (
    <div className="ws-page td tj" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: doc.composedAt, meaning: `when the host composed this page (${hm(doc.composedAt)})`, source: 'the Discovery overview' }} />
      </header>
      <section className="tj-q1" aria-label="What needs you">
        <p className="tj-hero">{mine.length ? `${mine.length} ${mine.length === 1 ? 'decision needs' : 'decisions need'} you.` : 'Nothing needs you.'}</p>
        <p className="tj-second">{count('moving')} moving, {count('stuck')} stuck, {count('regressed')} regressed{blind.length ? `, ${blind.length} not measured` : ''} this week.</p>
        {mine.length > 0 && <ul className="tj-decisions">{mine.map((item) => <Decision key={item.text} item={item} now={now} />)}</ul>}
        <Held items={held} />
      </section>
      <section className="tj-q2" aria-label="Is research working">
        {measured.length > 0 && (
          <ul className="tj-rows">
            {measured.map(({ play, title, view }) => (
              <li key={play}>
                <a className="tj-row-title" href={playHref(play)}>{title}</a>
                <span className="tj-ladder">
                  <span className="tj-steps">{view.progress?.steps.map((step, i) => <i key={i} data-step={step.state} title={step.label} />)}</span>
                  <span className="tj-num">{view.trend.best}/{view.trend.total}</span>
                </span>
                <Spark trend={view.trend} now={now} />
                <span className="tj-state">
                  <b className={`tj-word tj-${view.trend.movement}`}>{WORD[view.trend.movement]}</b> {moveLine(view.trend, now)}
                  {holdLine(view) && <span className="tj-muted tj-hold">{holdLine(view)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {blind.length > 0 && (
          <p className="tj-finding">
            <b>{blind.length} of {active} active plays have no check that counts steps, so we cannot tell if they move.</b>{' '}
            <span className="tj-muted">Fix: </span>
            {blind.map((p, i) => <span key={p.play}>{i ? ', ' : ''}<a href={playHref(p.play, 'setup')} title={`${p.title}: set up a check that counts steps`}>{p.title}</a></span>)}
          </p>
        )}
        {solved.length > 0 && <p className="tj-rest">Solved this week: {solved.map((p, i) => <span key={p.play}>{i ? ', ' : ''}<a href={playHref(p.play)}>{p.title}</a></span>)}.</p>}
      </section>
    </div>
  )
}

export function TodayPage({ api }: { api: string }) {
  const doc = useDocument<OverviewDocument>(`${api}/overview`, 60_000, true)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">Today is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Reading what needs you…</p>
  return <TodayView doc={doc.data} />
}
