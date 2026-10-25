import type { ChartMark } from '@tangle-network/charts'
import { HBars, Lines } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import type { RecordNode } from '../record.js'
import type { NodeStats } from './RunTable.js'
import { duration, money, tokens, useDocument } from './data.js'
import type { RunWorkspaceDocument } from './RunWorkspace.js'

const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const total = (t: { input: number; output: number; cacheRead: number; cacheWrite: number } | null | undefined) => (t ? t.input + t.output + t.cacheRead + t.cacheWrite : null)

/**
 * How it ran (REVIEW-8: 62; charts 3 and 4): where the time and the money went, as pictures. One cost field, the run's
 * `spend.apiEquivalentUsd`, whose burn-up is `progress.samples[].runUsd` (the same Runtime run totals; /play and the
 * receipt print it). Agents are compared by tokens, the one measure every agent has; a dollar figure per agent is
 * known for only some of them. A row shows only when it has a number.
 */
export function RunHow({ doc, runUrl, agents, stats, onAgent, wasteLabel }: { doc: RunDocument; runUrl: string; agents: readonly RecordNode[]; stats: Record<string, NodeStats>; onAgent: (id: string) => string; wasteLabel: (dimension: string) => string }) {
  const ws = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, undefined, true)
  const spend = doc.spend
  const start = Date.parse(doc.run.startedAt ?? '') || Date.parse(doc.progress?.startedAt ?? '')
  const lineage = (doc as { lineage?: { settledAt?: string | null; series?: [string, number][] }[] }).lineage?.[0]
  const end = Date.parse(lineage?.settledAt ?? doc.run.settledAt ?? '') || Date.now()
  const inRun = (t: number) => t >= start && t <= end
  const samples = (doc.progress?.samples ?? []).map((s) => ({ t: Date.parse(s.at), usd: s.runUsd, working: s.working })).filter((s) => Number.isFinite(s.t))
  const working = samples.filter((s) => inRun(s.t)).map((s): [number, number] => [s.t, s.working])
  // A run's cost is read after the fact: the reading taken after it settled is what it had spent by its end.
  const priced = samples.filter((s): s is typeof s & { usd: number } => typeof s.usd === 'number')
  const cost = priced.filter((s) => inRun(s.t)).map((s): [number, number] => [s.t, s.usd])
  const final = spend.apiEquivalentUsd ?? priced.at(-1)?.usd ?? null
  if (final !== null && cost.length && final > cost.at(-1)![1]) cost.push([end, final])
  const metered = (lineage?.series ?? []).map(([at, n]): [number, number] => [Date.parse(at), n]).filter(([t]) => inRun(t))
  const rate = metered.slice(1).map(([t, n], i): [number, number] => [t, t > metered[i]![0] ? ((n - metered[i]![1]) * 60_000) / (t - metered[i]![0]) : 0])
  // Each release on the cost line: is the spend buying steps?
  const releases: ChartMark[] = (ws.data?.releases ?? []).flatMap((r) => {
    const at = Date.parse(r.at ?? '')
    if (!inRun(at)) return []
    const steps = r.passed != null && r.total ? ` · ${r.passed}/${r.total} steps` : ''
    return [{ at, label: `${r.release}${steps}`, kind: 'release' as const, verdict: r.passed != null && r.total ? (r.passed === r.total ? 'pass' as const : 'fail' as const) : 'unknown' as const }]
  })
  const tokenTotal = total(spend.tokens)
  const billed = spend.billing?.billedUsd ?? null
  const stat: [string, string, string][] = [
    ...(final !== null ? [['Cost', money(final), `API-equivalent: every token at list price${spend.apiEquivalentProvenance === 'estimated' ? ', Runtime’s estimate (it prices cache reads at the input rate)' : ''}`] as [string, string, string]] : []),
    ...(billed !== null ? [['Billed', money(billed), spend.billing?.basis ?? ''] as [string, string, string]] : []),
    ...(tokenTotal !== null ? [['Tokens', tokens(tokenTotal), `${tokens(spend.tokens!.input)} in · ${tokens(spend.tokens!.output)} out · ${tokens(spend.tokens!.cacheRead)} cache read`] as [string, string, string]] : []),
    ...(Number.isFinite(start) && end > start ? [['Duration', duration(end - start), `${new Date(start).toISOString().slice(0, 16)}Z – ${new Date(end).toISOString().slice(0, 16)}Z`] as [string, string, string]] : []),
  ]
  const time = (spend.byCategory ?? []).filter((row) => row.ms).sort((a, b) => b.ms! - a.ms!)
  const waste = (spend.waste ?? []).filter((row) => row.ms)
  const byAgent = agents
    .map((node) => ({ node, n: total(stats[node.id]?.tokens) }))
    .filter((row): row is { node: RecordNode; n: number } => row.n !== null && row.n > 0)
    .sort((a, b) => b.n - a.n)
  return (
    <div className="how" data-how>
      {stat.length > 0 && <dl className="rj-stats how-stats">{stat.map(([label, value, title]) => <div key={label} title={title}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {(working.length > 1 || rate.length > 1 || cost.length > 1) && (
        <section className="how-band" aria-label="Over the run">
          {cost.length > 1 && <figure><figcaption>Cost to date</figcaption><Lines rows={6} axis={clock} format={money} marks={releases} series={[{ name: 'cost to date', color: 'var(--ar-accent, #8e59ff)', points: cost }]} /></figure>}
          {working.length > 1 && <figure><figcaption>Agents working</figcaption><Lines rows={3} axis={clock} format={(v) => String(Math.round(v))} series={[{ name: 'agents working', color: 'var(--ar-accent, #8e59ff)', points: working }]} /></figure>}
          {rate.length > 1 && <figure><figcaption>Tokens per minute</figcaption><Lines rows={3} axis={clock} format={tokens} series={[{ name: 'tokens per minute', color: 'var(--ar-accent, #8e59ff)', points: rate }]} /></figure>}
        </section>
      )}
      <div className="how-grid">
        {time.length > 0 && (
          <section aria-label="Where the time went">
            <h3>Where the time went</h3>
            <HBars rows={time.map((row) => ({ label: row.category, value: row.ms!, note: row.tokens ? `${tokens(row.tokens)} tokens` : undefined }))} format={duration} color="var(--ar-accent, #8e59ff)" />
            {waste.length > 0 && <HBars max={Math.max(...time.map((row) => row.ms!))} rows={waste.map((row) => ({ label: `${wasteLabel(row.dimension)} (waste)`, value: row.ms! }))} format={duration} color="var(--ar-c-neutral, #8e8e8e)" />}
          </section>
        )}
        {byAgent.length > 0 && (
          <section aria-label="Tokens by agent">
            <h3>Tokens by agent</h3>
            <HBars rows={byAgent.map(({ node, n }) => ({ label: node.label, value: n, href: onAgent(node.id) }))} format={tokens} limit={10} />
          </section>
        )}
      </div>
    </div>
  )
}

