import type { PlayDocument } from '../workspace-model.js'
import type { PlayBarMetric, PlayHead } from './play-standing.js'
import { metricValue, targetWords } from './play-standing.js'

type Play = PlayDocument & PlayHead

/** A stretch range in the target's words ("9.5M–12.8M cycles/s"), never the raw numbers or a dangling "–4194304". */
function stretchWords(metric: PlayBarMetric) {
  const stretch = metric.stretch
  if (!stretch) return null
  return targetWords({ ...metric, target: { min: stretch.min ?? null, max: stretch.max ?? null, approx: null } })
}

/**
 * The play's bar as declared (`bar.json`): each metric's target and the paper's best (stretch), the better direction as
 * an arrow on the metric, the source as the caption, and how it is measured one fold away.
 */
export function PlayBarTable({ play }: { play: Play }) {
  const bar = play.bar ?? null
  if (!bar) return null
  return (
    <section className="ws-section play-bar-table" data-section="bar">
      <div className="table-scroll">
      <table className="data-table" data-primary-content>
        {bar.source && <caption title={bar.source}>Bar · {bar.source.replace(/\s*\(.*?\)/g, '').replace(/,\s*Tables?.*$/, '')}</caption>}
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Target</th>
            <th className="num">Paper&rsquo;s best</th>
          </tr>
        </thead>
        <tbody>
          {bar.metrics.map((metric) => (
            <tr key={metric.id}>
              <td title={metric.direction === 'up' ? 'higher is better' : metric.direction === 'down' ? 'lower is better' : undefined}>
                {metric.label} <span className="faint">{metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : ''}</span>
                {metric.precondition && <span className="chip">precondition</span>}
              </td>
              <td className="num">{targetWords(metric) ?? '—'}</td>
              <td className="num" title={metric.stretch?.label ?? undefined}>{stretchWords(metric) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {(bar.condition || bar.checkCondition) && (
        <details className="input-details">
          <summary>How it is measured</summary>
          {bar.condition && <p>The bar: {bar.condition}.</p>}
          {bar.checkCondition && <p>The check: {bar.checkCondition}.</p>}
          {bar.path && <p className="faint mono">{bar.path}</p>}
        </details>
      )}
    </section>
  )
}
