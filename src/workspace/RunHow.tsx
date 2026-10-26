import { HBars } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import type { RecordNode } from '../record.js'
import { agentName, type NodeStats } from './RunTable.js'
import { duration, money, tokens, useDocument } from './data.js'
import type { RunWorkspaceDocument } from './RunWorkspace.js'
import { RunActivity } from './RunActivity.js'

const total = (t: { input: number; output: number; cacheRead: number; cacheWrite: number } | null | undefined) => (t ? t.input + t.output + t.cacheRead + t.cacheWrite : null)

/**
 * How it ran (REVIEW-8: 62; charts 3 and 4): where the time and the money went, as pictures. One cost and one token count,
 * `spend.apiEquivalentUsd` and `spend.tokens`, both floors (per agent, the larger of recorded usage and metered turns; the
 * journal meter alone misses unmetered turns). Agents are compared by tokens, the one measure every agent has.
 */
export function RunHow({ doc, runUrl, agents, stats, onAgent, dimensions }: { doc: RunDocument; runUrl: string; agents: readonly RecordNode[]; stats: Record<string, NodeStats>; onAgent: (id: string) => string; dimensions: ReadonlyMap<string, { key: string }> }) {
  // Polled while the run is live, as RunJourney reads it, so release marks keep up (Codex review on #190).
  const ws = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, doc.execution?.alive ? 15_000 : undefined, true)
  const spend = doc.spend
  const cost = spend.apiEquivalentUsd ?? null
  const provenance = typeof spend.apiEquivalentProvenance === 'string' ? spend.apiEquivalentProvenance : ''
  const floor = provenance.includes('at least')
  const counted = total(spend.tokens)
  const billed = spend.billing?.billedUsd ?? null
  const stat: [string, string, string][] = [
    ...(cost !== null ? [['Cost', `${floor ? '≥' : ''}${money(cost)}`, `API-equivalent: every token at list price${provenance ? `, ${provenance}` : ''}`] as [string, string, string]] : []),
    ...(billed !== null ? [['Billed', money(billed), spend.billing?.basis ?? ''] as [string, string, string]] : []),
    ...(counted !== null ? [['Tokens', `≥${tokens(counted)}`, 'At least: per agent, the larger of its recorded usage and its metered turns'] as [string, string, string]] : []),
  ]
  const time = (spend.byCategory ?? []).filter((row) => row.ms).sort((a, b) => b.ms! - a.ms!)
  const waste = (spend.waste ?? []).filter((row) => row.ms)
  const byAgent = agents
    .map((node) => ({ node, n: total(stats[node.id]?.tokens) }))
    .filter((row): row is { node: RecordNode; n: number } => row.n !== null && row.n > 0)
    .sort((a, b) => b.n - a.n)
  return (
    // The charts and their numbers are the answer to "where did time and money go": the one primary region (reviewer gate 1).
    <div className="how" data-how>
      {stat.length > 0 && <dl className="rj-stats how-stats">{stat.map(([label, value, title]) => <div key={label} title={title}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <RunActivity doc={doc} marked releases={ws.data?.releases ?? []} />
      <div className="how-grid">
        {time.length > 0 && (
          <section aria-label="Where the time went">
            <h3>Where the time went</h3>
            <HBars rows={time.map((row) => ({ label: row.category, value: row.ms! }))} format={duration} color="var(--ar-accent, #8e59ff)" />
            {waste.length > 0 && <HBars max={Math.max(...time.map((row) => row.ms!))} rows={waste.map((row) => ({ label: `${row.dimension} ${dimensions.get(row.dimension)?.key.replaceAll('_', ' ') ?? ''} (waste)`.replace('  ', ' '), value: row.ms! }))} format={duration} color="var(--ar-c-neutral, #8e8e8e)" />}
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

