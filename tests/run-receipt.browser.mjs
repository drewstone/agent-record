import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunOverview, RunReceiptView, runReceiptSchema } from '../dist/index.js'
import { renderRunReceipt } from '../dist/receipt.js'

const fixture = JSON.parse(await readFile(new URL('./fixtures/run-receipt-jcs.json', import.meta.url), 'utf8'))
const css = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
const field = (object, path) => path.split('.').reduce((value, key) => value?.[key], object)
const playwright = process.env.PLAYWRIGHT_MODULE

test('the Lab fixture reaches the live DOM and print DOM with identical field values', { skip: !playwright }, async () => {
  const { chromium } = await import(playwright)
  const browser = await chromium.launch({ headless: true })
  const evidence = process.env.RECEIPT_EVIDENCE_DIR
  try {
    for (const theme of ['dark', 'light']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, colorScheme: theme })
      const page = await context.newPage()
      const markup = renderToStaticMarkup(createElement('div', { className: 'agent-record ar-ws', 'data-theme': theme }, createElement(RunOverview, { api: '/api/discovery', doc: { receipt: fixture, run: { state: 'no-winner', reason: 'budget-exhausted' } }, nodes: [], stats: { root: { toolCalls: 162, tokens: 6500000 } } })))
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${markup}`)
      for (const binding of await page.locator('[data-field][data-value]').evaluateAll((nodes) => nodes.map((node) => ({ path: node.dataset.field, value: node.dataset.value })))) assert.equal(binding.value, String(field(fixture, binding.path) ?? ''), binding.path)
      assert.equal(await page.locator('[data-field="check.output"]').textContent(), fixture.check.output)
      assert.equal(await page.locator('[data-field="outcome.status"]').textContent(), 'passed')
      assert.equal(await page.locator('[data-field="chosen.tag"]').first().textContent(), fixture.check.tag)
      assert.equal(await page.locator('[data-field="work.toolCalls"]').textContent(), '172')
      assert.equal(await page.locator('[data-field="work.tokens.total"]').getAttribute('data-value'), '12920470')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${viewport.width}: page reflows`)
      if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/run-${viewport.width}-${theme}.png`, fullPage: true }) }
      if (viewport.width === 1440) for (const path of ['check.output', 'check.inputs.sha256', 'check.rerun']) assert.ok(await page.locator(`[data-field="${path}"]`).evaluate((node) => node.getBoundingClientRect().bottom <= 900), `${path} above the fold`)
      await page.setContent(renderRunReceipt(fixture, { css }))
      assert.equal(await page.locator('.rr-print').count(), 1)
      assert.equal(await page.locator('.rr-drawer:not([open])').count(), 0)
      assert.equal(await page.locator('button').count(), 0)
      assert.equal(await page.locator('[data-field="check.output"]').textContent(), fixture.check.output)
      assert.equal(await page.locator('[data-field="work.toolCalls"]').getAttribute('data-value'), '172')
      await context.close()
    }
  } finally { await browser.close() }
})

test('the shared receipt schema preserves the sources and treats unknown work as unknown', () => {
  const parsed = runReceiptSchema.parse(fixture)
  assert.deepEqual(parsed.work, fixture.work)
  assert.deepEqual(parsed.sources, fixture.sources)
  const missing = structuredClone(parsed)
  missing.work.toolCalls = null
  const markup = renderToStaticMarkup(createElement(RunReceiptView, { receipt: missing }))
  assert.match(markup, /data-field="work.toolCalls" data-value="">not recorded/)
})
