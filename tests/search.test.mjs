import assert from 'node:assert/strict'
import test from 'node:test'
import { profileGraphDocumentSchema } from '../dist/workspace.js'
import { blameOf, replayAt, searchesOf, signed, treeOrder } from '../src/workspace/search.ts'

const SEARCH = 'improve-sample'
const RUN = 'sample-search-20261006a'
const digest = (n) => `sha256:${String(n).repeat(64).slice(0, 64)}`

function node(n, { parent = null, label = null, operator = 'improve', at, scores, decisions = [], effect = null, proposalUsd = null, usd = 0.05 }) {
  return {
    digest: digest(n), short: digest(n).slice(7, 19), name: 'analyst', description: null, version: null,
    model: { id: 'deepseek/deepseek-v4.1-flash', provider: null, reasoningEffort: null }, harness: null, tools: [], systemPrompt: `prompt ${n}`,
    instructions: [], files: [], skills: [], play: 'sample-search', kind: parent ? 'proposed' : 'root',
    author: parent ? { kind: 'proposer', name: 'flash', source: 'proposer:flash' } : { kind: 'operator', registration: null },
    createdIn: RUN, createdAt: at, label: null, budget: null, runs: [],
    parents: parent ? [{ digest: digest(parent), relation: 'revision', basis: 'recorded', primary: true, evidence: [],
      events: [{ kind: 'optimizer', at, runId: RUN, searchId: SEARCH, label, operator, reason: { quote: `why ${n}` },
        ...(effect ? { effect: { status: 'known', ...effect } } : {}), cost: { proposalUsd } }] }] : [],
    searches: [{ searchId: SEARCH, kind: 'improve', runId: RUN, registeredAt: at, scores, cost: { usd }, decisions }],
  }
}

const graph = {
  schema: 'discovery-lab.profile-graph', play: 'sample-search', builtAt: '2026-10-06T03:00:00Z',
  nodes: [
    node(1, { at: '2026-10-06T02:16:05Z', scores: { train: { mean: 0.60, units: 12 }, selection: { mean: 0.838, units: 18 }, test: { mean: 0.662, units: 24 } },
      decisions: [{ status: 'rejected', reason: 'a finalist replaces the root', basis: null }] }),
    node(2, { parent: 1, label: 'Full DCF', operator: 'draft', at: '2026-10-06T02:17:10Z', proposalUsd: 0.009,
      scores: { train: { mean: 0.62, units: 12 }, selection: { mean: 0.801, units: 18 }, test: null },
      effect: { split: 'selection', pairs: 18, delta: -0.0365, low: -0.13, high: 0.03, confidence: 0.95, method: 'exact-sign', sufficient: false },
      decisions: [{ status: 'rejected', reason: 'not a finalist', basis: { against: 'root', split: 'selection', pairs: 18, delta: -0.0365, interval: [-0.1314, 0.0302], method: 'descriptive' } }] }),
    node(3, { parent: 2, label: 'Fix BoP units', at: '2026-10-06T02:30:51Z', proposalUsd: 0.0088,
      scores: { train: { mean: 0.78, units: 12 }, selection: { mean: 0.915, units: 18 }, test: { mean: 0.935, units: 24 } },
      effect: { split: 'selection', pairs: 18, delta: 0.1176, low: 0.0316, high: 0.2285, confidence: 0.95, method: 'exact-sign', sufficient: false },
      decisions: [
        { status: 'finalist', reason: 'rank 1 of 1', basis: { against: 'root', split: 'selection', pairs: 18, delta: 0.0777, interval: [-0.0353, 0.199], method: 'descriptive' } },
        { status: 'selected', reason: 'beat the root on 24 test units', basis: { against: 'root', split: 'test', pairs: 24, delta: 0.2731, interval: [0.1445, 0.4124], method: 'bootstrap' } },
      ] }),
    node(4, { parent: 1, label: 'Working capital', at: '2026-10-06T02:20:00Z', scores: { train: null, selection: null, test: null }, decisions: [{ status: 'invalid', reason: 'program failed' }] }),
  ],
  diffs: {},
  searches: [{ searchId: SEARCH, kind: 'improve', runId: RUN, play: 'sample-search', ranking: 'selection', policy: { expansion: 'aide' },
    openedAt: '2026-10-06T02:16:05Z', closedAt: '2026-10-06T02:33:03Z', closeReason: 'max-nodes',
    claim: { decision: 'ship', reason: 'finalist beat the root', selected: digest(3), finalists: [{ digest: digest(3), promote: true, test: { pairs: 24, delta: 0.2731, low: 0.1445, high: 0.4124 } }] },
    curve: [
      { at: '2026-10-06T02:16:54Z', usd: 0.056, unknownCost: 0, versions: 1, best: { nodeId: 'n1', digest: digest(1), score: 0.838 } },
      { at: '2026-10-06T02:31:16Z', usd: 1.45, unknownCost: 3, versions: 3, best: { nodeId: 'n3', digest: digest(3), score: 0.915 } },
    ] }],
  blame: { [digest(3)]: { digest: digest(3), complete: true, versions: [digest(3), digest(2), digest(1)], rows: [
    { field: 'systemPrompt', text: 'Compute LCOH.', introducedBy: digest(1) },
    { field: 'systemPrompt', text: 'Build the year-by-year DCF.', introducedBy: digest(2) },
    { field: 'systemPrompt', text: 'Convert BoP $/kW once.', introducedBy: digest(3) },
  ] } },
}

test('the profile index with an optimizer search satisfies the served schema', () => {
  const parsed = profileGraphDocumentSchema.parse(graph)
  assert.equal(parsed.nodes.filter((n) => n.kind === 'proposed').length, 3)
  assert.equal(parsed.searches[0].claim.decision, 'ship')
})

test('a search reads as a tree of versions with the edge effect, cost, scores and last decision', () => {
  const [model] = searchesOf(graph, RUN)
  assert.equal(searchesOf(graph, 'another-run').length, 0)
  assert.deepEqual(model.versions.map((v) => [v.short.slice(0, 4), v.depth, v.status]), [['1111', 0, 'rejected'], ['2222', 1, 'rejected'], ['3333', 2, 'selected'], ['4444', 1, 'invalid']])
  const shipped = model.versions.find((v) => v.digest === digest(3))
  assert.equal(shipped.label, 'Fix BoP units')
  assert.equal(shipped.reason, 'why 3')
  assert.deepEqual([shipped.effect.delta, shipped.effect.low, shipped.effect.high, shipped.effect.pairs], [0.1176, 0.0316, 0.2285, 18])
  assert.deepEqual([shipped.vsRoot.split, shipped.vsRoot.delta, shipped.vsRoot.low, shipped.vsRoot.high], ['test', 0.2731, 0.1445, 0.4124])
  assert.deepEqual([shipped.proposalUsd, shipped.evaluationUsd, shipped.scores.test.mean], [0.0088, 0.05, 0.935])
  const root = model.versions[0]
  assert.equal(root.root, true)
  assert.equal(root.effect, null)
  assert.equal(model.versions.find((v) => v.digest === digest(4)).effect, null, 'an unmeasured version has no effect, not zero')
  assert.deepEqual(model.curve.map((p) => [p.usd, p.score, p.versions]), [[0.056, 0.838, 1], [1.45, 0.915, 3]])
})

test('the replay shows what the search had registered by a moment', () => {
  const [model] = searchesOf(graph, RUN)
  const early = replayAt(model, Date.parse('2026-10-06T02:18:00Z'))
  assert.deepEqual(early.versions.map((v) => v.digest), [digest(1), digest(2)])
  assert.deepEqual(early.curve.map((p) => p.versions), [1])
  assert.equal(replayAt(model, null).versions.length, 4)
})

test('blame names the version that introduced each line, and tree order keeps parents above children', () => {
  const [model] = searchesOf(graph, RUN)
  const blame = blameOf(graph, model, digest(3))
  assert.deepEqual(blame.rows.map((r) => [r.label, r.own]), [['analyst', false], ['Full DCF', false], ['Fix BoP units', true]])
  assert.equal(blameOf(graph, model, digest(2)), null)
  const order = treeOrder([{ digest: 'c', parent: 'a', at: '3' }, { digest: 'b', parent: 'a', at: '2' }, { digest: 'a', parent: null, at: '1' }, { digest: 'z', parent: 'missing', at: '0' }])
  assert.deepEqual(order.map((v) => v.digest), ['a', 'b', 'c', 'z'])
  assert.equal(signed(0.1176), '+0.118')
  assert.equal(signed(-0.0366), '−0.037')
  assert.equal(signed(null), '—')
})
