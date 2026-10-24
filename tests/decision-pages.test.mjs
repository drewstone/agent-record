// Every decision page opens with its answers (change 4, v2). The documents are trimmed copies of what the wall served on
// 2026-10-19 at 23:08Z (/home/drew/reviews-mirror/ui-review-20261019/api): the magnetar-rust play and its report while
// 19f ran with a red push refusal, and runs 19f (live), 18b (stopped by the Lab after a stall) and 17c (stopped by the
// operator, continued as 18b). The 10-20 play document is the one that serves change 1's `standing.answer`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayHeader, RUN_TABS, RunFold, RunOverview, RunTabBar, RunWhy, sectionOf, tabOf } from '../dist/index.js'

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

test('the play page opens with four answers, each a headline, one figure, a sub-line and a closed drawer', () => {
  const html = renderToStaticMarkup(createElement(PlayHeader, { play, report, now: COMPOSED }))
  const found = tiles(html)
  // v2 replaces v1's five slots: what-next moves into the Producing drawer.
  assert.deepEqual(found.map((tile) => tile.slot), ['did-it-work', 'is-it-working', 'what-was-built', 'needs-me'])
  for (const tile of found) {
    assert.ok(words(field(tile.body, 'headline')).length <= 8, `${tile.slot} headline: ${field(tile.body, 'headline')}`)
    assert.ok(words(field(tile.body, 'subline')).length <= 12, `${tile.slot} sub-line: ${field(tile.body, 'subline')}`)
    assert.equal((tile.body.match(/data-num|data-spark/g) ?? []).length, 1, `${tile.slot} has exactly one figure`)
    assert.match(tile.drawer, /hidden=""/, `${tile.slot}'s drawer starts closed`)
  }
  const [solved, , built, needs] = found
  assert.match(built.text, /crates/)
  assert.match(built.text, /Prover, verifier, 15 guest programs/)
  assert.match(needs.text, /discovery-lab \(play repository access\)/)
  assert.match(needs.text, /1 needs you now/)
  const first = solved.text.split(/[.]/)[0]
  assert.doesNotMatch(first, RULER, first)

  // The head is the h1 and one as-of: no status chip before the answers.
  assert.equal((html.match(/data-asof/g) ?? []).length, 1)
  assert.doesNotMatch(html.slice(0, html.indexOf('answer-strip')), /data-status=/)
  // Ruler words live only inside "How the check works", tips and closed drawers included.
  const outside = html.replace(/<details class="check-works".*?<\/details>/s, '')
  const tips = [...outside.matchAll(/title="([^"]*)"/g)].map((match) => match[1]).join(' ')
  assert.doesNotMatch(`${visible(outside)} ${tips}`, RULER)
  assert.match(html, /<details class="check-works"[^>]*><summary>How the check works<\/summary>.*Check v4 since 10-18 20:52Z \(operator\); 4 versions/s)
  // The checkpoint's clause, due time and "not measured yet" moved into the Producing drawer.
  assert.match(visible(html), /Next checkpoint · T\+6h By T\+6h the workspace's field.* · due 10-20 02:13Z · measured: not yet/)
})

test("change 1's served answers lead the tiles when the play serves them", () => {
  const served = fixture('discovery-play-magnetar-rust.json')
  const html = renderToStaticMarkup(createElement(PlayHeader, { play: served, report: fixture('play-report-magnetar-rust.json'), now: Date.parse('2026-10-20T04:58:55Z') }))
  const [solved, producing, , needs] = tiles(html)
  assert.equal(solved.text, 'Solved? Not yet 8 /15 workloads rc1 of 20b, checked once')
  assert.equal(producing.text, 'Producing? Writing code, no release yet 9 commits newest commit 04:51Z · 3.1 h in')
  assert.equal(needs.text, 'Needs you Nothing needs you now 0 no blocker on 20b')
  // The measurement noise is served, so "How the check works" carries it.
  assert.match(visible(html), /Measurement: Check spread on one commit: 0–6 of 15 over 10 reruns/)
})

/** A run page's overview as Workspace composes it: the fold, the closed "Why it stopped", then the receipt. */
function runPage(id) {
  const doc = run(id)
  // The page's clock is its as-of: the newest composition the run document carries.
  const now = Math.max(Date.parse(doc.progress.generatedAt), Date.parse(doc.receipt.generatedAt ?? doc.progress.generatedAt))
  const fold = renderToStaticMarkup(createElement(RunFold, { doc, play, now }))
  const rest = renderToStaticMarkup(createElement('div', null, createElement(RunWhy, { doc, play }), createElement(RunOverview, { api: '/api/discovery', doc, play })))
  return { doc, fold, rest, html: fold + rest }
}

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
