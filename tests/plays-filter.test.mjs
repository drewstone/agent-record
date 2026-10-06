import assert from 'node:assert/strict'
import test from 'node:test'
import { playsDocumentSchema, runSummarySchema } from '../dist/workspace.js'
import { hiddenSummary, splitHidden, splitRuns } from '../src/workspace/plays-filter.ts'

const spend = { paidUsd: null, sandboxUsd: null, routerUsd: null, costBasisUsd: null, listUsd: null, tokens: null, sandboxHours: null, paidKnown: false, sources: [], gaps: [] }
const counts = (shown, failed = 0, smoke = 0, archived = 0) => ({ shown, failed, smoke, archived })
const play = (id, fields = {}) => ({ id, title: id, program: 'research', line: null, playBasis: 'run-id', state: 'no-winner', latestRun: null, runCount: 1, spend, headline: {}, hidden: null, counts: counts(1), ...fields })

// The live plays index of 2026-10-05, as the host classifies it: a play is hidden only when every run of it is.
const plays = [
  play('no-program', { title: 'Tests & smoke runs (no program)', program: null, playBasis: 'unassigned', noProgram: true, state: 'running', runCount: 738, hidden: 'smoke', counts: counts(0, 0, 738) }),
  play('sample-study', { program: 'sample', runCount: 6, counts: counts(6) }),
  play('research-math', { state: 'driver-failed', runCount: 6, hidden: 'failed', counts: counts(0, 6) }),
  // A failed latest run does not hide a play with a shown run: the failure stays in view as the play's state.
  play('research-physics', { state: 'driver-failed', runCount: 6, counts: counts(1, 5) }),
  play('research-old', { state: 'winner', runCount: 3, hidden: 'archived', counts: counts(0, 0, 0, 3) }),
]

test('the plays index and run summaries with the filter fields satisfy the served schema', () => {
  const parsed = playsDocumentSchema.parse({ schema: 'agent-workspace.plays.v1', builtAt: '2026-10-05T23:00:00Z', plays })
  assert.equal(parsed.plays[0].noProgram, true)
  assert.equal(parsed.plays[2].hidden, 'failed')
  assert.throws(() => playsDocumentSchema.parse({ schema: 'agent-workspace.plays.v1', builtAt: '2026-10-05T23:00:00Z', plays: [{ ...plays[0], hidden: 'noise' }] }))
  const run = runSummarySchema.shape
  assert.ok(run.purpose && run.purposeBasis && run.hidden)
})

test('plays the host hides stay out of view by default and are counted by reason, open or closed', () => {
  const byDefault = splitHidden(plays, false)
  assert.deepEqual(byDefault.shown.map((p) => p.id), ['sample-study', 'research-physics'])
  assert.deepEqual(byDefault.counts, { failed: 1, smoke: 1, archived: 1 })
  assert.equal(byDefault.hidden, 3)
  const all = splitHidden(plays, true)
  assert.equal(all.shown.length, plays.length)
  assert.equal(all.hidden, 3, 'the count names what the filter covers while it is open, too')
  assert.equal(hiddenSummary(byDefault.counts), '1 failed · 1 tests & smoke · 1 archived')
})

test('a play page hides its failed, test and archived runs the same way', () => {
  const runs = [{ id: 'a', hidden: null }, { id: 'b', hidden: 'failed' }, { id: 'c', hidden: 'failed' }, { id: 'd', hidden: 'archived' }]
  const split = splitRuns(runs, false)
  assert.deepEqual(split.shown.map((run) => run.id), ['a'])
  assert.equal(hiddenSummary(split.counts), '2 failed · 1 archived')
  assert.equal(splitRuns(runs, true).shown.length, 4)
})
