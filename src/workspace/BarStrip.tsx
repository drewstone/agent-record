import { formatCompact, Gap } from '@tangle-network/charts/react'
import type { ViewBar } from './view.js'

/**
 * Each paper metric against its number (the host's view.bars, from the play's bar.json and its checked releases): ours,
 * the target band, how far apart (direction-aware), and the change over the trend's window. One strip serves Today, the
 * play page and the run header; every value is a host field.
 */
const band = (b: ViewBar['target']) => (b && 'approx' in b ? { min: b.approx, max: b.approx } : b)
const bytes = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : v >= 1e3 ? `${Math.round(v / 1e3)} KB` : `${v} B`)
const unitFormat = (unit: string) => (unit === 'B' ? bytes : (v: number) => `${v < 100 ? +v.toPrecision(3) : formatCompact(v)} ${unit}`)
const SIDE = { short: (x: string) => `×${x} short`, past: (x: string) => `×${x} past`, met: () => 'met' } as const

export function BarStrip({ bars }: { bars: ViewBar[] }) {
  if (!bars.length) return null
  return (
    <ul className="bar-strip">
      {bars.map((bar) => {
        const format = unitFormat(bar.unit)
        const target = band(bar.target)!
        const latest = bar.latest
        const bound = latest?.kind === 'upper-bound' ? (bar.direction === 'up' ? 'upper' : 'lower') : null
        const ours = latest ? `${bound === 'upper' ? '≤' : bound === 'lower' ? '≥' : ''}${format(latest.value)}` : '—'
        const of = `${latest?.release ?? ''}${latest?.size ? ` at ${latest.size}` : ''}`.trim()
        const met = bar.ratio?.side === 'met'
        const better = bar.change && bar.change.to !== bar.change.from ? (bar.change.to > bar.change.from) === (bar.direction === 'up') : null
        return (
          <li key={bar.metric}>
            <span className="bar-label">{bar.label}</span>
            {latest ? (
              <Gap value={latest.value} bound={bound} target={target} stretch={band(bar.stretch ?? null)} format={format} tone={`var(--ar-c-${met ? 'ok' : 'run'})`}
                titles={{ value: `ours ${ours}${of ? `, ${of}` : ''}${latest.reason ? `: ${latest.reason}` : ''}`, target: `target ${format(target.min)}${target.max !== target.min ? `–${format(target.max)}` : ''}` }} />
            ) : <span className="faint">not measured</span>}
            <span className="bar-ours num">{ours}</span>
            <span className={`bar-ratio num${met ? ' ok' : ''}`}>{bar.ratio ? SIDE[bar.ratio.side](formatCompact(bar.ratio.x)) : ''}</span>
            <span className={`bar-change num${better === null ? ' faint' : better ? ' ok' : ' fail'}`} title={bar.change ? `${format(bar.change.from)} → ${format(bar.change.to)} since ${bar.change.since}` : 'no change measured'}>
              {better === null ? '—' : `${better ? '▲' : '▼'} ${format(bar.change!.from)}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
