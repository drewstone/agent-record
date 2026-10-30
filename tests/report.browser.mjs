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
import { chromium } from 'playwright'

// Run from the package or its fresh installed consumer. Never alias the view to source.
test('the public report CLI preserves sources and enforces its browser and filesystem boundaries', { timeout: 180_000 }, async () => {
  const require = createRequire(resolve('package.json'))
  const api = await import(pathToFileURL(require.resolve('@drewstone/agent-record')))
  const root = dirname(dirname(require.resolve('@drewstone/agent-record/record')))
  const scratch = await mkdtemp(join(tmpdir(), 'report-public-cli-'))
  const evidence = process.env.EXAMPLE_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  const original = await readFile(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8')
  const report = api.playReportToResearchReport(JSON.parse(original)), play = report.plays[0]
  const source = { id: 'retained-report', path: 'retained/play-report.json', title: 'Original retained report', kind: 'data', content: original, sha256: createHash('sha256').update(original).digest('hex') }
  play.documents.push(source)
  report.title = '</script><img src=x onerror="window.reportInjected=true"> Retained report'
  const input = join(scratch, 'report.json'), output = join(scratch, 'report.html'), offline = join(scratch, 'offline.html')
  const executable = join(scratch, 'agent-record-report')
  await symlink(join(root, 'tools/render-report.mjs'), executable)
  await writeFile(input, JSON.stringify(report))
  const run = (...args) => spawnSync(process.execPath, [executable, input, ...args], { encoding: 'utf8' })
  const checks = [], requests = []
  let browser, server
  try {
    const rendered = run(output, '--source-search-endpoint', '/revisions/retained/sources/search')
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.equal(JSON.parse(rendered.stdout).plays, 1)
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
      const context = await browser.newContext({ viewport: { width, height: 982 }, colorScheme: theme, ...(evidence ? { recordVideo: { dir: evidence, size: { width, height: 982 } } } : {}) })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(origin + '/report.html')
        await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme)
        assert.equal(await page.locator('article.research-report').first().evaluate(node => getComputedStyle(node).colorScheme), theme)
        assert.equal(await page.locator('img[src=x]').count(), 0)
        assert.equal(await page.evaluate(() => window.reportInjected), undefined)
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
        checks.push({ theme, width, installedCli: true, privateExports: true, exactSource: true, citationReload: true, refusedScopeRevisionBytes: true, cspScriptAndConnect: true })
      } finally { await context.close() }
    }
    assert.equal(requests.includes('/must-not-connect'), false)
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve))
    if (evidence) await writeFile(join(evidence, 'report-cli-checks.json'), JSON.stringify(checks, null, 2))
    await rm(scratch, { recursive: true, force: true })
  }
})
