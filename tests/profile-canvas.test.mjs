import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { profileGraphDocumentSchema } from '../dist/workspace.js'
import { canvasModel, CLUSTER_MIN, edgeOrigin, lineageOf, neighbour, originChain, originText, profileRunCost } from '../src/workspace/profile-canvas.ts'
import { sampleProfileGraph } from './fixtures/profile-graph.mjs'

const doc = sampleProfileGraph()
const named = (model, name) => model.nodes.find((node) => node.node?.name === name)

test("a run's canvas holds the profiles it ran and every version they derive from, across plays", () => {
  const model = canvasModel(doc, { kind: 'run', runId: 'sample-study-20261005e', play: 'sample-study' })
  assert.equal(model.counts.inScope, 1 + 15, 'the registered profile and the fifteen its agents wrote')
  // e is a revision of c, c of a, a of d; d was registered in another play.
  assert.deepEqual(originChain(model, model.focus).map((step) => step.node.node.name.slice(-11)), ['5e-director', '5c-director', '5a-director', '3d-director'])
  assert.equal(model.byId.get(model.focus).node.createdIn, 'sample-study-20261005e')
  const d = named(model, 'sample-pilot-20261003d-director')
  assert.equal(d.foreign, true)
  assert.equal(d.inScope, false)
  assert.deepEqual(model.foreignPlays, ['sample-pilot'])
  const crossing = model.edges.find((edge) => edge.from === d.id)
  assert.equal(crossing.crossPlay, true)
  assert.equal(crossing.relation, 'revision')
  // Runs of the play that are not this run's lineage stay off the canvas.
  assert.equal(named(model, 'sample-study-20261005f-director'), undefined)
})

test('every drawn profile sits right of its parent, and no two cards overlap', () => {
  const model = canvasModel(doc, { kind: 'play', play: 'sample-study', runs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => `sample-study-20261005${x}`) })
  for (const node of model.nodes) if (node.parent) assert.ok(model.byId.get(node.parent).x < node.x)
  const spots = new Set(model.nodes.map((node) => `${node.x}:${node.y}`))
  assert.equal(spots.size, model.nodes.length)
  assert.ok(model.nodes.every((node) => node.x + 264 <= model.width && node.y + 96 <= model.height))
})

// A worker profile first written in play A, then reused by a director in play B.
const digest = (seed) => `sha256:${createHash('sha256').update(seed).digest('hex')}`
const profile = (seed, extra) => ({
  digest: digest(seed), short: digest(seed).slice(7, 19), name: seed, description: null, version: null, play: null, kind: 'spawned',
  model: { id: 'glm-5.3', provider: null, reasoningEffort: null }, harness: 'opencode', tools: [], systemPrompt: null, instructions: [], files: [], skills: [],
  author: { kind: 'operator', registration: null }, createdIn: null, createdAt: '2026-09-13T00:00:00Z', label: null, budget: null, parents: [], runs: [], ...extra,
})
const spawnedIn = (runId, nodeId, usd, metered = true) => ({ kind: 'spawned', at: '2026-09-13T01:00:00Z', runId, nodeId, outcome: { status: 'done', usd, metered } })
const director = (play, runId) => profile(`${play}-director`, { kind: 'root', play, createdIn: runId, runs: [{ runId, nodeIds: [runId], outcome: null, run: { state: 'winner', reason: null }, score: { status: 'unknown', reason: 'none' } }] })

function reusedWorker() {
  const a = director('glm2-b', 'glm2-b-20260913a')
  const b = director('fourier-e', 'fourier-e-20260914b')
  const worker = profile('literature-enumerate', {
    play: 'glm2-b', createdIn: 'glm2-b-20260913a', author: { kind: 'node', runId: 'glm2-b-20260913a', nodeId: 'glm2-b-20260913a:s0', profileDigest: a.digest },
    parents: [
      { digest: a.digest, relation: 'authored', basis: 'recorded', primary: true, level: 'within-run', evidence: [], events: [spawnedIn('glm2-b-20260913a', 'glm2-b-20260913a:s0', 0.5)] },
      { digest: b.digest, relation: 'authored', basis: 'recorded', primary: false, level: 'within-run', evidence: [], events: [spawnedIn('fourier-e-20260914b', 'fourier-e-20260914b:s0', 1.25), spawnedIn('fourier-e-20260914b', 'fourier-e-20260914b:s1', 0, false)] },
    ],
    runs: ['glm2-b-20260913a', 'fourier-e-20260914b'].map((runId) => ({ runId, nodeIds: [], outcome: 'done', run: { state: 'winner', reason: null }, score: { status: 'unknown', reason: 'none' } })),
  })
  return { schema: 'discovery-lab.profile-graph', play: 'fourier-e', builtAt: '2026-10-07T00:00:00Z', nodes: [a, b, worker], diffs: {} }
}

test('a profile reused from another play hangs under the agent that spawned it here, with its first author as a cross-play line', () => {
  const graph = reusedWorker()
  assert.equal(profileGraphDocumentSchema.parse(graph).nodes.length, 3, 'edge events and levels satisfy the served schema')
  const model = canvasModel(graph, { kind: 'run', runId: 'fourier-e-20260914b', play: 'fourier-e' })
  const worker = named(model, 'literature-enumerate')
  assert.equal(model.byId.get(worker.parent).node.name, 'fourier-e-director', 'laid out under this run’s director')
  assert.equal(worker.foreign, true)
  assert.deepEqual(worker.elsewhere, { runs: ['glm2-b-20260913a'], plays: ['glm2-b'] })
  const first = model.edges.find((edge) => model.byId.get(edge.from).node.name === 'glm2-b-director')
  assert.equal(first.home, false)
  assert.equal(first.crossPlay, false, 'its first author is in its own play')
  assert.equal(model.edges.find((edge) => edge.home && edge.to === worker.id).crossPlay, true, 'its reuse here crosses into this play')
  assert.equal(originText(first, (run) => run), 'spawned in glm2-b-20260913a')
  assert.deepEqual(model.foreignPlays, ['glm2-b'])
  assert.deepEqual(profileRunCost(worker.node, 'fourier-e-20260914b'), { usd: 1.25, agents: 2, unmetered: 1 }, 'an unmetered agent is counted, never priced at zero')
  assert.equal(profileRunCost(model.byId.get(model.focus).node, 'fourier-e-20260914b'), null)
  // Hovering the worker lights both directors.
  const lit = lineageOf(model, worker.id)
  assert.equal(lit.size, 3)
})

test('a crowd of runtime profiles folds into one cluster until it is expanded or one of them is selected', () => {
  const root = director('wide', 'wide-20261001a')
  const workers = Array.from({ length: CLUSTER_MIN + 2 }, (_, i) =>
    profile(`worker-${i}`, {
      play: 'wide', createdIn: 'wide-20261001a',
      parents: [{ digest: root.digest, relation: 'authored', basis: 'recorded', primary: true, evidence: [], events: [spawnedIn('wide-20261001a', `wide-20261001a:s${i}`, 0.1)] }],
      runs: [{ runId: 'wide-20261001a', nodeIds: [`wide-20261001a:s${i}`], outcome: 'done', run: { state: 'winner', reason: null }, score: { status: 'unknown', reason: 'none' } }],
    }),
  )
  const graph = { schema: 'discovery-lab.profile-graph', play: 'wide', builtAt: '2026-10-07T00:00:00Z', nodes: [root, ...workers], diffs: {} }
  const scope = { kind: 'run', runId: 'wide-20261001a', play: 'wide' }
  const folded = canvasModel(graph, scope)
  assert.equal(folded.nodes.length, 2)
  const cluster = folded.nodes.find((node) => node.cluster)
  assert.equal(cluster.cluster.members.length, CLUSTER_MIN + 2)
  assert.equal(folded.counts.clustered, CLUSTER_MIN + 2)
  assert.equal(neighbour(folded, folded.focus, 'ArrowRight'), cluster.id)
  assert.equal(neighbour(folded, cluster.id, 'ArrowLeft'), folded.focus)
  assert.equal(canvasModel(graph, scope, new Set([root.digest])).nodes.length, CLUSTER_MIN + 3)
  assert.equal(canvasModel(graph, scope, new Set(), workers[3].digest).nodes.length, CLUSTER_MIN + 3, 'a selection is never hidden')
})

test('a revision names the run whose evidence proposed it', () => {
  const parent = director('tokens', 'tokens-20261006d')
  const version = profile('finance-director', {
    kind: 'proposal', play: 'tokens', createdIn: null, author: { kind: 'proposer', name: 'role-improve', source: null },
    parents: [{ digest: parent.digest, relation: 'revision', basis: 'recorded', primary: true, evidence: [], events: [{ kind: 'proposed', at: '2026-10-07T09:02:50Z', runId: 'tokens-20261006d', label: 'finance-director: missing-mechanics' }] }],
  })
  assert.deepEqual(edgeOrigin(version.parents[0], version), { run: 'tokens-20261006d', kind: 'proposed' })
  const graph = { schema: 'discovery-lab.profile-graph', play: 'tokens', builtAt: '2026-10-07T00:00:00Z', nodes: [parent, version], diffs: {} }
  const model = canvasModel(graph, { kind: 'run', runId: 'tokens-20261006d', play: 'tokens' })
  assert.equal(model.counts.inScope, 2, 'a version proposed from the run’s evidence belongs to the run')
})
