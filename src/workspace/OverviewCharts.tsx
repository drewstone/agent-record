import type { ReactNode } from 'react'
import { LIVE_SERIES, formatCompact } from '@tangle-network/charts/react'
export { DayBars, HBars, Histogram, Lines, Meter, Spark, Gantt } from '@tangle-network/charts/react'

// The shared chart palette supplies categorical slots; run states keep their semantic colors here.
export const SERIES = LIVE_SERIES
// Run states are labelled status categories. This order passed the categorical validator on the Discovery dark
// surface (#16181f): adjacent CVD separation >= 13.5, normal-vision separation >= 20.9, contrast >= 3:1.
// Keeping failed blue and driver-failed red also separates the two outcomes when they dominate a day.
export const STATE_COLOR: Record<string, string> = {
  'driver-failed': '#e26868',
  running: '#8b7cf6',
  winner: '#0ea5a0',
  'no-winner': '#c98500',
  'no-record': '#e2508f',
  failed: '#4a90e2',
  unknown: '#b97637',
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

export function ChartCard({ title, note, legend, wide, children }: { title: string; note?: ReactNode; legend?: { name: string; color: string }[]; wide?: boolean; children: ReactNode }) {
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
