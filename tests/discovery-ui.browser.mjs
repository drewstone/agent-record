import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const assets = dirname(require.resolve('@drewstone/agent-record/workspace-viewer.js'))
const start = Date.parse('2026-10-28T12:00:00Z'), iso = seconds => new Date(start + seconds * 1000).toISOString()
const runId = 'magnetar-rust-sandbox-20261027f'
const prompt = 'Build the complete prover and retain the evidence. '.repeat(16)
const rows = [
  { seq: 0, at: iso(0), attempt: 1, event: { kind: 'text_delta', text: 'I will inspect the retained evidence.' } },
  { seq: 1, at: iso(1), attempt: 1, event: { kind: 'tool_call', toolCallId: 'read', toolName: 'read_file', args: { path: 'proof.txt' } } },
  { seq: 2, at: iso(2), attempt: 1, event: { kind: 'tool_result', toolCallId: 'read', result: 'Exact retained evidence, with source provenance.' } },
  { seq: 3, at: iso(60), attempt: 2, event: { kind: 'text_delta', text: 'Waiting on worker; ending the turn.' } },
  { seq: 4, at: iso(120), attempt: 3, event: { kind: 'text_delta', text: 'Waiting on worker; ending the turn.' } },
  { seq: 5, at: iso(180), attempt: 4, event: { kind: 'text_delta', text: 'Waiting on worker; ending the turn.' } },
  { seq: 6, at: iso(181), attempt: 5, event: { kind: 'text_delta', text: 'A new proof failure requires attention.' } },
  { seq: 7, at: iso(182), attempt: 5, event: { kind: 'tool_call', toolCallId: 'check', toolName: 'bash', args: { command: 'check proof' } } },
  { seq: 8, at: iso(183), attempt: 5, event: { kind: 'tool_result', toolCallId: 'check', result: { error: 'Proof verification failed: witness mismatch' } } },
]
const tail = rows.slice(3).map(row => ({ ...row, seq: row.seq + 200 }))
const nodes = Array.from({ length: 124 }, (_, i) => ({ id: i ? `${runId}:s${i}` : runId, label: i ? `Worker ${i}` : 'root', parent: i ? runId : null, kind: 'agent', status: 'running', start: iso(0), end: null, model: 'Recorded model', harness: 'codex', usage: { calls: 1, tokens: 12, tools: { read: { calls: 1, failures: 0, ms: 1 } }, steps: [{ kind: 'tool', startMs: start, endMs: start + 1, tool: 'read', failed: false }] } }))

// Recorded totals deliberately differ from the bounded display steps.
nodes[0].usage = { listUsd: 1.25, listComplete: false, billedUsd: null, billedComplete: false, calls: 413, tokens: 100000, byClass: { input: 70000, output: 20000, cacheRead: 10000 }, latencyMs: { p50: 9000, p90: 20000 }, failures: { model: 3, tool: 2 }, retries: { model: 7, tool: 1 }, tools: { read: { calls: 321, failures: 2, ms: 321000 } }, steps: [...nodes[0].usage.steps, { kind: 'model', startMs: start + 1, endMs: start + 1001, failed: false, byClass: { input: 1, output: 1, cacheRead: 0 } }] }

nodes[0].shipped = 190
nodes[1].status = 'failed'; nodes[1].end = iso(200)
nodes[2].status = 'succeeded'; nodes[2].end = iso(300); nodes[2].shipped = 0
nodes[3].status = 'succeeded'; nodes[3].end = iso(300); nodes[3].shipped = 8
nodes[0].restarts = []
const fullRootUsage = nodes[0].usage

test('HTTP Discovery chat preserves prompts, folds idle turns, retains failures and navigates 124 agents', { timeout: 120_000 }, async () => {
  const evidence = process.env.DISCOVERY_UI_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  let theme = 'light', alive = true
  const requests = [], streams = new Set()
  const releases = [1, 2].map(n => ({ release: `rc${n}`, commit: String(n).repeat(12), taggedAt: iso(n * 100), checked: true, passed: 1, total: 2, steps: [{ label: 'Offline build', state: 'pass' }, { label: 'Verify proof', state: 'fail' }], files: { [runId]: ['a-checksum.sha', 'b-notes.md', 'answer.ts', 'src/verifier.rs', 'proof.log', ...Array.from({ length: 120 }, (_, i) => i === 119 ? 'z-evidence-119.log' : `z-evidence-${String(i).padStart(3, '0')}/${'nested/'.repeat(12)}receipt.log`)] } }))
  const workspace = () => ({ schema: 'agent-workspace.run-workspace.v1', runId, live: alive, nodes, edges: nodes.slice(1).map(node => ({ from: runId, to: node.id, kind: 'spawn' })), releases, best: 'rc2', code: { available: false, reason: 'No code fixture' } })
  const runDocument = () => ({ schema: 'agent-workspace.run.v1', run: { id: runId, play: 'magnetar-rust-sandbox', state: alive ? 'running' : 'stopped', startedAt: iso(0), location: { kind: 'dir', path: null }, record: { status: 'missing', digest: null } }, input: { objective: prompt, instruction: '' }, spend: { nodes: {} }, versions: [], live: { polling: alive }, execution: { alive } })
  const emit = document => { for (const stream of streams) stream.write(`event: workspace\ndata: ${JSON.stringify({ workspace: document, run: runDocument() })}\n\n`) }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname
    const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
    if (path.endsWith('/transcript')) {
      requests.push(url.search)
      const head = url.searchParams.has('before'), after = url.searchParams.has('after')
      const events = url.searchParams.get('node')?.endsWith(':s123') ? [
        { seq: 0, at: iso(10), stream: 'native', type: 'message.updated', data: { info: { id: 'steer-1', role: 'user' } } },
        { seq: 1, at: iso(10), stream: 'native', type: 'message.part.updated', data: { part: { id: 'steer-text', messageID: 'steer-1', type: 'text', text: 'Retain the failing witness and investigate it.', time: { start: start + 10000 } } } },
      ] : after ? [] : head || !alive ? rows : tail
      return json({ runId, node: runId, generation: 'fixture', alive, events, nodes, firstSeq: events[0]?.seq ?? null, lastSeq: events.at(-1)?.seq ?? null, hasEarlier: !head && alive, hasMore: false })
    }
    if (path.endsWith('/stream') && url.searchParams.get('workspace') === '1') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(': connected\n\n')
      streams.add(res)
      res.on('close', () => streams.delete(res))
      return
    }
    if (path.endsWith('/workspace')) return json(workspace())
    if (path === `/api/runs/${runId}`) return json(runDocument())
    if (path.startsWith('/api/plays/')) return json({ id: 'magnetar-rust-sandbox', runs: [] })
    if (path.startsWith('/assets/')) {
      const file = resolve(assets, path.slice(8))
      if (!file.startsWith(assets + '/')) return res.writeHead(400).end()
      try { res.setHeader('content-type', extname(file) === '.css' ? 'text/css' : 'text/javascript'); return res.end(await readFile(file)) } catch { return res.writeHead(404).end() }
    }
    if (path.startsWith('/run/')) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(`<!doctype html><html class="${theme}" data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"><style>body{margin:0}#agent-workspace{padding:0 20px 32px}@media(max-width:600px){#agent-workspace{padding-left:16px;padding-right:16px}}</style><div id="agent-workspace" data-mode="run" data-theme="${theme}" data-id="${runId}" data-api="/api"></div><script type="module" src="/assets/workspace-viewer.js"></script></html>`)
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    for (theme of ['light', 'dark']) for (const width of [1512, 390]) {
      alive = true
      const context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 982 } } } : {}) })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      const root = page.locator('.rp-alist button').filter({ has: page.getByText('root', { exact: true }) })
      const open = async () => {
        await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/conversations`)
        await root.waitFor()
        if (width === 390) await root.click()
        await page.locator('.conversation-scroll').waitFor()
      }
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/overview`)
      await page.locator('.ov-meter-steps li').first().waitFor()
      assert.equal(await page.locator('.ov-meter-steps li').count(), 2)
      assert.equal(await page.locator('.ov-meter-steps [aria-current="step"] > span').innerText(), 'Verify proof')
      assert.equal(await page.locator('.ov-meter-steps [aria-current="step"] .ov-step-state').innerText(), 'Stuck')
      assert.match(await page.locator('.rj-releases').innerText(), /rc1–rc2: all 1\/2/)
      assert.equal(await page.locator('.rp-stats').count(), 0, 'only identity, status and elapsed precede the tabs')
      assert.ok(await page.locator('.ov-gantt [data-lane]').count() < 40)
      assert.ok((await page.locator(`[data-lane="${runId}"] .ov-gantt-count`).textContent()).includes('190'), 'the authoritative recorded count is retained')
      const failedColor = await page.locator(`[data-lane="${runId}:s1"] [data-state=fail] rect`).evaluate(node => getComputedStyle(node).fill)
      const rgb = failedColor.match(/[\d.]+/g).map(Number)
      assert.ok(rgb[0] > rgb[1] * 1.5 && rgb[0] > rgb[2] * 1.5, `failed work is visibly red in ${theme}: ${failedColor}`)
      await page.getByRole('button', { name: 'root', exact: true }).click()
      await page.locator('.rj-drill').waitFor()
      assert.ok((await page.locator(`[data-lane="${runId}"] .ov-gantt-end title`).textContent()).includes('≥$1.25'), 'selected span retains the recorded duration and cost')
      assert.match(page.url(), /agent=root/)
      assert.deepEqual((await page.locator('.rj-drill code').allTextContents()).slice(0, 2), ['answer.ts', 'src/verifier.rs'], 'source files precede checksum, Markdown and log artifacts')
      assert.ok((await page.locator('.rj-drill dd').first().innerText()).startsWith('Build the complete prover'), 'root Task retains the recorded run objective')
      const files = page.locator('.rj-files')
      assert.ok(await files.getByRole('listitem').count() < 100, '125 changed files render a bounded window')
      await files.focus()
      await page.keyboard.press('End')
      await files.getByText('z-evidence-119.log', { exact: true }).waitFor()
      assert.ok(await files.getByRole('listitem').count() < 100, 'the last changed file is reachable without expanding the DOM')
      await page.keyboard.press('Home')
      await files.getByText('answer.ts', { exact: true }).waitFor()
      const updated = { ...workspace(), releases: [...releases, { ...releases[1], release: 'rc3', taggedAt: iso(250), passed: 2, steps: releases[1].steps.map(step => ({ ...step, state: 'pass' })) }], best: 'rc3' }
      emit(updated)
      await page.getByText('every step passes', { exact: false }).waitFor()
      assert.equal(await page.locator('.ov-meter-steps [aria-current]').count(), 0, 'SSE updates the actual ladder without a reload')
      emit({ ...updated, releases: [...updated.releases, { release: 'rc4', taggedAt: iso(270), checked: false, passed: null, total: null, steps: [] }] })
      const unchecked = page.locator('.rj-releases a').filter({ hasText: 'rc4' })
      await unchecked.waitFor()
      assert.equal(await unchecked.getAttribute('data-pass'), null, 'unknown check counts cannot appear as passed')
      assert.equal(await page.locator('.ov-gantt [data-mark=release]').filter({ has: page.locator('title').filter({ hasText: 'rc4' }) }).first().getAttribute('data-verdict'), 'unknown', 'the same unknown verdict colors the timeline release diamond')
      assert.equal(await page.locator('.rj-releases a').filter({ hasText: 'rc3' }).getAttribute('data-pass'), 'true', 'the recorded passing release retains its success color')
      if (evidence) await page.screenshot({ path: `${evidence}/overview-${width}-${theme}.png` })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await open()
      await page.locator('[data-idle-group="3"]').waitFor()
      assert.equal(await page.getByText('Waiting on worker; ending the turn.', { exact: true }).count(), 0, 'duplicates are folded, never discarded')
      assert.ok(await page.locator('[data-turn-start] time').count() > 0, 'turn boundaries carry actual times')
      await page.getByRole('button', { name: /3 idle turns/ }).click()
      assert.equal(await page.getByText('Waiting on worker; ending the turn.', { exact: true }).count(), 3)
      await page.getByRole('button', { name: /3 idle turns/ }).click()
      await page.getByRole('button', { name: 'Beginning', exact: true }).click()
      await page.getByRole('button', { name: 'Full prompt', exact: true }).waitFor()
      const requestCount = requests.length
      await page.waitForTimeout(3200)
      assert.equal(requests.length, requestCount, 'reading the beginning does not poll or drain history')
      const bubble = page.locator('[data-timeline-step="user"] .justify-end').first()
      assert.ok(await bubble.count(), 'initial prompt uses the shared right-aligned user message')
      await page.getByRole('button', { name: 'Full prompt', exact: true }).click()
      assert.ok((await page.locator('[data-timeline-step="user"]').innerText()).includes(prompt.trim()))
      await page.getByRole('button', { name: /Read.*proof.txt/i }).click()
      await page.getByText('Exact retained evidence, with source provenance.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Latest', exact: true }).click()
      await page.locator('[data-idle-group="3"]').waitFor()
      await page.getByRole('button', { name: /Shell.*check proof/i }).click()
      await page.getByText('Proof verification failed: witness mismatch', { exact: true }).last().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long play/run header and transcript fit the phone')
      assert.ok(await page.locator('.virtual-row').count() < 100)
      if (evidence) await page.screenshot({ path: `${evidence}/chat-${width}-${theme}.png` })
      if (width === 390) await page.getByRole('button', { name: 'All agents', exact: true }).click()
      assert.ok(await page.locator('.rp-alist [role=listitem]').count() < 100, '124 agents use a bounded list')
      await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('Worker 123')
      await page.getByRole('listitem').filter({ has: page.getByText('Worker 123', { exact: true }) }).click()
      await page.locator('.conversation-scroll').waitFor()
      await page.locator('[data-timeline-step="user"]').getByText('Retain the failing witness and investigate it.', { exact: true }).waitFor()
      assert.ok(requests.some(query => query.includes('s123')), 'selection fetches the selected agent')
      const liveConnection = page.waitForResponse(response => response.url().includes('/stream') && new URL(response.url()).searchParams.get('workspace') === '1')
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/timeline`)
      await liveConnection
      const tree = page.getByRole('treegrid', { name: 'Trace timeline', exact: true })
      await tree.waitFor()
      await page.getByRole('button', { name: 'Expand Worker', exact: true }).click()
      assert.ok(Number(await tree.getAttribute('aria-rowcount')) >= 124)
      assert.ok(await tree.getByRole('row').count() < 60, '124 agents retain a bounded Waterfall window')
      assert.equal(await page.locator('.fw-kind-rule').count(), 0)
      if (width === 390) assert.ok((await page.locator('.fw-root').boundingBox()).height >= 600, 'phone Waterfall uses the available viewport instead of a fixed 520px card')
      await page.getByRole('button', { name: 'Expand root', exact: true }).click()
      nodes[0].usage = { ...fullRootUsage, steps: [...fullRootUsage.steps, { kind: 'tool', tool: 'waterfall_live_append', startMs: start + 2000, endMs: start + 6000, failed: false }] }
      const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length)
      emit(workspace())
      await tree.getByText('waterfall_live_append', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), navigationCount, 'native SSE appends a recorded tool without navigation')
      const spawned = { ...nodes[4], id: `${runId}:arrival`, label: 'SSE arrival', start: new Date().toISOString(), end: null, usage: { calls: 0, tokens: 0, steps: [], tools: {} } }
      const arrivalWorkspace = workspace()
      emit({ ...arrivalWorkspace, nodes: [...nodes, spawned], edges: [...arrivalWorkspace.edges, { from: runId, to: spawned.id, kind: 'spawn' }] })
      await tree.focus(); await page.keyboard.press('End')
      const arrivalBar = tree.locator(`[data-span-id="${spawned.id}"] .fw-bar`)
      await arrivalBar.waitFor()
      const arrivalGeometry = await arrivalBar.evaluate(el => ({ width: el.getBoundingClientRect().width, opacity: Number(getComputedStyle(el).opacity) }))
      assert.ok(arrivalGeometry.width >= 2.9 && arrivalGeometry.opacity > .1, 'a live arrival appears immediately even before the next visible clock pixel')
      if (evidence) await page.screenshot({ path: `${evidence}/waterfall-arrival-${width}-${theme}.png` })
      emit(workspace())
      await tree.getByText('SSE arrival', { exact: true }).waitFor({ state: 'detached' })
      await page.keyboard.press('Home')
      const slider = page.getByRole('slider', { name: 'Playback position', exact: true })
      await slider.focus(); await page.keyboard.press('Home')
      await page.getByRole('button', { name: 'Follow live', exact: true }).waitFor()
      assert.equal(await slider.inputValue(), '0', 'the live trace can be scrubbed to its start')
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await page.waitForFunction(() => Number(document.querySelector('.fw-slider').value) > 0)
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await page.getByRole('button', { name: 'Follow live', exact: true }).click()
      await page.waitForFunction(() => { const input = document.querySelector('.fw-slider'); return Number(input.value) === Number(input.max) })
      await tree.focus(); await page.keyboard.press('End')
      await tree.getByText('Worker 123', { exact: true }).waitFor()
      assert.ok(await tree.getByRole('row').count() < 60)
      await page.keyboard.press('Home')
      await page.getByRole('button', { name: 'Collapse root', exact: true }).click()
      nodes[0].usage = fullRootUsage; emit(workspace())
      if (evidence) await page.screenshot({ path: `${evidence}/waterfall-live-${width}-${theme}.png` })
      const bar = page.locator('.fw-bar').first()
      await bar.waitFor()
      const bounds = await bar.boundingBox()
      await bar.hover({ position: { x: Math.min(6, bounds.width - 1), y: bounds.height / 2 } })
      const card = page.locator('.fw-card')
      await card.waitFor()
      const metric = label => card.locator('.fw-card-table > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')
      assert.equal(await metric('Model calls').innerText(), '413', 'full recorded count wins over the one displayed model call')
      assert.equal(await metric('Tool calls').innerText(), '321')
      assert.equal(await metric('Tool failures').innerText(), '2')
      const lane = await page.locator(`[data-span-id="${runId}"] .fw-subtitle`).innerText()
      assert.ok(lane.includes('Model calls: 413') && lane.includes('Tool calls: 321'), 'lane and card agree on full recorded counts')
      assert.equal(await metric('Model latency').innerText(), '9.0s p50 / 20s p90 / — p99', 'sample latency cannot invent full-stream percentiles')
      assert.equal(await metric('Tokens').innerText(), '70,000 in / 20,000 out / 10,000 cached')
      assert.equal(await metric('Failures').innerText(), '5 failed steps')
      assert.equal(await metric('Retries').innerText(), '8 retried steps · 0 restarts')
      assert.equal(await metric('Cost').innerText(), '≥$1.25')
      assert.equal(await metric('Cost basis').innerText(), 'Catalog estimate')
      assert.equal(await metric('Billed cost').innerText(), 'Not recorded', 'an absent bill is never fabricated as zero')
      await page.mouse.move(1, 1)
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/timeline?agent=root`)
      await page.locator('section[aria-label="root: whole run"]').getByText('≥$1.25 list · — billed', { exact: true }).waitFor()
      nodes[0].usage.billedUsd = 0.75
      nodes[0].usage.billedComplete = false
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/timeline?agent=root`)
      await page.locator('section[aria-label="root: whole run"]').getByText('≥$1.25 list · ≥$0.75 billed', { exact: true }).waitFor()
      if (evidence) await page.screenshot({ path: `${evidence}/partial-billing-${width}-${theme}.png` })
      nodes[0].usage.billedUsd = null
      nodes[0].usage.billedComplete = false
      nodes[0].usage = { ...fullRootUsage, tools: null, failures: null, retries: null }
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/timeline`)
      const unknownBar = page.locator('.fw-bar').first()
      await unknownBar.waitFor()
      const unknownBounds = await unknownBar.boundingBox()
      await page.mouse.move(unknownBounds.x + Math.min(6, unknownBounds.width - 1), unknownBounds.y + unknownBounds.height / 2)
      await card.waitFor()
      assert.equal(await metric('Tool failures').innerText(), 'Not recorded')
      assert.equal(await metric('Failures').innerText(), 'Not recorded', 'a bounded display cannot certify zero full-stream failures')
      assert.equal(await metric('Retries').innerText(), '— retried steps · 0 restarts')
      nodes[0].usage = fullRootUsage
      await page.mouse.move(1, 1)
      await page.getByRole('tab', { name: 'Analytics', exact: true }).click()
      const agentsTable = page.locator('section[aria-label="Agents"]')
      await agentsTable.getByRole('button', { name: 'Next', exact: true }).click()
      await agentsTable.getByText('Worker 14', { exact: true }).waitFor()
      assert.ok(await agentsTable.getByRole('row').count() <= 15, 'analytics pages keep 124 agents reachable with bounded rows')
      const heatmap = page.locator('section[aria-label="Tool calls by agent and tool"]')
      await heatmap.getByRole('button', { name: 'Next', exact: true }).click()
      assert.ok(await heatmap.locator('.rh').count() <= 14)
      alive = false
      await open()
      await page.getByRole('button', { name: 'Full prompt', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Beginning', exact: true }).count(), 0, 'settled transcripts open at the beginning')
      assert.deepEqual(errors, [])
      await context.close()
    }
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
})
