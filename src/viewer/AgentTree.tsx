import { useMemo } from 'react'
import type { RecordNode } from '../record.js'
import { activate } from './Charts.js'
import { ms, roleOf } from './model.js'
import type { RecordIndex } from './model.js'

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
  const tree = useMemo(() => {
    const nodes = index.actors.filter((node) => node.kind !== 'finding')
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const children = new Map<string, RecordNode[]>()
    for (const node of nodes)
      if (node.parent) {
        const parent = index.canonical(node.parent)
        const list = children.get(parent) ?? []
        list.push(node)
        children.set(parent, list)
      }
    const positions = new Map<string, { x: number; y: number }>()
    const ordered: RecordNode[] = []
    const visit = (node: RecordNode, depth: number) => {
      if (positions.has(node.id)) return
      positions.set(node.id, { x: 8 + depth * 18, y: 6 + ordered.length * 52 })
      ordered.push(node)
      for (const child of children.get(node.id) ?? []) visit(child, depth + 1)
    }
    for (const node of nodes)
      if (!node.parent || !byId.has(index.canonical(node.parent)))
        visit(node, 0)
    for (const node of nodes) visit(node, 0)
    return {
      ordered,
      positions,
      width: Math.max(
        235,
        ...[...positions.values()].map((position) => position.x + 200),
      ),
    }
  }, [index])
  return (
    <div className="graph-scroll">
      <svg
        data-graph
        viewBox={`0 0 ${tree.width} ${Math.max(60, tree.ordered.length * 52 + 12)}`}
        role="group"
        aria-label="Recorded agent hierarchy. Select an agent to read its conversation."
      >
        {tree.ordered.map((node) => {
          const position = tree.positions.get(node.id)!
          const parent = node.parent
            ? tree.positions.get(index.canonical(node.parent))
            : undefined
          return (
            parent && (
              <path
                key={node.id}
                d={`M${parent.x + 13},${parent.y + 30} V${position.y + 22} H${position.x + 10}`}
                className="graph-link"
              />
            )
          )
        })}
        {tree.ordered.map((node) => {
          const position = tree.positions.get(node.id)!
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
            <g
              key={node.id}
              className={`graph-node ${actor === node.id ? 'selected' : ''} ${future ? 'future' : ''}`}
              transform={`translate(${position.x},${position.y})`}
              role="button"
              tabIndex={0}
              aria-label={`Read ${roleOf(node)} ${node.label} conversation`}
              aria-pressed={actor === node.id}
              data-node={node.id}
              onClick={() => select(node.id)}
              onKeyDown={(event) => activate(event, () => select(node.id))}
            >
              <rect width={tree.width - position.x - 8} height={44} rx={5} />
              <circle
                cx={13}
                cy={16}
                r={3}
                className={
                  ended && node.status === 'done'
                    ? 'state-done'
                    : ended && node.status === 'down'
                      ? 'state-down'
                      : 'state-unknown'
                }
              />
              <text x={25} y={19} className="graph-label">
                {node.label.length > 24
                  ? `${node.label.slice(0, 22)}…`
                  : node.label}
              </text>
              <text x={25} y={35} className="graph-meta">
                {roleOf(node)} · {state}
              </text>
              <title>{`${node.label}${node.assignment ? ` · ${node.assignment}` : ''} · ${state}`}</title>
            </g>
          )
        })}
        {!tree.ordered.length && (
          <text x={8} y={28} className="axis-label">
            No agent topology was retained.
          </text>
        )}
      </svg>
    </div>
  )
}
