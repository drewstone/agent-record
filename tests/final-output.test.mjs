// The run page's final output: the readout the Lab writes after a run settles, as the run document carries it, and
// the rules the panel uses to show it without inventing a link, a score or a cost.
import assert from 'node:assert/strict'
import test from 'node:test'
import { finalOutputSchema } from '../dist/index.js'
import { externalHref, judgeBasis, scoreLabel, verdictView } from '../src/workspace/final-output.ts'

const readout = {
  status: 'complete',
  generatedAt: '2026-10-05T18:00:00.000Z',
  settle: { kind: 'no-winner', reason: 'budget-exhausted' },
  summary: 'The director wrote a decision brief; no option cleared the bar before the budget ran out.',
  deliverables: [
    { id: 'decision-brief', kind: 'report', path: 'knowledge/sample/decision-brief.md', bar: 'A brief a lead can act on',
      present: true, bytes: 24_000, url: 'https://gist.github.com/drewstone/abc#file-decision-brief-md' },
  ],
  verdicts: [
    { id: 'E28', statement: 'Managed state reduces drift', verdict: 'not-measured', evidence: 'No incident data.' },
    { id: 'E21', statement: 'Module reuse lowers cost', verdict: 'inconclusive', evidence: 'Two of five environments.' },
  ],
  judges: [{ category: 'clarity', score: 3, max: 4, calibrated: false, summary: 'Clear structure.' }],
  links: { report: 'https://gist.github.com/drewstone/abc', dossier: 'https://gist.github.com/drewstone/abc#file-2-dossier-md', gist: null },
  cost: { readoutUsd: null, runUsd: 3.42 },
  error: null,
}

const finalOutput = (value) => ({ declared: null, status: 'none-declared', checkedAt: null, files: [], rootOutput: null, readout: value })

test('the run document carries a readout, a pending one, or none at all', () => {
  const finalShape = finalOutputSchema
  assert.equal(finalShape.parse(finalOutput(readout)).readout.judges[0].calibrated, false)
  const pending = { ...readout, status: 'pending', generatedAt: null, settle: null, summary: null, deliverables: [], verdicts: [], judges: [],
    links: { report: null, dossier: null, gist: null }, cost: { readoutUsd: null, runUsd: null } }
  assert.equal(finalShape.parse(finalOutput(pending)).readout.status, 'pending')
  // A document built before the readout existed still reads.
  const { readout: _absent, ...older } = finalOutput(null)
  assert.equal(finalShape.parse(older).readout, undefined)
  assert.equal(finalShape.parse(finalOutput(null)).readout, null)
  assert.throws(() => finalShape.parse(finalOutput({ ...readout, status: 'done' })))
  assert.throws(() => finalShape.parse(finalOutput({ ...readout, cost: { readoutUsd: '0.18', runUsd: null } })))
})

test('readout links are absolute http(s) only', () => {
  assert.equal(externalHref('https://gist.github.com/drewstone/abc'), 'https://gist.github.com/drewstone/abc')
  assert.equal(externalHref('javascript:alert(1)'), null)
  assert.equal(externalHref('/relative/path'), null)
  assert.equal(externalHref(''), null)
  assert.equal(externalHref(null), null)
})

test('verdicts, scores and judge basis never invent a value', () => {
  assert.deepEqual(verdictView('not-measured'), { label: 'not measured', tone: 'state-unknown' })
  assert.deepEqual(verdictView('not-met'), { label: 'not met', tone: 'state-fail' })
  assert.deepEqual(verdictView('retracted-later'), { label: 'retracted later', tone: 'state-unknown' })
  assert.equal(scoreLabel(3, 4), '3/4')
  assert.equal(scoreLabel(null, 4), 'unknown/4')
  assert.equal(scoreLabel(2.5, null), '2.5/unknown')
  assert.equal(judgeBasis(true), 'calibrated')
  assert.equal(judgeBasis(false), 'advisory')
  assert.equal(judgeBasis(null), 'advisory')
})
