// The converter's publication invariants, on tiny runs written in each test: the same inputs give the same bytes, an
// event id is recomputable from its object and line alone, a new join moves no id, and a repeated anchor fails.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ingestBundle, ingestRun } from '../dist/agent-runtime.js'

const INGEST = join(dirname(fileURLToPath(import.meta.url)), '../tools/ingest.mjs')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
const TASK = 'Check the ladder ratio at l = 2.'

function writeRun(root, { joinable }) {
  const run = join(root, 'run-x')
  const file = (path, text) => {
    mkdirSync(dirname(join(run, path)), { recursive: true })
    writeFileSync(join(run, path), text)
  }
  file('run-input.json', JSON.stringify({ task: { objective: 'fixture' } }))
  // The child's task digest matches the Pi session's first user text only when `joinable`.
  const digest = `sha256:${sha(JSON.stringify(joinable ? TASK : 'another task'))}`
  file('spawn-journal.jsonl', jsonl([
    { kind: 'event', root: 'run-x', event: { kind: 'spawned', id: 'run-x', at: '2026-08-16T20:00:00Z' } },
    { kind: 'event', root: 'run-x', event: { kind: 'spawned', id: 'run-x:s0', at: '2026-08-16T20:01:00Z', identity: { taskDigest: digest } } },
    { kind: 'event', root: 'run-x', event: { kind: 'settled', id: 'run-x:s0', at: '2026-08-16T20:09:00Z', status: 'up' } },
  ]))
  file('trace/pi-sessions/w/a.jsonl', jsonl([
    { type: 'session', id: 'pi-session-a', timestamp: '2026-08-16T20:01:05Z', cwd: '/w' },
    { type: 'model_change', id: 'm1', timestamp: '2026-08-16T20:01:05Z', provider: 'p', modelId: 'glm-5' },
    { type: 'message', id: 'u1', timestamp: '2026-08-16T20:01:06Z', message: { role: 'user', content: [{ type: 'text', text: TASK }] } },
    { type: 'message', id: 'a1', timestamp: '2026-08-16T20:02:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Ratio is 10.' }, { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'python3 check.py' } }] } },
    { type: 'message', id: 'r1', timestamp: '2026-08-16T20:02:30Z', message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }] } },
  ]))
  file('kb/pages/q/finding.md', '---\ntitle: Ladder ratio holds\ncreatedAt: 2026-08-16T20:08:00Z\n---\nThe ratio is 10 at l = 2.\n')
  return run
}

test('the same inputs give the same record bytes, and every id is the anchor of its object and line', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = writeRun(root, { joinable: true })
  const first = ingestRun(run, { runId: 'run-x' })
  const second = ingestRun(run, { runId: 'run-x' })
  assert.equal(first.json, second.json)
  assert.equal(first.record.idScheme, 'anchor.v1')
  assert.ok(first.record.events.length >= 9)
  for (const event of first.record.events) {
    // Recomputed here without the converter: the object's sha256 prefix, then the line or nothing for a whole page.
    const bytes = readFileSync(join(run, event.source.path))
    assert.equal(sha(bytes), event.source.sha256)
    const expected = sha(bytes).slice(0, 12) + (event.source.line ? `:${event.source.line}` : '') + (event.source.item !== undefined ? `.${event.source.item}` : '')
    assert.equal(event.id, expected)
    if (event.source.line) assert.ok(bytes.toString('utf8').split('\n')[event.source.line - 1].length > 0)
  }
  // The Pi header and model change are events, and the page is one whole-object event.
  const pi = sha(readFileSync(join(run, 'trace/pi-sessions/w/a.jsonl'))).slice(0, 12)
  assert.ok(first.record.events.some((event) => event.id === `${pi}:1` && event.kind === 'record'))
  assert.ok(first.record.events.some((event) => event.id === `${pi}:2` && event.kind === 'record'))
  assert.ok(first.record.events.some((event) => event.kind === 'finding-record' && event.id === sha(readFileSync(join(run, 'kb/pages/q/finding.md'))).slice(0, 12)))
})

test('a join moves events to another node without changing a single id', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const unjoined = ingestRun(writeRun(join(root, 'a'), { joinable: false }), { runId: 'run-x' }).record
  const joined = ingestRun(writeRun(join(root, 'b'), { joinable: true }), { runId: 'run-x' }).record
  const piIds = (record) => record.events.filter((event) => event.source.path.startsWith('trace/pi-sessions/')).map((event) => [event.id, event.node])
  assert.deepEqual(piIds(unjoined).map(([id]) => id), piIds(joined).map(([id]) => id))
  assert.ok(piIds(unjoined).every(([, node]) => node === 'pi:pi-session-a'))
  assert.ok(piIds(joined).every(([, node]) => node === 'run-x:s0'))
  assert.equal(joined.nodes.find((node) => node.id === 'run-x:s0').joinBasis, 'task-digest')
})

test('a directory that differs from its snapshot manifest, or a repeated anchor, is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = writeRun(root, { joinable: true })
  const files = ['run-input.json', 'spawn-journal.jsonl', 'trace/pi-sessions/w/a.jsonl', 'kb/pages/q/finding.md']
    .map((path) => ({ path, sha256: `sha256:${sha(readFileSync(join(run, path)))}`, bytes: readFileSync(join(run, path)).length }))
  const manifest = { schema: 'evidence.snapshot.v1', runId: 'run-x', files }
  writeFileSync(join(root, 'snapshot.json'), JSON.stringify(manifest))
  const ok = spawnSync(process.execPath, [INGEST, run, '--manifest', join(root, 'snapshot.json'), '--out', join(root, 'out.json')], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(JSON.parse(readFileSync(join(root, 'out.json'), 'utf8')).input.snapshot, `sha256:${sha(readFileSync(join(root, 'snapshot.json')))}`)
  writeFileSync(join(run, 'kb/pages/q/finding.md'), 'changed after the snapshot\n')
  const changed = spawnSync(process.execPath, [INGEST, run, '--manifest', join(root, 'snapshot.json'), '--out', join(root, 'out2.json')], { encoding: 'utf8' })
  assert.equal(changed.status, 4)
  assert.match(changed.stderr, /finding\.md does not match/)

  // A bundle that lists one session twice for one node would emit every line twice: an error, never a suffix.
  const bundle = join(root, 'bundle')
  mkdirSync(join(bundle, 'pi'), { recursive: true })
  writeFileSync(join(bundle, 'pi/a.jsonl'), readFileSync(join(run, 'trace/pi-sessions/w/a.jsonl')))
  writeFileSync(join(bundle, 'bundle.json'), JSON.stringify({
    schema: 'agent-record.bundle.v1', recordId: 'b', sessions: [{ path: 'pi/a.jsonl', harness: 'pi', sessionId: 's' }, { path: 'pi/a.jsonl', harness: 'pi', sessionId: 's' }],
  }))
  assert.throws(() => ingestBundle(bundle), /duplicate anchor/)
})
