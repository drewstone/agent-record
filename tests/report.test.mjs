import assert from 'node:assert/strict'
import test from 'node:test'
import { publicationIds, readPublication } from '../examples/react/publications.ts'
import { fromResearchPublication } from '../dist/research-publication.js'
import { parseResearchReport } from '../dist/report.js'

// Full immutable publications must survive the report's historical wire boundary.
const raw = () => ({ schema: 'agent-research-report.v1', id: 'retained-boundary', title: 'Retained publication boundary', generatedAt: '2026-10-02T12:00:00Z', summary: 'Round-trip existing records without rewriting their sources.', plays: [{ id: 'play', title: 'Retained publication', summary: 'Existing event/source bytes', claims: [] }] })

test('all published events and source references survive attached report validation', async () => {
  let count = 0
  for (const id of publicationIds) {
    const record = fromResearchPublication(JSON.parse(await readPublication(id)))
    const data = raw()
    data.plays[0].record = record
    const parsed = parseResearchReport(data)
    assert.deepEqual(parsed.plays[0].record.events, record.events)
    assert.deepEqual(parsed.plays[0].record.sources, record.sources)
    count += record.events.length
  }
  assert.equal(count, 1054)
})
