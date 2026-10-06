// A synthetic profile-graph document for a sample play: registered roots d -> e -> f/g -> h
// and the agents e and f wrote at runtime. Digests are hashes of labels, not of real profiles.
import { createHash } from 'node:crypto'

const PLAY = 'sample-study'
const digest = (seed) => `sha256:${createHash('sha256').update(seed).digest('hex')}`
const unknown = (reason) => ({ status: 'unknown', reason })
const noReadout = unknown('no readout for this run')

function node({ seed, name, kind, createdIn, author, parents = [], runs = [], instructions = [], model = 'claude-opus-5-5', label = null, play = PLAY }) {
  const d = digest(seed)
  return {
    digest: d,
    short: d.slice(7, 19),
    name,
    description: kind === 'root' ? 'A sample study with multiple directors' : `Specialist ${name}`,
    version: null,
    play,
    kind,
    model: { id: model, provider: 'anthropic', reasoningEffort: 'high' },
    harness: 'claude-code',
    tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write', ...(kind === 'root' || name.startsWith('director') ? ['agent_runtime_coordination_await_event', 'agent_runtime_coordination_spawn_worker'] : [])].sort(),
    systemPrompt: kind === 'root' ? null : `You are ${name}. Work from the mounted commission and retain every result in Knowledge.`,
    instructions,
    files: kind === 'root' ? [{ path: 'inputs/commission.md', bytes: 6211, sha256: digest(`${seed}:commission`) }] : [],
    skills: name.startsWith('director') || kind === 'root' ? [{ name: 'profile-authoring', bytes: 9120, sha256: digest('skill') }] : [],
    author,
    createdIn,
    createdAt: '2026-10-05T05:52:05.062Z',
    label,
    budget: kind === 'root' ? { maxTokens: 24_000_000, maxIterations: 6000, deadlineMs: 10_800_000 } : { maxTokens: 2_000_000, maxIterations: 600, deadlineMs: 8_000_000 },
    parents,
    runs,
  }
}

const operator = (runId) => ({ kind: 'operator', registration: `prereg/sample-study-20261005/${runId}.json` })
const run = (runId, outcome, state, reason, score = noReadout) => ({ runId, nodeIds: [runId], outcome, run: { state, reason }, score })
const edge = (parent, relation, basis, primary, source, note) => ({ digest: parent.digest, relation, basis, primary, evidence: [{ source, note }] })

const baseInstructions = [
  'Read inputs/commission.md, inputs/predecessor-research.md and inputs/sources.md before acting.',
  'Grant managers enough of the shared budget for descendants. This run has 24 million tokens and at most 6000 iterations.',
  'Retain every partial result in Knowledge under pages/sample/study-20261005/.',
]

export function sampleProfileGraph({ withReadout = true } = {}) {
  const d = node({
    seed: 'd', name: 'sample-pilot-20261003d-director', kind: 'root', play: 'sample-pilot', createdIn: 'sample-pilot-20261003d',
    author: operator('sample-pilot-20261003d'), instructions: baseInstructions.slice(0, 2),
  })
  const readout = {
    status: 'known', source: 'readout', path: 'readouts/sample-study-20261005e/readout.json', generatedAt: '2026-10-05T19:40:00Z',
    judges: [
      { category: 'technical', score: 1, max: 4, calibrated: false },
      { category: 'software', score: 1, max: 4, calibrated: true },
      { category: 'economics', score: 1, max: 4, calibrated: true },
      { category: 'graphics', score: 0, max: 4, calibrated: true },
    ],
    verdicts: [{ id: 'E28-blind-rederivation', verdict: 'not-measured' }],
  }
  // a, c and e are re-presses of one registration (identical except the name); b, d and f add the blind rule.
  const econ = (letter, parents, runState = 'no-winner') =>
    node({
      seed: `econ-${letter}`, name: `sample-study-20261005${letter}-director`, kind: 'root', createdIn: `sample-study-20261005${letter}`,
      author: operator(`sample-study-20261005${letter}`), parents, instructions: baseInstructions,
      runs: [run(`sample-study-20261005${letter}`, runState === 'unknown' ? null : runState, runState === 'unknown' ? null : runState, runState === 'unknown' ? null : 'operator cancellation')],
    })
  const a = econ('a', [edge(d, 'revision', 'inferred', true, 'prereg/sample-study-20261005/build.py', 'built from the d run input')], 'unknown')
  const b = econ('b', [edge(a, 'treatment', 'inferred', true, 'prereg/sample-study-20261005/sample-study-20261005b.json#/acceptance/experiment/arms', 'identical record plus one root instruction')], 'unknown')
  const c = econ('c', [edge(a, 'revision', 'inferred', true, 'prereg/sample-study-20261005/build.py', 're-press of a: identical except the name')])
  const dd = econ('d', [edge(c, 'treatment', 'inferred', true, 'prereg/sample-study-20261005/sample-study-20261005d.json#/acceptance/experiment/arms', 'identical record plus one root instruction')])
  const e = node({
    seed: 'e', name: 'sample-study-20261005e-director', kind: 'root', createdIn: 'sample-study-20261005e', author: operator('sample-study-20261005e'),
    parents: [edge(c, 'revision', 'inferred', true, 'prereg/sample-study-20261005/build.py', 're-press of c: identical except the name')],
    runs: [run('sample-study-20261005e', 'no-winner', 'no-winner', 'budget-exhausted', withReadout ? readout : noReadout)],
    instructions: baseInstructions,
  })
  const f = node({
    seed: 'f', name: 'sample-study-20261005f-director', kind: 'root', createdIn: 'sample-study-20261005f', author: operator('sample-study-20261005f'),
    parents: [
      edge(e, 'treatment', 'inferred', true, 'prereg/sample-study-20261005/sample-study-20261005f.json#/acceptance/experiment/arms', 'identical record plus one root instruction'),
      edge(d, 'revision', 'inferred', false, 'prereg/sample-study-20261005/build.py', 'built from the d run input'),
    ],
    runs: [run('sample-study-20261005f', 'no-winner', 'no-winner', 'budget-exhausted')],
    instructions: [...baseInstructions, 'Blind re-derivation: before any claim changes a recommendation, commission one independent re-derivation.'],
  })
  const g = node({
    seed: 'g', name: 'sample-study-20261005g-director', kind: 'root', createdIn: 'sample-study-20261005g', author: operator('sample-study-20261005g'),
    parents: [edge(e, 'revision', 'inferred', true, 'prereg/sample-study-20261005/next-pair/diff-from-e.json', 'next-pair/build.py built g from the committed e registration')],
    instructions: [baseInstructions[0], 'This run has 48 million tokens and at most 24000 iterations.', 'The deliverable is the one repository inputs/deliverable-contract.md describes.'],
  })
  const h = node({
    seed: 'h', name: 'sample-study-20261005h-director', kind: 'root', createdIn: 'sample-study-20261005h', author: operator('sample-study-20261005h'),
    parents: [
      edge(g, 'treatment', 'inferred', true, 'prereg/sample-study-20261005/sample-study-20261005h.json#/acceptance/experiment/arms', 'identical record plus mid-run critique'),
      edge(e, 'revision', 'inferred', false, 'prereg/sample-study-20261005/next-pair/build.py', 'built from the committed e registration'),
    ],
    instructions: [...g.instructions, 'Critique loop: each checkpoint event also carries the scores that a review panel outside this run gave.'],
  })
  const spawned = []
  const spawn = (root, runId, nodeId, name, parentNode, outcome = 'done', model = 'claude-sonnet-5-5') => {
    const child = node({
      seed: `${runId}:${nodeId}`, name, kind: 'spawned', createdIn: runId, label: name, model,
      author: { kind: 'node', runId, nodeId: nodeId.includes(':') ? `${runId}:${nodeId.replace(/:[^:]+$/, '')}` : runId, profileDigest: parentNode.digest },
      parents: [{ digest: parentNode.digest, relation: 'authored', basis: 'recorded', primary: true, evidence: [{ source: `${runId}/spawn-journal.jsonl`, note: `spawned by ${parentNode.name}` }] }],
      runs: [{ runId, nodeIds: [`${runId}:${nodeId}`], outcome, run: root.runs[0].run, score: root.runs[0].score }],
      instructions: [`Own the ${name} line and report evidence-linked results.`],
    })
    spawned.push(child)
    return child
  }
  const eRun = 'sample-study-20261005e'
  const em = spawn(e, eRun, 's0', 'director-model', e, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['model:sourcer', 'model:blind-referee', 'model:company-builder', 'model:blind-referee-b'].entries()) spawn(e, eRun, `s0:s${i}`, n, em)
  const eb = spawn(e, eRun, 's1', 'director-business', e, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['business scan-sourcer', 'business demand-sourcer', 'business skeptic (blind)'].entries()) spawn(e, eRun, `s1:s${i}`, n, eb)
  const ee = spawn(e, eRun, 's2', 'director-engineering', e, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['eng: supply data', 'eng: blind re-derivation retry', 'eng: blind re-derivation replacement'].entries()) spawn(e, eRun, `s2:s${i}`, n, ee, i === 1 ? 'failed' : 'done')
  spawn(e, eRun, 's3', 'e38 reader arm A (raw pages)', e)
  spawn(e, eRun, 's4', 'e38 reader arm B (curated brief)', e)
  const fRun = 'sample-study-20261005f'
  const fm = spawn(f, fRun, 's0', 'director-model', f, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['model:sources', 'model:simrepro', 'model:blind-plant', 'model:blind-company', 'model:blind-cost'].entries()) spawn(f, fRun, `s0:s${i}`, n, fm)
  const fe = spawn(f, fRun, 's1', 'director-engineering', f, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['investigator-a', 'investigator-b', 'blind-rederiver'].entries()) spawn(f, fRun, `s1:s${i}`, n, fe)
  const fb = spawn(f, fRun, 's2', 'director-business', f, 'done', 'claude-opus-5-5')
  for (const [i, n] of ['biz-widescan', 'biz-deep-attributes', 'biz-deep-market', 'biz-blind-rederiver', 'biz-blind-rederiver-2'].entries()) spawn(f, fRun, `s2:s${i}`, n, fb)
  for (const [i, n] of ['root-blind-attributes', 'root-blind-parity', 'root-review-model'].entries()) spawn(f, fRun, `s${i + 3}`, n, f)

  const textDiff = (from, to) => {
    const lines = []
    const max = Math.max(from.length, to.length)
    for (let i = 0; i < max; i++) {
      if (from[i] === to[i]) lines.push({ op: ' ', text: from[i] })
      else {
        if (from[i] !== undefined) lines.push({ op: '-', text: from[i] })
        if (to[i] !== undefined) lines.push({ op: '+', text: to[i] })
      }
    }
    return { field: 'instructions', kind: 'text', added: lines.filter((l) => l.op === '+').length, removed: lines.filter((l) => l.op === '-').length, lines }
  }
  const diff = (parent, child, relation, fields, scoreDelta = unknown('the parent or the child has no readout')) => [
    `${parent.digest}..${child.digest}`,
    { from: parent.digest, to: child.digest, relation, basis: 'inferred', identical: false, fields, scoreDelta },
  ]
  const diffs = Object.fromEntries([
    diff(c, e, 'revision', [{ field: 'name', kind: 'value', from: c.name, to: e.name }]),
    diff(d, a, 'revision', [
      { field: 'name', kind: 'value', from: d.name, to: a.name },
      textDiff(d.instructions, a.instructions),
      { field: 'tools', kind: 'set', added: [], removed: ['agent_runtime_coordination_research_history'], kept: 10 },
      { field: 'files', kind: 'files', added: [{ path: 'inputs/predecessor-research.md', bytes: 2410, sha256: digest('pr') }], removed: [{ path: 'inputs/predecessor-handoff.md', bytes: 5030, sha256: digest('ph') }], changed: [{ path: 'inputs/commission.md', from: digest('c1'), to: digest('c2'), added: 2, removed: 1, lines: [{ op: '@', text: 'line 4' }, { op: ' ', text: '# Sample commission' }, { op: '-', text: 'Program: sample.' }, { op: '+', text: 'Program: program:sample.' }, { op: '+', text: 'Predecessor: sample-pilot-20261003d.' }] }] },
    ]),
    diff(e, f, 'treatment', [{ field: 'name', kind: 'value', from: e.name, to: f.name }, textDiff(e.instructions, f.instructions)]),
    diff(e, g, 'revision', [
      { field: 'name', kind: 'value', from: e.name, to: g.name },
      textDiff(e.instructions, g.instructions),
      { field: 'budget', kind: 'value', from: '{"deadlineMs":10800000,"maxIterations":6000,"maxTokens":24000000}', to: '{"deadlineMs":43200000,"maxIterations":24000,"maxTokens":48000000}' },
    ]),
    diff(g, h, 'treatment', [{ field: 'name', kind: 'value', from: g.name, to: h.name }, textDiff(g.instructions, h.instructions)], unknown('neither run was pressed')),
  ])
  return { schema: 'discovery-lab.profile-graph', play: PLAY, builtAt: '2026-10-05T20:00:00Z', nodes: [d, a, b, c, dd, e, f, g, h, ...spawned], diffs }
}
