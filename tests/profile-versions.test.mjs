import assert from 'node:assert/strict'
import test from 'node:test'
import { profileGraphDocumentSchema } from '../dist/workspace.js'
import {
  authorsAbove,
  deltaSummary,
  findProfile,
  layoutProfiles,
  primaryDiff,
  profileGraph,
  profileLabel,
  visibleProfiles,
} from '../src/workspace/profile-graph.ts'
import { terraformProfileGraph } from './fixtures/profile-graph.mjs'

const doc = terraformProfileGraph()
const byName = (name, createdIn) => doc.nodes.find((node) => node.name === name && (!createdIn || node.createdIn === createdIn))

test('the fixture satisfies the served schema', () => {
  assert.equal(profileGraphDocumentSchema.parse(doc).nodes.length, 9 + 15 + 19)
  assert.throws(() => profileGraphDocumentSchema.parse({ ...doc, nodes: [{ ...doc.nodes[0], parents: [{ ...doc.nodes[1].parents[0], basis: 'guessed' }] }] }))
})

test('the version lineage reads first: authored profiles fold under their author', () => {
  const graph = profileGraph(doc)
  assert.deepEqual(graph.heads.map((node) => node.name), ['terraform-solar-fuels-20261003d-director'])
  const shown = visibleProfiles(graph, new Set())
  assert.deepEqual([...shown].map((digest) => graph.nodes.get(digest).createdIn).sort(), [
    ...'abcdefgh'.split('').map((letter) => `terraform-economics-20261005${letter}`), 'terraform-solar-fuels-20261003d',
  ])
  const e = byName('terraform-economics-20261005e-director')
  assert.equal(graph.authored.get(e.digest), 5)
  // h hangs under g (its control arm), not under e, though e is also its parent.
  assert.equal(graph.parentOf.get(byName('terraform-economics-20261005h-director').digest).digest, byName('terraform-economics-20261005g-director').digest)
  const opened = visibleProfiles(graph, new Set([e.digest]))
  assert.equal(opened.size, 9 + 5)
  const director = byName('director-model', 'terraform-economics-20261005e')
  assert.equal(visibleProfiles(graph, new Set([e.digest, director.digest])).size, 9 + 5 + 4)
})

test('a selected profile opens the authors above it', () => {
  const graph = profileGraph(doc)
  const sourcer = byName('model:sourcer')
  assert.deepEqual(authorsAbove(graph, sourcer.digest), [byName('director-model', 'terraform-economics-20261005e').digest, byName('terraform-economics-20261005e-director').digest])
  assert.equal(findProfile(graph, sourcer.short).digest, sourcer.digest)
  assert.equal(findProfile(graph, sourcer.digest).digest, sourcer.digest)
  assert.equal(findProfile(graph, 'zz'), null)
  assert.equal(findProfile(graph, '1234'), null, 'fewer than 8 hex characters never select')
})

test('labels, layout and score summaries', () => {
  const graph = profileGraph(doc)
  const e = byName('terraform-economics-20261005e-director')
  assert.equal(profileLabel(e, doc.play), '20261005e')
  assert.equal(profileLabel(byName('terraform-solar-fuels-20261003d-director'), doc.play), 'terraform-solar-fuels-20261003d')
  const expanded = new Set([e.digest])
  const layout = layoutProfiles(graph, visibleProfiles(graph, expanded), expanded, doc.play)
  const placed = [...layout.placed.values()]
  assert.equal(placed.length, 14)
  for (const entry of placed) assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y))
  // Every node keeps its own row: no two dots share a position.
  assert.equal(new Set(placed.map((entry) => `${entry.x},${entry.y}`)).size, placed.length)
  assert.equal(layout.placed.get(e.digest).toggle, '− 5 authored')
  assert.equal(deltaSummary(primaryDiff(doc, e)), null, 'an unknown score change stays unknown')
  const known = { ...primaryDiff(doc, e), scoreDelta: { status: 'known', source: 'readout', note: 'one run each', categories: [
    { category: 'software', from: 1, to: 2, delta: 1, calibrated: true },
    { category: 'economics', from: 1, to: 1, delta: 0, calibrated: true },
    { category: 'technical', from: 1, to: 0, delta: -1, calibrated: false },
  ] } }
  assert.deepEqual(deltaSummary(known), { up: 1, down: 0, same: 1, advisory: 1 })
})
