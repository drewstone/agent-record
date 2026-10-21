// agent-record#136: 0.53.0 dropped the receipt's recorded outcome.sentence from both views and outcome.status from the live
// one, so a stopped run's cause (RetainedWorkspaceCapturePendingError) and a partial run's pass state were gone. The four
// cases are the wall's (tangle-tools test_run_receipt_hides_empty_fields_and_keeps_recorded_values_through_http): the
// stopped and released receipt shapes, each mutated as that test does. Values are structure-only, not a served run.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunOverview, runReceiptSchema } from '../dist/index.js'
import { renderRunReceipt } from '../dist/receipt.js'

const stopCause = 'The run stopped with RetainedWorkspaceCapturePendingError; no passing check is recorded.'
const commit = '51018bf60e457ec05a5f8622cfebd58db6bfeea7'
const decision = (id, label, enabled) => ({ id, label, consequence: `${label}.`, command: null, enabled, reason: enabled ? null : 'Not recorded.' })
const base = {
  schema: 'discovery-lab.run-receipt', tag: 'store', title: 'Run', brief: 'Build the deliverable.',
  files: [], sources: {}, scores: null, lineage: null,
  work: { wallHours: 2.1, recordedHours: 0.2, agentHours: 0, idleHours: 0, untracedHours: 0.2, toolCalls: 3, tokens: { fresh: 14673, cached: 0, total: 14926 }, tries: 2 },
  waste: { afterPass: { hours: null, tokens: null, usd: null }, verdictDelay: { minutes: null, refusedChecks: null } },
  timeline: { start: null, end: null, deadline: null, lanes: [], marks: [] },
  versions: { rows: [], line: { x: null, y: [0, 1], marks: [] } },
  cost: { apiEquivalentUsd: { usd: null }, billedUsd: { total: { usd: null } } },
  decisions: [decision('take', 'Take this version', false), decision('continue', 'Continue from this version', false), decision('rerun', 'Rerun the check', false)],
}
const stopped = {
  ...base, runId: 'stopped-run',
  outcome: { status: 'unmeasured', sentence: stopCause, at: '2026-10-16T20:56:19.045Z', reason: 'retained workspace capture pending', class: 'not-run' },
  chosen: { tag: 'store', commit: null, why: 'The Lab ranked the recorded versions.' },
  check: { passed: null, known: false, output: null, commit: null, tag: null, at: null, checker: { path: null, sha256: '31f2316de35368165807958ebece7f5a1ad2021c39fdb77e682526c0e6339ce7' }, inputs: { source: null, sha256: null, count: null }, rerun: null },
}
const released = {
  ...base, runId: 'released-run', tag: 'rc3',
  outcome: { status: 'passed', sentence: 'The check passed on the chosen version.', at: '2026-10-15T13:18:17.431Z', reason: 'budget-exhausted', class: 'work' },
  chosen: { tag: 'rc3', commit, why: 'The play check passed on this version.' },
  check: { passed: true, known: true, output: 'SOLVED', commit, tag: 'rc3', at: '2026-10-15T13:18:17.431Z', checker: { path: 'play-check.mjs', sha256: null }, inputs: { source: null, sha256: null, count: null }, rerun: null },
  files: [{ file: 'jcs.mjs', label: 'Code jcs.mjs' }],
  decisions: [decision('take', 'Take this version', true), decision('continue', 'Continue from this version', true), decision('rerun', 'Rerun the check', false)],
  versions: { rows: [{ tag: 'rc3', commit, at: '2026-10-15T13:18:00+00:00', exactPassed: 1, exactTotal: 1, checks: [{ id: 'play-check', label: 'Play check', result: 'pass' }] }], line: { x: [1792069000000, 1792070000000], y: [0, 1], marks: [] } },
}
const cases = {
  stopped,
  empty: { ...stopped, work: { wallHours: null, recordedHours: null, agentHours: null, idleHours: null, untracedHours: null, toolCalls: null, tokens: { fresh: null, cached: null, total: null }, tries: null }, check: null },
  partial: { ...released, check: null, waste: { afterPass: { hours: 0, tokens: null, usd: null }, verdictDelay: { minutes: null, refusedChecks: 0 } } },
  released,
}
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;')

for (const [name, fixture] of Object.entries(cases)) {
  test(`a ${name} receipt shows its recorded status and sentence in the live and printed views`, () => {
    const receipt = runReceiptSchema.parse(fixture)
    const live = renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: { receipt } }))
    const printed = renderRunReceipt(receipt)
    const word = receipt.outcome.status.replaceAll('-', ' ')
    for (const [view, html] of [['live', live], ['printed', printed]]) {
      assert.equal(html.split('data-field="outcome.status"').length, 2, `${view}: the status appears once`)
      assert.ok(html.includes(`<span data-field="outcome.status">${word}</span>`), `${view}: the recorded status word`)
      assert.match(html, new RegExp(`class="rr-status" data-status="[a-z]+:${word}:(pass|neutral)"`), `${view}: in the status grammar, never red`)
      const sentence = html.indexOf(`<p data-field="outcome.sentence">${escape(receipt.outcome.sentence)}</p>`)
      assert.ok(sentence > 0, `${view}: the recorded sentence`)
      if (view === 'live') assert.ok(!html.includes('<details') || sentence < html.indexOf('<details'), 'live: the sentence is not in a drawer')
    }
    if (name === 'stopped' || name === 'empty') assert.match(live, /RetainedWorkspaceCapturePendingError/)
    if (name === 'released') assert.ok(live.includes('data-field="check.result">Passed on rc3'), 'check.result stays as it was')
  })
}
