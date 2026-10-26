import type { OverviewAttention, OverviewDocument } from '../overview-model.js'
import { Lines } from '@tangle-network/charts/react'
import { AsOfStamp, Tip } from './AnswerStrip.js'
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
    ? `Research paused ${ago(hoursSince(item.since, now))}: ${plainReason(item.text.replace(/^Research is stood down:?\s*/, ''))}.`
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

/**
 * Is it moving (Q1): every checked release as a dot at its steps passed, the best so far as a step line under the play's
 * step count, over the releases the host's trend lists; hovering names the release at that time.
 */
function TrendChart({ trend }: { trend: ViewTrend }) {
  const checks = (trend.series ?? []).map((point) => ({ t: Date.parse(point.at), ...point })).filter((point) => Number.isFinite(point.t))
  if (!checks.length) return null
  let best = 0
  const bestLine = checks.map((point) => [point.t, (best = Math.max(best, point.passed))] as [number, number])
  const release = (t: number) => { const point = checks.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)); return `${point.release}${point.runId ? ` (${point.runId.slice(-3)})` : ''}` }
  const span = [checks[0]!.t, checks.at(-1)!.t]
  return (
    <div className="tj-chart">
      <Lines rows={12} format={(v) => `${v}`} series={[
        { name: 'checked release', color: 'var(--ar-c-info)', points: checks.map((point) => [point.t, point.passed]), dots: true, label: release },
        { name: 'best so far', color: `var(--ar-c-${trend.movement === 'moving' ? 'ok' : trend.movement === 'regressed' ? 'fail' : 'run'})`, points: bestLine },
        { name: `all ${trend.total} steps`, color: 'var(--ar-fg-faint)', points: span.map((t) => [t, trend.total] as [number, number]), dash: 'dash' },
      ]} />
    </div>
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
  // The play page's sentence, word for word (review 2 #3): "<owner> will <action>."
  return `${blocker.owner === 'Drew' ? 'You' : blocker.owner ?? 'Its owner'} will ${action.charAt(0).toLowerCase()}${action.slice(1)}.`
}

/** A group's short label: what holds its plays, by the blocker's kind, or that no check counts their steps. */
const groupLabel = (play: Play, reason: string | null) =>
  !reason ? 'No step check' : play.view.blocker?.kind === 'stopped' ? 'Stopped' : play.view.blocker?.owner === 'Drew' ? 'Waiting on you' : 'Blocked'

/** Plays grouped by what holds them, the largest group first; plays nothing holds group under null (they need a check). */
function groups(plays: Play[]): [string | null, Play[]][] {
  const by = new Map<string | null, Play[]>()
  for (const p of plays) by.set(holdLine(p.view), [...(by.get(holdLine(p.view)) ?? []), p])
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
}

function TodayView({ doc }: { doc: OverviewDocument }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const { mine, held } = split(doc.attention ?? [])
  const plays = (doc.plays ?? []) as Play[]
  const measured = plays.filter((p): p is Play & { view: { trend: ViewTrend } } => Boolean(p.view.trend) && p.view.trend!.movement !== 'solved')
    .sort((a, b) => ORDER[a.view.trend.movement] - ORDER[b.view.trend.movement])
  const solved = plays.filter((p) => p.view.status.key === 'solved')
  const blind = plays.filter((p) => !p.view.trend && p.view.status.key !== 'solved')
  const count = (m: Movement) => measured.filter((p) => p.view.trend.movement === m).length
  return (
    <div className="ws-page td tj" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: doc.composedAt, meaning: `when the host composed this page (${hm(doc.composedAt)})`, source: 'the Discovery overview' }} />
      </header>
      <section className="tj-q1" aria-label="What needs you">
        <p className="tj-hero">{mine.length ? `${mine.length} ${mine.length === 1 ? 'decision needs' : 'decisions need'} you.` : 'Nothing needs you.'}</p>
        {/* Plain words, not the trend's states (review 4 #8: "0 moving, 1 stuck" read as jargon). */}
        <p className="tj-second">{[count('moving') && `${count('moving')} gaining steps`, count('stuck') && `${count('stuck')} not gaining`, count('regressed') && `${count('regressed')} lost steps`].filter(Boolean).join(', ') || 'No measured play changed'} this week.</p>
        {mine.length > 0 && <ul className="tj-decisions">{mine.map((item) => <Decision key={item.text} item={item} now={now} />)}</ul>}
        <Held items={held} />
      </section>
      <section className="tj-q2" aria-label="Is research working">
        {measured.length > 0 && (
          <ul className="tj-rows" data-primary-content>
            {measured.map(({ play, title, view }) => (
              <li key={play}>
                <span className="tj-row-head">
                <a className="tj-row-title" href={playHref(play)}>{title}</a>
                <Tip className="tj-ladder" text={`${view.trend.best} of ${view.trend.total} steps passed${view.progress?.steps.length ? `: ${view.progress.steps.map((step) => `${step.label} ${step.state}`).join(', ')}` : ''}`}>
                  <span className="tj-steps">{view.progress?.steps.map((step, i) => <i key={i} data-step={step.state} title={step.label} />)}</span>
                  <span className="tj-num">{view.trend.best}/{view.trend.total}</span>
                </Tip>
                <span className="tj-state">
                  <b className={`tj-word tj-${view.trend.movement}`}>{WORD[view.trend.movement]}</b> {moveLine(view.trend, now)}
                  {holdLine(view) && <span className="tj-muted tj-hold">{holdLine(view)}</span>}
                </span>
                </span>
                <TrendChart trend={view.trend} />
              </li>
            ))}
          </ul>
        )}
        {blind.length > 0 && (
          <>
            {/* One row per reason, its plays named (REVIEW-5 #7: four rows said the same sentence, seven the same link). */}
            {/* Neutral and plain: amber under "Nothing needs you." read as a contradiction (REVIEW-6 #4). */}
            <h2 className="tj-finding"><b>{blind.length} {blind.length === 1 ? "play can't" : "plays can't"} show progress yet</b></h2>
            {/* A short label and count above each list, folded, the reason inside (REVIEW-7 #3: a 350 px gap between sentence
                labels and their links). */}
            <div className="tj-blind">
              {groups(blind).map(([reason, plays]) => (
                <details key={reason ?? ''}>
                  <summary><b>{groupLabel(plays[0]!, reason)}</b> <span className="tj-muted">{plays.length}</span></summary>
                  {reason && <p className="tj-muted">{reason}</p>}
                  <span className="tj-names">{plays.map((p) => <a key={p.play} href={playHref(p.play, reason ? undefined : 'setup')}>{p.title}</a>)}</span>
                </details>
              ))}
            </div>
          </>
        )}
        {solved.length > 0 && (
          <details className="tj-solved">
            <summary><b>Solved</b> <span className="tj-muted">{solved.length}</span></summary>
            <span className="tj-names">{solved.map((p) => <a key={p.play} href={playHref(p.play)}>{p.title}</a>)}</span>
          </details>
        )}
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
