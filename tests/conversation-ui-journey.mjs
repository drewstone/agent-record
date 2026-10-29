import assert from 'node:assert/strict'

export async function proveToolPreview(page, evidence, width, theme) {
  if (width === 1512) {
    const list = page.getByRole('list', { name: 'Run agents', exact: true })
    await list.focus(); await page.keyboard.press('End')
    await list.getByText('Worker 123', { exact: true }).waitFor()
    assert.ok(await list.getByRole('listitem').count() < 100)
    await page.keyboard.press('Home'); await list.getByText('root', { exact: true }).waitFor()
  }
  if (width === 390) await page.getByRole('button', { name: 'All agents', exact: true }).click()
  const identity = page.locator('.rp-alist [role="listitem"]').filter({ has: page.getByText('root', { exact: true }) }).locator('.rp-agent-logos')
  assert.equal(await identity.locator(':scope > *').count(), 1, 'one harness logo per agent')
  const logo = identity.locator(':scope > *')
  assert.match(await logo.getAttribute('title'), /Recorded model/)
  assert.ok(await logo.evaluate(element => element.firstElementChild.getBoundingClientRect().width >= 16), 'the actual mark is at least sixteen pixels')
  if (width === 390) {
    await page.locator('.rp-alist [role="listitem"]').filter({ has: page.getByText('root', { exact: true }) }).click()
  }
  const row = page.locator('.record-tool-row').filter({ has: page.getByRole('button', { name: /Read.*proof.txt/i }) }).first()
  await row.waitFor()
  const summary = row.locator('[data-record-tool-summary]')
  assert.match(await summary.innerText(), /1s.*Returned/s)
  assert.ok(await summary.evaluate(element => getComputedStyle(element).opacity === '1' && element.getBoundingClientRect().width > 40))
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

export async function proveFailedToolSummary(page) {
  await page.mouse.move(1, 1)
  const row = page.locator('.record-tool-row[data-tool-status="error"]').last()
  const result = row.locator('[data-record-tool-result]')
  assert.equal(await result.innerText(), 'Failed')
  const facts = await row.locator('[data-record-tool-summary]').evaluate(element => {
    const probe = document.createElement('span'); element.append(probe)
    probe.style.color = 'var(--surface-danger-text)'; const failedColor = getComputedStyle(probe).color
    probe.style.color = 'hsl(var(--muted-foreground))'; const mutedColor = getComputedStyle(probe).color; probe.remove()
    const box = element.getBoundingClientRect(), style = getComputedStyle(element)
    return { width: box.width, right: box.right, viewport: innerWidth, opacity: style.opacity, color: style.color, failedColor, mutedColor }
  })
  console.log('Persistent failed tool summary', JSON.stringify(facts))
  assert.ok(facts.width > 40 && facts.right <= facts.viewport && facts.opacity === '1', 'failed duration and result remain visible without hover')
  assert.equal(facts.color, facts.failedColor, 'failure uses the actual Brand failed token in each theme')
  assert.notEqual(facts.color, facts.mutedColor, 'failure remains distinct from the normal result color')
}
