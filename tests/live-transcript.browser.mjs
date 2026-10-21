import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fromResearchPublication } from '../dist/research-publication.js'

const playwright = process.env.PLAYWRIGHT_MODULE
test('run HTTP page reads bounded root and child streams and stops polling after settlement', { skip: !playwright, timeout: 45_000 }, async () => {
  const { chromium } = await import(playwright)
  const bundle = await readFile(new URL('../dist/workspace-viewer.js', import.meta.url))
  const css = await readFile(new URL('../dist/styles.css', import.meta.url))
  let alive = true
  let releaseChildResponse
  const childResponseReady = new Promise((resolve) => { releaseChildResponse = resolve })
  const requests = []
  const runRequests = []
  const at = '2026-10-16T12:00:00.000Z'
  const nodes = [{ id: 'run-fixture', label: 'Root', parent: null }, { id: 'worker', label: 'Worker', parent: 'run-fixture' }]
  const root = [
    { seq: 0, at, event: { kind: 'text_delta', text: 'Earlier history' } },
    { seq: 1, at, event: { kind: 'text_delta', text: 'Current answer' } },
    { seq: 2, at, event: { kind: 'reasoning_delta', text: 'Private reasoning body' } },
    { seq: 3, at, event: { kind: 'tool_call', toolCallId: 'call-1', toolName: 'read_file', args: { path: 'result.txt' } } },
    { seq: 4, at, event: { kind: 'tool_result', toolCallId: 'call-1', toolName: 'read_file', result: 'Retained tool result' } },
  ]
  const child = [
    { seq: 0, at, stream: 'worker/session', type: 'message.part.updated', data: { part: { id: 'text-1', type: 'text', text: 'Child partial', time: { start: Date.parse(at) } } } },
    { seq: 1, at, stream: 'worker/session', type: 'message.part.updated', data: { part: { id: 'text-1', type: 'text', text: 'Child complete', time: { start: Date.parse(at) } } } },
    { seq: 2, event: { kind: 'capture_gap', text: 'A stream record exceeded the payload bound.' } },
  ]
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const json = (value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
    if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'application/javascript; charset=utf-8'); return res.end(bundle) }
    if (url.pathname === '/style.css') { res.setHeader('content-type', 'text/css'); return res.end(css) }
    if (url.pathname.endsWith('/transcript')) {
      requests.push(url.search)
      const node = url.searchParams.get('node')
      const before = url.searchParams.get('before')
      const after = url.searchParams.get('after')
      const rows = node === 'worker' ? child : root
      if (node !== 'worker' && after === '4') return json({ runId: 'run-fixture', node, events: [], nodes, alive, firstSeq: 5, lastSeq: 5, hasEarlier: true, hasMore: true })
      if (node !== 'worker' && after === '5') return json({ runId: 'run-fixture', node, events: [{ seq: 6, at, event: { kind: 'text_delta', text: 'After skipped lines' } }], nodes, alive, firstSeq: 6, lastSeq: 6, hasEarlier: true, hasMore: false })
      const events = before !== null ? rows.filter((row) => row.seq < Number(before)) : after !== null ? rows.filter((row) => row.seq > Number(after)) : node === 'worker' ? rows : rows.slice(1)
      const reply = () => json({ runId: 'run-fixture', node, events, nodes, alive, firstSeq: events[0]?.seq ?? null, lastSeq: events.at(-1)?.seq ?? null, hasEarlier: before === null && after === null && node !== 'worker', hasMore: false })
      if (node === 'worker' && after === null) return void childResponseReady.then(reply)
      return reply()
    }
    if (url.pathname === '/api/runs/run-fixture') {
      runRequests.push({ alive, etag: req.headers['if-none-match'] ?? null })
      const etag = alive ? '"running"' : '"settled"'
      res.setHeader('etag', etag)
      if (req.headers['if-none-match'] === etag) return res.writeHead(304).end()
      return json({
      schema: 'agent-workspace.run.v1', run: { id: 'run-fixture', play: 'fixture', state: alive ? 'running' : 'failed', location: { kind: alive ? 'dir' : 'archive', path: null }, record: { status: alive ? 'missing' : 'ready', digest: null }, keys: [] },
      input: null, spend: { nodes: {}, gaps: [] }, versions: [], live: { polling: alive, mirrorAt: null },
      execution: { alive, lastActivityAt: at, failedAttempts: 2, settleKind: alive ? null : 'failed', endingError: alive ? null : { name: 'RetainedWorkspaceCapturePendingError', message: 'Workspace capture pending' }, lastAttempt: alive ? null : { error: 'HTTP 429', classification: 'transient' }, diagnoses: alive ? [] : [{ id: 'provider-rate-limit', fix: `Resume after provider capacity returns. ${'Keep the source sandbox and inspect the provider response. '.repeat(40)}` }, { id: 'retained-capture', fix: 'Capture the preserved workspace. '.repeat(40) }, { id: 'settle-capture', fix: 'Check retained evidence before judging the run. '.repeat(40) }], resume: { status: 'preserved', command: 'disco run --resume run-fixture', reason: 'Source sandbox preserved' } },
      })
    }
    if (url.pathname === '/api/dimensions') return json({ dimensions: [] })
    if (url.pathname.endsWith('/assessments')) return json({ rows: [] })
    if (url.pathname === '/run/run-fixture') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="agent-workspace" data-mode="run" data-id="run-fixture" data-api="/api"></div><script src="/bundle.js"></script>') }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/run/run-fixture`)
    // The Now view opens with the run's name, its status and four slots, and states one liveness clock.
    await page.locator('[data-fold] h1', { hasText: 'Run run-fixture' }).waitFor()
    assert.equal(await page.locator('[data-slot]').count(), 4)
    assert.equal((await page.locator('body').innerText()).match(/last output/g)?.length, 1, 'one liveness clock')
    assert.equal(requests.length, 0, 'overview does not fetch streams')
    await page.getByRole('tab', { name: 'Conversations' }).click()
    await page.getByText('Current answer', { exact: true }).waitFor()
    assert.equal(await page.locator('details.reasoning-body[open]').count(), 0)
    assert.equal(await page.locator('.reasoning-body .activity-prose').count(), 0, 'collapsed reasoning has no expanded body')
    await page.getByText('read_file', { exact: true }).first().click()
    await page.getByText('Retained tool result', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Inspect source of assistant', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'Event details' }).waitFor()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByText('After skipped lines', { exact: true }).waitFor()
    assert.ok(requests.some((query) => query.includes('after=5')), 'cursor advances across skipped malformed lines')
    await page.getByRole('button', { name: 'Load older' }).click()
    await page.getByText(/Earlier history/).waitFor()
    await page.getByText(/Reading history, new output continues/).waitFor()
    assert.ok(requests.some((query) => query.includes('before=1')))
    await page.waitForResponse((response) => response.url().includes('/transcript?') && response.url().includes('after=6'))
    const childRequest = page.waitForRequest((request) => request.url().includes('/transcript?') && request.url().includes('node=worker'))
    await page.getByLabel('Agent conversation').selectOption('worker')
    await childRequest
    await page.getByText('Loading transcript…', { exact: true }).waitFor()
    assert.equal(await page.getByText('Conversation not retained. Its absence does not mean the agent did no work.', { exact: true }).count(), 0, 'an initial child request does not claim the conversation is missing while loading')
    releaseChildResponse()
    await page.getByText('Child complete', { exact: true }).waitFor()
    await page.getByText('A stream record exceeded the payload bound.', { exact: true }).waitFor()
    assert.equal(await page.getByText('Child partial', { exact: true }).count(), 0, 'native snapshot updates replace the prior part')
    alive = false
    child.push({ seq: 3, at, stream: 'worker/session', type: 'message.part.updated', data: { part: { id: 'text-1', type: 'text', text: 'Child final suffix', time: { start: Date.parse(at) } } } })
    await page.locator('[data-run-status]', { hasText: 'Crashed' }).waitFor({ timeout: 10_000 }).catch(async (error) => {
      throw new Error(`${error.message}\nRun requests: ${JSON.stringify(runRequests)}\nPage errors: ${JSON.stringify(errors)}\nRendered page: ${await page.locator('body').innerText()}`, { cause: error })
    })
    await page.getByText('Child final suffix', { exact: true }).waitFor()
    await page.waitForTimeout(500)
    const settledCount = requests.length
    await page.waitForTimeout(3500)
    assert.equal(requests.length, settledCount, 'settled transcript does not poll')
    // Why the run stopped is on its Now view, folded under its ending sentence.
    await page.getByRole('tab', { name: 'Now' }).click()
    await page.getByText('Why it stopped', { exact: true }).click()
    await page.getByText(/RetainedWorkspaceCapturePendingError: Workspace capture pending/).waitFor()
    for (const id of ['provider-rate-limit', 'retained-capture', 'settle-capture']) await page.getByText(id, { exact: true }).waitFor()
    await page.getByText('disco run --resume run-fixture', { exact: true }).waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'phone reflows')
    await page.evaluate(() => scrollTo(0, 0))
    assert.deepEqual(await page.locator('[data-slot]').evaluateAll((slots) => slots.map((slot) => slot.getBoundingClientRect().bottom <= innerHeight)), [true, true, true, true], 'the four slots fit the phone\'s first screen')
  } finally { releaseChildResponse(); await browser.close(); await new Promise((resolve) => server.close(resolve)) }
})

test('settled archives keep captured Messages and an empty directory stream falls back to the same record', { skip: !playwright, timeout: 45_000 }, async () => {
  const { chromium } = await import(playwright)
  const captured = fromResearchPublication(JSON.parse(await readFile(new URL('../examples/react/public/records/ftqc-zips-2026-08-05-r1.json', import.meta.url), 'utf8')))
  const first = captured.events.find((event) => event.detail.publicText?.startsWith('Seven zip archives are in'))
  assert.ok(first, 'the published August 5 conversation is retained')
  const actor = captured.nodes.find((node) => node.id === first.node)?.agentId ?? first.node
  const bundle = await readFile(new URL('../dist/workspace-viewer.js', import.meta.url))
  const css = await readFile(new URL('../dist/styles.css', import.meta.url))
  let location = 'archive'
  let capturedAlive = false
  let aliveStreamReads = 0
  const transcriptRequests = []
  const api = `/api/runs/${captured.runId}`
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const json = (value) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)) }
    if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'application/javascript; charset=utf-8'); return res.end(bundle) }
    if (url.pathname === '/style.css') { res.setHeader('content-type', 'text/css; charset=utf-8'); return res.end(css) }
    if (url.pathname === api) return json({
      schema: 'agent-workspace.run.v1', run: { id: captured.runId, play: 'corpus', state: capturedAlive ? 'running' : 'winner', location: { kind: location, path: null }, record: { status: 'ready', digest: 'captured-fixture' } },
      input: null, spend: { nodes: {}, gaps: [] }, versions: [], live: { polling: capturedAlive, mirrorAt: null },
      execution: { alive: capturedAlive, lastActivityAt: first.at, failedAttempts: 0, settleKind: capturedAlive ? null : 'winner', endingError: null, lastAttempt: null, diagnoses: [], resume: { status: 'unavailable', command: null, reason: 'Source sandbox is not preserved.' } },
    })
    if (url.pathname === `${api}/record`) return json(url.searchParams.get('part') === 'nodes' ? { ...captured, events: [] } : captured)
    if (url.pathname === `${api}/transcript`) {
      transcriptRequests.push(url.search)
      if (capturedAlive) aliveStreamReads += 1
      const events = capturedAlive && aliveStreamReads > 1 ? [{ seq: 0, at: first.at, event: { kind: 'text_delta', text: 'The live agent started after an empty tail.' } }] : []
      return json({ runId: captured.runId, node: actor, events, nodes: [{ id: actor, label: 'Director', parent: null }], firstSeq: events.length ? 0 : null, lastSeq: events.length ? 0 : null, hasEarlier: false, hasMore: false, alive: capturedAlive })
    }
    if (url.pathname === '/api/dimensions') return json({ dimensions: [] })
    if (url.pathname.endsWith('/assessments')) return json({ rows: [] })
    if (url.pathname === `/run/${captured.runId}`) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="agent-workspace" data-mode="run" data-id="${captured.runId}" data-api="/api"></div><script src="/bundle.js"></script>`) }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const base = `http://127.0.0.1:${server.address().port}/run/${captured.runId}?section=agents&node=${encodeURIComponent(actor)}&event=${encodeURIComponent(first.id)}`
    for (location of ['archive', 'none', 'dir']) {
      await page.goto(`${base}&case=${location}`)
      await page.getByRole('tab', { name: 'Messages', exact: true }).waitFor()
      await page.locator('[data-chat] .activity-prose').getByText(/Seven zip archives are in/).waitFor()
      assert.equal(transcriptRequests.length, location === 'dir' ? 1 : 0, `${location} uses captured Messages`)
      await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
      await page.getByRole('tab', { name: 'Messages', exact: true }).click()
      await page.locator('[data-chat] .activity-prose').getByText(/Seven zip archives are in/).waitFor()
      assert.equal(transcriptRequests.length, location === 'dir' ? 1 : 0, 'Messages does not bounce back to an empty stream')
    }
    capturedAlive = true
    await page.goto(`${base}&case=alive-empty`)
    await page.getByText('The live agent started after an empty tail.', { exact: true }).waitFor()
    assert.ok(aliveStreamReads >= 2, 'an empty alive stream keeps polling even with a ready captured record')
    assert.equal(await page.getByRole('tab', { name: 'Messages', exact: true }).count(), 0, 'the live stream stays selected')
    capturedAlive = false
    await page.getByText(/Stopped · winner/).waitFor()
    await page.getByText('The live agent started after an empty tail.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: 'Messages', exact: true }).count(), 0, 'settlement retains the stream that started after an empty tail')
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)) }
})
