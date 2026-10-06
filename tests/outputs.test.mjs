import assert from 'node:assert/strict'
import test from 'node:test'
import { runDocumentSchema } from '../dist/workspace.js'
import { briefLines, compareOutputs, groupOutputs, outputKind, parseDelimited, pathInGroup } from '../src/workspace/outputs.ts'

const ROOT = 'knowledge/pages/study'
const sha = (n) => String(n).padStart(64, '0')
const file = (path, bytes, hash = null, kind) => ({ path, bytes, sha256: hash, href: `/api/discovery/runs/r/final/${path}`, ...(kind ? { kind } : {}) })
const deliverable = (id, path, present, kind = 'page') => ({ id, kind, path, bar: `${id} bar`, present, bytes: null, url: null })

function output({ files, deliverables, status = 'complete' }) {
  return {
    declared: { source: 'deliverable-check', field: 'deliverable-checks.jsonl watched', path: ROOT, description: null },
    status: 'not-delivered',
    checkedAt: null,
    files,
    rootOutput: null,
    readout: { status, generatedAt: null, settle: null, summary: null, deliverables, verdicts: [], judges: [], links: { report: null, dossier: null, gist: null }, cost: { readoutUsd: null, runUsd: null }, error: null },
  }
}

const before = output({
  files: [
    file(`${ROOT}/decision-brief.md`, 7898, sha(1)),
    file(`${ROOT}/model/params.md`, 100, sha(2)),
    file(`${ROOT}/model/old.md`, 50, sha(3)),
    file(`${ROOT}/engineering/result.md`, 10, sha(4)),
    file(`${ROOT}/index.md`, 5, sha(5)),
  ],
  deliverables: [
    deliverable('decision-brief', `${ROOT}/decision-brief.md`, true, 'report'),
    deliverable('economic-model', `${ROOT}/model/`, false, 'code'),
    deliverable('engineering', `${ROOT}/engineering/`, true),
    deliverable('software', `${ROOT}/`, false, 'code'),
  ],
})

const after = output({
  files: [
    file(`${ROOT}/brief.md`, 5544, sha(6)),
    file(`${ROOT}/model/params.md`, 120, sha(7)),
    file(`${ROOT}/model/inputs.csv`, 30, sha(8)),
    file(`${ROOT}/engineering/result.md`, 10, sha(4)),
    file(`${ROOT}/engineering/chart.png`, 2000, sha(9)),
    file(`${ROOT}/handoff.md`, 9, null),
  ],
  deliverables: [
    deliverable('decision-brief', `${ROOT}/brief.md`, true, 'report'),
    deliverable('economic-model', `${ROOT}/model/`, true, 'code'),
    deliverable('engineering', `${ROOT}/engineering/`, true),
    deliverable('software', `${ROOT}/`, false, 'code'),
    deliverable('slides', `${ROOT}/deck.html`, false),
  ],
})

test('a file is read by its kind; the server-sent kind wins over the name', () => {
  assert.equal(outputKind({ path: 'a/b/brief.md' }), 'markdown')
  assert.equal(outputKind({ path: 'chart.PNG' }), 'image')
  assert.equal(outputKind({ path: 'rows.tsv' }), 'csv')
  assert.equal(outputKind({ path: 'deck.html' }), 'html')
  assert.equal(outputKind({ path: 'model.py' }), 'code')
  assert.equal(outputKind({ path: 'Makefile' }), 'other')
  assert.equal(outputKind({ path: 'notes', kind: 'markdown' }), 'markdown')
  assert.equal(outputKind({ path: 'x.md', kind: 'not-a-kind' }), 'markdown')
})

test('outputs group under the most specific deliverable; one naming the whole folder claims none', () => {
  const groups = groupOutputs(after)
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]))
  assert.deepEqual(groups.map((group) => group.key), ['decision-brief', 'economic-model', 'engineering', 'software', 'slides', ''])
  assert.deepEqual(byKey['decision-brief'].files.map((f) => f.path), [`${ROOT}/brief.md`])
  assert.deepEqual(byKey['economic-model'].files.map((f) => f.path), [`${ROOT}/model/params.md`, `${ROOT}/model/inputs.csv`])
  assert.equal(byKey.software.whole, true)
  assert.deepEqual(byKey.software.files, [])
  assert.deepEqual(byKey.slides.files, [], 'a deliverable whose file is absent lists nothing')
  assert.deepEqual(byKey[''].files.map((f) => f.path), [`${ROOT}/handoff.md`])
  assert.equal(pathInGroup(byKey['economic-model'], byKey['economic-model'].files[1], ROOT), 'inputs.csv')
  assert.equal(pathInGroup(byKey[''], byKey[''].files[0], ROOT), 'handoff.md')
})

test('a pending readout names no deliverable, so every file is listed under the declared folder', () => {
  const groups = groupOutputs(output({ files: after.files, deliverables: [], status: 'pending' }))
  assert.deepEqual(groups.map((group) => [group.key, group.files.length]), [['', 6]])
  assert.deepEqual(groupOutputs(null), [])
})

test('two versions compare deliverable by deliverable, by content hash', () => {
  const changes = Object.fromEntries(compareOutputs(before, after).map((change) => [change.key, change]))
  // A single-file deliverable keeps one row even when the run renamed its file.
  assert.deepEqual(changes['decision-brief'].files.map((p) => [p.name, p.before?.path, p.change]), [['brief.md', `${ROOT}/decision-brief.md`, 'changed']])
  assert.deepEqual(changes['economic-model'].files.map((p) => [p.name, p.change]), [['inputs.csv', 'added'], ['old.md', 'removed'], ['params.md', 'changed']])
  assert.deepEqual(changes.engineering.counts, { added: 1, removed: 0, changed: 0, same: 1, unknown: 0 })
  assert.equal(changes.slides.status, 'added')
  assert.equal(changes.software.files.length, 0)
  // The declared folder's other files compare by their path in it; a file without a hash and an unchanged size is unknown.
  assert.deepEqual(changes[''].files.map((p) => [p.name, p.change]), [['handoff.md', 'added'], ['index.md', 'removed']])
  const unhashed = compareOutputs(output({ files: [file(`${ROOT}/a.md`, 9)], deliverables: [] }), output({ files: [file(`${ROOT}/a.md`, 9)], deliverables: [] }))
  assert.equal(unhashed[0].files[0].change, 'unknown')
  const resized = compareOutputs(output({ files: [file(`${ROOT}/a.md`, 9)], deliverables: [] }), output({ files: [file(`${ROOT}/a.md`, 10)], deliverables: [] }))
  assert.equal(resized[0].files[0].change, 'changed')
})

test('delimited text parses quoted cells, doubled quotes, separators and line breaks', () => {
  assert.deepEqual(parseDelimited('name,value\ncapex,"1,200"\n"say ""hi""",2\r\n"two\nlines",3'), [
    ['name', 'value'], ['capex', '1,200'], ['say "hi"', '2'], ['two\nlines', '3'],
  ])
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n', '\t'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited(''), [])
})

test("the brief's line for each agent is found by record id, by run-relative id or as the root", () => {
  const brief = { team: [
    { node: 'root', doing: 'Reconciles the two models.' },
    { node: 's0', doing: 'Re-derives the plant cost.' },
    { node: 'r:s1', doing: 'Checks the buffer.' },
    { node: 's9', doing: 'Not in this record.' },
    { node: 's2', doing: null },
  ] }
  assert.deepEqual([...briefLines(brief, 'r', ['r', 'r:s0', 'r:s1', 'r:s2'])], [
    ['r', 'Reconciles the two models.'], ['r:s0', 'Re-derives the plant cost.'], ['r:s1', 'Checks the buffer.'],
  ])
  assert.equal(briefLines(null, 'r', ['r']).size, 0)
})

test('the run document accepts output kinds, a progress brief and its fallback', () => {
  const finalOutput = { ...after, files: [file(`${ROOT}/brief.md`, 10, sha(1), 'markdown')],
    brief: { sequence: 2, phase: 'settled', final: true, generatedAt: '2026-10-06T02:24:58.524Z', headline: 'Stalled.', answer: { text: 'No answer yet.', confidence: 'low', why: null, fromSequence: 2 },
      changed: [], team: [{ node: 'root', label: 'root', state: 'no-winner', model: null, usd: null, lastActiveAt: null, doing: 'Reported a tool failure.' }],
      risks: [{ severity: 'medium', kind: 'known-failure', risk: 'A known failure matched.', evidence: null, source: 'records' }],
      links: { latest: 'https://gist.github.com/x#file-0-latest-md', brief: null, gist: null } },
    fallback: { source: 'brief', sequence: 2, generatedAt: '2026-10-06T02:24:58.524Z', headline: 'Stalled.', answer: null, url: null } }
  const schema = runDocumentSchema.shape.finalOutput
  assert.equal(schema.parse(finalOutput).brief.team[0].doing, 'Reported a tool failure.')
  assert.equal(schema.parse({ ...finalOutput, brief: null, fallback: null }).brief, null)
})
