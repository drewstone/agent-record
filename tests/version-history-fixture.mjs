/** Retained native deliverables.git document used across the format and real HTTP view boundaries. */
const sha = (letter) => letter.repeat(40)
const commit = (id, lane, kind, parents, subject, extra = {}) => ({
  id: sha(id), parents: parents.map(sha), at: '2026-10-07T03:00:00Z', subject, lane, kind, files: [{ status: 'M', path: `pages/${id}.md` }],
  author: { id: `run:${lane}`, label: lane.replace('workers/', ''), name: lane }, director: null, model: null, spendUsd: null,
  trace: { node: `run:${lane}`, trace: `run/run:${lane}`, session: 'retained-session-1' }, body: '', ...extra,
})
// A run's repository as the Lab serves it: newest first, every child above its parents.
const doc = {
  kind: 'agent-workspace.version-graph', runId: 'run', available: true, refsDigest: `sha256:${'f'.repeat(64)}`,
  lanes: [
    { id: 'main', label: 'main', kind: 'store', head: sha('e'), director: null, commits: 3 },
    { id: 'workers/editor', label: 'editor', kind: 'worker', head: sha('d'), director: 'run:s1', commits: 2 },
    { id: 'workers/finance', label: 'finance', kind: 'worker', head: sha('b'), director: 'run:s0', commits: 1 },
  ],
  commits: [
    commit('e', 'main', 'integrate', ['c', 'd'], 'integrate editor: report.md'),
    commit('d', 'workers/editor', 'write', ['a'], 'editor: report.md'),
    commit('c', 'main', 'integrate', ['1', 'b'], 'integrate finance: model.md'),
    commit('b', 'workers/finance', 'profile', ['1'], 'root: spawn finance', { profileDigest: `sha256:${'9'.repeat(64)}`, spawned: 'run:s0' }),
    commit('a', 'workers/editor', 'write', ['1'], 'editor: draft.md'),
    commit('1', 'main', 'write', [], 'seed'),
  ],
  tags: [
    { name: 'rc1', commit: sha('c'), at: null, by: 'editor', message: 'rc1', attempts: 1, best: true, flags: [],
      score: { complete: true, scoredAt: null, set: null, vector: { exact: [4, 4], heldOut: [2, 3], blockers: 1, judge: 70 }, results: [] } },
    { name: 'rc2', commit: sha('e'), at: null, by: 'editor', message: 'rc2', attempts: 3, best: false,
      flags: [{ kind: 'regression', tag: 'rc2', from: 'rc1', checks: ['sampled'] }, { kind: 'suspected-judge-gaming', tag: 'rc2', from: 'rc1', checks: ['sampled'] }],
      score: { complete: false, scoredAt: null, set: null, vector: { exact: [4, 4], heldOut: [1, 3], blockers: null, judge: 81.25 }, results: [] } },
  ],
  best: 'rc1', flags: [],
}

export { doc, sha }
