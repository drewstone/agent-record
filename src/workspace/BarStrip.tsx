import { Gap } from '@tangle-network/charts/react'
import { metricValue } from './play-standing.js'
import type { ViewBar } from './view.js'

const BOUND = { measured: '', 'upper-bound': '≤ ', 'lower-bound': '≥ ' } as const
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null)
const times = (x: number) => `×${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(x)}`
/** A declared band as one range: a single number (≈ 599 KiB) or one open end (≤ 4.0 GiB) is a band of width zero. */
const band = (b: { min?: number | null; max?: number | null; approx?: number | null } | null | undefined) => {
  const lo = b?.min ?? b?.approx ?? b?.max ?? null
  const hi = b?.max ?? b?.approx ?? b?.min ?? null
  return lo === null || hi === null ? null : { min: lo, max: hi }
}

/**
 * Every paper metric against its bar, as the host serves it (view.bars), one row each: the metric, where its newest
 * value sits against the target (and the paper's best), the value, how far from the target, and the change over the
 * trend's window. Words and colours are the page's; the Gap mark only places them.
 */
export function BarStrip({ bars }: { bars: ViewBar[] }) {
  return (
    <ul className="bar-strip" aria-label="Against the bar">
      {bars.map((bar) => {
        const latest = bar.latest
        const format = (v: number) => metricValue(v, bar.unit)
        const side = bar.ratio?.side ?? null
        const target = band(bar.target)
        const improved = bar.change && bar.direction ? (bar.direction === 'up' ? bar.change.to > bar.change.from : bar.change.to < bar.change.from) : null
        const where = latest ? [latest.release, day(latest.at), latest.size].filter(Boolean).join(' · ') : ''
        return (
          <li key={bar.metric} className="bar-row" data-side={side ?? 'none'}>
            <span className="bar-label">{bar.label}{bar.direction ? ` ${bar.direction === 'up' ? '↑' : '↓'}` : ''}</span>
            <span className="bar-gap">
              {latest && target ? (
                <Gap value={latest.value} bound={latest.kind === 'upper-bound' ? 'upper' : latest.kind === 'lower-bound' ? 'lower' : null} target={target} stretch={band(bar.stretch)}
                  scale={bar.scale ?? 'log'} format={format} tone={side === 'short' ? 'var(--ar-c-warn)' : side ? 'var(--ar-c-ok)' : undefined} label={`${bar.label} against its target`}
                  titles={{ value: [`${BOUND[latest.kind]}${format(latest.value)}`, where, latest.reason].filter(Boolean).join('\n'), stretch: bar.stretch?.label ?? undefined }} />
              ) : null}
            </span>
            <b className="bar-value" title={where || undefined}>{latest ? `${BOUND[latest.kind]}${format(latest.value)}` : 'not measured'}</b>
            <span className="bar-ratio">{bar.ratio ? (side === 'short' ? `${times(bar.ratio.x)} short` : side === 'past' ? `✓ ${times(bar.ratio.x)} past` : '✓ within') : ''}</span>
            <span className="bar-change" data-improved={improved === null ? undefined : String(improved)}>{bar.change ? `was ${format(bar.change.from)} · ${day(bar.change.since)}` : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}
