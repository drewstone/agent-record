import type { ProfileEdgeEvent, ProfileGraphDocument, ProfileNode, ProfileParent } from '../workspace.js'

/**
 * The profile canvas of a run or a play, read for drawing. Its members are the profiles the scope ran or created (and
 * the versions proposed from its evidence); every version they derive from is drawn too, across plays, so each member
 * can be traced to where it first came from. A runtime-written profile the scope reused hangs under the agent that wrote
 * it in the scope; the agents of other runs that wrote the same profile are counted, not drawn.
 *
 * Self-contained (type-only imports) so the tests run it from source.
 */

export type CanvasScope =
  | { readonly kind: 'run'; readonly runId: string; readonly play: string | null }
  | { readonly kind: 'play'; readonly play: string; readonly runs: readonly string[] }

export interface CanvasEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly relation: ProfileParent['relation']
  readonly basis: ProfileParent['basis']
  /** The edge the child is laid out under; the others are drawn as secondary lines. */
  readonly home: boolean
  /** The run whose records made the edge: where the child was spawned or restarted, registered, searched or proposed. */
  readonly origin: string | null
  /** How the origin run made it, for the label: `proposed`, `registered`, `version`, `optimizer`, `spawned`, `replaced`. */
  readonly originKind: string | null
  readonly crossPlay: boolean
}

export interface CanvasCluster {
  readonly parent: string
  /** The collapsed profiles, the subtrees under them included. */
  readonly members: readonly ProfileNode[]
  /** Distinct role names, most frequent first. */
  readonly names: readonly string[]
}

export interface CanvasNode {
  /** The profile digest, or `cluster:<parent digest>`. */
  readonly id: string
  readonly node: ProfileNode | null
  readonly cluster: CanvasCluster | null
  readonly play: string | null
  /** Ran or was created in the scope; otherwise drawn as an ancestor. */
  readonly inScope: boolean
  /** From a play other than the scope's. */
  readonly foreign: boolean
  readonly depth: number
  readonly x: number
  readonly y: number
  /** The drawn parent this node is laid out under. */
  readonly parent: string | null
  readonly children: readonly string[]
  /** Runs outside the scope that ran this exact profile, and their plays. */
  readonly elsewhere: { readonly runs: readonly string[]; readonly plays: readonly string[] }
}

export interface CanvasModel {
  readonly nodes: readonly CanvasNode[]
  readonly byId: ReadonlyMap<string, CanvasNode>
  readonly edges: readonly CanvasEdge[]
  readonly width: number
  readonly height: number
  /** Where the canvas opens: the run's registered profile, or the play's newest. */
  readonly focus: string | null
  /** Plays other than the scope's that drawn profiles came from. */
  readonly foreignPlays: readonly string[]
  readonly counts: { readonly inScope: number; readonly ancestors: number; readonly clustered: number }
}

export const NODE_W = 264
export const NODE_H = 96
export const COL_W = NODE_W + 96
export const ROW_H = NODE_H + 22
/** A profile with more runtime-written children than this shows them as one expandable cluster. */
export const CLUSTER_MIN = 10

const WITHIN_RUN = new Set(['authored', 'replaced'])
/** The Lab's own order for a node's parent: a treatment's control, a revision, a restarted worker, then an author. */
const RELATION_ORDER: Record<string, number> = { treatment: 0, revision: 1, replaced: 2, authored: 3 }

export const eventsOf = (edge: ProfileParent): readonly ProfileEdgeEvent[] => (Array.isArray(edge.events) ? edge.events : [])

/** Each run's play, from the registered profiles that ran in it; a run no profile places is matched to the longest
 * known play its id starts with. */
export function runPlays(doc: ProfileGraphDocument): (runId: string | null | undefined) => string | null {
  const known = new Map<string, string>()
  for (const node of doc.nodes) {
    if (node.kind !== 'root' || !node.play) continue
    if (node.createdIn) known.set(node.createdIn, node.play)
    for (const run of node.runs) if (!known.has(run.runId)) known.set(run.runId, node.play)
  }
  const plays = [...new Set([...known.values(), doc.play])].sort((a, b) => b.length - a.length)
  return (runId) => {
    if (!runId) return null
    const hit = known.get(runId)
    if (hit) return hit
    return plays.find((play) => runId.startsWith(`${play}-`)) ?? null
  }
}

/** The run that made an edge, preferring the run that proposed a version over one that only registered it. */
export function edgeOrigin(edge: ProfileParent, child: ProfileNode): { run: string | null; kind: string | null } {
  const events = eventsOf(edge)
  const proposed = events.find((event) => event.kind === 'proposed' && event.runId)
  const any = proposed ?? events.find((event) => event.runId)
  if (any) return { run: any.runId ?? null, kind: any.kind }
  if (child.author.kind === 'readout') return { run: child.author.runId, kind: 'proposed' }
  if (child.author.kind === 'node' && WITHIN_RUN.has(edge.relation)) return { run: child.author.runId, kind: edge.relation === 'replaced' ? 'replaced' : 'spawned' }
  return { run: child.createdIn, kind: child.createdIn ? 'created' : null }
}

/** What the agents running this profile in one run cost, from the Runtime settlements on its spawn edges. Null when no
 * spawn of it in that run is recorded (a registered profile: the run's own spend covers it). */
export function profileRunCost(node: ProfileNode, runId: string): { usd: number; agents: number; unmetered: number } | null {
  const seen = new Map<string, ProfileEdgeEvent>()
  for (const edge of node.parents)
    for (const event of eventsOf(edge))
      if (event.runId === runId && (event.kind === 'spawned' || event.kind === 'replaced') && event.nodeId && !seen.has(event.nodeId)) seen.set(event.nodeId, event)
  if (!seen.size) return null
  let usd = 0
  let unmetered = 0
  for (const event of seen.values()) {
    const outcome = event.outcome
    if (outcome && outcome.metered !== false && typeof outcome.usd === 'number') usd += outcome.usd
    else unmetered++
  }
  return { usd, agents: seen.size, unmetered }
}

const by = (a: ProfileNode, b: ProfileNode) =>
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
  String(a.createdIn ?? '').localeCompare(String(b.createdIn ?? '')) ||
  String(a.name ?? a.label ?? '').localeCompare(String(b.name ?? b.label ?? '')) ||
  a.digest.localeCompare(b.digest)

export function canvasModel(doc: ProfileGraphDocument, scope: CanvasScope, expanded: ReadonlySet<string> = new Set(), reveal: string | null = null): CanvasModel {
  const all = new Map(doc.nodes.map((node) => [node.digest, node]))
  const playOf = runPlays(doc)
  const scopeRuns = new Set(scope.kind === 'run' ? [scope.runId] : scope.runs)
  const scopePlay = scope.kind === 'run' ? (scope.play ?? playOf(scope.runId)) : scope.play
  const nodePlay = (node: ProfileNode) => node.play ?? playOf(node.createdIn)
  const inScope = (node: ProfileNode) =>
    (node.createdIn !== null && scopeRuns.has(node.createdIn)) ||
    node.runs.some((run) => scopeRuns.has(run.runId)) ||
    (node.author.kind === 'readout' && scopeRuns.has(node.author.runId)) ||
    node.parents.some((edge) => eventsOf(edge).some((event) => event.kind === 'proposed' && !!event.runId && scopeRuns.has(event.runId))) ||
    (scope.kind === 'play' && node.play === scope.play)
  // A within-run edge belongs to the scope when a spawn in the scope made it; one without events, when it is primary.
  const edgeInScope = (edge: ProfileParent) => {
    const events = eventsOf(edge)
    return events.length ? events.some((event) => !!event.runId && scopeRuns.has(event.runId)) : edge.primary
  }
  // The edge that made a profile where it was created: the agent that first wrote it, in whichever play.
  const madeAt = (node: ProfileNode, edge: ProfileParent) => !!node.createdIn && eventsOf(edge).some((event) => event.runId === node.createdIn)
  const members = new Set<string>()
  for (const node of doc.nodes) if (inScope(node)) members.add(node.digest)

  // Members, then every version they derive from: across-run parents always; a within-run parent when it first wrote the
  // profile, when the scope made the edge, or (for an ancestor without spawn records) when it is the primary parent.
  const follows = (node: ProfileNode, edge: ProfileParent) =>
    !WITHIN_RUN.has(edge.relation) || madeAt(node, edge) || (members.has(node.digest) ? edgeInScope(edge) : edge.primary && !eventsOf(edge).length)
  const kept = new Set<string>()
  const queue = [...members]
  while (queue.length) {
    const digest = queue.pop()!
    if (kept.has(digest)) continue
    kept.add(digest)
    const node = all.get(digest)!
    for (const edge of node.parents) {
      if (!all.has(edge.digest) || edge.digest === digest) continue
      if (follows(node, edge)) queue.push(edge.digest)
    }
  }

  // Each node's home edge: a member hangs under what made it in the scope (the Lab's primary parent first), so a reused
  // profile sits under the agent of this run that spawned it and its first author is a secondary line; an ancestor hangs
  // under its primary parent; otherwise the first drawn parent in the Lab's order.
  const drawnEdge = (node: ProfileNode, edge: ProfileParent) =>
    kept.has(edge.digest) && edge.digest !== node.digest && (follows(node, edge) || (members.has(node.digest) && members.has(edge.digest)))
  const inOrder = (edges: ProfileParent[]) => [...edges].sort((a, b) => Number(b.primary) - Number(a.primary) || RELATION_ORDER[a.relation]! - RELATION_ORDER[b.relation]!)
  const homeOf = new Map<string, ProfileParent>()
  for (const digest of kept) {
    const node = all.get(digest)!
    const candidates = inOrder(node.parents.filter((edge) => drawnEdge(node, edge)))
    const scoped = members.has(digest) ? candidates.find((edge) => !WITHIN_RUN.has(edge.relation) || edgeInScope(edge)) : undefined
    const home = scoped ?? candidates[0]
    if (home) homeOf.set(digest, home)
  }
  // Bad data can make a home cycle; break it where it is first met again, so every member stays drawn.
  for (const digest of kept) {
    const seen = new Set<string>()
    let at: string | undefined = digest
    while (at && homeOf.has(at)) {
      if (seen.has(at)) {
        homeOf.delete(at)
        break
      }
      seen.add(at)
      at = homeOf.get(at)!.digest
    }
  }

  const kids = new Map<string, ProfileNode[]>()
  const heads: ProfileNode[] = []
  for (const digest of kept) {
    const node = all.get(digest)!
    const home = homeOf.get(digest)
    if (home) kids.set(home.digest, [...(kids.get(home.digest) ?? []), node])
    else heads.push(node)
  }
  const rank = (node: ProfileNode) => RELATION_ORDER[homeOf.get(node.digest)?.relation ?? 'revision']!
  for (const list of kids.values()) list.sort((a, b) => rank(a) - rank(b) || by(a, b))
  // Lineage origins first (oldest first), then the scope's own heads.
  heads.sort((a, b) => Number(members.has(a.digest)) - Number(members.has(b.digest)) || by(a, b))

  // The revealed node's home ancestors stay expanded, so a selection is never hidden in a cluster.
  const open = new Set(expanded)
  for (let at = reveal ? homeOf.get(reveal) : undefined, guard = 0; at && guard < 10_000; at = homeOf.get(at.digest), guard++) open.add(at.digest)
  const subtree = (digest: string): ProfileNode[] => (kids.get(digest) ?? []).flatMap((child) => [child, ...subtree(child.digest)])

  // Tidy layout, left to right: depth is the column; a leaf takes the next row, a parent centres on its children.
  const placed = new Map<string, CanvasNode>()
  const order: string[] = []
  let row = 0
  let clustered = 0
  const elsewhereOf = (node: ProfileNode) => {
    const runs = node.runs.map((run) => run.runId).filter((runId) => !scopeRuns.has(runId))
    // Authors in other runs that wrote this same profile count as places it was used.
    for (const edge of node.parents)
      if (WITHIN_RUN.has(edge.relation)) for (const event of eventsOf(edge)) if (event.runId && !scopeRuns.has(event.runId) && !runs.includes(event.runId)) runs.push(event.runId)
    const plays = [...new Set(runs.map((runId) => playOf(runId)).filter((play): play is string => !!play && play !== scopePlay))].sort()
    return { runs, plays }
  }
  const place = (id: string, entry: Omit<CanvasNode, 'x' | 'y' | 'id'>, y: number) => {
    const node: CanvasNode = { id, ...entry, x: entry.depth * COL_W, y }
    placed.set(id, node)
    order.push(id)
    return node
  }
  const visit = (node: ProfileNode, depth: number, parent: string | null): number => {
    const children = kids.get(node.digest) ?? []
    const authored = children.filter((child) => homeOf.get(child.digest)?.relation === 'authored')
    const collapse = authored.length > CLUSTER_MIN && !open.has(node.digest)
    const shown = collapse ? children.filter((child) => homeOf.get(child.digest)?.relation !== 'authored') : children
    const childIds: string[] = []
    const ys: number[] = []
    for (const child of shown) {
      ys.push(visit(child, depth + 1, node.digest))
      childIds.push(child.digest)
    }
    if (collapse) {
      const hidden = authored.flatMap((child) => [child, ...subtree(child.digest)])
      clustered += hidden.length
      const counts = new Map<string, number>()
      for (const item of hidden) {
        const name = item.name ?? item.label ?? item.short
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      const id = `cluster:${node.digest}`
      const y = row++ * ROW_H
      place(id, {
        node: null,
        cluster: { parent: node.digest, members: hidden, names: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name) },
        play: nodePlay(node),
        inScope: hidden.some((item) => members.has(item.digest)),
        foreign: false,
        depth: depth + 1,
        parent: node.digest,
        children: [],
        elsewhere: { runs: [], plays: [] },
      }, y)
      ys.push(y)
      childIds.push(id)
    }
    const y = ys.length ? (ys[0]! + ys.at(-1)!) / 2 : row++ * ROW_H
    const play = nodePlay(node)
    place(node.digest, {
      node,
      cluster: null,
      play,
      inScope: members.has(node.digest),
      foreign: !!play && !!scopePlay && play !== scopePlay,
      depth,
      parent,
      children: childIds,
      elsewhere: elsewhereOf(node),
    }, y)
    return y
  }
  for (const head of heads) visit(head, 0, null)

  const nodes = order.map((id) => placed.get(id)!).sort((a, b) => a.depth - b.depth || a.y - b.y)
  const shownIds = new Set(placed.keys())
  // Every parent edge between two drawn profiles; an edge into a collapsed profile is drawn to its cluster once.
  const homeAncestors = (digest: string) => {
    const seen = new Set<string>()
    for (let at = homeOf.get(digest); at && !seen.has(at.digest); at = homeOf.get(at.digest)) seen.add(at.digest)
    return seen
  }
  const edges: CanvasEdge[] = []
  const seenEdges = new Set<string>()
  const clusterOf = new Map<string, string>()
  for (const node of nodes) if (node.cluster) for (const item of node.cluster.members) clusterOf.set(item.digest, node.id)
  for (const digest of kept) {
    const child = all.get(digest)!
    for (const edge of child.parents) {
      if (!drawnEdge(child, edge)) continue
      const from = shownIds.has(edge.digest) ? edge.digest : clusterOf.get(edge.digest)
      const to = shownIds.has(digest) ? digest : clusterOf.get(digest)
      if (!from || !to || from === to) continue
      const home = homeOf.get(digest) === edge
      // A runtime author already on the child's home path (the director of a restarted worker) adds only noise.
      if (!home && edge.relation === 'authored' && homeAncestors(digest).has(edge.digest)) continue
      const id = `${from}->${to}`
      if (seenEdges.has(id)) continue
      if (!home && clusterOf.has(digest) && clusterOf.has(edge.digest)) continue
      seenEdges.add(id)
      const origin = edgeOrigin(edge, child)
      const fromPlay = placed.get(from)?.play ?? null
      const toPlay = placed.get(to)?.play ?? null
      edges.push({
        id,
        from,
        to,
        relation: edge.relation,
        basis: edge.basis,
        home: home || (to.startsWith('cluster:') && from === to.slice(8)),
        origin: origin.run,
        originKind: origin.kind,
        crossPlay: !!fromPlay && !!toPlay && fromPlay !== toPlay,
      })
    }
  }

  const focusRoot =
    scope.kind === 'run'
      ? doc.nodes.find((node) => node.kind === 'root' && node.createdIn === scope.runId && shownIds.has(node.digest)) ??
        doc.nodes.find((node) => node.kind === 'root' && node.runs.some((run) => run.runId === scope.runId) && shownIds.has(node.digest))
      : [...doc.nodes].filter((node) => node.kind === 'root' && members.has(node.digest) && shownIds.has(node.digest)).sort(by).at(-1)
  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0)
  const foreignPlays = [...new Set(nodes.filter((node) => node.foreign && node.play).map((node) => node.play!))].sort()
  return {
    nodes,
    byId: placed,
    edges,
    width: maxDepth * COL_W + NODE_W,
    height: Math.max(0, row - 1) * ROW_H + NODE_H,
    focus: focusRoot?.digest ?? nodes.find((node) => node.inScope)?.id ?? nodes[0]?.id ?? null,
    foreignPlays,
    counts: { inScope: members.size, ancestors: [...kept].filter((digest) => !members.has(digest)).length, clustered },
  }
}

/** The drawn ids lit by one node: its ancestors through every drawn edge, and its descendants through the layout. */
export function lineageOf(model: CanvasModel, id: string): Set<string> {
  const up = new Map<string, string[]>()
  for (const edge of model.edges) up.set(edge.to, [...(up.get(edge.to) ?? []), edge.from])
  const lit = new Set<string>([id])
  const climb = [id]
  while (climb.length) for (const parent of up.get(climb.pop()!) ?? []) if (!lit.has(parent)) lit.add(parent), climb.push(parent)
  const descend = [id]
  while (descend.length) for (const child of model.byId.get(descend.pop()!)?.children ?? []) if (!lit.has(child)) lit.add(child), descend.push(child)
  return lit
}

/** The home chain from a node back to its first version, child first, with the edge each step came by. */
export function originChain(model: CanvasModel, id: string): { node: CanvasNode; edge: CanvasEdge | null }[] {
  const chain: { node: CanvasNode; edge: CanvasEdge | null }[] = []
  const seen = new Set<string>()
  for (let at = model.byId.get(id); at && !seen.has(at.id); at = at.parent ? model.byId.get(at.parent) : undefined) {
    seen.add(at.id)
    const edge = at.parent ? (model.edges.find((item) => item.from === at!.parent && item.to === at!.id) ?? null) : null
    chain.push({ node: at, edge })
  }
  return chain
}

/** Keyboard moves on the canvas: left to the parent, right to the first child, up and down within the column. */
export function neighbour(model: CanvasModel, id: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): string | null {
  const at = model.byId.get(id)
  if (!at) return model.focus
  if (key === 'ArrowLeft') return at.parent
  if (key === 'ArrowRight') {
    if (!at.children.length) return null
    return [...at.children].sort((a, b) => Math.abs(model.byId.get(a)!.y - at.y) - Math.abs(model.byId.get(b)!.y - at.y))[0] ?? null
  }
  const column = model.nodes.filter((node) => node.depth === at.depth)
  const i = column.findIndex((node) => node.id === id)
  return (key === 'ArrowUp' ? column[i - 1] : column[i + 1])?.id ?? null
}

/** How an edge's origin run made it, as a verb before the run: `proposed from`, `registered in`. */
export function originVerb(edge: CanvasEdge): string {
  switch (edge.originKind) {
    case 'proposed':
      return 'proposed from'
    case 'registered':
      return 'registered in'
    case 'optimizer':
      return 'optimizer in'
    case 'version':
      return 'version chain in'
    case 'spawned':
      return 'spawned in'
    case 'replaced':
      return 'restarted in'
    case 'annotated':
      return 'annotated for'
    default:
      return 'in'
  }
}

/** How an edge's origin reads: `proposed from 20261006d`, `registered in …`. */
export function originText(edge: CanvasEdge, shortRun: (runId: string) => string): string | null {
  return edge.origin ? `${originVerb(edge)} ${shortRun(edge.origin)}` : null
}
