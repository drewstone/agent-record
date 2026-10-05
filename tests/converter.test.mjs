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
import { createFileCache, ingestBundle, ingestRun } from '../dist/agent-runtime.js'

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
  // --run-id may repeat a bundle's recordId but never contradict it.
  writeFileSync(join(bundle, 'bundle.json'), JSON.stringify({ schema: 'agent-record.bundle.v1', recordId: 'b', sessions: [{ path: 'pi/a.jsonl', harness: 'pi' }] }))
  assert.equal(spawnSync(process.execPath, [INGEST, bundle, '--run-id', 'b', '--out', join(root, 'b.json')]).status, 0)
  assert.equal(spawnSync(process.execPath, [INGEST, bundle, '--run-id', 'other', '--out', join(root, 'c.json')]).status, 64)
})

// A cli-bridge Pi session lives under sha256("cli-bridge/pi-session\0" + bridge session id); that id is the execution id
// in the child's materialization receipt. The coordination log keeps what a parent told its workers.
function writeBridgeRun(root) {
  const run = join(root, 'run-b')
  const file = (path, text) => {
    mkdirSync(dirname(join(run, path)), { recursive: true })
    writeFileSync(join(run, path), text)
  }
  const execution = 'supervised-worker-0123'
  file('spawn-journal.jsonl', jsonl([
    { kind: 'event', root: 'run-b', event: { kind: 'spawned', id: 'run-b', at: '2026-08-16T20:00:00Z' } },
    { kind: 'event', root: 'run-b', event: { kind: 'spawned', id: 'run-b:s0', at: '2026-08-16T20:01:00Z', identity: { taskDigest: 'sha256:00' } } },
    { kind: 'event', root: 'run-b', event: { kind: 'materialized', id: 'run-b:s0', at: '2026-08-16T20:01:01Z', receipt: { status: 'known', execution: { kind: 'session', id: execution } } } },
    { kind: 'event', root: 'run-b', event: { kind: 'settled', id: 'run-b:s0', at: '2026-08-16T20:09:00Z', status: 'up' } },
  ]))
  // A header-only session: no prompt, so no task digest could ever join it.
  file(`trace/pi-sessions/cli-bridge/${sha(`cli-bridge/pi-session\0${execution}`)}/b.jsonl`, jsonl([
    { type: 'session', id: 'pi-session-b', timestamp: '2026-08-16T20:01:05Z', cwd: '/w' },
  ]))
  file('coordination-log.jsonl', jsonl([
    { runId: 'run-b', seq: 0, at: Date.parse('2026-08-16T20:05:00Z'), event: { type: 'instruction', instruction: { receiptId: 'r1', kind: 'steer', toWorker: 'run-b:s0', instruction: 'Use exact arithmetic.' } } },
    { runId: 'run-b', seq: 1, at: Date.parse('2026-08-16T20:05:01Z'), event: { type: 'steer', down: { receiptId: 'r1' } } },
    { runId: 'run-b', seq: 2, at: Date.parse('2026-08-16T20:06:00Z'), event: { type: 'instruction', instruction: { receiptId: 'r2', kind: 'interrupt', toWorker: 'run-b:s0', instruction: '', interrupt: true } } },
    { runId: 'run-b', seq: 3, at: Date.parse('2026-08-16T20:07:00Z'), event: { type: 'instruction', instruction: { receiptId: 'r3', kind: 'steer', toWorker: 'run-b:s9', instruction: 'Unknown worker.' } } },
  ]))
  return run
}

test('a Pi session joins by its bridge session directory, and a parent keeps the instructions it sent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { record } = ingestRun(writeBridgeRun(root), { runId: 'run-b' })
  const child = record.nodes.find((node) => node.id === 'run-b:s0')
  assert.equal(child.joinBasis, 'bridge-session-directory')
  assert.equal(child.joinProof.sessionId, 'supervised-worker-0123')
  assert.ok(!record.nodes.some((node) => node.id.startsWith('pi:')))
  const steer = record.events.filter((event) => event.source.path === 'coordination-log.jsonl')
  assert.equal(steer.length, 2)
  assert.equal(steer[1].label, 'interrupt → s0')
  assert.equal(steer[1].detail.publicText, undefined)
  assert.ok(record.coverage.gaps.some((gap) => gap.code === 'coordination-target-unknown'))
  assert.equal(steer[0].node, 'run-b')
  assert.equal(steer[0].detail.publicText, 'Use exact arithmetic.')
  assert.equal(steer[0].detail.coordination.toNode, 'run-b:s0')
  const director = record.nodes.find((node) => node.id === 'run-b')
  assert.deepEqual(director.capture, { channel: 'coordination', status: 'lossy', reason: 'instructions-to-workers-only' })
  assert.ok(record.coverage.gaps.some((gap) => gap.nodeId === 'run-b' && gap.code === 'conversation-not-retained'))
})

// A running node's conversation is its live Sandbox event stream; once it settles, its native session (here the run's
// native-index capture) is read instead, so one turn is never shown from both.
const at = (s) => `2026-10-05T06:00:${String(s).padStart(2, '0')}Z`
const SESSION_ROWS = [
  { type: 'user', uuid: 'u1', timestamp: at(1), message: { role: 'user', content: 'Plan the economics pass.' } },
  { type: 'assistant', uuid: 'a1', timestamp: at(2), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', uuid: 'r1', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'notes.md' }] } },
  { type: 'assistant', uuid: 'a2', timestamp: at(4), message: { id: 'm2', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'The notes hold the cost model.', signature: 'sig' }, { type: 'redacted_thinking', data: 'enc' }, { type: 'text', text: 'Reading the notes.' }] } },
]
const ms = (s) => Date.parse(at(s))
const part = (id, value) => ({ id: String(id), type: 'message.part.updated', data: { part: value } })
const LIVE_EVENTS = [
  { id: '1', type: 'execution.started', data: {} },
  part(2, { id: 'p-think', type: 'reasoning', text: 'Check the', time: { start: ms(2) } }),
  part(3, { id: 'p-think', type: 'reasoning', text: 'Check the notes first.', time: { start: ms(2), end: ms(2) } }),
  part(4, { id: 'p-bash', type: 'tool', tool: 'Bash', callID: 't1', state: { status: 'running', input: { command: 'ls' }, time: { start: ms(3) } } }),
  part(5, { id: 'p-bash', type: 'tool', tool: 'Bash', callID: 't1', state: { status: 'completed', input: { command: 'ls' }, output: 'notes.md', time: { start: ms(3), end: ms(4) } } }),
  { id: '6', type: 'tool-heartbeat', data: {} },
]

function writeNativeRun(root, { live = false, settled = false } = {}) {
  const run = join(root, 'run-n')
  const native = join(root, 'native')
  const file = (base, path, text) => {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), text)
  }
  const session = '.claude/projects/-home-agent/abc.jsonl'
  file(run, 'spawn-journal.jsonl', jsonl([
    { kind: 'event', root: 'run-n', event: { kind: 'spawned', id: 'run-n', at: at(0) } },
    { kind: 'event', root: 'run-n', event: { kind: 'spawned', id: 'run-n:s0', at: at(0) } },
    ...(settled ? [{ kind: 'event', root: 'run-n', event: { kind: 'settled', id: 'run-n:s0', at: at(9), status: 'done' } }] : []),
  ]))
  const hex = 'a'.repeat(64)
  file(run, 'evidence/native-index.jsonl', jsonl([{
    schema: 'disco.native-capture.v1', runId: 'run-n', at: at(5), nodeId: 'run-n:s0', environmentId: 'sandbox-0123456789ab', harness: 'claude-code',
    snapshot: { archive: `sha256:${hex}` },
    native: { harness: 'claude-code', sessions: [{ sandboxSessionId: 'sess', sourceId: 'exec', rootScope: 'session-home', path: session }] },
  }]))
  file(native, `${hex}/workspace/__retention__/sessions/sess/native/exec/session-home/${session}`, jsonl(SESSION_ROWS))
  if (live) file(run, `evidence/live-stream/${encodeURIComponent('run-n:s0')}/exec.jsonl`, jsonl(LIVE_EVENTS))
  return { run, native }
}

const childEvents = (record) => record.events.filter((event) => event.node === 'run-n:s0' && event.source.path !== 'spawn-journal.jsonl')

test('a settled node reads its session from the native index, with withheld thinking counted', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { run, native } = writeNativeRun(root, { live: true, settled: true })
  const record = ingestRun(run, { runId: 'run-n', native }).record
  const child = record.nodes.find((node) => node.id === 'run-n:s0')
  assert.equal(child.capture.channel, 'native')
  assert.ok(child.sandboxes.includes('sandbox-0123456789ab'))
  const events = childEvents(record)
  assert.ok(events.every((event) => event.source.path.startsWith('native:')))
  const [first, second] = events.filter((event) => event.detail.role === 'assistant')
  assert.equal(first.detail.reasoningOmitted, 1)
  assert.equal(first.detail.publicToolCalls[0].input, '{"command":"ls"}')
  assert.equal(second.detail.reasoning, 'The notes hold the cost model.')
  assert.equal(second.detail.reasoningRedacted, 1)
  assert.equal(events.find((event) => event.kind === 'tool-result').detail.publicText, 'notes.md')
})

test('a running node shows its live event stream, one row per part in its final state', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { run, native } = writeNativeRun(root, { live: true })
  const record = ingestRun(run, { runId: 'run-n', native }).record
  assert.equal(record.nodes.find((node) => node.id === 'run-n:s0').capture.channel, 'live')
  const events = childEvents(record)
  assert.ok(events.every((event) => event.source.path === `evidence/live-stream/${encodeURIComponent('run-n:s0')}/exec.jsonl` && event.source.line))
  assert.deepEqual(events.map((event) => [event.kind, event.detail.nativeRecordId]), [['message', 'p-think'], ['message', 'p-bash'], ['tool-result', 'p-bash']])
  assert.equal(events[0].detail.reasoning, 'Check the notes first.')
  assert.equal(events[1].detail.publicToolCalls[0].input, '{"command":"ls"}')
  assert.equal(events[2].detail.publicText, 'notes.md')
  assert.equal(events[2].detail.durationMs, 1000)
})

test('a file cache shared across conversions never changes the record, and a changed file is read again', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { run, native } = writeNativeRun(root, { live: true })
  const files = createFileCache()
  const options = { runId: 'run-n', native }
  assert.equal(ingestRun(run, { ...options, files }).json, ingestRun(run, options).json)
  assert.ok(files.heldBytes() > 0)
  const live = join(run, `evidence/live-stream/${encodeURIComponent('run-n:s0')}/exec.jsonl`)
  writeFileSync(live, readFileSync(live, 'utf8') + JSON.stringify(part(7, { id: 'p-text', type: 'text', text: 'Continue.', time: { start: ms(6) } })) + '\n')
  const again = ingestRun(run, { ...options, files })
  assert.equal(again.json, ingestRun(run, options).json)
  assert.ok(again.record.events.some((event) => event.detail.publicText === 'Continue.'))
})
