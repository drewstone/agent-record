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
nodes[0].usage = { listUsd: 1.25, listComplete: false, billedUsd: null, calls: 413, tokens: 100000, byClass: { input: 70000, output: 20000, cacheRead: 10000 }, latencyMs: { p50: 9000, p90: 20000 }, failures: { model: 3, tool: 2 }, retries: { model: 7, tool: 1 }, tools: { read: { calls: 321, failures: 2, ms: 321000 } }, steps: [...nodes[0].usage.steps, { kind: 'model', startMs: start + 1, endMs: start + 1001, failed: false, byClass: { input: 1, output: 1, cacheRead: 0 } }] }

test('HTTP Discovery chat preserves prompts, folds idle turns, retains failures and navigates 124 agents', { timeout: 120_000 }, async () => {
  const evidence = process.env.DISCOVERY_UI_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  let theme = 'light', alive = true
  const requests = []
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
    if (path.endsWith('/workspace')) return json({ schema: 'agent-workspace.run-workspace.v1', runId, live: alive, nodes, edges: nodes.slice(1).map(node => ({ from: runId, to: node.id, kind: 'spawn' })), releases: [], best: null, code: { available: false, reason: 'No code fixture' } })
    if (path === `/api/runs/${runId}`) return json({ schema: 'agent-workspace.run.v1', run: { id: runId, play: 'magnetar-rust-sandbox', state: alive ? 'running' : 'stopped', startedAt: iso(0), location: { kind: 'dir', path: null }, record: { status: 'missing', digest: null } }, input: { objective: prompt, instruction: '' }, spend: { nodes: {} }, versions: [], live: { polling: alive }, execution: { alive } })
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
      await page.goto(`http://127.0.0.1:${server.address().port}/run/${runId}/timeline`)
      const bar = page.locator('.fw-bar').first()
      await bar.waitFor()
      const bounds = await bar.boundingBox()
      await page.mouse.move(bounds.x + Math.min(6, bounds.width - 1), bounds.y + bounds.height / 2)
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
