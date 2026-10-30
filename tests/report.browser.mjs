import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { readPublication } from '../examples/react/publications.ts'
import { chromium } from 'playwright'

// Run from the package or its fresh installed consumer. Never alias the view to source.
test('the public report CLI preserves sources and enforces its browser and filesystem boundaries', { timeout: 180_000 }, async () => {
  const require = createRequire(resolve('package.json'))
  const root = dirname(dirname(require.resolve('@drewstone/agent-record/adapters/research-publication')))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const api = await import(pathToFileURL(resolve(root, manifest.exports['.'].import)))
  const scratch = await mkdtemp(join(tmpdir(), 'report-public-cli-'))
  const evidence = process.env.EXAMPLE_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  const original = await readFile(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8')
  const served = JSON.parse(original), report = api.playReportToResearchReport(served), play = report.plays[0]
  const { fromResearchPublication } = await import(pathToFileURL(require.resolve('@drewstone/agent-record/adapters/research-publication')))
  const retained = fromResearchPublication(JSON.parse(await readPublication('ftqc-zips-2026-08-05-r1')))
  // A second genuine play retains its own identity; no FTQC event is attributed to Magnetar.
  report.plays.push(api.parseResearchReport({ ...report, plays: [{ id: retained.runId, title: retained.title,
    summary: 'Original retained event record', updatedAt: null, status: null, claims: [], record: retained }] }).plays[0])
  const source = { id: 'retained-report', path: 'retained/play-report.json', title: 'Original retained report', kind: 'data', content: original, sha256: createHash('sha256').update(original).digest('hex') }
  play.documents.push(source)
  report.title = '</script><img src=x onerror="window.reportInjected=true"> Retained report'
  const input = join(scratch, 'report.json'), output = join(scratch, 'report.html'), offline = join(scratch, 'offline.html')
  const executable = join(scratch, 'agent-record-report')
  await symlink(join(root, 'tools/render-report.mjs'), executable)
  await writeFile(input, JSON.stringify(report))
  const run = (...args) => spawnSync(process.execPath, [executable, input, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } })
  const checks = [], requests = []
  let browser, server
  try {
    const rendered = run(output, '--source-search-endpoint', '/revisions/retained/sources/search')
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.equal(JSON.parse(rendered.stdout).plays, 2)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal((await stat(join(scratch, 'report.tex'))).mode & 0o777, 0o600)
    assert.match(await readFile(join(scratch, 'report.tex'), 'utf8'), /Original retained report/)
    assert.equal(run(input).status, 1, 'the installed CLI refuses to overwrite its input')
    assert.equal(run(join(scratch, 'bad.html'), '--source-search-endpoint', 'https://other.example/search').status, 1)
    assert.equal(await readFile(input, 'utf8'), JSON.stringify(report))
    assert.equal(run(offline).status, 0)
    let variant = 'exact'
    server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      requests.push(url.pathname)
      if (url.pathname === '/revisions/retained/sources/search') {
        assert.equal(url.searchParams.get('play'), play.id)
        const value = { scopeId: variant === 'scope' ? 'foreign-play' : play.id, revision: variant === 'revision' ? 'other' : 'retained', hits: [{ source: { id: source.id, contentHash: source.sha256, text: variant === 'bytes' ? original + '\nchanged' : original } }] }
        res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(value))
      }
      if (url.pathname === '/report.html' || url.pathname === '/offline.html') {
        res.setHeader('content-type', 'text/html'); return res.end(await readFile(url.pathname === '/report.html' ? output : offline))
      }
      res.writeHead(404).end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true })
    for (const theme of ['light', 'dark']) for (const width of [1512, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, timezoneId: width === 390 ? 'Asia/Tokyo' : 'America/Denver', locale: width === 390 ? 'ja-JP' : 'en-US', ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 982 } } } : {}) })
      const page = await context.newPage(), errors = [], began = Date.now()
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(origin + '/report.html')
        await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme)
        assert.equal(await page.locator('article.research-report').first().evaluate(node => getComputedStyle(node).colorScheme), theme)
        assert.equal(await page.locator('img[src=x]').count(), 0)
        assert.equal(await page.evaluate(() => window.reportInjected), undefined)
        assert.ok((await page.locator('#verdict').innerText()).includes(api.hostWords(served.verdict.sentence)))
        for (const question of served.questions) assert.ok((await page.locator('#questions').innerText()).includes(question.question))
        for (const rule of served.rules) {
          const row = page.locator('#anomalies [data-rule=' + JSON.stringify(rule.id) + ']')
          assert.equal(await row.getAttribute('data-state'), rule.state)
          for (const anomaly of served.anomalies.filter(item => item.rule === rule.id)) assert.ok((await row.innerText()).includes(anomaly.sentence))
        }
        for (const item of served.unknowns) {
          const row = page.locator('#unknowns [data-unknown-field=' + JSON.stringify(item.field) + ']')
          assert.ok((await row.innerText()).includes(api.hostWords(item.why)))
          assert.ok((await row.innerText()).includes(item.record))
        }
        await page.getByRole('navigation', { name: 'Play sections', exact: true }).getByRole('button', { name: /^Sources/ }).click()
        const search = page.getByRole('searchbox', { name: 'Search this play’s sources', exact: true })
        await search.fill('magnetar'); await search.press('Enter')
        await page.getByRole('button', { name: /Original retained report/ }).click()
        await page.locator('[data-line]').first().waitFor()
        const cited = new URL(page.url())
        assert.equal(cited.searchParams.get('play'), play.id)
        assert.equal(cited.searchParams.get('document'), source.path)
        await page.reload(); await page.locator('[data-line]').first().waitFor()
        assert.ok((await page.getByRole('region', { name: 'Selected source', exact: true }).innerText()).includes('agent-workspace.play-report.v1'))
        await page.getByRole('button', { name: '← All sources', exact: true }).click()
        for (variant of ['scope', 'revision', 'bytes']) {
          await search.fill('magnetar'); await search.press('Enter')
          await page.getByRole('alert').filter({ hasText: 'does not match these sources' }).waitFor()
          assert.equal(await page.getByRole('navigation', { name: 'Retained documents', exact: true }).count(), 0)
        }
        variant = 'exact'
        await page.getByRole('navigation', { name: 'Research plays', exact: true }).getByRole('button').filter({ hasText: retained.title }).click()
        await page.getByRole('navigation', { name: 'Play sections', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click()
        await page.locator('.record-conversation').waitFor()
        await page.locator('[data-user-message-time]').first().waitFor({ state: 'attached' })
        const userTimes = await page.locator('[data-user-message-time]').allTextContents()
        assert.ok(userTimes.length > 0 && userTimes.every(value => /^\d{2}:\d{2} UTC$/.test(value)), 'the actual standalone IIFE renders original retained messages in UTC across zones')
        assert.equal(new URL(page.url()).searchParams.get('play'), retained.runId)
        assert.equal(new URL(page.url()).searchParams.get('view'), 'activity')
        await page.reload(); await page.locator('[data-user-message-time]').first().waitFor({ state: 'attached' })
        assert.deepEqual(await page.locator('[data-user-message-time]').allTextContents(), userTimes)
        if (evidence) await page.screenshot({ path: `${evidence}/report-activity-${theme}-${width}.png`, fullPage: true })
        await page.goto(origin + '/offline.html')
        const blocked = await page.evaluate(async () => {
          window.inlineExecuted = false
          const script = document.createElement('script'); script.textContent = 'window.inlineExecuted=true'; document.body.append(script)
          let networkBlocked = false
          try { await fetch('/must-not-connect') } catch { networkBlocked = true }
          return { scriptBlocked: !window.inlineExecuted, networkBlocked }
        })
        assert.deepEqual(blocked, { scriptBlocked: true, networkBlocked: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        assert.deepEqual(errors, [])
        if (evidence) await page.screenshot({ path: `${evidence}/report-cli-${theme}-${width}.png`, fullPage: true })
        checks.push({ theme, width, installedCli: true, privateExports: true, originalFtqcActivityUtc: true, originalFtqcRunId: retained.runId, timezone: width === 390 ? "Asia/Tokyo" : "America/Denver", exactSource: true, citationReload: true, refusedScopeRevisionBytes: true, cspScriptAndConnect: true })
        await page.waitForTimeout(Math.max(0,10_100-(Date.now()-began)))
      } finally { await context.close() }
    }
    assert.equal(requests.includes('/must-not-connect'), false)
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve))
    if (evidence) await writeFile(join(evidence, 'report-cli-checks.json'), JSON.stringify(checks, null, 2))
    await rm(scratch, { recursive: true, force: true })
  }
})
