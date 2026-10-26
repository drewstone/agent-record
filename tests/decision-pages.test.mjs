// Every decision page opens with its answers (change 4, v2). The documents are trimmed copies of what the wall served on
// 2026-10-19 at 23:08Z (/home/drew/reviews-mirror/ui-review-20261019/api): the magnetar-rust play and its report while
// 19f ran with a red push refusal, and runs 19f (live), 18b (stopped by the Lab after a stall) and 17c (stopped by the
// operator, continued as 18b). The 10-20 play document is the one that serves change 1's `standing.answer`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RUN_TABS, RunOverview, RunTabBar, RunWhy, sectionOf, tabOf } from '../dist/index.js'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const play = fixture('decide-play-magnetar-rust-20261019.json')
const report = fixture('decide-play-report-magnetar-rust-20261019.json')
const run = (id) => fixture(`decide-run-magnetar-rust-202610${id}.json`)
const COMPOSED = Date.parse('2026-10-19T23:08:30Z')

const visible = (html) => html.replace(/<[^>]*>/g, ' ').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim()
// A body word: a whitespace token holding a letter or digit.
const words = (text) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
const RULER = /\bv\d\b|amendment|withheld|superseded|\bgate\b/i

/** Each `[data-answer]` tile: its slot, its markup, and the drawer its button controls. */
function tiles(html) {
  return [...html.matchAll(/<div class="answer-tile" data-answer="([^"]+)"[^>]*>(.*?)<\/button><\/div>/g)].map(([, slot, body]) => {
    const controls = /aria-controls="([^"]+)"/.exec(body)?.[1]
    const drawer = new RegExp(`<div id="${controls}"[^>]*>`).exec(html)?.[0] ?? ''
    return { slot, body, text: visible(body.replace(/<button.*$/s, '')), drawer }
  })
}
const field = (body, name) => visible(new RegExp(`<[^>]*data-${name}[^>]*>(.*?)</(?:b|span)>`).exec(body)?.[1] ?? '')

test('a run a newer run continued offers no rerun of its check and links forward instead', () => {
  for (const [id, next] of [['17c', '18b'], ['18b', '19f']]) {
    const { doc, html } = runPage(id)
    const rerun = doc.receipt.decisions.find((decision) => decision.id === 'rerun')
    if (rerun) assert.ok(!visible(html).includes(rerun.label), `${id} offers no "${rerun.label}"`)
    assert.match(html, new RegExp(`data-continued-as="magnetar-rust-202610${next}">Continued as <a href="/run/magnetar-rust-202610${next}">${next}</a>`))
  }
  // A live run nothing continued keeps its controls.
  assert.match(visible(runPage('19f').html), /Decide Wrap up/)
})

test('the run page has five tabs and every older section link lands on the tab that holds it', () => {
  const html = renderToStaticMarkup(createElement(RunTabBar, { section: 'versions', counts: { findings: 3 }, onOpen: () => {} }))
  assert.equal((html.match(/role="tab"/g) ?? []).length, 5)
  assert.deepEqual(RUN_TABS.map((tab) => tab.label), ['Now', 'Built', 'Conversations', 'Findings', 'How it ran'])
  assert.match(html, /aria-selected="true" data-section-tab="built"/)
  assert.match(html, /<select/)
  const legacy = { findings: 'findings', progress: 'now', agents: 'agents', spend: 'how', readout: 'built', outputs: 'built', graph: 'how', versions: 'built', profiles: 'how', assessments: 'how', input: 'how', coverage: 'how' }
  for (const [section, tab] of Object.entries(legacy)) assert.equal(tabOf(sectionOf(new URLSearchParams({ section }))), tab, section)
  assert.equal(tabOf(sectionOf(new URLSearchParams({ view: 'outputs' }))), 'built')
  assert.equal(tabOf(sectionOf(new URLSearchParams({ node: 'magnetar-rust-20261019f:s3' }))), 'agents')
})
