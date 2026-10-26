import { ENDING_COLORS, OUTCOME_ORDER } from '@tangle-network/charts'
import { Gantt } from '@tangle-network/charts/react'
import { type ReactNode, useMemo, useState } from 'react'
import type { PlayDocument } from '../workspace-model.js'
import { money, StatusPill, statusOf } from './data.js'
import { useSearch } from './navigation.js'
import { viewChip } from './view.js'
import { checkerLabel, checksByRun, type PlayHead, type PlayLedgerRow, playLineage, releaseName, type RunChecks, seatWords, shortRun, shortTag, stageWords, utc, verdictWord } from './play-standing.js'

type Play = PlayDocument & PlayHead
type SortKey = 'newest' | 'wall' | 'agent' | 'cost' | 'score'

const OUTCOME_WORD: Record<string, string> = { ok: 'ok', quota: 'quota', lost: 'lost', 'rate-limit': 'rate limit', oom: 'OOM', refused: 'refused', aborted: 'aborted', other: 'other' }
/** Colour is state, not cause (REVIEW-9: nine colours): an attempt completed, failed (quota, lost, rate limit, OOM,
 * refused) or ended otherwise; each segment's tooltip names its cause. */
const OUTCOME_STATE: Record<string, 'ok' | 'failed' | 'other'> = { ok: 'ok', quota: 'failed', lost: 'failed', 'rate-limit': 'failed', oom: 'failed', refused: 'failed', aborted: 'other', other: 'other' }
const STATE_COLOR = { ok: 'var(--ar-c-ok)', failed: 'var(--ar-c-fail)', other: 'var(--ar-c-neutral)' } as const

/** The key for outcome bars: the states present, and the open turn when one is. */
export function OutcomeLegend({ outcomes, open }: { outcomes: string[]; open?: boolean }) {
  const states = (['ok', 'failed', 'other'] as const).filter((state) => outcomes.some((outcome) => OUTCOME_STATE[outcome] === state))
  return (
    <ul className="outcome-legend" aria-label="Attempt outcomes">
      {states.map((state) => <li key={state}><i style={{ background: STATE_COLOR[state] }} />{state}</li>)}
      {open && <li><i className="outcome-open" />open turn</li>}
    </ul>
  )
}

type OutcomeRow = Pick<PlayLedgerRow, 'hoursByOutcome' | 'triesByOutcome' | 'open' | 'outcomeBasis' | 'outcomeNotes'>
const notes = (row: OutcomeRow) => (typeof row.outcomeNotes === 'string' ? [row.outcomeNotes] : Array.isArray(row.outcomeNotes) ? row.outcomeNotes : row.outcomeNotes ? Object.entries(row.outcomeNotes).map(([key, value]) => `${key}: ${value}`) : [])

/** A run's agent-hours stacked by attempt outcome on the ledger's shared axis; an open turn is a hatched tail. */
export function OutcomeBar({ row, max }: { row: OutcomeRow; max: number }) {
  const by = row.hoursByOutcome ?? null
  const open = row.open?.hours ?? 0
  const total = Object.values(by ?? {}).reduce((sum, value) => sum + value, 0)
  // No hours recorded is not zero hours.
  if (!total && !open) return <span className="faint" title="attempts not recorded">—</span>
  const parts = OUTCOME_ORDER.filter((outcome) => (by?.[outcome] ?? 0) > 0)
  const title = [
    ...parts.map((outcome) => `${OUTCOME_WORD[outcome]} ${by![outcome]!.toFixed(2)} h${row.triesByOutcome?.[outcome] !== undefined ? ` · ${row.triesByOutcome[outcome]} tries` : ''}`),
    open ? `open turn ${open.toFixed(1)} h${row.open?.since ? ` since ${utc(row.open.since)}` : ''}` : null,
    row.outcomeBasis === 'mapped-causes' ? 'mapped from the older cause keys' : null,
    ...notes(row),
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span className="outcome-bar" title={title} data-outcome-basis={row.outcomeBasis ?? 'none'}>
      <span className="outcome-track" style={{ width: `${Math.max(2, ((total + open) / max) * 100)}%` }}>
        {parts.map((outcome) => (
          <i key={outcome} data-outcome={outcome} title={`${OUTCOME_WORD[outcome]}: ${by![outcome]!.toFixed(1)} h${row.triesByOutcome?.[outcome] !== undefined ? `, ${row.triesByOutcome[outcome]} tries` : ''}`} style={{ flexGrow: by![outcome]!, background: STATE_COLOR[OUTCOME_STATE[outcome] ?? 'other'] }} />
        ))}
        {open > 0 && <i className="outcome-open" title={`open turn: ${open.toFixed(1)} h${row.open?.since ? ` since ${utc(row.open.since)}` : ''}`} style={{ flexGrow: open }} />}
      </span>
      <span className="outcome-total num">{(total + open).toFixed(1)} h</span>
    </span>
  )
}

/** Wall time on the shared axis, hatched where no agent was live. */
function WallBar({ row, max }: { row: PlayLedgerRow; max: number }) {
  const wall = row.wallHours ?? null
  if (wall === null) return <span className="faint">—</span>
  const idle = Math.min(wall, row.idleHours ?? 0)
  return (
    <span className="wall-bar" title={`${wall.toFixed(1)} h wall${idle ? `, ${idle.toFixed(1)} h with no agent live` : ''}`}>
      <span className="wall-track" style={{ width: `${Math.max(2, (wall / max) * 100)}%` }}>
        <i style={{ flexGrow: wall - idle }} />
        {idle > 0 && <i className="wall-idle" style={{ flexGrow: idle }} />}
      </span>
      <span className="num">{wall >= 10 ? Math.round(wall) : wall.toFixed(1)} h</span>
    </span>
  )
}

/**
 * A run's best check. A pass under a checker the play has since replaced reads as that, muted, never as the run's
 * standing; a run whose check prints no score reads as its rows and verdicts, never as "no check".
 */
function Best({ play, row, checks }: { play: Play; row: PlayLedgerRow; checks: RunChecks | undefined }) {
  const best = row.best ?? null
  if (!best) {
    if (!checks?.rows) {
      // Checks that found no release are checks: 19b's 17 rows said "no pushed release tag".
      const untagged = (row as { untaggedChecks?: { rows?: number; line?: string | null; at?: string | null } | null }).untaggedChecks ?? null
      if (untagged?.rows)
        return (
          <span className="ledger-best is-unscored" title={[untagged.line, untagged.at ? `newest ${utc(untagged.at)}` : null].filter(Boolean).join('\n') || undefined}>
            {untagged.rows} {untagged.rows === 1 ? 'check' : 'checks'}, no release
          </span>
        )
      return <span className="faint" title="no check ran">—</span>
    }
    const verdicts = [...new Set(checks.lines.flatMap((line) => line.verdicts))]
    const top = checks.lines[0]
    return (
      <span className="ledger-best is-unscored" title={[`${checks.rows} rows under ${checks.checkers.map((c) => checkerLabel(play.checkers, c)).join(', ')}; the check prints no score`, top ? `most: ${top.count}× ${top.reason}` : null].filter(Boolean).join('\n')}>
        {checks.solved ? `solved ×${checks.solved}` : verdicts.length === 1 ? verdictWord(verdicts[0]) : 'not solved'} <span className="num">×{checks.rows}</span>
      </span>
    )
  }
  // The stage the check stopped at, by name: "6/6" for rc2 read as six of six passed beside the run page's 5 of 6 (REVIEW-5 #1).
  // The stage by the ladder's own label ("hidden test set"), not its key ("hidden").
  const steps = (play as unknown as { view?: { progress?: { steps?: { name: string; label: string }[] } | null } | null }).view?.progress?.steps ?? []
  const stageLabel = steps.find((step) => step.name === best.stage)?.label ?? best.stage
  const stage = best.reached !== null && best.reached !== undefined && best.of ? `reached ${stageLabel ?? `stage ${best.reached} of ${best.of}`}` : null
  const workloads = best.workloads?.total ? `${best.workloads.passed}/${best.workloads.total}` : null
  const current = play.checkers?.find((item) => item.current)?.label ?? null
  const label = best.checker ? checkerLabel(play.checkers, best.checker) : null
  const superseded = !!(current && label && label !== current && best.verdict === 'solved')
  return (
    <span className={`ledger-best verdict-${best.verdict ?? 'none'}${superseded ? ' is-superseded' : ''}`} title={[best.line, stageWords(best), label, superseded ? `superseded by ${current}` : null].filter(Boolean).join('\n')}>
      {superseded ? `passed ${label}` : verdictWord(best.verdict)}
      {stage && !superseded && <span className="num"> · {stage}</span>}
      {workloads && <span className="num"> · {workloads}</span>}
      {!superseded && label && <span className="faint"> {label}</span>}
      {best.tag && <span className="faint mono" title={releaseName(shortTag(best.tag)!, playLineage(play, row.runId))}> {shortTag(best.tag)}</span>}
      {superseded && <span className="faint"> (superseded)</span>}
    </span>
  )
}

function Cost({ row }: { row: PlayLedgerRow }) {
  const cost = row.cost ?? null
  return <ApiCost usd={cost?.apiUsd} provenance={cost ? cost.provenance : 'unmetered'} billedUsd={cost?.billedUsd} />
}

/** An API-equivalent figure as every page prints it: ≥ for a floor, ≈ for an estimate, a titled dash when unpriced. */
export function ApiCost({ usd, provenance, billedUsd }: { usd: number | null | undefined; provenance?: string | null; billedUsd?: number | null }) {
  if (provenance === 'unmetered') return <span className="faint" title="unmetered: no settled attempt to price">—</span>
  if (usd === null || usd === undefined || (usd === 0 && provenance?.endsWith('at least'))) return <span className="unpriced" title="API-equivalent not priced">—</span>
  return (
    <span title={`API-equivalent at list price, ${provenance?.startsWith('per') ? `${provenance}, the run page's figure` : provenance === 'estimated' ? "estimated from Runtime's totals in the receipt" : provenance ?? 'unknown source'}${billedUsd !== null && billedUsd !== undefined ? `; billed ${money(billedUsd)}` : ''}`}>
      {provenance?.endsWith('at least') ? '≥' : provenance === 'estimated' || provenance === 'per call' ? '≈' : ''}{money(usd)}
    </span>
  )
}

function LineageTree({ play, rows, now }: { play: Play; rows: PlayLedgerRow[]; now: number }) {
  const runs = rows.filter((row) => row.startedAt)
  const parentOf = (row: PlayLedgerRow) => (row.lineage?.kind === 'fork' && row.lineage.parentRun && runs.some((r) => r.runId === row.lineage!.parentRun) ? row.lineage.parentRun : null)
  if (!runs.some(parentOf)) return null
  const byStart = (a: PlayLedgerRow, b: PlayLedgerRow) => a.startedAt!.localeCompare(b.startedAt!)
  // Each run under the run it forked from (depth first), so a line of forks reads top to bottom.
  const ordered: PlayLedgerRow[] = []
  const walk = (row: PlayLedgerRow) => {
    ordered.push(row)
    for (const child of runs.filter((r) => parentOf(r) === row.runId).sort(byStart)) walk(child)
  }
  for (const root of runs.filter((row) => !parentOf(row)).sort(byStart)) walk(root)
  const word = (row: PlayLedgerRow) => row.ending?.status?.label ?? row.ending?.word ?? 'unknown'
  const colors: Record<string, string> = {}
  for (const row of ordered) {
    const key = row.ending?.status?.key ?? ''
    colors[word(row)] = ENDING_COLORS[(key === 'unscored' ? 'not solved' : key) as keyof typeof ENDING_COLORS] ?? ENDING_COLORS['not solved']
  }
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return (
    <div className="ledger-lineage" aria-label="Release lineage">
      <Gantt colors={colors} now={now} axis={day} span={(a, b) => `${utc(new Date(a).toISOString())} – ${utc(new Date(b).toISOString())}`}
        rows={ordered.map((row) => ({
          // Labels are right-aligned, so an indent cannot show nesting; each fork names its parent release instead.
          label: `${shortRun(play.id, row.runId)}${parentOf(row) ? ` ← ${shortRun(play.id, row.lineage!.parentRun!)}/${shortTag(row.lineage!.parentTag) ?? '?'}` : ''}`,
          start: Date.parse(row.startedAt!),
          end: row.settledAt ? Date.parse(row.settledAt) : now,
          state: word(row),
          note: parentOf(row) ? `built on ${shortRun(play.id, row.lineage!.parentRun!)}/${shortTag(row.lineage!.parentTag) ?? '?'}${row.lineage?.commit ? `, commit ${row.lineage.commit}` : ''}` : 'started fresh',
        }))} />
    </div>
  )
}

const lineageGlyph = (play: Play, row: PlayLedgerRow) =>
  row.lineage?.kind === 'wrong-base' ? 'wrong base' : playLineage(play, row.runId).from ? `⑂ ${playLineage(play, row.runId).from}` : null

/**
 * The run ledger (charts c and e): for each run its ending, wall time with idle time hatched, agent-hours stacked by
 * attempt outcome on one shared axis, completed share, tries, best score, API-equivalent cost and seat. `full` adds
 * the release lineage above it and how each run's input differs.
 */
export function PlayLedger({ play, full = false, onOpen, now = Date.now(), action }: { play: Play; full?: boolean; onOpen?: (runId: string) => void; now?: number; action?: ReactNode }) {
  const ledger = play.ledger ?? null
  const [params, update] = useSearch()
  const sort: SortKey = (['wall', 'agent', 'cost', 'score'] as const).find((key) => key === params.get('sort')) ?? 'newest'
  const setSort = (next: SortKey) => update({ sort: next === 'newest' ? undefined : next })
  const [idleShown, setIdleShown] = useState(false)
  const checks = useMemo(() => checksByRun(play.climb), [play.climb])
  const rows = useMemo(() => {
    const list = [...(ledger?.rows ?? [])]
    const agentHours = (row: PlayLedgerRow) => Object.values(row.hoursByOutcome ?? {}).reduce((sum, value) => sum + value, 0) + (row.open?.hours ?? 0)
    if (sort === 'wall') list.sort((a, b) => (b.wallHours ?? -1) - (a.wallHours ?? -1))
    if (sort === 'agent') list.sort((a, b) => agentHours(b) - agentHours(a))
    if (sort === 'cost') list.sort((a, b) => (b.cost?.apiUsd ?? -1) - (a.cost?.apiUsd ?? -1))
    if (sort === 'score') list.sort((a, b) => (b.best?.progress ?? -1) - (a.best?.progress ?? -1))
    return list
  }, [ledger, sort])
  if (!ledger || !ledger.rows.length) return null
  // A run that did no work (stopped at once, never started, or crashed inside half an hour with no check) folds into
  // one line, so the table shows the runs that did (review 1 #11: nine such rows on magnetar-rust).
  const agentHoursOf = (row: PlayLedgerRow) => Object.values(row.hoursByOutcome ?? {}).reduce((sum, value) => sum + value, 0) + (row.open?.hours ?? 0)
  const idle = (row: PlayLedgerRow) => !row.best && !checks.get(row.runId)?.rows && (row.wallHours ?? 0) < 0.5 && agentHoursOf(row) < 0.5
  const idleCount = rows.filter(idle).length
  const shownRows = idleShown ? rows : rows.filter((row) => !idle(row))
  const cost = (play.standing as { cost?: { apiEquivalentUsd?: number | null; provenance?: string | null } } | null)?.cost ?? null
  const gained = (play.view as { trend?: { best?: number } | null } | undefined)?.trend?.best ?? null
  const maxWall = Math.max(1, ...ledger.rows.map((row) => row.wallHours ?? 0))
  const maxAgent = Math.max(1, ...ledger.rows.map((row) => Object.values(row.hoursByOutcome ?? {}).reduce((sum, value) => sum + value, 0) + (row.open?.hours ?? 0)))
  const present = new Set(ledger.rows.flatMap((row) => Object.entries(row.hoursByOutcome ?? {}).filter(([, value]) => value > 0).map(([key]) => key)))
  // A column no run has a value for is left out, never drawn as a column of dashes (an index group of 3,518 runs
  // records no attempts, checks, prices or seats; its ledger is run, ending and wall time).
  const has = {
    agent: ledger.rows.some((row) => Object.values(row.hoursByOutcome ?? {}).some((value) => value > 0) || row.open?.hours),
    done: ledger.rows.some((row) => row.completedShare !== null && row.completedShare !== undefined),
    tries: ledger.rows.some((row) => Object.values(row.triesByOutcome ?? {}).some((value) => value > 0)),
    best: ledger.rows.some((row) => row.best || checks.get(row.runId)?.rows),
    cost: ledger.rows.some((row) => row.cost?.apiUsd !== null && row.cost?.apiUsd !== undefined),
    seat: ledger.rows.some((row) => row.seat),
  }
  const head = (key: SortKey, label: string, title?: string, className?: string) => (
    <th className={className} aria-sort={sort === key ? 'descending' : undefined} title={title}>
      <button type="button" className="link-button sort-button" onClick={() => setSort(sort === key ? 'newest' : key)}>
        {label}
      </button>
    </th>
  )
  return (
    <section className={`ws-section play-ledger ${full ? 'is-full' : ''}`} data-play-ledger aria-label="Runs">
      <header className="section-head">
        <h3>Runs</h3>
        {action}
        {cost?.apiEquivalentUsd ? (
          <p className="ledger-spend" title={`API-equivalent${cost.provenance ? ` (${cost.provenance})` : ''}, not a bill`}>
            {cost.provenance === 'estimated' ? '≈' : ''}{money(cost.apiEquivalentUsd)}
            {gained ? <span className="faint"> · {cost.provenance === 'estimated' ? '≈' : ''}{money(cost.apiEquivalentUsd / gained)} per step passed</span> : null}
          </p>
        ) : null}
        <OutcomeLegend outcomes={[...present]} open={ledger.rows.some((row) => row.open?.hours)} />
      </header>
      <div className="table-scroll">
        <table className="data-table ledger-table" data-primary-content={full ? '' : undefined}>
          <thead>
            <tr>
              <th>Run</th>
              <th>Ending</th>
              {head('wall', 'Wall time', 'Hours from start to settle on one axis; hatched where no agent was live')}
              {has.agent && head('agent', 'Agent-hours by outcome', 'Agent-hours on one axis, stacked by how each attempt ended')}
              {has.done && <th className="num" title="Share of agent-hours in completed turns">Done</th>}
              {has.tries && <th className="num">Tries</th>}
              {has.best && head('score', 'Best check')}
              {has.cost && head('cost', 'API-equiv.', undefined, 'ledger-cost')}
              {has.seat && <th>Seat</th>}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row) => {
              const tries = Object.values(row.triesByOutcome ?? {}).reduce((sum, value) => sum + value, 0)
              // The Runs tab draws the lineage as a tree above the table; the standing ledger keeps it as words.
              const fork = full ? null : lineageGlyph(play, row)
              return (
                <tr key={row.runId} data-run={row.runId} className={onOpen ? 'clickable' : undefined} onClick={onOpen ? () => onOpen(row.runId) : undefined}>
                  <td className="mono ledger-run">
                    <a href={`/run/${encodeURIComponent(row.runId)}`} onClick={(event) => onOpen && event.preventDefault()}>
                      {shortRun(play.id, row.runId)}
                    </a>
                    {fork && <small className="faint ledger-fork" title={row.lineage?.commit ? `commit ${row.lineage.commit}` : undefined}> {fork}</small>}
                    {full && row.inputDiffers && <span className="chip" title={`Input differs: ${row.inputDiffers}`}>{row.inputDiffers}</span>}
                  </td>
                  <td className="ledger-ending" title={row.ending?.reason ?? undefined}>
                    {/* The host's status for the run (views.run_status), so a win under an earlier check never reads "Passed". */}
                    {play.live?.runId === row.runId ? <StatusPill status={statusOf({ axis: 'run', state: 'live' })} className="ending-glyph" /> : row.ending ? <StatusPill status={row.ending.status ? viewChip(row.ending.status) : statusOf({ axis: 'run', state: row.ending.word, reason: row.ending.reason })} className="ending-glyph" /> : '—'}
                  </td>
                  <td className="ledger-bar">
                    <WallBar row={row} max={maxWall} />
                  </td>
                  {has.agent && (
                    <td className="ledger-bar">
                      <OutcomeBar row={row} max={maxAgent} />
                    </td>
                  )}
                  {has.done && (
                  <td className="num" title={row.contractBlockedShare !== null && row.contractBlockedShare !== undefined ? `contract-blocked ${Math.round(row.contractBlockedShare * 100)}% of its time` : undefined}>
                    {row.completedShare !== null && row.completedShare !== undefined ? `${Math.round(row.completedShare * 100)}%` : '—'}
                  </td>
                  )}
                  {has.tries && <td className="num">{tries ? tries : <span className="faint">—</span>}</td>}
                  {has.best && (
                    <td>
                      <Best play={play} row={row} checks={checks.get(row.runId)} />
                    </td>
                  )}
                  {has.cost && (
                    <td className="num ledger-cost">
                      <Cost row={row} />
                    </td>
                  )}
                  {has.seat && (
                  <td className="ledger-seat" title={[row.seat, row.seatKind].filter(Boolean).join(' · ') || undefined}>
                    {row.seat ? (
                      <>
                        {seatWords(row.seat)}
                      </>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* The ledger answers the tab's question (how each run ended, at what cost); the lineage sits under it. */}
      {full && <LineageTree play={play} rows={shownRows} now={now} />}
      {idleCount > 0 && (
        <button type="button" className="link-button ledger-idle" onClick={() => setIdleShown(!idleShown)} aria-expanded={idleShown}>
          {idleShown ? `Hide the ${idleCount} runs that did no work` : `+${idleCount} ${idleCount === 1 ? 'run' : 'runs'} that did no work`}
        </button>
      )}
      {(ledger.olderSummary || (ledger.runsTotal && ledger.runsShown && ledger.runsTotal > ledger.runsShown)) && (
        <p className="faint ledger-older">
          {ledger.runsShown} of {ledger.runsTotal} runs shown
          {ledger.olderSummary && (
            <>
              ; {ledger.olderSummary.runs} older:{' '}
              {Object.entries(ledger.olderSummary.endings)
                .map(([word, count]) => `${count} ${word}`)
                .join(', ')}
            </>
          )}
        </p>
      )}
    </section>
  )
}
