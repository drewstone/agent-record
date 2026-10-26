// A play's Results lead with its answer: the run that won, its play check's verdict with the check's evidence lines,
// and links to its deliverable and receipt; then the result pages; charts after. The documents below are the host's
// shape for two real runs on drew-gtr-pro (2026-10-11) whose play check passed while Runtime recorded no-winner:
// albert-full-ldpc-symmetry-20261011b (a live check, cut by the Lab at 600 characters) and expr-calculator-20261011a.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { plainFinding, playDocumentSchema } from '../dist/index.js'

const ALBERT = 'albert-full-ldpc-symmetry-20261011b'
const LINES = [
  'PASS [bar] [[128,16,8]] at weight 8, degree 8 against the incumbent [[64,8,8]]: needs (d >= 10, k >= 8) or (d >= 8, k >= 12)',
  'PASS [distance] min_weight_logical is a nontrivial logical of weight 8',
  'PASS [distance] certified d = 8 exactly',
  'PASS [results] results.json agrees with the reruns',
  'SOLVED: [[128,16,8]] with d =…',
]
const spend = { paidUsd: null, subscriptionUsd: null, apiUsd: null, sandboxUsd: null, routerUsd: null, costBasisUsd: null, listUsd: null, sandboxHours: null,
  subscriptionKnown: false, paidKnown: false, listKnown: false, tokens: null, sources: [], gaps: [] }
const run = (id, extra = {}) => ({
  id, group: id, kind: 'run', play: 'albert-full-ldpc', location: { kind: 'dir', path: `/mnt/traces/discovery-runs/${id}` }, format: 'runtime',
  state: 'no-winner', reason: 'cancelled', startedAt: '2026-10-11T14:20:39.430Z', settledAt: '2026-10-11T15:53:05.409Z', durationMs: 5545979,
  nodes: 1, depth: 0, harnesses: [], models: [], keys: [], spend, record: { status: 'ready', digest: null, builtAt: null, reason: null, capture: null },
  inputDigest: null, predecessor: null, supersedes: null, versions: null, ...extra,
})
const winner = run(ALBERT, {
  state: 'winner', reason: 'its play check passed at 2026-10-11 15:40 UTC',
  playCheck: { at: '2026-10-11T15:40:10.754Z', source: 'play-checks.jsonl', lines: LINES, solved: null, settle: { kind: 'no-winner', reason: 'cancelled' } },
  deliverables: [{ id: 'handoff', path: 'release/rc2/pages/albert-full-ldpc/handoff.md', present: true,
    href: `/run/${ALBERT}?section=outputs&file=release%2Frc2%2Fpages%2Falbert-full-ldpc%2Fhandoff.md` }],
  receipt: { tag: 'rc2', status: 'chosen at the deadline', href: `/run/${ALBERT}/receipt/rc2/` },
})
const finding = {
  runId: ALBERT, play: 'albert-full-ldpc', program: 'albert', state: 'winner', startedAt: '2026-10-11T14:20:39.430Z', at: null, agentLabel: null,
  kind: 'result', pageKind: 'result', title: 'Handoff: albert-full-ldpc, a full [[128,16,8]] code at check weight 8 and qubit degree 8',
  text: 'One indecomposable self-dual CSS code (C_X = C_Z) with parameters [[128,16,8]]: 56 X checks and 56 Z checks, each of weight 8.',
  class: null, ledger: false, sha256: 'a'.repeat(64), reviews: [], artifacts: [],
}
const play = (runs, best, findings = []) => ({
  schema: 'agent-workspace.play.v1', id: 'albert-full-ldpc', title: 'albert-full-ldpc', program: 'albert', line: 'full-ldpc', playBasis: 'run-input.pursuitId',
  charter: null, frontier: null, input: null, runs, lineage: { nodes: [], edges: [] }, spend, assessments: [], gaps: [], best, findings,
})

test("the play document carries the winner's play check, deliverables and receipt, and an older document still reads", () => {
  const parsed = playDocumentSchema.parse(play([winner, run('albert-full-ldpc-lift-20261011a')], ALBERT, [finding]))
  assert.equal(parsed.runs[0].playCheck.lines.at(-1), 'SOLVED: [[128,16,8]] with d =…')
  assert.equal(parsed.runs[0].receipt.href, `/run/${ALBERT}/receipt/rc2/`)
  assert.equal(parsed.runs[1].playCheck, undefined)
})

test('a finding reads without front matter, key lines, headings, emphasis or code marks', () => {
  assert.equal(plainFinding('kind: evidence **Bottom line.** The structure decoder (`decoders/structure.py`) works'),
    'Bottom line. The structure decoder (decoders/structure.py) works')
  assert.equal(plainFinding('--- kind: claim evidence_artifacts: ["pages/a/verify.py"] --- # The generator rejects the file The pinned generator emits a *different* witness'),
    'The generator rejects the file The pinned generator emits a different witness')
  assert.equal(plainFinding('1. **Anatomy and calibration** (notes/anatomy)'), 'Anatomy and calibration (notes/anatomy)')
  assert.equal(plainFinding('The cohort reaches $900,000 in month 29.'), 'The cohort reaches $900,000 in month 29.')
  assert.equal(plainFinding('2 * 3 = 6 and x*y*z stays'), '2 * 3 = 6 and x*y*z stays')
  assert.equal(plainFinding(null), '')
})
