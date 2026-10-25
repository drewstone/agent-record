import { DayBars, HBars } from '@tangle-network/charts/react'
import { useDocument } from './data.js'
import { LIVE_HOURS, liveCauses, percent, type ReliabilityDocument } from './reliability-model.js'

/**
 * Is the fleet getting more reliable, and what still kills runs: the clean-run share and its days as bars beside the
 * failure causes seen in the last LIVE_HOURS, each with its owner (plays page, Runs tab).
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
    <section className="reliability" aria-label="Run reliability" data-reliability={data.rate ?? 'unknown'}>
      <div className="reliability-days">
        <p title={data.definition || 'Clean: a settled run with no infra, harness or quota failure on any agent. Operator cancellations and running runs are outside the count.'}>
          <b className="reliability-rate">{percent(data.rate)}</b> of {runs.settled} settled runs ran clean in {data.window.days} days
        </p>
        <DayBars rows={9} days={data.daily.map((day) => day.day)} series={[{ name: 'clean', color: 'var(--ar-c-ok)', values: data.daily.map((day) => day.clean) }, { name: 'hit by a failure', color: 'var(--ar-c-run)', values: data.daily.map((day) => day.hit) }, { name: 'failed', color: 'var(--ar-c-fail)', values: data.daily.map((day) => day.failed) }]} />
      </div>
      <div className="reliability-causes">
        <span className="answer-label">Still failing runs ({LIVE_HOURS} h)</span>
        {live.length ? (
          <HBars
            color="var(--ar-c-fail)"
            format={(value) => `${value} lost`}
            rows={live.map((cause) => ({ label: cause.title, value: cause.runsLost, note: (cause.owner ?? 'no owner named').split(' (')[0] }))}
          />
        ) : (
          <p className="faint">None in {LIVE_HOURS} h.</p>
        )}
      </div>
    </section>
  )
}
