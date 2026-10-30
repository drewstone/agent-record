import type { RunRecord } from '../record.js'

const PER_LANE = 14
const LABEL_W = 156
const COL_W = 236
const NODE_W = 204
const NODE_H = 62
const LANE_H = 104

export { NODE_W, NODE_H, LANE_H, PER_LANE }

export interface GraphNode {
  id: string
  kind: string
  title: string
  sub: string
  x: number
  y: number
  item: null
  summary?: string
  href?: string | null
}

export interface GraphEdge {
  from: string
  to: string
  kind: string
}

export interface WorkGraphModel {
  nodes: GraphNode[]
  edges: GraphEdge[]
  byId: Map<string, GraphNode>
  laneLabels: { label: string; y: number }[]
  columnLabels: { label: string; x: number }[]
  sourcesLane: boolean
  hidden: Record<string, number>
  width: number
  height: number
  title: string
  summary: string
  legend: { kind: string; label: string }[]
}

/** A bundle's entity and evidence topology. It never connects by title, text, time, or a guessed session. */
export function recordWorkGraphModel(record: RunRecord): WorkGraphModel {
  const columns = ['Run', 'Agents', 'Sessions', 'Artifacts', 'Claims', 'Verdicts', 'Publications', 'Profiles'] as const
  const groups: GraphNode[][] = columns.map(() => [])
  const byId = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const seenEdges = new Set<string>()
  const add = (column: number, id: string, kind: string, title: string, sub: string, summary?: string, href?: string | null) => {
    if (byId.has(id)) return
    const node: GraphNode = { id, kind, title, sub, summary, href, item: null, x: LABEL_W + column * COL_W, y: 54 + groups[column]!.length * LANE_H }
    groups[column]!.push(node)
    byId.set(id, node)
  }
  const link = (from: string, to: string, kind: string) => {
    const id = `${from}>${to}:${kind}`
    if (!byId.has(from) || !byId.has(to) || seenEdges.has(id)) return
    seenEdges.add(id)
    edges.push({ from, to, kind })
  }
  const claimId = (pageSha256: string, id: string) => `claim:${pageSha256}#${id}`
  add(0, `run:${record.runId}`, 'run', record.title || record.runId, record.runId)
  for (const node of record.nodes) {
    const column = node.kind === 'agent' ? 1 : node.kind === 'session' ? 2 : 3
    add(column, `node:${node.id}`, node.kind, node.label || node.id, [node.harness, node.model, node.nativeSessionId].filter(Boolean).join(' · ') || node.id, node.assignment)
  }
  for (const node of record.nodes) {
    if (node.parent) link(`node:${node.parent}`, `node:${node.id}`, 'parent')
    // Container membership is recorded by the record itself. It does not imply a native parent session.
    else link(`run:${record.runId}`, `node:${node.id}`, 'contains')
  }
  for (const artifact of record.artifacts ?? []) {
    add(3, `artifact:${artifact.id}`, 'artifact', artifact.title || artifact.id, artifact.kind, artifact.digest)
    if (artifact.sessionNodeId) link(`node:${artifact.sessionNodeId}`, `artifact:${artifact.id}`, 'wrote')
  }
  for (const claim of record.claims ?? []) {
    const id = claimId(claim.pageSha256, claim.claimId)
    add(4, id, 'claim', claim.statement || claim.claimId, `${claim.claimId} · ${claim.pageSha256.slice(0, 12)}`, claim.statement)
    if (claim.runId === record.runId) link(`run:${record.runId}`, id, 'states')
    if (claim.agentNodeId) link(`node:${claim.agentNodeId}`, id, 'states')
    for (const artifact of record.artifacts ?? []) if (artifact.digest === claim.pageSha256) link(`artifact:${artifact.id}`, id, 'states')
  }
  for (const verdict of record.verdicts ?? []) {
    const id = `verdict:${verdict.id}`
    add(5, id, 'verdict', verdict.judgment, verdict.id, `Review of ${verdict.subject.claimId} on ${verdict.subject.pageSha256}`)
    link(`node:${verdict.reviewerSessionNodeId}`, id, 'reviewed')
    link(id, claimId(verdict.subject.pageSha256, verdict.subject.claimId), 'verdict')
  }
  for (const publication of record.publications ?? []) {
    const id = `publication:${publication.id}`
    add(6, id, 'publication', publication.title || publication.id, publication.kind, undefined, publication.url)
    if (publication.sessionNodeId) link(`node:${publication.sessionNodeId}`, id, 'wrote')
    for (const cite of publication.cites) {
      link(claimId(cite.pageSha256, cite.claimId), id, 'cites')
      if (cite.verdictId) link(`verdict:${cite.verdictId}`, id, 'cites')
    }
  }
  for (const profile of record.profileVersions ?? []) {
    const id = `profile:${profile.digest}`
    add(7, id, 'profile', profile.title || profile.digest.slice(7, 19), profile.digest, profile.runId)
    if (profile.authorNodeId) link(`node:${profile.authorNodeId}`, id, 'wrote')
    if (profile.runId === record.runId) link(`run:${record.runId}`, id, 'run')
  }
  for (const profile of record.profileVersions ?? [])
    for (const parent of profile.parents) link(`profile:${parent}`, `profile:${profile.digest}`, 'parent')
  // A play's record: each run is a node, each fork an edge between them, from the fork's own receipt.
  for (const fork of record.forks ?? []) link(`node:${fork.from}`, `node:${fork.to}`, 'fork')
  const used = groups.map((group, index) => ({ group, index })).filter(({ group }) => group.length)
  // Empty columns stay out of the view; the positions of present columns remain stable across records.
  const nodes = groups.flat()
  const last = used.at(-1)?.index ?? 0
  const summary = `${record.nodes.filter((node) => node.kind === 'session').length} sessions · ${record.claims?.length ?? 0} claims · ${record.verdicts?.length ?? 0} verdicts · ${edges.length} links (${edges.filter((edge) => edge.kind === 'contains').length} record memberships)`
  return {
    nodes, edges, byId, laneLabels: [],
    columnLabels: used.map(({ index }) => ({ label: columns[index]!, x: LABEL_W + index * COL_W })),
    sourcesLane: false, hidden: {}, width: LABEL_W + (last + 1) * COL_W + 24,
    height: Math.max(1, ...groups.map((group) => group.length)) * LANE_H + 54,
    title: 'Record graph', summary,
    legend: [
      { kind: 'contains', label: 'in this record' },
      { kind: 'parent', label: 'recorded parent' },
      { kind: 'fork', label: 'forked into (fork.json)' },
      { kind: 'states', label: 'states this claim' },
      { kind: 'reviewed', label: 'reviewed by this session' },
      { kind: 'verdict', label: 'verdict on this claim' },
      { kind: 'cites', label: 'cites this claim or verdict' },
    ],
  }
}
