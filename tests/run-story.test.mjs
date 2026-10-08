import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bestOf,
  checkWords,
  cleanEvidence,
  clockView,
  costView,
  dataQuality,
  effectWords,
  goalSentence,
  lineageSegments,
  lineageUsage,
  missingChecks,
  productFiles,
  readerTest,
  riskOf,
  roleHistory,
  runLabel,
  stall,
  stripMachineKeys,
  teamCards,
} from '../src/workspace/run-story.ts'

const H = 3_600_000
const at = (hours) => new Date(Date.UTC(2026, 9, 8, 0, 0) + hours * H).toISOString()
const vector = (exact, held = [2, 6], blockers = null, judge = 71) => ({ exact: [exact, 18], heldOut: held, blockers, judge })
const tag = (name, hours, exact, extra = {}) => ({
  name, commit: name.padEnd(40, '0'), at: at(hours), scoredAt: at(hours + 1), by: 'editor', best: false, run: 'play-20261008f', complete: true,
  vector: vector(exact), flags: [], results: [['model-reproduces', 'exact', exact > 7, null], ['workbook-live-model', 'exact', false, 0], ['reader-test', 'heldOut', false, 0.63]], ...extra,
})
// A lineage's releases: e tags rc1-rc2 (rc2 best, 8/18), f ties then regresses, f-c1 has not tagged better.
const releases = {
  rule: 'exact checks, then held-out checks (runner/release-score.mjs)', best: 'rc2',
  tags: [
    tag('rc1', -10, 6, { run: 'play-20261007e' }),
    tag('rc2', -8, 8, { run: 'play-20261007e', best: true, vector: vector(8, [2, 6], 3) }),
    tag('rc3', -4, 8, { run: 'play-20261008f' }),
    tag('rc4', -2, 7, { run: 'play-20261008f', flags: ['regression'] }),
    { ...tag('rc0', -20, 0), vector: null, results: [], run: 'play-20261006d' },
  ],
  evidence: { rc2: { 'workbook-live-model': 'workbook.xlsx, sha256 0123456789ab: 1530 formulas (bar 2000) in pages/terraform/x/workbook.md [H:npv]', 'reader-test': 'reader score 0.630; bar: score ≥ 0.9, page ≥ 0.85' } },
}

test('names a run by its lineage letter and states the goal as one sentence', () => {
  assert.equal(runLabel('terraform-dc-tokens-20261008f-c1', 'terraform-dc-tokens'), 'f-c1')
  assert.equal(runLabel('terraform-dc-tokens-20261007e-codex1', 'terraform-dc-tokens'), 'e-codex1')
  assert.equal(runLabel('some-run', 'other-play'), 'some-run')
  assert.equal(goalSentence('Deliver a model to Casey. Then keep checks passing.'), 'Deliver a model to Casey.')
  assert.equal(goalSentence('Build it: the scale ladder and more'), 'Build it.')
  assert.equal(goalSentence(null), null)
  assert.match(goalSentence('word '.repeat(80), 40), /…$/)
})

test('a fork inherits its source deadline: the window began before the fork and the time left counts to it', () => {
  const clock = { deadlineAt: at(18), spanMs: 18 * H, basis: 'continuation deadline', inheritedFrom: 'f' }
  const view = clockView(clock, at(4), null, Date.parse(at(5)))
  assert.equal(view.elapsedMs, H)
  assert.equal(view.leftMs, 13 * H)
  assert.ok(Math.abs(view.used - 5 / 18) < 1e-9, 'the window started at the deadline minus its span')
  const settled = clockView(clock, at(4), at(6), Date.parse(at(9)))
  assert.equal(settled.elapsedMs, 2 * H)
  assert.equal(settled.leftMs, 0)
  assert.deepEqual(clockView(null, at(0), null, Date.parse(at(1))), { elapsedMs: H, leftMs: null, spanMs: null, used: null, deadlineAt: null })
})

test('the best version and how long the lineage has gone without a better one, with the tokens used since', () => {
  const best = bestOf(releases)
  assert.equal(best.name, 'rc2')
  const usage = [[Date.parse(at(-9)), 100], [Date.parse(at(-8)), 150], [Date.parse(at(-1)), 900]]
  const stalled = stall(releases, usage, Date.parse(at(0)))
  assert.equal(stalled.since.name, 'rc2')
  assert.equal(stalled.ms, 8 * H)
  assert.equal(stalled.after, 2, 'rc3 tied and rc4 regressed: two later versions, none better')
  assert.equal(stalled.tokens, 750)
  const clock = clockView({ deadlineAt: at(10), spanMs: 18 * H, basis: null, inheritedFrom: null }, at(-8), null, Date.parse(at(0)))
  const risk = riskOf('running', clock, best, stalled)
  assert.equal(risk.level, 'at-risk')
  assert.match(risk.reason, /no better version in 8\.0 h \(since rc2\)/)
  assert.equal(riskOf('running', clock, best, { ...stalled, ms: H }).level, 'on-track')
  assert.equal(riskOf('driver-failed', clock, best, stalled, 'driver failed after 54 attempts').reason, 'driver failed after 54 attempts')
})

test('what is left: each failing check of the best version in words, with its record across versions', () => {
  const rows = missingChecks(releases)
  assert.deepEqual(rows.map((row) => row.id), ['workbook-live-model', 'reader-test'], 'must-pass first; checks the best passes are not listed')
  assert.equal(rows[0].title, 'Workbook live model')
  assert.equal(rows[0].movement, 'never passed in 4 versions')
  assert.deepEqual(rows[0].track.map((row) => row.pass), [false, false, false, false])
  assert.equal(rows[0].evidence, 'workbook.xlsx: 1530 formulas (bar 2000) in workbook.md', 'no hash, no machine key, no long path')
  assert.equal(checkWords('dispatch-lp-8760'), 'Dispatch LP 8760')
  // A check the best fails that an earlier version passed reads as a regression.
  const regressed = { ...releases, tags: releases.tags.map((item) => (item.name === 'rc1' ? { ...item, results: [['workbook-live-model', 'exact', true, 1]] } : item)) }
  const row = missingChecks(regressed).find((item) => item.id === 'workbook-live-model')
  assert.equal(row.movement, 'passed at rc1, failing since rc2')
  assert.equal(row.regressed, true)
  assert.deepEqual(readerTest(releases, bestOf(releases)), { score: 0.63, pass: false, bar: 0.9 })
  assert.equal(cleanEvidence('a, sha256 abcdef0123456789: b'), 'a: b')
})

test('cost: Runtime\'s unpriced $0 is no figure, so the metered tokens show; a settled readout\'s two figures win', () => {
  const meter = { tokens: { input: 1_000_000, output: 200_000, cacheRead: 40_000_000, cacheWrite: 0 }, tokensKnown: false, turns: 12, usd: null, at: at(0) }
  const live = costView({ meter, listUsd: null, listKnown: false, basis: null, gaps: [{ code: 'price-unknown', detail: 'unknown-floor' }],
    readoutApi: null, readoutBilled: null, sandboxUsd: null, apiUsd: null, models: ['gpt-6.1-sol'] })
  assert.equal(live.apiUsd, null)
  assert.equal(live.tokens, 41_200_000)
  assert.equal(live.tokensFloor, true)
  assert.equal(live.apiMissing, 'No API list price for gpt-6.1-sol yet')
  assert.equal(live.billedNote, 'not reconciled yet')
  const settled = costView({ meter, listUsd: 1498.5, listKnown: false, basis: 'estimated', gaps: [],
    readoutApi: { usd: 1951.03, provenance: 'estimated' }, readoutBilled: { usd: 5.75, provenance: 'model plus compute' }, sandboxUsd: 4.91, apiUsd: 0, models: [] })
  assert.equal(settled.apiUsd, 1951.03)
  assert.equal(settled.billedUsd, 5.75, 'the reconciled bill, not the ledger reading beside it')
  const floor = costView({ meter: null, listUsd: 0, listKnown: true, basis: 'unknown-floor', gaps: [], readoutApi: { usd: 0, provenance: 'unknown-floor' },
    readoutBilled: null, sandboxUsd: null, apiUsd: null, models: ['m'] })
  assert.equal(floor.apiUsd, 0, 'a recorded list price of $0 without a price gap stays as recorded')
})

test('the product: machine keys leave the quoted summary, and the report opens first', () => {
  assert.equal(stripMachineKeys('worth only $52 [H:voi_ev_upper_low] to $1307 [H:voi_ev_upper_high].'), 'worth only $52 to $1307.')
  const files = productFiles([
    { file: 'model-code.zip', label: 'Model code (zip)', bytes: 10, href: '/z' },
    { file: 'workbook.xlsx', label: 'XLSX workbook.xlsx', bytes: 10, href: '/w' },
    { file: 'other.xlsx', label: 'XLSX other.xlsx', bytes: 10, href: '/o' },
    { file: 'report.md', label: 'Report (Markdown)', bytes: null, href: '/m' },
    { file: 'report.html', label: 'Report (HTML)', bytes: null, href: '/h' },
  ])
  assert.deepEqual(files.map((file) => file.kind), ['Report', 'Workbook', 'other.xlsx', 'Report (Markdown)', 'Model code'])
})

test('team cards: a live agent without a terminal state is working; a meter without counts is no measurement', () => {
  const now = Date.parse(at(1))
  const base = { label: 's10 · referee-v1', role: 'Run f integration referee', parent: 'root', model: 'gpt-6.1-sol', harness: 'codex', end: null,
    liveStatus: 'running', lastActiveAt: at(1 - 2 / 60), calls: 23, lastText: 'Found two issues.', lastTextAt: at(0.5), recordTokens: null, usd: null, usdEstimated: false }
  const [card] = teamCards([{ ...base, id: 's10', status: null, start: at(1 - 47 / 60), meter: { tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }, tokensKnown: true, turns: 1, usd: null, at: null } }], true, now)
  assert.equal(card.state, 'working')
  assert.equal(card.title, 'Referee')
  assert.equal(card.line, 'working · 47 min · 23 tool calls · active 2 min ago')
  assert.equal(card.tokens, 6)
  const [unmetered] = teamCards([{ ...base, id: 's4', status: 'done', start: at(0), end: at(0.5), meter: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokensKnown: false, turns: 2, usd: null, at: null } }], true, now)
  assert.equal(unmetered.state, 'finished')
  assert.equal(unmetered.tokens, null, 'turns metered without counts are not zero tokens')
  const [ended] = teamCards([{ ...base, id: 's5', status: null, start: at(0), meter: null }], false, now)
  assert.equal(ended.state, 'ended', 'a settled run never shows a silent agent as working')
})

test('lineage: runs overlap in time, so usage sums every run\'s turns; each run says whether it raised the best score', () => {
  const segment = (runId, series, extra = {}) => ({ runId, state: 'no-winner', startedAt: null, settledAt: null, from: null, forkedAt: null, sourceCommit: null,
    meter: { tokens: { input: 0, output: 0, cacheRead: series.at(-1)?.[1] ?? 0, cacheWrite: 0 }, tokensKnown: true, turns: series.length, usd: null, at: null },
    series, apiEquivalentUsd: null, billedUsd: null, ...extra })
  const d = segment('play-20261006d', [[at(-30), 10], [at(-10), 30]])
  const e = segment('play-20261007e', [[at(-20), 5], [at(-8), 9]], { forkedAt: at(-21) })
  assert.deepEqual(lineageUsage([d, e], []).map(([, total]) => total), [10, 15, 35, 39])
  const views = lineageSegments([d, e, segment('play-20261008f', [], { forkedAt: at(-5) })], releases, 'play-20261008f', 'play')
  assert.deepEqual(views.map((view) => [view.label, view.tags.length, view.improved]), [['d', 1, false], ['e', 2, true], ['f', 2, false]])
  assert.equal(views[2].current, true)
})

test('profile changes by role, each with the score of the version before and after it', () => {
  const change = (role, hours, run) => ({ commit: `${role}${hours}`.padEnd(40, '0'), at: at(hours), role, path: `profiles/roles/${role}.json`, digest: null, parentDigest: null, parentNode: null, status: 'revision', reason: 'Why.', run })
  const roles = roleHistory([change('editor', -9, 'play-20261007e'), change('editor', -3, 'play-20261008f'), change('finance', -12, 'play-20261006d')], releases)
  assert.deepEqual(roles.map((role) => role.role), ['editor', 'finance'], 'the most recently changed role first')
  assert.equal(effectWords(roles[0].versions[1]), 'next version rc4: 7 of 18 must-pass (-1 from rc3)')
  assert.equal(effectWords(roles[0].versions[0]), 'next version rc2: 8 of 18 must-pass (+2 from rc1)')
})

test('data quality is one line that names what the record could not measure and why', () => {
  const quality = dataQuality({ capture: { complete: 0, lossy: 12, absent: 0 }, agents: 12, metered: 11, priced: 0, live: true, unpricedModels: ['gpt-6.1-sol'] })
  assert.equal(quality.line, 'conversations partial for 12 of 12 agents · usage metered for 11 of 12 agents · priced for 0')
  assert.equal(quality.reasons.length, 3)
  assert.equal(dataQuality({ capture: { complete: 3, lossy: 0, absent: 0 }, agents: 3, metered: 3, priced: 3, live: false, unpricedModels: [] }), null)
})

test('review findings: unscored checks, settled clocks, bad times and unmeasured meters never read as facts', async () => {
  const { utcDay } = await import('../src/workspace/run-story.ts')
  assert.equal(utcDay('not a time'), '')
  // A settled run without a settle time stops at its recorded duration, not at now.
  const settled = clockView(null, at(0), null, Date.parse(at(10)), false, H)
  assert.equal(settled.elapsedMs, H)
  // An evaluator error is not a failed check.
  const errored = { ...releases, tags: releases.tags.map((item) => (item.name === 'rc2' ? { ...item, results: [...item.results, ['monte-carlo', 'exact', null, null]] } : item)) }
  assert.ok(!missingChecks(errored).some((row) => row.id === 'monte-carlo'))
  const unmeasured = lineageSegments([{ runId: 'play-20261007e', state: 'unknown', startedAt: null, settledAt: null, from: null, forkedAt: null, sourceCommit: null,
    meter: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokensKnown: false, turns: 1, usd: null, at: null }, series: [], apiEquivalentUsd: null, billedUsd: null }], null, 'x', 'play')
  assert.equal(unmeasured[0].tokens, null)
})
