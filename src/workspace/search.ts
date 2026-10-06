import type { ProfileGraphDocument, ProfileNode, ProfileSearch } from '../workspace.js'

/**
 * An optimizer search over a play's profile, read for the evolution view: every version it proposed, the edge to its
 * parent with the optimizer's quoted reason, the paired effect on the parent with its interval, what the proposal and
 * its evaluation cost, the decision, and the search's best-version-per-dollar curve and claim.
 *
 * Everything here is recorded by the search ledger (discovery-lab `disco profiles index`); nothing is inferred. Types
 * only, so the node tests load this file directly.
 */

export interface Effect {
  split: string
  pairs: number
  delta: number
  low: number | null
  high: number | null
  confidence: number | null
  method: string | null
  sufficient: boolean | null
}

export interface SplitScore {
  mean: number
  units: number
}

export interface SearchVersion {
  digest: string
  short: string
  label: string
  operator: string | null
  /** When the search registered it; the replay's clock. */
  at: string | null
  parent: string | null
  depth: number
  root: boolean
  /** The optimizer's words for why it made this version. */
  reason: string | null
  /** The paired effect on its parent the search measured. */
  effect: Effect | null
  proposalUsd: number | null
  evaluationUsd: number | null
  scores: { train: SplitScore | null; selection: SplitScore | null; test: SplitScore | null }
  /** The last decision: selected, finalist, rejected, invalid, or pending when none was made. */
  status: string
  statusReason: string | null
  /** The decision's comparison with the root, when it made one. */
  vsRoot: { split: string; pairs: number; delta: number; low: number | null; high: number | null; method: string | null } | null
}

export interface SearchModel {
  searchId: string
  kind: string | null
  runId: string | null
  ranking: string | null
  policy: Record<string, unknown> | null
  openedAt: string | null
  closedAt: string | null
  closeReason: string | null
  claim: ProfileSearch['claim'] | null
  curve: { at: string; usd: number; versions: number; score: number | null; digest: string | null; unknownCost: number }[]
  versions: SearchVersion[]
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/** The optimizer event on a version's parent edge (`parents[].events[]` with kind `optimizer`) for this search. */
function optimizerEvent(node: ProfileNode, searchId: string) {
  for (const parent of node.parents) {
    const listed = (parent as Record<string, unknown>).events
    const events = Array.isArray(listed) ? listed : []
    for (const event of events) {
      const value = record(event)
      if (value && value.kind === 'optimizer' && (value.searchId === searchId || value.searchId === undefined)) return { parent: parent.digest, event: value }
    }
  }
  return node.parents[0] ? { parent: node.parents[0].digest, event: null } : null
}

function split(value: unknown): SplitScore | null {
  const item = record(value)
  const mean = num(item?.mean)
  const units = num(item?.units)
  return mean !== null && units !== null ? { mean, units } : null
}

/** Every search the play's profile index records (for one run when `runId` is given), oldest first. */
export function searchesOf(graph: ProfileGraphDocument | null | undefined, runId?: string | null): SearchModel[] {
  if (!graph?.searches?.length) return []
  return graph.searches
    .filter((search) => !runId || search.runId === runId)
    .map((search) => {
      const nodes = graph.nodes.filter((node) => (node.searches ?? []).some((entry) => entry.searchId === search.searchId))
      const byDigest = new Map(nodes.map((node) => [node.digest, node]))
      const depthOf = (node: ProfileNode, seen = new Set<string>()): number => {
        const parent = optimizerEvent(node, search.searchId)?.parent
        if (!parent || !byDigest.has(parent) || seen.has(node.digest)) return 0
        seen.add(node.digest)
        return 1 + depthOf(byDigest.get(parent)!, seen)
      }
      const versions = nodes.map((node): SearchVersion => {
        const entry = (node.searches ?? []).find((item) => item.searchId === search.searchId)!
        const edge = optimizerEvent(node, search.searchId)
        const event = edge?.event ?? null
        const effect = record(event?.effect)
        const cost = record(event?.cost)
        const reason = record(event?.reason)
        const decisions = entry.decisions ?? []
        const last = decisions.at(-1) ?? null
        const basis = [...decisions].reverse().find((decision) => decision.basis)?.basis ?? null
        const parent = edge && byDigest.has(edge.parent) ? edge.parent : null
        return {
          digest: node.digest,
          short: node.short,
          label: str(event?.label) ?? node.label ?? node.name ?? node.short,
          operator: str(event?.operator),
          at: entry.registeredAt ?? node.createdAt ?? null,
          parent,
          depth: depthOf(node),
          root: parent === null,
          reason: str(reason?.quote),
          effect:
            effect && effect.status === 'known' && num(effect.delta) !== null && num(effect.pairs) !== null
              ? {
                  split: str(effect.split) ?? 'selection',
                  pairs: num(effect.pairs)!,
                  delta: num(effect.delta)!,
                  low: num(effect.low),
                  high: num(effect.high),
                  confidence: num(effect.confidence),
                  method: str(effect.method),
                  sufficient: typeof effect.sufficient === 'boolean' ? effect.sufficient : null,
                }
              : null,
          proposalUsd: num(cost?.proposalUsd),
          evaluationUsd: num(entry.cost?.usd),
          scores: { train: split(entry.scores?.train), selection: split(entry.scores?.selection), test: split(entry.scores?.test) },
          status: last?.status ?? 'pending',
          statusReason: last?.reason ?? null,
          vsRoot: basis
            ? { split: basis.split, pairs: basis.pairs, delta: basis.delta, low: basis.interval?.[0] ?? null, high: basis.interval?.[1] ?? null, method: basis.method ?? null }
            : null,
        }
      })
      return {
        searchId: search.searchId,
        kind: search.kind ?? null,
        runId: search.runId ?? null,
        ranking: search.ranking ?? null,
        policy: (search.policy as Record<string, unknown> | null | undefined) ?? null,
        openedAt: search.openedAt ?? null,
        closedAt: search.closedAt ?? null,
        closeReason: search.closeReason ?? null,
        claim: search.claim ?? null,
        curve: (search.curve ?? []).map((point) => ({
          at: point.at,
          usd: point.usd,
          versions: point.versions,
          score: point.best?.score ?? null,
          digest: point.best?.digest ?? null,
          unknownCost: point.unknownCost ?? 0,
        })),
        versions: treeOrder(versions),
      }
    })
}

/** Versions in tree order: each version's children after it, oldest first, so a row's parent is above it. */
export function treeOrder(versions: readonly SearchVersion[]): SearchVersion[] {
  const children = new Map<string | null, SearchVersion[]>()
  for (const version of versions) children.set(version.parent, [...(children.get(version.parent) ?? []), version])
  const out: SearchVersion[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const version of [...(children.get(parent) ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
      if (seen.has(version.digest)) continue
      seen.add(version.digest)
      out.push(version)
      walk(version.digest)
    }
  }
  walk(null)
  for (const version of versions) if (!seen.has(version.digest)) out.push(version)
  return out
}

/** The versions the search had registered by `at` (all when `at` is null), and the curve up to then. */
export function replayAt(model: SearchModel, at: number | null) {
  if (at === null) return { versions: model.versions, curve: model.curve }
  const before = (value: string | null) => value !== null && Date.parse(value) <= at
  return { versions: model.versions.filter((version) => before(version.at)), curve: model.curve.filter((point) => before(point.at)) }
}

/** Each line of a version's prompt with the version that introduced it, named by its label. */
export function blameOf(graph: ProfileGraphDocument | null | undefined, model: SearchModel, digest: string) {
  const blame = graph?.blame?.[digest]
  if (!blame) return null
  const labels = new Map(model.versions.map((version) => [version.digest, version.label]))
  const shorts = new Map((graph?.nodes ?? []).map((node) => [node.digest, node.short]))
  return {
    complete: blame.complete ?? null,
    rows: blame.rows.map((row) => ({
      field: row.field,
      text: row.text,
      introducedBy: row.introducedBy,
      label: row.introducedBy ? (labels.get(row.introducedBy) ?? shorts.get(row.introducedBy) ?? row.introducedBy.slice(7, 19)) : 'unknown',
      own: row.introducedBy === digest,
    })),
  }
}

/** `+0.118 [+0.032, +0.229]`; signs always shown. */
export const signed = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`
