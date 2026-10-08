import type { FindingItem, Findings, Publication, ScientificReview } from '../workspace.js'

/**
 * A run's provenance as one topology, in three bands left to right:
 *   run          the agents (by spawn), the pages they wrote, and the precise claims on those pages;
 *   review       the reviewers outside the run (a review lane, a judge model), each joined to the exact claims it
 *                judged by a verdict edge (NEW, KNOWN, REPRODUCTION, WRONG, UNVERIFIABLE);
 *   publication  what cites the claims and verdicts: proof packets, site entries, public repositories.
 * Joins use recorded identifiers only: a review names its page by SHA-256 and its claim by id; a publication names the
 * pages (and optionally the claims and reviewers) it cites. Nothing is matched by title or text.
 *
 * Self-contained (type-only imports) so the tests run it from source.
 */

export type ProvenanceBand = 'run' | 'review' | 'publication'
export type ProvenanceKind = 'agent' | 'page' | 'claim' | 'gap' | 'reviewer' | 'publication'

export interface ProvenanceNode {
  readonly id: string
  readonly kind: ProvenanceKind
  readonly band: ProvenanceBand
  readonly column: number
  readonly x: number
  readonly y: number
  readonly title: string
  readonly sub: string
  /** The verdicts on a claim disagree (two reviewers gave different labels). */
  readonly disagree?: boolean
  readonly page?: FindingItem
  readonly claim?: ProvenanceClaim
  readonly reviewer?: ProvenanceReviewer
  readonly publication?: Publication
  readonly agent?: { readonly id: string; readonly label: string; readonly parent: string | null }
  /** The declared results and claims no outside review names yet, folded into one node. */
  readonly gap?: readonly FindingItem[]
}

export interface ProvenanceClaim {
  readonly key: string
  readonly pageSha256: string
  readonly claimId: string
  readonly text: string
  readonly reviews: readonly ScientificReview[]
}

export interface ProvenanceReviewer {
  readonly key: string
  readonly label: string
  readonly kind: string | null
  readonly harness: string | null
  readonly model: string | null
  readonly provider: string | null
  readonly reviews: readonly ScientificReview[]
}

export type ProvenanceEdgeKind = 'spawned' | 'wrote' | 'states' | 'verdict' | 'cites'

export interface ProvenanceEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly kind: ProvenanceEdgeKind
  /** A verdict edge's label. */
  readonly label?: string
  /** The review layer is outside the run: these edges cross its boundary. */
  readonly crossesBoundary: boolean
}

export interface ProvenanceModel {
  readonly nodes: readonly ProvenanceNode[]
  readonly byId: ReadonlyMap<string, ProvenanceNode>
  readonly edges: readonly ProvenanceEdge[]
  /** Each band's horizontal extent, for its backdrop. */
  readonly bands: readonly { readonly band: ProvenanceBand; readonly x: number; readonly w: number }[]
  readonly width: number
  readonly height: number
  readonly focus: string | null
  /** Citations that name a claim or reviewer the reviews do not record. */
  readonly unresolved: readonly string[]
  readonly counts: {
    readonly claims: number
    readonly reviewed: number
    readonly disagreements: number
    readonly reviewers: number
    readonly publications: number
    readonly labels: Readonly<Record<string, number>>
  }
}

export const P_NODE_W = 264
export const P_NODE_H = 96
const COL_GAP = 120
const BAND_GAP = 120
const ROW_GAP = 18
const COLUMNS: readonly { kind: ProvenanceKind; band: ProvenanceBand }[] = [
  { kind: 'agent', band: 'run' },
  { kind: 'page', band: 'run' },
  { kind: 'claim', band: 'run' },
  { kind: 'reviewer', band: 'review' },
  { kind: 'publication', band: 'publication' },
]
/** What the run itself declared as findings: drawn as one gap node when no review or citation names them. */
const DECLARED = new Set(['result', 'claim'])

export const VERDICTS = ['NEW', 'REPRODUCTION', 'KNOWN', 'UNVERIFIABLE', 'WRONG'] as const
export const verdictTone = (label: string | null | undefined) =>
  label === 'NEW' ? 'ok' : label === 'WRONG' ? 'fail' : label === 'UNVERIFIABLE' ? 'warn' : label ? 'neutral' : 'none'

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Who reviewed, by the identity the row records. A row without one is its own unattributed reviewer: two unknown
 * reviewers are never merged into one, and no identity is made up from model or harness names. */
export function reviewerOf(review: ScientificReview, fallback = 'unattributed'): Omit<ProvenanceReviewer, 'reviews'> {
  const reviewer = (review.reviewer ?? null) as Record<string, unknown> | null
  const source = review.source && typeof review.source === 'object' ? (review.source as Record<string, unknown>) : null
  const harness = text(reviewer?.harness)
  const model = text(reviewer?.model) ?? text(reviewer?.servedModel)
  const provider = text(reviewer?.provider)
  const kind = text(reviewer?.kind) ?? (source?.kind === 'automatic' ? 'automatic' : text(source?.kind))
  const recorded = text(reviewer?.identity)
  const identity = recorded ?? fallback
  const lane = text(reviewer?.lane)
  const label =
    kind === 'review-lane' && lane
      ? `review lane · ${lane}`
      : model
        ? `${kind === 'automatic' ? 'automatic review' : 'judge'} · ${model}`
        : recorded ?? 'reviewer not recorded'
  return { key: identity, label, kind, harness, model, provider }
}

export function provenanceModel(findings: Findings, runId: string): ProvenanceModel {
  const items = findings.items
  const publications: readonly Publication[] = findings.publications ?? []
  const pages = new Map(items.map((item) => [item.sha256, item]))

  // Claims: every precise claim a review names, grouped by page and claim id; reviewers by identity.
  const claims = new Map<string, { pageSha256: string; claimId: string; text: string; reviews: ScientificReview[] }>()
  const reviewers = new Map<string, Omit<ProvenanceReviewer, 'reviews'> & { reviews: ScientificReview[] }>()
  const verdicts: { claim: string; reviewer: string; review: ScientificReview }[] = []
  // A review names its page by digest; one with an empty digest is the page it is attached to. Per claim and reviewer
  // the current verdict is the latest decided review (else the latest), so a stale row never hides a decision.
  const current = new Map<string, { review: ScientificReview; pageSha256: string; reviewer: string }>()
  let unattributed = 0
  const rank = (review: ScientificReview) => `${review.status === 'decided' ? 1 : 0}|${String((review as { at?: unknown }).at ?? '')}`
  for (const item of items)
    for (const review of item.reviews ?? []) {
      const pageSha256 = /^[0-9a-f]{64}$/.test(review.subject.pageSha256) ? review.subject.pageSha256 : item.sha256
      const recorded = text(review.reviewer?.identity)
      const reviewer = recorded ?? `unattributed:${++unattributed}`
      const slot = `${pageSha256}#${review.subject.claimId}|${reviewer}`
      const held = current.get(slot)
      if (!held || rank(review) >= rank(held.review)) current.set(slot, { review, pageSha256, reviewer })
    }
  for (const { review, pageSha256, reviewer } of current.values()) {
    const key = `${pageSha256}#${review.subject.claimId}`
    const claim = claims.get(key) ?? { pageSha256, claimId: review.subject.claimId, text: review.claim, reviews: [] }
    claim.reviews.push(review)
    claims.set(key, claim)
    const who = reviewerOf(review, reviewer)
    const entry = reviewers.get(who.key) ?? { ...who, reviews: [] }
    entry.reviews.push(review)
    reviewers.set(who.key, entry)
    verdicts.push({ claim: key, reviewer: who.key, review })
  }

  // Pages: every reviewed page and every page a publication cites. The run's other declared results and claims are the
  // gap: counted in one node, so a run with a hundred results stays readable and the unreviewed share stays visible.
  const citedPages = new Set(publications.flatMap((publication) => publication.cites.map((cite) => cite.pageSha256)))
  const reviewedPages = new Set([...claims.values()].map((claim) => claim.pageSha256))
  const shownPages = items.filter((item) => reviewedPages.has(item.sha256) || citedPages.has(item.sha256))
  const gap = items.filter((item) => DECLARED.has(item.kind) && !reviewedPages.has(item.sha256) && !citedPages.has(item.sha256))
  // A reviewed or cited page the run's findings do not list (an earlier version of a revised page, a page of another
  // run) is still drawn, by its digest, so no verdict or citation points nowhere.
  const missing = [...new Set([...reviewedPages, ...citedPages])].filter((sha) => !pages.has(sha))

  // Agents: those that wrote a shown page, and their ancestors by spawn id (run:s1:s2 was spawned by run:s1).
  const agentLabels = new Map((findings.agents ?? []).map((agent) => [agent.agent, agent.label]))
  const agents = new Set<string>()
  for (const item of shownPages) {
    let at: string | null = item.agent ?? null
    while (at) {
      agents.add(at)
      const cut = at.lastIndexOf(':')
      at = cut > 0 && at.slice(0, cut).startsWith(runId) ? at.slice(0, cut) : null
    }
  }
  const agentParent = (id: string) => {
    const cut = id.lastIndexOf(':')
    const parent = cut > 0 ? id.slice(0, cut) : null
    return parent && agents.has(parent) ? parent : null
  }

  // Ordering: pages by agent then time; each column follows the order of what it connects to on its left.
  const agentOrder = [...agents].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const pageOrder = [...shownPages].sort(
    (a, b) => agentOrder.indexOf(a.agent ?? '') - agentOrder.indexOf(b.agent ?? '') || String(a.at ?? '').localeCompare(String(b.at ?? '')),
  )
  const pageIds = [...pageOrder.map((item) => item.sha256), ...missing]
  const claimList = [...claims.entries()].sort(
    (a, b) => pageIds.indexOf(a[1].pageSha256) - pageIds.indexOf(b[1].pageSha256) || a[1].claimId.localeCompare(b[1].claimId),
  )

  const nodes: ProvenanceNode[] = []
  const edges: ProvenanceEdge[] = []
  const add = (node: Omit<ProvenanceNode, 'x' | 'y' | 'column' | 'band'>) => {
    const column = COLUMNS.findIndex((entry) => entry.kind === (node.kind === 'gap' ? 'claim' : node.kind))
    nodes.push({ ...node, column, band: COLUMNS[column]!.band, x: 0, y: 0 })
  }
  for (const id of agentOrder) {
    const local = id === runId ? 'root agent' : id.startsWith(`${runId}:`) ? id.slice(runId.length + 1) : id
    const label = agentLabels.get(id) ?? (id === runId ? 'root' : local)
    add({ id: `agent:${id}`, kind: 'agent', title: label.split(' · ').at(-1) || label || id, sub: local, agent: { id, label, parent: agentParent(id) } })
    const parent = agentParent(id)
    if (parent) edges.push({ id: `agent:${parent}->agent:${id}`, from: `agent:${parent}`, to: `agent:${id}`, kind: 'spawned', crossesBoundary: false })
  }
  for (const item of pageOrder) {
    add({ id: `page:${item.sha256}`, kind: 'page', title: item.title ?? item.path, sub: `${item.kind} · ${item.sha256.slice(0, 12)}`, page: item })
    if (item.agent && agents.has(item.agent)) edges.push({ id: `agent:${item.agent}->page:${item.sha256}`, from: `agent:${item.agent}`, to: `page:${item.sha256}`, kind: 'wrote', crossesBoundary: false })
  }
  for (const sha of missing) add({ id: `page:${sha}`, kind: 'page', title: 'page not in this run’s current findings', sub: `${sha.slice(0, 12)} · an earlier version or another run` })
  let disagreements = 0
  const labels: Record<string, number> = {}
  for (const [key, claim] of claimList) {
    const decided = claim.reviews.filter((review) => review.status === 'decided' && review.label)
    const distinct = new Set(decided.map((review) => review.label))
    const disagree = distinct.size > 1
    if (disagree) disagreements++
    for (const label of distinct) labels[label!] = (labels[label!] ?? 0) + 1
    add({
      id: `claim:${key}`,
      kind: 'claim',
      title: claim.text,
      sub: `${claim.claimId} · ${[...distinct].join(' / ') || 'no verdict'}`,
      disagree,
      claim: { key, ...claim },
    })
    edges.push({ id: `page:${claim.pageSha256}->claim:${key}`, from: `page:${claim.pageSha256}`, to: `claim:${key}`, kind: 'states', crossesBoundary: false })
  }
  if (gap.length)
    add({
      id: 'gap:unreviewed',
      kind: 'gap',
      title: `${gap.length} declared ${gap.length === 1 ? 'result' : 'results and claims'} with no outside verdict`,
      sub: `${(n => `${n} ${n === 1 ? 'agent' : 'agents'}`)(new Set(gap.map((item) => item.agent)).size)} · not reviewed outside the run`,
      gap,
    })
  const reviewerList = [...reviewers.values()]
  for (const reviewer of reviewerList) {
    add({ id: `reviewer:${reviewer.key}`, kind: 'reviewer', title: reviewer.label, sub: [reviewer.harness, reviewer.model].filter(Boolean).join(' · ') || reviewer.kind || 'reviewer', reviewer })
    for (const { claim, review } of verdicts.filter((verdict) => verdict.reviewer === reviewer.key))
      edges.push({ id: `claim:${claim}->reviewer:${reviewer.key}`, from: `claim:${claim}`, to: `reviewer:${reviewer.key}`, kind: 'verdict', label: review.status === 'decided' ? (review.label ?? 'undecided') : review.status, crossesBoundary: true })
  }
  const unresolved: string[] = []
  for (const publication of publications) {
    add({ id: `publication:${publication.id}`, kind: 'publication', title: publication.title, sub: [publication.kind.replaceAll('-', ' '), publication.status].filter(Boolean).join(' · '), publication })
    const targets = new Map<string, string | undefined>()
    for (const cite of publication.cites) {
      // A named claim is cited exactly; an unknown claim id or reviewer cites the page and says it did not resolve.
      // A citation without a claim id cites the page's reviewed claims, else the page.
      const named = cite.claimId ? `${cite.pageSha256}#${cite.claimId}` : null
      if (named && claims.has(named)) targets.set(`claim:${named}`, undefined)
      else if (named) targets.set(`page:${cite.pageSha256}`, `claim ${cite.claimId} not reviewed`)
      else {
        const keys = claimList.filter(([, claim]) => claim.pageSha256 === cite.pageSha256).map(([key]) => `claim:${key}`)
        for (const target of keys.length ? keys : [`page:${cite.pageSha256}`]) targets.set(target, undefined)
      }
      if (cite.reviewer) {
        if (reviewers.has(cite.reviewer)) targets.set(`reviewer:${cite.reviewer}`, undefined)
        else unresolved.push(`${publication.id}: reviewer ${cite.reviewer}`)
      }
    }
    for (const [target, note] of targets) {
      if (note) unresolved.push(`${publication.id}: ${note}`)
      edges.push({ id: `${target}->publication:${publication.id}`, from: target, to: `publication:${publication.id}`, kind: 'cites', label: note, crossesBoundary: true })
    }
  }

  // Layout: columns left to right with a wider gap between bands; each column is ordered by the mean row of what it
  // connects to on its left (so verdict and citation edges stay short), then packed without overlap.
  const byId = new Map<string, ProvenanceNode>()
  const into = new Map<string, string[]>()
  for (const edge of edges) into.set(edge.to, [...(into.get(edge.to) ?? []), edge.from])
  const columns = COLUMNS.map((_, column) => nodes.filter((node) => node.column === column))
  const xs: number[] = []
  let x = 0
  COLUMNS.forEach((entry, column) => {
    if (column > 0) x += P_NODE_W + (COLUMNS[column - 1]!.band === entry.band ? COL_GAP : BAND_GAP + COL_GAP)
    xs.push(x)
  })
  // Run columns stack in their own order first; review and publication columns follow their sources' rows.
  const ys = new Map<string, number>()
  const pack = (list: ProvenanceNode[], want: (node: ProvenanceNode) => number) => {
    const placed = list.map((node, i) => ({ node, want: want(node), i })).sort((a, b) => a.want - b.want || a.i - b.i)
    let floor = 0
    for (const entry of placed) {
      const y = Math.max(floor, entry.want)
      ys.set(entry.node.id, y)
      floor = y + P_NODE_H + ROW_GAP
    }
  }
  const mean = (id: string, fallback: number) => {
    const from = (into.get(id) ?? []).map((source) => ys.get(source)).filter((value): value is number => value !== undefined)
    return from.length ? from.reduce((sum, value) => sum + value, 0) / from.length : fallback
  }
  // The claim column is the spine: it stacks in page order; pages and agents centre on what they lead to.
  pack(columns[2]!, (node) => columns[2]!.indexOf(node) * (P_NODE_H + ROW_GAP))
  const out = new Map<string, string[]>()
  for (const edge of edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to])
  const meanOut = (id: string, fallback: number) => {
    const to = (out.get(id) ?? []).map((target) => ys.get(target)).filter((value): value is number => value !== undefined)
    return to.length ? to.reduce((sum, value) => sum + value, 0) / to.length : fallback
  }
  let tail = columns[2]!.length * (P_NODE_H + ROW_GAP)
  pack(columns[1]!, (node) => {
    const y = meanOut(node.id, tail)
    if (!(out.get(node.id) ?? []).length) tail += P_NODE_H + ROW_GAP
    return y
  })
  // An agent centres on its pages; a spawner of agents only, on its children once they are placed (deepest first).
  const agentWant = new Map<string, number>()
  for (const node of [...columns[0]!].sort((a, b) => b.id.length - a.id.length)) {
    const pagesY = (out.get(node.id) ?? []).map((target) => ys.get(target) ?? agentWant.get(target.slice(6))).filter((value): value is number => value !== undefined)
    agentWant.set(node.id.slice(6), pagesY.length ? pagesY.reduce((sum, value) => sum + value, 0) / pagesY.length : 0)
  }
  pack(columns[0]!, (node) => agentWant.get(node.id.slice(6)) ?? 0)
  pack(columns[3]!, (node) => mean(node.id, 0))
  pack(columns[4]!, (node) => mean(node.id, 0))

  for (const node of nodes) byId.set(node.id, { ...node, x: xs[node.column]!, y: ys.get(node.id) ?? 0 })
  const placed = [...byId.values()].sort((a, b) => a.column - b.column || a.y - b.y)
  const bands = (['run', 'review', 'publication'] as const).map((band) => {
    const cols = COLUMNS.map((entry, i) => (entry.band === band ? i : -1)).filter((i) => i >= 0)
    const left = xs[cols[0]!]!
    return { band, x: left - 40, w: xs[cols.at(-1)!]! + P_NODE_W - left + 80 }
  })
  const height = placed.reduce((max, node) => Math.max(max, node.y + P_NODE_H), 0)
  const firstClaim = placed.find((node) => node.kind === 'claim' && node.disagree) ?? placed.find((node) => node.kind === 'claim')
  return {
    nodes: placed,
    byId,
    edges,
    bands,
    width: xs.at(-1)! + P_NODE_W,
    height,
    focus: firstClaim?.id ?? placed[0]?.id ?? null,
    counts: {
      claims: claims.size,
      reviewed: [...claims.values()].filter((claim) => claim.reviews.some((review) => review.status === 'decided')).length,
      disagreements,
      reviewers: reviewers.size,
      publications: publications.length,
      labels,
    },
    unresolved,
  }
}

/** Keyboard moves: up and down within a column; left and right to the nearest connected node in the next column. */
export function provenanceNeighbour(model: ProvenanceModel, id: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): string | null {
  const at = model.byId.get(id)
  if (!at) return model.focus
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const column = model.nodes.filter((node) => node.column === at.column)
    const i = column.findIndex((node) => node.id === id)
    return (key === 'ArrowUp' ? column[i - 1] : column[i + 1])?.id ?? null
  }
  const linked = model.edges
    .flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))
    .map((other) => model.byId.get(other)!)
    .filter((node) => (key === 'ArrowRight' ? node.column > at.column : node.column < at.column))
  linked.sort((a, b) => Math.abs(a.column - at.column) - Math.abs(b.column - at.column) || Math.abs(a.y - at.y) - Math.abs(b.y - at.y))
  return linked[0]?.id ?? null
}

/** What a node lights: everything connected to it through the graph, up to its agents and out to its publications. */
export function provenanceLit(model: ProvenanceModel, id: string): Set<string> {
  const lit = new Set<string>([id])
  const at = model.byId.get(id)
  if (!at) return lit
  // Walk left (towards the agents) and right (towards publications) separately, so a claim does not light its siblings.
  const walk = (start: string, forward: boolean) => {
    const queue = [start]
    while (queue.length) {
      const current = queue.pop()!
      for (const edge of model.edges) {
        const next = forward ? (edge.from === current ? edge.to : null) : edge.to === current ? edge.from : null
        if (next && !lit.has(next)) lit.add(next), queue.push(next)
      }
    }
  }
  walk(id, true)
  walk(id, false)
  return lit
}
