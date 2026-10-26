import type { OverviewAttention, OverviewDocument } from '../overview-model.js'
import { AsOfStamp, Tip } from './AnswerStrip.js'
import { hm } from './answers.js'
import { BarStrip } from './BarStrip.js'
import { TrendChart } from './TrendChart.js'
import { StatusPill, useDocument } from './data.js'
import { shortRun } from './play-standing.js'
import { type HostView, type ViewTrend, viewChip } from './view.js'

/**
 * Today answers two questions (BRIEF.md amendment 2026-10-24 19:55Z; the lead's hybrid pick at 22:05Z).
 * Q1, what needs me and what do I do: a 48 px line from the host's needs-you items, Drew's own first, each with its control.
 * Q2, is research working: one row per play with a measured state (moving, stuck, regressed) from the host's trend, the
 * plays no check measures as one finding, and the solved ones as one line. Clean-run health is Fleet's, not Today's.
 */
type Play = { play: string; title: string; view: HostView }
type Movement = ViewTrend['movement']

const ORDER: Record<Movement, number> = { regressed: 0, stuck: 1, moving: 2, solved: 3 }
const playHref = (play: string, tab?: string) => `/play/${encodeURIComponent(play)}${tab ? `?tab=${tab}` : ''}`

const hoursSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / 3_600_000) : null)
const ago = (h: number | null) => (h === null ? '' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`)

/** One of the owner's decisions (the host's needsYou): the host's sentence, what waiting costs, and for the writer the control that does it (a control copies its command). */
function Decision({ item, writer }: { item: OverviewAttention; writer: boolean }) {
  return (
    <li className="tj-decision">
      <p><b>{item.text}</b>{item.consequence && <span className="tj-muted"> {item.consequence}</span>}</p>
      <span className="rj-decide" hidden={!writer}>
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


function moveLine(trend: ViewTrend, now: number) {
  if (trend.movement === 'stuck') return `no new step in ${ago(hoursSince(trend.since, now))}`
  if (trend.movement === 'regressed') return `${trend.newest.release} lost a step`
  return `new step ${ago(hoursSince(trend.since, now))} ago`
}

/** What holds the play: its producer's one sentence, printed as served. */
const holdLine = (view: HostView) => view.blocker ? view.blocker.sentence ?? view.blocker.text : null

/** A group's short label: what holds its plays, by the blocker's kind, or that no check counts their steps. */
const groupLabel = (play: Play, yours: Set<string | undefined>) =>
  !play.view.blocker ? 'No step check' : play.view.blocker.kind === 'stopped' ? 'Stopped' : yours.has(play.play) ? 'Waiting on you' : 'Blocked'

/** Plays grouped by what holds them, the largest group first. */
function groups(plays: Play[], yours: Set<string | undefined>): [string, Play[]][] {
  const by = new Map<string, Play[]>()
  for (const p of plays) by.set(groupLabel(p, yours), [...(by.get(groupLabel(p, yours)) ?? []), p])
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
}

function TodayView({ doc, writer, failing }: { doc: OverviewDocument; writer: boolean; failing?: string }) {
  const now = Date.parse(doc.composedAt) || Date.now()
  const mine = (doc.attention ?? []).filter((item) => item.needsYou)
  const plays = (doc.plays ?? []) as Play[]
  const measured = plays.filter((p): p is Play & { view: { trend: ViewTrend } } => Boolean(p.view.trend) && p.view.trend!.movement !== 'solved')
    .sort((a, b) => ORDER[a.view.trend.movement] - ORDER[b.view.trend.movement])
  const solved = plays.filter((p) => p.view.status.key === 'solved')
  const blind = plays.filter((p) => !p.view.trend && p.view.status.key !== 'solved')
  return (
    <div className="ws-page td tj" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: doc.composedAt, meaning: `when the host composed this page (${hm(doc.composedAt)})`, source: 'the Discovery overview' }} failing={failing} />
      </header>
      <section className="tj-q1" aria-label="What needs you">
        <p className="tj-hero">{mine.length ? `${mine.length} ${mine.length === 1 ? 'decision needs' : 'decisions need'} you.` : 'Nothing needs you.'}</p>
        {mine.length > 0 && <ul className="tj-decisions">{mine.map((item) => <Decision key={item.text} item={item} writer={writer} />)}</ul>}
      </section>
      <section className="tj-q2" aria-label="Is research working">
        {measured.length > 0 && (
          <ul className="tj-rows">
            {measured.map(({ play, title, view }) => (
              <li key={play}>
                <span className="tj-row-head">
                <a className="tj-row-title" href={playHref(play)}>{title}</a>
                <StatusPill status={viewChip(view.status)} />
                <Tip className="tj-ladder" text={`${view.trend.best} of ${view.trend.total} steps passed${view.progress?.steps.length ? `: ${view.progress.steps.map((step) => `${step.label} ${step.state}`).join(', ')}` : ''}`}>
                  <span className="tj-steps">{view.progress?.steps.map((step, i) => <i key={i} data-step={step.state} title={step.label} />)}</span>
                  <span className="tj-num">{view.trend.best}/{view.trend.total}</span>
                </Tip>
                <span className={`tj-move tj-${view.trend.movement}`}>{moveLine(view.trend, now)}</span>
                </span>
                {view.bars?.length ? <BarStrip bars={view.bars} /> : <TrendChart trend={view.trend} />}
                {(doc.now ?? []).filter((run) => run.play === play).map((run) => (
                  <p key={run.runId} className="tj-hold"><a href={`/run/${encodeURIComponent(run.runId)}`}>{shortRun(play, run.runId)}</a> · {run.agents ?? '—'} agents{run.view?.progress?.release ? ` · ${run.view.progress.release}` : ''} · active {ago(hoursSince(run.activeAt, now))} ago</p>
                ))}
                {holdLine(view) && <p className="tj-hold" title={view.blocker?.detail ?? undefined}>{holdLine(view)}</p>}
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
              {groups(blind, new Set(mine.map((item) => item.play))).map(([label, plays]) => (
                <details key={label}>
                  <summary><b>{label}</b> <span className="tj-muted">{plays.length}</span></summary>
                  <span className="tj-names">{plays.map((p) => <a key={p.play} href={playHref(p.play, p.view.blocker ? undefined : 'setup')} title={holdLine(p.view) ?? undefined}>{p.title}</a>)}</span>
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
  const me = useDocument<{ writer: boolean }>(`${api}/me`)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">Today is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Reading what needs you…</p>
  return <TodayView doc={doc.data} writer={me.data?.writer === true} failing={doc.failing} />
}
