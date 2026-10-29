import type { VersionGraphDocument, VersionTag } from '../workspace-model.js'

/** The registered rule's pick is bookkeeping, not a pass: no check ran on it for this mark. */
export const PICKED = '★ picked by rule · not checked'

/**
 * One drawing for every versioned artifact: a run's deliverables and the profiles its agents wrote (`deliverables.git`),
 * and a play's registered versions with the profiles the selected version's agents wrote. Each page turns its document
 * into this model; `VersionGraph` draws it as lanes of commits, newest at the top, with merges and tags.
 */
export { layoutVersionGraph } from '@tangle-network/charts/react'
export type { VersionGraphModel as GraphModel, VersionGraphNode as GraphNode, VersionGraphChip as GraphChip, VersionGraphLane as GraphLane, VersionGraphTone as GraphTone } from '@tangle-network/charts/react'
import type { VersionGraphModel as GraphModel, VersionGraphChip as GraphChip } from '@tangle-network/charts/react'

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
  const from = pagesVersion(flag.from)
  return flag.kind === 'suspected-judge-gaming'
    ? `suspected judge-gaming vs ${from}`
    : flag.kind === 'regression'
      ? `regression vs ${from}: ${flag.checks.join(', ')}`
      : `${flag.kind} vs ${from}`
}

/**
 * A Knowledge-store version as the pages name it: `rc2` reads `pages v2`, so "rc" means only a code release candidate.
 * The raw tag goes in the tip.
 */
export const pagesVersion = (tag: string) => {
  const n = /^(?:.*\/)?rc(\d+)$/.exec(tag)?.[1]
  return n ? `pages v${n}` : `pages ${tag.split('/').pop() ?? tag}`
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
          { label: tag.best ? `${pagesVersion(tag.name)} ${PICKED}` : pagesVersion(tag.name), tone: tag.best ? 'neutral' : 'accent', title: `${tag.name} · ${scoreLine(tag)}` },
          { label: scoreLine(tag), tone: 'info' },
          ...tag.flags.map((flag) => ({ label: flagLabel(flag), tone: 'neutral' as const })),
        ]),
      ],
    })),
  }
}
