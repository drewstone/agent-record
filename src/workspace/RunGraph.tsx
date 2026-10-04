import { useMemo, useState } from 'react'
import type { RecordNode } from '../record.js'
import type { RecordIndex } from '../viewer/model.js'
import { ms, roleOf } from '../viewer/model.js'
import type { PlayDocument, RunSummary, Spend } from '../workspace.js'
import { duration, money, stateClass, stateLabel, when } from './data.js'

/** Edges run from the older run to the newer one. */
const EDGE_LABEL: Record<string, string> = { supersedes: 'superseded by', continues: 'continued by', retry: 'retried by', version: 'next version' }

const spendValue = (spend: Spend | undefined | null) => {
  const values = [spend?.paidUsd, spend?.listUsd].filter((value): value is number => typeof value === 'number')
  return values.length ? values.reduce((a, b) => a + b, 0) : null
}

// ---------------------------------------------------------------------------------------------------------
// Run topology: the agent tree at the replay time.
// ---------------------------------------------------------------------------------------------------------
interface Placed {
  node: RecordNode
  x: number
  y: number
  depth: number
  parent: string | null
}

export function TopologyGraph({
  index,
  cutoff,
  selected,
  onSelect,
  nodeSpend,
}: {
  index: RecordIndex
  cutoff: number
  selected: string
  onSelect: (id: string) => void
  nodeSpend?: Record<string, Spend>
}) {
  const ROW = 28
  const COLUMN = 176
  const layout = useMemo(() => {
    const nodes = index.actors.filter((node) => node.kind !== 'finding')
    const ids = new Set(nodes.map((node) => node.id))
    const children = new Map<string, RecordNode[]>()
    const roots: RecordNode[] = []
    for (const node of nodes) {
      const parent = node.parent ? index.canonical(node.parent) : null
      if (parent && ids.has(parent) && parent !== node.id) {
        const list = children.get(parent) ?? []
        list.push(node)
        children.set(parent, list)
      } else roots.push(node)
    }
    const placed = new Map<string, Placed>()
    let row = 0
    let maxDepth = 0
    const visit = (node: RecordNode, depth: number, parent: string | null): number => {
      if (placed.has(node.id)) return placed.get(node.id)!.y
      maxDepth = Math.max(maxDepth, depth)
      const entry: Placed = { node, x: 40 + depth * COLUMN, y: 0, depth, parent }
      placed.set(node.id, entry)
      const kids = children.get(node.id) ?? []
      if (!kids.length) entry.y = 30 + row++ * ROW
      else {
        const ys = kids.map((child) => visit(child, depth + 1, node.id))
        entry.y = (Math.min(...ys) + Math.max(...ys)) / 2
      }
      return entry.y
    }
    for (const root of roots) visit(root, 0, null)
    return {
      placed: [...placed.values()],
      parents: new Set([...children.keys()].filter((id) => placed.has(id))),
      height: Math.max(80, 30 + row * ROW),
      width: 40 + maxDepth * COLUMN + 240,
    }
  }, [index])

  const values = useMemo(() => {
    const result = new Map<string, { value: number | null; basis: 'spend' | 'time' }>()
    for (const { node } of layout.placed) {
      const spent = spendValue(nodeSpend?.[node.id])
      if (spent !== null) result.set(node.id, { value: spent, basis: 'spend' })
      else {
        const start = node.start ? ms(node.start) : index.byActor.get(node.id)?.[0] ? ms(index.byActor.get(node.id)![0]!.at) : NaN
        const end = node.end ? ms(node.end) : index.byActor.get(node.id)?.at(-1) ? ms(index.byActor.get(node.id)!.at(-1)!.at) : NaN
        result.set(node.id, { value: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null, basis: 'time' })
      }
    }
    return result
  }, [layout, nodeSpend, index])
  const anySpend = [...values.values()].some((entry) => entry.basis === 'spend')
  const max = Math.max(1e-9, ...[...values.values()].filter((entry) => entry.basis === (anySpend ? 'spend' : 'time')).map((entry) => entry.value ?? 0))
  const radius = (id: string) => {
    const entry = values.get(id)
    if (!entry || entry.value === null || (anySpend && entry.basis !== 'spend')) return 5
    return 5 + 9 * Math.sqrt(entry.value / max)
  }
  const stateAt = (node: RecordNode) => {
    const start = node.start ? ms(node.start) : index.byActor.get(node.id)?.[0] ? ms(index.byActor.get(node.id)![0]!.at) : -Infinity
    if (start > cutoff) return 'future'
    if (node.end && ms(node.end) <= cutoff)
      return node.status === 'done' || node.status === 'winner'
        ? 'done'
        : node.status === 'down' || node.status === 'failed' || node.status === 'driver-failed'
          ? 'down'
          : node.status === 'no-winner'
            ? 'no-winner'
            : 'ended'
    return node.end || node.status ? 'running' : 'open'
  }
  const byId = new Map(layout.placed.map((entry) => [entry.node.id, entry]))
  return (
    <div className="topology-graph" data-topology>
      <div className="graph-canvas">
        <svg width={layout.width} height={layout.height} role="group" aria-label="Agent topology. Select an agent to read its conversation.">
          {layout.placed.map((entry) => {
            if (!entry.parent) return null
            const parent = byId.get(entry.parent)
            if (!parent || stateAt(entry.node) === 'future') return null
            const x1 = parent.x + radius(parent.node.id)
            const x2 = entry.x - radius(entry.node.id)
            const mid = (x1 + x2) / 2
            return <path key={`edge:${entry.node.id}`} className="topology-edge" d={`M${x1},${parent.y} C${mid},${parent.y} ${mid},${entry.y} ${x2},${entry.y}`} />
          })}
          {layout.placed.map((entry) => {
            const { node } = entry
            const state = stateAt(node)
            if (state === 'future') return null
            const r = radius(node.id)
            const capture = (node.capture as { status?: string; reason?: string } | undefined) ?? undefined
            const value = values.get(node.id)
            const spent = nodeSpend?.[node.id]
            const title = [
              node.label,
              `${roleOf(node)} · ${state === 'running' ? 'running at this time' : stateLabel(node.status)}`,
              node.servedModel ?? node.model ?? null,
              capture ? `conversation: ${capture.status ?? 'unknown'}${capture.reason ? ` (${capture.reason})` : ''}` : null,
              spent ? `paid ${money(spent.paidUsd)} · list price ${money(spent.listUsd)}` : value?.basis === 'time' ? `active ${duration(value.value)}` : null,
            ].filter(Boolean).join('\n')
            return (
              <g
                key={node.id}
                className={`topology-node node-${state} ${selected === node.id ? 'selected' : ''} ${capture?.status === 'absent' ? 'capture-absent' : ''}`}
                transform={`translate(${entry.x},${entry.y})`}
                role="button"
                tabIndex={0}
                data-node={node.id}
                aria-label={`${node.label}, ${state}`}
                aria-pressed={selected === node.id}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(node.id)
                  }
                }}
              >
                <title>{title}</title>
                {selected === node.id && <circle className="node-halo" r={r + 5} />}
                <circle className="node-dot" r={r} />
                {/* Labels carry a panel-coloured halo so edges passing beneath stay readable. */}
                <text x={r + 6} y={4} className="node-label">
                  {layout.parents.has(node.id)
                    ? node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label
                    : node.label.length > 30 ? `${node.label.slice(0, 29)}…` : node.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="graph-legend">
        <span><i className="dot state-ok" />done</span>
        <span><i className="dot state-fail" />down</span>
        <span><i className="dot state-warn" />no winner</span>
        <span><i className="dot state-run" />running</span>
        <span><i className="dot ended" />ended, state not recorded</span>
        <span><i className="dot ring" />no conversation</span>
        <span className="legend-note">{anySpend ? 'size: paid and list price' : 'size: active time'}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------
// Play lineage: runs and how they continue or supersede each other.
// ---------------------------------------------------------------------------------------------------------
export function LineageGraph({
  play,
  onOpen,
}: {
  play: PlayDocument
  onOpen: (runId: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const runs = useMemo(() => new Map<string, RunSummary>(play.runs.map((run) => [run.id, run])), [play])
  const layout = useMemo(() => {
    const ids = [...new Set([...play.lineage.nodes.map((node) => node.runId), ...play.runs.map((run) => run.id)])]
    const start = (id: string) => {
      const value = runs.get(id)?.startedAt
      return value ? Date.parse(value) : Number.POSITIVE_INFINITY
    }
    // A run without a start time sits between the run it continues (edge `to`) and the run that supersedes it
    // (edge `from`): an edge reads `from <kind> to`, newer first.
    const after = new Map<string, number>()
    const before = new Map<string, number>()
    for (const edge of play.lineage.edges) {
      if (Number.isFinite(start(edge.to))) after.set(edge.from, Math.max(after.get(edge.from) ?? -Infinity, start(edge.to)))
      if (Number.isFinite(start(edge.from))) before.set(edge.to, Math.min(before.get(edge.to) ?? Infinity, start(edge.from)))
    }
    const anchored = new Map<string, number>()
    for (const id of ids) {
      if (Number.isFinite(start(id))) continue
      const lo = after.get(id)
      const hi = before.get(id)
      if (lo !== undefined && hi !== undefined) anchored.set(id, (lo + hi) / 2)
      else if (lo !== undefined) anchored.set(id, lo + 1)
      else if (hi !== undefined) anchored.set(id, hi - 1)
    }
    const when = (id: string) => (Number.isFinite(start(id)) ? start(id) : (anchored.get(id) ?? Number.POSITIVE_INFINITY))
    const order = [...ids].sort((a, b) => when(a) - when(b) || a.localeCompare(b))
    const rank = new Map(order.map((id, i) => [id, i]))
    // Connected components share a lane; lanes are packed by their rank interval.
    const parent = new Map(ids.map((id) => [id, id]))
    const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!))
    for (const edge of play.lineage.edges)
      if (parent.has(edge.from) && parent.has(edge.to)) parent.set(find(edge.from), find(edge.to))
    const components = new Map<string, string[]>()
    for (const id of order) {
      const root = find(id)
      components.set(root, [...(components.get(root) ?? []), id])
    }
    const lanes: number[] = []
    const lane = new Map<string, number>()
    for (const members of [...components.values()].sort((a, b) => rank.get(a[0]!)! - rank.get(b[0]!)!)) {
      const first = rank.get(members[0]!)!
      const last = rank.get(members.at(-1)!)!
      let index = lanes.findIndex((end) => end < first)
      if (index < 0) index = lanes.push(-1) - 1
      lanes[index] = last
      for (const id of members) lane.set(id, index)
    }
    const COLUMN = 132
    const ROW = 120
    const TOP = 112
    const positions = new Map(order.map((id) => [id, { x: 70 + rank.get(id)! * COLUMN, y: TOP + lane.get(id)! * ROW }]))
    return { order, positions, column: COLUMN, width: 140 + Math.max(0, order.length - 1) * COLUMN, height: TOP - 30 + Math.max(1, lanes.length) * ROW }
  }, [play, runs])
  // One path per pair of runs; several relations share it.
  const edges = useMemo(() => {
    const pairs = new Map<string, { a: string; b: string; kinds: string[] }>()
    for (const edge of play.lineage.edges) {
      const key = [edge.from, edge.to].sort().join('\0')
      const pair = pairs.get(key) ?? { a: edge.from, b: edge.to, kinds: [] }
      if (!pair.kinds.includes(edge.kind)) pair.kinds.push(edge.kind)
      pairs.set(key, pair)
    }
    return [...pairs.values()]
  }, [play])
  const values = play.runs.map((run) => spendValue(run.spend)).filter((value): value is number => value !== null)
  const max = Math.max(1e-9, ...values)
  const radius = (id: string) => {
    const value = spendValue(runs.get(id)?.spend)
    return value === null ? 9 : 9 + 15 * Math.sqrt(value / max)
  }
  const nodeState = new Map(play.lineage.nodes.map((node) => [node.runId, node]))
  const short = (id: string) => (id.startsWith(play.id + '-') ? id.slice(play.id.length + 1) : id)
  return (
    <div className="lineage-graph" data-lineage>
      <div className="graph-canvas">
        <svg width={layout.width} height={layout.height} role="group" aria-label="Run lineage. Select a run to open it.">
          <defs>
            <marker id="lineage-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="lineage-arrow" />
            </marker>
          </defs>
          {edges.map(({ a, b, kinds }, i) => {
            const pa = layout.positions.get(a)
            const pb = layout.positions.get(b)
            if (!pa || !pb) return null
            const [older, newer, olderId, newerId] = pa.x <= pb.x ? [pa, pb, a, b] : [pb, pa, b, a]
            const span = Math.round((newer.x - older.x) / layout.column)
            const label = kinds.map((kind) => EDGE_LABEL[kind] ?? kind).join(' · ')
            const kind = kinds[0]!
            if (older.y === newer.y && span > 1) {
              // Arcs over the lane keep a long edge clear of the runs between its ends.
              const lift = 22 + 16 * Math.min(span - 1, 5) + (i % 2) * 6
              const x1 = older.x
              const x2 = newer.x
              const top = older.y - radius(olderId) - lift
              return (
                <g key={`${a}>${b}`} className={`lineage-edge edge-${kind}`}>
                  <path d={`M${x1},${older.y - radius(olderId)} C${x1},${top} ${x2},${top} ${x2},${newer.y - radius(newerId) - 4}`} markerEnd="url(#lineage-arrow)" />
                  <text x={(x1 + x2) / 2} y={top + 8} textAnchor="middle" className="edge-label">{label}</text>
                </g>
              )
            }
            const x1 = older.x + radius(olderId)
            const x2 = newer.x - radius(newerId) - 4
            const mid = (x1 + x2) / 2
            return (
              <g key={`${a}>${b}`} className={`lineage-edge edge-${kind}`}>
                <path d={`M${x1},${older.y} C${mid},${older.y} ${mid},${newer.y} ${x2},${newer.y}`} markerEnd="url(#lineage-arrow)" />
                {x2 - x1 > label.length * 6.2 + 12 && <text x={mid} y={(older.y + newer.y) / 2 - 6} textAnchor="middle" className="edge-label">{label}</text>}
              </g>
            )
          })}
          {layout.order.map((id) => {
            const position = layout.positions.get(id)!
            const run = runs.get(id)
            const lineage = nodeState.get(id)
            const state = run?.state ?? lineage?.state ?? 'unknown'
            const missing = !run || lineage?.record.status === 'missing' || state === 'no-record'
            const r = radius(id)
            return (
              <g
                key={id}
                className={`lineage-node ${stateClass(state)} ${missing ? 'gap' : ''} ${hover === id ? 'hover' : ''}`}
                transform={`translate(${position.x},${position.y})`}
                role={run ? 'link' : undefined}
                tabIndex={run ? 0 : -1}
                data-run={id}
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => run && onOpen(id)}
                onKeyDown={(event) => {
                  if (run && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onOpen(id)
                  }
                }}
              >
                <title>
                  {[
                    id,
                    stateLabel(state),
                    run?.startedAt ? `started ${when(run.startedAt)}` : 'start unknown',
                    run ? `paid ${money(run.spend.paidUsd)} · list price ${money(run.spend.listUsd)}` : 'no run record',
                    lineage?.record.reason ?? null,
                  ].filter(Boolean).join('\n')}
                </title>
                <circle className="run-dot" r={r} />
                {run?.versions && run.versions.count > 1 && <text className="run-versions" y={4} textAnchor="middle">{run.versions.count}</text>}
                <text className="run-label" y={r + 14} textAnchor="middle">{short(id).length > 20 ? `${short(id).slice(0, 19)}…` : short(id)}</text>
                <text className="run-sub" y={r + 26} textAnchor="middle">{missing ? 'no record' : stateLabel(state)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="graph-legend">
        <span><i className="dot state-ok" />winner</span>
        <span><i className="dot state-warn" />no winner</span>
        <span><i className="dot state-fail" />failed</span>
        <span><i className="dot state-run" />running</span>
        <span><i className="dot gap" />no record</span>
        <span className="legend-line edge-supersedes">superseded by</span>
        <span className="legend-line edge-continues">continued by</span>
        <span className="legend-line edge-retry">retried by</span>
        <span className="legend-note">size: paid and list price</span>
      </div>
    </div>
  )
}
