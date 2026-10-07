import { useEffect, useRef, useState, type ReactNode } from 'react'

// Categorical slots validated together on the workspace's dark surface (#16181f): lightness band, chroma, adjacent
// CVD separation (worst 8.4) and the normal-vision floor (worst 19.3), contrast >= 3:1. Assigned in this order, never
// cycled; a chart needing more series folds the rest into "other".
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const
// Run end states are status, not identity: they wear the status tokens and always carry a label.
export const STATE_COLOR: Record<string, string> = {
  winner: 'var(--ar-c-ok)',
  'no-winner': 'var(--ar-c-run)',
  'driver-failed': 'var(--ar-c-fail)',
  failed: 'color-mix(in srgb, var(--ar-c-fail) 60%, var(--ar-fg-faint))',
  running: 'var(--ws-accent)',
  unknown: 'var(--ar-fg-faint)',
}

export const compact = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
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

/** The rendered width of an element, so an SVG chart draws at its real size (text never stretches). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** A nice ceiling for an axis and its three gridline values. */
function ticksFor(max: number) {
  if (!(max > 0)) return { top: 1, ticks: [0, 0.5, 1] }
  const power = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * 4 >= max) ?? power * 10
  const top = Math.ceil(max / step) * step
  return { top, ticks: [0, top / 2, top] }
}

interface Tip {
  x: number
  y: number
  title: string
  lines: { label: string; value: string; color?: string }[]
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="ov-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.title}</strong>
      {tip.lines.map((line) => (
        <span key={line.label} className="ov-tip-line">
          {line.color && <i style={{ background: line.color }} />}
          <span>{line.label}</span>
          <b>{line.value}</b>
        </span>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="ov-legend">
      {items.map((item) => (
        <span key={item.name}>
          <i style={{ background: item.color }} />
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

/** Bars per day, stacked by series, on one axis; hovering a day lists every series' value for it. */
export function DayBars({ days, series, format = compact, height = 180 }: { days: string[]; series: { name: string; color: string; values: number[] }[]; format?: (v: number) => string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  const { top, ticks } = ticksFor(Math.max(...totals))
  const left = 44
  const bottom = 22
  const plotW = Math.max(0, width - left - 8)
  const plotH = height - bottom - 8
  const slot = days.length ? plotW / days.length : 0
  const bar = Math.max(2, slot - 3)
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  return (
    <div ref={ref} className="ov-plot" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(', ')} per day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} className="ov-gridline" />
              <text x={left - 6} y={y(t) + 4} className="ov-axis" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {days.map((day, i) => {
            let base = 0
            const x = left + i * slot + (slot - bar) / 2
            return (
              <g key={day}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0
                  if (!v) return null
                  const y0 = y(base)
                  base += v
                  const y1 = y(base)
                  // A 2 px surface gap between stacked segments; a segment shorter than the gap still shows 1 px.
                  return <rect key={s.name} x={x} y={y1} width={bar} height={Math.max(1, y0 - y1 - 2)} rx={1.5} fill={s.color} />
                })}
                {i % Math.max(1, Math.ceil(days.length / 6)) === 0 && (
                  <text x={x + bar / 2} y={height - 6} className="ov-axis" textAnchor="middle">{day.slice(5)}</text>
                )}
                <rect
                  x={left + i * slot}
                  y={8}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: Math.min(left + i * slot + slot + 8, width - 200),
                      y: 8,
                      title: `${day} · ${format(totals[i] ?? 0)}`,
                      lines: series.map((s) => ({ label: s.name, value: format(s.values[i] ?? 0), color: s.color })),
                    })
                  }
                />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/** Ranked horizontal bars with the value and an optional note on each row. */
export function HBars({ rows, format = compact, color = SERIES[0], max }: { rows: { label: string; value: number; note?: string; color?: string; href?: string }[]; format?: (v: number) => string; color?: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value))
  if (!rows.length) return <p className="ov-empty">Nothing recorded.</p>
  return (
    <ol className="ov-hbars">
      {rows.map((row) => {
        const content = (
          <>
            <span className="ov-hbar-label" title={row.label}>{row.label}</span>
            <span className="ov-hbar-track">
              <span style={{ width: `${Math.max(1, (row.value / top) * 100)}%`, background: row.color ?? color }} />
            </span>
            <span className="ov-hbar-value">{format(row.value)}</span>
            {row.note && <span className="ov-hbar-note">{row.note}</span>}
          </>
        )
        return <li key={row.label}>{row.href ? <a href={row.href}>{content}</a> : <div>{content}</div>}</li>
      })}
    </ol>
  )
}

/** A histogram of counts per bin; each bar's tooltip names its range and count. */
export function Histogram({ bins, format = compact, color = SERIES[0], unit, height = 150 }: { bins: { lo: number; hi: number; n: number }[]; format?: (v: number) => string; color?: string; unit: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  // Trim empty bins at both ends so the shape fills the plot.
  const first = bins.findIndex((b) => b.n > 0)
  const last = bins.length - 1 - [...bins].reverse().findIndex((b) => b.n > 0)
  const shown = first < 0 ? [] : bins.slice(first, last + 1)
  const { top, ticks } = ticksFor(Math.max(...shown.map((b) => b.n), 1))
  const left = 36
  const bottom = 22
  const plotW = Math.max(0, width - left - 8)
  const plotH = height - bottom - 8
  const slot = shown.length ? plotW / shown.length : 0
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  if (!shown.length) return <p className="ov-empty">Nothing recorded.</p>
  return (
    <div ref={ref} className="ov-plot" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Distribution of ${unit}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} className="ov-gridline" />
              <text x={left - 6} y={y(t) + 4} className="ov-axis" textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {shown.map((bin, i) => (
            <g key={i}>
              <rect x={left + i * slot + 1} y={y(bin.n)} width={Math.max(2, slot - 2)} height={Math.max(bin.n ? 1 : 0, 8 + plotH - y(bin.n))} rx={1.5} fill={color} />
              {(i % Math.max(1, Math.ceil(shown.length / 6)) === 0 || i === shown.length - 1) && (
                <text x={left + i * slot + slot / 2} y={height - 6} className="ov-axis" textAnchor="middle">{format(bin.lo)}</text>
              )}
              <rect
                x={left + i * slot}
                y={8}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setTip({ x: Math.min(left + i * slot + slot + 6, width - 200), y: 8, title: `${format(bin.lo)} to ${format(bin.hi)} ${unit}`, lines: [{ label: 'count', value: String(bin.n) }] })}
              />
            </g>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/** Lines over time on one axis (at most four series); the crosshair readout lists each series at the nearest time. */
export function Lines({ series, format = compact, height = 170 }: { series: { name: string; color: string; points: [number, number][] }[]; format?: (v: number) => string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const all = series.flatMap((s) => s.points)
  if (!all.length) return <p className="ov-empty">No history yet.</p>
  const t0 = Math.min(...all.map((p) => p[0]))
  const t1 = Math.max(...all.map((p) => p[0]))
  const { top, ticks } = ticksFor(Math.max(...all.map((p) => p[1])))
  const left = 44
  const bottom = 22
  const plotW = Math.max(0, width - left - 10)
  const plotH = height - bottom - 8
  const x = (t: number) => left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : 0)
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  const nearest = (points: [number, number][], t: number) => points.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best), points[0]!)
  const day = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  return (
    <div
      ref={ref}
      className="ov-plot"
      onMouseMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const px = event.clientX - box.left
        setHover(px >= left ? t0 + ((px - left) / Math.max(1, plotW)) * (t1 - t0) : null)
      }}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 10} y1={y(t)} y2={y(t)} className="ov-gridline" />
              <text x={left - 6} y={y(t) + 4} className="ov-axis" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {[t0, (t0 + t1) / 2, t1].map((t, i) => (
            <text key={i} x={x(t)} y={height - 6} className="ov-axis" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{day(t).slice(0, 5)}</text>
          ))}
          {series.map((s) => (
            <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={8 + plotH} className="ov-crosshair" />}
          {hover !== null &&
            series.map((s) => {
              const p = s.points.length ? nearest(s.points, hover) : null
              return p ? <circle key={s.name} cx={x(p[0])} cy={y(p[1])} r={4} fill={s.color} stroke="var(--ws-panel)" strokeWidth={2} /> : null
            })}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          tip={{
            x: Math.min(x(hover) + 10, width - 200),
            y: 8,
            title: day(hover),
            lines: series.filter((s) => s.points.length).map((s) => ({ label: s.name, value: format(nearest(s.points, hover)[1]), color: s.color })),
          }}
        />
      )}
    </div>
  )
}

/** A used-of-total meter with its numbers. */
export function Meter({ used, total, format = compact, tone, text }: { used: number | null | undefined; total: number | null | undefined; format?: (v: number) => string; tone?: string; text?: string }) {
  const share = used !== null && used !== undefined && total ? Math.min(1, used / total) : null
  return (
    <div className="ov-meter">
      <span className="ov-meter-track">
        <span style={{ width: `${(share ?? 0) * 100}%`, background: tone ?? (share !== null && share > 0.9 ? 'var(--ar-c-fail)' : share !== null && share > 0.7 ? 'var(--ar-c-run)' : SERIES[0]) }} />
      </span>
      <span className="ov-meter-text">
        {text ?? `${format(used ?? NaN)} of ${format(total ?? NaN)} · ${pct(share)}`}
      </span>
    </div>
  )
}

/** A small line of one series for a row in a list (one hue; the row's label carries identity). */
export function Spark({ points, max = 1, color = SERIES[0] }: { points: [number, number][]; max?: number; color?: string }) {
  if (points.length < 2) return <span className="ov-spark-empty">collecting</span>
  const t0 = points[0]![0]
  const t1 = points.at(-1)![0]
  const w = 120
  const h = 26
  const d = points.map((p) => `${((p[0] - t0) / Math.max(1, t1 - t0)) * w},${h - 2 - (Math.min(max, p[1]) / max) * (h - 4)}`).join(' ')
  return (
    <svg width={w} height={h} className="ov-spark" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth={1.6} points={d} />
    </svg>
  )
}
