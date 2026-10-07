import { useMemo, useState } from 'react'
import type { FindingsFeedDocument } from '../workspace.js'
import { stateClass, useDocument } from './data.js'

const KINDS = [
  ['all', 'All'],
  ['ledger', 'Agent results'],
  ['claim', 'Claims'],
] as const
type Kind = (typeof KINDS)[number][0]

const day = (value: string | null | undefined) => (value ? `${value.slice(5, 10)} ${value.slice(11, 16)} UTC` : 'time unknown')
const short = (label: string | null | undefined) => (label ? label.split(' · ')[0]! : 'agent')
const shortRunId = (play: string, runId: string) => (runId.startsWith(`${play}-`) ? runId.slice(play.length + 1) : runId)
// A card shows prose: markdown emphasis, code ticks and list bullets from the page are dropped, the words kept.
const plain = (text: string) => text.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*]|\d+\.)\s+/, '')

/**
 * The Discovery home: what the fleet found, newest first, from every programmed run's knowledge pages. A run whose
 * driver failed after an agent proved something shows here like a winner, marked by how it ended; each card opens the
 * run's findings.
 */
export function FindingsFeed({ api }: { api: string }) {
  const feed = useDocument<FindingsFeedDocument>(`${api}/findings`)
  const [kind, setKind] = useState<Kind>('all')
  const [program, setProgram] = useState('')
  const programs = useMemo(() => [...new Set((feed.data?.items ?? []).map((item) => item.program ?? '').filter(Boolean))].sort(), [feed.data])
  const items = useMemo(
    () =>
      (feed.data?.items ?? []).filter(
        (item) => (!program || item.program === program) && (kind === 'all' || (kind === 'ledger' ? item.ledger : !item.ledger && item.kind === 'claim')),
      ),
    [feed.data, kind, program],
  )
  if (feed.error && !feed.data) return <p className="ws-status" role="alert">Findings are unavailable: {feed.error}</p>
  if (!feed.data) return <p className="ws-status" role="status">Gathering what the runs found…</p>
  const runs = feed.data.runs
  return (
    <section className="findings-feed" aria-label="What Discovery found" data-findings-feed={items.length}>
      <div className="feed-head">
        <div>
          <h2 className="kicker tone-finding">What the runs found</h2>
          <p className="faint">
            Since {feed.data.since}: {runs.withFindings} of {runs.considered} runs left findings, {runs.results} results and {runs.claims} claims. Every one
            is the agents' own work; outside acceptance is unassessed unless the run says otherwise.
          </p>
        </div>
        <div className="feed-filters">
          <div role="group" aria-label="Kind" className="chip-group">
            {KINDS.map(([value, label]) => (
              <button key={value} type="button" className={`filter-chip ${kind === value ? 'on' : ''}`} aria-pressed={kind === value} onClick={() => setKind(value)}>
                {label}
              </button>
            ))}
          </div>
          <select aria-label="Program" value={program} onChange={(event) => setProgram(event.target.value)}>
            <option value="">All programs</option>
            {programs.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="ws-status">No findings match.</p>
      ) : (
        <ol className="feed-grid">
          {items.map((item) => (
            <li key={`${item.runId}:${item.sha256}`}>
              <a className="feed-card" href={`/run/${encodeURIComponent(item.runId)}?section=findings`}>
                <span className="feed-meta">
                  <span className="mono clamp-1" title={item.runId}>{item.play} · {shortRunId(item.play, item.runId)}</span>
                  <span className={`state-pill ${stateClass(item.state)}`}>{(item.state ?? 'state unknown').replaceAll('-', ' ')}</span>
                </span>
                <span className="feed-title">{item.ledger ? `${short(item.agentLabel)}'s result` : item.title}</span>
                <span className="feed-text clamp-3">{plain(item.text)}</span>
                <span className="feed-tags">
                  <span className={`ftag kind-${item.kind}`}>{item.ledger ? 'result ledger' : item.kind}</span>
                  {item.class && <span className="ftag tone-neutral">{item.class.toLowerCase()}</span>}
                  <span className="faint mono">{short(item.agentLabel)} · {day(item.at)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
