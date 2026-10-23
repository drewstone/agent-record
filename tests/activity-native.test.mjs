import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { parseRecord } from '../dist/record.js'
import { activityToRecord } from '../tools/activity/sessions.mjs'

// This is a retained native call + its observed output/usage, not an invented
// tool result. Provenance records source digest, selection and anonymization.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
test('native activity CLI replays a retained Codex call through discovery, deduplication and Timeline projection', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-record-native-'))
  try {
    const sessions = join(home, '.codex', 'sessions')
    mkdirSync(sessions, { recursive: true })
    copyFileSync(join(root, 'tests/fixtures/native-activity/codex.jsonl'), join(sessions, 'retained.jsonl'))
    const account = join(home, '.config', 'agent-accounts', 'codex', 'fixture-seat')
    mkdirSync(account, { recursive: true })
    symlinkSync(sessions, join(account, 'sessions'))
    const out = join(home, 'activity.json')
    const args = [join(root, 'tools/ingest.mjs'), home, '--activity', '--since', '2026-10-22T19:26:00Z', '--out', out]
    const summary = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }))
    const activity = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(summary.schema, 'agent-record.activity.v1')
    assert.equal(activity.sessions.length, 1)
    assert.equal(activity.coverage.duplicateRoots, 1)
    assert.equal(gunzipSync(readFileSync(out + '.gz')).toString(), readFileSync(out, 'utf8'))
    const session = activity.sessions[0]
    assert.equal(session.id, 'retained-native-activity')
    assert(session.segments.some(segment => segment.phase === 'tool'))
    assert(session.segments.some(segment => segment.phase === 'model' && segment.usage))
    assert.equal(activity.modelSplitMethod.kind, 'estimate')
    for (const segment of session.segments) {
      assert.equal(segment.category, segment.activity)
      assert(!('input' in segment) && !('output' in segment))
      const seconds = (Date.parse(segment.end) - Date.parse(segment.at)) / 1000
      assert(seconds >= 0)
      if (segment.modelSplit) assert(Math.abs(Object.values(segment.modelSplit).reduce((a, b) => a + b, 0) - seconds) < 1e-9)
    }
    const record = parseRecord(activityToRecord(activity))
    assert.equal(record.events.length, session.segments.length)
    assert(record.events.every(event => event.activity && event.end))
    const repeat = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }))
    assert.equal(repeat.sessions, 1)
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).sessions, activity.sessions)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a real native parse survives source retirement between the reader and cache validation', async () => {
  const { sessionCache } = await import('../tools/activity/cache.mjs')
  const { readActivitySession } = await import('../tools/activity/sessions.mjs')
  const home = mkdtempSync(join(tmpdir(), 'agent-record-retired-'))
  try {
    const path = join(home, 'retained.jsonl')
    copyFileSync(join(root, 'tests/fixtures/native-activity/codex.jsonl'), path)
    const coverage = { unreadableFiles: 0, malformedLines: 0, unmatchedOutputs: 0, missingSessionIdentity: 0 }
    const cached = await sessionCache(home)
    const session = await cached(path, 'codex', async options => {
      const parsed = await readActivitySession({ path, seat: 'default-home' }, options)
      rmSync(path)
      return parsed
    }, { since: Date.parse('2026-10-22T19:26:00Z'), now: Date.now(), coverage })
    assert.equal(session.id, 'retained-native-activity')
    assert(session.segments.some(segment => segment.phase === 'tool'))
    assert.equal(coverage.cacheValidationErrors, 1)
    assert.equal(coverage.unreadableFiles, 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('Claude native discovery and warm cache preserve default and account seat context', async () => {
  const { sessionCache } = await import('../tools/activity/cache.mjs')
  const { readClaudeSessions } = await import('../tools/activity/claude.mjs')
  const home = mkdtempSync(join(tmpdir(), 'agent-record-claude-seats-'))
  try {
    const defaults = join(home, '.claude', 'projects', 'retained')
    const account = join(home, '.config', 'agent-accounts', 'claude', 'retained-seat', 'projects', 'retained')
    mkdirSync(defaults, { recursive: true })
    mkdirSync(account, { recursive: true })
    // Replay the same recorded session first from one discovered root, then
    // retire that root and discover it at its account location. No tool is run.
    const path = join(defaults, 'session.jsonl')
    copyFileSync(join(root, 'tests/fixtures/native-activity/claude.jsonl'), path)
    const cached = await sessionCache(home)
    const coverage = { unreadableFiles: 0, malformedLines: 0, unmatchedOutputs: 0, missingSessionIdentity: 0 }
    const options = { since: Date.parse('2026-10-18T05:56:00Z'), now: Date.now(), coverage, cached }
    assert.equal((await readClaudeSessions(home, options))[0].seat, 'default-home')
    rmSync(path)
    const accountPath = join(account, 'session.jsonl')
    copyFileSync(join(root, 'tests/fixtures/native-activity/claude.jsonl'), accountPath)
    const fresh = await readClaudeSessions(home, options)
    const warm = await readClaudeSessions(home, options)
    assert.equal(fresh[0].seat, 'retained-seat')
    assert.equal(warm[0].seat, 'retained-seat')
    assert.deepEqual(warm, fresh)
    assert(coverage.cacheHits >= 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
