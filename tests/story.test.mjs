// The story a viewer prints, on a real published record (the UCS leaf of research-math-20261003system4, 138 steps over
// 3 h 5 min): every header value, episode and turning point comes from these functions, so a regression here is what a
// reader of the blog would see.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { parseRecord } from '../dist/record.js'
import { recordEpisodes, recordTurningPoints, summarizeRecord } from '../dist/story.js'

const record = parseRecord(JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/research-math-20261003system4.json.gz', import.meta.url))).toString('utf8')))
const summary = summarizeRecord(record)
const episodes = recordEpisodes(record)
const points = recordTurningPoints(record)
const shown = [
  summary.title, summary.asked, ...summary.result, summary.claim?.text, summary.claim?.by, ...summary.leavesOut,
  ...episodes.flatMap((episode) => [episode.title, episode.quote]),
  ...points.flatMap((point) => [point.title, point.excerpt]),
].filter(Boolean).join('\n')

test('the header states the result, the claim and the final running cost', () => {
  assert.deepEqual(summary.result, ['Result accepted on attempt 2; finished 19:35 UTC.'])
  // The last metered event's running total (attempt 1 at $10.88 plus attempt 2), not the first attempt's spend.
  assert.equal(Math.round(summary.costUsd * 100), 2589)
  assert.equal(summary.steps, 138)
  assert.equal(summary.errors, 0)
  assert.deepEqual(summary.models, ['Claude Opus 5.5 on Claude Code'])
  assert.match(summary.claim.text, /^The k=4 witness re-verified independently; with it, Pálvölgyi–Tardos Conjecture 10 is false/)
  assert.equal(summary.claim.by, "UCS leaf's last published page, 18:50 UTC")
  assert.ok(summary.claim.stepId && summary.claim.episode)
})

test('episodes group the run into about a dozen aims, with the uncaptured attempt as its own row', () => {
  assert.ok(episodes.length >= 8 && episodes.length <= 16, `${episodes.length} episodes`)
  assert.ok(episodes.some((episode) => /^Ran \d+ long computations, about 10 min each$/.test(episode.title)))
  const gap = episodes.find((episode) => episode.notCaptured)
  assert.equal(gap?.title, 'Attempt 2, steps not captured')
  assert.equal(gap?.quote, undefined, 'a computed sentence is not quoted as anyone\'s words')
  assert.match(gap?.items[0]?.text ?? '', /kept none of its steps\. It met its finish condition\.$/)
  assert.ok(summary.leavesOut.some((line) => line.endsWith('this record shows only UCS leaf.')))
  assert.equal(episodes.reduce((sum, episode) => sum + episode.steps.length, 0), 138)
})

test('turning points are few, numbered and in plain words', () => {
  assert.ok(points.length >= 3 && points.length <= 10)
  assert.deepEqual(points.map((point) => point.n), points.map((_, i) => i + 1))
  assert.ok(points.some((point) => point.title === 'Recorded the page FINAL.md'))
  assert.ok(points.some((point) => point.title === 'Attempt 1 ended before finishing; the agent was asked again'))
})

test('nothing a reader sees uses internal words, dashes for missing values or cut text', () => {
  for (const banned of [/\bcontract\b/i, /\bUnknown\b/, / — /, /\bReturned\b/, /\bs3\b/, /…|\.\.\.$/m, /\d{4}-\d{2}-\d{2}T\d{2}:/]) assert.doesNotMatch(shown, banned)
})
