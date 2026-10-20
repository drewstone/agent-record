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
  assert.match(words, /NowPassed · checked 01:56 UTC on rc3 · last agent stream 2\.1 min ago/)
  // The curve is the Lab's points: rc1 at 0, rc2 at 0.5, rc3 at 0.667 when its public stages passed, then 1. The paragraph
  // that repeated them in words is gone (X9); the chart's data table carries the values.
  assert.match(html, /data-field="system\.play\.scores"[^>]*>.*<svg/s)
  assert.match(words, /manifest\.json build must be a cargo argv list \(argv\[0\] == cargo\)Sent 01:51 UTC on rc1 to 2 agentsAcknowledged: root delivered, s0 deliveredFixed in 47711253 \(rc2\): a later stage failed instead at 01:53 UTC/)
  assert.match(words, /workloads\/beta\.txt must hold the single word betaSent 01:53 UTC on rc2 to the rootAcknowledged: root deliveredFixed in a6f78d9e \(rc3\): its public stages passed and the tag was published at 01:55 UTC/)
})

test('each check dispute shows under the outcome with its line and its ruling', () => {
  const disputes = [
    { id: '0a1b2c3d4e5f', at: '2026-10-18T01:52:00.000Z', line: 'NOT SOLVED: alpha.txt must be at most 3 bytes', state: 'upheld', ruledAt: '2026-10-18T02:10:00.000Z', by: 'referee', attempts: 1 },
    { id: '6a7b8c9d0e1f', at: '2026-10-18T02:20:00.000Z', line: 'NOT SOLVED: beta.txt must be empty', state: 'operator', ruledAt: null, by: null, attempts: 2 },
    { id: '1f2e3d4c5b6a', at: '2026-10-18T02:30:00.000Z', line: 'NOT SOLVED: gamma.txt', state: 'open', ruledAt: null, by: null, attempts: 1 },
  ]
  const words = text(page({ ...passed, disputes }))
  assert.match(words, /Check disputesNOT SOLVED: alpha\.txt must be at most 3 bytesDisputed 01:52 UTC as 0a1b2c3d4e5fUpheld by the referee at 02:10 UTC: the check is amended for this run/)
  assert.match(words, /beta\.txt must be emptyDisputed 02:20 UTC as 6a7b8c9d0e1fAwaiting an operator ruling: the referee could not decide/)
  assert.match(words, /Open: the referee outside the run is ruling \(1 attempt so far\)/)
  assert.doesNotMatch(text(page(passed)), /Check disputes/)
})

test('a failing run shows its first failing line with its stage, and a page without progress still shows the Lab lines', () => {
  const failing = { ...passed, solved: false, checkedAt: '2026-10-18T01:51:33.804Z', tag: 'test-contract-loop-20261018c/rc1', stage: 'contract',
    firstFailingLine: 'NOT SOLVED: manifest.json build must be a cargo argv list (argv[0] == cargo)' }
  const words = text(page(failing))
  assert.match(words, /NowNo pass yet · checked 01:51 UTC on rc1/)
  assert.match(words, /First failing line \(contract stage\)NOT SOLVED: manifest\.json build must be a cargo argv list/)
  const bare = text(page(undefined))
  assert.doesNotMatch(bare, /NowPassed|NowNo pass yet/)
  assert.match(bare, /Contract lines sent/)
})

// magnetar-rust-20261018b, 2026-10-18: rc7 passed its pre-tag gate at 07:32Z, the host was stood down at 07:37Z, and the
// page showed rc6's 07:23Z check for 10 hours with nothing saying the keeper was holding rc7's.
test('a live run whose newest version waits for its check says which version and why', () => {
  const failing = { ...passed, solved: false, checkedAt: '2026-10-18T07:23:20.206Z', tag: 'magnetar-rust-20261018b/rc6', stage: 'hidden',
    firstFailingLine: 'NOT SOLVED: (g) workload sha256: reference RV64I execution failed: not an RV64I instruction: 0x6b855593 at 0x10080' }
  const checkWait = { tag: 'magnetar-rust-20261018b/rc7', publishedAt: '2026-10-18T07:32:09.588Z', since: '2026-10-18T07:37:45.098Z', reason: 'the host is stood down: GTR memory 102/121 GB used' }
  const words = text(page({ ...failing, checkWait }))
  assert.match(words, /NowNo pass yet · checked 07:23 UTC on rc6/)
  assert.match(words, /rc7 is not checked yet · published 07:32 UTC · the host is stood down: GTR memory 102\/121 GB used \(since 07:37 UTC\)/)
  assert.doesNotMatch(text(page({ ...failing, checkWait: null })), /not checked yet/)
})

// discovery-lab #2111, 2026-10-19: a pass whose goal audit could not run reads 'SOLVED (unaudited)' until the audit rules;
// magnetar-rust-20261018b's check passed rc14 declaring 1-bit security against a 120-bit goal.
test('a passed check leads with its solved label and the goal audit behind it', () => {
  const unaudited = text(page({ ...passed, solvedLabel: 'SOLVED (unaudited)', goalAudit: { verdict: 'unaudited', at: '2026-10-18T02:11:00.000Z' } }))
  assert.match(unaudited, /SOLVED \(unaudited\) · checked 01:56 UTC on rc3 · goal audit not ruled yet last tried 02:11 UTC/)
  assert.doesNotMatch(unaudited, /NowPassed/)
  const contradicted = page({ ...passed, solved: false, solvedLabel: 'check passed; goal audit found a contradiction', goalAudit: { verdict: 'contradiction', at: '2026-10-18T02:26:00.000Z' } })
  assert.match(text(contradicted), /check passed; goal audit found a contradiction · checked 01:56 UTC on rc3 · goal audit found a contradiction at 02:26 UTC/)
  assert.match(contradicted, /rr-now-failing/)
  assert.match(text(page({ ...passed, solvedLabel: 'SOLVED', goalAudit: null })), /NowSOLVED · checked 01:56 UTC on rc3 · last agent stream 2\.1 min ago/)
})
