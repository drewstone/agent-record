import { useDocument, when } from './data.js'
import { LIVE_HOURS, liveCauses, percent, type ReliabilityDocument } from './reliability.js'

/**
 * The fleet's run reliability over the last seven days, on the plays page: the share of settled runs no infrastructure,
 * harness or quota failure touched, each day's share, and the top causes still happening, each with its owner.
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
    <section className="reliability" aria-label="Run reliability, last 7 days" data-reliability={data.rate ?? 'unknown'}>
      <div className="reliability-figure">
        <span className="answer-label">Run reliability · last {data.window.days} days</span>
        <span className={`reliability-rate ${data.rate !== null && data.rate < 0.8 ? 'state-fail' : 'state-ok'}`}>{percent(data.rate)}</span>
        <span className="faint">
          of {runs.settled} settled runs ran clean · {runs.clean} clean, {runs.hit} hit by a failure, {runs.failed} failed
        </span>
        <span className="faint">{data.lostAgentHours !== null ? `${Math.round(data.lostAgentHours)} agent-hours lost` : 'agent-hours lost unknown'}</span>
      </div>
      <div className="reliability-chart">
      <div className="reliability-days" role="img" aria-label={data.daily.map((day) => `${day.day}: ${percent(day.rate)} of ${day.runs} runs`).join('; ')}>
        {data.daily.map((day) => (
          <div key={day.day} className="reliability-day" title={`${day.day}: ${day.clean} clean, ${day.hit} hit, ${day.failed} failed of ${day.runs}`}>
            <span className="reliability-bar">
              {day.rate !== null && day.runs > 0 && <i style={{ height: `${Math.max(3, day.rate * 100)}%` }} className={day.rate < 0.8 ? 'low' : ''} />}
            </span>
            <span>{day.runs ? percent(day.rate) : '—'}</span>
            <span className="faint">{day.runs}</span>
            <span className="faint">{`${Number(day.day.slice(5, 7))}/${Number(day.day.slice(8, 10))}`}</span>
          </div>
        ))}
      </div>
        <span className="faint reliability-days-key">Each day: the share of its settled runs that ran clean, its run count, and the date (UTC).</span>
      </div>
      <div className="reliability-causes">
        <span className="answer-label">Top causes still happening (seen in the last {LIVE_HOURS} h)</span>
        {live.length ? (
          <ol>
            {live.map((cause) => (
              <li key={cause.id} data-cause={cause.id}>
                <b>{cause.title}</b>
                <span className="faint">
                  {cause.runsLost} runs lost{cause.runsHit ? `, ${cause.runsHit} hit` : ''}
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
        Clean: a settled run with no infra, harness or quota failure on any agent. Operator cancellations and running runs are outside the count. As of {when(data.at)}.
      </p>
    </section>
  )
}
