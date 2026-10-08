/**
 * A play's runs as one story, laid out for the shared canvas engine (useCanvasView): one node per run, one edge per
 * recorded link (a fork from its fork.json, a supersedes or a continuation from the run's registration), oldest at the
 * left. A run that continues one line stays on its lane; a second run from the same source opens a lane below. A run
 * a link names but this host does not hold is drawn as a ghost. Version members of a run are not drawn: they are its
 * internal history, on the Versions tab.
 *
 * Self-contained (type-only imports) so the tests run it from source.
 */
import type { Fork, PlayDocument, Release, RunSummary } from '../workspace.js'

export const L_NODE_W = 264
export const L_NODE_H = 122
/** Wide enough between cards for an edge's label (what moved at a fork). */
export const L_COL_W = 264 + 196
export const L_ROW_H = 176

export type LineageEdgeKind = 'fork' | 'supersedes' | 'continues' | 'retry'

export interface LineageNode {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly column: number
  readonly lane: number
  /** null for a run the links name that this host does not hold. */
  readonly run: RunSummary | null
  readonly state: string
  /** The fork that made this run, from its fork.json; null when it was not forked. */
  readonly fork: Fork | null
  /** The releases this run's repository declared. */
  readonly releases: readonly Release[]
}

export interface LineageEdge {
  readonly id: string
  /** The earlier run. */
  readonly from: string
  /** The run that came from it. */
  readonly to: string
  readonly kind: LineageEdgeKind
  /** What moved at a fork, in a few words (`model gpt-5.6-sol → gpt-6.1-sol`), or the link's kind. */
  readonly label: string
  readonly fork: Fork | null
}

export interface LineageModel {
  readonly nodes: readonly LineageNode[]
  readonly edges: readonly LineageEdge[]
  readonly byId: ReadonlyMap<string, LineageNode>
  readonly width: number
  readonly height: number
  /** The newest run on the longest line: where the canvas opens. */
  readonly focus: string | null
  readonly counts: { readonly runs: number; readonly forks: number; readonly releases: number; readonly lines: number }
}

const STORY_KINDS = new Set<LineageEdgeKind>(['fork', 'supersedes', 'continues', 'retry'])
const RANK: Record<LineageEdgeKind, number> = { fork: 0, supersedes: 1, continues: 2, retry: 3 }

/** What moved at a fork, short enough for an edge label. */
export function forkLabel(fork: Fork | null, kind: LineageEdgeKind): string {
  if (!fork) return kind
  const from = fork.root.from
  const to = fork.root.to
  if (fork.root.moved.includes('model') && from?.model && to?.model) return `model ${from.model} → ${to.model}`
  if (fork.root.moved.includes('harness') && from?.harness && to?.harness) return `harness ${from.harness} → ${to.harness}`
  if (fork.profiles.length) return `fork · ${fork.profiles.length} ${fork.profiles.length === 1 ? 'profile' : 'profiles'} revised`
  return 'fork'
}

/** The play's lineage model: the story edges between its runs, each child's parent chosen by the strongest record. */
export function lineageModel(play: PlayDocument): LineageModel {
  const runs = new Map(play.runs.map((run) => [run.id, run]))
  const forks = new Map((play.lineage.forks ?? []).map((fork) => [fork.to, fork]))
  const releases = new Map<string, Release[]>()
  for (const release of play.lineage.releases ?? []) releases.set(release.run, [...(releases.get(release.run) ?? []), release])
  // Doc edges point from the later run to the earlier one; the story draws earlier → later.
  const links = play.lineage.edges.filter((edge) => STORY_KINDS.has(edge.kind as LineageEdgeKind) && edge.from !== edge.to)
  const ids = new Set<string>([...runs.keys()])
  for (const edge of links) {
    ids.add(edge.from)
    ids.add(edge.to)
  }
  const started = (id: string) => runs.get(id)?.startedAt ?? ''
  // Each run's parent: its strongest link (fork, then supersedes, continues, retry), then the earliest-started target.
  const parent = new Map<string, { id: string; kind: LineageEdgeKind }>()
  for (const edge of [...links].sort((a, b) => RANK[a.kind as LineageEdgeKind] - RANK[b.kind as LineageEdgeKind] || started(a.to).localeCompare(started(b.to)))) {
    if (!parent.has(edge.from)) parent.set(edge.from, { id: edge.to, kind: edge.kind as LineageEdgeKind })
  }
  const children = new Map<string, string[]>()
  for (const [child, { id }] of parent) children.set(id, [...(children.get(id) ?? []), child])
  for (const list of children.values()) list.sort((a, b) => started(a).localeCompare(started(b)) || a.localeCompare(b))
  const roots = [...ids].filter((id) => !parent.has(id)).sort((a, b) => started(a).localeCompare(started(b)) || a.localeCompare(b))

  // Lanes: a run's first child stays on its lane, the others open new lanes below; a cycle in bad data stops at a
  // visited run.
  const place = new Map<string, { column: number; lane: number }>()
  let nextLane = 0
  const visit = (id: string, column: number, lane: number) => {
    if (place.has(id)) return
    place.set(id, { column, lane })
    const kids = children.get(id) ?? []
    kids.forEach((kid, i) => visit(kid, column + 1, i === 0 ? lane : ++nextLane))
  }
  for (const root of roots) visit(root, 0, place.size ? ++nextLane : nextLane)
  for (const id of ids) if (!place.has(id)) visit(id, 0, ++nextLane)

  const nodes: LineageNode[] = [...ids].map((id) => {
    const at = place.get(id)!
    const run = runs.get(id) ?? null
    return {
      id, column: at.column, lane: at.lane, x: at.column * L_COL_W, y: at.lane * L_ROW_H, run,
      state: run?.state ?? (play.lineage.nodes.find((node) => node.runId === id)?.state ?? 'unknown'),
      fork: forks.get(id) ?? null, releases: releases.get(id) ?? [],
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges: LineageEdge[] = []
  const seen = new Set<string>()
  for (const edge of links) {
    const key = `${edge.to}->${edge.from}`
    if (seen.has(key)) continue
    seen.add(key)
    const fork = edge.kind === 'fork' ? (forks.get(edge.from) ?? null) : null
    edges.push({ id: `${key}:${edge.kind}`, from: edge.to, to: edge.from, kind: edge.kind as LineageEdgeKind, label: forkLabel(fork, edge.kind as LineageEdgeKind), fork })
  }
  const columns = Math.max(1, ...nodes.map((node) => node.column + 1))
  const lanes = Math.max(1, ...nodes.map((node) => node.lane + 1))
  const deepest = nodes.filter((node) => node.run).sort((a, b) => b.column - a.column || a.lane - b.lane)[0] ?? null
  return {
    nodes, edges, byId,
    width: (columns - 1) * L_COL_W + L_NODE_W,
    height: (lanes - 1) * L_ROW_H + L_NODE_H,
    focus: deepest?.id ?? null,
    counts: { runs: runs.size, forks: (play.lineage.forks ?? []).length, releases: (play.lineage.releases ?? []).length, lines: lanes },
  }
}

/** The run an arrow key moves to: along its line (left, right), or to the nearest run on the lane above or below. */
export function lineageNeighbour(model: LineageModel, id: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): string | null {
  const node = model.byId.get(id)
  if (!node) return null
  if (key === 'ArrowLeft') return model.edges.find((edge) => edge.to === id)?.from ?? null
  if (key === 'ArrowRight') return model.edges.find((edge) => edge.from === id)?.to ?? null
  const lane = node.lane + (key === 'ArrowDown' ? 1 : -1)
  const candidates = model.nodes.filter((other) => other.lane === lane)
  return candidates.sort((a, b) => Math.abs(a.column - node.column) - Math.abs(b.column - node.column))[0]?.id ?? null
}

/** The runs on the path through `id`: its ancestors and descendants, lit when it is hovered or selected. */
export function lineageLit(model: LineageModel, id: string): Set<string> {
  const lit = new Set<string>([id])
  const up = (node: string) => {
    for (const edge of model.edges) if (edge.to === node && !lit.has(edge.from)) { lit.add(edge.from); up(edge.from) }
  }
  const down = (node: string) => {
    for (const edge of model.edges) if (edge.from === node && !lit.has(edge.to)) { lit.add(edge.to); down(edge.to) }
  }
  up(id)
  down(id)
  return lit
}

/**
 * The deliverable timeline: one column per release in time order, one row per declared deliverable, each cell whether
 * the change since the release before it touched that deliverable (null when that change is unknown). A path the
 * declarations do not cover is counted under `other`.
 */
export function deliverableTimeline(play: PlayDocument) {
  const releases = [...(play.lineage.releases ?? [])].sort((a, b) => a.at.localeCompare(b.at))
  const deliverables = play.lineage.deliverables ?? []
  const rows = deliverables.map((deliverable) => ({
    id: deliverable.id,
    kind: deliverable.kind,
    path: deliverable.path,
    cells: releases.map((release) => (release.deliverables === null ? null : release.deliverables.includes(deliverable.id))),
  }))
  const other = releases.map((release) => {
    if (!release.changes) return null
    const covered = (path: string | null) => !!path && deliverables.some((item) => path.startsWith(item.path.replace(/^\/+/, '')))
    return release.changes.paths.filter((row) => !covered(row.path)).length
  })
  return { releases, rows, other }
}
