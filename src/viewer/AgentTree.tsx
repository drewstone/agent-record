import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { RecordNode } from '../record.js'
import { ms, roleOf } from './model.js'
import type { RecordIndex } from './model.js'

type TreeEntry = { node: RecordNode; children: TreeEntry[] }

export function AgentTree({
  index,
  actor,
  cutoff,
  select,
}: {
  index: RecordIndex
  actor: string
  cutoff: number
  select: (id: string) => void
}) {
  const roots = useMemo(() => {
    const nodes = index.actors.filter((node) => node.kind !== 'finding')
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const children = new Map<string, RecordNode[]>()
    for (const node of nodes) {
      if (!node.parent) continue
      const parent = index.canonical(node.parent)
      const siblings = children.get(parent) ?? []
      siblings.push(node)
      children.set(parent, siblings)
    }
    const visited = new Set<string>()
    const visit = (node: RecordNode): TreeEntry[] => {
      if (visited.has(node.id)) return []
      visited.add(node.id)
      return [{ node, children: (children.get(node.id) ?? []).flatMap(visit) }]
    }
    const roots = nodes
      .filter((node) => !node.parent || !byId.has(index.canonical(node.parent)))
      .flatMap(visit)
    // Canonical session attribution can form cycles; retain every actor once.
    for (const node of nodes) roots.push(...visit(node))
    return roots
  }, [index])

  const renderNodes = (
    entries: readonly TreeEntry[],
    nested = false,
  ): ReactNode => (
    <ul className={nested ? 'graph-branch' : 'graph-list'}>
      {entries.map(({ node, children }) => {
        const firstEvent = index.byActor.get(node.id)?.[0]
        const begin = node.start
          ? ms(node.start)
          : firstEvent
            ? ms(firstEvent.at)
            : undefined
        const future = begin !== undefined && begin > cutoff
        const ended = node.end !== undefined && ms(node.end) <= cutoff
        const state = future
          ? 'Not yet started'
          : ended
            ? node.status === 'done'
              ? 'Finished'
              : node.status === 'down'
                ? 'Stopped'
                : (node.status ?? 'Ended')
            : node.end
              ? 'Not yet settled'
              : 'No terminal record'
        return (
          <li className="graph-item" key={node.id}>
            <button
              type="button"
              className={`graph-node ${actor === node.id ? 'selected' : ''} ${future ? 'future' : ''}`}
              aria-label={`Read ${roleOf(node)} ${node.label} conversation. ${state}.`}
              aria-pressed={actor === node.id}
              data-node={node.id}
              title={`${node.label}${node.assignment ? ` · ${node.assignment}` : ''} · ${state}`}
              onClick={() => select(node.id)}
            >
              <span
                className={`graph-state ${ended && node.status === 'done' ? 'state-done' : ended && node.status === 'down' ? 'state-down' : 'state-unknown'}`}
                aria-hidden="true"
              />
              <span className="graph-copy">
                <span className="graph-label">{node.label}</span>
                <span className="graph-meta">{roleOf(node)} · {state}</span>
              </span>
            </button>
            {children.length > 0 && renderNodes(children, true)}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div
      className="graph-scroll"
      data-graph
      role="group"
      aria-label="Recorded agent hierarchy. Select an agent to read its conversation."
    >
      {roots.length > 0 ? (
        renderNodes(roots)
      ) : (
        <p className="axis-label">No agent topology was retained.</p>
      )}
    </div>
  )
}
