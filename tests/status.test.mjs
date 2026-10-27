// One status grammar (design-system section 1, v2 tone rule): red only for "a person must act now", which is a crit
// attention item or a live run's blocker with severity red. The documents below are the served wall's own, trimmed:
// the magnetar-rust play (10-20, one run live, no blocker), 18b (stalled, then stopped) and 17c (cancelled, ten agents
// recorded down), read from drew-gtr-pro's /api/discovery on 2026-10-20.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { agentSpendRows, AgentTable, FinalOutputPanel, finalOutputSchema, parseRecord, RunOverview, newerStarted, runReceiptSchema, SpendBars, StatusPill, statusOf } from '../dist/index.js'
import { indexRecord } from '../src/viewer/model.ts'
import { checkVerdict } from '../src/workspace/run/model.ts'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const play = fixture('discovery-play-magnetar-rust.json')
const run18b = fixture('discovery-run-magnetar-rust-20261018b.json')
const run17c = fixture('discovery-run-magnetar-rust-20261017c.json')
const statuses = (html) => [...html.matchAll(/data-status="([^"]*)"/g)].map((match) => match[1])
// A status row and the pill inside it carry the same data-status (the row's bar takes its ink from it): one mark each.
const marks = (html) => [...new Set(statuses(html))]
// The pills only: one per agent row, though each row's lane bar repeats its status.
const pills = (html) => [...html.matchAll(/class="state-pill[^"]*" data-status="([^"]*)"/g)].map((match) => match[1])
// The words a reader sees: text outside tags, so hover titles and the host's verbatim check lines stay out.
const visible = (html) => html.replace(/<[^>]*>/g, ' ')

// The tile and its drawer for one answer slot: the strip renders tiles first, then each slot's drawer.
const drawerOf = (html, slot) => {
  const start = html.indexOf(`data-drawer-for="${slot}"`)
  const next = html.indexOf('data-drawer-for="', start + 1)
  return html.slice(start, next < 0 ? html.indexOf('</section>', start) : next)
}

test("a cancelled run's agent rows read Ended in neutral, though eight of its agents were recorded down", () => {
  const record = parseRecord(run17c.record)
  assert.equal(record.nodes.filter((node) => node.status === 'down').length, 8)
  const html = renderToStaticMarkup(
    createElement(AgentTable, { index: indexRecord(record), stats: run17c.record.nodeStats, doc: run17c, assessments: [], dimensions: new Map(), selected: null, onSelect: () => {} }),
  )
  const rows = pills(html)
  assert.equal(rows.length, record.nodes.filter((node) => node.kind !== 'finding').length)
  assert.ok(statuses(html).every((status) => status === 'agent:Ended:neutral'), statuses(html).join(', '))
})

test('a driver-failed run settled days ago reads Crashed, neutral, with the past-crash square', () => {
  const crashes = play.runs.filter((run) => run.state === 'driver-failed').sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt))
  const crashed = crashes[0]
  // The fixture clock: the live run's start, the newest moment the served play document records.
  const now = Date.parse(play.live.startedAt)
  assert.ok(now - Date.parse(crashed.settledAt) > 2 * 24 * 3_600_000, 'a crash days old, with newer runs started')
  const runStatus = (run, extra = {}) => statusOf({ axis: 'run', state: run.state, reason: run.reason, stopCause: run.stopCause, endedAt: run.settledAt, newerStarted: newerStarted(run, play.runs), now, ...extra })
  for (const run of crashes) {
    const status = runStatus(run)
    assert.deepEqual([status.word, status.tone, status.shape], ['Crashed (driver)', 'neutral', '□'])
  }
  const status = runStatus(crashed)
  const html = renderToStaticMarkup(createElement(StatusPill, { status }))
  assert.match(html, /data-status="run:Crashed \(driver\):neutral"/)
  assert.match(html, /□/)

  // The same crash is red only in its first 24 h and only while nothing has run since, and it names who acts.
  const fresh = Date.parse(crashed.settledAt) + 3_600_000
  const red = runStatus(crashed, { now: fresh, newerStarted: false })
  assert.deepEqual([red.tone, red.shape], ['fail', '■'])
  assert.match(red.word, /^Crashed \(driver\) · act now: /)
  assert.equal(runStatus(crashed, { now: fresh, newerStarted: true }).tone, 'neutral')
  assert.equal(runStatus(crashed, { now: fresh }).tone, 'neutral', 'a caller that cannot tell whether a newer run started reads the crash as past')
})

test("18b's spend ledger prints each known amount and one line for every source not recorded", () => {
  const agents = run18b.progress.agents.map((agent) => ({ id: agent.node, label: agent.label }))
  const known = Object.values(run18b.spend.nodes).filter((spend) => spend.listUsd !== null).length
  assert.ok(known >= 6, `${known} agents with a known amount`)
  const html = renderToStaticMarkup(createElement(SpendBars, { rows: agentSpendRows(run18b.spend.nodes, agents), why: 'no per-agent meter' }))
  assert.equal((html.match(/API-equivalent<\/small>/g) ?? []).length, known)
  assert.equal((html.match(/Not recorded/g) ?? []).length, 1)
  assert.match(html, new RegExp(`Not recorded for ${agents.length} agents: subscription, API, sandbox \\(no per-agent meter\\)`))
  assert.doesNotMatch(html, /unknown/)
})

test("18b's readout is pending for an hour after it settled, then says no readout was written and how the run ended", () => {
  const readout = { status: 'pending', generatedAt: null, settle: null, summary: null, deliverables: [], verdicts: [], judges: [],
    links: { report: null, dossier: null, gist: null }, cost: { readoutUsd: null, runUsd: null }, error: null }
  const output = finalOutputSchema.parse({ declared: null, status: 'none-declared', checkedAt: null, files: [], rootOutput: null, readout })
  const settled = Date.parse(run18b.run.settledAt)
  const at = (now) => visible(renderToStaticMarkup(createElement(FinalOutputPanel, { output, run: run18b.run, now })))
  assert.match(at(settled + 10 * 60_000), /Readout pending/)
  const late = at(settled + 21 * 3_600_000)
  assert.doesNotMatch(late, /Readout pending/)
  assert.match(late, /No readout was written: the run was stopped by Lab \(stall\) 03:27Z\./)
})

test("the receipt's turn endings: platform loss is a hollow triangle: neutral once settled, amber while live, red only for a live red blocker", () => {
  // 18b's served receipt.system.attempts (api/runs/magnetar-rust-20261018b, 2026-10-19), on the contract-loop receipt.
  const attempts = { tries: 324, failed: 240, hours: 60.38, failedHours: 44.45, causes: [
    { cause: 'completed', label: 'completed', tries: 84, hours: 15.93 },
    { cause: 'platform-lost', label: 'platform lost or killed the turn', tries: 14, hours: 12.35 },
    { cause: 'rate-limited', label: 'a 429 killed the turn', tries: 219, hours: 12.13 },
    { cause: 'budget-exhausted', label: 'supervisor budget exhausted', tries: 2, hours: 4.34 },
    { cause: 'stopped', label: 'stopped by the Lab or an operator', tries: 5, hours: 15.63 },
  ] }
  const base = JSON.parse(readFileSync(new URL('./fixtures/run-receipt-contract-loop.json', import.meta.url), 'utf8'))
  const receipt = runReceiptSchema.parse({ ...base, system: { ...(base.system ?? {}), attempts } })
  const causes = (progress) => {
    const html = renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: { receipt, progress } }))
    const section = html.slice(html.indexOf('Where turns ended'))
    return { html, section, rows: marks(section.slice(0, section.indexOf('</ul>'))) }
  }
  const settled = causes({ phase: 'settled', final: true, endBlocker: { class: 'stuck-turn', severity: 'red' } })
  assert.match(visible(settled.section), /Where turns ended/)
  assert.doesNotMatch(settled.html, /Why turns failed/)
  assert.deepEqual(settled.rows, ['cause:Platform lost the turn:neutral', 'cause:Quota hit:neutral', 'cause:Stopped by Lab (budget):neutral', 'cause:Stopped by Lab or operator:neutral'])
  assert.match(visible(settled.section), /△\s+Platform lost the turn/)
  assert.deepEqual(statuses(settled.html).filter((status) => status.endsWith(':fail')), [])

  const amber = causes({ phase: 'running', final: false, blocker: { class: 'stuck-turn', severity: 'amber' } })
  assert.ok(amber.rows.includes('cause:Quota hit:attention'), 'a live run hitting quota is blocked: amber')
  assert.ok(amber.rows.includes('cause:Platform lost the turn:attention'), 'a live run losing turns to the platform is blocked: amber')

  const red = causes({ phase: 'running', final: false, blocker: { class: 'stuck-turn', severity: 'red', owner: 'discovery-lab' } })
  // Red only while a live run is blocked red, and the mark names who must act.
  assert.deepEqual(red.rows.filter((status) => status.endsWith(':fail')), ['cause:Platform lost the turn · act now: discovery-lab:fail'])
  assert.match(visible(red.section), /△\s+Platform lost the turn · act now: discovery-lab/)
})

// WCAG 1.4.1: colour is never the only signal. Every element carrying data-status prints a statusOf shape in its own text.
const SHAPES = /[✓□⊘⏸▶·○▲△◌■●✕*?]/
function markTexts(html) {
  const out = []
  for (const open of html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-status="([^"]*)"[^>]*>/g)) {
    const tag = open[1]
    const start = open.index + open[0].length
    let depth = 1
    let end = html.length
    for (const next of html.slice(start).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'))) {
      depth += next[1] ? -1 : 1
      if (depth === 0) {
        end = start + next.index
        break
      }
    }
    out.push({ status: open[2], text: html.slice(start, end).replace(/<[^>]*>/g, '') })
  }
  return out
}

// Run 22a, 10-27 17:51Z: rc14 passed all six steps under a checker whose four stages have no known-good fixture. The run's
// one check verdict (Overview's Check card and the Checks tab) says it is held, never that it failed.
test('a release that passed an uncalibrated checker is held, not failed', () => {
  const latest = { tag: 'rc14', known: true, solved: false, line: 'SOLVED: 15 RV64I workloads …' }
  const calibration = { state: 'uncalibrated', uncalibrated: ['guests', 'hidden', 'keys', 'workloads'] }
  const held = checkVerdict({ latest, held: { tag: 'rc14' }, calibration })
  assert.equal(held.word, 'Held')
  assert.match(held.note, /rc14 passed; it counts once guests, hidden, keys and workloads have a known-good fixture/)
  assert.equal(checkVerdict({ latest, calibration }).word, 'Not solved')
  assert.equal(checkVerdict({ latest: { ...latest, solved: true } }).word, 'Passed')
  assert.equal(checkVerdict({ latest: { known: false, solved: false } }).word, 'No verdict')
  assert.equal(checkVerdict(null).word, 'Not checked')
})
