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
