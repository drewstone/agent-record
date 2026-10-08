import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deliverableTimeline, lineageLit, lineageModel, lineageNeighbour } from '../src/workspace/run-lineage.ts'

const run = (id, startedAt, extra = {}) => ({ id, startedAt, state: 'no-winner', ...extra })
const root = (model, harness) => ({ model, provider: 'p', reasoningEffort: null, harness, profile: 'director', version: '1' })
const fork = (from, to, moved, fromRoot, toRoot) => ({
  from, to, at: null, why: { reason: `why ${to}`, at: null, source: 'record' }, root: { from: fromRoot, to: toRoot, moved },
  knowledge: { seed: 'sha256:x', files: 3, bytes: 9, knowledgeRunId: null }, inheritedTags: ['rc1'], sourceCommit: 'a', forkCommit: 'b', files: null, profiles: [],
})

// The terraform-dc-tokens shape: a..d by supersedes; d forked into e (and kept running: it declared its own rc2);
// e forked into codex1 with a new model and harness; a superseded run this host lacks is a ghost.
const play = {
  id: 'p',
  runs: [
    run('p-d', '2026-10-06T23:00:00Z'), run('p-c', '2026-10-06T22:00:00Z'), run('p-b', '2026-10-06T21:00:00Z'),
    run('p-e', '2026-10-07T08:56:00Z', { state: 'abandoned' }), run('p-codex1', '2026-10-07T09:49:00Z', { state: 'failed' }),
  ],
  lineage: {
    nodes: [{ runId: 'p-a', state: 'unknown', record: {} }],
    edges: [
      { from: 'p-b', to: 'p-a', kind: 'supersedes' }, { from: 'p-c', to: 'p-b', kind: 'supersedes' }, { from: 'p-d', to: 'p-c', kind: 'supersedes' },
      { from: 'p-e', to: 'p-d', kind: 'fork' }, { from: 'p-codex1', to: 'p-e', kind: 'fork' }, { from: 'p-codex1', to: 'p-d', kind: 'continues' },
      { from: 'p-d', to: 'p-d-v1', kind: 'version' },
    ],
    forks: [fork('p-d', 'p-e', ['profile'], root('opus', 'claude-code'), root('opus', 'claude-code')), fork('p-e', 'p-codex1', ['model', 'harness'], root('opus', 'claude-code'), root('gpt-5.6-sol', 'codex'))],
    releases: [
      { id: 'p-d:rc1', tag: 'rc1', at: '2026-10-07T02:00:00Z', run: 'p-d', deliverables: null, changes: null },
      { id: 'p-d:rc2', tag: 'rc2', at: '2026-10-07T10:00:00Z', run: 'p-d', deliverables: ['report'], changes: { paths: [{ path: 'pages/report.md' }, { path: 'notes/x.md' }] } },
      { id: 'p-codex1:rc2', tag: 'rc2', at: '2026-10-07T11:00:00Z', run: 'p-codex1', deliverables: ['workbook'], changes: { paths: [{ path: 'pages/workbook/a.csv' }] } },
    ],
    deliverables: [{ id: 'workbook', kind: 'data', path: 'pages/workbook/' }, { id: 'report', kind: 'report', path: 'pages/report.md' }],
  },
}

test('the story is one line from the ghost to the newest fork, with a fork labelled by what moved and versions left out', () => {
  const model = lineageModel(play)
  assert.deepEqual(model.nodes.map((n) => [n.id, n.column, n.lane]).sort(), [
    ['p-a', 0, 0], ['p-b', 1, 0], ['p-c', 2, 0], ['p-codex1', 5, 0], ['p-d', 3, 0], ['p-e', 4, 0],
  ])
  assert.equal(model.byId.get('p-a').run, null, 'a run this host lacks is a ghost')
  assert.ok(!model.byId.has('p-d-v1'), 'versions are the run\'s own history, not the story')
  assert.equal(model.byId.get('p-codex1').fork.from, 'p-e', 'the fork is the strongest record of where a run came from')
  const label = (from, to) => model.edges.find((e) => e.from === from && e.to === to)?.label
  assert.equal(label('p-e', 'p-codex1'), 'model opus → gpt-5.6-sol')
  assert.equal(label('p-d', 'p-e'), 'fork')
  assert.equal(label('p-c', 'p-d'), 'supersedes')
  assert.equal(label('p-d', 'p-codex1'), 'continues', 'a second record of the same pair still draws, as a secondary link')
  assert.equal(model.focus, 'p-codex1')
  assert.deepEqual(model.counts, { runs: 5, forks: 2, releases: 3, lines: 1 })
  assert.equal(lineageNeighbour(model, 'p-e', 'ArrowLeft'), 'p-d')
  assert.deepEqual([...lineageLit(model, 'p-e')].sort(), ['p-a', 'p-b', 'p-c', 'p-codex1', 'p-d', 'p-e'])
})

test('a second run from the same source opens a lane below, and the deliverable timeline marks what each release touched', () => {
  const branched = { ...play, runs: [...play.runs, run('p-f', '2026-10-07T12:00:00Z')], lineage: { ...play.lineage, edges: [...play.lineage.edges, { from: 'p-f', to: 'p-d', kind: 'fork' }] } }
  const model = lineageModel(branched)
  assert.deepEqual([model.byId.get('p-f').column, model.byId.get('p-f').lane], [4, 1])
  const timeline = deliverableTimeline(play)
  assert.deepEqual(timeline.releases.map((r) => r.id), ['p-d:rc1', 'p-d:rc2', 'p-codex1:rc2'])
  assert.deepEqual(timeline.rows.map((r) => [r.id, r.cells]), [['workbook', [null, false, true]], ['report', [null, true, false]]])
  assert.deepEqual(timeline.other, [null, 1, 0], 'a path no deliverable declares is counted apart')
})
