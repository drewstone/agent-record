import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { readPublication } from '../examples/react/publications.ts'
import { fromResearchPublication } from '../dist/research-publication.js'

// Exercise the deployed Pages layout with real publication bytes and public components.
test('the Charts example reads every retained publication, selects source events and keeps uploads local', { timeout: 180_000 }, async () => {
  const root = resolve('dist-example'), evidence = process.env.EXAMPLE_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  const fixture = Buffer.from(await readPublication('fc-audit-smoke-a'))
  const record = fromResearchPublication(JSON.parse(fixture))
  const canonical = new Map(record.nodes.map(node => [node.id, node.agentId ?? node.id]))
  const first = record.events[0], actor = canonical.get(first.node)
  const methods = [], failures = [], checks = []
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (!path.startsWith('/agent-record/')) return res.writeHead(404).end()
    const file = resolve(root, decodeURIComponent(path.slice('/agent-record/'.length)) || 'index.html')
    if (!file.startsWith(root + '/')) return res.writeHead(400).end()
    try {
      res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[extname(file)] ?? 'application/octet-stream')
      res.end(await readFile(file))
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true })
  try {
    for (const theme of ['light', 'dark']) for (const width of [1512, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 982 } } } : {}) })
      const page = await context.newPage(), began = Date.now()
      page.on('pageerror', error => failures.push(error.message))
      page.on('request', request => methods.push(request.method()))
      await page.goto(process.env.EXAMPLE_URL ?? `http://127.0.0.1:${server.address().port}/agent-record/`)
      const records = page.getByRole('combobox', { name: 'Record', exact: true })
      await page.waitForFunction(() => document.querySelector('select[aria-label="Record"]')?.options.length === 5)
      assert.equal(await page.locator('.agent-record').count(), 0, 'the example uses shared owners rather than the private viewer')
      await page.locator('.ov-gantt [data-lane]').first().waitFor()
      assert.ok(await page.locator('.ov-gantt [data-lane]').count() < 40, 'the measured timeline remains bounded')
      await records.selectOption(record.runId)
      const actorButton=page.locator('.record-agent-tree [data-node='+JSON.stringify(actor)+']')
      await actorButton.focus(); await page.keyboard.press('Enter')
      assert.equal(await actorButton.getAttribute('aria-pressed'),'true','shared hierarchy selects the original actor')
      const event = page.locator(`.ov-gantt [data-lane=${JSON.stringify(first.id)}]`)
      await event.focus(); await page.keyboard.press('Enter')
      const source = page.locator('.demo-source pre')
      await source.waitFor()
      assert.deepEqual(JSON.parse(await source.innerText()), first.source, 'selecting a plotted observation retains its exact source')
      await page.locator('.record-conversation').waitFor()
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme === 'light' ? 'dark' : 'light')
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.getByLabel('Open record', { exact: true }).setInputFiles({ name: 'retained.json', mimeType: 'application/json', buffer: fixture })
      await page.waitForFunction(() => document.querySelector('select[aria-label="Record"]')?.options.length === 1)
      assert.equal(await records.inputValue(), record.runId)
      await page.locator('.record-conversation').waitFor()
      if (evidence) await page.screenshot({ path: `${evidence}/example-${width}-${theme}.png`, fullPage: true })
      await page.waitForTimeout(Math.max(0, 10_100 - (Date.now() - began)))
      await page.getByLabel('Open record', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"invalid"}') })
      await page.getByRole('alert').waitFor()
      assert.equal(await records.locator('option').count(), 1, 'invalid input leaves the last readable record intact')
      checks.push({ theme, width, publications: 5, exactSource: true, localUpload: true, invalidInputRetainsRecord: true })
      await context.close()
    }
    for (const completion of ['complete', 'fail', 'invalid']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 982 }, ...(evidence ? { recordVideo: { dir: evidence, size: { width: 390, height: 982 } } } : {}) })
      const page = await context.newPage(), began = Date.now(), paused = new Map(), pending = new Set()
      const cdp = await context.newCDPSession(page)
      const publication = url => url.startsWith('https://raw.githubusercontent.com/drewstone/drewstone.github.io/') && url.includes('/public/research/records/')
      page.on('request', request => { methods.push(request.method()); if (publication(request.url())) pending.add(request) })
      page.on('requestfinished', request => pending.delete(request))
      page.on('requestfailed', request => pending.delete(request))
      cdp.on('Fetch.requestPaused', event => {
        assert.equal(event.responseStatusCode, 200, 'pause actual successful owner responses, without replacing their bytes')
        paused.set(event.request.url, event.requestId)
      })
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://raw.githubusercontent.com/drewstone/drewstone.github.io/*/public/research/records/*.json', requestStage: 'Response' }] })
      await page.goto(process.env.EXAMPLE_URL ?? `http://127.0.0.1:${server.address().port}/agent-record/`)
      const until = async predicate => { const end = Date.now() + 15_000; while (!predicate() && Date.now() < end) await page.waitForTimeout(50); assert.ok(predicate(), 'actual publication requests reached the expected boundary') }
      await until(() => paused.size === 5)
      const invalid = completion === 'invalid'
      await page.getByLabel('Open record', { exact: true }).setInputFiles({ name: invalid ? 'invalid.json' : 'retained.json', mimeType: 'application/json', buffer: invalid ? Buffer.from('{"schema":"invalid"}') : fixture })
      if (invalid) await page.getByRole('alert').waitFor()
      else await page.waitForFunction(() => document.querySelector('select[aria-label="Record"]')?.options.length === 1)
      await Promise.all([...paused.values()].map(async requestId => {
        try { await cdp.send(completion === 'fail' ? 'Fetch.failRequest' : 'Fetch.continueRequest', { requestId, ...(completion === 'fail' ? { errorReason: 'Failed' } : {}) }) }
        catch (error) { if (!/Invalid InterceptionId/i.test(String(error))) throw error }
      }))
      await until(() => pending.size === 0)
      await page.waitForTimeout(100)
      const records = page.getByRole('combobox', { name: 'Record', exact: true })
      assert.equal(await records.locator('option').count(), invalid ? 5 : 1, 'only a valid local upload supersedes the bootstrap')
      if (!invalid) {
        assert.equal(await records.inputValue(), record.runId)
        assert.equal(await page.getByRole('alert').count(), 0, 'late bootstrap failure cannot add an error to a valid local record')
      }
      if (evidence) await page.screenshot({ path: `${evidence}/upload-bootstrap-${completion}.png`, fullPage: true })
      checks.push({ bootstrapCompletion: completion, realOwnerResponses: paused.size, uploadPreserved: !invalid, invalidInputKeepsBootstrap: invalid })
      await page.waitForTimeout(Math.max(0, 10_100 - (Date.now() - began)))
      await context.close()
    }
    assert.deepEqual(failures, [])
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'opening a record never posts its bytes')
    if (evidence) await writeFile(`${evidence}/checks.json`, JSON.stringify(checks, null, 2))
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
})
