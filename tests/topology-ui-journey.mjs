import assert from 'node:assert/strict'

export async function proveTopology(page, width, theme, evidence, { nodes, workspace, emit }) {
  await page.getByRole('tab', { name: 'Topology', exact: true }).click()
  await page.locator(`.ag-topology[data-layout="${width === 390 ? 'list' : 'ready'}"]`).waitFor()
  const choose = async name => {
    await page.getByRole('button', { name: 'Go to agent', exact: true }).click()
    await page.locator('.rp-lb input').fill(name)
    await page.getByRole('option', { name: `${name} —`, exact: true }).click()
  }
  await choose('root')
  const root = page.locator(width === 390 ? '.ag-phone-select[data-agent-id]').filter({ has: page.getByText('root', { exact: true }) }) : page.locator('.react-flow__node[data-id]').filter({ has: page.getByText('root', { exact: true }) })
  await root.locator('.ag-agent-card').waitFor()
  await root.scrollIntoViewIfNeeded()
  const identity = root.locator('[data-agent-identity]')
  assert.equal(await identity.innerText(), 'opencode · Recorded model')
  const mark = root.locator('[aria-label="OpenCode"]')
  assert.ok(await mark.evaluate(element => element.firstElementChild.getBoundingClientRect().width >= 16))
  const cards = page.locator('.ag-agent-card')
  assert.ok(await cards.count() < 100, '124 agents keep a bounded rendered window')
  const sizes = await cards.evaluateAll(nodes => nodes.flatMap(node => [...node.querySelectorAll('span,p')].filter(child => child.textContent.trim()).map(child => parseFloat(getComputedStyle(child).fontSize))))
  assert.ok(sizes.length && sizes.every(size => size >= 13), `actual consumer type floor: ${sizes}`)
  if (width !== 390) {
    const a = await root.boundingBox(), b = await page.locator('.react-flow__node-agentFrame').boundingBox()
    assert.ok(a.x+a.width < b.x, 'the actual root is separate from its team')
    assert.equal(await page.locator('.react-flow__viewport').evaluate(element=>new DOMMatrixReadOnly(getComputedStyle(element).transform).a),1)
  }
  if (evidence) await page.screenshot({path:`${evidence}/topology-root-${width}-${theme}.png`})
  await choose('Worker 123')
  const selected = page.locator('.ag-agent-card[data-selected]')
  await selected.scrollIntoViewIfNeeded()
  const previous = nodes[123].usage.tokens, navigation = await page.evaluate(()=>performance.getEntriesByType('navigation').length), before = await selected.boundingBox()
  const reads = [], onRequest = request => { if (new URL(request.url()).pathname.endsWith('/workspace')) reads.push(request.url()) }
  page.on('request',onRequest)
  nodes[123].usage.tokens = 2048
  emit(workspace())
  await selected.locator('[data-agent-tokens]').getByText('2.0k tok',{exact:true}).waitFor()
  await page.waitForTimeout(3200)
  page.removeListener('request',onRequest)
  assert.deepEqual(reads,[], 'native workspace SSE updates Topology without periodic workspace reads')
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),navigation)
  assert.match(page.url(),/agent=s123/)
  const after = await selected.boundingBox()
  assert.ok(Math.abs(after.x-before.x)<1 && Math.abs(after.y-before.y)<1,'selected card stays anchored during a native token update')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  if (evidence) await page.screenshot({path:`${evidence}/topology-native-update-${width}-${theme}.png`})
  nodes[123].usage.tokens = previous
  console.log('Native Topology update',JSON.stringify({width,theme,agents:124,navigationUnchanged:true,periodicWorkspaceReads:reads.length}))
}
