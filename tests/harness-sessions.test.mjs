import assert from 'node:assert/strict'
import test from 'node:test'
import { readSessionInput } from '@tangle-network/harness-sessions'
import { fromHarnessSessions } from '../dist/harness-sessions.js'
import { parseRecord } from '../dist/record.js'

const row = (value) => JSON.stringify(value)
const session = (id, text) => readSessionInput('pi', { text: [
  row({ type: 'session', id, timestamp: '2026-10-07T20:00:00Z', cwd: '/work' }),
  row({ type: 'message', id: `u-${id}`, timestamp: '2026-10-07T20:00:01Z', message: { role: 'user', content: [{ type: 'text', text }] } }),
  row({ type: 'message', id: `a-${id}`, timestamp: '2026-10-07T20:00:02Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Checked.' }] } }),
].join('\n') + '\n' }, { label: `${id}.jsonl` })

test('shared reader sessions project into one record; only recorded IDs join them', () => {
  const parent = session('parent', 'Check the claim')
  const child = session('child', 'Review the claim')
  const plain = fromHarnessSessions([parent, child], { recordId: 'bundle-1', title: 'Review bundle' })
  assert.equal(plain.nodes.length, 2)
  assert.ok(plain.nodes.every((node) => node.parent === null))
  assert.ok(plain.events.some((event) => event.detail.publicText === 'Review the claim'))
  const linked = fromHarnessSessions([parent, child], {
    recordId: 'bundle-1', title: 'Review bundle',
    relationships: [{ harness: 'pi', relationship: { sessionId: 'child', parentSessionId: 'parent' } }],
    claims: [{ pageSha256: 'a'.repeat(64), claimId: 'C1', statement: 'The ratio is ten' }],
    verdicts: [{ id: 'V1', subject: { pageSha256: 'a'.repeat(64), claimId: 'C1' }, reviewerSessionNodeId: 'session:pi:child', judgment: 'CORRECT' }],
    publications: [{ id: 'P1', kind: 'article', title: 'Result', cites: [{ pageSha256: 'a'.repeat(64), claimId: 'C1', verdictId: 'V1' }] }],
  })
  assert.equal(linked.nodes.find((node) => node.id === 'session:pi:child').parent, 'session:pi:parent')
  assert.equal(linked.verdicts[0].subject.claimId, 'C1')
  assert.equal(linked.publications[0].cites[0].verdictId, 'V1')
  assert.equal(linked.idScheme, 'shared-session.v1')
  assert.throws(() => parseRecord({ ...linked, verdicts: [{ ...linked.verdicts[0], reviewerSessionNodeId: 'missing' }] }), /Verdict reviewer must be a session/)
})

test('legacy anchored records retain their bytes and optional relations stay absent', () => {
  const value = parseRecord({ schema: 'agent-record.v1', runId: 'run', title: 'Run', nodes: [], events: [] })
  assert.equal(value.claims, undefined)
  assert.equal(value.publications, undefined)
})
