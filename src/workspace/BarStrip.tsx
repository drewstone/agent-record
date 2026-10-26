import { Gap } from '@tangle-network/charts/react'
import { metricValue, type PlayBarMetric, targetWords } from './play-standing.js'
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

/** One bar's words, shared by the rows and the chips: its value with the bound sign, the ratio, where it was measured. */
function facts(bar: ViewBar) {
  const latest = bar.latest
  const format = (v: number) => metricValue(v, bar.unit)
  const side = bar.ratio?.side ?? null
  return {
    latest, format, side,
    value: latest ? `${BOUND[latest.kind]}${format(latest.value)}` : 'not measured',
    ratio: bar.ratio ? (side === 'short' ? `${times(bar.ratio.x)} short` : side === 'past' ? `✓ ${times(bar.ratio.x)} past` : '✓ within') : '',
    where: latest ? [latest.release, day(latest.at), latest.size].filter(Boolean).join(' · ') : '',
    target: targetWords({ id: bar.metric, label: bar.label, unit: bar.unit, target: bar.target ?? null } as PlayBarMetric),
  }
}

/**
 * Every paper metric against its bar, as the host serves it (view.bars). On /play, one row each: the metric, where its
 * newest value sits against the target (and the paper's best), the value, how far from the target, and the change over
 * the trend's window. `compact` (the run header, Today) is one line of chips that link to the play's Standing (`href`).
 */
export function BarStrip({ bars, compact = false, href }: { bars: ViewBar[]; compact?: boolean; href?: string }) {
  if (compact)
    return (
      <ul className="bar-chips" aria-label="Against the bar">
        {bars.map((bar) => {
          const f = facts(bar)
          const tip = [f.where, f.target ? `target ${f.target}` : null, f.latest?.reason].filter(Boolean).join('\n')
          const chip = <>{bar.label} <b>{f.value}</b>{!bar.change && f.latest?.at && <small> {day(f.latest.at)}</small>}{f.ratio && <em> {f.ratio}</em>}</>
          return <li key={bar.metric} data-side={f.side ?? 'none'} title={tip || undefined}>{href ? <a href={href}>{chip}</a> : chip}</li>
        })}
      </ul>
    )
  return (
    <ul className="bar-strip" aria-label="Against the bar">
      {bars.map((bar) => {
        const { latest, format, side, value, ratio, where } = facts(bar)
        const target = band(bar.target)
        const improved = bar.change && bar.direction ? (bar.direction === 'up' ? bar.change.to > bar.change.from : bar.change.to < bar.change.from) : null
        return (
          <li key={bar.metric} className="bar-row" data-side={side ?? 'none'}>
            <span className="bar-label">{bar.label}{bar.direction ? ` ${bar.direction === 'up' ? '↑' : '↓'}` : ''}</span>
            <span className="bar-gap">
              {latest && target ? (
                <Gap value={latest.value} bound={latest.kind === 'upper-bound' ? 'upper' : latest.kind === 'lower-bound' ? 'lower' : null} target={target} stretch={band(bar.stretch)}
                  scale={bar.scale ?? 'log'} format={format} tone={side === 'short' ? 'var(--ar-c-warn)' : side ? 'var(--ar-c-ok)' : undefined} label={`${bar.label} against its target`}
                  titles={{ value: [value, where, latest.reason].filter(Boolean).join('\n'), stretch: bar.stretch?.label ?? undefined }} />
              ) : null}
            </span>
            <b className="bar-value" title={where || undefined}>{value}</b>
            <span className="bar-ratio">{ratio}</span>
            {/* No change in the window means the value is older than it: say its size and date beside it, never as if current. */}
            <span className="bar-change" data-improved={improved === null ? undefined : String(improved)}>{bar.change ? `was ${format(bar.change.from)} · ${day(bar.change.since)}` : latest ? [latest.size, day(latest.at)].filter(Boolean).join(' · ') : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}
