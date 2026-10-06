import type { PlayDocument, ProfileDiffField, ProfileGraphDocument, ProfileNode, RunSummary } from '../workspace.js'

/**
 * The play page's version graph, read for drawing: each run of the play is a version (its registered profile), compared
 * field by field with the version before it, and each version's runtime-authored profiles hang under it as a tree.
 *
 * The Lab records no parent edge between two registered profiles of a play, so these comparisons are made here, from
 * the profiles' own content, and are labelled as comparisons, never as recorded revisions.
 */

type Line = { op: ' ' | '+' | '-' | '@'; text: string }

/** Two profiles compared field by field: what the later one changed. */
export interface Comparison {
  from: ProfileNode
  to: ProfileNode
  identical: boolean
  fields: ProfileDiffField[]
}

/** Above this many cell pairs a line diff falls back to a multiset difference (order lost, counts exact). */
const LCS_CELLS = 4_000_000
/** Unchanged lines kept around each change. */
const CONTEXT = 1

/** A line diff of two texts: added, removed, and the changed lines with a little context. */
export function lineDiff(before: readonly string[], after: readonly string[]): { added: number; removed: number; lines: Line[] } {
  const n = before.length
  const m = after.length
  if (n * m > LCS_CELLS) {
    const left = new Map<string, number>()
    for (const line of before) left.set(line, (left.get(line) ?? 0) + 1)
    const lines: Line[] = []
    for (const line of after) {
      const count = left.get(line) ?? 0
      if (count) left.set(line, count - 1)
      else lines.push({ op: '+', text: line })
    }
    for (const [line, count] of left) for (let i = 0; i < count; i++) lines.push({ op: '-', text: line })
    return { added: lines.filter((l) => l.op === '+').length, removed: lines.filter((l) => l.op === '-').length, lines }
  }
  // Longest common subsequence, then a walk that emits removals before additions at each change.
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] = before[i] === after[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
  const ops: Line[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ op: ' ', text: before[i]! })
      i++
      j++
    } else if (i < n && (j >= m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      ops.push({ op: '-', text: before[i]! })
      i++
    } else {
      ops.push({ op: '+', text: after[j]! })
      j++
    }
  }
  const keep = ops.map((line, k) => line.op !== ' ' || ops.slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1).some((near) => near.op !== ' '))
  const lines: Line[] = []
  let skipped = 0
  ops.forEach((line, k) => {
    if (keep[k]) {
      if (skipped) lines.push({ op: '@', text: `${skipped} unchanged ${skipped === 1 ? 'line' : 'lines'}` })
      skipped = 0
      lines.push(line)
    } else skipped++
  })
  if (skipped && lines.length) lines.push({ op: '@', text: `${skipped} unchanged ${skipped === 1 ? 'line' : 'lines'}` })
  return { added: ops.filter((l) => l.op === '+').length, removed: ops.filter((l) => l.op === '-').length, lines }
}

const text = (value: unknown) => (value === null || value === undefined ? null : String(value))

/** Compare two profiles: values (model, harness), sets (tools, skills), texts (system prompt, instructions), files, budget. */
export function compareProfiles(from: ProfileNode, to: ProfileNode): Comparison {
  const fields: ProfileDiffField[] = []
  const value = (field: string, a: unknown, b: unknown) => {
    if (text(a) !== text(b)) fields.push({ field, kind: 'value', from: text(a), to: text(b) })
  }
  const set = (field: string, a: readonly string[], b: readonly string[]) => {
    const left = new Set(a)
    const right = new Set(b)
    const added = [...right].filter((item) => !left.has(item)).sort()
    const removed = [...left].filter((item) => !right.has(item)).sort()
    if (added.length || removed.length) fields.push({ field, kind: 'set', added, removed, kept: [...right].filter((item) => left.has(item)).length })
  }
  value('model', from.model.id, to.model.id)
  value('provider', from.model.provider, to.model.provider)
  value('reasoningEffort', from.model.reasoningEffort, to.model.reasoningEffort)
  value('harness', from.harness, to.harness)
  set('tools', from.tools, to.tools)
  set(
    'skills',
    from.skills.map((skill) => skill.name),
    to.skills.map((skill) => skill.name),
  )
  const instructions = lineDiff(from.instructions, to.instructions)
  if (instructions.added || instructions.removed) fields.push({ field: 'instructions', kind: 'text', ...instructions })
  const prompt = lineDiff((from.systemPrompt ?? '').split('\n'), (to.systemPrompt ?? '').split('\n'))
  if (prompt.added || prompt.removed) fields.push({ field: 'systemPrompt', kind: 'text', ...prompt })
  const before = new Map(from.files.map((file) => [file.path, file]))
  const after = new Map(to.files.map((file) => [file.path, file]))
  const added = [...after.values()].filter((file) => !before.has(file.path)).map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
  const removed = [...before.values()].filter((file) => !after.has(file.path)).map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
  const changed = [...after.values()]
    .filter((file) => before.has(file.path) && before.get(file.path)!.sha256 !== file.sha256)
    .map((file) => ({ path: file.path, from: before.get(file.path)!.sha256, to: file.sha256, added: 0, removed: 0, lines: [] }))
  if (added.length || removed.length || changed.length) fields.push({ field: 'files', kind: 'files', added, removed, changed })
  for (const key of [...new Set([...Object.keys(from.budget ?? {}), ...Object.keys(to.budget ?? {})])].sort())
    value(`budget.${key}`, from.budget?.[key], to.budget?.[key])
  return { from, to, identical: fields.length === 0, fields }
}

/** One line for a badge: what the later profile changed, counted by kind. */
export function changeSummary(comparison: Comparison | null): string {
  if (!comparison) return 'first version'
  if (comparison.identical) return 'same profile'
  const parts: string[] = []
  for (const field of comparison.fields) {
    const name = field.field === 'systemPrompt' ? 'prompt line' : field.field === 'instructions' ? 'instruction' : field.field.replace(/s$/, '')
    if (field.kind === 'text') {
      if (field.added) parts.push(`+${field.added} ${name}${field.added === 1 ? '' : 's'}`)
      if (field.removed) parts.push(`−${field.removed} ${name}${field.removed === 1 ? '' : 's'}`)
    } else if (field.kind === 'set') {
      if (field.added.length) parts.push(`+${field.added.length} ${name}${field.added.length === 1 ? '' : 's'}`)
      if (field.removed.length) parts.push(`−${field.removed.length} ${name}${field.removed.length === 1 ? '' : 's'}`)
    } else if (field.kind === 'files') {
      const count = field.added.length + field.removed.length + field.changed.length
      parts.push(`${count} file${count === 1 ? '' : 's'} changed`)
    } else parts.push(`${field.field.replace(/^budget\./, '')} changed`)
  }
  return parts.join(' · ')
}

export interface Judge {
  category: string
  score: number | null
  max: number
  calibrated: boolean
}

/** The readout judges of one run, as the profile that ran as its root records them. */
export function judgesOf(node: ProfileNode | null, runId: string): { judges: Judge[]; verdicts: { id: string; verdict: string }[] } | null {
  const run = node?.runs.find((entry) => entry.runId === runId)
  const score = run?.score
  if (!score || score.status !== 'known' || score.source !== 'readout') return null
  return { judges: score.judges as Judge[], verdicts: score.verdicts as { id: string; verdict: string }[] }
}

/** "6 calibrated judges, median 1 of 4": what a rubric says, never more. */
export function judgeSummary(judges: readonly Judge[] | null | undefined): string {
  if (!judges?.length) return 'no readout judges'
  const calibrated = judges.filter((judge) => judge.calibrated && judge.score !== null).map((judge) => judge.score!).sort((a, b) => a - b)
  if (!calibrated.length) return `${judges.length} advisory ${judges.length === 1 ? 'judge' : 'judges'}, none calibrated`
  const median = calibrated[Math.floor((calibrated.length - 1) / 2)]
  return `${calibrated.length} calibrated ${calibrated.length === 1 ? 'judge' : 'judges'}, median ${median} of ${judges[0]!.max}`
}

/** The card form: "median 1/4 · 6 calibrated". */
export function judgeShort(judges: readonly Judge[] | null | undefined): string {
  if (!judges?.length) return 'no readout judges'
  const calibrated = judges.filter((judge) => judge.calibrated && judge.score !== null).map((judge) => judge.score!).sort((a, b) => a - b)
  if (!calibrated.length) return `${judges.length} advisory, none calibrated`
  return `median ${calibrated[Math.floor((calibrated.length - 1) / 2)]}/${judges[0]!.max} · ${calibrated.length} calibrated`
}

export interface Version {
  run: RunSummary
  /** The registered profile the run's root ran. */
  root: ProfileNode | null
  /** The version before it with a profile, in start order, and how this one differs from it. */
  previous: Version | null
  comparison: Comparison | null
}

const startOf = (run: RunSummary) => Date.parse(run.startedAt ?? '') || 0

/** Every run of the play as a version, oldest first, each compared with the version before it that has a profile. */
export function versionsOf(play: PlayDocument, graph: ProfileGraphDocument | null): Version[] {
  const roots = new Map<string, ProfileNode>()
  for (const node of graph?.nodes ?? []) if (node.kind === 'root' && node.createdIn) roots.set(node.createdIn, node)
  const ordered = [...play.runs].sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id))
  const out: Version[] = []
  let last: Version | null = null
  for (const run of ordered) {
    const root = roots.get(run.id) ?? null
    const version: Version = { run, root, previous: root ? last : null, comparison: root && last?.root ? compareProfiles(last.root, root) : null }
    out.push(version)
    if (root) last = version
  }
  return out
}

export interface AuthoredEntry {
  node: ProfileNode
  depth: number
  parent: string | null
}

/** The profiles agents wrote at runtime in one run, as a tree under the run's registered profile, oldest first. */
export function authoredTree(graph: ProfileGraphDocument | null, runId: string): AuthoredEntry[] {
  const spawned = (graph?.nodes ?? []).filter((node) => node.kind === 'spawned' && node.createdIn === runId)
  const root = (graph?.nodes ?? []).find((node) => node.kind === 'root' && node.createdIn === runId)
  const author = (node: ProfileNode) => (node.author.kind === 'node' ? node.author.profileDigest : null)
  const byAuthor = new Map<string | null, ProfileNode[]>()
  const digests = new Set(spawned.map((node) => node.digest))
  for (const node of spawned) {
    const key = author(node) && (digests.has(author(node)!) || author(node) === root?.digest) ? author(node) : root?.digest ?? null
    byAuthor.set(key, [...(byAuthor.get(key) ?? []), node])
  }
  // Spawn order: creation time, then the agent id the run gave it (s0, s1, … s10), then the digest.
  const spawnId = (node: ProfileNode) => node.runs.find((entry) => entry.runId === runId)?.nodeIds[0] ?? ''
  for (const list of byAuthor.values())
    list.sort(
      (a, b) =>
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
        spawnId(a).localeCompare(spawnId(b), 'en', { numeric: true }) ||
        a.digest.localeCompare(b.digest),
    )
  const out: AuthoredEntry[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const node of byAuthor.get(parent) ?? []) {
      if (seen.has(node.digest)) continue
      seen.add(node.digest)
      out.push({ node, depth, parent })
      walk(node.digest, depth + 1)
    }
  }
  walk(root?.digest ?? null, 0)
  return out
}

/** The profile with the same name written in another run: what an authored profile is compared with. */
export function sameNamed(graph: ProfileGraphDocument | null, node: ProfileNode, runId: string | null): ProfileNode | null {
  if (!runId || !node.name) return null
  return (graph?.nodes ?? []).find((other) => other.kind === node.kind && other.createdIn === runId && other.name === node.name) ?? null
}
