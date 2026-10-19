import { OUTCOME_COLORS, type TickOutcome } from '@tangle-network/charts'
import { utcTime } from '../viewer/model.js'

interface Lane {
  id: string
  label: string
  spans: Array<{ start: string; end: string | null; state: string; note?: string | null }>
  ticks?: Array<{ at: string; outcome: string; cause?: string | null }>
}

const at = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * One agent's attempts as beads on a string (J3, wave 2): the agent's lane from the run receipt's timeline zoomed to the
 * run's recorded time, the same axis as the replay above it. Each span is a stretch of string (work solid, blocked or
 * waiting hatched); each bead is an attempt where it ended, coloured by its outcome in the shared outcome palette. A
 * bead moves the replay to that moment, so the conversation shows everything up to that attempt's end.
 */
export function BeadString({ lane, start: runStart, end: runEnd, cutoff, onSeek }: { lane: Lane; start: number; end: number; cutoff: number; onSeek: (iso: string) => void }) {
  const ticks = lane.ticks ?? []
  // Zoomed to the agent's own life (its first span to its last attempt or span end), padded 2%, inside the run's time.
  const times = [...lane.spans.flatMap((span) => [at(span.start), at(span.end)]), ...ticks.map((tick) => at(tick.at))].filter((value): value is number => value !== null)
  const life = times.length ? [Math.min(...times), Math.max(...times)] : [runStart, runEnd]
  const pad = Math.max(60_000, (life[1]! - life[0]!) * 0.02)
  const start = Math.max(runStart, life[0]! - pad)
  const end = Math.min(runEnd, life[1]! + pad)
  if (end <= start || (!ticks.length && !lane.spans.length)) return null
  const x = (value: number) => `${(((Math.max(start, Math.min(end, value)) - start) / (end - start)) * 100).toFixed(3)}%`
  const counts = new Map<string, number>()
  for (const tick of ticks) counts.set(tick.outcome, (counts.get(tick.outcome) ?? 0) + 1)
  const ok = counts.get('ok') ?? 0
  const failed = ticks.length - ok
  return (
    <div className="bead-string" data-bead-string={lane.id} aria-label={`${lane.label}: ${ticks.length} attempts, ${ok} completed, ${failed} failed`}>
      <div className="bead-track">
        {lane.spans.map((span, i) => {
          const a = at(span.start)
          const b = at(span.end) ?? end
          if (a === null) return null
          return <i key={i} className={`bead-span state-${span.state}`} style={{ left: x(a), width: `max(2px, calc(${x(b)} - ${x(a)}))` }} title={`${span.state}${span.note ? `: ${span.note}` : ''} · ${utcTime(span.start)} to ${span.end ? utcTime(span.end) : 'the end'}`} />
        })}
        {cutoff >= start && cutoff <= end && <i className="bead-cursor" style={{ left: x(cutoff) }} aria-hidden="true" />}
        {ticks.map((tick, i) => {
          const t = at(tick.at)
          if (t === null) return null
          const color = OUTCOME_COLORS[tick.outcome as TickOutcome] ?? 'var(--chart-muted)'
          return (
            <button
              key={i}
              type="button"
              className={`bead${t <= cutoff ? ' is-past' : ''}`}
              data-outcome={tick.outcome}
              style={{ left: x(t), ['--bead' as string]: color }}
              title={`Attempt ${i + 1} of ${ticks.length}: ${tick.outcome}${tick.cause && tick.cause !== tick.outcome ? ` (${tick.cause})` : ''} · ended ${utcTime(tick.at)}. Click to replay to here.`}
              aria-label={`Attempt ${i + 1}: ${tick.outcome}, ended ${utcTime(tick.at)}`}
              onClick={() => onSeek(tick.at)}
            />
          )
        })}
      </div>
      <p className="bead-summary faint">
        <span className="mono">{utcTime(new Date(start).toISOString())}–{utcTime(new Date(end).toISOString())}</span>
        {' · '}
        {ticks.length} {ticks.length === 1 ? 'attempt' : 'attempts'}
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([outcome, n]) => (
          <span key={outcome}>
            {' · '}
            <i className="bead-key" style={{ background: OUTCOME_COLORS[outcome as TickOutcome] ?? 'var(--chart-muted)' }} aria-hidden="true" />
            {n} {outcome}
          </span>
        ))}
      </p>
    </div>
  )
}
