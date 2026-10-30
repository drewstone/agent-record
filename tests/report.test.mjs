import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { playReportToResearchReport } from '../dist/index.js'
import { publicationIds, readPublication } from '../examples/react/publications.ts'
import { fromResearchPublication } from '../dist/research-publication.js'
import { parseResearchReport } from '../dist/report.js'

// Full immutable publications must survive the real served report's historical wire boundary.
test('all published events and source references survive attached report validation', async () => {
  const served = JSON.parse(await readFile(new URL('./fixtures/play-report-magnetar-rust.json', import.meta.url), 'utf8'))
  let count = 0
  for (const id of publicationIds) {
    const record = fromResearchPublication(JSON.parse(await readPublication(id)))
    const data = playReportToResearchReport(served)
    data.plays[0].record = record
    const parsed = parseResearchReport(data)
    assert.deepEqual(parsed.plays[0].record.events, record.events)
    assert.deepEqual(parsed.plays[0].record.sources, record.sources)
    count += record.events.length
  }
  assert.equal(count, 1054)
})
