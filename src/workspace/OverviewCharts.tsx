import type { ReactNode } from 'react'
import { ENDING_COLORS, ENDING_ORDER, type RunEnding } from '@tangle-network/charts'
import { LIVE_SERIES, formatCompact } from '@tangle-network/charts/react'
import { endingStatus } from './data.js'
export { DayBars, HBars, Histogram, Lines, Meter, Spark, Gantt } from '@tangle-network/charts/react'

// The shared chart palette supplies categorical slots, except its third (#c98500), which is the stalled amber: status hues
// mark status only (design-system section 5), so that slot is a violet at ΔE ≥ 24 from every series and status tone.
// The palette itself is the charts library's to change (plan item D6).
export const SERIES = [LIVE_SERIES[0]!, LIVE_SERIES[1]!, '#9b59b6', ...LIVE_SERIES.slice(3)]
/**
 * A catalog state as the ending word every page shows (@tangle-network/charts ENDING_ORDER). The ending colours are the
 * status tones agent-record sets on `--chart-ending-*` (styles.css): green for solved, amber for live, and neutral for
 * every other ending, told apart by shape. A state with no ending (no record, unknown) draws hollow.
 */
export const ENDING_OF_STATE: Record<string, RunEnding> = {
  winner: 'solved',
  'no-winner': 'not solved',
  'driver-failed': 'died',
  failed: 'died',
  stalled: 'stalled',
  running: 'live',
  // Ended unsettled with its coordinator gone (often stopped to be forked): cancelled, not a failure.
  abandoned: 'cancelled',
  cancelled: 'cancelled',
}
/**
 * Per-day counts by state folded into the ending words, in ENDING_ORDER; states without an ending are `unknown`. A count
 * of running runs is data, drawn in ink: the running run's own row chip is its one amber mark on the page (v2 delta 3).
 */
export function byEnding(byState: Record<string, (number | null)[]>): Array<{ name: string; color: string; values: (number | null)[] }> {
  const sums = new Map<string, (number | null)[]>()
  for (const [state, values] of Object.entries(byState)) {
    const ending = ENDING_OF_STATE[state] ?? 'unknown'
    const prior = sums.get(ending)
    sums.set(ending, prior ? prior.map((value, i) => (value ?? 0) + (values[i] ?? 0)) : [...values])
  }
  return [...ENDING_ORDER, 'unknown' as const]
    .filter((ending) => (sums.get(ending) ?? []).some((value) => (value ?? 0) > 0))
    .map((ending) => ({ name: endingStatus(ending).word.replace(/ \(.*\)$/, ''), color: ending === 'unknown' ? 'var(--chart-outcome-other)' : ending === 'live' ? 'var(--ar-fg)' : ENDING_COLORS[ending], values: sums.get(ending)! }))
}

export const compact = formatCompact
export const usd = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value >= 1000
      ? `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
      : `$${value.toFixed(value >= 100 ? 0 : 2)}`
export const bytes = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = value
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u += 1
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`
}
export const pct = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`)

export function Legend({ items }: { items: { name: string; color: string; hollow?: boolean }[] }) {
  return (
    <div className="ov-legend">
      {items.map((item) => (
        <span key={item.name}>
          <i style={item.hollow ? { boxShadow: `inset 0 0 0 2px ${item.color}` } : { background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  )
}

/**
 * True when a chart has nothing to draw: every value is null (nobody measured it), or every value is zero or null while
 * the usage behind it is unknown (a zero-filled day of unmeasured agents is not a measured zero).
 */
export function nothingToDraw(values: ReadonlyArray<number | null | undefined>, usageKnown = true) {
  const measured = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return measured.length === 0 || (!usageKnown && measured.every((value) => value === 0))
}

/**
 * One chart in a card. Pass `values` (every value the chart draws) and the card renders nothing when they hold nothing to
 * draw: an empty axis or a row of unmeasured zeros is noise, not a reading. `usageKnown={false}` treats zeros as unmeasured.
 */
export function ChartCard({ title, note, legend, wide, values, usageKnown, children }: { title: string; note?: ReactNode; legend?: { name: string; color: string }[]; wide?: boolean; values?: ReadonlyArray<number | null | undefined>; usageKnown?: boolean; children: ReactNode }) {
  if (values && nothingToDraw(values, usageKnown)) return null
  return (
    <figure className={`ov-card ${wide ? 'wide' : ''}`}>
      <figcaption>
        <span className="ov-card-title">{title}</span>
        {legend && legend.length > 1 && <Legend items={legend} />}
      </figcaption>
      {children}
      {note && <p className="ov-note">{note}</p>}
    </figure>
  )
}
