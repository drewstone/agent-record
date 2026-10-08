import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRecord } from '../src/record.ts'
import { recordWorkGraphModel } from '../src/workspace/work-graph-model.ts'

const pageA = 'a'.repeat(64)
const pageB = 'b'.repeat(64)
const profileA = `sha256:${'c'.repeat(64)}`
const profileB = `sha256:${'d'.repeat(64)}`

test('bundle graph joins precise evidence by recorded identifiers only', () => {
  const record = parseRecord({
    schema: 'agent-record.v1', runId: 'run-1', title: 'Research and review',
    nodes: [
      { id: 'run-1', kind: 'agent', label: 'researcher' },
      { id: 'reviewer', kind: 'session', label: 'judge', nativeSessionId: 'native-7' },
      { id: 'child', kind: 'session', label: 'child', parent: 'reviewer' },
    ],
    events: [],
    artifacts: [
      { id: 'page-a', kind: 'knowledge-page', title: 'Page A', digest: pageA },
      { id: 'page-b', kind: 'knowledge-page', title: 'Page B', digest: pageB },
    ],
    claims: [
      { pageSha256: pageA, claimId: 'C1', statement: 'Same words', runId: 'run-1' },
      { pageSha256: pageB, claimId: 'C1', statement: 'Same words' },
    ],
    verdicts: [{ id: 'v1', subject: { pageSha256: pageA, claimId: 'C1' }, reviewerSessionNodeId: 'reviewer', judgment: 'NEW' }],
    publications: [{ id: 'site', kind: 'site', title: 'Result', cites: [{ pageSha256: pageA, claimId: 'C1', verdictId: 'v1' }] }],
    profileVersions: [
      { digest: profileA, parents: [], runId: 'run-1' },
      { digest: profileB, parents: [profileA], authorNodeId: 'reviewer' },
    ],
  })
  const graph = recordWorkGraphModel(record)
  const edges = new Set(graph.edges.map(({ from, to, kind }) => `${from}>${to}:${kind}`))
  assert.equal(graph.nodes.length, 12)
  assert.match(graph.summary, /2 record memberships/)
  assert.ok(edges.has('run:run-1>node:reviewer:contains'))
  assert.ok(!edges.has('run:run-1>node:child:contains'))
  assert.ok(edges.has('node:reviewer>node:child:parent'))
  assert.ok(edges.has(`artifact:page-a>claim:${pageA}#C1:states`))
  assert.ok(edges.has(`node:reviewer>verdict:v1:reviewed`))
  assert.ok(edges.has(`verdict:v1>claim:${pageA}#C1:verdict`))
  assert.ok(edges.has(`claim:${pageA}#C1>publication:site:cites`))
  assert.ok(edges.has('verdict:v1>publication:site:cites'))
  assert.ok(edges.has(`profile:${profileA}>profile:${profileB}:parent`))
  assert.ok(!edges.has(`verdict:v1>claim:${pageB}#C1:verdict`))
  assert.ok(!edges.has(`artifact:page-b>claim:${pageA}#C1:states`))
})

test('a play record draws each fork between the runs its fork receipts join, and no fork whose run it lacks', () => {
  const run = (id) => ({ id, label: id, parent: null, kind: 'agent' })
  const record = {
    schema: 'agent-record.v1', runId: 'play:p', title: 'p', events: [], sources: [],
    nodes: [run('p-d'), run('p-e'), run('p-codex1')],
    runs: [{ nodeId: 'p-d', runId: 'p-d', recordDigest: 'abc', href: '/run/p-d' }],
    forks: [{ from: 'p-d', to: 'p-e', basis: 'fork.json' }, { from: 'p-e', to: 'p-codex1', basis: 'fork.json' }, { from: 'p-gone', to: 'p-d', basis: 'fork.json' }],
  }
  const graph = recordWorkGraphModel(record)
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === 'fork').map((edge) => [edge.from, edge.to]), [['node:p-d', 'node:p-e'], ['node:p-e', 'node:p-codex1']])
})
