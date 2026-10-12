import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apiCost, axisTicks, billedCost, day, dollars, dotLabel, headlineBars, panelModel, playNames } from '../src/workspace/theatre.ts'

const act = (n, over = {}) => ({
  act: n, decided: `2026-10-0${n}T10:00:00.000Z`, proposer: 'operator', change: `change ${n}`, plays: [], onBar: [],
  spend: { apiEquivalentUsd: null, apiEquivalentKnown: false, billedUsd: null, billedKnownUsd: null, billedComplete: false, plays: 1, playsWithSpend: 0 },
  rounds: { own: 0, complete: 0, offBarRead: 0 }, best: null, result: { status: 'not-on-bar', text: 'x' }, ...over,
})
const step = (play, tag, at, passed, status = 'selected', over = {}) => ({ play, act: play.startsWith('p-b') ? 3 : 2, tag, taggedAt: `2026-10-0${at}T00:00:00.000Z`, status, inside: false, reason: null, passed, total: 10, ...over })
const round = (s) => ({ play: s.play, act: s.act, tag: s.tag, taggedAt: s.taggedAt, score: { passed: s.passed, total: 10 } })

// Act 1 is another bar's play whose rounds this bar read; act 2 climbs 4 -> 7 -> 9 with a rejected, an invalid and an unread round;
// act 3 forks act 2's rc3 and ends at the best round, 10 of 10.
const steps = [step('p-a-20261002a', 'rc1', 3, 4), step('p-a-20261002a', 'rc2', 4, 3, 'rejected'), step('p-a-20261002a', 'rc3', 5, 7), step('p-a-20261002a', 'rc4', 6, 6, 'invalid'), step('p-a-20261002a', 'rc5', 6, 7, 'rejected', { inside: true }), step('p-b-20261003b', 'rc6', 7, 10)]
const view = {
  theatre: 't', goal: 'Build it.', asOf: '2026-10-07T00:00:00.000Z',
  bar: { digest: 'sha256:aaa', checkCount: 10, policy: 'operator', set: { source: 'set.mjs' }, test: 'test-cannot-resolve' },
  headline: { best: { play: 'p-b-20261003b', tag: 'rc6', taggedAt: '2026-10-07T00:00:00.000Z', text: '' }, plays: { onBar: 2, live: [] } },
  acts: [act(1, { onBar: [], rounds: { own: 0, complete: 0, offBarRead: 1 } }), act(2, { onBar: ['p-a-20261002a'] }), act(3, { onBar: ['p-b-20261003b'] }), act(4, { plays: ['p-c'] })],
  staircase: steps,
  rounds: [...steps.map(round), { play: 'p-a-20261002a', act: 2, tag: 'rc7', taggedAt: '2026-10-06T12:00:00.000Z', score: null }],
  playbill: [{ play: 'p-b-20261003b', act: 3, fork: { play: 'p-a-20261002a', tag: 'rc3' } }, { play: 'p-a-20261002a', act: 2, fork: { play: 'p-z-20261001z', tag: 'rc1' } }],
  offBar: [{ owner: 'p-z-20261001z', act: 1, readRounds: [{ tag: 'rc1', taggedAt: '2026-10-02T00:00:00.000Z', passed: 2, total: 10 }] }],
}

test('a panel places the acts in equal columns, every round as a dot, and the best round last and loudest', () => {
  const panel = panelModel(view, 0, { width: 1000, height: 380 })
  assert.deepEqual(panel.columns.map((column) => column.act), [1, 2, 3], 'act 4 has no play on this bar and no round read here: no column')
  const widths = panel.columns.map((column) => Math.round(column.x1 - column.x0))
  assert.equal(new Set(widths).size, 1, 'equal columns')
  assert.equal(panel.dots.length, 6 + 1 + 1, 'six read rounds, one with no reading, one earlier round read on this bar')
  const byKey = new Map(panel.dots.map((dot) => [dot.key, dot]))
  assert.equal(byKey.get('p-a-20261002a rc1').kind, 'selected')
  assert.equal(byKey.get('p-a-20261002a rc2').kind, 'rejected')
  assert.equal(byKey.get('p-a-20261002a rc4').kind, 'invalid')
  assert.equal(byKey.get('p-a-20261002a rc5').kind, 'inside')
  assert.equal(byKey.get('p-a-20261002a rc7').kind, 'unread')
  assert.equal(byKey.get('p-z-20261001z rc1').kind, 'earlier')
  assert.equal(panel.unreadCount, 1)
  // Height is the checks passed; an unread round sits on the baseline.
  assert.ok(byKey.get('p-b-20261003b rc6').y < byKey.get('p-a-20261002a rc3').y, '10 of 10 is higher than 7 of 10')
  assert.equal(byKey.get('p-a-20261002a rc7').y, panel.plot.bottom)
  assert.equal(byKey.get('p-b-20261003b rc6').y, panel.plot.top, 'the top of the plot is every check')
  // Inside a column the rounds run in the order they were tagged.
  const act2 = panel.dots.filter((dot) => dot.act === 2).sort((a, b) => a.x - b.x).map((dot) => dot.tag)
  assert.deepEqual(act2, ['rc1', 'rc2', 'rc3', 'rc4', 'rc5', 'rc7'])
  assert.ok(panel.dots.every((dot) => dot.x > panel.columns.find((column) => column.act === dot.act).x0 && dot.x < panel.columns.find((column) => column.act === dot.act).x1))
  assert.equal(panel.best.key, 'p-b-20261003b rc6')
  assert.equal(panel.best.best, true)
  assert.equal(panel.bestText, 'b rc6 · 10 of 10')
})

test('the best-so-far line follows the accepted steps and runs to the right edge; fork edges join a first round to its parent round', () => {
  const panel = panelModel(view, 0, { width: 1000, height: 380 })
  const points = panel.line.match(/[MHV][\d.]+/gu)
  assert.equal(points[0].startsWith('M'), true)
  const accepted = ['p-a-20261002a rc1', 'p-a-20261002a rc3', 'p-b-20261003b rc6'].map((key) => panel.dots.find((dot) => dot.key === key))
  assert.ok(panel.line.startsWith(`M${accepted[0].x.toFixed(1)} ${accepted[0].y.toFixed(1)}`))
  assert.ok(panel.line.includes(`H${accepted[1].x.toFixed(1)} V${accepted[1].y.toFixed(1)}`))
  assert.ok(panel.line.endsWith(`H${(1000 - panel.plot.right).toFixed(1)}`))
  assert.deepEqual(panel.edges.map((edge) => [edge.from, edge.to]).sort(), [['p-a-20261002a rc3', 'p-b-20261003b rc6'], ['p-z-20261001z rc1', 'p-a-20261002a rc1']])
})

test('a bar whose only round has no reading draws a tick on the baseline, no line and no best', () => {
  const lone = {
    ...view, bar: { ...view.bar, checkCount: 15 }, headline: { best: null, plays: { onBar: 1, live: ['p'] } },
    acts: [act(6, { onBar: ['p'], rounds: { own: 1, complete: 0, offBarRead: 0 } })], staircase: [], playbill: [{ play: 'p', act: 6, fork: null }], offBar: [],
    rounds: [{ play: 'p', act: 6, tag: 'rc1', taggedAt: '2026-10-12T06:10:02.000Z', score: null }],
  }
  const panel = panelModel(lone, 1, { width: 700, height: 300 })
  assert.equal(panel.title, 'Bar 2')
  assert.equal(panel.line, '')
  assert.equal(panel.best, null)
  assert.equal(panel.bestText, null)
  assert.equal(panel.unreadCount, 1)
  assert.deepEqual(panel.columns.map((column) => column.act), [6])
  assert.equal(panel.dots[0].y, panel.plot.bottom)
  assert.deepEqual(panel.ticks.map((tick) => tick.value), [0, 5, 10, 15])
})

test('rounds of plays no act holds get a column of their own, not a silent drop', () => {
  const loose = { ...view, rounds: [...view.rounds, { play: 'p-x-20261005x', act: null, tag: 'rc1', taggedAt: '2026-10-07T01:00:00.000Z', score: { passed: 1, total: 10 } }] }
  const panel = panelModel(loose, 0, { width: 1000, height: 380 })
  assert.deepEqual(panel.columns.map((column) => column.act), [1, 2, 3, null])
  assert.equal(panel.dots.filter((dot) => dot.act === null).length, 1)
})

test('the header names the current bar\'s best round and each earlier bar\'s beside its own checks, and never picks one across bars', () => {
  const lone = { ...view, bar: { ...view.bar, digest: 'sha256:bbb', checkCount: 15 }, headline: { best: null, plays: { onBar: 1, live: ['p'] } }, staircase: [] }
  const head = headlineBars([view, lone])
  assert.deepEqual([head.current.bar, head.current.best, head.current.live], [2, null, 1], 'the current bar has no round read yet; the earlier bar\'s best is not its best')
  assert.deepEqual(head.earlier.map((item) => [item.bar, item.play, item.tag, item.passed, item.total, item.checks]), [[1, 'b', 'rc6', 10, 10, 10]])
  const read = { ...lone, headline: { best: { play: 'p-b-20261003b', tag: 'rc1', taggedAt: '2026-10-08T00:00:00.000Z', text: '' }, plays: { onBar: 1, live: [] } }, staircase: [step('p-b-20261003b', 'rc1', 8, 3, 'selected', { total: 15 })] }
  const both = headlineBars([view, read])
  assert.deepEqual([both.current.bar, both.current.best.tag, both.current.best.passed, both.current.best.total], [2, 'rc1', 3, 15])
  assert.equal(both.earlier.length, 1)
  assert.deepEqual(headlineBars([view]).earlier, [])
  assert.equal(headlineBars([]), null)
})

test('axis ticks are thirds when whole, else halves; a name repeated across rounds is still one name', () => {
  assert.deepEqual(axisTicks(27), [0, 9, 18, 27])
  assert.deepEqual(axisTicks(15), [0, 5, 10, 15])
  assert.deepEqual(axisTicks(10), [0, 5, 10])
  assert.deepEqual(axisTicks(1), [0, 1])
  assert.equal(playNames(['x-20261009g-fork', 'x-20261009g-fork', 'x-20261009g']).get('x-20261009g-fork'), 'g-fork', 'one play with 25 rounds is not 25 plays that read alike')
})

test('a fork edge ends at the play\'s first round that was read, not at a tick', () => {
  const forked = { ...view, rounds: [...view.rounds, { play: 'p-c-20261004c', act: 3, tag: 'rc1', taggedAt: '2026-10-04T00:00:00.000Z', score: null }, { play: 'p-c-20261004c', act: 3, tag: 'rc2', taggedAt: '2026-10-05T00:00:00.000Z', score: { passed: 5, total: 10 } }], playbill: [{ play: 'p-c-20261004c', act: 3, fork: { play: 'p-a-20261002a', tag: 'rc3' } }], staircase: [...view.staircase, { play: 'p-c-20261004c', act: 3, tag: 'rc2', taggedAt: '2026-10-05T00:00:00.000Z', status: 'rejected', inside: false, reason: null, passed: 5, total: 10 }] }
  const edge = panelModel(forked, 0, { width: 1000, height: 380 }).edges[0]
  assert.equal(edge.to, 'p-c-20261004c rc2')
})

test('names, dates and money say unknown as unknown', () => {
  assert.deepEqual([...playNames(['terraform-dc-build-20261009g', 'terraform-dc-build-20261009g-fork', 'terraform-dc-tokens-20261008f-c1']).values()], ['g', 'g-fork', 'f-c1'])
  assert.deepEqual([...playNames(['terraform-final-closeout-alpha-20261012a', 'terraform-final-closeout-20261012a']).values()], ['final-closeout-alpha-20261012a', 'final-closeout-20261012a'], 'two plays that read alike keep their ids')
  assert.equal(day('2026-10-09T23:59:00.000Z'), '9 Oct')
  assert.equal(day(null), 'undated')
  assert.equal(dollars(null), 'unknown')
  assert.equal(dollars(2327.4), '$2,327')
  assert.equal(dollars(5.746, true), 'at least $5.75')
  const spend = { apiEquivalentUsd: 2027.2, apiEquivalentKnown: false, billedUsd: null, billedKnownUsd: 0, billedComplete: false, plays: 2, playsWithSpend: 2 }
  assert.equal(apiCost(spend), 'at least $2,027', 'some calls were unpriced: a lower bound')
  assert.equal(billedCost(spend), 'at least $0.00', 'the Router part read $0 and the Sandbox part is unread: not "$0"')
  assert.equal(billedCost({ ...spend, billedKnownUsd: null }), 'unknown')
  assert.equal(billedCost({ ...spend, billedUsd: 12, billedComplete: true }), '$12.00')
  assert.equal(apiCost({ ...spend, apiEquivalentUsd: null }), 'unknown')
  const names = new Map([['p-a-20261002a', 'a']])
  assert.equal(dotLabel({ play: 'p-a-20261002a', tag: 'rc2', kind: 'rejected', passed: 3, total: 10 }, names), 'a rc2: 3 of 10 checks, rejected')
  assert.equal(dotLabel({ play: 'p-a-20261002a', tag: 'rc7', kind: 'unread', passed: null, total: null }, names), 'a rc7: no complete reading yet')
})
