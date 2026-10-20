// The play report renders from the document the Lab host serves at /api/discovery/plays/<id>/report. The fixture is
// the magnetar-rust document served on 2026-10-19 (tangle-tools compose_play_report, 68,640 B), copied unchanged.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseResearchReport, playReportToResearchReport, ResearchReport } from '../dist/index.js'

const served = () => JSON.parse(readFileSync(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8'))
const render = (doc) => renderToStaticMarkup(createElement(ResearchReport, { report: playReportToResearchReport(doc) }))
// The page's words for the host's: a gate-held release reads "not published" and a miss "no pass yet" (v2 status words).
const worded = (text) => text.replaceAll('withheld by the gate', 'not published').replace(/\bnot solved\b/gi, 'no pass yet')
const html = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
// The rendered markup between an element's opening tag (found by an attribute) and the next element of that kind.
const block = (page, attribute, tag = 'li') => {
  const start = page.indexOf(attribute)
  assert.ok(start >= 0, `missing ${attribute}`)
  const end = page.indexOf(`<${tag} `, start + attribute.length)
  return page.slice(start, end < 0 ? undefined : end)
}

test('the served sample adapts to a valid agent-research-report.v1 with one play', () => {
  const report = playReportToResearchReport(served())
  assert.deepEqual(parseResearchReport(report), report)
  assert.equal(report.plays.length, 1)
  assert.equal(report.plays[0].questionCoverage.length, 10)
  assert.equal(report.plays[0].rules.length, 5)
  assert.equal(report.plays[0].rules.reduce((sum, rule) => sum + rule.instances.length, 0), 8)
  assert.equal(report.plays[0].unknowns.length, 10)
})

test('the verdict leads, then every question with its answer or unknown, its source and as-of time', () => {
  const doc = served()
  const page = render(doc)
  const verdict = page.indexOf('id="verdict"')
  assert.ok(verdict >= 0 && verdict < page.indexOf('id="questions"'))
  assert.ok(block(page, 'id="verdict"', 'section').includes(html(worded(doc.verdict.sentence))))
  assert.ok(block(page, 'id="verdict"', 'section').includes(html(doc.verdict.source)))
  assert.match(page, /<details class="rr-questions" id="questions" open="">/)
  for (const question of doc.questions) {
    const at = page.indexOf(`<dt>${html(question.question)}</dt>`)
    assert.ok(at >= 0, `missing question ${question.id}`)
    const row = page.slice(at, page.indexOf('</div>', at))
    if (question.answer) {
      assert.ok(row.includes(html(worded(question.answer))), `missing answer to ${question.id}`)
      assert.ok(row.includes(html(question.source)), `missing source of ${question.id}`)
      assert.ok(row.includes('as of '), `missing as-of time of ${question.id}`)
    } else {
      assert.ok(row.includes('>Unknown<'), `${question.id} must read unknown`)
      assert.ok(row.includes(html(question.why)) && row.includes(html(question.record)), `${question.id} must say why and what would answer it`)
    }
  }
})

test('every rule shows its state and every anomaly its sentence and source, under the rule that fired', () => {
  const doc = served()
  const page = render(doc)
  assert.ok(page.includes('8 anomalies from 5 of 5 rules.'))
  for (const rule of doc.rules) {
    const start = page.indexOf(`data-rule="${rule.id}"`)
    const next = page.indexOf('data-rule="', start + 1)
    const section = page.slice(start, next < 0 ? page.indexOf('id="unknowns"') : next)
    assert.ok(section.includes(`data-rule-state="${rule.state}"`), `${rule.id} state`)
    assert.ok(section.includes(html(rule.question)))
    for (const anomaly of doc.anomalies.filter((item) => item.rule === rule.id)) {
      assert.ok(section.includes(html(anomaly.sentence)), `missing anomaly: ${anomaly.sentence}`)
      assert.ok(section.includes(html(anomaly.source)), `missing source: ${anomaly.source}`)
    }
  }
})

test('unknowns read unknown with the record that would answer them, never 0', () => {
  const doc = served()
  const page = render(doc)
  for (const item of doc.unknowns) {
    const row = block(page, `data-unknown-field="${item.field}"`)
    assert.ok(row.includes('>unknown<'), `${item.field} must read unknown`)
    assert.ok(row.includes(html(item.why)) && row.includes(html(item.record)))
  }
  // The null facts the unknowns name read Unknown in their sections too, with why and the answering record.
  for (const id of ['hardware.cpuModel', 'hardware.logicalCpus', 'hardware.checkCpuSet', 'hardware.concurrentLoad', 'hardware.platforms', 'limit.bound']) {
    const fact = block(page, `data-fact="${id}"`, 'div')
    assert.match(fact, /<dd class="rr-unknown">Unknown<\/dd>/, id)
    assert.doesNotMatch(fact, /<dd[^>]*>0/, id)
    assert.match(fact, /Would be answered by: /, id)
  }
  // Runs that recorded no attempts read unknown agent-hours, not 0 h.
  for (const runId of ['magnetar-rust-20261018a', 'magnetar-rust-20261019e']) {
    const run = block(page, `data-run="${runId}"`)
    assert.match(run, /<dd class="rr-unknown">Unknown<\/dd>/)
    assert.match(run, /Would be answered by: scorecard.json attempts.hours/)
  }
})

test('a fact nulled by hand reads unknown, never 0', () => {
  const doc = served()
  doc.built.guests = { value: null, unit: 'guests', source: null, asOf: null }
  doc.built.externalCrates.value = null
  const page = render(doc)
  for (const id of ['built.guests', 'built.external-crates']) {
    const fact = block(page, `data-fact="${id}"`, 'div')
    assert.match(fact, /<dd class="rr-unknown">Unknown<\/dd>/, id)
    assert.match(fact, /Why: not recorded/, id)
  }
})

test('the report shows how good against the bar with comparability, what was built, pipelines and the limit slot', () => {
  const page = render(served())
  const order = ['id="verdict"', 'id="questions"', 'id="how-good"', 'id="built"', 'id="hardware"', 'id="limit"', 'id="pipelines"', 'id="runs"', 'id="anomalies"', 'id="unknowns"'].map((id) => {
    const at = page.indexOf(id)
    assert.ok(at >= 0, `missing ${id}`)
    return at
  })
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  const rate = block(page, 'data-fact="how-good.bar.rate_cps"', 'div')
  assert.match(rate, /202,021 cycles\/s/)
  assert.match(rate, /data-comparable="false">not comparable</)
  assert.match(rate, /1-bit declared/)
  assert.match(page, /data-table="releases"/)
  assert.match(block(page, 'data-fact="built.crates"', 'div'), /<dd>10<\/dd>[\s\S]*marith, mfield/)
  assert.match(block(page, 'data-fact="built.guests"', 'div'), /<dd>15 guests<\/dd>/)
  assert.match(block(page, 'id="limit"', 'section'), /Empty: no role or limits benchmark has filled this slot yet/)
  assert.match(block(page, 'data-fact="pipelines.coverage"', 'div'), /3 of 107 published/)
  // A gate-held release reads "not published" (v2 status words), in the host's sentence and in each release row.
  assert.doesNotMatch(page.replace(/<[^>]*>/g, ' '), /withheld/i)
  assert.match(page, /4 of 15 workloads, not published\./)
  assert.match(block(page, 'data-table="releases"', 'table'), /not published/)
})

test('the report links back to the play page and to each run page', () => {
  const doc = served()
  const page = render(doc)
  assert.ok(page.includes('href="/play/magnetar-rust">Play page</a>'))
  for (const run of doc.runs) assert.ok(page.includes(`href="${run.href}">${run.run}</a>`), `missing link to ${run.runId}`)
})

test('a document of another schema is refused, not rendered empty', () => {
  assert.throws(() => playReportToResearchReport({ ...served(), schema: 'agent-workspace.play.v1' }), /Expected agent-workspace.play-report.v1/)
})
