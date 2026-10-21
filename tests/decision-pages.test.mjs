// Every decision page opens with its answers (wall redesign v2, design-system sections 3 and 6). The documents are the
// served wall's own, trimmed: the magnetar-rust play and its report, and runs 19f (live, its push to the play repository
// refused, a red blocker), 18b (stopped by the Lab after a stall) and 17c (stopped by the operator), read from
// drew-gtr-pro's /api/discovery on 2026-10-19. The clock is 19f's progress document's, 23:09:05Z.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayHeader, RunOverview } from '../dist/index.js'
import { RUN_TABS, sectionOf } from '../src/workspace/run-tabs.ts'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/magnetar-20261019/${name}`, import.meta.url), 'utf8'))
const play = fixture('play.json')
const report = fixture('report.json')
const run19f = fixture('run-19f.json')
const run18b = fixture('run-18b.json')
const run17c = fixture('run-17c.json')
const now = Date.parse(run19f.progress.generatedAt)

const decode = (text) => text.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
const visible = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const words = (text) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
/** The element that opens at, or whose tag holds, `at` in `html`, through its matching close tag. */
function element(html, at) {
  const index = html[at] === '<' ? at : html.lastIndexOf('<', at)
  const tag = /^<([a-z0-9]+)/.exec(html.slice(index))[1]
  let depth = 0
  for (const match of html.slice(index).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'))) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return html.slice(index, index + match.index + match[0].length)
  }
  return html.slice(index)
}
const elements = (html, attribute) => [...html.matchAll(new RegExp(`<[a-z0-9]+\\b[^>]*(?<![\\w-])${attribute}(?![\\w-])[^>]*>`, 'g'))].map((match) => element(html, match.index))
const RULER = /\bv\d\b|amendment|withheld|superseded|\bgate|checker/i

const playPage = (doc = play) => renderToStaticMarkup(createElement(PlayHeader, { play: doc, report, liveRun: run19f, now }))
const runPage = (doc, extra = {}) => renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc, play, now, ...extra }))

test('the play opens with four answers, each a headline, one figure, a sub-line and a closed drawer', () => {
  const html = playPage()
  const tiles = elements(html, 'data-answer')
  assert.deepEqual(tiles.map((tile) => /data-answer="([^"]+)"/.exec(tile)[1]), ['did-it-work', 'is-it-working', 'what-was-built', 'needs-me'])
  for (const tile of tiles) {
    const slot = /data-answer="([^"]+)"/.exec(tile)[1]
    assert.ok(words(visible(elements(tile, 'data-headline')[0])) <= 8, `${slot} headline`)
    assert.ok(words(visible(elements(tile, 'data-subline')[0])) <= 12, `${slot} sub-line`)
    assert.equal(elements(tile, 'data-num').length + elements(tile, 'data-spark').length, 1, `${slot} has one figure`)
    const drawer = /aria-controls="([^"]+)"/.exec(tile)[1]
    assert.match(html, new RegExp(`<section[^>]*id="${drawer}"[^>]*hidden=""`), `${slot}'s drawer starts closed`)
  }
  const tile = (slot) => visible(tiles.find((item) => item.includes(`data-answer="${slot}"`)))
  assert.match(tile('did-it-work'), /No pass yet 4 \/15 workloads rc16 of 18b, checked once, not published/)
  assert.match(tile('what-was-built'), /Prover, verifier, 15 guest programs 10 crates at rc16 of 18b, no outside crates/)
  assert.match(tile('needs-me'), /act now: discovery-lab \(play repository access\)/)
  // The live run's output, its newest check and its checkpoint clause, due time and "not yet" sit in the Producing drawer.
  const producing = visible(element(html, html.indexOf('data-live=')))
  assert.match(producing, /last output \d+ min ago \((agent event|run activity)\)/)
  assert.match(producing, /Newest check 23:03Z: could not read play repository/)
  assert.match(producing, /T\+6h By T\+6h the workspace's field, hash and parallelism come from vendored audited crates with one… · due 10-20 02:13Z · measured: not yet/)
})

test("the play head is its name and one as-of; the check's words appear only under How the check works", () => {
  const html = playPage()
  assert.equal((html.match(/data-asof/g) ?? []).length, 1)
  const head = html.slice(0, html.indexOf('<div class="answer-strip-wrap"'))
  assert.doesNotMatch(head, /data-status/, 'no status chip in the head')
  assert.match(visible(head), /^magnetar-rust as of 23:08Z$/)
  const how = elements(html, 'data-how')
  assert.equal(how.length, 1)
  assert.match(visible(how[0]), /Check v4 since 10-18 20:52Z \(operator\); 4 versions/)
  assert.match(visible(how[0]), /Releases: \d+ read under v4 \(\d+ check, \d+ gate\)/)
  // Outside it, neither the text nor a tip names a check version, an amendment, a gate or a withheld release.
  const rest = html.replace(how[0], '')
  assert.doesNotMatch(visible(rest), RULER)
  for (const [, tip] of rest.matchAll(/title="([^"]*)"/g)) assert.doesNotMatch(decode(tip), RULER, tip)
  const first = visible(elements(html, 'data-answer')[0]).split('.')[0]
  assert.doesNotMatch(first, RULER)
})

test('the bar rows state their distance as words, and a value that does not count says why', () => {
  const html = playPage()
  assert.match(visible(html), /Proving rate 202K cycles\/s of 7\.2M–8\.7M cycles\/s · rc14: not comparable: 1-bit declared/)
  assert.match(visible(html), /Verify time 319 ms of 11–13 ms · rc16: failing candidate \(4\/15\)/)
})

test('19f opens with its name, one status, one as-of and four slots, one clock, and its start point in neutral', () => {
  const html = runPage(run19f)
  const fold = element(html, html.indexOf('data-fold'))
  assert.ok(words(visible(/<h1[^>]*>.*?<\/h1>/.exec(fold)[0])) <= 6)
  assert.match(fold, /<h1>Run 19f<\/h1>/)
  assert.deepEqual([...fold.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]), ['state', 'best', 'blocker', 'output'])
  assert.ok(words(visible(elements(fold, 'data-slot="state"')[0])) <= 18)
  assert.equal((html.match(/data-asof/g) ?? []).length, 1)
  assert.equal((visible(html).match(/last output/g) ?? []).length, 1, 'one liveness clock')
  assert.doesNotMatch(visible(html), /last activity|\d+ s ago|last agent stream/)
  const start = visible(elements(fold, 'data-start-point')[0])
  assert.match(start, /^Start point \(rc102\) re-checked: 6\/15 at stage 5, unverified \(lz4-decode over 300 s\)$/)
  assert.doesNotMatch(elements(fold, 'data-start-point')[0], /data-status/)
  assert.match(visible(elements(fold, 'data-slot="blocker"')[0]), /act now Check host: discovery-lab \(play repository access\)/)
  // No hash above the fold: the checker's digest is under Data and method.
  assert.doesNotMatch(visible(fold), /\b[0-9a-f]{8,}\b/)
  assert.doesNotMatch(visible(fold), /Checker SHA-256/)
})

test('18b names one ending, the same in its pill and its sentence, and credits no fix to an older release', () => {
  const html = runPage(run18b)
  const fold = element(html, html.indexOf('data-fold'))
  const pill = /data-status="run:([^":]+):neutral"/.exec(fold)[1]
  assert.equal(pill, 'Stopped by Lab (stall)')
  const state = visible(elements(fold, 'data-slot="state"')[0])
  assert.match(state, /^Stopped by Lab \(stall\) at 10-19 03:27Z after 26\.1 h, when nothing streamed for 15 min\.$/)
  assert.doesNotMatch(visible(fold), /cancelled|operator stopped|Stopped by operator|STUCK|quota/i)
  assert.doesNotMatch(fold, /:fail"/, 'nothing alarm-toned above the fold')
  assert.match(visible(elements(fold, 'data-slot="best"')[0]), /rc16: 4 of 15 workloads/)
  const rows = [...html.matchAll(/<tr data-field="contract\.\d+">.*?<\/tr>/g)].map((match) => match[0])
  const tags = rows.map((row) => [Number(/data-sent-tag="rc(\d+)"/.exec(row)[1]), Number(/data-fixed-tag="rc(\d+)"/.exec(row)?.[1] ?? NaN)])
  assert.deepEqual(tags.filter(([, fix]) => fix).map(([sent, fix]) => `rc${sent}→rc${fix}`), ['rc1→rc2', 'rc2→rc3', 'rc3→rc5', 'rc3→rc5', 'rc14→rc16'])
  assert.deepEqual(rows.filter((row) => row.includes('not fixed by a later release')).map((row) => /data-sent-tag="(rc\d+)"/.exec(row)[1]), ['rc15', 'rc16'])
  // The page once read "Fixed in 48a3930a (rc14)" on a line sent on rc16: a fix credited to an older release is no fix.
  const credited = { ...run18b, receipt: { ...run18b.receipt, contract: run18b.receipt.contract.map((line) => (line.tag.endsWith('/rc16') ? { ...line, fixCommit: '48a3930a69b90b314c9b2ac0b42ba6fe18633dee', resolvedOn: 'magnetar-rust-20261018b/rc14', resolvedAt: '2026-10-18T23:00:00.000Z' } : line)) } }
  const older = [...runPage(credited).matchAll(/<tr data-field="contract\.\d+">.*?<\/tr>/g)].map((match) => match[0]).find((row) => row.includes('data-sent-tag="rc16"'))
  assert.match(visible(older), /not fixed by a later release/)
  assert.doesNotMatch(older, /data-fixed-tag/)
  // A run newer runs of its play continued offers no rerun of its check.
  assert.doesNotMatch(visible(html), /Rerun the check/)
})

test('17c names the run that continued it, and offers no rerun', () => {
  const lineage = { ...play, runs: play.runs.map((run) => (run.id === 'magnetar-rust-20261018b' ? { ...run, forkedFrom: 'magnetar-rust-20261017c' } : run)) }
  const html = runPage(run17c, { play: lineage })
  assert.match(visible(html), /Continued as magnetar-rust-20261018b/)
  assert.match(visible(elements(html, 'data-slot="blocker"')[0]), /None open ended .* ago · continued in 18b/)
  assert.doesNotMatch(visible(html), /Rerun the check/)
})

test("five run tabs, and every old ?section= link still opens its view", () => {
  assert.deepEqual(RUN_TABS.map((tab) => tab.label), ['Now', 'Built', 'Conversations', 'Findings', 'How it ran'])
  const at = (query) => sectionOf(new URLSearchParams(query))
  for (const old of ['findings', 'agents', 'spend', 'readout', 'outputs', 'graph', 'versions', 'profiles', 'assessments', 'input', 'coverage']) assert.equal(at(`section=${old}`), old)
  assert.equal(at('section=progress'), null)
  assert.equal(at('section=built'), 'versions')
  assert.equal(at('section=how'), 'spend')
  assert.equal(at('view=outputs'), 'outputs')
  assert.equal(at('node=x'), 'agents')
})
