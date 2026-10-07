import { useEffect, useRef, useState, type ReactNode } from 'react'

// Categorical slots in the Tangle palette (lavender first), validated together on the workspace's dark surface
// (#16181f): lightness band, chroma, adjacent CVD separation (worst 13.5) and the normal-vision floor (worst 20.9),
// contrast >= 3:1. Assigned in this order, never cycled; a chart needing more series folds the rest into "other".
export const SERIES = ['#8b7cf6', '#0ea5a0', '#c98500', '#e2508f', '#4a90e2'] as const
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

/** The rendered width and font size of an element, so an SVG chart draws at its real size and its geometry follows
 * the page's type. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, em: 16 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry!.contentRect.width), em: parseFloat(getComputedStyle(element).fontSize) || 16 }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size.width, size.em] as const
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

/** Bars per day (or per any label: `tick` shortens it on the axis), stacked by series, on one axis; hovering a bar lists
 * every series' value for it, and `onOpen` makes a bar a link. */
export function DayBars({ days, series, format = compact, rows = 13, missing = 'No runs started', tick = (day: string) => day.slice(5), onOpen }: { days: string[]; series: { name: string; color: string; values: (number | null)[] }[]; format?: (v: number) => string; rows?: number; missing?: string; tick?: (day: string) => string; onOpen?: (index: number) => void }) {
  const [ref, width, em] = useWidth<HTMLDivElement>()
  const height = Math.round(rows * em)
  const [tip, setTip] = useState<Tip | null>(null)
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  const { top, ticks } = ticksFor(Math.max(...totals))
  const left = Math.round(3.4 * em)
  const bottom = Math.round(1.8 * em)
  const plotW = Math.max(0, width - left - 8)
  const plotH = height - bottom - 8
  const slot = days.length ? plotW / days.length : 0
  const bar = Math.max(3, slot * 0.72)
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / (4.5 * em)))))
  const labelGap = Math.ceil((4.5 * em) / Math.max(slot, 1))
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  return (
    <div ref={ref} className="ov-plot" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(', ')} per day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 8} y1={y(t)} y2={y(t)} className="ov-gridline" />
              <text x={left - em * 0.4} y={y(t)} dominantBaseline="middle" className="ov-axis" textAnchor="end">{format(t)}</text>
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
                  return <rect key={s.name} x={x} y={y1} width={bar} height={Math.max(2, y0 - y1 - 2)} rx={2} fill={s.color} />
                })}
                {(i === days.length - 1 || (i % labelEvery === 0 && i + labelGap <= days.length - 1)) && (
                  <text x={x + bar / 2} y={height - em * 0.35} className="ov-axis" textAnchor="middle">{tick(day)}</text>
                )}
                <rect
                  x={left + i * slot}
                  y={8}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  style={onOpen ? { cursor: 'pointer' } : undefined}
                  onClick={onOpen ? () => onOpen(i) : undefined}
                  onMouseEnter={() =>
                    setTip({
                      x: Math.min(left + i * slot + slot + 8, width - em * 14),
                      y: 8,
                      title: `${day} · ${series.every((s) => s.values[i] === null) ? missing : format(totals[i] ?? 0)}`,
                      lines: series.map((s) => ({ label: s.name, value: s.values[i] === null ? missing : format(s.values[i] ?? 0), color: s.color })),
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

/** Ranked horizontal bars with the value and an optional note on each row; past `limit` rows the rest are counted. */
export function HBars({ rows, format = compact, color = SERIES[0], max, limit = 8 }: { rows: { label: string; value: number; note?: string; color?: string; href?: string }[]; format?: (v: number) => string; color?: string; max?: number; limit?: number }) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value))
  if (!rows.length) return <p className="ov-empty">Nothing recorded.</p>
  const rest = rows.slice(limit)
  return (
    <ol className="ov-hbars">
      {rows.slice(0, limit).map((row) => {
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
      {rest.length > 0 && <li className="ov-hbars-more">+{rest.length} more · {format(rest.reduce((a, row) => a + row.value, 0))}</li>}
    </ol>
  )
}

/** A histogram of counts per bin; each bar's tooltip names its range and count. */
export function Histogram({ bins, format = compact, color = SERIES[0], unit, rows = 12 }: { bins: { lo: number; hi: number; n: number }[]; format?: (v: number) => string; color?: string; unit: string; rows?: number }) {
  const [ref, width, em] = useWidth<HTMLDivElement>()
  const height = Math.round(rows * em)
  const [tip, setTip] = useState<Tip | null>(null)
  // Trim empty bins at both ends so the shape fills the plot.
  const first = bins.findIndex((b) => b.n > 0)
  const last = bins.length - 1 - [...bins].reverse().findIndex((b) => b.n > 0)
  const shown = first < 0 ? [] : bins.slice(first, last + 1)
  const { top, ticks } = ticksFor(Math.max(...shown.map((b) => b.n), 1))
  const left = Math.round(3 * em)
  const bottom = Math.round(1.8 * em)
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
              <text x={left - em * 0.4} y={y(t)} dominantBaseline="middle" className="ov-axis" textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {shown.map((bin, i) => (
            <g key={i}>
              <rect x={left + i * slot + 2} y={y(bin.n)} width={Math.max(3, slot - 4)} height={Math.max(bin.n ? 2 : 0, 8 + plotH - y(bin.n))} rx={2} fill={color} />
              {(i % Math.max(1, Math.ceil(shown.length / 6)) === 0 || i === shown.length - 1) && (
                <text x={left + i * slot + slot / 2} y={height - em * 0.35} className="ov-axis" textAnchor="middle">{format(bin.lo)}</text>
              )}
              <rect
                x={left + i * slot}
                y={8}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setTip({ x: Math.min(left + i * slot + slot + 6, width - em * 14), y: 8, title: `${format(bin.lo)} to ${format(bin.hi)} ${unit}`, lines: [{ label: 'count', value: String(bin.n) }] })}
              />
            </g>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/** Lines over time on one axis (at most four series); the crosshair readout lists each series at the nearest time. A
 * `dots` series draws its points as marks (checkpoints) instead of a line; `axis` labels the time axis (default MM-DD). */
export function Lines({ series, format = compact, rows = 13, axis }: { series: { name: string; color: string; points: [number, number][]; dots?: boolean; label?: (t: number) => string }[]; format?: (v: number) => string; rows?: number; axis?: (t: number) => string }) {
  const [ref, width, em] = useWidth<HTMLDivElement>()
  const height = Math.round(rows * em)
  const [hover, setHover] = useState<number | null>(null)
  const all = series.flatMap((s) => s.points)
  if (!all.length) return <p className="ov-empty">No history yet.</p>
  const t0 = Math.min(...all.map((p) => p[0]))
  const t1 = Math.max(...all.map((p) => p[0]))
  const { top, ticks } = ticksFor(Math.max(...all.map((p) => p[1])))
  const left = Math.round(3.4 * em)
  const bottom = Math.round(1.8 * em)
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
              <text x={left - em * 0.4} y={y(t)} dominantBaseline="middle" className="ov-axis" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {[t0, (t0 + t1) / 2, t1].map((t, i) => (
            <text key={i} x={x(t)} y={height - em * 0.35} className="ov-axis" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{axis ? axis(t) : day(t).slice(0, 5)}</text>
          ))}
          {series.map((s) =>
            s.dots ? (
              <g key={s.name}>
                {s.points.map((p) => (
                  <circle key={p[0]} cx={x(p[0])} cy={y(p[1])} r={Math.max(3, em / 5)} fill={s.color} stroke="var(--ws-panel)" strokeWidth={1.5} />
                ))}
              </g>
            ) : (
              <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={Math.max(2, em / 8)} strokeLinejoin="round" points={s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} />
            ),
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={8 + plotH} className="ov-crosshair" />}
          {hover !== null &&
            series.map((s) => {
              const p = s.points.length ? nearest(s.points, hover) : null
              return p ? <circle key={s.name} cx={x(p[0])} cy={y(p[1])} r={Math.max(4, em / 4)} fill={s.color} stroke="var(--ws-panel)" strokeWidth={2} /> : null
            })}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          tip={{
            x: Math.min(x(hover) + 10, width - em * 14),
            y: 8,
            title: day(hover),
            lines: series.filter((s) => s.points.length).map((s) => {
              const p = nearest(s.points, hover)
              return { label: s.label ? s.label(p[0]) : s.name, value: format(p[1]), color: s.color }
            }),
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
  const w = 160
  const h = 32
  const d = points.map((p) => `${((p[0] - t0) / Math.max(1, t1 - t0)) * w},${h - 2 - (Math.min(max, p[1]) / max) * (h - 4)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ov-spark" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth={1.6} points={d} />
    </svg>
  )
}

/** One bar per row on a shared time axis (who worked when): each row's bar spans its start to its end, coloured by its
 * state; hovering a row names it, its state and its span. Times are epoch ms; `axis` labels the time axis. */
export function Gantt({ rows, colors, axis, span }: { rows: { label: string; start: number; end: number; state: string; note?: string }[]; colors: Record<string, string>; axis: (t: number) => string; span: (start: number, end: number) => string }) {
  const [ref, width, em] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  if (!rows.length) return <p className="ov-empty">No agent has started.</p>
  const rowH = Math.round(1.25 * em)
  const labelW = Math.min(Math.round(13 * em), Math.round(width * 0.32))
  const top = 4
  const bottom = Math.round(1.8 * em)
  const height = top + rows.length * rowH + bottom
  const t0 = Math.min(...rows.map((row) => row.start))
  const t1 = Math.max(...rows.map((row) => row.end), t0 + 60_000)
  const plotW = Math.max(0, width - labelW - 10)
  const x = (t: number) => labelW + ((t - t0) / (t1 - t0)) * plotW
  const fallback = colors.unknown ?? '#8e8e8e'
  return (
    <div ref={ref} className="ov-plot" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${rows.length} agents over time`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={labelW + f * plotW} x2={labelW + f * plotW} y1={top} y2={top + rows.length * rowH} className="ov-gridline" />
              <text x={labelW + f * plotW} y={height - em * 0.35} className="ov-axis" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{axis(t0 + f * (t1 - t0))}</text>
            </g>
          ))}
          {rows.map((row, i) => {
            const y = top + i * rowH
            const color = colors[row.state] ?? fallback
            return (
              <g key={`${row.label}-${i}`}
                onMouseEnter={() => setTip({ x: Math.min(x(row.end) + 8, width - em * 16), y: Math.max(0, y - em), title: row.label, lines: [{ label: row.state, value: span(row.start, row.end), color }, ...(row.note ? [{ label: row.note, value: '' }] : [])] })}>
                <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
                <text x={labelW - em * 0.5} y={y + rowH / 2} dominantBaseline="middle" textAnchor="end" className="ov-axis ov-gantt-label">
                  {row.label.length > 26 ? `${row.label.slice(0, 25)}…` : row.label}
                </text>
                <rect x={x(row.start)} y={y + rowH * 0.18} width={Math.max(2, x(row.end) - x(row.start))} height={rowH * 0.64} rx={2} fill={color} />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
