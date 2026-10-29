import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fromResearchPublication } from '../dist/research-publication.js'

const playwright = process.env.PLAYWRIGHT_MODULE
test('archive Conversations preserves the August 5 capture and hands an empty live tail to native SSE', { skip: !playwright, timeout: 120_000 }, async () => {
  const { chromium } = await import(playwright)
  const captured = fromResearchPublication(JSON.parse(await readFile(new URL('../examples/react/public/records/ftqc-zips-2026-08-05-r1.json', import.meta.url), 'utf8')))
  const first = captured.events.find((event) => event.detail.publicText?.startsWith('Seven zip archives are in'))
  assert.ok(first, 'the published August 5 conversation is retained')
  const originalNode = captured.nodes.find((node) => node.id === first.node)
  const actor = originalNode?.agentId ?? first.node
  const assets = resolve(process.env.AGENT_RECORD_ASSETS ?? fileURLToPath(new URL('../dist/', import.meta.url)))
  const evidence = process.env.LIVE_TRANSCRIPT_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  const api = `/api/runs/${captured.runId}`, streams = new Map(), requests = [], connections = [], checks = []
  const lateText = 'The live agent started after an empty tail.'
  const lateEvent = { id: 'late-native-row', node: first.node, at: first.at, kind: 'message', category: 'other', label: 'assistant', source: null, detail: { role: 'assistant', publicText: lateText } }
  let location = 'archive', alive = false, finalCapture = false, theme = 'light'
  const nodes = () => [{ id: actor, label: 'Director', parent: null, status: alive ? 'running' : 'succeeded', start: originalNode?.start ?? first.at, end: originalNode?.end ?? null, harness: null, model: null, usage: null }]
  const workspace = () => ({ schema: 'agent-workspace.run-workspace.v1', runId: captured.runId, live: alive, nodes: nodes(), edges: [], releases: [], best: null, code: { available: false, reason: 'Retained conversation fixture' } })
  const run = () => ({ schema: 'agent-workspace.run.v1', run: { id: captured.runId, play: 'corpus', state: alive ? 'running' : 'winner', startedAt: originalNode?.start ?? first.at, location: { kind: location, path: null }, record: { status: 'ready', digest: finalCapture ? 'final-capture' : 'original-capture' } }, input: null, spend: { nodes: {} }, versions: [], live: { polling: alive }, execution: { alive } })
  const send = (kind, event, data) => { for (const [response, stream] of streams) if (stream === kind) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname
    const json = value => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    if (path.startsWith('/assets/')) {
      const file = resolve(assets, decodeURIComponent(path.slice(8)))
      if (!file.startsWith(assets + '/')) return res.writeHead(400).end()
      try { res.writeHead(200, { 'content-type': extname(file) === '.css' ? 'text/css' : 'text/javascript' }); return res.end(await readFile(file)) } catch { return res.writeHead(404).end() }
    }
    if (path === api) return json(run())
    if (path === `${api}/workspace`) return json(workspace())
    if (path.startsWith('/api/plays/')) return json({ id: 'corpus', runs: [] })
    if (path === `${api}/record`) return json({ ...captured, events: url.searchParams.get('part') === 'nodes' ? [] : [...captured.events, ...(finalCapture ? [lateEvent] : [])] })
    if (path === `${api}/transcript`) {
      requests.push(url.search)
      return json({ runId: captured.runId, node: actor, generation: 'fixture', events: [], nodes: nodes(), firstSeq: null, lastSeq: null, hasEarlier: false, hasMore: false, alive })
    }
    if (path.endsWith('/stream')) {
      const kind = url.searchParams.get('workspace') === '1' ? 'workspace' : 'agent'
      connections.push({ kind, path, search: url.search })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': connected\n\n')
      streams.set(res, kind); res.on('close', () => streams.delete(res)); return
    }
    if (path.startsWith(`/run/${captured.runId}`)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(`<!doctype html><html class="${theme}" data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"><style>body{margin:0}#agent-workspace{padding:0 20px 32px}@media(max-width:600px){#agent-workspace{padding-left:16px;padding-right:16px}}</style><div id="agent-workspace" data-mode="run" data-id="${captured.runId}" data-api="/api"></div><script type="module" src="/assets/workspace-viewer.js"></script></html>`)
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser, currentPage
  try {
    browser = await chromium.launch({ headless: true })
    for (theme of ['light', 'dark']) for (const width of [1512, 390]) {
      alive = false; finalCapture = false; requests.length = 0; connections.length = 0
      const context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 982 } } } : {}) })
      const page = await context.newPage(), errors = []
      currentPage = page
      page.on('pageerror', error => errors.push(error.message))
      const base = `http://127.0.0.1:${server.address().port}/run/${captured.runId}?section=agents&node=${encodeURIComponent(actor)}&event=${encodeURIComponent(first.id)}`
      const capture = async name => { if (evidence) await page.screenshot({ path: `${evidence}/${name}-${width}-${theme}.png`, fullPage: true }) }
      for (location of ['archive', 'none', 'dir']) {
        await page.goto(`${base}&case=${location}`)
        await page.getByRole('tab', { name: /^Conversations/ }).waitFor()
        await page.locator('.record-conversation').getByText(/Seven zip archives are in/).waitFor()
        assert.ok(new URL(page.url()).pathname.endsWith('/conversations'), 'legacy links reach the current Conversations route')
        assert.equal(requests.length, 0, `${location} reads a ready retained record without probing an empty transcript`)
        assert.equal(connections.length, 0, 'a settled capture opens no native streams')
        await page.getByRole('tab', { name: 'Waterfall', exact: true }).click()
        await page.getByRole('tab', { name: /^Conversations/ }).click()
        await page.locator('.record-conversation').getByText(/Seven zip archives are in/).waitFor()
        assert.equal(requests.length, 0, 'tab navigation keeps the retained conversation')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await capture(`retained-${location}`)
      }
      alive = true; location = 'dir'
      const connected = page.waitForResponse(response => response.url().includes('/stream?') && !response.url().includes('workspace=1'))
      await page.goto(`${base}&case=alive-empty`)
      await page.locator('.live-transcript').waitFor()
      await page.waitForFunction(() => document.querySelector('.live-transcript')?.innerText.includes('No stream events have been retained'))
      assert.equal(requests.length, 1, 'a resumed run reads its selected agent tail once')
      assert.equal(await page.getByText(/Seven zip archives are in/).count(), 0, 'an alive empty tail does not substitute the old capture')
      await capture('alive-empty')
      await page.waitForFunction(() => performance.getEntriesByType('resource').filter(item => new URL(item.name).pathname.endsWith('/transcript')).length === 1)
      await connected
      assert.equal(connections.filter(item => item.kind === 'agent').length, 1, 'native SSE owns subsequent arrivals')
      send('agent', 'rows', { generation: 'fixture', alive: true, events: [{ seq: 0, at: first.at, event: { kind: 'text_delta', text: lateText } }], firstSeq: 0, lastSeq: 0 })
      await page.getByText(lateText, { exact: true }).waitFor()
      await capture('native-arrival')
      assert.equal(requests.length, 1)
      // The producer publishes the final retained capture when it settles the run.
      alive = false; finalCapture = true
      send('workspace', 'workspace', { workspace: workspace(), run: run() })
      send('agent', 'end', { lastSeq: 0 })
      await page.locator('.live-transcript').waitFor({ state: 'hidden' })
      await page.locator('.record-conversation').getByText(lateText, { exact: true }).scrollIntoViewIfNeeded()
      const settledReads = requests.length, settledConnections = connections.length
      await page.waitForTimeout(3500)
      assert.equal(requests.length, settledReads, 'a settled capture has no transcript polling')
      assert.equal(connections.length, settledConnections, 'ended streams do not reconnect')
      await capture('settled-final-capture')
      assert.deepEqual(errors, [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      checks.push({ theme, width, retainedLocations: ['archive', 'none', 'dir'], exactAugust5Text: true, liveInitialTailReads: 1, nativeArrival: true, finalCaptureRetainsArrival: true, errors })
      const video = page.video()
      await context.close()
      if (evidence && video) await video.saveAs(`${evidence}/archive-conversations-${width}-${theme}.webm`)
    }
  } catch (error) {
    if (evidence && currentPage && !currentPage.isClosed()) { await currentPage.screenshot({ path: `${evidence}/failure.png`, fullPage: true }); await writeFile(`${evidence}/failure.json`, JSON.stringify({ error: String(error), body: await currentPage.locator('body').innerText() }, null, 2)) }
    throw error
  } finally {
    await browser?.close(); for (const response of streams.keys()) response.end()
    await new Promise(resolve => server.close(resolve))
    if (evidence) await writeFile(`${evidence}/checks.json`, JSON.stringify(checks, null, 2))
  }
})
