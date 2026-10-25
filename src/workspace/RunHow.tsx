import { HBars } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import type { RecordNode } from '../record.js'
import { agentName, type NodeStats } from './RunTable.js'
import { duration, money, tokens, useDocument } from './data.js'
import type { RunWorkspaceDocument } from './RunWorkspace.js'
import { RunActivity } from './RunActivity.js'

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
  const start = Date.parse(doc.run.startedAt ?? '')
  const end = Date.parse((doc as { lineage?: { settledAt?: string | null }[] }).lineage?.[0]?.settledAt ?? doc.run.settledAt ?? '') || Date.now()
  const final = spend.apiEquivalentUsd ?? null
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
    // The charts and their numbers are the answer to "where did time and money go": the one primary region (reviewer gate 1).
    <div className="how" data-how data-primary-content>
      {stat.length > 0 && <dl className="rj-stats how-stats">{stat.map(([label, value, title]) => <div key={label} title={title}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <RunActivity doc={doc} cost releases={ws.data?.releases ?? []} stacked />
      <div className="how-grid">
        {time.length > 0 && (
          <section aria-label="Where the time went">
            <h3>Where the time went</h3>
            <HBars rows={time.map((row) => ({ label: row.category, value: row.ms! }))} format={duration} color="var(--ar-accent, #8e59ff)" />
            {waste.length > 0 && <HBars max={Math.max(...time.map((row) => row.ms!))} rows={waste.map((row) => ({ label: `${wasteLabel(row.dimension)} (waste)`, value: row.ms! }))} format={duration} color="var(--ar-c-neutral, #8e8e8e)" />}
          </section>
        )}
        {byAgent.length > 0 && (
          <section aria-label="Tokens by agent">
            <h3>Tokens by agent</h3>
            <HBars rows={byAgent.map(({ node, n }) => ({ label: agentName(doc, node), value: n, href: onAgent(node.id) }))} format={tokens} limit={10} color="var(--ar-accent, #8e59ff)" />
          </section>
        )}
      </div>
    </div>
  )
}

