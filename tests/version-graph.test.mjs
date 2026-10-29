import assert from 'node:assert/strict'
import test from 'node:test'
import { versionGraphDocumentSchema } from '../dist/workspace.js'
import { flagLabel, layoutVersionGraph, runGraphModel, scoreLine } from '../src/workspace/version-graph.ts'

import { doc, sha } from './version-history-fixture.mjs'

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
    // A Knowledge-store version reads as pages vN, so "rc" means only a code release candidate.
    ['pages v2', 'accent'],
    ['exact 4/4 · held-out 1/3 · blockers unknown · judge 81.3 (incomplete)', 'info'],
    ['regression vs pages v1: sampled', 'neutral'],
    ['suspected judge-gaming vs pages v1', 'neutral'],
  ])
  assert.equal(model.nodes.find((node) => node.id === sha('c')).chips[1].label, 'pages v1 ★ picked by rule · not checked')
  assert.equal(scoreLine({ ...doc.tags[0], score: null }), 'not scored yet')
  assert.equal(flagLabel({ kind: 'other', tag: 'rc2', from: 'rc1', checks: [] }), 'other vs pages v1')
  assert.equal(model.nodes.find((node) => node.id === sha('d')).chips.length, 0, 'a plain write carries no chip')
})
