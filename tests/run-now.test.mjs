// The run page leads with what the run is doing now: the outcome its progress document states first, the play check's
// dense score over versions, and each contract line sent to the fleet with its acknowledgements and the fix commit. The
// receipt is the Lab's for test-contract-loop-20261018c (2026-10-18), whose lines reached the root and its fixer lead;
// rc2 and rc3 fixed them, and the check passed on rc3. Before this, only the Lab's receipt page showed any of it.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NeedsYou, PlayClimb, RunOverview, runReceiptSchema } from '../dist/index.js'

const receipt = runReceiptSchema.parse(JSON.parse(await readFile(new URL('./fixtures/run-receipt-contract-loop.json', import.meta.url), 'utf8')))
const passed = { solved: true, checkedAt: '2026-10-18T01:56:09.489Z', firstFailingLine: null, stage: null, tag: 'test-contract-loop-20261018c/rc3', lastStreamAt: '2026-10-18T01:54:24.901Z', minutesSinceLastStream: 2.1 }
const page = (outcome) => renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc: { receipt, progress: outcome === undefined ? undefined : { outcome } } }))
const text = (html) => html.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')

test('the run page opens with the outcome, the score curve and each contract line with its acknowledgement and fix', () => {
  const html = page(passed)
  const now = html.indexOf('data-section="now"')
  assert.ok(now > 0 && now < html.indexOf('rr-columns'), 'the Now section comes before the evidence columns')
  const words = text(html)
  assert.match(words, /Now✓ Passed · checked 01:56 UTC on rc3/)
  // The page has one clock, in the fold's blocker slot (RunFold); the Now section no longer repeats it.
  assert.doesNotMatch(words, /last agent stream/)
  // The curve is the Lab's points: rc1 at 0, rc2 at 0.5, rc3 at 0.667 when its public stages passed, then 1. The paragraph
  // that repeated them in words is gone (X9); the chart's data table carries the values.
  assert.match(html, /data-field="system\.play\.scores"[^>]*>.*<svg/s)
  // Contract lines are a table: the line (its full text in a drawer), when and on which release it was sent, the later
  // release that fixed it, and what happened then.
  assert.match(words, /To 2 agents; acknowledged: root delivered, s0 delivered01:51 UTC on rc1Fixed in rc2 \(47711253\)a later stage failed instead at 01:53 UTC/)
  assert.match(words, /workloads\/beta\.txt must hold the single word betaTo the root; acknowledged: root delivered01:53 UTC on rc2Fixed in rc3 \(a6f78d9e\)its public stages passed and the tag was published at 01:55 UTC/)
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
  assert.match(words, /Now○ No pass yet · checked 01:51 UTC on rc1/)
  assert.match(words, /First failing line \(contract stage\)NOT SOLVED: manifest\.json build must be a cargo argv list/)
  const bare = text(page(undefined))
  assert.doesNotMatch(bare, /Now✓ Passed|Now○ No pass yet/)
  assert.match(bare, /Contract lines sent/)
})

// magnetar-rust-20261018b, 2026-10-18: rc7 passed its pre-tag gate at 07:32Z, the host was stood down at 07:37Z, and the
// page showed rc6's 07:23Z check for 10 hours with nothing saying the keeper was holding rc7's.
test('a live run whose newest version waits for its check says which version and why', () => {
  const failing = { ...passed, solved: false, checkedAt: '2026-10-18T07:23:20.206Z', tag: 'magnetar-rust-20261018b/rc6', stage: 'hidden',
    firstFailingLine: 'NOT SOLVED: (g) workload sha256: reference RV64I execution failed: not an RV64I instruction: 0x6b855593 at 0x10080' }
  const checkWait = { tag: 'magnetar-rust-20261018b/rc7', publishedAt: '2026-10-18T07:32:09.588Z', since: '2026-10-18T07:37:45.098Z', reason: 'the host is stood down: GTR memory 102/121 GB used' }
  const words = text(page({ ...failing, checkWait }))
  assert.match(words, /Now○ No pass yet · checked 07:23 UTC on rc6/)
  assert.match(words, /rc7 is not checked yet · published 07:32 UTC · the host is stood down: GTR memory 102\/121 GB used \(since 07:37 UTC\)/)
  assert.doesNotMatch(text(page({ ...failing, checkWait: null })), /not checked yet/)
})

// discovery-lab #2111, 2026-10-19: a pass whose goal audit could not run reads 'SOLVED (unaudited)' until the audit rules;
// magnetar-rust-20261018b's check passed rc14 declaring 1-bit security against a 120-bit goal.
test('a passed check leads with its solved label and the goal audit behind it', () => {
  const unaudited = text(page({ ...passed, solvedLabel: 'SOLVED (unaudited)', goalAudit: { verdict: 'unaudited', at: '2026-10-18T02:11:00.000Z' } }))
  assert.match(unaudited, /SOLVED \(unaudited\) · checked 01:56 UTC on rc3 · goal audit not ruled yet last tried 02:11 UTC/)
  assert.doesNotMatch(unaudited, /Now✓ Passed/)
  const contradicted = page({ ...passed, solved: false, solvedLabel: 'check passed; goal audit found a contradiction', goalAudit: { verdict: 'contradiction', at: '2026-10-18T02:26:00.000Z' } })
  assert.match(text(contradicted), /check passed; goal audit found a contradiction · checked 01:56 UTC on rc3 · goal audit found a contradiction at 02:26 UTC/)
  // A check that passed is never toned as failing; red is only a person's act-now (CONTEXT.md, Status).
  assert.doesNotMatch(contradicted, /data-status="[^"]*:fail"/)
  assert.match(text(page({ ...passed, solvedLabel: 'SOLVED', goalAudit: null })), /Now✓ SOLVED · checked 01:56 UTC on rc3/)
})

// tangle-tools #1562 (3b4faa91, 2026-10-20) serves who ruled each check dispute, each stage's calibration and a pass held
// for stages no known-good fixture passed. These run documents are what its integration test
// test_needs_you_asks_drew_to_rule_undecided_disputes_and_calibrate_held_passes_on_any_run served from
// /api/discovery/runs/<id>, captured unchanged: 20c holds a pass, 20b carries magnetar-rust-20261020b's ruled and undecided
// disputes, 20a was pressed before the Lab registered calibration. Their receipts are null there, as on any run the Lab has
// not written a receipt for, and they are drawn as served: the check facts come from the run document.
const served = async (id) => JSON.parse(await readFile(new URL(`./fixtures/discovery-run-${id}.json`, import.meta.url), 'utf8'))
const runPage = (doc) => renderToStaticMarkup(createElement(RunOverview, { api: '/api/discovery', doc }))

test('a held pass reads as held in neutral, never failing, with each stage\'s calibration', async () => {
  const html = runPage(await served('codeplay-20261020c'))
  const words = text(html)
  assert.match(words, /Now◌ check passed; held: stages workloads, hidden have no known-good fixture/)
  assert.match(html, /data-status="result:check passed; held: stages workloads, hidden have no known-good fixture:neutral"/)
  assert.doesNotMatch(html, /data-status="[^"]*:fail"/, 'nothing on the run page is red')
  assert.match(words, /No receipt recorded yet/, 'the run has no Lab receipt, and its held pass still reads')
  const line = html.slice(html.indexOf('data-field="progress.outcome.solved"'), html.indexOf('</p>', html.indexOf('data-field="progress.outcome.solved"')))
  assert.doesNotMatch(text(line), /Passed|SOLVED/)
  for (const [stage, state] of [['build', 'calibrated'], ['contract', 'calibrated'], ['workloads', 'uncalibrated'], ['hidden', 'uncalibrated']])
    assert.match(html, new RegExp(`data-stage="${stage}" data-calibration="${state}"[^>]*>${stage} ${state}<`))
  assert.match(html, /data-calibration="uncalibrated"[^>]*>check uncalibrated</)
  // A calibration is a label, never a status mark.
  assert.doesNotMatch(html, /class="rr-calibration[^"]*" data-status/)
})

test('an undecided dispute shows its ruling sentence and its referees, as a ruled one shows who ruled', async () => {
  const html = runPage(await served('codeplay-20261020b'))
  const words = text(html)
  assert.match(words, /Disputed 17:18 UTC as c309bb08b9afUndecided: the referees disagree, so the check stays as pinned until an operator rulesReferees: anthropic\/claude-opus-5-5 \(claude\) rejected; openai\/gpt-6\.1-sol \(codex\) undecided/)
  assert.match(words, /Rejected by the referee at 15:44 UTC: the line standsReferees: anthropic\/claude-opus-5-5 \(claude\) rejected; openai\/gpt-6\.1-sol \(codex\) rejected/)
  assert.doesNotMatch(words, /State not recorded/)
  assert.doesNotMatch(html, /data-status="[^"]*:fail"/)
})

test('a run pressed before calibration was registered names the record that would state it', async () => {
  const html = runPage(await served('codeplay-20261020a'))
  assert.match(html, /data-calibration="unknown"[^>]*>check unknown</)
  assert.match(text(html), /run-input\.json acceptance\.play\.calibration would state it/)
})

// The same harness served the overview's Needs you lines (attention[], kept whole) and the play page. The host tones the
// held pass and the undecided disputes warn or neutral; the issue makes the held pass's line the one red.
const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const statuses = (html) => [...html.matchAll(/data-status="([^"]*)"/g)].map((match) => match[1])

test('in Needs you a held pass is the one red line, and each undecided dispute appears once with its referees', async () => {
  const { attention } = await fixture('discovery-overview-codeplay-attention')
  const html = renderToStaticMarkup(createElement(NeedsYou, { attention }))
  const items = html.split('<li').slice(1)
  const held = items.filter((item) => /data-held="workloads hidden"/.test(item))
  assert.equal(held.length, 1)
  assert.match(text(held[0]), /act now · Drew.*codeplay 20c: check passed; held: stages workloads, hidden have no known-good fixture/)
  assert.match(text(held[0]), /Add a good or reach fixture for workloads, hidden, then run disco calibrate codeplay/)
  assert.deepEqual(statuses(html).filter((status) => status.endsWith(':fail')), ['alert:act now:fail'], 'the held line is the only red')
  for (const run of ['codeplay-20261020b', 'codeplay-20261009a']) {
    const lines = items.filter((item) => item.includes(`href="/run/${run}"`) && /data-dispute="c309bb08b9af"/.test(item))
    assert.equal(lines.length, 1, `${run}'s undecided dispute appears once`)
    assert.match(text(lines[0]), /check dispute c309bb08b9af is undecided, its referees disagree \(anthropic\/claude-opus-5-5 \(claude\) rejected; openai\/gpt-6\.1-sol \(codex\) undecided\)/)
    assert.doesNotMatch(lines[0], /:fail"/)
  }
})

test('the play page shows each run\'s stage calibration under its verdicts, and names the record an unknown needs', async () => {
  const html = renderToStaticMarkup(createElement(PlayClimb, { play: await fixture('discovery-play-codeplay') }))
  const run = (id) => html.slice(html.indexOf(`href="/run/${id}"`), html.indexOf('</li>', html.indexOf(`href="/run/${id}"`)))
  for (const id of ['codeplay-20261020b', 'codeplay-20261020c']) {
    for (const [stage, state] of [['build', 'calibrated'], ['contract', 'calibrated'], ['workloads', 'uncalibrated'], ['hidden', 'uncalibrated']])
      assert.match(run(id), new RegExp(`data-stage="${stage}" data-calibration="${state}"[^>]*>${stage} ${state}<`), `${id} ${stage}`)
  }
  assert.match(run('codeplay-20261020c'), /class="verdict-chip" data-status="result:check passed; held: stages workloads, hidden have no known-good fixture:neutral" data-calibration="uncalibrated"/)
  assert.match(run('codeplay-20261020a'), /data-calibration="unknown"[^>]*>check unknown</)
  assert.match(text(run('codeplay-20261020a')), /run-input\.json acceptance\.play\.calibration would state it/)
  assert.doesNotMatch(html, /:fail"/, 'nothing on the climb is red')
})
