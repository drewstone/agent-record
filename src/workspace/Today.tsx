import { useState } from 'react'
import type { OverviewAttention, OverviewDocument } from '../overview-model.js'
import { AsOfStamp } from './AnswerStrip.js'
import { attentionStatus, CLEAN_RUN_TARGET, hm } from './answers.js'
import { StatusPill, useDocument } from './data.js'
import { type ReliabilityDocument, settledOf } from './reliability-model.js'
import { viewChip } from './view.js'

/**
 * Today: the Discovery home. Its first screen answers, in order, what needs Drew (with the exact action), what is
 * running, and whether runs end clean; below it each play active this week in one line. Every status, sentence and
 * needs-you item is the host's view (views.py), the same words the play and run pages print.
 */
type TodayDocument = OverviewDocument

/** Wilson score interval at 95%: the honest range of a rate measured on n runs. */
export function wilson(successes: number, n: number): [number, number] | null {
  if (!n) return null
  const z = 1.96
  const p = successes / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}
const pct = (value: number) => `${Math.round(value * 100)}%`
/** `2026-10-18` as `Oct 18`, never cut. */
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function NeedsYou({ items }: { items: OverviewAttention[] }) {
  const needs = items.filter((item) => item.needsYou || item.tone === 'crit')
  return (
    <section className="td-hero" aria-labelledby="td-needs">
      <h2 id="td-needs" className="td-label">Needs you</h2>
      <p className="td-big" data-count={needs.length}>{needs.length || '✓'}<span>{needs.length ? (needs.length === 1 ? 'decision' : 'decisions') : 'Nothing needs you'}</span></p>
      {needs.length > 0 && (
        <ul className="td-needs">
          {needs.map((item) => {
            const status = attentionStatus(item)
            return (
              <li key={item.text}>
                <StatusPill status={status} />
                <div>
                  <p className="td-need-text">{item.text}</p>
                  <p className="td-sub">{[item.owner ? `Owner: ${item.owner}` : null, item.next].filter(Boolean).join(' · ')}</p>
                </div>
                {item.href && <a className="td-go" href={item.href}>Open</a>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Running({ doc }: { doc: TodayDocument }) {
  const now = doc.now ?? []
  const standdown = doc.state.standdown
  return (
    <section className="td-card" aria-labelledby="td-running">
      <h2 id="td-running" className="td-label">Running now</h2>
      <p className="td-big">{now.length}<span>{now.length === 1 ? 'run' : 'runs'} · {doc.state.queued} queued</span></p>
      {now.length === 0 ? (
        <p className="td-sub">{standdown ? `Research is stood down: ${standdown.reason ?? 'no reason recorded'}` : 'No run is live.'}</p>
      ) : (
        <ul className="td-runs">
          {now.map((run) => (
            <li key={run.runId}>
              <a href={`/run/${encodeURIComponent(run.runId)}`}>
                <b>{run.title}</b>
                {run.view && <StatusPill status={viewChip(run.view.status)} />}
              </a>
              <p className="td-sub">{run.view?.progress?.sentence ?? run.view?.sentence ?? run.purpose}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Clean runs per day: a dot at the day's rate with its 95% interval, hollow when fewer than 5 runs settled. */
function CleanRuns({ reliability }: { reliability: ReliabilityDocument | undefined }) {
  if (!reliability || reliability.schema !== 'discovery-lab.reliability.v1') return null
  // Every date the producer's rolling window touches (7 x 24 h spans 8 dates), so the dots' n add up to the headline.
  const days = reliability.daily
  const week = reliability.runs
  const ci = wilson(week.clean, week.settled)
  const w = 420
  const h = 112
  const x = (i: number) => 28 + (i * (w - 56)) / Math.max(1, days.length - 1)
  const y = (v: number) => 8 + (1 - v) * (h - 48)
  return (
    <section className="td-card" aria-labelledby="td-clean">
      <h2 id="td-clean" className="td-label">Runs ending clean · 7 days</h2>
      <p className="td-big">{week.settled ? pct(week.clean / week.settled) : '—'}<span>{week.clean} of {week.settled} settled{ci ? ` · 95% range ${pct(ci[0])}–${pct(ci[1])}` : ''}</span></p>
      <svg className="td-dots" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={days.map((d) => `${d.day}: ${d.clean} of ${settledOf(d)}`).join('; ')}>
        <line className="td-target" x1={x(0) - 14} x2={x(days.length - 1) + 14} y1={y(CLEAN_RUN_TARGET)} y2={y(CLEAN_RUN_TARGET)} />
        <text className="td-target-label" x={x(days.length - 1) + 16} y={y(CLEAN_RUN_TARGET) + 4}>{pct(CLEAN_RUN_TARGET)}</text>
        {days.map((day, i) => {
          const n = settledOf(day)
          const band = wilson(day.clean, n)
          if (!n || !band) return <g key={day.day}><text x={x(i)} y={h - 20} textAnchor="middle">{dayLabel(day.day)}</text><text x={x(i)} y={h - 4} textAnchor="middle" className="td-n">—</text></g>
          const rate = day.clean / n
          return (
            <g key={day.day}>
              <line x1={x(i)} x2={x(i)} y1={y(band[1])} y2={y(band[0])} />
              <circle cx={x(i)} cy={y(rate)} r={4} data-hollow={n < 5 || undefined} />
              <text x={x(i)} y={h - 20} textAnchor="middle">{dayLabel(day.day)}</text>
              <text x={x(i)} y={h - 4} textAnchor="middle" className="td-n">{`n=${n}`}</text>
            </g>
          )
        })}
      </svg>
      <p className="td-sub">{reliability.lostAgentHours !== null ? `${Math.round(reliability.lostAgentHours)} agent-hours lost to failures this week` : 'agent-hours lost unknown'}</p>
    </section>
  )
}

/** A source older than this is named stale: reliability.json is rewritten every few minutes, so an hour means its writer stopped. */
const STALE_AFTER_MS = 60 * 60_000

/**
 * The one chip for sources behind the page's single freshness dot: a source the page prints that is old or unreadable
 * collapses into "1 source stale", its name and age in the tip, instead of a panel or a second time stamp.
 */
function StaleSources({ reliability, failed }: { reliability: ReliabilityDocument | undefined; failed: boolean }) {
  const stale: string[] = []
  if (failed) stale.push('run reliability: unreadable')
  else if (reliability?.at && Date.now() - Date.parse(reliability.at) > STALE_AFTER_MS) stale.push(`run reliability: written ${hm(reliability.at)}`)
  if (!stale.length) return null
  return (
    <span className="td-stale" title={stale.join('; ')} role="status">
      {stale.length} {stale.length === 1 ? 'source' : 'sources'} stale
    </span>
  )
}

const PLAYS_SHOWN = 8
/** Each play active this week: those that need Drew first, then solved, then the rest by newest activity. */
function Plays({ plays }: { plays: NonNullable<OverviewDocument['plays']> }) {
  const [all, setAll] = useState(false)
  if (!plays.length) return null
  const rank = (view: (typeof plays)[number]['view']) => (view.needsYou.length ? 0 : view.status.key === 'live' ? 1 : view.status.key === 'solved' ? 2 : 3)
  const ordered = [...plays].sort((a, b) => rank(a.view) - rank(b.view))
  const shown = all ? ordered : ordered.slice(0, PLAYS_SHOWN)
  return (
    <section className="td-plays" aria-labelledby="td-plays">
      <h2 id="td-plays" className="td-label">Plays this week · {plays.length}</h2>
      <ul>
        {shown.map(({ play, title, view }) => (
          <li key={play}>
            <a href={`/play/${encodeURIComponent(play)}`}>
              <StatusPill status={viewChip(view.status)} />
              <b>{title}</b>
              {view.progress ? (
                <span className="td-steps" aria-label={view.progress.sentence}>
                  {view.progress.steps.map((step, i) => <i key={i} data-step={step.state} />)}
                  <em>{view.progress.passed}/{view.progress.total}</em>
                </span>
              ) : <span className="td-steps is-empty">no release scored</span>}
              <span className="td-play-line">{view.needsYou.length ? `Needs you: ${view.needsYou[0]!.text}` : view.sentence.replace(/^[^.]*\.\s*/, '') || view.progress?.sentence}</span>
            </a>
          </li>
        ))}
      </ul>
      {plays.length > PLAYS_SHOWN && <button type="button" className="td-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${plays.length} plays`}</button>}
    </section>
  )
}

export function TodayPage({ api }: { api: string }) {
  const doc = useDocument<TodayDocument>(`${api}/overview`, 60_000, true)
  const reliability = useDocument<ReliabilityDocument>(`${api}/reliability`)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">Today is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Reading what needs you…</p>
  const d = doc.data
  return (
    <div className="ws-page td" data-mode="today">
      <header className="td-head">
        <h1>Today</h1>
        <AsOfStamp asOf={{ at: d.composedAt, meaning: `when the host composed this page (${hm(d.composedAt)})`, source: 'the Discovery overview' }} />
        <StaleSources reliability={reliability.data} failed={Boolean(reliability.error && !reliability.data)} />
      </header>
      <NeedsYou items={d.attention ?? []} />
      <div className="td-row">
        <Running doc={d} />
        <CleanRuns reliability={reliability.data} />
      </div>
      <Plays plays={d.plays ?? []} />
    </div>
  )
}
