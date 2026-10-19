import { smallMultiples } from '@tangle-network/charts'
import { FigureView } from '@tangle-network/charts/react'
import type { PlayDocument } from '../workspace.js'

/**
 * A play's goal across its runs, in the comparison slot: each run's measure against the bar, one panel per run. The
 * charts that counted runs per day, spend per run, findings per run and pages written (X3) are gone: they repeated the
 * runs table and the finding cards, or drew empty axes, and said nothing about the goal.
 */
export function PlayCharts({ play }: { play: PlayDocument }) {
  if (!play.comparison) return null
  return (
    <div className="ov-grid play-charts" data-play-charts={play.comparison.groups.length}>
      <section className="rr-comparison" data-field="comparison"><h3 data-field="comparison.headline">{play.comparison.headline}</h3>{play.comparison.groups.map((group, gi) => <section key={group.id}><h4>{group.label}</h4><FigureView figure={smallMultiples(group.panels, { x: { label: 'Hours after start', domain: play.comparison!.x }, y: { label: 'Cells covered', unit: 'cells', domain: play.comparison!.y }, shared: 'both', noun: 'root' })} /><table><thead><tr><th>Run</th><th>Window</th><th>Evidence</th></tr></thead><tbody>{group.panels.map((arm, i) => <tr key={arm.id}><th><a href={`/run/${encodeURIComponent(arm.id)}`}>{arm.label}</a></th><td data-field={`comparison.groups.${gi}.panels.${i}.windowHours`} data-value={arm.windowHours}>{arm.windowHours} h</td><td>{arm.missing?.why ?? (arm.end ? 'Ended early' : arm.fullWindow ? 'Full window' : 'Partial observations')}<small>{arm.source}</small></td></tr>)}</tbody></table></section>)}<p>{play.comparison.source}</p></section>
    </div>
  )
}
