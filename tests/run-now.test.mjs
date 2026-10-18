// The run page leads with what the run is doing now: the outcome its progress document states first, the play check's
// dense score over versions, and each contract line sent to the fleet with its acknowledgements and the fix commit. The
// receipt is the Lab's for test-contract-loop-20261018c (2026-10-18), whose lines reached the root and its fixer lead;
// rc2 and rc3 fixed them, and the check passed on rc3. Before this, only the Lab's receipt page showed any of it.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RunOverview, runReceiptSchema } from '../dist/index.js'

const receipt = runReceiptSchema.parse(JSON.parse(await readFile(new URL('./fixtures/run-receipt-contract-loop.json', import.meta.url), 'utf8')))
const passed = { solved: true, checkedAt: '2026-10-18T01:56:09.489Z', firstFailingLine: null, stage: null, tag: 'test-contract-loop-20261018c/rc3', lastStreamAt: '2026-10-18T01:54:24.901Z', minutesSinceLastStream: 2.1 }
const page = (outcome) => renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: { receipt, progress: outcome === undefined ? undefined : { outcome } } }))
const text = (html) => html.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')

test('the run page opens with the outcome, the score curve and each contract line with its acknowledgement and fix', () => {
  const html = page(passed)
  const now = html.indexOf('data-section="now"')
  assert.ok(now > 0 && now < html.indexOf('rr-columns'), 'the Now section comes before the evidence columns')
  const words = text(html)
  assert.match(words, /Check passed · checked 01:56 UTC on rc3 · last agent stream 2\.1 min ago/)
  // The curve is the Lab's points: rc1 at 0, rc2 at 0.5, rc3 at 0.667 when its public stages passed, then 1.
  assert.match(html, /data-field="system\.play\.scores"[^>]*>.*<svg/s)
  assert.match(words, /rc1 0 \(stage 1 of 3 \(manifest\), public workloads 0\/2\) → rc2 0\.5 .* → rc3 0\.667 .* → rc3 1 \(every stage passed\)/)
  assert.match(words, /manifest\.json build must be a cargo argv list \(argv\[0\] == cargo\)Sent 01:51 UTC on rc1 to 2 agentsAcknowledged: root delivered, s0 deliveredFixed in 47711253 \(rc2\): a later stage failed instead at 01:53 UTC/)
  assert.match(words, /workloads\/beta\.txt must hold the single word betaSent 01:53 UTC on rc2 to the rootAcknowledged: root deliveredFixed in a6f78d9e \(rc3\): its public stages passed and the tag was published at 01:55 UTC/)
})

test('a failing run shows its first failing line with its stage, and a page without progress still shows the Lab lines', () => {
  const failing = { ...passed, solved: false, checkedAt: '2026-10-18T01:51:33.804Z', tag: 'test-contract-loop-20261018c/rc1', stage: 'contract',
    firstFailingLine: 'NOT SOLVED: manifest.json build must be a cargo argv list (argv[0] == cargo)' }
  const words = text(page(failing))
  assert.match(words, /Check not passing · checked 01:51 UTC on rc1/)
  assert.match(words, /First failing line \(contract stage\)NOT SOLVED: manifest\.json build must be a cargo argv list/)
  const bare = text(page(undefined))
  assert.doesNotMatch(bare, /Check passed|Check not passing/)
  assert.match(bare, /Contract lines sent/)
})
