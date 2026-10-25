import type { ReactElement } from 'react'
import type { ChartMark } from '@tangle-network/charts'
import { Lines } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { money, tokens } from './data.js'
import type { WorkspaceRelease } from './RunWorkspace.js'

const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const ACCENT = 'var(--ar-accent, #8e59ff)'

/**
 * Is the run working or idling, and is the spend buying steps (REVIEW-8 charts 3 and 4, Drew): agents working at each
 * of the host's progress samples and tokens per minute from the run's metered token series, on the run's own time
 * window. With `cost`, the run's cost to date (`progress.samples[].runUsd`, the Runtime total that `spend.apiEquivalentUsd`
 * reports) with each release marked by the steps it passed. Now draws it side by side under the timeline; How it ran
 * stacks it, captioned.
 */
export function RunActivity({ doc, cost = false, releases = [], stacked = false }: { doc: RunDocument; cost?: boolean; releases?: readonly WorkspaceRelease[]; stacked?: boolean }) {
  const lineage = (doc as { lineage?: { settledAt?: string | null; series?: [string, number][] }[] }).lineage?.[0]
  const start = Date.parse(doc.run.startedAt ?? '') || -Infinity
  const end = Date.parse(lineage?.settledAt ?? doc.run.settledAt ?? '') || Infinity
  const inRun = (t: number) => Number.isFinite(t) && t >= start && t <= end
  const samples = (doc.progress?.samples ?? []).map((s) => ({ t: Date.parse(s.at), usd: s.runUsd, working: s.working }))
  const working = samples.filter((s) => inRun(s.t)).map((s): [number, number] => [s.t, s.working])
  const metered = (lineage?.series ?? []).map(([at, n]): [number, number] => [Date.parse(at), n]).filter(([t]) => inRun(t))
  const rate = metered.slice(1).map(([t, n], i): [number, number] => [t, t > metered[i]![0] ? ((n - metered[i]![1]) * 60_000) / (t - metered[i]![0]) : 0])
  const priced = samples.filter((s): s is typeof s & { usd: number } => typeof s.usd === 'number')
  const spent = cost ? priced.filter((s) => inRun(s.t)).map((s): [number, number] => [s.t, s.usd]) : []
  // A settled run's cost is read after the fact: the reading taken after it settled is what it had spent by its end.
  const final = doc.spend.apiEquivalentUsd ?? priced.at(-1)?.usd ?? null
  if (final !== null && spent.length && Number.isFinite(end) && final > spent.at(-1)![1]) spent.push([end, final])
  const marks: ChartMark[] = releases.flatMap((r) => {
    const at = Date.parse(r.at ?? '')
    if (!inRun(at) || !spent.length || at < spent[0]![0] || at > spent.at(-1)![0]) return []
    const steps = r.passed != null && r.total ? ` · ${r.passed}/${r.total} steps` : ''
    return [{ at, label: `${r.release}${steps}`, kind: 'release' as const, verdict: r.passed != null && r.total ? (r.passed === r.total ? 'pass' as const : 'fail' as const) : 'unknown' as const }]
  })
  const charts = [
    spent.length > 1 && { caption: 'Cost to date', node: <Lines rows={6} axis={clock} format={money} marks={marks} series={[{ name: 'cost to date', color: ACCENT, points: spent }]} /> },
    working.length > 1 && { caption: 'Agents working', node: <Lines rows={3} axis={clock} format={(v) => String(Math.round(v))} series={[{ name: 'agents working', color: ACCENT, points: working }]} /> },
    rate.length > 1 && { caption: 'Tokens per minute', node: <Lines rows={3} axis={clock} format={tokens} series={[{ name: 'tokens per minute', color: ACCENT, points: rate }]} /> },
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
