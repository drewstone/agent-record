import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunOverview, RunReceiptView, runReceiptSchema } from '../dist/index.js'
import { smallMultiples } from '@tangle-network/charts'
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
      assert.notEqual(await page.locator('.ov-meter-track [data-segment="Work"]').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)', 'work segment receives the host theme')
      assert.notEqual(await page.locator('.ov-meter-track [data-segment="Untraced"]').evaluate((node) => getComputedStyle(node).backgroundImage), 'none', 'untraced time is hatched')
      await page.getByText('Versions', { exact: true }).click()
      assert.ok(await page.locator('[data-field="versions.rows"] tbody tr').count())
      if (evidence) await page.screenshot({ path: `${evidence}/versions-${viewport.width}-${theme}.png`, fullPage: true })
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
  missing.check.checker.path = null
  const markup = renderToStaticMarkup(createElement(RunReceiptView, { receipt: missing }))
  assert.match(markup, /data-field="work.toolCalls" data-value="">not recorded/)
  assert.match(markup, /data-field="check.checker.path" data-value="">not recorded/)
  const commission = { ...parsed, check: null }
  assert.equal(runReceiptSchema.parse(commission).check, null)
  assert.match(renderToStaticMarkup(createElement(RunReceiptView, { receipt: commission })), /No play check is registered/)
})


test('a narrow shared comparison chart fits inside a phone card', { skip: !playwright }, async () => {
  const { chromium } = await import(playwright)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const figure = smallMultiples([{ id: 'missing', label: 'Worker', missing: { why: 'Provider refused before work began' } }], { x: { label: 'Hours', domain: [0, 2] }, y: { label: 'Cells', unit: 'cells', domain: [0, 10] }, shared: 'both' })
    assert.ok(figure.svg?.narrow)
    await page.setContent(`<!doctype html><style>${css}</style><div class="agent-record ar-ws" style="width:284px;margin:40px"><section class="rr-comparison"><figure class="tgc-figure tgc-figure-view"><div class="tgc-view-plot tgc-view-narrow">${figure.svg.narrow}</div></figure></section></div>`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.ok(await page.locator('svg').evaluate((node) => node.getBoundingClientRect().width <= node.parentElement.clientWidth))
  } finally { await browser.close() }
})
