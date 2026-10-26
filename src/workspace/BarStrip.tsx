import { Tip } from './AnswerStrip.js'
import { metricValue, type PlayBarMetric, targetWords } from './play-standing.js'
import type { ViewBar } from './view.js'

const BOUND = { measured: '', 'upper-bound': '≤ ', 'lower-bound': '≥ ' } as const
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null)
const times = (x: number) => `×${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(x)}`

/**
 * Every paper metric against its bar, as the host serves it (view.bars): the newest value or bound, the target, how far
 * from it, and the change over the trend's window. One card per bar.json metric, so any play with a bar reads the same.
 */
export function BarStrip({ bars }: { bars: ViewBar[] }) {
  return (
    <ul className="bar-strip" aria-label="Against the bar">
      {bars.map((bar) => {
        const latest = bar.latest
        const value = latest ? `${BOUND[latest.kind]}${metricValue(latest.value, bar.unit)}` : 'not measured'
        const side = bar.ratio?.side ?? null
        const improved = bar.change && bar.direction ? (bar.direction === 'up' ? bar.change.to > bar.change.from : bar.change.to < bar.change.from) : null
        const where = latest ? [latest.release, day(latest.at), latest.size].filter(Boolean).join(' · ') : null
        const tip = [latest?.reason, bar.best && bar.best !== latest ? `best ${BOUND[bar.best.kind]}${metricValue(bar.best.value, bar.unit)}${bar.best.release ? ` (${bar.best.release})` : ''}` : null, bar.stretch?.label].filter(Boolean).join('\n')
        return (
          <li key={bar.metric} className="bar-card" data-side={side ?? 'none'}>
            <span className="bar-label">{bar.label}{bar.direction ? ` ${bar.direction === 'up' ? '↑' : '↓'}` : ''}</span>
            <Tip text={tip || value}><b className="bar-value">{value}</b></Tip>
            <span className="bar-target">
              {targetWords({ id: bar.metric, label: bar.label, unit: bar.unit, target: bar.target ?? null } as PlayBarMetric) ?? 'no target'}
              {bar.ratio && <em className="bar-ratio"> {side === 'short' ? `${times(bar.ratio.x)} short` : side === 'past' ? `✓ ${times(bar.ratio.x)} past` : '✓ within'}</em>}
            </span>
            {where && <span className="bar-where">{where}</span>}
            {bar.change && <span className="bar-change" data-improved={improved === null ? undefined : String(improved)}>was {metricValue(bar.change.from, bar.unit)} · {day(bar.change.since)}</span>}
          </li>
        )
      })}
    </ul>
  )
}
