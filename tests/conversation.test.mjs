// The conversation's row rules on a small live record: which calls collapse as polls, which never do, and how the
// viewer labels what the record does not hold.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentRecord, parseRecord } from '../dist/index.js'
import {
  anchorOf,
  anchorsOf,
  argsLabel,
  callStatus,
  collapsePolls,
  pollSummary,
  thinkingMarkers,
} from '../src/viewer/conversation-rows.ts'
import { byteSize, sameOriginHref } from '../src/workspace/final-output.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/live-conversation.json', import.meta.url), 'utf8'))
const callsOf = (event) => event.detail.publicToolCalls ?? []
const answeredIn = (record) => {
  const ids = new Set(record.events.filter((event) => event.detail.toolCallId).map((event) => `${event.node}\0${event.detail.toolCallId}`))
  return (event, id) => ids.has(`${event.node}\0${id}`)
}
const conversation = (record) =>
  record.events.filter((event) => event.category !== 'lifecycle' && !(event.detail.toolCallId && answeredIn(record)(event, event.detail.toolCallId)))
const rowsOf = (record) =>
  collapsePolls(conversation(record), { callsOf, answered: answeredIn(record), keyOf: (event) => event.id })

test('consecutive unanswered polls of one tool with empty arguments collapse into one row', () => {
  const record = fixture()
  const rows = rowsOf(record)
  const groups = rows.filter((row) => row.kind === 'polls')
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].events.map((event) => callsOf(event)[0].id), ['100', '101', '102', '103', '104'])
  assert.equal(groups[0].name, 'mcp__agent-runtime-coordination__await_event')
  assert.equal(rows.length, conversation(record).length - 4)
})

test('a call whose result carries content is never collapsed', () => {
  const rows = rowsOf(fixture())
  const single = rows.filter((row) => row.kind === 'event').flatMap((row) => callsOf(row.event).map((call) => call.id))
  // toolu_wait returned a pending report, 201 returned a settlement; both stay visible and split the runs around them.
  for (const id of ['toolu_wait', '200', '201', '202']) assert.ok(single.includes(id), id)
})

test('repeating a non-waiting call with arguments is work, not a poll', () => {
  const rows = rowsOf(fixture())
  const reads = rows.filter((row) => row.kind === 'event' && callsOf(row.event)[0]?.name.endsWith('knowledge_read'))
  assert.equal(reads.length, 2)
})

test('a turn with text, thinking or a withheld-thinking marker is never a poll', () => {
  const record = fixture()
  const base = record.events.find((event) => callsOf(event)[0]?.id === '100')
  const variants = [{ publicText: 'checking' }, { reasoning: 'why' }, { reasoningOmitted: 1 }, { reasoningRedacted: 1 }]
  for (const extra of variants) {
    const events = [0, 1, 2].map((i) => ({ ...base, id: `x${i}`, detail: { ...base.detail, ...extra, publicToolCalls: [{ id: `x${i}`, name: 'await_event', input: '{}' }] } }))
    const rows = collapsePolls(events, { callsOf, answered: () => false, keyOf: (event) => event.id })
    assert.equal(rows.filter((row) => row.kind === 'polls').length, 0, JSON.stringify(extra))
  }
})

test('the collapsed row states its span and poll count, and unknown tokens as unknown', () => {
  const group = rowsOf(fixture()).find((row) => row.kind === 'polls')
  const summary = pollSummary(group.events)
  assert.equal(summary.spanMs, 20_000)
  assert.equal(summary.tokens, null)
  assert.equal(summary.label, 'waited 20s · 5 polls · tokens unknown')
  const measured = group.events.map((event, i) => ({ ...event, detail: { ...event.detail, ...(i < 2 ? { usage: { input: 10, output: 5 } } : {}) } }))
  assert.equal(pollSummary(measured).label, 'waited 20s · 5 polls · ~30 tokens (2 of 5 measured)')
  // Execution totals are not per-poll usage.
  const totals = group.events.map((event) => ({ ...event, detail: { ...event.detail, usage: { input: 9 }, usageScope: 'execution-total' } }))
  assert.equal(pollSummary(totals).tokens, null)
})

test('absent arguments, results and thinking are labelled as absent', () => {
  assert.equal(argsLabel(undefined), 'args not captured')
  assert.equal(argsLabel('{}'), 'empty args')
  assert.equal(argsLabel('{"max":5}'), null)
  assert.equal(callStatus('missing', false), 'Result not captured')
  assert.equal(callStatus('missing', true), 'Pending')
  assert.equal(callStatus('returned', true), 'Returned')
  assert.deepEqual(thinkingMarkers({ reasoningOmitted: 1 }), ['thinking not returned by provider'])
  assert.deepEqual(thinkingMarkers({ reasoningRedacted: 2 }), ['2 thinking blocks redacted (encrypted)'])
  assert.deepEqual(thinkingMarkers({ reasoningOmitted: 0, reasoning: 'x' }), [])
})

test('row keys survive a live rebuild that renames every event', () => {
  const before = fixture()
  const after = fixture()
  for (const event of after.events) {
    event.id = `ffffffffffff:${event.source.line}`
    event.source.sha256 = 'f'.repeat(64)
  }
  const a = anchorsOf(before.events)
  const b = anchorsOf(after.events)
  assert.deepEqual([...a.values()], [...b.values()])
  assert.equal(new Set(a.values()).size, before.events.length)
  // The native record id keys the row; the source position keys an event without one.
  assert.match(anchorOf(before.events[0]), /"native","1"/)
  assert.match(anchorOf(before.events.at(-1)), /session\.jsonl/)
})

test('the rendered conversation shows the collapsed polls, absent captures and withheld thinking', () => {
  const record = parseRecord(fixture())
  const html = renderToStaticMarkup(createElement(AgentRecord, { records: [record] }))
  assert.match(html, /waited 20s · 5 polls · tokens unknown/)
  assert.match(html, /data-poll-group="5"/)
  assert.match(html, /args not captured/)
  assert.match(html, /Result not captured/)
  assert.doesNotMatch(html, /No result</)
  assert.match(html, /thinking not returned by provider/)
  assert.match(html, /2 thinking blocks redacted \(encrypted\)/)
  assert.match(html, /Expand all thinking/)
  // Thinking text stays collapsed until asked for.
  assert.doesNotMatch(html, /<details[^>]*class="reasoning-body"[^>]*open/)
})

test('final output sizes and links never invent a value', () => {
  assert.equal(byteSize(null), 'size unknown')
  assert.equal(byteSize(undefined), 'size unknown')
  assert.equal(byteSize(0), '0 B')
  assert.equal(byteSize(12_700), '12.4 KB')
  assert.equal(byteSize(5 * 1024 * 1024), '5.0 MB')
  const page = 'http://100.87.125.67:8769/run/x'
  assert.equal(sameOriginHref('/api/discovery/runs/x/file/a.md', page), '/api/discovery/runs/x/file/a.md')
  assert.equal(sameOriginHref('https://example.com/a.md', page), null)
  assert.equal(sameOriginHref('javascript:alert(1)', page), null)
  assert.equal(sameOriginHref(null, page), null)
})
