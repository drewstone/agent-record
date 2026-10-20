import type { ChartBand, ChartMark, TimelineLane } from '@tangle-network/charts'
import { TimelineView } from '@tangle-network/charts/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayDocument } from '../workspace.js'
import { useDocument } from './data.js'
import { type PlayHead, shortRun } from './play-standing.js'

type Play = PlayDocument & PlayHead

/** One run's team as the Lab receipt records it (`timeline.lanes`, bands and marks), passed through by the host. */
interface Team {
  runId: string
  start?: string | null
  end?: string | null
  deadline?: string | null
  lanes?: Array<Record<string, unknown>>
  bands?: Array<Record<string, unknown>>
  marks?: Array<Record<string, unknown>>
  missing?: { why: string } | null
}

const time = (value: unknown) => (typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN)
/** Two teams on the first screen of the Standing tab; more on request. */
const PAGE = 2

/** The receipt names a child lane `<parent>:<child>`; a lane without a recorded parent hangs from that, else from the root. */
const parentOf = (id: string, ids: Set<string>) => {
  const cut = id.lastIndexOf(':')
  if (cut > 0 && ids.has(id.slice(0, cut))) return id.slice(0, cut)
  return id !== 'root' && ids.has('root') ? 'root' : undefined
}

/** Marks a team panel draws: releases, rulings, steers, deaths, deadlines and passes; wakes and events stay in the run page. */
const TEAM_MARKS = new Set(['release', 'ruling', 'steer', 'died', 'deadline', 'pass'])

function lanesOf(team: Team): TimelineLane[] {
  const ids = new Set((team.lanes ?? []).map((lane) => String(lane.id)))
  return (team.lanes ?? []).map((lane) => ({
    ...(lane as unknown as TimelineLane),
    ...(lane.parent === undefined && parentOf(String(lane.id), ids) ? { parent: parentOf(String(lane.id), ids) } : {}),
    spans: ((lane.spans as Array<Record<string, unknown>>) ?? []).map((span) => ({
      start: time(span.start),
      end: span.end === null || span.end === undefined ? null : time(span.end),
      state: String(span.state ?? 'unknown'),
      ...(span.note ? { note: String(span.note) } : {}),
    })),
    ...(Array.isArray(lane.ticks) ? { ticks: (lane.ticks as Array<Record<string, unknown>>).map((tick) => ({ ...tick, at: time(tick.at) })) as TimelineLane['ticks'] } : {}),
  }))
}

function TeamPanel({ play, team, hoursAxis }: { play: Play; team: Team; hoursAxis: number }) {
  const lanes = useMemo(() => lanesOf(team), [team])
  const start = time(team.start ?? lanes[0]?.spans[0]?.start)
  const end = Number.isFinite(time(team.end)) ? time(team.end) : Date.now()
  const options = useMemo(() => {
    const marks: ChartMark[] = (team.marks ?? [])
      .map((mark) => ({ ...(mark as unknown as ChartMark), at: time(mark.at ?? mark.t) }))
      .filter((mark) => Number.isFinite(mark.at) && mark.at >= start && TEAM_MARKS.has(mark.kind))
    const bands: ChartBand[] = (team.bands ?? []).map((band) => ({ ...(band as unknown as ChartBand), from: time(band.from), to: time(band.to) })).filter((band) => Number.isFinite(band.from) && Number.isFinite(band.to) && band.to > band.from)
    const axisEnd = Math.max(end, start + hoursAxis * 3_600_000)
    return {
      measure: 'Agent time',
      start,
      end: axisEnd,
      now: Math.min(Date.now(), axisEnd),
      marks: marks.filter((mark) => mark.at <= axisEnd),
      bands: bands.map((band) => ({ ...band, from: Math.max(start, band.from), to: Math.min(axisEnd, band.to) })).filter((band) => band.to > band.from),
      formatTime: (value: number) => `${Math.round((value - start) / 3_600_000)} h`,
      id: `team-${team.runId}`,
    }
  }, [team, start, end, hoursAxis])
  const folded = useMemo(() => lanes.filter((lane) => (lane.depth ?? (lane.parent ? 1 : 0)) >= 1 && lanes.some((other) => other.parent === lane.id)).map((lane) => lane.id), [lanes])
  return (
    <figure className="team-panel" data-team={team.runId}>
      <figcaption>
        <a className="mono" href={`/run/${encodeURIComponent(team.runId)}`}>{shortRun(play.id, team.runId)}</a>
        <span className="faint"> · {lanes.length} agents</span>
      </figcaption>
      {team.missing ? <p className="faint">{team.missing.why}</p> : Number.isFinite(start) ? <TimelineView lanes={lanes} options={options} defaultCollapsed={folded} /> : <p className="faint">No start time recorded.</p>}
      {lanes.length > 0 && (
        <p className="team-agents faint" aria-label="Open an agent's conversation">
          Open{' '}
          {lanes.map((lane, i) => {
            const role = typeof (lane as { profile?: unknown }).profile === 'string' ? String((lane as { profile?: unknown }).profile) : (lane.label.split(' · ')[0] ?? lane.id)
            const node = lane.id === team.runId || lane.id === 'root' || lane.id.endsWith('-root') ? 'root' : lane.id
            return (
              <span key={lane.id}>
                {i > 0 && ' · '}
                <a href={`/run/${encodeURIComponent(team.runId)}?agent=${encodeURIComponent(node)}`} title={`${lane.label} (${node})`}>
                  {node === 'root' ? 'root' : role === node ? role : `${role} (${node})`}
                </a>
              </span>
            )
          })}
        </p>
      )}
    </figure>
  )
}

/**
 * Team shape per run (chart d): each multi-agent run's agent timeline, on one hours-since-start axis, folded below
 * depth 1, with attempt ticks by outcome and quota walls as blocked bands. Loads when scrolled into view.
 */
const LOADING_LIMIT_MS = 10_000

export function PlayTeams({ api, play }: { api: string; play: Play }) {
  // An index group's runs are unrelated plays: a team view across them says nothing.
  const rows = play.standing?.status === 'group' ? [] : (play.ledger?.rows ?? [])
  // An unknown agent count (null) is not one agent: its receipt timeline says how the run staffed itself.
  const multi = rows.filter((row) => row.agents === null || row.agents === undefined || row.agents >= 2)
  const single = rows.filter((row) => row.agents === 1)
  const [shown, setShown] = useState(PAGE)
  const [visible, setVisible] = useState(false)
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    if (visible || !box.current) return
    if (typeof IntersectionObserver === 'undefined') return setVisible(true)
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setVisible(true), { rootMargin: '400px' })
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [visible])
  const ids = multi.slice(0, shown).map((row) => row.runId)
  const url = visible && ids.length ? `${api}/plays/${encodeURIComponent(play.id)}/teams?runs=${ids.map(encodeURIComponent).join(',')}` : null
  const teams = useDocument<Team[]>(url)
  // A loading line lasts only while its request is in flight, and at most 10 s (design-system section 2).
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!url || !teams.loading) return
    const timer = window.setTimeout(() => setLate(true), LOADING_LIMIT_MS)
    return () => window.clearTimeout(timer)
  }, [url, teams.loading])
  // An index group has no play file and no teams to compare (3.10).
  if (play.standing?.status === 'group' || (!multi.length && !single.length)) return null
  const hoursAxis = Math.max(1, ...multi.slice(0, shown).map((row) => row.wallHours ?? 0))
  return (
    <section ref={box} className="ws-section play-teams" data-play-teams aria-label="Team shape">
      <header className="section-head">
        <h3>Team shape</h3>
        <p className="faint">How each run staffed itself and where its attempts ended, on one hours-since-start axis. Click a lane label to fold it.</p>
      </header>
      {multi.length > 0 && (
        <div className="team-grid">
          {!visible ? null : teams.loading && late ? (
            <p className="ws-status faint">Teams unavailable: no answer in {LOADING_LIMIT_MS / 1000} s</p>
          ) : teams.loading ? (
            <p className="ws-status" role="status">Loading teams…</p>
          ) : teams.error ? (
            <p className="ws-status faint">Teams unavailable: {teams.error}</p>
          ) : (
            (teams.data ?? []).filter((team) => team.missing || team.lanes?.length).map((team) => <TeamPanel key={team.runId} play={play} team={team} hoursAxis={hoursAxis} />)
          )}
        </div>
      )}
      {multi.length > shown && (
        <button type="button" className="link-button" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, multi.length - shown)} more of {multi.length - shown}
        </button>
      )}
      {single.length > 0 && (
        <details className="team-single-group" open={single.length <= 4}>
          <summary className="faint">
            {single.length} {single.length === 1 ? 'run' : 'runs'} ran a root only
          </summary>
        <ul className="team-single faint">
          {single.map((row) => {
            const tries = Object.values(row.triesByOutcome ?? {}).reduce((sum, value) => sum + value, 0)
            const top = Object.entries(row.triesByOutcome ?? {}).sort((a, b) => b[1] - a[1])[0]
            return (
              <li key={row.runId}>
                <a className="mono" href={`/run/${encodeURIComponent(row.runId)}`}>{shortRun(play.id, row.runId)}</a> root only
                {tries ? ` · ${tries} attempts${top ? (top[1] === tries ? `, all ${top[0]}` : `, most ${top[0]}`) : ''}` : ''}
                {row.ending?.word ? ` · ${row.ending.word}` : ''}
              </li>
            )
          })}
        </ul>
        </details>
      )}
    </section>
  )
}
