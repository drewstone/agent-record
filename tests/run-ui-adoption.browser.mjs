import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(process.env.AGENT_RECORD_PACKAGE ?? resolve(process.cwd(), 'package.json'))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const assets = process.env.AGENT_RECORD_ASSETS ?? dirname(require.resolve('@drewstone/agent-record/workspace-viewer.js'))
const now = Date.now(), start = now - 30 * 60_000, iso = at => new Date(at).toISOString()
const failureReason = 'Checkout tests failed: ' + 'The retained integration output identifies a mismatched response shape and preserves the complete recorded explanation. '.repeat(4).trimEnd()
const nodes = Array.from({ length: 17 }, (_, i) => ({
  id: i ? `lane-g:s${i}` : 'lane-g', label: i ? `Agent ${i}` : 'Root', role: null, assignment: null,
  harness: 'codex', model: 'openai/gpt-5.5', status: i === 1 ? 'needs-you' : i === 2 ? 'failed' : i === 4 ? 'waiting' : 'running',
  start: iso(start + i * 1000), end: i === 2 ? iso(now - 60_000) : null,
  failureReason: i === 2 ? failureReason : null,
  turn: i === 1 ? 'Approve the proposed change' : i === 2 ? 'Checkout tests failed' : i === 4 ? 'Waiting on Agent 5' : 'Checking recorded evidence',
  lastAt: iso(i === 3 ? now - 12 * 60_000 : now - 2000), shipped: i === 2 ? 1 : 0, hasCode: false,
  usage: { billedUsd: null, listUsd: null, listComplete: false, calls: i === 15 ? 0 : 300, tools: { read: { calls: 500, failures: i === 2 ? 1 : 0, ms: 2000 } }, pricedCalls: null, tokens: null, at: iso(now), source: 'browser-fixture', lastActivityAt: i === 3 ? now - 12 * 60_000 : now - 2000, medianEventGapMs: 30_000, activityEvents: [{ id: `event:${i}`, label: i === 2 ? 'Checkout tests failed' : 'read · retained evidence', at: i === 3 ? now - 12 * 60_000 : now - 2000 }], steps: [
    ...(i === 15 ? [] : [{ kind: 'model', startMs: i === 3 ? now - 14 * 60_000 : now - 5000, endMs: i === 3 ? now - 13 * 60_000 : now - 4000, modelCalls: 300, failed: false }]),
    { kind: 'tool', startMs: i === 3 ? now - 13 * 60_000 : now - 4000, endMs: i === 3 ? now - 12 * 60_000 : now - 2000, failed: i === 2, tool: 'read', name: i === 2 ? 'Checkout tests failed' : 'Read retained evidence' },
  ] },
}))
nodes[16].usage = null
const workspace = { schema: 'agent-workspace.run-workspace.v1', runId: 'lane-g', live: true, nodes, edges: nodes.slice(1).map(n => ({ from: 'lane-g', to: n.id, kind: 'spawn' })), releases: [], best: null, code: { available: false, reason: 'Fixture has no code' } }
workspace.edges = workspace.edges.filter(edge => edge.to !== 'lane-g:s16')
const run = { schema: 'agent-workspace.run.v1', run: { id: 'lane-g', play: 'lane-g', state: 'running', startedAt: iso(start), location: { kind: 'dir', path: null }, record: { status: 'missing', digest: null } }, input: null, spend: { nodes: {}, paidUsd: null }, versions: [], live: { polling: true, mirrorAt: null }, execution: { alive: true } }

test('served run adapter uses shared graph statuses, keeps failure evidence and reflows at 390', { timeout: 120_000 }, async () => {
  const evidence = process.env.RUN_UI_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  let theme = 'dark', runtimeTotals
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const json = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)) }
    if (path.startsWith('/api/agents/')) {
      res.setHeader('content-type', 'text/event-stream')
      return res.end(`event: rows\ndata: ${JSON.stringify({ generation: 'fixture', alive: false, events: [{ seq: 1, at: iso(now - 1000), event: { kind: 'text', text: 'Recorded response from the worker without a start timestamp.' } }] })}\n\nevent: end\ndata: {}\n\n`)
    }
    if (path === '/api/events') {
      res.setHeader('content-type', 'text/event-stream')
      const snapshot = { root: 'fixture', generatedAt: now, completeness: 'complete', diagnostics: [], supervisors: [{ id: 'lane-g', totals: runtimeTotals, status: 'running', startedAt: iso(start), lastActivityAt: now - 2000, medianEventGapMs: 30_000, workers: nodes.slice(1).map(n => ({ id: n.id, parent: 'lane-g', label: n.label, status: n.status === 'failed' ? 'down' : n.status, runtime: n.harness, startedAt: n.id.endsWith(':s15') ? undefined : n.start, endedAt: n.end ?? undefined, lastActivityAt: Date.parse(n.lastAt), medianEventGapMs: 30_000, liveTail: [n.turn], reason: n.failureReason ?? undefined })) }] }
      snapshot.supervisors[0].workers = snapshot.supervisors[0].workers.filter(worker => worker.id !== 'lane-g:s16')
      for (const worker of snapshot.supervisors[0].workers) delete worker.parent
      snapshot.pursuit = { nodes: [{ id: 'lane-g:s16', runId: 'lane-g', parentId: 'lane-g', label: 'Agent 16' }] }
      return res.end(`event: snapshot\ndata: ${JSON.stringify({ sequence: 1, observedAt: now, reset: true, snapshots: [snapshot] })}\n\nevent: end\ndata: {}\n\n`)
    }
    if (path.endsWith('/workspace')) return json(workspace)
    if (path === '/api/runs/lane-g') return json(run)
    if (path.startsWith('/api/plays/')) return json({ id: 'lane-g', runs: [] })
    if (path.startsWith('/assets/')) {
      const file = resolve(assets, path.slice(8))
      if (!file.startsWith(assets + '/')) return res.writeHead(400).end()
      try { res.setHeader('content-type', extname(file) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'); return res.end(await readFile(file)) } catch { return res.writeHead(404).end() }
    }
    if (path.startsWith('/run/lane-g') || path === '/live') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      // Discovery's maintained shell owns these run-page gutters; Runtime LiveRun owns its own padding.
      return res.end(`<!doctype html><html class="${theme}" data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"><style>#agent-workspace[data-mode="run"]{padding:0 1.25rem 2rem}@media(max-width:600px){#agent-workspace[data-mode="run"]{padding-left:16px;padding-right:16px}}</style><div id="agent-workspace" data-mode="${path === '/live' ? 'live' : 'run'}" data-id="lane-g" data-api="/api"></div><script type="module" src="/assets/workspace-viewer.js"></script></html>`)
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    for (theme of ['dark', 'light']) for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 900 } } } : {}) })
      const page = await context.newPage(), errors = []
      const cardNamed = name => page.locator('.ag-live-card').filter({ has: page.locator('.ag-live-name').filter({ hasText: new RegExp(`\\b${name}$`) }) })
      const choose = async name => {
        await page.getByRole('button', { name: 'Go to agent', exact: true }).click()
        await page.locator('.rp-lb input').fill(name)
        await page.getByRole('option', { name: `${name} —`, exact: true }).click()
        await cardNamed(name).waitFor()
      }
      const fit = async () => { await page.locator('.react-flow__controls-fitview, .ag-phone-select').first().waitFor(); const button = page.getByRole('button', { name: 'Fit View', exact: true }); if (await button.count()) await button.click() }
      const capture = async name => { if (!evidence) return; await page.evaluate(async () => { const finite = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)); await Promise.allSettled(finite.map(animation => animation.finished)) }); await page.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png`, fullPage: true }) }
      const countIn = (inspector, label) => inspector.locator('.rp-stat3 > div').filter({ has: page.getByText(new RegExp(`^${label.replace(/s$/, 's?')}$`)) }).locator('b')
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.address().port}/run/lane-g/topology`)
      assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8')
      await page.locator('.rp-topo').waitFor()
      await page.locator('.ag-live-card[data-status="failed"]').waitFor()
      if (width === 1280) {
        await page.setViewportSize({ width: 1322, height: 900 })
        await page.waitForFunction(() => Math.round(document.querySelector('.agent-graph').getBoundingClientRect().width) === 884)
        const counts = await page.locator('.agent-graph [aria-label="Run status"] > span, .agent-graph [aria-label="Run status"] .ag-status-button > span:first-child').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))
        for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) {
          const a = counts[i], b = counts[j]
          assert.equal(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, false, 'Recorded status counts remain distinct in an actual 884px consumer graph')
        }
        await capture('caption-884')
        await page.setViewportSize({ width, height: 900 })
      }
      await capture('loaded-topology')
      assert.equal(await page.locator('.ag-live-card[data-status="failed"]').evaluate(card => card.classList.contains('ag-live-chip')), false)
      assert.match(await page.locator('.ag-live-card[data-status="failed"]').innerText(), /Checkout tests failed/)
      await page.locator('.ag-live-card[data-status="failed"]').click()
      const explanation = page.locator('aside[aria-label="Agent 2"] dd.f')
      await explanation.scrollIntoViewIfNeeded()
      assert.equal(await explanation.innerText(), failureReason)
      const failedInspector = page.locator('aside[aria-label="Agent 2"]')
      assert.equal(await countIn(failedInspector, 'model calls').innerText(), '300', 'Whole recorded model count wins over the bounded display tail')
      assert.equal(await countIn(failedInspector, 'tool calls').innerText(), '500')
      assert.deepEqual(await failedInspector.locator('.rp-lt tbody tr').first().locator('td').allTextContents(), ['gpt-5.5', '300', '—', '—', '—'], 'A capped display tail cannot certify whole-run latency percentiles')
      assert.equal(await explanation.evaluate(node => node.scrollHeight <= node.clientHeight), true)
      await capture('failure-inspector')
      await choose('Agent 15')
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 15"]'), 'model calls').innerText(), '0', 'Observed zero calls remains zero')
      await choose('Agent 16')
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 16"]'), 'model calls').innerText(), '—', 'Unreported call count stays unknown')
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 16"]'), 'tool calls').innerText(), '—')
      assert.doesNotMatch(await page.locator('aside[aria-label="Agent 16"] .rp-kv').innerText(), /by Root/, 'A missing parent edge is not inferred from the agent id')
      await choose('Agent 3')
      assert.ok(await page.locator('[data-activity="quiet"]').count())
      assert.equal(await page.locator('[data-activity="quiet"]').evaluateAll(cards => cards.every(card => !card.getAnimations({ subtree: true }).some(animation => animation.effect?.getTiming().iterations === Infinity))), true)
      await choose('Agent 1')
      await page.locator('.ag-live-card[data-status="needs-you"] button').filter({ hasText: 'Respond' }).waitFor()
      const respond = page.locator('.ag-live-card[data-status="needs-you"] button').filter({ hasText: 'Respond' })
      await capture('before-respond')
      await respond.click({ timeout: 5000 })
      await page.locator('aside[aria-label="Agent 1"]').waitFor()
      assert.match(await page.locator('aside[aria-label="Agent 1"]').innerText(), /Approve the proposed change/)
      assert.equal(await page.locator('aside[aria-label="Agent 1"] dt').filter({ hasText: /^Ended$/ }).locator('+ dd').innerText(), '—', 'An agent without a recorded end cannot borrow the last event timestamp')
      if (width === 390) assert.equal(await page.locator('aside[aria-label="Agent 1"] h2').evaluate(title => { const rect = title.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight }), true, 'Phone selection reveals the selected details')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      if (width === 390) assert.equal(await page.getByRole('list', { name: 'Agents by attention' }).count(), 1)
      await capture('topology')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(100)
      const loops = await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.getTiming().iterations === Infinity).map(animation => { const box = animation.effect.target.getBoundingClientRect(); return { name: animation.animationName, width: box.width, height: box.height, keys: Object.keys(animation.effect.getKeyframes()[0]) } }))
      assert.ok(loops.length, 'Essential opacity activity survives reduced motion')
      for (const loop of loops) { assert.equal(loop.name, 'tangle-breathe'); assert.ok(loop.width <= 6 && loop.height <= 6); assert.ok(!loop.keys.includes('transform')) }
      await page.getByRole('tab', { name: 'Waterfall', exact: true }).click()
      await page.locator('.fw-root').waitFor()
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.matches?.('.fw-state-live') && !animation.effect.pseudoElement && animation.effect.getTiming().iterations === Infinity).length), 0, 'Reduced motion keeps the Live badge static while its inner dot remains essential')
      assert.doesNotMatch(await page.locator('.fw-headline').evaluate(node => getComputedStyle(node, '::before').content), /Â/, 'The stylesheet uses the host UTF-8 encoding')
      await page.getByRole('button', { name: 'Expand Agent', exact: true }).click()
      await capture('loaded-timeline')
      assert.ok(await page.locator('.fw-row[data-activity="quiet"]').count())
      assert.equal(await page.locator('.fw-error-tick').count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      if (evidence) { await capture('timeline'); await page.waitForTimeout(10000) }
      runtimeTotals = undefined
      await page.goto(`http://127.0.0.1:${server.address().port}/live`)
      await page.locator('.ws-live .ag-live-card[data-status="needs-you"]').waitFor()
      assert.equal(await page.getByRole('radio', { name: 'Graph', exact: true }).count(), 1, 'One canonical graph mode control')
      assert.match(await page.locator('.ws-live .ag-live-card[data-status="failed"]').innerText(), /Checkout tests failed/)
      await page.locator('.ws-live .ag-live-card[data-status="failed"]').click()
      const recordedFailure = page.getByRole('complementary', { name: 'Agent 2 conversation' }).getByText(failureReason, { exact: true })
      await recordedFailure.waitFor()
      await recordedFailure.scrollIntoViewIfNeeded()
      assert.equal(await recordedFailure.evaluate(node => node.scrollHeight <= node.clientHeight), true, 'The complete recorded reason remains readable even when the transcript does not repeat it')
      await capture('runtime-failure-details')
      await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
      await fit()
      assert.ok(await page.locator('.ws-live [data-activity="quiet"]').count())
      assert.equal(await cardNamed('Agent 16').getAttribute('data-status'), 'unknown', 'An identity without a recorded lifecycle stays unknown')
      assert.equal(await cardNamed('Agent 15').count(), 1, 'A recorded worker with no start timestamp keeps its card')
      await cardNamed('Agent 15').click()
      await page.getByRole('complementary', { name: 'Agent 15 conversation' }).getByText('Recorded response from the worker without a start timestamp.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
      await fit()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      await page.getByLabel('Graph layout', { exact: true }).selectOption('hub')
      await page.locator('.ag-stats').waitFor()
      assert.equal(await page.locator('.ag-canvas .ag-node').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).position === 'absolute')), true, 'The host cannot move shared Hub nodes into normal document flow')
      assert.equal(await page.locator('.ag-stats > span').nth(1).locator('b').innerText(), '—', 'Unreported tool inventory is unknown in the actual Runtime Hub')
      assert.equal(await page.locator('.ag-stats > span').nth(2).locator('b').innerText(), '—', 'An unreported call history cannot certify zero calls per minute')
      await capture('runtime-unknown-hub')
      const hubHeader = await page.locator('.ag-head').evaluate(header => { const box = header.getBoundingClientRect(); return { header: box.toJSON(), height: getComputedStyle(header).height, flexShrink: getComputedStyle(header).flexShrink, metrics: [...header.querySelectorAll('.ag-stats > span')].map(node => ({ text: node.textContent, ...node.getBoundingClientRect().toJSON() })), canvas: header.nextElementSibling.getBoundingClientRect().toJSON() } })
      console.log('Runtime Hub header geometry', JSON.stringify({ theme, width, ...hubHeader }))
      assert.ok(hubHeader.metrics.every(metric => metric.width > 0 && metric.left >= hubHeader.header.left && metric.right <= hubHeader.header.right && metric.top >= hubHeader.header.top && metric.bottom <= hubHeader.header.bottom && metric.bottom <= hubHeader.canvas.top), 'Every Hub metric must remain visible inside the wrapped header above the canvas')
      await page.getByLabel('Graph layout', { exact: true }).selectOption('tree')
      await fit() // The layout change retains the focused agent; inspect the complete graph explicitly.
      try { await page.locator('.ws-live .ag-live-card[data-status="failed"]').waitFor() } catch (error) {
        if (evidence) {
          await page.screenshot({ path: `${evidence}/tree-return-failure-${theme}-${width}.png`, fullPage: true })
          await (await import('node:fs/promises')).writeFile(`${evidence}/tree-return-failure-${theme}-${width}.html`, await page.content())
        }
        console.log('Tree return diagnosis', JSON.stringify(await page.evaluate(() => ({ layout: document.querySelector('[aria-label="Graph layout"]')?.value, camera: document.querySelector('.react-flow__viewport')?.getAttribute('style'), selected: [...document.querySelectorAll('[data-agent-id][aria-pressed="true"],.react-flow__node.selected')].map(node => node.getAttribute('data-agent-id') ?? node.getAttribute('data-id')), nodes: [...document.querySelectorAll('.ws-live .react-flow__node')].map(node => ({ id: node.dataset.id, text: node.textContent, status: node.querySelector('[data-status]')?.getAttribute('data-status'), className: node.className })), caption: document.querySelector('.ws-live')?.textContent?.slice(0, 500) }))))
        throw error
      }
      await capture('runtime-sse-fixture')
      await page.getByRole('radio', { name: 'Agents', exact: true }).click()
      await page.locator('.fw-root').waitFor()
      assert.equal(await page.locator('.fw-row[data-span-id="lane-g"][data-slowest]').count(), 0, 'The owning supervisor is excluded from leaf comparisons')
      assert.equal(await page.locator('.fw-row[data-span-id="lane-g"] .fw-badge').count(), 0)
      assert.ok(await page.getByTitle('Tokens not reported', { exact: true }).count(), 'Unreported Runtime usage stays unknown')
      assert.ok(await page.getByTitle('Model calls not reported', { exact: true }).count())
      assert.ok(await page.getByTitle('Tool calls not reported', { exact: true }).count())
      runtimeTotals = { tokensInput: 0, tokensOutput: 0, tokensKnown: true }
      await page.reload()
      await page.getByRole('radio', { name: 'Agents', exact: true }).click()
      await page.locator('.fw-root').waitFor()
      assert.ok(await page.getByTitle('0 tokens', { exact: true }).count(), 'Authoritative measured zero is retained')
      assert.equal(await page.getByTitle('Tokens not reported', { exact: true }).count(), 0)
      assert.deepEqual(errors, [])
      await context.close()
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})


test('same-account navigation resets a finished API while same-API frames preserve selection', { timeout: 60_000 }, async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { build } = await import('vite')
  const evidence = process.env.RUN_UI_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  const scratch = await mkdtemp(resolve('.navigation-consumer-'))
  const clients = new Set()
  const frame = (id, status, sequence) => `event: snapshot\ndata: ${JSON.stringify({ sequence, observedAt: now, reset: sequence === 1, snapshots: [{ root: id, generatedAt: now, completeness: 'complete', diagnostics: [], supervisors: [{ id, status, task: `Inspect ${id}`, startedAt: iso(start), workers: [{ id: `${id}-worker`, label: `${id} worker`, status, startedAt: iso(start), runtime: 'codex', liveTail: ['Actual HTTP fixture input'] }] }] }] })}\n\n`
  const entry = resolve(scratch, 'navigation.js')
  await writeFile(entry, `import { createElement, useState } from 'react'; import { createRoot } from 'react-dom/client'; import { Workspace } from '@drewstone/agent-record'; function Host(){ const [api,setApi]=useState('/a'); return createElement('div',{},createElement('button',{onClick:()=>setApi('/b')},'Open run B'),createElement(Workspace,{api,mode:'live',id:api})); } createRoot(document.getElementById('navigation')).render(createElement(Host));`)
  let browser, bResponse, admitB
  const bReady = new Promise(resolve => { admitB = resolve })
  const module = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { write: false, lib: { entry, formats: ['es'], fileName: () => 'navigation.js' }, rollupOptions: { output: { chunkFileNames: 'navigation/[name]-[hash].js' } } } })
  const chunks = new Map((Array.isArray(module) ? module : [module]).flatMap(output => output.output).map(output => [output.fileName, output.type === 'chunk' ? output.code : output.source]))
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (path === '/a/events' || path === '/b/events') {
      res.setHeader('content-type', 'text/event-stream'); res.setHeader('cache-control', 'no-cache'); res.flushHeaders()
      if (path === '/a/events') return res.end(frame('run-A', 'succeeded', 1) + 'event: end\ndata: {}\n\n')
      clients.add(res); bResponse = res; admitB(res); res.write(': connected\n\n'); res.on('close', () => clients.delete(res)); return
    }
    if (path.endsWith('/stream')) { res.setHeader('content-type', 'text/event-stream'); return res.end('event: end\ndata: {}\n\n') }
    if (/^\/[ab]\/agents\//.test(path)) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ coverage: { status: 'missing', source: 'actual-http-fixture', reason: 'No native transcript is supplied' } })) }
    if (path === '/assets/styles.css') { res.setHeader('content-type', 'text/css'); return res.end(await readFile(resolve(assets, 'styles.css'))) }
    const chunk = chunks.get(path.slice(1)); if (chunk !== undefined) { res.setHeader('content-type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(chunk) }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html class="dark" data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"><div id="navigation"></div><script type="module" src="/navigation.js"></script></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(evidence ? { recordVideo: { dir: evidence, size: { width: 1280, height: 900 } } } : {}) })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/navigation`)
    await page.getByText('Finished · viewer closed', { exact: true }).waitFor()
    await page.getByText('Inspect run-A', { exact: true }).waitFor()
    if (evidence) await page.screenshot({ path: `${evidence}/navigation-a-finished.png`, fullPage: true })
    await page.getByRole('button', { name: 'Open run B', exact: true }).click()
    const liveB = page.locator('main.ws-live[data-api="/b"]')
    await liveB.waitFor()
    assert.equal(await liveB.getByText('Finished · viewer closed', { exact: true }).count(), 0, 'New API must not retain the previous run terminal state')
    assert.equal(await liveB.getByText('Inspect run-A', { exact: true }).count(), 0, 'New API must not retain the previous run snapshot')
    if (evidence) await page.screenshot({ path: `${evidence}/navigation-b-before-frame.png`, fullPage: true })
    await bReady
    assert.ok(bResponse, 'The actual B event stream must be connected')
    bResponse.write(frame('run-B', 'running', 1))
    await page.getByText('Inspect run-B', { exact: true }).waitFor()
    const node = page.locator('.react-flow__node[data-id="run-B-worker"]')
    await node.waitFor(); await node.click()
    await page.getByRole('complementary', { name: 'run-B worker conversation', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
    const camera = await page.locator('.react-flow__viewport').getAttribute('style')
    bResponse.write(frame('run-B', 'running', 2))
    await page.waitForFunction(() => document.querySelector('main.ws-live')?.getAttribute('data-top-sequence') === '2')
    assert.equal(await page.locator('.react-flow__node[data-id="run-B-worker"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), camera, 'Same API updates preserve the existing graph camera')
    assert.equal(await page.getByText('Inspect run-A', { exact: true }).count(), 0)
    if (evidence) await page.screenshot({ path: `${evidence}/navigation-b-live.png`, fullPage: true })
    await context.close()
  } finally { await browser?.close(); for (const response of clients) response.end(); await new Promise(resolve => server.close(resolve)); await rm(scratch, { recursive: true, force: true }) }
})


if (process.env.RUNTIME_TUI_MODULE) test('actual retained native bytes cross the product HTTP viewer and preserve selection through capture arrival', { timeout: 120_000 }, async t => {
  const { pathToFileURL } = await import('node:url')
  const { mkdtemp, cp, writeFile, appendFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { createHash } = await import('node:crypto')
  const { join } = await import('node:path')
  const tui = await import(pathToFileURL(process.env.RUNTIME_TUI_MODULE).href)
  const kernel = await import(pathToFileURL(process.env.RUNTIME_KERNEL_MODULE).href)
  const { readSessionInput } = require('@tangle-network/harness-sessions')
  const fixture = process.env.TANGLE_NATIVE_FIXTURE_DIR
  assert.ok(fixture, 'Exact private retained fixture is required')
  const binding = JSON.parse(await readFile(join(fixture, 'binding.json'), 'utf8'))
  assert.equal(binding.runId, '9e0718af-d78d-4453-951c-b7fca6fb3fc7')
  assert.equal(binding.nativeSessionId, '01a18306-af45-7c33-85f7-a7d502723948')
  const raw = await readFile(join(fixture, 'rollout.jsonl'))
  assert.equal(createHash('sha256').update(raw).digest('hex'), '1696971c00d3950e11e0877320e4cfaad817d0f85af6bff17cb0c819fb200d26')
  const source = { nativeSessionId: binding.nativeSessionId, files: binding.files.map(file => ({ ...file, nativeSessionId: binding.nativeSessionId })), read: async () => raw, parse: (text, file) => readSessionInput('codex', { text }, { nativeSessionId: file.nativeSessionId, label: file.path }, { corruption: 'strict' }) }
  const verified = await kernel.readBoundHarnessSessions(source)
  await assert.rejects(kernel.readBoundHarnessSessions({ ...source, read: async () => Buffer.concat([raw, Buffer.from('\n')]) }), /changed/)
  const projection = tui.harnessSessionRows(verified.sessions)
  assert.deepEqual(projection.gaps, [])
  assert.equal(new Set(projection.rows.map(row => row.id)).size, projection.rows.length)
  assert.equal(projection.rows.filter(row => row.event.kind === 'user').length, 2)
  for (const message of verified.sessions[0].messages.filter(message => message.role === 'user')) { const row = projection.rows.find(row => row.id.includes(message.id)); assert.ok(row, 'Canonical native message identity is retained'); assert.equal(row.event.actor, message.actor) }
  assert.equal(projection.rows.filter(row => row.event.kind === 'tool-call').length, 2)
  assert.equal(projection.rows.filter(row => row.event.kind === 'tool-result').length, 2)
  const manifest = JSON.parse(await readFile(join(fixture, 'runtime-manifest.json'), 'utf8'))
  assert.equal(manifest.files.length, 8)
  for (const file of manifest.files) {
    const bytes = await readFile(join(fixture, 'run', file.path))
    assert.equal(bytes.byteLength, file.byteLength)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  }
  const root = await mkdtemp(join(tmpdir(), 'retained-native-viewer-'))
  const run = join(root, 'run')
  await cp(join(fixture, 'run'), run, { recursive: true })
  const journal = await readFile(join(run, 'spawn-journal.jsonl'), 'utf8')
  const observer = await readFile(join(run, 'observer.jsonl'), 'utf8')
  const prefix = (text, count) => text.split('\n').slice(0, count).join('\n') + '\n'
  await writeFile(join(run, 'spawn-journal.jsonl'), prefix(journal, 12))
  await writeFile(join(run, 'observer.jsonl'), prefix(observer, 2))
  await rm(join(run, 'result.json'))
  let captureVisible = false, substituted, decoderCalls = 0
  const blobs = new kernel.FileResultBlobStore(join(run, 'blobs'))
  const web = await tui.serveTopWeb({ roots: [run], assets, source: async request => {
    if (substituted) {
      const snapshot = await tui.loadTopSnapshot(run, { runDir: run, format: 'journal' })
      const worker = snapshot.supervisors[0].workers.find(worker => worker.id === request.workerId)
      assert.ok(worker, 'Substitution probe uses the actual selected journal node')
      return tui.readTopAgentInspection({ runId: binding.runId, worker: { ...worker, harnessTranscript: substituted }, blobs, signal: request.signal, readSessions: async () => { decoderCalls++; throw new Error('A rejected source must not decode native bytes') } })
    }
    return {
    coverage: { status: captureVisible ? 'partial' : 'missing', source: 'Exact retained9e0718 native bytes', reason: captureVisible ? 'Historical cwd and OTLP attestation; not modern effective-store metadata or fresh production proof' : 'Retained native source not yet attached', ref: 'urn:sha256:1696971c00d3950e11e0877320e4cfaad817d0f85af6bff17cb0c819fb200d26' },
    ...(captureVisible && request.workerId === binding.workerId ? { rows: projection.rows } : {}),
    files: { scope: 'none', complete: true, reason: 'Original graph is read-only; no workspace inventory was captured', entries: [] },
  } } })
  const evidence = process.env.RUN_UI_EVIDENCE_DIR
  let browser, retainedPage, measuredState
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', ...(evidence ? { recordVideo: { dir: evidence, size: { width: 1440, height: 900 } } } : {}) })
    const page = await context.newPage(), errors = []
    retainedPage = page
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(web.url)
    await page.locator('.ws-live .ag-live-card').filter({ hasText: 'root' }).click()
    await page.getByRole('complementary', { name: 'root conversation', exact: true }).waitFor()
    await page.locator('.ws-live .ag-live-card').filter({ hasText: 'fetch-pr' }).click()
    await page.getByRole('complementary', { name: 'fetch-pr conversation', exact: true }).getByText('Request from', { exact: false }).first().waitFor()
    const main = page.locator('.ws-live')
    const firstSequence = await main.getAttribute('data-top-sequence')
    await page.evaluate(url => new Promise((resolve, reject) => {
      window.retainedFrames = []
      const source = new EventSource(url)
      source.addEventListener('reset', message => window.retainedFrames.push({ event: 'reset', ...JSON.parse(message.data) }))
      source.addEventListener('rows', message => { const frame = JSON.parse(message.data); window.retainedFrames.push({ event: 'rows', generation: frame.generation, ids: frame.events.map(row => row.id), window: frame.window }); resolve() })
      source.addEventListener('end', () => source.close())
      source.onerror = () => reject(new Error('Actual selected stream disconnected before its first frame'))
    }), `${web.url}api/top/agents/0/${binding.runId}/${binding.workerId}/stream`)
    const viewport = page.locator('.react-flow__viewport').first()
    await viewport.waitFor()
    await page.locator('.react-flow__controls-zoomin').click()
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)))
    const settleCamera = () => page.waitForFunction(() => { const style = document.querySelector('.react-flow__viewport')?.getAttribute('style'); const current = window.retainedCameraProbe; if (!current || current.style !== style) { window.retainedCameraProbe = { style, at: performance.now() }; return false } return performance.now() - current.at >= 250 })
    await settleCamera()
    const camera = await viewport.getAttribute('style')
    const conversation = page.getByRole('complementary', { name: 'fetch-pr conversation', exact: true })
    const scroller = conversation.locator('[data-primary-content]')
    const scrollBefore = await scroller.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight, pinned: node.scrollHeight - node.scrollTop - node.clientHeight < 48 }))
    captureVisible = true
    await appendFile(join(run, 'spawn-journal.jsonl'), journal.slice(prefix(journal, 12).length))
    await appendFile(join(run, 'observer.jsonl'), observer.slice(prefix(observer, 2).length))
    await cp(join(fixture, 'run', 'result.json'), join(run, 'result.json'))
    await page.waitForFunction(previous => document.querySelector('.ws-live')?.getAttribute('data-top-sequence') !== previous, firstSequence)
    await page.getByText('Use GitHub Hub to read drewstone/cli-bridge PR296 and return its actual merge evidence as JSON.', { exact: false }).last().waitFor()
    await page.getByText('Original graph is read-only; no workspace inventory was captured', { exact: false }).waitFor()
    await settleCamera()
    measuredState = { source: 'historical9e0718', selectedBefore: 'fetch-pr conversation', selectedAfter: await conversation.getAttribute('aria-label'), cameraBefore: camera, cameraAfter: await viewport.getAttribute('style'), scrollBefore, scrollAfter: await scroller.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight, pinned: node.scrollHeight - node.scrollTop - node.clientHeight < 48 })), snapshotBefore: firstSequence, snapshotAfter: await main.getAttribute('data-top-sequence'), productionNative: 'NOT_RUN' }
    if (evidence) { await writeFile(join(evidence, 'retained-native-state.json'), JSON.stringify(measuredState, null, 2) + '\n'); await page.screenshot({ path: join(evidence, 'retained-native-desktop.png'), fullPage: true }) }
    assert.equal(measuredState.selectedAfter, measuredState.selectedBefore, 'Actual selected conversation survives the snapshot update')
    await t.test('the actual native snapshot preserves the reader camera', () => assert.equal(measuredState.cameraAfter, measuredState.cameraBefore, 'Real snapshot update keeps the camera'))
    if (scrollBefore.pinned) assert.equal(measuredState.scrollAfter.pinned, true, 'Pinned conversation continues following arriving messages')
    else assert.equal(measuredState.scrollAfter.top, scrollBefore.top, 'An unpinned reading position is preserved')
    const frames = await page.evaluate(() => window.retainedFrames)
    const resets = frames.filter(frame => frame.event === 'reset')
    assert.equal(resets.length, 2, 'The same real selected HTTP stream resets when native evidence arrives')
    assert.notEqual(resets[0].generation, resets[1].generation)
    const retainedIds = frames.filter(frame => frame.event === 'rows' && frame.generation === resets[1].generation).flatMap(frame => frame.ids).filter(Boolean)
    assert.equal(retainedIds.length, new Set(retainedIds).size, 'Retained native rows do not duplicate fallback rows')
    assert.match(await main.innerText(), /gpt-6\.1-sol/)
    assert.match(await main.innerText(), /Request from/)
    assert.equal(await page.locator('[data-capture-status="partial"]').count(), 1)
    const environment = page.locator('pre.ws-code').filter({ hasText: /^<environment_context>/ })
    assert.equal(await environment.isVisible(), false, 'Injected environment context is collapsed by default')
    await page.getByText('Recorded context', { exact: true }).click()
    await environment.waitFor()
    await page.getByText('Recorded context', { exact: true }).click()
    const metadata = await (await fetch(`${web.url}api/top/agents/0/${binding.runId}/${binding.workerId}`)).json()
    assert.ok(metadata.context.some(row => row.event.actor === 'injected' && row.event.text?.startsWith('<environment_context>')), 'Recorded injected actor and raw context survive disclosure projection')
    const stream = await (await fetch(`${web.url}api/top/agents/0/${binding.runId}/${binding.workerId}/stream`)).text()
    assert.match(stream, /"kind":"user"/)
    assert.match(stream, /"kind":"tool-call"/)
    assert.match(stream, /"kind":"tool-result"/)
    assert.match(stream, /event: end/)
    // Real recorded bytes remain private. These are deliberately forged, hash-valid capture
    // metadata probes, not evidence that the historical producer emitted a modern binding.
    const selected = (await tui.loadTopSnapshot(run, { runDir: run, format: 'journal' })).supervisors[0].workers.find(worker => worker.id === binding.workerId)
    assert.equal(selected.materialization.status, 'known')
    const node = { rootId: binding.runId, nodeId: selected.id, parentId: selected.parent, attemptId: selected.executionBindings[0].attemptId, identity: selected.identity }
    const negative = []
    for (const attack of ['node', 'profile']) {
      const artifact = { schemaVersion: 1, harness: 'codex', binding: { kind: 'bridge', sessionId: selected.materialization.execution.id, nativeSessionId: binding.nativeSessionId, profileDigest: attack === 'profile' ? 'sha256:' + '0'.repeat(64) : selected.materialization.effectiveProfileDigest, node: { ...node, ...(attack === 'node' ? { nodeId: 'another-recorded-node' } : {}) }, runs: [] }, files: [{ path: binding.files[0].path, bytes: raw.byteLength, content: new TextDecoder('utf-8', { fatal: true }).decode(raw) }], skipped: [] }
      const ref = kernel.contentAddress(artifact)
      await blobs.put(ref, artifact)
      substituted = { status: 'available', harness: 'codex', transcriptRef: ref, fileCount: 1, totalBytes: raw.byteLength, skippedCount: 0, coverageComplete: true }
      const denied = await (await fetch(`${web.url}api/top/agents/0/${binding.runId}/${binding.workerId}`)).json()
      assert.equal(denied.coverage.status, 'missing')
      assert.equal(denied.coverage.code, 'source-mismatch')
      assert.match(denied.coverage.reason, attack === 'node' ? /nodeId/ : /profile/)
      negative.push({ attack, coverage: denied.coverage })
    }
    substituted = undefined
    assert.equal(decoderCalls, 0, 'Wrong-node/profile content is refused before native decoding')
    // Keyboard controls operate the real existing graph and conversation drawer.
    const close = page.getByRole('button', { name: 'Close conversation', exact: true })
    await close.focus(); await page.keyboard.press('Escape')
    await conversation.waitFor({ state: 'hidden' })
    const retainedCamera = await viewport.getAttribute('style')
    const rootNode = page.locator(`.react-flow__node[data-id="${binding.runId}"]`)
    await rootNode.focus(); await page.keyboard.press('Enter')
    await page.getByRole('complementary', { name: 'root conversation', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
    assert.equal(await viewport.getAttribute('style'), retainedCamera, 'Dismissing and switching agent preserves graph camera')
    const fetchNode = page.locator(`.react-flow__node[data-id="${binding.workerId}"]`)
    await fetchNode.focus(); await page.keyboard.press('Enter')
    await conversation.waitFor()
    await page.getByRole('radio', { name: 'Agents', exact: true }).click()
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    const prompt = conversation.getByText('Use GitHub Hub to read drewstone/cli-bridge PR296 and return its actual merge evidence as JSON.', { exact: false })
    await prompt.waitFor({ state: 'hidden' })
    await page.getByRole('radio', { name: 'Graph', exact: true }).click()
    assert.equal(await page.locator(`.react-flow__node[data-id="${binding.workerId}"]`).count(), 0, 'Graph and native conversation both omit work after the replay cursor')
    await page.getByRole('radio', { name: 'Agents', exact: true }).click()
    await page.getByRole('button', { name: 'Show full trace', exact: true }).click()
    await prompt.waitFor()
    await page.getByRole('radio', { name: 'Graph', exact: true }).click()
    await page.locator(`.react-flow__node[data-id="${binding.workerId}"]`).waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const motion = await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, transforms: document.getAnimations().filter(animation => animation.effect?.getTiming().iterations === Infinity && animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none')).length }))
    assert.equal(motion.reduced, true)
    assert.equal(motion.transforms, 0, 'Reduced motion has no decorative infinite transform')
    measuredState.interaction = { sourceSubstitution: negative, decoderCalls, keyboard: 'PASS_GRAPH_ENTER_DRAWER_ESCAPE', replay: 'PASS_RESTART_FILTERS_NATIVE_PROMPT_FULL_TRACE_RESTORES', reducedMotion: motion, files: 'N/A_READ_ONLY_ORIGINAL' }
    if (evidence) { await writeFile(join(evidence, 'retained-native-state.json'), JSON.stringify(measuredState, null, 2) + '\n'); await page.screenshot({ path: join(evidence, 'retained-native-desktop.png'), fullPage: true }) }
    assert.deepEqual(errors, [])
    await context.close()
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...(evidence ? { recordVideo: { dir: evidence, size: { width: 390, height: 844 } } } : {}) })
    const mobile = await phone.newPage()
    mobile.on('pageerror', error => errors.push(error.message))
    await mobile.goto(web.url)
    const phoneAgent = name => mobile.locator(`.ag-phone-select[data-agent-id="${name === 'root' ? binding.runId : binding.workerId}"]`)
    await phoneAgent('fetch-pr').click()
    await mobile.getByRole('complementary', { name: 'fetch-pr conversation', exact: true }).waitFor()
    await mobile.getByText('Original graph is read-only; no workspace inventory was captured', { exact: false }).waitFor()
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone has no horizontal page overflow')
    await mobile.getByRole('button', { name: 'Close conversation', exact: true }).click()
    await mobile.getByRole('complementary', { name: 'fetch-pr conversation', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await phoneAgent('fetch-pr').getAttribute('aria-pressed'), 'true', 'Phone close retains selected agent context')
    await phoneAgent('root').focus(); await mobile.keyboard.press('Enter')
    await mobile.getByRole('complementary', { name: 'root conversation', exact: true }).waitFor()
    await mobile.getByRole('button', { name: 'Close conversation', exact: true }).focus(); await mobile.keyboard.press('Escape')
    await mobile.getByRole('complementary', { name: 'root conversation', exact: true }).waitFor({ state: 'hidden' })
    await phoneAgent('fetch-pr').click()
    await mobile.getByRole('complementary', { name: 'fetch-pr conversation', exact: true }).getByText('Use GitHub Hub to read drewstone/cli-bridge PR296 and return its actual merge evidence as JSON.', { exact: false }).waitFor()
    measuredState.interaction.phone = 'PASS_CLOSE_RETAINS_SELECTION_SWITCH_ROOT_KEYBOARD_REOPEN_FETCH'
    if (evidence) { await writeFile(join(evidence, 'retained-native-state.json'), JSON.stringify(measuredState, null, 2) + '\n'); await mobile.screenshot({ path: join(evidence, 'retained-native-phone.png'), fullPage: true }) }
    assert.deepEqual(errors, [], 'Desktop and phone have no uncaught browser errors')
    await phone.close()
    console.log(JSON.stringify({ source: 'historical9e0718', nativeSha256: '1696971c00d3950e11e0877320e4cfaad817d0f85af6bff17cb0c819fb200d26', rows: projection.rows.length, sourceFiles: verified.files.length, realUserMessages: 2, nativeToolPairs: 2, viewport: ['1440x900', '390x844'], workspace: 'N/A', productionNative: 'NOT_RUN' }))
  } finally { if (evidence && retainedPage && !retainedPage.isClosed()) { await retainedPage.screenshot({ path: join(evidence, 'retained-native-final.png'), fullPage: true }).catch(() => {}); if (!measuredState) await writeFile(join(evidence, 'retained-native-state.json'), JSON.stringify({ source: 'historical9e0718', selectionCameraMeasurement: 'NOT_REACHED', productionNative: 'NOT_RUN' }, null, 2) + '\n') } await browser?.close(); await web.close(); await rm(root, { recursive: true, force: true }) }
})
