import type { PlayDocument } from '../workspace.js'
import { ChartCard, DayBars, Lines, SERIES, STATE_COLOR, compact, usd } from './OverviewCharts.js'
import { go } from './data.js'

const DAY_MS = 86_400_000
const shortRun = (play: string, run: string) => (run.startsWith(`${play}-`) ? run.slice(play.length + 1) : run)
const clip = (label: string) => (label.length > 12 ? `${label.slice(0, 11)}…` : label)

/**
 * A play across its runs: when runs started and how each ended, what each cost by kind (subscription use at API prices,
 * model API billed, sandbox compute billed, never summed), what each found, and how the play's banked results grew with
 * its winners marked. Drawn from the play's document; every run counts, failed ones included.
 */
export function PlayCharts({ play }: { play: PlayDocument }) {
  const runs = play.runs.filter((run) => run.startedAt).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
  if (!runs.length) return null
  const open = (index: number) => go(`/run/${encodeURIComponent(runs[index]!.id)}`)
  // Runs per day by how they ended, every day from the first run to the last.
  const first = Date.parse(runs[0]!.startedAt!.slice(0, 10))
  const last = Date.parse(runs.at(-1)!.startedAt!.slice(0, 10))
  const days = Array.from({ length: Math.round((last - first) / DAY_MS) + 1 }, (_, i) => new Date(first + i * DAY_MS).toISOString().slice(0, 10))
  const states = [...new Set(runs.map((run) => run.state))]
  const byDay = states.map((state) => ({
    name: state.replaceAll('-', ' '),
    color: STATE_COLOR[state] ?? STATE_COLOR.unknown!,
    values: days.map((day) => runs.filter((run) => run.state === state && run.startedAt!.startsWith(day)).length),
  }))
  const labels = runs.map((run) => shortRun(play.id, run.id))
  const spend = [
    { name: 'subscription use at API prices', color: SERIES[0], values: runs.map((run) => run.spend.subscriptionUsd) },
    { name: 'model API billed', color: SERIES[1], values: runs.map((run) => run.spend.apiUsd) },
    { name: 'sandbox billed', color: SERIES[2], values: runs.map((run) => run.spend.sandboxUsd) },
  ]
  const derived = runs.some((run) => run.findings)
  const found = [
    { name: 'results', color: SERIES[1], values: runs.map((run) => run.findings?.results ?? null) },
    { name: 'claims', color: SERIES[0], values: runs.map((run) => run.findings?.claims ?? null) },
  ]
  // The play's banked results and claims, run by run, with each winner marked where it landed.
  let banked = 0
  const progression: [number, number][] = []
  const winners: [number, number][] = []
  for (const run of runs) {
    banked += (run.findings?.results ?? 0) + (run.findings?.claims ?? 0)
    const t = Date.parse(run.startedAt!)
    progression.push([t, banked])
    if (run.state === 'winner') winners.push([t, banked])
  }
  const runAt = new Map(runs.map((run) => [Date.parse(run.startedAt!), shortRun(play.id, run.id)]))
  const date = (t: number) => new Date(t).toISOString().slice(5, 10)
  return (
    <div className="ov-grid play-charts" data-play-charts={runs.length}>
      <ChartCard title="Runs by day and how they ended" legend={byDay.map((s) => ({ name: s.name, color: s.color }))} note="Every run of the play, failed ones included, on the day it started.">
        <DayBars days={days} series={byDay} rows={10} missing="no run" />
      </ChartCard>
      <ChartCard title="Spend per run by kind" legend={spend.map((s) => ({ name: s.name, color: s.color }))}
        note="Subscription use is priced at API rates and not billed; model API and sandbox compute are billed. A run with a kind unrecorded shows none for it.">
        <DayBars days={labels} series={spend} format={usd} rows={10} missing="not recorded" tick={clip} onOpen={open} />
      </ChartCard>
      <ChartCard title="Findings per run" legend={found.map((s) => ({ name: s.name, color: s.color }))}
        note={derived ? 'Results and claims its agents wrote, as last derived; a run not derived yet shows none.' : 'No run of this play has its findings derived yet.'}>
        <DayBars days={labels} series={found} rows={10} missing="not derived yet" tick={clip} onOpen={open} />
      </ChartCard>
      <ChartCard title="Best-known progression" legend={[{ name: 'results and claims banked', color: SERIES[1] }, { name: 'winner', color: STATE_COLOR.winner! }]}
        note={winners.length ? `${winners.length} winning ${winners.length === 1 ? 'run' : 'runs'}; the line counts what every run wrote.` : 'No run of this play has won yet; the line counts what every run wrote.'}>
        <Lines
          series={[
            { name: 'banked', color: SERIES[1], points: progression, label: (t) => `after ${runAt.get(t) ?? 'run'}` },
            { name: 'winner', color: STATE_COLOR.winner!, points: winners, dots: true, label: (t) => `${runAt.get(t) ?? 'run'} won` },
          ]}
          format={compact}
          rows={10}
          axis={date}
        />
      </ChartCard>
    </div>
  )
}
