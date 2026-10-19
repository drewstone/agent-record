// The shipped workspace bundle (dist/workspace-viewer.js) on magnetar-rust-20261018b's served documents, in a real
// browser at 1440 and 390: the run page and its Spend tab show the run's token total, Spend says once what it did not
// measure, the receipt names v3 3×, and the play's Runs tab fits every column at 1440. Run after a build with
// PLAYWRIGHT_MODULE pointing to an installed Playwright; RECEIPT_EVIDENCE_DIR keeps the screenshots outside the repo.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const playwright = process.env.PLAYWRIGHT_MODULE
const evidence = process.env.RECEIPT_EVIDENCE_DIR
const RUN = 'magnetar-rust-20261018b'
const read = (path) => readFile(new URL(path, import.meta.url))
const documents = {
  [`/api/discovery/runs/${RUN}`]: 'run.json',
  [`/api/discovery/runs/${RUN}/receipt/receipt.json`]: 'receipt.json',
  '/api/discovery/plays/magnetar-rust': 'play.json',
}
const fixtureFor = (url) => {
  if (url.pathname === `/api/discovery/runs/${RUN}/record`) return url.searchParams.get('part') === 'nodes' ? 'nodes.json' : url.searchParams.get('node') === RUN ? 'root-part.json' : null
  return documents[url.pathname] ?? null
}

test('magnetar-rust-20261018b: run total, one not-measured line, v3 3× and a Runs table that fits at 1440', { skip: !playwright }, async () => {
  const { chromium } = await import(playwright)
  const [viewer, css] = await Promise.all([read('../dist/workspace-viewer.js'), read('../dist/styles.css')])
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  if (evidence) await mkdir(evidence, { recursive: true })
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/viewer.js') return route.fulfill({ contentType: 'text/javascript', body: viewer })
        if (url.pathname === '/') {
          const shell = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>`
          return route.fulfill({ contentType: 'text/html', body: `${shell}<div id="agent-workspace" data-api="/api/discovery" data-mode="${url.searchParams.get('mode')}" data-id="${url.searchParams.get('id')}" data-theme="light"></div><script src="/viewer.js"></script>` })
        }
        const file = fixtureFor(url)
        return file
          ? route.fulfill({ contentType: 'application/json', body: await read(`./fixtures/magnetar-rust-20261018b/${file}`) })
          : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not in the fixture"}' })
      })
      const open = async (query, ready, name) => {
        await page.goto(`http://fixture.test/?${query}`)
        await page.locator(ready).first().waitFor()
        await page.evaluate(() => document.querySelectorAll('details').forEach((details) => { details.open = true }))
        if (evidence) await page.screenshot({ path: `${evidence}/${name}-${viewport.width}.png`, fullPage: true })
        return page.evaluate(() => document.body.innerText)
      }
      const at = viewport.width

      const landing = await open(`mode=run&id=${RUN}`, '[data-run-tokens]', 'run')
      assert.match(landing, /62\.5M in · 1\.35M out · 963M cache read/, `${at}: the landing shows the run total`)

      const spend = await open(`mode=run&id=${RUN}&section=spend`, '[data-spend-unmeasured]', 'run-spend')
      assert.match(spend, /tokens in 62\.5M · out 1\.35M · cache read 963M across 15 agents/, `${at}: Spend shows the run total`)
      assert.ok((spend.match(/not measured/gi) ?? []).length <= 1, `${at}: at most one not-measured line`)
      assert.match(spend, /Not measured: subscription use, model API and sandbox compute for 15 of 15 agents\./)
      assert.doesNotMatch(spend, /unknown (subscription|API|sandbox)|Account\s+unknown/, `${at}: no per-row unknowns`)

      const receipt = await open(`mode=receipt&id=${RUN}`, '[data-receipt]', 'receipt')
      assert.match(receipt, /rc14 passed under v3 3×/, `${at}: the receipt names v3 and every pass`)
      assert.doesNotMatch(receipt, /a3cf95c7|f81edc942b30|2669615819ad/, `${at}: no checker or dispute digests in the text`)

      await open('mode=play&id=magnetar-rust&tab=runs', '.ledger-table', 'play-runs')
      const box = await page.locator('.play-ledger .table-scroll').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
      if (at === 1440) {
        assert.ok(box.scroll <= box.client, `1440: the Runs table fits (${box.scroll} > ${box.client})`)
        for (const column of ['API-equiv.', 'Seat', 'Tokens in / out']) {
          const right = await page.locator('.ledger-table thead th', { hasText: column }).evaluate((node) => node.getBoundingClientRect().right)
          assert.ok(right <= at, `${column} is on screen at 1440`)
        }
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
