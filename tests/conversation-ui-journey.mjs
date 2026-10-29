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
