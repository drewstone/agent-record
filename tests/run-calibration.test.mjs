// Who ruled, what is calibrated, and a held pass in neutral. The run and overview documents are the ones tangle-tools
// served in its own test of this change (tangle-tools #1562, 3b4faa91,
// test_needs_you_asks_drew_to_rule_undecided_disputes_and_calibrate_held_passes_on_any_run), recorded from its served
// /api/discovery on 2026-10-20; the overview drops only its 260 KB `seats` history. Those test runs have no Lab receipt,
// so each page borrows test-contract-loop-20261018c's recorded receipt, as run-now.test.mjs does.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NeedsYou, RunOverview, runReceiptSchema } from '../dist/index.js'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const receipt = runReceiptSchema.parse(fixture('run-receipt-contract-loop.json'))
const page = (name) => {
  const doc = fixture(name)
  return { doc, html: renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: { ...doc, receipt } })) }
}
const now = (html) => html.slice(html.indexOf('data-section="now"'), html.indexOf('rr-columns'))
const text = (html) => html.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
const statuses = (html) => [...html.matchAll(/data-status="([^"]*)"/g)].map((match) => match[1])

test('a held pass reads as held in neutral, with no fail tone anywhere on its run page', () => {
  const { doc, html } = page('discovery-run-codeplay-20261020c.json')
  assert.equal(doc.progress.outcome.solved, false, 'the Lab writes a held pass solved: false')
  assert.equal(doc.progress.outcome.latestCheck.uncalibratedPass, true)
  assert.match(text(now(html)), /Now○ check passed; held: stages workloads, hidden have no known-good fixture/)
  assert.ok(statuses(now(html)).includes('result:Passed, held:neutral'), statuses(now(html)).join(', '))
  assert.deepEqual(statuses(html).filter((status) => status.endsWith(':fail')), [])
  assert.doesNotMatch(html, /rr-now-failing/)
  assert.doesNotMatch(text(now(html)), /No pass yet|Nothing passes the current check/)
})

test('each stage of the check shows its calibration as a neutral label', () => {
  const { doc, html } = page('discovery-run-codeplay-20261020c.json')
  const stages = doc.run.check.calibration.stages
  assert.equal(stages.length, 4)
  for (const stage of stages) assert.match(html, new RegExp(`data-calibration="${stage.name}:${stage.state}"[^>]*>${stage.name} ${stage.state}<`))
  const calibration = html.slice(html.indexOf('data-field="run.check.calibration"'))
  assert.doesNotMatch(calibration.slice(0, calibration.indexOf('</p>')), /data-status/, 'a calibration label is not a status')
  // A run pressed before the Lab registered calibration reads unknown and names the record that would state it.
  const bare = page('discovery-run-codeplay-20261020a.json')
  assert.equal(bare.doc.run.check.calibration.state, 'unknown')
  assert.match(bare.html, /data-calibration="check:unknown"/)
  assert.match(text(bare.html), /calibration not recorded: the run was pressed before the Lab registered calibration \(discovery-lab #2225\); run-input\.json acceptance\.play\.calibration would state it/)
})

test('an undecided dispute shows its ruling sentence and its referees, and is one line in Needs you', () => {
  const { html } = page('discovery-run-codeplay-20261020b.json')
  const words = text(html)
  assert.match(words, /Disputed 17:18 UTC as c309bb08b9afUnverified: its referees disagree, so the line stands as pinned until an operator rulesReferees: anthropic\/claude-opus-5-5 \(claude\) rejected; openai\/gpt-6\.1-sol \(codex\) unverified/)
  assert.match(words, /Rejected by the referee at 15:44 UTC: the line standsReferees: anthropic\/claude-opus-5-5 \(claude\) rejected; openai\/gpt-6\.1-sol \(codex\) rejected/)
  assert.doesNotMatch(words, /State not recorded/)

  // Needs you prints the host's line in the grammar (hostWords): its "undecided" reads "unverified", as on the run page.
  const { attention } = fixture('discovery-overview-codeplay.json')
  const card = renderToStaticMarkup(createElement(NeedsYou, { attention }))
  const lines = [...card.matchAll(/<li>(.*?)<\/li>/g)].map((match) => text(match[1]))
  assert.equal(lines.filter((line) => line.includes('codeplay 20b: check dispute c309bb08b9af is unverified')).length, 1)
  assert.equal(lines.filter((line) => line.includes('codeplay 20c: check passed; held: stages workloads, hidden have no known-good fixture')).length, 1)
  assert.ok(lines.some((line) => line.includes('(anthropic/claude-opus-5-5 (claude) rejected; openai/gpt-6.1-sol (codex) unverified)')))
  assert.deepEqual(statuses(card).filter((status) => status.endsWith(':fail')), [], 'neither is a system fault')
})
