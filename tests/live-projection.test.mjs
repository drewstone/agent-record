/** The public projection consumes the real paged native-row contract without a fabricated retained record. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { projectPartEvents } from '@drewstone/agent-record/record'
const { node, rows } = JSON.parse(await readFile(new URL('./fixtures/runtime-live-frames.json', import.meta.url)))

test('public native projection keeps scoped final state, user input and honest source absence', () => {
  const original = JSON.stringify({ node, rows }), events = projectPartEvents(node, rows)
  assert.equal(JSON.stringify({ node, rows }), original, 'the data-only projection does not mutate producer values')
  assert.equal(events.filter(event => event.detail.role === 'user').length, 1)
  const calls = events.flatMap(event => event.detail.publicToolCalls ?? []), results = events.filter(event => event.kind === 'tool-result')
  assert.equal(calls.length, 3); assert.equal(results.length, 3)
  assert.equal(results.filter(event => event.detail.isError).length, 2)
  assert.equal(results.filter(event => !event.detail.isError).length, 1)
  assert.equal(new Set(events.map(event => event.id)).size, events.length)
  assert.ok(events.every(event => event.source === undefined), 'stream sequence and basename do not invent a path, hash or physical line')
  assert.deepEqual(events, projectPartEvents(node, rows), 'native identity is stable across equivalent window projections')
  const before = projectPartEvents(node, rows.filter(row => row.seq <= 2))
  const pending = before.find(event => event.detail.publicToolCalls?.length)
  assert.ok(pending)
  assert.ok(events.some(event => event.id === pending.id), 'a terminal native-part update keeps its call identity')
  assert.ok(results.some(event => event.detail.publicText?.includes('failed')))
  const anchoredRows = rows.map(row => ({ ...row, source: { path: 'capture/actual.jsonl', line: 17, sha256: 'a'.repeat(64) } }))
  assert.ok(projectPartEvents(node, anchoredRows).every(event => event.source?.line === 17 && event.source?.sha256 === 'a'.repeat(64)))
})
