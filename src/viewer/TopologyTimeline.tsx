import { useMemo } from 'react'
import { TimelineView, type TimelineLane, type TimelineSpan } from '@tangle-network/charts/react'
import type { RunRecord } from '../record.js'
import { ms } from './model.js'

/**
 * Topology timeline: the record's agent tree rendered through the shared
 * charts TimelineView — parent-child connectors show which agent spawned
 * which, spans show when each ran, fold toggles collapse subtrees.
 */
export function TopologyTimeline({ record }: { record: RunRecord }) {
  const lanes = useMemo(() => buildLanes(record), [record])
  if (!lanes.length) return null
  return (
    <TimelineView
      lanes={lanes}
      options={{
        measure: 'elapsed time',
        formatTime: (msValue) => {
          const s = Math.round(msValue / 1000)
          if (s < 60) return `${s}s`
          const m = Math.floor(s / 60)
          if (m < 60) return `${m}m ${s % 60}s`
          return `${Math.floor(m / 60)}h ${m % 60}m`
        },
      }}
      defaultCollapsed={lanes
        .filter((lane) => lane.parent && lanes.some((other) => other.parent === lane.id))
        .map((lane) => lane.id)}
    />
  )
}

function buildLanes(record: RunRecord): TimelineLane[] {
  const eventsByNode = new Map<string, typeof record.events>()
  for (const event of record.events) {
    const list = eventsByNode.get(event.node) ?? []
    list.push(event)
    eventsByNode.set(event.node, list)
  }
  const nodeById = new Map(record.nodes.map((node) => [node.id, node]))
  const lanes: TimelineLane[] = []
  for (const node of record.nodes) {
    if (node.kind === 'session') continue
    const events = eventsByNode.get(node.id) ?? []
    const times = events.map((event) => ms(event.at)).filter(Number.isFinite)
    // Structural nodes (workflow parents, mentions) may carry no events but still
    // anchor the tree — their children reference them as parents. Include them
    // with a zero-duration span at their recorded start, or skip only when they
    // are both eventless and childless.
    if (!times.length) {
      const hasChildren = record.nodes.some((other) => other.parent === node.id)
      const startFallback = node.start ? ms(node.start) : undefined
      if (!hasChildren || startFallback === undefined || !Number.isFinite(startFallback)) continue
      times.push(startFallback)
    }
    const start = Math.min(...times)
    const end = Math.max(...times)
    const parent = nodeById.get(node.parent ?? '')
    const spans: TimelineSpan[] =
      end > start
        ? [{ start, end, state: 'running' }]
        : [{ start, end: start, state: 'running' }]
    const model = typeof node.model === 'string' ? node.model.split('/').pop() : undefined
    const role = typeof node.role === 'string' ? node.role : undefined
    const detail = [
      node.label,
      role ? `Role: ${role}` : null,
      model ? `Model: ${model}` : null,
      `${events.length} events`,
    ].filter((line): line is string => line !== null)
    lanes.push({
      id: node.id,
      label: node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label,
      parent: parent && parent.kind !== 'session' ? parent.id : undefined,
      spans,
      detail,
    })
  }
  return lanes
}
