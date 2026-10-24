import type { PlayDocument } from '../workspace-model.js'
import type { PlayHead } from './play-standing.js'
import { targetWords } from './play-standing.js'

type Play = PlayDocument & PlayHead

/** The play's bar as declared (`bar.json`): each metric's target, stretch and direction, the source and both conditions. */
export function PlayBarTable({ play }: { play: Play }) {
  const bar = play.bar ?? null
  if (!bar) return null
  return (
    <section className="ws-section play-bar-table" data-section="bar">
      <h3>Bar</h3>
      <p className="faint">
        {bar.source}
        {bar.path && <> · <code>{bar.path}</code></>}
      </p>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Target</th>
            <th>Stretch</th>
            <th>Better</th>
            <th>Scale</th>
          </tr>
        </thead>
        <tbody>
          {bar.metrics.map((metric) => (
            <tr key={metric.id}>
              <td>
                {metric.label}
                {metric.precondition && <span className="chip">precondition</span>}
              </td>
              <td>{targetWords(metric) ?? '—'}</td>
              <td>{metric.stretch ? `${metric.stretch.min ?? ''}${metric.stretch.max ? `–${metric.stretch.max}` : ''} ${metric.stretch.label ?? ''}`.trim() : '—'}</td>
              <td>{metric.direction === 'up' ? 'higher' : metric.direction === 'down' ? 'lower' : '—'}</td>
              <td>{metric.scale ?? 'linear'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {(bar.condition || bar.checkCondition) && (
        <p className="faint">
          {bar.condition && <>The bar: {bar.condition}. </>}
          {bar.checkCondition && <>The check measures: {bar.checkCondition}.</>}
        </p>
      )}
    </section>
  )
}
