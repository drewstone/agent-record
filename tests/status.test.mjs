// One status grammar (design-system section 1, v2 tone rule): red only for "a person must act now", which is a crit
// attention item or a live run's blocker with severity red. The documents below are the served wall's own, trimmed:
// the magnetar-rust play (10-20, one run live, no blocker), 18b (stalled, then stopped) and 17c (cancelled, ten agents
// recorded down), read from drew-gtr-pro's /api/discovery on 2026-10-20.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { agentSpendRows, AgentTable, FinalOutputPanel, finalOutputSchema, parseRecord, PlayHeader, RunOverview, newerStarted, runReceiptSchema, SpendBars, StatusPill, statusOf } from '../dist/index.js'
import { indexRecord } from '../src/viewer/model.ts'

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

test('the play header renders no red while nothing needs a person, and red only inside the live box for a red blocker', () => {
  assert.equal(play.live.blocker, null)
  const calm = renderToStaticMarkup(createElement(PlayHeader, { play }))
  assert.deepEqual(statuses(calm).filter((status) => status.endsWith(':fail')), [])
  assert.ok(statuses(calm).includes('run:Running 3.1 h:attention'), 'the live run is amber')
  assert.match(visible(calm), /No pass yet/)
  assert.doesNotMatch(visible(calm), /NOT SOLVED|withheld/)

  const blocker = { class: 'check-infra', severity: 'red', since: '2026-10-20T03:00:00Z', evidence: 'the check host refused the push', owner: 'Lab operator' }
  const red = renderToStaticMarkup(createElement(PlayHeader, { play: { ...play, live: { ...play.live, blocker } } }))
  const live = red.slice(red.indexOf('data-live='), red.indexOf('</section>', red.indexOf('data-live=')))
  assert.deepEqual(marks(red).filter((status) => status.endsWith(':fail')), ['alert:act now:fail'])
  assert.ok(statuses(live).includes('alert:act now:fail'), 'the fail mark sits inside [data-live]')
  assert.match(live, /act now: Lab operator/, 'the fail mark names its owner in its own text')

  // The same red blocker on a run that has ended is past: neutral.
  const ended = { ...play, live: null, standing: { ...play.standing, lastEnding: { runId: 'magnetar-rust-20261019f', run: '19f', word: 'cancelled', at: '2026-10-19T23:10:41Z', blocker } } }
  assert.deepEqual(statuses(renderToStaticMarkup(createElement(PlayHeader, { play: ended }))).filter((status) => status.endsWith(':fail')), [])
})

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

test("the receipt's turn endings: platform loss is the hollow crash square, neutral once settled and red only for a live red blocker", () => {
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
  assert.match(visible(settled.section), /□\s+Platform lost the turn/)
  assert.deepEqual(statuses(settled.html).filter((status) => status.endsWith(':fail')), [])

  const amber = causes({ phase: 'running', final: false, blocker: { class: 'stuck-turn', severity: 'amber' } })
  assert.ok(amber.rows.includes('cause:Quota hit:attention'), 'a live run hitting quota is blocked: amber')
  assert.ok(amber.rows.includes('cause:Platform lost the turn:neutral'))

  const red = causes({ phase: 'running', final: false, blocker: { class: 'stuck-turn', severity: 'red', owner: 'discovery-lab' } })
  // Red only while a live run is blocked red, and the mark names who must act.
  assert.deepEqual(red.rows.filter((status) => status.endsWith(':fail')), ['cause:Platform lost the turn · act now: discovery-lab:fail'])
  assert.match(visible(red.section), /□\s+Platform lost the turn · act now: discovery-lab/)
})
