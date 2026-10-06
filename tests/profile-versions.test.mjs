import assert from 'node:assert/strict'
import test from 'node:test'
import { profileGraphDocumentSchema } from '../dist/workspace.js'
import { deltaSummary, findProfile, primaryDiff, profileGraph, profileLabel } from '../src/workspace/profile-graph.ts'
import { absoluteMedian, authoredTree, changeSummary, compareProfiles, judgeShort, judgeSummary, judgesOf, lineDiff, sameNamed, versionsOf } from '../src/workspace/profile-compare.ts'
import { terraformProfileGraph } from './fixtures/profile-graph.mjs'

const doc = terraformProfileGraph()
const byName = (name, createdIn) => doc.nodes.find((node) => node.name === name && (!createdIn || node.createdIn === createdIn))

test('the fixture satisfies the served schema', () => {
  assert.equal(profileGraphDocumentSchema.parse(doc).nodes.length, 9 + 15 + 19)
  assert.throws(() => profileGraphDocumentSchema.parse({ ...doc, nodes: [{ ...doc.nodes[0], parents: [{ ...doc.nodes[1].parents[0], basis: 'guessed' }] }] }))
})

test('a profile is found by its short digest, and a root is drawn by its run', () => {
  const graph = profileGraph(doc)
  const sourcer = byName('model:sourcer')
  assert.equal(findProfile(graph, sourcer.short).digest, sourcer.digest)
  assert.equal(findProfile(graph, sourcer.digest).digest, sourcer.digest)
  assert.equal(findProfile(graph, 'zz'), null)
  assert.equal(findProfile(graph, '1234'), null, 'fewer than 8 hex characters never select')
  const e = byName('terraform-economics-20261005e-director')
  assert.equal(profileLabel(e, doc.play), '20261005e')
  assert.equal(deltaSummary(primaryDiff(doc, e)), null, 'an unknown score change stays unknown')
})

// The play document's runs, as far as the version graph reads them.
const runOf = (letter, startedAt) => ({ id: `terraform-economics-20261005${letter}`, startedAt, state: 'no-winner' })
const play = { id: 'terraform-economics', runs: ['a', 'b', 'c', 'd', 'e', 'f'].map((letter, i) => runOf(letter, `2026-10-05T0${i}:00:00Z`)).reverse() }

test('each run is a version compared with the one before it that has a profile', () => {
  const versions = versionsOf(play, doc)
  assert.deepEqual(versions.map((v) => v.run.id.slice(-1)), ['a', 'b', 'c', 'd', 'e', 'f'], 'oldest first')
  const f = versions.at(-1)
  assert.equal(f.previous.run.id, 'terraform-economics-20261005e')
  // f adds one instruction to e (the fixture's file digests are labels, so its commission differs too).
  assert.deepEqual(f.comparison.fields.map((field) => field.field), ['instructions', 'files'])
  assert.equal(f.comparison.fields[0].added, 1)
  assert.equal(changeSummary(f.comparison), '+1 instruction · 1 file changed')
  assert.equal(changeSummary(versions[0].comparison), 'first version')
  const e = byName('terraform-economics-20261005e-director')
  assert.equal(changeSummary(compareProfiles(e, { ...e, digest: f.root.digest })), 'same profile')
  assert.equal(versionsOf(play, null)[5].root, null, 'without an index there is no profile to compare')
})

test('a comparison names what changed in tools, budget and files', () => {
  const e = byName('terraform-economics-20261005e-director')
  const changed = { ...e, tools: e.tools.filter((tool) => tool !== 'Bash'), budget: { ...e.budget, maxTokens: 6_500_000 }, files: [] }
  const comparison = compareProfiles(e, changed)
  assert.deepEqual(comparison.fields.map((field) => field.field), ['tools', 'files', 'budget.maxTokens'])
  assert.deepEqual(comparison.fields[0].removed, ['Bash'])
  assert.equal(changeSummary(comparison), '−1 tool · 1 file changed · maxTokens changed')
})

test('a line diff keeps the changed lines with one line of context', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f']
  const after = ['a', 'b', 'c', 'X', 'e', 'f']
  const diff = lineDiff(before, after)
  assert.deepEqual([diff.added, diff.removed], [1, 1])
  assert.deepEqual(diff.lines.map((line) => line.op + line.text), ['@2 unchanged lines', ' c', '-d', '+X', ' e', '@1 unchanged line'])
})

test('the profiles a version wrote hang under it as a tree, and match their namesakes in the version before', () => {
  const tree = authoredTree(doc, 'terraform-economics-20261005f')
  assert.equal(tree.length, 19)
  assert.deepEqual(tree.filter((entry) => entry.depth === 0).map((entry) => entry.node.name), [
    'director-model', 'director-engineering', 'director-business', 'root-blind-attributes', 'root-blind-parity', 'root-review-model',
  ])
  const model = tree[0]
  assert.deepEqual(tree.slice(1, 6).map((entry) => [entry.depth, entry.parent === model.node.digest]), Array(5).fill([1, true]))
  const counterpart = sameNamed(doc, model.node, 'terraform-economics-20261005e')
  assert.equal(counterpart.createdIn, 'terraform-economics-20261005e')
  assert.equal(sameNamed(doc, tree.at(-1).node, 'terraform-economics-20261005e'), null)
})

test('only absolute-scale judge scores are scores; the retired relative scale is named, never shown', () => {
  const e = byName('terraform-economics-20261005e-director')
  const relative = judgesOf(e, 'terraform-economics-20261005e')
  assert.equal(relative.judges.length, 4)
  assert.equal(judgeSummary(relative.judges), 'no absolute score yet: these judges used the retired relative 0–4 scale')
  assert.equal(judgeShort(relative.judges), 'no absolute score yet')
  assert.equal(absoluteMedian(relative.judges), null)
  const absolute = [
    { category: 'economics', score: 12, max: 100, calibrated: true, scale: 'absolute 0–100 vs world-class' },
    { category: 'software', score: 4, max: 100, calibrated: false, scale: 'absolute 0–100 vs world-class' },
    { category: 'clarity', score: 30, max: 100, calibrated: true, scale: 'absolute 0–100 vs world-class' },
    { category: 'graphics', score: 3, max: 4, calibrated: true },
  ]
  assert.equal(judgeSummary(absolute), 'median 12 of 100 across 3 judges, 2 calibrated')
  assert.equal(judgeShort(absolute), 'median 12/100 · 3 judges')
  assert.equal(judgesOf(byName('terraform-economics-20261005f-director'), 'terraform-economics-20261005f'), null)
  assert.equal(judgeSummary([]), 'no readout judges')
})
