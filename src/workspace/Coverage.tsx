import type { RecordGap } from '../record.js'
import type { RunDocument } from '../workspace-model.js'
import { agentState, measuredUsage } from '../viewer/model.js'
import type { RecordIndex } from '../viewer/model.js'
import type { NodeStats } from './RunTable.js'

const CAPTURE_WORD: Record<string, string> = { complete: 'Captured', lossy: 'Partly captured', absent: 'Not captured' }

/**
 * Each agent's capture and state. `index` holds only the selected agent's part, so whether an agent's usage was measured
 * comes from the nodes part's per-agent stats, as in the agents table; on magnetar-rust-20261018b the event scan alone
 * printed "no usage recorded" for the 14 workers whose 62.5M tokens the record holds.
 */
export function Coverage({ index, doc, gaps: recordGaps, stats, onSelect }: { index: RecordIndex; doc: RunDocument; gaps: RecordGap[]; stats: Record<string, NodeStats>; onSelect: (id: string) => void }) {
  const gaps = [...recordGaps, ...doc.spend.gaps]
  const measured = (id: string) => measuredUsage(index, id) || (!!stats[id] && (stats[id]!.tokens !== null || stats[id]!.listUsd !== null))
  return (
    <div className="coverage-tab" data-coverage>
      <table className="data-table">
        <thead>
          <tr><th>Agent</th><th>Channel</th><th>Capture</th><th>Reason</th><th>Status</th></tr>
        </thead>
        <tbody>
          {index.actors.filter((node) => node.kind !== 'finding').map((node) => {
            const capture = node.capture
            return (
              <tr key={node.id} className="clickable" onClick={() => onSelect(node.id)}>
                <td className="mono">{node.label}</td>
                <td className="mono">{capture?.channel ?? '—'}</td>
                <td><span className={`capture-chip capture-${capture?.status ?? 'unknown'}`}>{CAPTURE_WORD[capture?.status ?? ''] ?? 'Capture unknown'}</span></td>
                <td className="mono faint">{capture?.reason ?? ''}</td>
                <td>{agentState(node, measured(node.id), doc.live.polling ? (doc.progress?.agents.find((agent) => agent.node === node.id)?.status ?? 'running') : null)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {gaps.length > 0 && (
        <>
          <h3>Missing evidence</h3>
          <ul className="gap-list">
            {gaps.map((gap, i) => (
              <li key={i}>
                <code>{gap.code}</code> {gap.nodeId && <span className="mono">{index.nodes.get(gap.nodeId)?.label ?? gap.nodeId}</span>} {gap.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
