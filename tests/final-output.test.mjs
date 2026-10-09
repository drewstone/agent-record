// The run page's final output: the readout the Lab writes after a run settles, as the run document carries it, and
// the rules the panel uses to show it without inventing a link, a score or a cost.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FinalOutputPanel, finalOutputSchema } from '../dist/index.js'
import { externalHref, judgeBasis, questionLabel, reviewPhaseLabel, reviewScoreTone, scoreLabel, verdictView } from '../src/workspace/final-output.ts'

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

// The trace review as discovery_workspace.py run_trace_review composes it from discovery-lab's trace-review.json.
const traceReview = {
  phase: 'running', final: false, generatedAt: '2026-10-09T18:00:00.000Z', goal: 'Build the data center plan.', requester: 'requests/drew.md',
  model: 'zai/glm-5.3',
  sessions: { read: 12, nodes: 5, unreadable: [{ node: 's3', reason: 'no transcript' }], unreadableCount: 1 },
  questions: [
    { id: 'goal-alignment', question: 'Does the work serve the goal?', status: 'answered', score: 72, verdict: 'Mostly on goal.',
      quotes: [{ agent: 's0', quote: 'I will size the cooling first.', citation: 's0#41' }], suggestions: ['Ask for the budget.'],
      citations: { total: 3, resolved: 2 }, failure: null },
    { id: 'safety', question: 'Anything unsafe?', status: 'failed', score: null, verdict: null, quotes: [], suggestions: [],
      citations: { total: 0, resolved: 0 }, failure: 'timeout: no answer in 600 s' },
    { id: 'new-question-id', question: null, status: 'answered', score: 31, verdict: 'Weak.', quotes: [], suggestions: [],
      citations: { total: 4, resolved: 0 }, failure: null },
  ],
  cost: { usd: 0.42, kind: 'metered' },
}

test('the run page shows the latest trace review in plain words, and nothing when there is none', () => {
  const parsed = finalOutputSchema.parse({ ...finalOutput(null), traceReview })
  const html = renderToStaticMarkup(createElement(FinalOutputPanel, { output: parsed }))
  assert.match(html, /<h3>Trace review<\/h3>/)
  assert.match(html, /Live review, 2026-10-09 18:00 UTC/)
  assert.match(html, /The requester&#x27;s goal:<\/b> Build the data center plan\./)
  assert.match(html, /Read 12 agent sessions from 5 agents; 1 could not be read\./)
  assert.match(html, /Works toward the requester&#x27;s goal/)
  assert.match(html, /72\/100/)
  assert.match(html, /Mostly on goal\./)
  assert.match(html, /1 quote and 1 suggestion/)
  assert.match(html, /I will size the cooling first\./)
  assert.match(html, /2 of 3 citations found in the sessions/)
  assert.match(html, /Stays within safety and permission limits/)
  assert.match(html, /The question was not answered: timeout: no answer in 600 s/)
  assert.match(html, /New question id/)
  assert.match(html, /0 of 4 citations found in the sessions/, 'citations show even without quotes or suggestions')
  assert.doesNotMatch(html, /goal-alignment</)
  const settled = renderToStaticMarkup(createElement(FinalOutputPanel, { output: finalOutputSchema.parse({ ...finalOutput(null), traceReview: { ...traceReview, phase: 'settled', final: true } }) }))
  assert.match(settled, /Final review, after the run settled/)
  // A run without a review, and a document built before the field existed, render without the section.
  for (const output of [{ ...finalOutput(null), traceReview: null }, finalOutput(null)]) {
    const plain = renderToStaticMarkup(createElement(FinalOutputPanel, { output: finalOutputSchema.parse(output) }))
    assert.match(plain, /Final output/)
    assert.doesNotMatch(plain, /Trace review/)
  }
  assert.throws(() => finalOutputSchema.parse({ ...finalOutput(null), traceReview: { ...traceReview, phase: 'stopped' } }))
})

test('trace review questions, scores and phase read as plain words', () => {
  assert.equal(questionLabel('coordination-waste'), 'Agents coordinate without waste')
  assert.equal(questionLabel('some_new-question'), 'Some new question')
  assert.equal(reviewScoreTone(70), 'state-ok')
  assert.equal(reviewScoreTone(55), 'state-warn')
  assert.equal(reviewScoreTone(39), 'state-fail')
  assert.equal(reviewScoreTone(null), 'state-unknown')
  assert.equal(reviewPhaseLabel({ final: false, phase: 'running' }, 'now'), 'Live review, now')
  assert.equal(reviewPhaseLabel({ final: true, phase: 'settled' }, 'now'), 'Final review, after the run settled')
})
