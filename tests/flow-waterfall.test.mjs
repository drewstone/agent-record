import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseRecord, RecordFlowWaterfall } from '../dist/index.js'
import { fromTraceSpans } from '../dist/trace-spans.js'

const fixture = (name) => readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)
const render = (record, live = false) => renderToStaticMarkup(createElement(RecordFlowWaterfall, { record, live, defaultCollapsed: false, view: 'spans' }))
const field = (html, name) => html.match(new RegExp(`<dt[^>]*>${name}</dt><dd[^>]*>(.*?)</dd>`))?.[1]
// The exact count is the value's title; the cell shows it rounded (754.4k).
const exact = (html, name) => html.match(new RegExp(`<dt[^>]*>${name}</dt><dd[^>]*title="([^"]*)"`))?.[1]

test('retained Discovery capture reaches the shared waterfall without cumulative-meter token duplication', async () => {
  const record = parseRecord(await fixture('waterfall-discovery-record'))
  const html = render(record)
  assert.match(html, /data-flow-waterfall/)
  // Native per-response usage is 98,722 fresh + 649,984 cached + 5,742 output.
  // Lifecycle metered snapshots in these same retained bytes are cumulative, not extra responses.
  assert.equal(exact(html, 'Tokens'), '754,448 tokens')
  assert.equal(field(html, 'Cost'), 'Unknown')
  assert.equal(field(html, 'Tool calls'), String(record.events.reduce((sum, event) => sum + (event.detail.publicToolCalls?.length ?? 0), 0)))
  // charts 0.17.0 draws a handoff as a connector between the two rows rather than a row of its own.
  assert.match(html, /data-span-kind="handoff"|class="fw-link /)
  assert.match(html, /data-span-kind="model"/)
  assert.match(html, /data-span-kind="tool"/)
  assert.match(html, /aria-label="Search trace"|>Search trace<\/label>/)
  assert.match(html, /aria-label="Playback speed"/)
  for (const speed of ['0.5', '1', '1.5', '2', '4']) assert.match(html, new RegExp(`<option value="${speed}"[^>]*>${speed}x</option>`))
  assert.match(html, />Collapse all</)
  assert.match(html, /Slowest step:/)
})

test('existing OTLP public adapter preserves nested span identities and exact measured intervals in the shared renderer', async () => {
  const record = fromTraceSpans(await fixture('chatgpt-fleet-spans'), { recordId: 'recorded-fleet', title: 'Fleet trace' })
  const html = render(record)
  assert.equal(field(html, 'Tool calls'), '1')
  for (const event of record.events) assert.ok(html.includes(`data-span-id="${event.detail.traceId}:${event.detail.spanId}"`), event.id)
  assert.match(html, /data-span-kind="model"/)
  assert.match(html, /data-slowest="true"/)
  assert.match(html, /aria-expanded="true"/)
})
