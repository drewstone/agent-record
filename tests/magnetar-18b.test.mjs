// magnetar-rust-20261018b as the wall served it on 2026-10-19 (agent-record 0.49.3): the run page showed no token total,
// and its receipt said "rc14 passed under checker a3cf95c7 1×" for three passes under v3. The fixtures are the served
// run document, receipt and magnetar-rust play document, trimmed to what these pages read and with host paths scrubbed.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunOverview, RunReceiptView, runDocumentSchema, runReceiptSchema } from '../dist/index.js'

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/magnetar-rust-20261018b/${name}`, import.meta.url), 'utf8'))
const run = runDocumentSchema.parse(await fixture('run.json'))
const receipt = runReceiptSchema.parse(await fixture('receipt.json'))
const play = await fixture('play.json')
const text = (html) => html.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')

test('the run page shows the run token total from the record, cache read apart', () => {
  // The record's rollup over its 15 agents; the root alone holds 50.2M in.
  assert.deepEqual(run.spend.tokens, { input: 62499149, output: 1354970, cacheRead: 963086784, cacheWrite: 0 })
  const words = text(renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: run })))
  assert.match(words, /Run tokens62\.5M in · 1\.35M out · 963M cache read/)
})

test('the receipt names the checker as the play page does and counts every pass', () => {
  // The play page's v3 is a3cf95c7; the run document's check carries the same names by digest prefix.
  assert.equal(play.checkers.find((checker) => checker.sha256.startsWith('a3cf95c7')).label, 'v3')
  for (const name of run.run.check.checkerNames) assert.equal(name.label, play.checkers.find((checker) => checker.sha256.startsWith(name.sha256)).label)
  const page = (props) => text(renderToStaticMarkup(createElement(RunReceiptView, { api: '/api/discovery', receipt, print: true, outcome: run.progress.outcome, ...props })))
  const words = page({ check: run.run.check, tokens: run.spend.tokens })
  assert.match(words, /Nothing passes the current check \(v4, operator amendment 10-18 20:52Z\); rc14 passed under v3 3×, 20:14 UTC–20:46 UTC/)
  assert.doesNotMatch(words, /a3cf95c7/)
  // No dispute digest: the disputes are their lines, times and rulings.
  for (const dispute of run.progress.outcome.disputes) if (dispute.id) assert.ok(!words.includes(dispute.id), dispute.id)
  assert.match(words, /Run tokens62\.5M in · 1\.35M out · 963M cache read/)
  // Without the run document the receipt's own score rows still count all three passes.
  assert.match(page({}), /rc14 passed under checker a3cf95c7 3×, 20:14 UTC–20:46 UTC/)
})
