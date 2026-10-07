import assert from 'node:assert/strict'
import test from 'node:test'
import { profileGraphDocumentSchema, versionGraphDocumentSchema } from '../dist/workspace.js'
import { classCounts, costText, expectationsText, replayText, severityText, weakText } from '../src/workspace/role-scorecards.ts'
import { proposedVersions, runOfProfile } from '../src/workspace/profile-graph.ts'
import { sampleProfileGraph } from './fixtures/profile-graph.mjs'

const role = {
  role: 'report-editor', digests: ['sha256:' + 'e'.repeat(64)], harness: 'claude-code', model: 'claude-opus-5-5', nodes: 8,
  milestones: { count: 8, done: 6, medianMs: 3_840_000, items: [{ nodeId: 'run:s3', label: 'editor-M1', status: 'done', ms: 3_540_000 }] },
  expectations: { status: 'unscored', owned: 20, met: 0, partial: 0, missing: 0, unscored: 20, reason: 'no scoring page yet' },
  blockers: { total: 23, bySeverity: { blocker: 3, major: 12, minor: 8 },
    byClass: { 'stale-render': { count: 6, weight: 9.5, ids: ['C3-3', 'C6-6'] }, other: { count: 1, weight: 0.25, ids: ['C5-10'] }, 'overstated-decision': { count: 5, weight: 3, ids: ['C4-1'] } },
    items: [{ id: 'C6-6', severity: 'major', class: 'stale-render', owners: ['report-editor'], basis: 'referee', writers: ['report-editor'], pages: [], raisedAt: '2026-10-07T07:00:31.000Z', source: 'pages/x/review/critique-0705.md', summary: 'rc5 rendered from finance M8', resolves: 'rc6 from M9' }] },
  regressions: [{ tag: 'rc2', from: 'rc1', checks: ['sampled-citations-documented'], share: 0.612 }],
  rework: { cycles: 1, items: [{ id: 'C3-3', cycles: 1 }] },
  cost: { usd: 406.86, measuredNodes: 6, unmeasuredNodes: ['run:s38', 'run:s3'], acceptedPages: 12, acceptedAt: 'rc4', perAcceptedPage: { usd: 33.9047, outputTokens: 102_000, complete: false } },
  burden: { total: 17.025, blockers: 12.025, regressions: 1.836, expectations: 0, rework: 0.5 },
}
const runCard = { available: true, runId: 'run', builtAt: '2026-10-07T09:00:00Z', best: { tag: 'rc4' }, classes: { 'stale-render': 7 },
  regressions: [{ tag: 'rc3', from: 'rc2', checks: ['model-reproduces'], infrastructure: true, shares: {} }],
  edits: [{ operationId: 'role-improve:run:report-editor:576e139b6ee8', role: 'report-editor', digest: '576e139b6ee8', markers: ['stale-render'], deliveredAt: '2026-10-07T10:00:00Z', effect: 'delivered', adopted: { nodeId: 'run:s41', label: 'editor-M8', at: '2026-10-07T11:00:00Z' },
    measured: { label: 'weak', before: { critiques: 6, blockers: 7, perCritique: 1.167 }, after: { critiques: 0, blockers: 0, perCritique: null }, note: 'one run, no control' } }],
  roles: [role] }

test('a profile graph with role scorecards, a role version and its edit evidence satisfies the served schema', () => {
  const doc = sampleProfileGraph()
  const base = doc.nodes[0]
  const version = { ...base, digest: 'sha256:' + '7'.repeat(64), short: '777777777777', kind: 'proposal', runs: [],
    author: { kind: 'proposer', name: 'role-improve', source: '/runs/run.roles/report-editor.777777777777.json' },
    parents: [{ digest: base.digest, relation: 'revision', basis: 'recorded', primary: true, evidence: [{ source: 'run/pages/x/review/critique-0705.md', note: 'stale-render: C6-6 (major)' }] }],
    edit: { role: 'report-editor', target: 'run-e', rules: [{ id: 'stale-render', label: 'stale render from an old model', text: '[rule:stale-render] Render only from the frozen model.', check: 'hash matches', weight: 9.5,
      evidence: [{ source: 'run/pages/x/review/critique-0705.md', blocker: 'C6-6', severity: 'major', note: 'rc5 rendered from finance M8' }] }],
      budget: { before: 600, after: 1400, limit: 6000, added: 800, addedLimit: 2400 }, evidenceLabel: 'untested', replay: null, source: 'x.json' },
    scorecards: [] }
  const readout = { ...base, digest: 'sha256:' + '8'.repeat(64), short: '888888888888', kind: 'proposal', author: { kind: 'readout', runId: 'run', readout: null, source: 'prereg/p/proposals/run.json' } }
  const withScores = { ...base, scorecards: [{ runId: 'run', role: 'report-editor', burden: role.burden, blockers: { total: 23, bySeverity: role.blockers.bySeverity, byClass: { 'stale-render': 6 } },
    regressions: 1, rework: 1, expectations: role.expectations, milestones: { count: 8, done: 6, medianMs: 3_840_000 }, cost: { acceptedPages: 12, perAcceptedPage: role.cost.perAcceptedPage, unmeasuredNodes: 2 } }] }
  const parsed = profileGraphDocumentSchema.parse({ ...doc, nodes: [withScores, ...doc.nodes.slice(1), version, readout], scorecards: { run: runCard } })
  assert.equal(parsed.nodes.at(-2).edit.rules[0].evidence[0].blocker, 'C6-6')
  assert.equal(parsed.nodes[0].scorecards[0].role, 'report-editor')
  assert.equal(parsed.scorecards.run.roles[0].blockers.items[0].class, 'stale-render')
  // A proposed version is reached from its parent and shown under its nearest ancestor's run.
  assert.deepEqual(proposedVersions(parsed, parsed.nodes[0]).map((node) => node.short), ['777777777777'])
  assert.equal(runOfProfile(parsed, parsed.nodes.at(-2)), base.createdIn)
})

test('the run versions document carries the run\'s role scorecard', () => {
  const doc = { kind: 'agent-workspace.version-graph', runId: 'run', available: true, roles: runCard, lanes: [], commits: [], tags: [], flags: [] }
  assert.equal(versionGraphDocumentSchema.parse(doc).roles.edits[0].adopted.label, 'editor-M8')
  assert.equal(versionGraphDocumentSchema.parse({ ...doc, roles: { available: false, reason: 'no deliverables.git' } }).roles.available, false)
})

test('scorecard text: heaviest classes first with other last, unmeasured cost said, unscored expectations said, replay decided or weak', () => {
  assert.deepEqual(classCounts(role.blockers.byClass), [['stale-render', 6], ['overstated-decision', 5], ['other', 1]])
  assert.equal(severityText(role.blockers.bySeverity), '3/12/8')
  assert.equal(costText(role.cost), '≥ $33.90/page over 12 (2 unmeasured)')
  assert.equal(costText({ ...role.cost, perAcceptedPage: null }), 'unknown over 12 accepted (2 unmeasured)')
  assert.equal(expectationsText(role.expectations), '20 owned, unscored')
  assert.equal(expectationsText({ status: 'scored', owned: 5, met: 2, partial: 2, missing: 1 }), '2 met · 2 partial · 1 missing of 5')
  assert.match(replayText(null), /weak evidence/u)
  assert.equal(replayText({ decision: 'ship', lift: 0.21, liftInterval: { low: 0.05, high: 0.37 }, checksFell: [], library: 'eligible', tieBreak: null }), 'ship lift +0.210 [0.050, 0.370] · joins the template library')
  assert.match(replayText({ decision: 'hold', lift: 0.02, liftInterval: { low: -0.1, high: 0.14 }, tieBreak: 'spans zero' }), /tie: Drew grades/u)
  assert.equal(weakText(runCard.edits[0].measured), 'before 7 in 6 critiques, after no critique yet')
})
