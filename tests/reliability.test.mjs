import assert from 'node:assert/strict'
import test from 'node:test'
import { liveCauses, percent } from '../src/workspace/reliability.ts'

const cause = (id, runsLost, lastSeen, lostAgentHours = 1, runsHit = 0) => ({ id, layer: 'infra', owner: 'o', title: id, runsLost, runsHit, lostAgentHours, lastSeen })
const doc = (causes) => ({ schema: 'discovery-lab.reliability.v1', at: '2026-10-06T02:39:49.508Z', window: { since: '', until: '', days: 7 }, definition: '', runs: {}, rate: 0.362, completed: 0.405, lostAgentHours: 1, causes, daily: [] })

test('live causes are the ones seen in the last 48 hours, most runs lost first', () => {
  const causes = [
    cause('workspace-materialization', 347, '2026-09-30T23:14:47.557Z'),
    cause('sandbox-create', 148, '2026-10-05T08:54:11.393Z', 232.8),
    cause('sandbox-unreachable', 26, '2026-10-06T02:24:00.320Z', 82.8),
    cause('workspace-evidence', 16, '2026-10-04T07:00:41.213Z', 65.3),
    cause('subscription-limit', 4, '2026-10-04T07:01:11.024Z', 26.5),
    cause('never-seen', 9, null),
    cause('nothing-lost', 0, '2026-10-06T00:00:00Z'),
  ]
  assert.deepEqual(liveCauses(doc(causes)).map((c) => c.id), ['sandbox-create', 'sandbox-unreachable', 'workspace-evidence'])
  assert.deepEqual(liveCauses(doc(causes), 3, 24).map((c) => c.id), ['sandbox-create', 'sandbox-unreachable'])
  // Equal runs lost: more agent-hours lost first.
  assert.deepEqual(liveCauses(doc([cause('a', 4, '2026-10-06T00:00:00Z', 1), cause('b', 4, '2026-10-06T00:00:00Z', 5)])).map((c) => c.id), ['b', 'a'])
  assert.deepEqual(liveCauses({ ...doc(causes), at: 'not a time' }), [])
})

test('an unknown rate reads unknown, never 0%', () => {
  assert.equal(percent(0.362), '36%')
  assert.equal(percent(0), '0%')
  assert.equal(percent(null), 'unknown')
})
