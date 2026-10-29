/** Actual Discovery Built routes, using the retained merge document and the package's standalone assets. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { doc, sha } from './version-history-fixture.mjs'
const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const assets = process.env.VERSION_HISTORY_ASSETS ?? dirname(require.resolve('@drewstone/agent-record/workspace-viewer.js'))
const evidence = process.env.VERSION_HISTORY_EVIDENCE
assert.ok(evidence)
await mkdir(evidence, { recursive: true })
const run = { schema: 'agent-workspace.run.v1', run: { id: 'run', play: 'recorded-history', state: 'stopped', startedAt: doc.commits.at(-1).at, location: { kind: 'dir', path: null }, record: { status: 'missing', digest: null } }, input: null, spend: { nodes: {} }, versions: [], live: { polling: false }, execution: { alive: false } }
const workspace = { schema: 'agent-workspace.run-workspace.v1', runId: 'run', live: false, nodes: [], edges: [], best: 'rc2', code: { available: false, reason: 'The native fixture retains page commits' }, releases: [1, 2].map(n => ({ release: `rc${n}`, commit: sha(String(n)), taggedAt: `2026-10-07T03:0${n}:00Z`, at: `2026-10-07T03:0${n}:00Z`, checked: true, passed: n, total: 3, steps: [{ label: 'Offline build', state: 'pass' }, { label: 'Verify proof', state: n === 2 ? 'pass' : 'fail' }, { label: 'Held-out sample', state: 'fail' }] })) }
let theme = 'light'
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
  if (path === '/api/runs/run/versions') return json(doc)
  if (path === '/api/runs/run/workspace') return json(workspace)
  if (path === '/api/runs/run') return json(run)
  if (path === '/api/plays/recorded-history') return json({ id: 'recorded-history', runs: [] })
  if (path.startsWith('/api/')) return json({})
  if (path.startsWith('/assets/')) {
    const file = resolve(assets, path.slice(8))
    if (!file.startsWith(assets + '/')) return res.writeHead(400).end()
    try { res.setHeader('content-type', extname(file) === '.css' ? 'text/css' : 'text/javascript'); return res.end(await readFile(file)) } catch { return res.writeHead(404).end() }
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html class="${theme}" data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"><div id="agent-workspace" data-mode="run" data-id="run" data-api="/api" data-theme="${theme}"></div><script type="module" src="/assets/workspace-viewer.js"></script></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true }), checks = []
try {
  for (theme of ['light', 'dark']) for (const width of [1512, 390]) {
    const began = Date.now(), context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, recordVideo: { dir: evidence, size: { width, height: 982 } } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/run/run?section=versions`)
      const graph = page.locator('.vg-scroll')
      await graph.locator('button[data-node]').first().waitFor()
      assert.equal(await graph.locator('button[data-node]').count(), 6)
      assert.equal(await graph.locator('path').count(), 7)
      await page.getByRole('region', { name: 'Steps passed by each release', exact: true }).waitFor()
      await page.screenshot({ path: `${evidence}/built-${width}-${theme}.png`, fullPage: true })
      await graph.locator(`button[data-node="${sha('e')}"]`).click()
      const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
      await inspector.waitFor()
      assert.match(await inspector.innerText(), /integrate editor: report.md/)
      assert.match(await inspector.innerText(), /report.md|pages\/e.md/)
      assert.equal(new URL(page.url()).searchParams.get('commit'), sha('e'))
      await page.keyboard.press('Escape'); await inspector.waitFor({ state: 'detached' })
      await page.getByRole('checkbox', { name: 'hide merges', exact: true }).check()
      assert.equal(await graph.locator('button[data-node]').count(), 4)
      assert.equal(await graph.locator('path').count(), 3)
      await page.getByRole('checkbox', { name: 'hide merges', exact: true }).uncheck()
      await page.locator('.vg-toolbar').getByRole('button', { name: 'editor', exact: true }).click()
      assert.equal(await graph.locator('button[data-node]').count(), 2)
      assert.equal(await graph.locator('path').count(), 1)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.deepEqual(errors, [])
      await page.waitForTimeout(Math.max(0, 10100 - (Date.now() - began)))
      checks.push({ theme, width, commits: 6, ancestryEdges: 7, result: 'PASS' })
    } catch (error) {
      await page.screenshot({ path: `${evidence}/failure-${width}-${theme}.png`, fullPage: true })
      await writeFile(`${evidence}/failure-${width}-${theme}.json`, JSON.stringify({ error: String(error), text: await page.locator('body').innerText(), errors }, null, 2))
      throw error
    } finally { await context.close() }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await writeFile(`${evidence}/checks.json`, JSON.stringify(checks, null, 2)) }
