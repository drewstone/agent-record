import type { ProfileDiff, ProfileGraphDocument, ProfileNode, ProfileParent } from '../workspace.js'

/**
 * The profile-version graph of one play, read for drawing. A node is one exact AgentProfile (by digest). Each node
 * hangs under its primary parent; a profile written at runtime hangs under the profile of the agent that authored it,
 * and those authored subtrees start collapsed so the version lineage reads first.
 */
export interface ProfileGraph {
  nodes: Map<string, ProfileNode>
  /** The primary parent edge, when that parent is in the document. */
  parentOf: Map<string, ProfileParent>
  /** Children by primary parent, roots first, then oldest first. */
  children: Map<string, ProfileNode[]>
  /** Nodes with no primary parent in the document, in the same order. */
  heads: ProfileNode[]
  /** How many children each node has through an `authored` primary edge. */
  authored: Map<string, number>
}

/** Branches before the line they leave: a treatment, then the next revision, then what the profile authored. */
const RELATION_RANK = { treatment: 0, revision: 1, authored: 2 } as const
const relationRank = (node: ProfileNode) => RELATION_RANK[primaryParent(node)?.relation ?? 'revision']
const order = (a: ProfileNode, b: ProfileNode) =>
  (a.kind === b.kind ? 0 : a.kind === 'root' ? -1 : 1) ||
  relationRank(a) - relationRank(b) ||
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
  String(a.createdIn ?? '').localeCompare(String(b.createdIn ?? '')) ||
  String(a.name ?? a.label ?? '').localeCompare(String(b.name ?? b.label ?? '')) ||
  a.digest.localeCompare(b.digest)

/** The edge a node hangs from: its primary parent, else its first parent. */
export const primaryParent = (node: ProfileNode): ProfileParent | null =>
  node.parents.find((parent) => parent.primary) ?? node.parents[0] ?? null

export function profileGraph(doc: ProfileGraphDocument): ProfileGraph {
  const nodes = new Map(doc.nodes.map((node) => [node.digest, node]))
  const parentOf = new Map<string, ProfileParent>()
  for (const node of doc.nodes) {
    const parent = primaryParent(node)
    if (parent && parent.digest !== node.digest && nodes.has(parent.digest)) parentOf.set(node.digest, parent)
  }
  // A primary-parent cycle in bad data must not hide its members: break it at the first node met again.
  for (const node of doc.nodes) {
    const seen = new Set<string>()
    let at: string | undefined = node.digest
    while (at && parentOf.has(at)) {
      if (seen.has(at)) {
        parentOf.delete(at)
        break
      }
      seen.add(at)
      at = parentOf.get(at)?.digest
    }
  }
  const children = new Map<string, ProfileNode[]>()
  const authored = new Map<string, number>()
  const heads: ProfileNode[] = []
  for (const node of doc.nodes) {
    const parent = parentOf.get(node.digest)
    if (!parent) {
      heads.push(node)
      continue
    }
    children.set(parent.digest, [...(children.get(parent.digest) ?? []), node])
    if (parent.relation === 'authored') authored.set(parent.digest, (authored.get(parent.digest) ?? 0) + 1)
  }
  for (const list of children.values()) list.sort(order)
  heads.sort(order)
  return { nodes, parentOf, children, heads, authored }
}

/** Nodes shown when the authors in `expanded` are open: every head, and every child not behind a closed authored edge. */
export function visibleProfiles(graph: ProfileGraph, expanded: ReadonlySet<string>): Set<string> {
  const shown = new Set<string>()
  const walk = (node: ProfileNode) => {
    if (shown.has(node.digest)) return
    shown.add(node.digest)
    for (const child of graph.children.get(node.digest) ?? []) {
      const edge = graph.parentOf.get(child.digest)
      if (edge?.relation !== 'authored' || expanded.has(node.digest)) walk(child)
    }
  }
  for (const head of graph.heads) walk(head)
  return shown
}

/** The authors that must be open for `digest` to show. */
export function authorsAbove(graph: ProfileGraph, digest: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let at = digest
  while (!seen.has(at)) {
    seen.add(at)
    const edge = graph.parentOf.get(at)
    if (!edge) break
    if (edge.relation === 'authored') out.push(edge.digest)
    at = edge.digest
  }
  return out
}

/** A node by its full digest, its 64-hex part, or a unique prefix of at least 8 hex characters. */
export function findProfile(graph: ProfileGraph, ref: string | null | undefined): ProfileNode | null {
  if (!ref) return null
  const hex = ref.replace(/^sha256:/, '').toLowerCase()
  if (!/^[0-9a-f]{8,64}$/.test(hex)) return null
  const hits = [...graph.nodes.values()].filter((node) => node.digest.slice(7).startsWith(hex))
  return hits.length === 1 ? hits[0]! : null
}

export const diffKey = (from: string, to: string) => `${from}..${to}`

/** The diff a node shows: against its primary parent, when the document carries one. */
export function primaryDiff(doc: ProfileGraphDocument, node: ProfileNode): ProfileDiff | null {
  const parent = primaryParent(node)
  return parent ? (doc.diffs[diffKey(parent.digest, node.digest)] ?? null) : null
}

/** Calibrated categories that rose, fell or held on an edge; null when the score change is unknown. */
export function deltaSummary(diff: ProfileDiff | null | undefined) {
  if (!diff || diff.scoreDelta.status !== 'known') return null
  const rows = diff.scoreDelta.categories.filter((row) => row.calibrated && row.delta !== null)
  return {
    up: rows.filter((row) => row.delta! > 0).length,
    down: rows.filter((row) => row.delta! < 0).length,
    same: rows.filter((row) => row.delta === 0).length,
    advisory: diff.scoreDelta.categories.filter((row) => !row.calibrated).length,
  }
}

/** The state a node shows: its newest run's node outcome or run state, `registered` when it never ran. */
export function profileState(node: ProfileNode): string {
  const run = node.runs.at(-1)
  if (!run) return 'registered'
  return run.outcome ?? run.run.state ?? 'unknown'
}

/** The short name a node is drawn with: its run for a root of this play, otherwise its profile name. */
export function profileLabel(node: ProfileNode, play: string): string {
  if (node.kind === 'root' && node.createdIn) return node.createdIn.startsWith(`${play}-`) ? node.createdIn.slice(play.length + 1) : node.createdIn
  return node.name ?? node.label ?? node.short
}

export interface PlacedProfile {
  node: ProfileNode
  x: number
  y: number
  depth: number
  r: number
  /** Label lines right of the dot: name, then digest and state, then the authored toggle when it has one. */
  label: string
  sub: string
  toggle: string | null
  /** Width of the label block in pixels. */
  width: number
}

const fit = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text)

/** Left-to-right tree layout over the visible nodes; columns as wide as their labels, wider before a version edge. */
export function layoutProfiles(
  graph: ProfileGraph,
  shown: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  play: string,
  { main = 7.5, small = 6.7, labelChars = 32 } = {},
) {
  const placed = new Map<string, PlacedProfile>()
  const depthOf = new Map<string, number>()
  const walkDepth = (node: ProfileNode, depth: number) => {
    if (depthOf.has(node.digest)) return
    depthOf.set(node.digest, depth)
    for (const child of graph.children.get(node.digest) ?? []) if (shown.has(child.digest)) walkDepth(child, depth + 1)
  }
  for (const head of graph.heads) if (shown.has(head.digest)) walkDepth(head, 0)
  const lines = (node: ProfileNode) => {
    const count = graph.authored.get(node.digest) ?? 0
    const label = fit(profileLabel(node, play), labelChars)
    const sub = `${node.short.slice(0, 8)} · ${profileState(node).replaceAll('-', ' ')}`
    const toggle = count ? `${expanded.has(node.digest) ? '−' : '+'} ${count} authored` : null
    const width = Math.max(label.length * main, sub.length * small, (toggle?.length ?? 0) * small)
    return { label, sub, toggle, width }
  }
  const text = new Map([...depthOf.keys()].map((digest) => [digest, lines(graph.nodes.get(digest)!)]))
  const maxDepth = Math.max(0, ...depthOf.values())
  const columnWidth = new Map<number, number>()
  const versionInto = new Set<number>()
  for (const [digest, depth] of depthOf) {
    columnWidth.set(depth, Math.max(columnWidth.get(depth) ?? 0, text.get(digest)!.width))
    const edge = graph.parentOf.get(digest)
    if (edge && edge.relation !== 'authored') versionInto.add(depth)
  }
  const radius = (node: ProfileNode) => (node.kind === 'root' ? 9 : 6)
  const columnX = [20]
  for (let depth = 1; depth <= maxDepth; depth++)
    columnX[depth] = columnX[depth - 1]! + 9 + 8 + (columnWidth.get(depth - 1) ?? 0) + (versionInto.has(depth) ? 164 : 34)
  let y = 26
  const visit = (node: ProfileNode, depth: number): number => {
    const existing = placed.get(node.digest)
    if (existing) return existing.y
    const t = text.get(node.digest)!
    const entry: PlacedProfile = { node, x: columnX[depth]!, y: 0, depth, r: radius(node), ...t }
    placed.set(node.digest, entry)
    const kids = (graph.children.get(node.digest) ?? []).filter((child) => shown.has(child.digest))
    const rowHeight = node.kind === 'root' || t.toggle ? 54 : 34
    if (!kids.length) {
      entry.y = y
      y += rowHeight
    } else {
      const ys = kids.map((child) => visit(child, depth + 1))
      // A profile sits on the row of its next revision, so a lineage reads as one straight line with its branches
      // above it; without a revision it sits between its children.
      const main = kids.findIndex((child) => graph.parentOf.get(child.digest)?.relation === 'revision')
      entry.y = main >= 0 ? ys[main]! : (Math.min(...ys) + Math.max(...ys)) / 2
      // Its own label block must clear the next row.
      if (entry.y + rowHeight > y) y = entry.y + rowHeight
    }
    return entry.y
  }
  for (const head of graph.heads) if (shown.has(head.digest)) visit(head, 0)
  const right = Math.max(0, ...[...placed.values()].map((entry) => entry.x + entry.r + 8 + entry.width))
  return { placed, width: Math.ceil(right + 20), height: Math.max(80, y) }
}
