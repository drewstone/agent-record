import assert from 'node:assert/strict'
import test from 'node:test'
import { versionGraphDocumentSchema } from '../dist/workspace.js'
import { flagLabel, layoutVersionGraph, runGraphModel, scoreLine } from '../src/workspace/version-graph.ts'

const sha = (letter) => letter.repeat(40)
const commit = (id, lane, kind, parents, subject, extra = {}) => ({
  id: sha(id), parents: parents.map(sha), at: '2026-10-07T03:00:00Z', subject, lane, kind, files: [{ status: 'M', path: `pages/${id}.md` }],
  author: { id: `run:${lane}`, label: lane.replace('workers/', ''), name: lane }, director: null, model: null, spendUsd: null,
  trace: { node: `run:${lane}`, trace: `run/run:${lane}`, session: 'retained-session-1' }, body: '', ...extra,
})
// A run's repository as the Lab serves it: newest first, every child above its parents.
const doc = {
  kind: 'agent-workspace.version-graph', runId: 'run', available: true, refsDigest: `sha256:${'f'.repeat(64)}`,
  lanes: [
    { id: 'main', label: 'main', kind: 'store', head: sha('e'), director: null, commits: 3 },
    { id: 'workers/editor', label: 'editor', kind: 'worker', head: sha('d'), director: 'run:s1', commits: 2 },
    { id: 'workers/finance', label: 'finance', kind: 'worker', head: sha('b'), director: 'run:s0', commits: 1 },
  ],
  commits: [
    commit('e', 'main', 'integrate', ['c', 'd'], 'integrate editor: report.md'),
    commit('d', 'workers/editor', 'write', ['a'], 'editor: report.md'),
    commit('c', 'main', 'integrate', ['1', 'b'], 'integrate finance: model.md'),
    commit('b', 'workers/finance', 'profile', ['1'], 'root: spawn finance', { profileDigest: `sha256:${'9'.repeat(64)}`, spawned: 'run:s0' }),
    commit('a', 'workers/editor', 'write', ['1'], 'editor: draft.md'),
    commit('1', 'main', 'write', [], 'seed'),
  ],
  tags: [
    { name: 'rc1', commit: sha('c'), at: null, by: 'editor', message: 'rc1', attempts: 1, best: true, flags: [],
      score: { complete: true, scoredAt: null, set: null, vector: { exact: [4, 4], heldOut: [2, 3], blockers: 1, judge: 70 }, results: [] } },
    { name: 'rc2', commit: sha('e'), at: null, by: 'editor', message: 'rc2', attempts: 3, best: false,
      flags: [{ kind: 'regression', tag: 'rc2', from: 'rc1', checks: ['sampled'] }, { kind: 'suspected-judge-gaming', tag: 'rc2', from: 'rc1', checks: ['sampled'] }],
      score: { complete: false, scoredAt: null, set: null, vector: { exact: [4, 4], heldOut: [1, 3], blockers: null, judge: 81.25 }, results: [] } },
  ],
  best: 'rc1', flags: [],
}

test('the served document satisfies its schema', () => {
  assert.equal(versionGraphDocumentSchema.parse(doc).commits.length, 6)
  assert.throws(() => versionGraphDocumentSchema.parse({ ...doc, kind: 'other' }))
  assert.equal(versionGraphDocumentSchema.parse({ kind: 'agent-workspace.version-graph', runId: 'r', available: false, reason: 'none' }).commits.length, 0)
})

test('each lane is a column, and each version draws a line to each parent', () => {
  const laid = layoutVersionGraph(runGraphModel(doc, (iso) => iso))
  assert.deepEqual(laid.lanes.map((lane) => lane.id), ['main', 'workers/editor', 'workers/finance'])
  assert.deepEqual(laid.rows.map((row) => [row.node.id[0], row.column]), [['e', 0], ['d', 1], ['c', 0], ['b', 2], ['a', 1], ['1', 0]])
  const edges = laid.edges.map((edge) => `${edge.from[0]}>${edge.to[0]}`).sort()
  assert.deepEqual(edges, ['a>1', 'b>1', 'c>1', 'c>b', 'd>a', 'e>c', 'e>d'])
  for (const edge of laid.edges) assert.ok(edge.toRow > edge.fromRow, 'a parent is always below its child')
})

test('a hidden version passes its parents on, so a lane stays connected', () => {
  const model = runGraphModel(doc, (iso) => iso)
  const merges = layoutVersionGraph(model, (node) => node.kind !== 'integrate')
  assert.deepEqual(merges.rows.map((row) => row.node.id[0]), ['d', 'b', 'a', '1'])
  assert.deepEqual(merges.edges.map((edge) => `${edge.from[0]}>${edge.to[0]}`).sort(), ['a>1', 'b>1', 'd>a'])
  const editor = layoutVersionGraph(model, (node) => node.lane === 'workers/editor')
  assert.deepEqual(editor.lanes.map((lane) => lane.id), ['workers/editor'])
  assert.deepEqual(editor.edges.map((edge) => `${edge.from[0]}>${edge.to[0]}`), ['d>a'])
})

test('a tag shows its score, the rule\'s pick and its flags on its commit', () => {
  const model = runGraphModel(doc, (iso) => iso)
  const rc2 = model.nodes.find((node) => node.id === sha('e'))
  assert.deepEqual(rc2.chips.map((chip) => [chip.label, chip.tone]), [
    ['merge', 'muted'],
    ['rc2', 'accent'],
    ['exact 4/4 · held-out 1/3 · blockers unknown · judge 81.3 (incomplete)', 'info'],
    ['regression vs rc1: sampled', 'warn'],
    ['suspected judge-gaming vs rc1', 'fail'],
  ])
  assert.equal(model.nodes.find((node) => node.id === sha('c')).chips[1].label, 'rc1 ★ deliverable')
  assert.equal(scoreLine({ ...doc.tags[0], score: null }), 'not scored yet')
  assert.equal(flagLabel({ kind: 'other', tag: 'rc2', from: 'rc1', checks: [] }), 'other vs rc1')
  assert.equal(model.nodes.find((node) => node.id === sha('d')).chips.length, 0, 'a plain write carries no chip')
})
