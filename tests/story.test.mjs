// The story a viewer prints, on two real published records: the UCS leaf of research-math-20261003system4 (one
// agent-runtime agent, 138 steps over 3 h 5 min, metered cost) and wf_3b2a5d92-078 (five Claude Code sessions read by
// the Claude adapter under a workflow journal, with failed calls). Every header value, episode and turning point comes
// from these functions, so a regression here is what a reader of the record would see.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { parseRecord } from '../dist/record.js'
import { recordStory } from '../dist/story.js'

const fixture = (name) => parseRecord(JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8')))
const ucs = recordStory(fixture('research-math-20261003system4'))
const workflow = recordStory(fixture('wf_3b2a5d92-078'))
const empty = recordStory(parseRecord({ schema: 'agent-record.v1', runId: 'empty', title: 'Empty', nodes: [], events: [] }))

const shown = (story) => [
  story.summary.title, story.summary.asked, ...story.summary.result, story.summary.claim?.text, story.summary.claim?.by, ...story.summary.leavesOut,
  ...story.summary.agents.map((agent) => agent.status),
  ...story.episodes.flatMap((episode) => [episode.title, episode.quote]),
  ...story.turningPoints.flatMap((point) => [point.title, point.excerpt]),
  ...story.steps.map((step) => step.action),
].filter(Boolean).join('\n')

test('the UCS header carries its metered cost once, its tokens and its recorded outcome', () => {
  const { summary } = ucs
  // Two metered executions ($10.88 and $15.01) and a settlement meter that repeats their sum: $25.89, not $51.78.
  assert.equal(Math.round(summary.cost.usd * 100), 2589)
  assert.deepEqual({ billed: summary.cost.billed, of: summary.cost.of, agents: summary.cost.agents }, { billed: false, of: 1, agents: 1 })
  assert.equal(summary.outputTokens, 134562 + 16845)
  assert.deepEqual([summary.steps, summary.errors, summary.noResult], [138, 0, 10])
  assert.deepEqual(summary.models, ['Claude Opus 5.5 on Claude Code'])
  assert.deepEqual(summary.result, ['The run ended at 19:35 UTC with an accepted result.'])
  assert.ok(summary.leavesOut.some((line) => line.endsWith('this record shows only UCS leaf.')))
})

test('UCS episodes hold every step once and name the long computations and the uncaptured tail', () => {
  assert.equal(ucs.episodes.reduce((sum, episode) => sum + episode.steps.length, 0), 138)
  assert.ok(ucs.episodes.some((episode) => /^Ran \d+ computations, about 10 min each$/.test(episode.title)))
  const gap = ucs.episodes.filter((episode) => episode.notCaptured)
  assert.deepEqual(gap.map((episode) => episode.title), ['No steps captured for 25 min'])
  assert.equal(gap[0].quote, undefined, "a computed sentence is not quoted as anyone's words")
  assert.deepEqual(ucs.turningPoints.map((point) => point.title), ['The run started', 'The run ended with an accepted result'])
})

test('the Claude Code workflow record groups its spawns, keeps failed calls off the turning points and shows their error text', () => {
  const { summary, turningPoints } = workflow
  assert.equal(summary.agents.length, 6)
  assert.equal(summary.steps, 72)
  assert.equal(summary.errors, 3)
  assert.deepEqual(summary.models, ['Claude Fable 5 on Claude Code'])
  assert.deepEqual(turningPoints.map((point) => point.title), ['The run started', 'Operator workflow started 5 agents'])
  const failed = workflow.steps.filter((step) => step.outcome === 'error')
  assert.equal(failed.length, 3)
  assert.ok(failed.every((step) => step.output))
  assert.ok(failed.some((step) => step.output.includes('Command timed out after 2m 0s')))
  // Each verifier's episode is titled by the prompt it was given; none by a list of kinds of work.
  assert.ok(workflow.episodes.every((episode) => !/, then /.test(episode.title)))
  assert.ok(workflow.episodes.some((episode) => episode.title === 'Literature audit.'))
  // No terminal state and no end for the workflow: the record says so instead of claiming the run is still running.
  assert.deepEqual(summary.result, ['The record has no end for the run; its last event is at 04:19 UTC.'])
  assert.equal(summary.cost, undefined)
  assert.ok(summary.leavesOut.includes('The record keeps no cost.'))
  const step = workflow.steps.find((item) => item.outcome === 'error' && item.output)
  assert.ok(step.durationMs > 0 && step.action && step.output)
})

test('an empty record has no times, counts of zero and no value that is not a number', () => {
  const { summary } = empty
  assert.equal(summary.start, undefined)
  assert.equal(summary.durationMs, undefined)
  assert.deepEqual([summary.steps, summary.agents.length, empty.episodes.length, empty.turningPoints.length], [0, 0, 0, 0])
  const numbers = []
  const walk = (value) => (typeof value === 'number' ? numbers.push(value) : value && typeof value === 'object' ? Object.values(value).forEach(walk) : undefined)
  walk(empty)
  assert.ok(numbers.every(Number.isFinite))
})

test('nothing a reader sees uses placeholders, raw stamps or cut text', () => {
  for (const story of [ucs, workflow]) {
    const text = shown(story)
    for (const banned of [/\bUnknown\b/, /\bundefined\b/, /\bNaN\b/, /\bstill running\b/, /\d{4}-\d{2}-\d{2}T\d{2}:/, /…$/m, /:$/m]) assert.doesNotMatch(text, banned)
  }
})

// A run's terminal kinds and reasons (`winner`, `cancelled`) are record-format words (docs/record-format.md), which the
// story phrases; tool names and text conventions stay out.
test('the story model names no producer, tool or text convention', () => {
  const source = readFileSync(new URL('../src/story.ts', import.meta.url), 'utf8')
  for (const word of ['knowledge_', 'spawn_worker', 'steer_agent', 'observe_agent', 'read_journal', 'submit_result', 'report_blocked', 'kb_', '---FILE', 'FINAL', "'met'", 'verdict.valid', 'Wake input'])
    assert.ok(!source.includes(word), word)
})
