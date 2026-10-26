import { Lines } from '@tangle-network/charts/react'
import type { ViewTrend } from './view.js'

/**
 * Steps passed over time under the current check (view.trend), one chart for Today and /play: each checked release as a
 * dot, the best so far as a line, and the ladder's top. The axis counts steps; the page names them (step names overran the
 * chart's left edge on /play).
 */
export function TrendChart({ trend }: { trend: ViewTrend }) {
  const checks = (trend.series ?? []).map((point) => ({ t: Date.parse(point.at), ...point })).filter((point) => Number.isFinite(point.t))
  if (!checks.length) return null
  let best = 0
  const bestLine = checks.map((point) => [point.t, (best = Math.max(best, point.passed))] as [number, number])
  const release = (t: number) => { const point = checks.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)); return `${point.release}${point.runId ? ` (${point.runId.slice(-3)})` : ''}` }
  const span = [checks[0]!.t, checks.at(-1)!.t]
  return (
    <div className="tj-chart">
      <Lines rows={12} format={(v) => `${v}`} series={[
        { name: 'checked release', color: 'var(--ar-c-info)', points: checks.map((point) => [point.t, point.passed]), dots: true, label: release },
        { name: 'best so far', color: `var(--ar-c-${trend.movement === 'moving' ? 'ok' : trend.movement === 'regressed' ? 'fail' : 'run'})`, points: bestLine },
        { name: `all ${trend.total} steps`, color: 'var(--ar-fg-faint)', points: span.map((t) => [t, trend.total] as [number, number]), dash: 'dash' },
      ]} />
    </div>
  )
}
