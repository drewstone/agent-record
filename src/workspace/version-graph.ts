import type { VersionGraphDocument, VersionTag } from '../workspace.js'

/**
 * One drawing for every versioned artifact: a run's deliverables and the profiles its agents wrote (`deliverables.git`),
 * and a play's registered versions with the profiles the selected version's agents wrote. Each page turns its document
 * into this model; `VersionGraph` draws it as lanes of commits, newest at the top, with merges and tags.
 */
/** `muted` chips sit beside the title; any other tone gets the second line. */
export type GraphTone = 'ok' | 'fail' | 'warn' | 'run' | 'accent' | 'info' | 'muted'

export interface GraphChip {
  readonly label: string
  readonly tone?: GraphTone
  readonly title?: string
}

export interface GraphNode {
  readonly id: string
  /** Parents in the model; one that is not in it (or is hidden) is skipped, and a hidden one passes its own on. */
  readonly parents: readonly string[]
  readonly lane: string
  readonly at: string | null
  readonly title: string
  readonly detail?: string | null
  /** A style hook and a filter key: `write`, `integrate`, `profile`, `version`, `authored`, `ghost`. */
  readonly kind: string
  readonly chips?: readonly GraphChip[]
}

export interface GraphLane {
  readonly id: string
  readonly label: string
  readonly detail?: string | null
}

/** Nodes newest first, every child above its parents. */
export interface GraphModel {
  readonly lanes: readonly GraphLane[]
  readonly nodes: readonly GraphNode[]
}

export interface LaidRow {
  readonly node: GraphNode
  readonly row: number
  readonly column: number
}

export interface LaidEdge {
  readonly from: string
  readonly to: string
  readonly fromRow: number
  readonly fromColumn: number
  readonly toRow: number
  readonly toColumn: number
}

export interface LaidGraph {
  readonly rows: readonly LaidRow[]
  readonly edges: readonly LaidEdge[]
  /** The lanes that hold a shown node, in model order; a lane's column is its index here. */
  readonly lanes: readonly GraphLane[]
}

/**
 * Rows in model order, one column per lane that holds a shown node, and one edge from each shown node to each nearest
 * shown ancestor: a hidden node (an integration when integrations are hidden, a commit of a lane filtered out) passes
 * its parents on, so a lane's line stays connected.
 */
export function layoutVersionGraph(model: GraphModel, shown: (node: GraphNode) => boolean = () => true): LaidGraph {
  const byId = new Map(model.nodes.map((node) => [node.id, node]))
  const visible = model.nodes.filter(shown)
  const visibleIds = new Set(visible.map((node) => node.id))
  const lanes = model.lanes.filter((lane) => visible.some((node) => node.lane === lane.id))
  for (const node of visible) if (!lanes.some((lane) => lane.id === node.lane)) lanes.push({ id: node.lane, label: node.lane })
  const column = new Map(lanes.map((lane, i) => [lane.id, i]))
  const rowOf = new Map(visible.map((node, i) => [node.id, i]))
  const nearest = (id: string, seen: Set<string>): string[] => {
    if (seen.has(id)) return []
    seen.add(id)
    if (visibleIds.has(id)) return [id]
    const node = byId.get(id)
    return node ? node.parents.flatMap((parent) => nearest(parent, seen)) : []
  }
  const edges: LaidEdge[] = []
  for (const node of visible) {
    const seen = new Set<string>([node.id])
    const targets = [...new Set(node.parents.flatMap((parent) => nearest(parent, seen)))]
    for (const target of targets) {
      const toRow = rowOf.get(target)!
      if (toRow <= rowOf.get(node.id)!) continue
      edges.push({
        from: node.id,
        to: target,
        fromRow: rowOf.get(node.id)!,
        fromColumn: column.get(node.lane)!,
        toRow,
        toColumn: column.get(byId.get(target)!.lane)!,
      })
    }
  }
  return { rows: visible.map((node, i) => ({ node, row: i, column: column.get(node.lane)! })), edges, lanes }
}

// ------------------------------------------------------------------------------------------------- a run's versions

const percent = (pair: readonly [number, number]) => `${pair[0]}/${pair[1]}`

/** A tag's score in one line: checks passed per tier, open blockers, the judges' mean. */
export function scoreLine(tag: VersionTag): string {
  if (!tag.score) return 'not scored yet'
  const v = tag.score.vector
  const parts = [`exact ${percent(v.exact)}`, `held-out ${percent(v.heldOut)}`, `blockers ${v.blockers ?? 'unknown'}`, `judge ${v.judge === null ? 'none' : Math.round(v.judge * 10) / 10}`]
  return parts.join(' · ') + (tag.score.complete ? '' : ' (incomplete)')
}

export function flagLabel(flag: VersionTag['flags'][number]): string {
  return flag.kind === 'suspected-judge-gaming'
    ? `suspected judge-gaming vs ${flag.from}`
    : flag.kind === 'regression'
      ? `regression vs ${flag.from}: ${flag.checks.join(', ')}`
      : `${flag.kind} vs ${flag.from}`
}

const KIND_LABEL: Record<string, string> = { write: 'write', integrate: 'merge', profile: 'profile' }

/** The run's deliverables.git as the model: one lane per branch, `main` first; tags as chips on their commit. `when`
 * formats a commit's time. */
export function runGraphModel(doc: VersionGraphDocument, when: (iso: string) => string): GraphModel {
  const tagsOf = new Map<string, VersionTag[]>()
  for (const tag of doc.tags) tagsOf.set(tag.commit, [...(tagsOf.get(tag.commit) ?? []), tag])
  return {
    lanes: doc.lanes.map((lane) => ({ id: lane.id, label: lane.label, detail: `${lane.commits} commit${lane.commits === 1 ? '' : 's'}` })),
    nodes: doc.commits.map((commit) => ({
      id: commit.id,
      parents: commit.parents,
      lane: commit.lane,
      at: commit.at,
      title: commit.subject,
      detail: `${commit.author.label} · ${when(commit.at)}${commit.files.length > 1 ? ` · ${commit.files.length} files` : ''}`,
      kind: commit.kind,
      chips: [
        ...(commit.kind === 'write' ? [] : [{ label: KIND_LABEL[commit.kind] ?? commit.kind, tone: 'muted' as const }]),
        ...(tagsOf.get(commit.id) ?? []).flatMap((tag): GraphChip[] => [
          { label: tag.best ? `${tag.name} ★ deliverable` : tag.name, tone: tag.best ? 'ok' : 'accent', title: scoreLine(tag) },
          { label: scoreLine(tag), tone: 'info' },
          ...tag.flags.map((flag) => ({ label: flagLabel(flag), tone: flag.kind === 'regression' ? ('warn' as const) : ('fail' as const) })),
        ]),
      ],
    })),
  }
}
