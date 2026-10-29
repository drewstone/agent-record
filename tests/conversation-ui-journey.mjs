import assert from 'node:assert/strict'

export async function proveToolPreview(page, evidence, width, theme) {
  if (width === 1512) {
    const list = page.getByRole('list', { name: 'Run agents', exact: true })
    await list.focus(); await page.keyboard.press('End')
    await list.getByText('Worker 123', { exact: true }).waitFor()
    assert.ok(await list.getByRole('listitem').count() < 100)
    await page.keyboard.press('Home'); await list.getByText('root', { exact: true }).waitFor()
  }
  const row = page.locator('.record-tool-row').filter({ has: page.getByRole('button', { name: /Read.*proof.txt/i }) }).first()
  await row.hover()
  const preview = page.locator('.record-tool-preview')
  await preview.getByText('Exact retained evidence, with source provenance.', { exact: true }).waitFor()
  assert.match(await preview.innerText(), /proof.txt/)
  assert.match(await preview.innerText(), /Duration/)
  assert.match(await preview.innerText(), /Cost/)
  assert.match(await preview.innerText(), /Not recorded/)
  assert.equal(await row.evaluate(node => getComputedStyle(node).borderLeftWidth), '2px')
  if (evidence) await page.screenshot({ path: `${evidence}/conversation-tool-hover-${width}-${theme}.png` })
  await page.mouse.move(1, 1)
  await preview.waitFor({ state: 'hidden' })
}

export async function observeArrivalMotion(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    window.__recordArrivals = []
    const original = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args)
      if (this.closest('.conversation-scroll')) window.__recordArrivals.push({ text: this.textContent, frames: animation.effect.getKeyframes(), duration: animation.effect.getTiming().duration, state: animation.playState })
      return animation
    }
  })
}

export async function proveArrivalMotion(page) {
  await page.waitForFunction(() => window.__recordArrivals.some(item => item.text.includes('Native SSE arrival.')))
  const arrivals = await page.evaluate(() => window.__recordArrivals.filter(item => item.text.includes('Native SSE arrival.')))
  assert.equal(arrivals.length, 1, 'one native SSE turn animates once')
  assert.deepEqual(arrivals[0].frames.map(frame => frame.opacity), ['0', '1'])
  assert.ok(arrivals[0].duration > 0)
  assert.equal(arrivals[0].state, 'running')
}
