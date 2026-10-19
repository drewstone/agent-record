import { OUTCOME_COLORS, OUTCOME_ORDER } from '@tangle-network/charts'
import { useMemo, useState } from 'react'
import type { PlayDocument } from '../workspace.js'
import { money, tokens } from './data.js'
import { checkerLabel, ENDING_GLYPH, type PlayHead, type PlayLedgerRow, shortRun, shortTag, stageWords, utc, verdictWord } from './play-standing.js'

type Play = PlayDocument & PlayHead
type SortKey = 'newest' | 'wall' | 'agent' | 'cost' | 'score'

const OUTCOME_WORD: Record<string, string> = { ok: 'ok', quota: 'quota', lost: 'lost', 'rate-limit': 'rate limit', oom: 'OOM', refused: 'refused', aborted: 'aborted', other: 'other' }
const notes = (row: PlayLedgerRow) => (typeof row.outcomeNotes === 'string' ? [row.outcomeNotes] : Array.isArray(row.outcomeNotes) ? row.outcomeNotes : row.outcomeNotes ? Object.entries(row.outcomeNotes).map(([key, value]) => `${key}: ${value}`) : [])

/** A run's agent-hours stacked by attempt outcome on the ledger's shared axis; an open turn is a hatched tail. */
function OutcomeBar({ row, max }: { row: PlayLedgerRow; max: number }) {
  const by = row.hoursByOutcome ?? null
  const open = row.open?.hours ?? 0
  if (!by && !open) return <span className="faint">attempts not recorded</span>
  const total = Object.values(by ?? {}).reduce((sum, value) => sum + value, 0)
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
          <i key={outcome} data-outcome={outcome} style={{ flexGrow: by![outcome]!, background: OUTCOME_COLORS[outcome] }} />
        ))}
        {open > 0 && <i className="outcome-open" style={{ flexGrow: open }} />}
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

function Best({ play, row }: { play: Play; row: PlayLedgerRow }) {
  const best = row.best ?? null
  if (!best) return <span className="faint">no check</span>
  const stage = best.reached !== null && best.reached !== undefined && best.of ? `${best.reached}/${best.of}` : null
  const workloads = best.workloads?.total ? `${best.workloads.passed}/${best.workloads.total}` : null
  return (
    <span className={`ledger-best verdict-${best.verdict ?? 'none'}`} title={[best.line, stageWords(best), best.checker ? checkerLabel(play.checkers, best.checker) : null].filter(Boolean).join('\n')}>
      {verdictWord(best.verdict)}
      {stage && <span className="num"> · {stage}</span>}
      {workloads && <span className="num"> · {workloads}</span>}
      {best.checker && <span className="faint"> {checkerLabel(play.checkers, best.checker)}</span>}
      {best.tag && <span className="faint mono"> {shortTag(best.tag)}</span>}
    </span>
  )
}

function Cost({ row }: { row: PlayLedgerRow }) {
  const cost = row.cost ?? null
  if (!cost || cost.provenance === 'unmetered') return <span className="faint" title="No settled attempt: nothing to price">unmetered</span>
  if (cost.apiUsd === null || cost.apiUsd === undefined) return <span className="unpriced">unpriced</span>
  return (
    <span title={`API-equivalent${cost.provenance ? ` (${cost.provenance})` : ''}${cost.billedUsd !== null && cost.billedUsd !== undefined ? `; billed ${money(cost.billedUsd)}` : ''}`}>
      {money(cost.apiUsd)}
      {cost.provenance === 'estimated' && <span className="faint"> est.</span>}
    </span>
  )
}

const lineageGlyph = (play: Play, row: PlayLedgerRow) =>
  row.lineage?.kind === 'fork' && row.lineage.parentRun ? `⑂ ${shortRun(play.id, row.lineage.parentRun)}${row.lineage.parentTag ? `@${shortTag(row.lineage.parentTag)}` : ''}` : row.lineage?.kind === 'wrong-base' ? 'wrong base' : null

/**
 * The run ledger (charts c and e): for each run its ending, wall time with idle time hatched, agent-hours stacked by
 * attempt outcome on one shared axis, completed share, tries, best score, API-equivalent cost and seat. `full` adds
 * tokens, team size, model, harness and how its input differs.
 */
export function PlayLedger({ play, full = false, onOpen }: { play: Play; full?: boolean; onOpen?: (runId: string) => void }) {
  const ledger = play.ledger ?? null
  const [sort, setSort] = useState<SortKey>('newest')
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
  const maxWall = Math.max(1, ...ledger.rows.map((row) => row.wallHours ?? 0))
  const maxAgent = Math.max(1, ...ledger.rows.map((row) => Object.values(row.hoursByOutcome ?? {}).reduce((sum, value) => sum + value, 0) + (row.open?.hours ?? 0)))
  const present = new Set(ledger.rows.flatMap((row) => Object.entries(row.hoursByOutcome ?? {}).filter(([, value]) => value > 0).map(([key]) => key)))
  const head = (key: SortKey, label: string, title?: string) => (
    <th aria-sort={sort === key ? 'descending' : undefined} title={title}>
      <button type="button" className="link-button sort-button" onClick={() => setSort(sort === key ? 'newest' : key)}>
        {label}
      </button>
    </th>
  )
  return (
    <section className={`ws-section play-ledger ${full ? 'is-full' : ''}`} data-play-ledger aria-label="Runs">
      <header className="section-head">
        <h3>Runs</h3>
        <ul className="outcome-legend" aria-label="Attempt outcomes">
          {OUTCOME_ORDER.filter((outcome) => present.has(outcome)).map((outcome) => (
            <li key={outcome}>
              <i style={{ background: OUTCOME_COLORS[outcome] }} />
              {OUTCOME_WORD[outcome]}
            </li>
          ))}
          {ledger.rows.some((row) => row.open?.hours) && (
            <li>
              <i className="outcome-open" />
              open turn
            </li>
          )}
        </ul>
      </header>
      <div className="table-scroll">
        <table className="data-table ledger-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Ending</th>
              {head('wall', 'Wall time', 'Hours from start to settle on one axis; hatched where no agent was live')}
              {head('agent', 'Agent-hours by outcome', 'Agent-hours on one axis, stacked by how each attempt ended')}
              <th className="num" title="Share of agent-hours in completed turns">Done</th>
              <th className="num">Tries</th>
              {head('score', 'Best check')}
              {head('cost', 'API-equiv.')}
              <th>Seat</th>
              {full && <th className="num">Tokens in / out</th>}
              {full && <th className="num">Agents</th>}
              {full && <th>Model · harness</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const glyph = row.ending?.glyph ?? ENDING_GLYPH[row.ending?.word ?? ''] ?? ''
              const tries = Object.values(row.triesByOutcome ?? {}).reduce((sum, value) => sum + value, 0)
              const fork = lineageGlyph(play, row)
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
                    <span className={`ending-glyph ending-${(row.ending?.word ?? 'unknown').replace(/\s+/g, '-')}`}>{glyph}</span> {row.ending?.word ?? '—'}
                  </td>
                  <td className="ledger-bar">
                    <WallBar row={row} max={maxWall} />
                  </td>
                  <td className="ledger-bar">
                    <OutcomeBar row={row} max={maxAgent} />
                  </td>
                  <td className="num" title={row.contractBlockedShare !== null && row.contractBlockedShare !== undefined ? `contract-blocked ${Math.round(row.contractBlockedShare * 100)}% of its time` : undefined}>
                    {row.completedShare !== null && row.completedShare !== undefined ? `${Math.round(row.completedShare * 100)}%` : '—'}
                  </td>
                  <td className="num">{row.triesByOutcome ? tries : '—'}</td>
                  <td>
                    <Best play={play} row={row} />
                  </td>
                  <td className="num">
                    <Cost row={row} />
                  </td>
                  <td className="ledger-seat" title={row.seatKind ?? undefined}>
                    {row.seat ?? <span className="faint">—</span>}
                  </td>
                  {full && (
                    <td className="num" title={row.tokens?.known !== null && row.tokens?.known !== undefined ? `${row.tokens.known} agents with known usage` : undefined}>
                      {row.tokens ? `${tokens(row.tokens.in)} / ${tokens(row.tokens.out)}` : '—'}
                    </td>
                  )}
                  {full && (
                    <td className="num">
                      {row.agents ?? '—'}
                      {row.depth !== null && row.depth !== undefined && row.agents ? <small className="faint"> d{row.depth}</small> : null}
                    </td>
                  )}
                  {full && <td className="faint">{[row.model, row.harness].filter(Boolean).join(' · ') || '—'}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
