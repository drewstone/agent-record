import { DayBars } from '@tangle-network/charts/react'
import { useDocument, when } from './data.js'
import { LIVE_HOURS, liveCauses, percent, type ReliabilityDocument } from './reliability-model.js'

/**
 * The run failure causes still happening, on the plays page's Runs tab, each with its owner, under the clean-run share.
 */
export function ReliabilityPanel({ api }: { api: string }) {
  const doc = useDocument<ReliabilityDocument>(`${api}/reliability`)
  if (doc.loading && !doc.data) return null
  if (!doc.data || doc.data.schema !== 'discovery-lab.reliability.v1')
    return (
      <section className="reliability" data-reliability="missing">
        <p className="faint">Run reliability is unavailable{doc.error ? `: ${doc.error}` : ''}.</p>
      </section>
    )
  const data = doc.data
  const live = liveCauses(data)
  const runs = data.runs
  return (
    <section className="reliability" aria-label="Failure causes still happening" data-reliability={data.rate ?? 'unknown'}>
      {/* The share and its days as bars here, where the causes are (REVIEW-8 chart 6; Today draws no daily chart). */}
      <p className="faint" title="Clean: a settled run with no infra, harness or quota failure on any agent. Operator cancellations and running runs are outside the count.">{percent(data.rate)} of {runs.settled} settled runs ran clean in the last {data.window.days} days.</p>
      <DayBars days={data.daily.map((day) => day.day.slice(5))} series={[{ name: 'clean', color: 'var(--ar-c-ok, #22c55e)', values: data.daily.map((day) => day.clean) }, { name: 'hit by a failure', color: 'var(--ar-c-warn, #f5a524)', values: data.daily.map((day) => day.hit) }, { name: 'failed', color: 'var(--ar-c-fail, #ef4444)', values: data.daily.map((day) => day.failed) }]} />
      <div className="reliability-causes">
        <span className="answer-label">Top causes still happening (seen in the last {LIVE_HOURS} h)</span>
        {live.length ? (
          <ol>
            {live.map((cause) => (
              <li key={cause.id} data-cause={cause.id}>
                <b>{cause.title}</b>
                <span className="faint">
                  {cause.runsLost} {cause.runsLost === 1 ? 'run' : 'runs'} lost{cause.runsHit ? `, ${cause.runsHit} hit` : ''}
                  {cause.lostAgentHours !== null ? ` · ${Math.round(cause.lostAgentHours)} agent-hours` : ''} · {cause.layer ?? 'unclassified'} ·{' '}
                  {cause.owner ?? 'no owner named'} · last seen {when(cause.lastSeen)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="faint">No failure cause was seen in the last {LIVE_HOURS} hours.</p>
        )}
      </div>
    </section>
  )
}
