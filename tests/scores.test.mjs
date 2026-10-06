import assert from 'node:assert/strict'
import test from 'node:test'
import { chartPairs, headlineScore, median, scoreRows } from '../src/workspace/scores.ts'

const readout = (judges) => ({ status: 'complete', judges })
const review = (persona, overall, scores) => ({ panel: 'p1', persona, overall, decision: 'no', verdict: `${persona} verdict`, scores })
const s = (score, band = null) => ({ score, band, competence: 'expert', why: null })
const grade = (score, kind = 'run', id = 'r', category = 'overall', by = 'drewstone@github') => ({ at: '2026-10-06T03:00:00Z', by, target: { kind, id }, category, score, comment: '', scale: 'absolute 0–100 vs world-class' })

test('median of an even and an odd count', () => {
  assert.equal(median([]), null)
  assert.equal(median([40, 10, 30]), 30)
  assert.equal(median([10, 20, 31, 41]), 25.5)
})

test('scores sit side by side per category: AI judge, persona median and range, and each person', () => {
  const panel = [
    review('cfo', 45, { economics: s(40, 'below professional'), visuals: s(30) }),
    review('investor', 55, { economics: s(50), software: s(null) }),
  ]
  const rows = scoreRows(readout([
    { category: 'economics', score: 62, max: 100, calibrated: false, summary: '' },
    { category: 'clarity', score: null, max: null, calibrated: null, summary: 'Retired relative 0-4 score' },
  ]), panel, [grade(62), grade(70, 'deliverable', 'decision-brief'), grade(30, 'run', 'other-run')], { kind: 'run', id: 'r' })
  const byCategory = Object.fromEntries(rows.map((row) => [row.category, row]))
  assert.deepEqual(rows.map((row) => row.category), ['overall', 'economics', 'clarity', 'graphics', 'software'])
  assert.deepEqual(byCategory.overall.ai, { score: 62, calibrated: false })
  assert.deepEqual([byCategory.overall.personas.median, byCategory.overall.personas.min, byCategory.overall.personas.max], [50, 45, 55])
  assert.deepEqual(byCategory.overall.people.map((g) => g.score), [62], 'only this target’s grades')
  assert.equal(byCategory.clarity.ai, 'retired')
  assert.equal(byCategory.economics.personas.median, 45)
  // The panel's `visuals` is the judges' `graphics`; a persona that gave no number is not counted.
  assert.equal(byCategory.graphics.personas.scores[0].persona, 'cfo')
  assert.deepEqual(byCategory.software.personas.scores, [])
  assert.deepEqual(headlineScore(rows), { score: 62, source: 'judges', n: 1 })
})

test('with only retired judges the headline falls back to the personas, and with nothing it is null', () => {
  const rows = scoreRows(readout([{ category: 'economics', score: null, max: null, calibrated: null, summary: '' }]), [review('cfo', 45, {}), review('policy', 41, {})], [], { kind: 'run', id: 'r' })
  assert.equal(rows[0].ai, 'retired')
  assert.deepEqual(headlineScore(rows), { score: 43, source: 'personas', n: 2 })
  assert.equal(headlineScore(scoreRows(null, [], [], { kind: 'run', id: 'r' })), null)
  // A deliverable's scores are people's only.
  const deliverable = scoreRows(null, null, [grade(70, 'deliverable', 'decision-brief')], { kind: 'deliverable', id: 'decision-brief' })
  assert.deepEqual(deliverable.map((row) => [row.category, row.ai, row.people.length]), [['overall', null, 1]])
})

test('charts pair by id, then by unit, then alone, with the run-process charts last', () => {
  const c = (id, unit) => ({ id, title: id, unit, kind: 'bar', caption: null, width: 1200, height: 600, href: `/x/${id}.png` })
  const pairs = chartPairs(
    [c('chart2', '$/MMBtu'), c('chart4', '$M'), c('run-spend', 'USD'), c('chart9', 'kg')],
    [c('run-spend', 'USD'), c('cost-by-scale', '$/MMBtu'), c('cash-needs', 'M$'), c('value-of-info', 'M$')],
  )
  assert.deepEqual(pairs.map((p) => [p.before?.id ?? null, p.after?.id ?? null, p.match]), [
    ['chart2', 'cost-by-scale', 'unit'],
    [null, 'cash-needs', null],
    [null, 'value-of-info', null],
    ['chart4', null, null],
    ['chart9', null, null],
    ['run-spend', 'run-spend', 'id'],
  ])
  assert.deepEqual(chartPairs(null, undefined), [])
})
