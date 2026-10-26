import type { ReactElement } from 'react'
import type { ChartMark } from '@tangle-network/charts'
import { Lines } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { tokens } from './data.js'
import type { WorkspaceRelease } from './RunWorkspace.js'

const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const ACCENT = 'var(--ar-accent, #8e59ff)'

/**
 * Is the run working or idling, and is the spend buying steps (REVIEW-8 charts 3 and 4, Drew): agents working at each
 * of the host's progress samples and tokens per minute from the run's metered token series, on the run's own time
 * window. With `marked`, each release is marked by the steps it passed. Now draws it side by side
 * under the timeline; How it ran stacks it, captioned.
 */
export function RunActivity({ doc, marked = false, releases = [], stacked = false }: { doc: RunDocument; marked?: boolean; releases?: readonly WorkspaceRelease[]; stacked?: boolean }) {
  const lineage = (doc as { lineage?: { settledAt?: string | null; series?: [string, number][] }[] }).lineage?.[0]
  const start = Date.parse(doc.run.startedAt ?? '') || -Infinity
  const end = Date.parse(lineage?.settledAt ?? doc.run.settledAt ?? '') || Infinity
  const inRun = (t: number) => Number.isFinite(t) && t >= start && t <= end
  const samples = (doc.progress?.samples ?? []).map((s) => ({ t: Date.parse(s.at), working: s.working }))
  const working = samples.filter((s) => inRun(s.t)).map((s): [number, number] => [s.t, s.working])
  const metered = (lineage?.series ?? []).map(([at, n]): [number, number] => [Date.parse(at), n]).filter(([t]) => inRun(t))
  const rate = metered.slice(1).map(([t, n], i): [number, number] => [t, t > metered[i]![0] ? ((n - metered[i]![1]) * 60_000) / (t - metered[i]![0]) : 0])
  // No to-date curve: the meter's cumulative series misses turns Runtime could not meter (21c ends at 211M of 431M), and no
  // priced series exists yet, so releases mark the agents-working line instead (agent-record 00:42Z).
  // A release is marked only where the steps it passed changed (21c: rc115 5/6, rc116 4/6, rc117 5/6, then nine more at
  // 5/6) and at the last one, so eleven labels do not bury the line; each mark names its release and steps.
  const marks: ChartMark[] = releases
    .filter((r) => marked && working.length > 0 && Date.parse(r.at ?? '') >= working[0]![0] && Date.parse(r.at!) <= working.at(-1)![0])
    .filter((r, i, all) => i === 0 || i === all.length - 1 || r.passed !== all[i - 1]!.passed)
    .map((r) => ({ at: Date.parse(r.at!), label: `${r.release} ${r.passed != null && r.total ? `${r.passed}/${r.total}` : ''}`.trim(), kind: 'release' as const, verdict: r.passed != null && r.total ? (r.passed === r.total ? 'pass' as const : 'fail' as const) : 'unknown' as const }))
  const charts = [
    working.length > 1 && { caption: 'Agents working', node: <Lines rows={5} axis={clock} format={(v) => String(Math.round(v))} marks={marks} series={[{ name: 'agents working', color: ACCENT, points: working }]} /> },
    rate.length > 1 && { caption: 'Metered tokens per minute', node: <Lines rows={5} axis={clock} format={tokens} series={[{ name: 'metered tokens per minute', color: ACCENT, points: rate }]} /> },
  ].filter((chart): chart is { caption: string; node: ReactElement } => Boolean(chart))
  if (!charts.length) return null
  return stacked ? (
    <section className="run-activity stacked" aria-label="Over the run">
      {charts.map(({ caption, node }) => <figure key={caption}><figcaption>{caption}</figcaption>{node}</figure>)}
    </section>
  ) : (
    <div className="rj-activity" aria-label="Agents working and tokens per minute">{charts.map(({ caption, node }) => <div key={caption}>{node}</div>)}</div>
  )
}
