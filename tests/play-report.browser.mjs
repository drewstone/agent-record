// The built workspace viewer mounts /play/<id>/report the way the Lab host does, reads the served sample through the
// same-origin API, and reflows at 1440 and 390 px. PLAY_DOCUMENT optionally supplies the play document so the play
// page's bar panels draw as the how-good figure; without it the report reads alone.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const report = await readFile(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8')
const css = await readFile(new URL('../dist/styles.css', import.meta.url), 'utf8')
const viewer = await readFile(new URL('../dist/workspace-viewer.js', import.meta.url), 'utf8')
const play = process.env.PLAY_DOCUMENT ? await readFile(process.env.PLAY_DOCUMENT, 'utf8') : null
const playwright = process.env.PLAYWRIGHT_MODULE

test('the play report renders from the served sample and reflows at 1440 and 390 px', { skip: !playwright }, async () => {
  const { chromium } = await import(playwright)
  const browser = await chromium.launch({ headless: true })
  const evidence = process.env.PLAY_REPORT_EVIDENCE_DIR
  const id = JSON.parse(report).id
  try {
    for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, colorScheme: theme })
      const page = await context.newPage()
      await page.route('**/*', (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === `/play/${id}/report`)
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style><div id="agent-workspace" data-api="/api/discovery" data-mode="report" data-id="${id}" data-theme="${theme}"></div><script src="/viewer.js"></script>` })
        if (path === '/viewer.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: viewer })
        if (path === `/api/discovery/plays/${id}/report`) return route.fulfill({ contentType: 'application/json; charset=utf-8', body: report })
        if (path === `/api/discovery/plays/${id}` && play) return route.fulfill({ contentType: 'application/json; charset=utf-8', body: play })
        return route.fulfill({ status: 404, body: 'not found' })
      })
      await page.goto(`http://report.test/play/${id}/report`)
      await page.locator('#unknowns').waitFor()
      if (play) await page.locator('#how-good [data-play-bar]').waitFor()
      for (const section of ['verdict', 'questions', 'how-good', 'built', 'hardware', 'limit', 'pipelines', 'runs', 'anomalies', 'unknowns'])
        assert.equal(await page.locator(`#${section}`).count(), 1, section)
      assert.equal(await page.locator('#anomalies .rr-rule > ul > li').count(), 8)
      assert.equal(await page.locator('#unknowns [data-unknown-field]').count(), 10)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${viewport.width}: no sideways scroll`)
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await page.screenshot({ path: `${evidence}/play-report-${viewport.width}-${theme}.png`, fullPage: true })
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
})
