import assert from 'node:assert/strict'
import test from 'node:test'
import { playsDocumentSchema, runSummarySchema } from '../dist/workspace.js'
import { hiddenReason, splitHidden } from '../src/workspace/plays-filter.ts'

const spend = { paidUsd: null, sandboxUsd: null, routerUsd: null, costBasisUsd: null, listUsd: null, tokens: null, sandboxHours: null, paidKnown: false, sources: [], gaps: [] }
const play = (id, fields = {}) => ({ id, title: id, program: 'research', line: null, playBasis: 'run-id', state: 'no-winner', latestRun: null, runCount: 1, spend, headline: {}, ...fields })

// The live plays index of 2026-10-05: the catalog's no-program group was the first row, titled "unassigned".
const plays = [
  play('no-program', { title: 'Tests & smoke runs (no program)', program: null, playBasis: 'unassigned', noProgram: true, state: 'running', runCount: 738 }),
  play('terraform-economics', { program: 'terraform' }),
  play('research-math', { state: 'driver-failed' }),
  play('runtime-glm-recursion-smoke', { program: 'runtime', state: 'failed' }),
  play('discovery-canary-opencode', { program: 'discovery' }),
  play('probe-children-sandbox', { program: 'probe', state: 'unknown' }),
  play('hello-versions', { program: 'hello' }),
  play('research-probes-of-measure', { program: 'research', state: 'winner' }),
]

test('the plays index with the new fields satisfies the served schema', () => {
  assert.equal(playsDocumentSchema.parse({ schema: 'agent-workspace.plays.v1', builtAt: '2026-10-05T23:00:00Z', plays }).plays[0].noProgram, true)
  assert.throws(() => playsDocumentSchema.parse({ schema: 'agent-workspace.plays.v1', builtAt: '2026-10-05T23:00:00Z', plays: [{ ...plays[0], noProgram: 'yes' }] }))
  const run = runSummarySchema.shape
  assert.ok(run.purpose && run.purposeBasis)
})

test('no-program, smoke-named and failed plays are hidden by default, and counted', () => {
  assert.deepEqual(plays.map(hiddenReason), ['no-program', null, 'failed', 'smoke', 'smoke', 'smoke', null, null])
  const byDefault = splitHidden(plays, false)
  assert.deepEqual(byDefault.shown.map((p) => p.id), ['terraform-economics', 'hello-versions', 'research-probes-of-measure'])
  assert.equal(byDefault.hidden, 5)
  const all = splitHidden(plays, true)
  assert.equal(all.shown.length, plays.length)
  assert.equal(all.hidden, 5, 'the count names what the filter covers while it is open, too')
})
