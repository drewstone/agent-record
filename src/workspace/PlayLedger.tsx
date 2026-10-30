import { OUTCOME_ORDER } from '@tangle-network/charts'
import { utc, type PlayLedgerRow } from './play-standing.js'

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
