import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const assets = dirname(require.resolve('@drewstone/agent-record/workspace-viewer.js'))
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
  const browser = await chromium.launch({ headless: true })
  try {
    for (theme of ['dark', 'light']) for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 900 } } } : {}) })
      const page = await context.newPage(), errors = []
      const cardNamed = name => page.locator('.ag-live-card').filter({ has: page.locator('.ag-live-name').filter({ hasText: new RegExp(`\\b${name}$`) }) })
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
      await cardNamed('Agent 15').click()
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 15"]'), 'model calls').innerText(), '0', 'Observed zero calls remains zero')
      await cardNamed('Agent 16').click()
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 16"]'), 'model calls').innerText(), '—', 'Unreported call count stays unknown')
      assert.equal(await countIn(page.locator('aside[aria-label="Agent 16"]'), 'tool calls').innerText(), '—')
      assert.doesNotMatch(await page.locator('aside[aria-label="Agent 16"] .rp-kv').innerText(), /by Root/, 'A missing parent edge is not inferred from the agent id')
      await page.locator('.ag-live-card[data-status="needs-you"] button').filter({ hasText: 'Respond' }).waitFor()
      assert.ok(await page.locator('[data-activity="quiet"]').count())
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
      assert.equal(await page.locator('[data-activity="quiet"]').evaluateAll(cards => cards.every(card => !card.getAnimations({ subtree: true }).some(animation => animation.effect?.getTiming().iterations === Infinity))), true)
      await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
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
      assert.ok(await page.locator('.ws-live [data-activity="quiet"]').count())
      assert.equal(await cardNamed('Agent 16').getAttribute('data-status'), 'unknown', 'An identity without a recorded lifecycle stays unknown')
      assert.equal(await cardNamed('Agent 15').count(), 1, 'A recorded worker with no start timestamp keeps its card')
      await cardNamed('Agent 15').click()
      await page.getByRole('complementary', { name: 'Agent 15 conversation' }).getByText('Recorded response from the worker without a start timestamp.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
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
      await page.locator('.ws-live .ag-live-card[data-status="failed"]').waitFor()
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
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
