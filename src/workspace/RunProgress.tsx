import type { RunDocument, RunProgress } from '../workspace.js'
import { ChartCard, Gantt, HBars, Lines, SERIES, STATE_COLOR, usd } from './OverviewCharts.js'
import { when } from './data.js'

/** Agent states as Runtime records them, in the run-state colours: finished well, still working, down, stopped. */
export const AGENT_COLOR: Record<string, string> = {
  done: STATE_COLOR.winner!,
  winner: STATE_COLOR.winner!,
  running: STATE_COLOR.running!,
  down: STATE_COLOR['driver-failed']!,
  'no-winner': STATE_COLOR['no-winner']!,
  cancelled: '#8e8e8e',
  unknown: STATE_COLOR.unknown!,
}

const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const hours = (ms: number) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`)
const count = (value: number) => String(Math.round(value))

/** The time points of the run's figures, oldest first, with the brief checkpoints as their own series. */
function series(progress: RunProgress, pick: (row: { runUsd: number | null; files: number | null }) => number | null) {
  const samples = progress.samples.flatMap((row) => {
    const value = pick(row)
    return value === null ? [] : [[Date.parse(row.at), value] as [number, number]]
  })
  const briefs = progress.briefs.flatMap((row) => {
    const value = pick(row)
    return value === null ? [] : [[Date.parse(row.at), value] as [number, number]]
  })
  const sequence = new Map(progress.briefs.map((row) => [Date.parse(row.at), row.sequence]))
  return { samples, briefs, label: (t: number) => `brief ${sequence.get(t) ?? ''}`.trim() }
}

/**
 * The run's progress charts, from the same document the briefs draw theirs from: who worked when, each agent's
 * API-equivalent dollars, and the run's spend and files written over time with each brief marked. A running run's
 * document is rewritten every few minutes; at a brief the numbers are the brief's own.
 */
export function RunProgressView({ doc }: { doc: RunDocument }) {
  const progress = doc.progress ?? null
  if (!progress)
    return (
      <p className="ws-status run-panel" data-progress="none">
        No progress record for this run: it is written for runs that ran or settled since progress records began (2026-10-07).
        {doc.finalOutput?.readout?.charts?.length ? ' The readout charts are under Readout.' : ''}
      </p>
    )
  const rows = progress.agents
    .flatMap((agent) => (agent.startedAt ? [{ label: agent.label, start: Date.parse(agent.startedAt), end: Date.parse(agent.endedAt ?? agent.startedAt), state: agent.status, note: agent.model ?? undefined }] : []))
    .sort((a, b) => a.start - b.start)
  const start = progress.startedAt ? Date.parse(progress.startedAt) : Math.min(...rows.map((row) => row.start))
  const states = [...new Set(rows.map((row) => row.state))]
  const priced = progress.agents
    .filter((agent) => agent.usd !== null && agent.usd > 0)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
    .map((agent) => ({ label: agent.label, value: agent.usd ?? 0, note: agent.usdEstimated ? 'estimated' : undefined, color: AGENT_COLOR[agent.status] ?? AGENT_COLOR.unknown }))
  const unpriced = progress.agents.length - priced.length
  const spend = series(progress, (row) => row.runUsd)
  const files = series(progress, (row) => row.files)
  const since = (t: number) => `${clock(t)} · ${hours(t - start)} in`
  return (
    <section className="run-panel run-progress" aria-label="Progress" data-progress={progress.final ? 'final' : 'live'}>
      <p className="faint run-progress-note">
        {progress.final ? 'Final figures' : 'Live figures'} as of {when(progress.generatedAt)}
        {progress.final ? '' : ', following the run\'s records within a minute'}. Spend is API-equivalent ({progress.spend.provenance ?? 'basis not stated'}): every
        token at API list price, whoever paid. Each brief&rsquo;s figures are marked.
      </p>
      <div className="ov-grid run-progress-grid">
        <ChartCard title="Who worked when" wide legend={states.map((state) => ({ name: state, color: AGENT_COLOR[state] ?? AGENT_COLOR.unknown! }))}
          note="Each bar is one agent, from its first record to its settle (or its latest record while it works); colour is how it ended.">
          <Gantt rows={rows} colors={AGENT_COLOR} axis={clock} span={(a, b) => `${clock(a)}–${clock(b)} UTC · ${hours(b - a)}`} />
        </ChartCard>
        <ChartCard title="Dollars per agent" note={`API-equivalent dollars of each agent's own inference as Runtime recorded them; estimated when the provider reported no price.${unpriced > 0 ? ` ${unpriced} agents have no price recorded.` : ''}`}>
          <HBars rows={priced} format={usd} limit={12} />
        </ChartCard>
        <ChartCard title="Spend over time" legend={[{ name: 'spend', color: SERIES[0] }, { name: 'at a brief', color: SERIES[2] }]} note="The run's recorded spend at each refresh; dots are the briefs.">
          <Lines
            series={[
              { name: 'spend', color: SERIES[0], points: spend.samples },
              { name: 'brief', color: SERIES[2], points: spend.briefs, dots: true, label: spend.label },
            ]}
            format={usd}
            axis={since}
          />
        </ChartCard>
        <ChartCard title="Files written over time" legend={[{ name: 'files', color: SERIES[1] }, { name: 'at a brief', color: SERIES[2] }]} note="Knowledge pages and workspace files the run had written.">
          <Lines
            series={[
              { name: 'files', color: SERIES[1], points: files.samples },
              { name: 'brief', color: SERIES[2], points: files.briefs, dots: true, label: files.label },
            ]}
            format={count}
            axis={since}
          />
        </ChartCard>
      </div>
    </section>
  )
}
