import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseResearchReport, playReportToResearchReport } from '../dist/index.js'

const served = () => JSON.parse(readFileSync(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8'))

test('the served sample adapts to a valid agent-research-report.v1 with one play', () => {
  const report = playReportToResearchReport(served())
  assert.deepEqual(parseResearchReport(report), report)
  assert.equal(report.plays.length, 1)
  assert.equal(report.plays[0].questionCoverage.length, 10)
  assert.equal(report.plays[0].rules.length, 5)
  assert.equal(report.plays[0].rules.reduce((sum, rule) => sum + rule.instances.length, 0), 8)
  assert.equal(report.plays[0].unknowns.length, 10)
})

