import { useDocument, when } from './data.js'
import { LIVE_HOURS, liveCauses, percent, type ReliabilityDocument } from './reliability-model.js'

/**
 * The run failure causes still happening, on the plays page's Runs tab, each with its owner; the clean-run share and its
 * daily chart live on Today.
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
      {/* The clean-run share and its daily chart are Today's (one chart of one measure); this panel keeps what only it says:
          the causes still happening and who owns each (re-audit 2026-10-24: the two charts disagreed on Oct 17). */}
      <p className="faint">{percent(data.rate)} of {runs.settled} settled runs ran clean in the last {data.window.days} days; <a href="/today">the daily chart is on Today</a>.</p>
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
      <p className="faint reliability-definition">
        Clean: a settled run with no infra, harness or quota failure on any agent. Operator cancellations and running runs are outside the count.
      </p>
    </section>
  )
}
