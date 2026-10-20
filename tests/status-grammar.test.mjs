// One status grammar: red only for a fault happening now that a person can act on. The documents are the host's own
// (drew-gtr-pro, 2026-10-20 00:15Z), trimmed to the fields these surfaces read: the magnetar-rust play while run 20a was
// live, and runs 18b (cancelled after a stall, 10 of 15 agents down) and 17c (cancelled under check v1).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentTable, PlayHeader, SpendBars, StatusPill, agentSpendRows, indexRecord, newerRunOf, statusOf } from '../dist/index.js'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const PLAY = fixture('plays_magnetar-rust.json')
const RUN_18B = fixture('runs_magnetar-rust-20261018b.json')
const RUN_17C = fixture('runs_magnetar-rust-20261017c.json')
const NODES_18B = fixture('record-nodes_magnetar-rust-20261018b.json')
// The fixture clock: when the host composed the play document, the live run's start plus its elapsed time.
const CLOCK = Date.parse(PLAY.live.startedAt) + PLAY.live.elapsedMs
const DAY = 86_400_000
/** The nodes part as the workspace indexes it: a node without a parent is a root. */
const nodesIndex = () => indexRecord({ ...structuredClone(NODES_18B), nodes: NODES_18B.nodes.map((node) => ({ parent: null, ...node })) })

/**
 * Every `data-status` in the markup, with whether a `data-live` element contains it and its `data-owner`. The live
 * element ends at its matching close tag, found by counting nested tags of the same name, not at the first close.
 */
function statuses(html) {
  const open = /<(\w+)[^>]*\sdata-live="[^"]*"[^>]*>/.exec(html)
  let live = null
  if (open) {
    const tag = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, 'g')
    tag.lastIndex = open.index + open[0].length
    for (let depth = 1, match; depth && (match = tag.exec(html)); ) if (!(depth += match[1] ? -1 : 1)) live = [open.index, match.index]
    assert.ok(live, 'the live element closes')
  }
  const out = []
  for (const match of html.matchAll(/<[^>]*\sdata-status="([^"]*)"[^>]*>/g)) {
    const at = html.indexOf('data-status=', match.index)
    out.push({ status: match[1], owner: /\sdata-owner="([^"]*)"/.exec(match[0])?.[1] ?? null, inLive: !!live && at > live[0] && at < live[1] })
  }
  return out
}

test("a play header has no fail status except a live run's red blocker", () => {
  const marks = statuses(renderToStaticMarkup(createElement(PlayHeader, { play: PLAY })))
  assert.ok(marks.length > 0, 'the header marks its statuses')
  const allowed = PLAY.live?.blocker?.severity === 'red'
  assert.deepEqual(marks.filter((mark) => mark.status.endsWith(':fail') && !(mark.inLive && allowed)), [])
  // "NOT SOLVED" under check v4 is a research miss: neutral ink, never red or amber.
  assert.match(renderToStaticMarkup(createElement(PlayHeader, { play: PLAY })), /class="play-verdict tone-neutral" data-status="result:No pass yet:neutral">NOT SOLVED</)

  // The same play with its live run blocked red now: the one earned fail sits inside the live box and names its owner.
  const blocker = { class: 'check-infra', severity: 'red', since: new Date(CLOCK - 20 * 60_000).toISOString(), evidence: 'push of the play repository refused', owner: 'discovery-lab (play repository access)' }
  const html = renderToStaticMarkup(createElement(PlayHeader, { play: { ...PLAY, live: { ...PLAY.live, blocker } } }))
  const fails = statuses(html).filter((mark) => mark.status.endsWith(':fail'))
  assert.equal(fails.length, 1)
  assert.ok(fails[0].inLive)
  assert.equal(fails[0].owner, blocker.owner)
  assert.match(html, /owner: discovery-lab \(play repository access\)/)
})

test("a bar value is toned by its own comparison to the bar, the candidate's verdict a neutral word", () => {
  const html = renderToStaticMarkup(createElement(PlayHeader, { play: PLAY }))
  const proof = PLAY.bar.metrics.find((metric) => metric.nearest && !metric.best && metric.direction === 'down' && metric.target?.approx && metric.nearest.value < metric.target.approx * 1024)
  assert.ok(proof, 'the fixture holds a candidate whose value beats the bar (377 KiB against about 599 KiB)')
  assert.match(html, new RegExp(`data-bar-metric="${proof.id}"[\\s\\S]*?class="tone-pass" data-status="result:Meets the bar:pass"`))
  assert.doesNotMatch(html, /mark-fail|glyph-fail/)
})

test("a cancelled run's agent rows are neutral: an agent that went down on an ended run Ended", () => {
  const index = nodesIndex()
  const html = renderToStaticMarkup(createElement(AgentTable, { index, stats: NODES_18B.nodeStats ?? {}, doc: RUN_18B, assessments: [], dimensions: new Map(), selected: null, onSelect: () => {} }))
  const marks = statuses(html).map((mark) => mark.status)
  const down = NODES_18B.nodes.filter((node) => node.status === 'down').length
  assert.equal(down, 10)
  assert.equal(RUN_18B.live.polling, false)
  assert.ok(marks.length >= NODES_18B.nodes.length - 1, `${marks.length} agent statuses`)
  assert.deepEqual(marks.filter((status) => !status.endsWith(':neutral')), [])
  assert.equal(marks.filter((status) => status === 'agent:Ended:neutral').length, marks.length)
})

test('a driver-failed run settled ten days before the clock reads Crashed, neutral, as a past crash', () => {
  const settledAt = new Date(CLOCK - 10 * DAY).toISOString()
  const crashed = { ...RUN_17C.run, state: 'driver-failed', reason: 'driver-failed', settledAt }
  const play = { ...PLAY, live: null, runs: [crashed], standing: { ...PLAY.standing, lastEnding: { runId: crashed.id, run: '17c', word: 'died', glyph: '✕', at: settledAt, reason: 'driver-failed', blocker: null } } }
  const html = renderToStaticMarkup(createElement(PlayHeader, { play }))
  assert.match(html, /data-status="run:Crashed:neutral"><span class="status-shape" aria-hidden="true">□<\/span> Crashed</)
  assert.doesNotMatch(html, /:fail"/)
})

test('a crash is red, with its owner, only while no newer run of its play has started', () => {
  // The play's served runs and live run say whether a newer run started; a run page reads them for a fresh crash.
  const runs = [...PLAY.runs, PLAY.live]
  const crash = (run) => statusOf({ axis: 'run', state: 'driver-failed', reason: 'driver-failed', settledAt: new Date(CLOCK - 2 * 3_600_000).toISOString(), newerRun: newerRunOf(runs, run), now: CLOCK })
  const older = RUN_17C.run
  assert.ok(newerRunOf(runs, older), '17c has newer runs on the play')
  assert.deepEqual(crash(older), { axis: 'run', word: 'Crashed', tone: 'neutral', shape: '□' })
  const newest = { id: PLAY.live.runId, startedAt: PLAY.live.startedAt }
  assert.equal(newerRunOf(runs, newest), false)
  const now = crash(newest)
  assert.equal(now.tone, 'fail')
  const html = renderToStaticMarkup(createElement(StatusPill, { status: now }))
  assert.deepEqual(statuses(html), [{ status: 'run:Crashed:fail', owner: 'discovery-lab runner', inLive: false }])
  assert.match(html, /Crashed · owner: discovery-lab runner<\/span>$/)
})

test("the 18b spend ledger prints each known amount and one line for what is not recorded", () => {
  const index = nodesIndex()
  const agents = index.actors.filter((node) => node.kind !== 'finding')
  const html = renderToStaticMarkup(createElement(SpendBars, { rows: agentSpendRows(RUN_18B.spend.nodes, agents), noun: 'agents', reason: 'no per-agent meter' }))
  const known = Object.values(RUN_18B.spend.nodes).filter((node) => typeof node.listUsd === 'number')
  assert.ok(known.length >= 6, `${known.length} agents with known amounts`)
  assert.equal((html.match(/data-spend-known/g) ?? []).length, known.length)
  for (const node of known) assert.ok(html.includes(`$${node.listUsd >= 100 ? node.listUsd.toFixed(0) : node.listUsd >= 1 ? node.listUsd.toFixed(2) : node.listUsd.toFixed(2)}`), `amount ${node.listUsd}`)
  const lines = html.match(/data-spend-unread="true">[^<]*/g) ?? []
  assert.equal(lines.length, 1)
  assert.match(lines[0], /Not recorded for 15 agents: subscription, API, sandbox \(no per-agent meter\)/)
  assert.doesNotMatch(html, /unknown <small>|bar unknown/)
})
