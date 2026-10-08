import assert from 'node:assert/strict'
import test from 'node:test'
import { findingsSchema } from '../dist/workspace.js'
import { provenanceLit, provenanceModel, provenanceNeighbour, P_NODE_H, reviewerOf } from '../src/workspace/provenance.ts'

const RUN = 'sample-frontier-20261004a'
const sha = (c) => c.repeat(64)
const page = (c, agent, kind, extra = {}) => ({ path: `pages/${c}.md`, agent, agentLabel: agent, at: `2026-10-04T0${c.charCodeAt(0) % 9}:00:00Z`, kind, title: `page ${c}`, summary: '', answer: null, class: null, verdict: null, versions: 1, uncaptured: false, bytes: 10, sha256: sha(c), ...extra })
const review = (c, claimId, label, reviewer) => ({
  method: 'scientific', dimension: 'claim-review', status: 'decided', label, claim: `claim ${claimId}`,
  subject: { pageSha256: sha(c), claimId }, reviewer,
})
const lane = { identity: 'review-lane/math', kind: 'review-lane', lane: 'math', harness: 'claude-code', model: 'claude-opus-5-5' }
const judge = { identity: 'zai/pi/glm-5.3', kind: 'judge', provider: 'zai', harness: 'pi', model: 'glm-5.3' }

function findings() {
  const items = [
    page('a', RUN, 'claim', { reviews: [review('a', 'C-1', 'NEW', lane), review('a', 'C-1', 'UNVERIFIABLE', judge), review('a', 'C-2', 'KNOWN', lane)] }),
    page('b', `${RUN}:s1`, 'result', { reviews: [review('b', 'C-3', 'NEW', lane)] }),
    page('c', `${RUN}:s1:s0`, 'result'),
    page('d', `${RUN}:s1`, 'process'),
  ]
  return {
    schema: 'agent-workspace.findings.v1', items, total: items.length, links: [],
    agents: [{ agent: RUN, label: 'root', pages: 1, bytes: 1, kinds: {} }, { agent: `${RUN}:s1`, label: 's1 · theory', pages: 2, bytes: 1, kinds: {} }],
    sources: { citations: [], webSearches: [], webFetches: [], knowledgeReads: 0, knowledgeSearches: 0 },
    stop: { kind: null, reason: null, attempts: null, firstFailure: null, lastCause: null, limits: [] },
    publications: [
      { id: 'packet/C-1', kind: 'proof-packet', title: 'Packet C-1', status: 'private', cites: [{ pageSha256: sha('a'), claimId: 'C-1', reviewer: 'review-lane/math' }, { pageSha256: sha('e') }] },
    ],
  }
}

test('the findings with reviews and publications satisfy the served schema', () => {
  assert.equal(findingsSchema.parse(findings()).publications.length, 1)
})

test('claims join pages by digest, reviewers by identity, and two verdicts on one claim show as a disagreement', () => {
  const model = provenanceModel(findings(), RUN)
  assert.equal(model.counts.claims, 3)
  assert.equal(model.counts.reviewers, 2)
  assert.equal(model.counts.disagreements, 1)
  const c1 = model.byId.get(`claim:${sha('a')}#C-1`)
  assert.equal(c1.disagree, true)
  assert.deepEqual(model.edges.filter((edge) => edge.from === c1.id && edge.kind === 'verdict').map((edge) => edge.label).sort(), ['NEW', 'UNVERIFIABLE'])
  assert.ok(model.edges.every((edge) => model.byId.has(edge.from) && model.byId.has(edge.to)), 'no edge points at a missing node')
  // The reviewer layer is outside the run; its edges cross the boundary.
  assert.ok(model.edges.filter((edge) => edge.kind === 'verdict').every((edge) => edge.crossesBoundary))
  assert.equal(reviewerOf(review('a', 'C-1', 'NEW', judge)).label, 'judge · glm-5.3')
})

test('a publication cites the exact claim and the reviewer whose verdict it relies on, and a page outside the findings by its digest', () => {
  const model = provenanceModel(findings(), RUN)
  const cites = model.edges.filter((edge) => edge.to === 'publication:packet/C-1').map((edge) => edge.from).sort()
  assert.deepEqual(cites, [`claim:${sha('a')}#C-1`, `page:${sha('e')}`, 'reviewer:review-lane/math'])
  assert.equal(model.byId.get(`page:${sha('e')}`).title, 'page not in this run’s current findings')
})

test('unreviewed declared results fold into one gap node; process pages stay off the canvas', () => {
  const model = provenanceModel(findings(), RUN)
  const gap = model.byId.get('gap:unreviewed')
  assert.deepEqual(gap.gap.map((item) => item.sha256), [sha('c')])
  assert.equal(model.byId.has(`page:${sha('d')}`), false)
  assert.equal(model.byId.has(`page:${sha('c')}`), false)
})

test('the bands run left to right, columns never overlap, and keys follow the edges', () => {
  const model = provenanceModel(findings(), RUN)
  const order = ['agent', 'page', 'claim', 'reviewer', 'publication']
  for (const node of model.nodes) for (const other of model.nodes)
    if (node !== other && node.column === other.column) assert.ok(Math.abs(node.y - other.y) >= P_NODE_H, `${node.id} overlaps ${other.id}`)
  const xs = order.map((kind) => model.nodes.find((node) => node.kind === kind).x)
  assert.deepEqual([...xs].sort((a, b) => a - b), xs)
  const c1 = `claim:${sha('a')}#C-1`
  assert.ok(provenanceNeighbour(model, c1, 'ArrowRight').startsWith('reviewer:'))
  assert.equal(provenanceNeighbour(model, c1, 'ArrowLeft'), `page:${sha('a')}`)
  const lit = provenanceLit(model, c1)
  assert.ok(lit.has(`agent:${RUN}`) && lit.has('publication:packet/C-1'))
  assert.equal(lit.has(`claim:${sha('a')}#C-2`), false, 'a claim does not light its sibling')
})

test('review edge cases never point at a missing node, never merge unknown reviewers, and cite exactly', () => {
  const doc = findings()
  const a = doc.items[0]
  a.reviews = [
    ...a.reviews,
    { ...review('f', 'C-9', 'NEW', lane) }, // a page not in the findings (an earlier version)
    { ...review('a', 'C-4', 'NEW', lane), subject: { pageSha256: '', claimId: 'C-4' } }, // empty digest: the page it is attached to
    { ...review('a', 'C-1', 'NEW', lane), status: 'stale', at: '2026-10-09' }, // stale beside the decided NEW
    { ...review('a', 'C-5', 'KNOWN', null) },
    { ...review('a', 'C-5', 'WRONG', undefined) },
    review('a', 'C-2', 'KNOWN', lane), // an exact duplicate
  ]
  doc.publications[0].cites.push({ pageSha256: sha('a'), claimId: 'NOPE' }, { pageSha256: sha('a'), claimId: 'C-1', reviewer: 'ghost' })
  const model = provenanceModel(doc, RUN)
  assert.ok(model.edges.every((edge) => model.byId.has(edge.from) && model.byId.has(edge.to)), 'no edge points at a missing node')
  assert.ok(model.byId.has(`page:${sha('f')}`))
  assert.ok(model.byId.has(`claim:${sha('a')}#C-4`))
  const laneOnC1 = model.edges.find((edge) => edge.from === `claim:${sha('a')}#C-1` && edge.to === 'reviewer:review-lane/math')
  assert.equal(laneOnC1.label, 'NEW', 'a stale row never hides a decision')
  assert.equal(model.byId.get(`claim:${sha('a')}#C-2`).claim.reviews.length, 1, 'a duplicate review is one verdict')
  const unknown = model.nodes.filter((node) => node.kind === 'reviewer' && node.reviewer.key.startsWith('unattributed:'))
  assert.equal(unknown.length, 2, 'two unattributed reviewers stay two')
  assert.equal(model.edges.some((edge) => edge.to === 'publication:packet/C-1' && edge.from === `claim:${sha('a')}#C-2`), false, 'an unknown claim id does not cite every claim on the page')
  assert.deepEqual(model.unresolved.sort(), ['packet/C-1: claim NOPE not reviewed', 'packet/C-1: reviewer ghost'])
})
