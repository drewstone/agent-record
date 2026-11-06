// The converter's publication invariants, on tiny runs written in each test: the same inputs give the same bytes, an
// event id is recomputable from its object and line alone, a new join moves no id, and a repeated anchor fails.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createFileCache, ingestBundle, ingestRun, readOpenCodeUsage } from '../dist/agent-runtime.js'

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

test('retained native Runtime failures keep their recorded failure state', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-failure-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = writeRun(root, { joinable: true }), journal = join(run, 'spawn-journal.jsonl')
  const events = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(row => JSON.parse(row))
  events.at(-1).event.status = 'down'
  events.at(-1).event.reason = 'Native checkout failed'
  writeFileSync(journal, jsonl(events))
  const record = ingestRun(run, { runId: 'run-x' }).record
  assert.equal(record.schema, 'agent-record.v1')
  assert.equal(record.nodes.find(node => node.id === 'run-x:s0').status, 'down')
  assert.ok(record.events.some(event => event.detail.isError === true))
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

test('a directory that differs from its snapshot manifest is refused', (t) => {
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

test('a Pi session joins by its bridge session directory, and steering appears on both parent and worker', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { record } = ingestRun(writeBridgeRun(root), { runId: 'run-b' })
  const child = record.nodes.find((node) => node.id === 'run-b:s0')
  assert.equal(child.joinBasis, 'bridge-session-directory')
  assert.equal(child.joinProof.sessionId, 'supervised-worker-0123')
  assert.ok(!record.nodes.some((node) => node.id.startsWith('pi:')))
  const steer = record.events.filter((event) => event.source.path === 'coordination-log.jsonl')
  assert.equal(steer.length, 3)
  assert.equal(steer[2].label, 'interrupt → s0')
  assert.equal(steer[2].detail.publicText, undefined)
  assert.ok(record.coverage.gaps.some((gap) => gap.code === 'coordination-target-unknown'))
  assert.equal(steer[0].node, 'run-b')
  assert.equal(steer[0].detail.publicText, 'Use exact arithmetic.')
  assert.equal(steer[0].detail.coordination.toNode, 'run-b:s0')
  assert.equal(steer[1].node, 'run-b:s0')
  assert.equal(steer[1].detail.promptKind, 'steering')
  assert.equal(steer[1].detail.promptSender, 'Parent agent')
  assert.equal(steer[1].detail.publicText, 'Use exact arithmetic.')
  assert.notEqual(steer[0].id, steer[1].id)
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

test('a metered journal window becomes scoped usage the usage view can chart cumulatively', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = join(root, 'run-m')
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'run-input.json'), JSON.stringify({ task: { objective: 'fixture' } }))
  writeFileSync(join(run, 'spawn-journal.jsonl'), jsonl([
    { kind: 'event', root: 'run-m', event: { kind: 'spawned', id: 'run-m', at: '2026-08-16T20:00:00Z' } },
    { kind: 'event', root: 'run-m', event: { kind: 'spawned', id: 'run-m:s0', at: '2026-08-16T20:01:00Z' } },
    { kind: 'event', root: 'run-m', event: { kind: 'metered', id: 'run-m:s0', at: '2026-08-16T20:05:00Z', spent: { iterations: 1, tokens: { input: 248, output: 134562, cacheBreakdownKnown: false }, usd: 10.88, usdKnown: false } } },
    { kind: 'event', root: 'run-m', event: { kind: 'settled', id: 'run-m:s0', at: '2026-08-16T20:09:00Z', status: 'up' } },
  ]))
  const record = ingestRun(run, { runId: 'run-m' }).record
  const metered = record.events.filter((event) => event.kind === 'metered')
  assert.equal(metered.length, 1)
  assert.deepEqual(metered[0].detail.usage, { input: 248, output: 134562 })
  assert.equal(metered[0].detail.usageScope, 'metered')
  // Scoped usage is cumulative by meaning: never presented as a per-response measurement.
  assert.equal(record.events.filter((event) => event.detail.usage && event.detail.usageScope === undefined).length, 0)
})


// Real captured SQLite stores through the public converter, including committed rows still in a WAL.
for (const wal of [false, true]) test(`captured OpenCode ${wal ? 'WAL' : 'checkpointed'} bytes stay intact across repeated conversions`, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter sqlite #'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { run, native } = writeNativeRun(root, { settled: true })
  const hex = 'b'.repeat(64), session = '.local/share/opencode/opencode.db'
  const store = join(native, hex, 'workspace/__retention__/sessions/sess/native/exec/session-home', session)
  mkdirSync(dirname(store), { recursive: true })
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const writer = new DatabaseSync(join(root, 'writer.db'))
  writer.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT, time_created INTEGER);
    CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part(id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
  `)
  writer.prepare('INSERT INTO session VALUES (?, ?)').run('native-root', ms(0))
  const message = writer.prepare('INSERT INTO message VALUES (?, ?, ?, ?)')
  message.run('m1', 'native-root', ms(1), JSON.stringify({ role: 'assistant', modelID: 'recorded-model', providerID: 'recorded-provider',
    tokens: { input: 11, output: 13, reasoning: 3, cache: { read: 2, write: 4 } }, cost: 0.25, time: { created: ms(1), completed: ms(4) } }))
  message.run('m2', 'native-root', ms(4), JSON.stringify({ role: 'assistant', modelID: 'switched-model', providerID: 'other-provider', tokens: { input: 0, output: 0 }, cost: 0 }))
  message.run('m3', 'native-root', ms(5), JSON.stringify({ role: 'assistant', error: { name: 'generic-failure' } }))
  for (const id of ['native-child', 'unrelated']) writer.prepare('INSERT INTO session VALUES (?, ?)').run(id, ms(1))
  message.run('m1', 'native-child', ms(6), JSON.stringify({ role: 'assistant', modelID: 'child-model', providerID: 'recorded-provider', tokens: { input: 5 } }))
  message.run('outside', 'unrelated', ms(7), JSON.stringify({ role: 'assistant', tokens: { input: 1000000 } }))
  const part = writer.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)')
  part.run('p1', 'm1', 'native-root', ms(2), JSON.stringify({ type: 'text', text: 'Checkpointed evidence.', time: { start: ms(2) } }))
  part.run('child-part', 'm1', 'native-child', ms(6), JSON.stringify({ type: 'text', text: 'Child conversation stays separate.', time: { start: ms(6) } }))
  part.run('root-tool', 'm1', 'native-root', ms(7), JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'TOKEN=synthetic-secret timeout 5s /usr/bin/curl -H "Authorization: Bearer synthetic-secret" https://user:pass@example.test/private' }, time: { start: ms(2), end: ms(3) } } }))
  part.run('child-tool', 'm1', 'native-child', ms(8), JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'error', input: { filePath: '/private/project/notes.md' }, time: { start: ms(6), end: ms(7) } } }))
  part.run('unicode-tool', 'm1', 'native-child', ms(9), JSON.stringify({ type: 'tool', tool: 'search', state: { input: { query: '界'.repeat(24) + '\u2028synthetic-secret' } } }))
  part.run('line-tool', 'm1', 'native-child', ms(10), JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: '/notes/visible.md\rsynthetic-secret' } } }))
  if (wal) {
    writer.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    part.run('p2', 'm1', 'native-root', ms(3), JSON.stringify({ type: 'text', text: 'WAL-only evidence.', time: { start: ms(3) } }))
  }
  writer.exec('ALTER TABLE message ADD COLUMN time_updated INTEGER; UPDATE message SET time_updated = time_created; ALTER TABLE part ADD COLUMN time_updated INTEGER; UPDATE part SET time_updated = time_created;')
  writer.prepare('UPDATE message SET time_updated = ? WHERE id = ? AND session_id = ?').run(ms(0), 'm3', 'native-root')
  if (!wal) writer.close() // Real completed captures retain the WAL header after checkpoint/removal.
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(join(root, 'writer.db') + suffix)) copyFileSync(join(root, 'writer.db') + suffix, store + suffix)
  if (wal) writer.close()
  const overlapStore = store.replace('/exec/', '/overlap/')
  mkdirSync(dirname(overlapStore), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(store + suffix)) copyFileSync(store + suffix, overlapStore + suffix)
  const nativeSession = { sandboxSessionId: 'sess', sourceId: 'exec', rootScope: 'session-home', path: session, nativeSessionId: 'native-root' }
  const index = {
    schema: 'disco.native-capture.v1', runId: 'run-n', at: at(5), nodeId: 'run-n:s0', harness: 'opencode',
    snapshot: { archive: `sha256:${hex}` },
    native: { harness: 'opencode', sessions: [nativeSession, { ...nativeSession, nativeSessionId: 'native-child', parentNativeSessionId: 'native-root' }, nativeSession, { ...nativeSession, sourceId: 'overlap' }] },
  }
  writeFileSync(join(run, 'evidence/native-index.jsonl'), jsonl([{ ...index, native: { sessions: [{ ...nativeSession, nativeSessionId: 'unrelated' }] } }, index]))
  const original = new Map([store, overlapStore].flatMap(path => readdirSync(dirname(path)).map(name => [join(dirname(path), name), readFileSync(join(dirname(path), name))])))
  const files = createFileCache(), options = { runId: 'run-n', native, files }
  const first = ingestRun(run, options), second = ingestRun(run, options)
  assert.equal(second.json, first.json)
  assert.deepEqual(childEvents(first.record).filter(e => e.detail.publicText).map(e => e.detail.publicText), wal ? ['Checkpointed evidence.', 'WAL-only evidence.'] : ['Checkpointed evidence.'])
  assert.ok(childEvents(first.record).every(e => e.source.path.startsWith(`native:${hex}/`) && e.source.pointer.startsWith('/part/')))
  const usage = first.record.nodes.find(node => node.id === 'run-n:s0').nativeUsage
  assert.equal(usage.complete, true)
  assert.equal(usage.calls, 4)
  assert.deepEqual([usage.responses[0].start, usage.responses[0].end], [ms(1), ms(4)])
  assert.deepEqual(usage.tools.map(({ id, sessionId, tool, start, end, failed, name }) => ({ id, sessionId, tool, start, end, failed, name })), [
    { id: 'root-tool', sessionId: 'native-root', tool: 'bash', start: ms(2), end: ms(3), failed: false, name: 'bash · curl' },
    { id: 'child-tool', sessionId: 'native-child', tool: 'read', start: ms(6), end: ms(7), failed: true, name: 'read · notes.md' },
    { id: 'unicode-tool', sessionId: 'native-child', tool: 'search', start: null, end: null, failed: false, name: 'search · …' },
    { id: 'line-tool', sessionId: 'native-child', tool: 'read', start: null, end: null, failed: false, name: 'read · visible.md' },
  ])
  assert.ok(usage.tools.every(tool => /^[0-9a-f]{16}$/.test(tool.inputDigest)))
  assert.ok(!JSON.stringify(usage).includes('synthetic-secret'))
  const direct = readOpenCodeUsage(store, { sourcePath: 'live/store.db' })
  assert.equal(direct.calls, 5)
  assert.equal(direct.responses[0].id, 'm3')
  assert.equal(direct.opened, ms(0))
  assert.deepEqual(direct.sessionIds, ['native-root', 'native-child', 'unrelated'])
  assert.equal(readOpenCodeUsage(store, { sessionIds: ['native-root', 'native-child'] }).calls, 4)
  assert.ok(!JSON.stringify(direct).includes(root))
  assert.deepEqual(usage.responses.map(({ id, sessionId, model, provider, tokens, cost, at, failed }) => ({ id, sessionId, model, provider, tokens, cost, at, failed })), [
    { id: 'm1', sessionId: 'native-root', model: 'recorded-model', provider: 'recorded-provider', tokens: { input: 11, output: 16, cacheRead: 2, cacheWrite: 4 }, cost: 0.25, at: ms(4), failed: false },
    { id: 'm2', sessionId: 'native-root', model: 'switched-model', provider: 'other-provider', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, at: null, failed: false },
    { id: 'm3', sessionId: 'native-root', model: null, provider: null, tokens: null, cost: null, at: null, failed: true },
    { id: 'm1', sessionId: 'native-child', model: 'child-model', provider: 'recorded-provider', tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null, at: null, failed: false },
  ])
  assert.equal(usage.sources.length, 2)
  assert.ok(usage.responses.every(response => usage.sources.some(source => JSON.stringify(response.source) === JSON.stringify(source))))
  assert.ok(usage.sources.every(source => source.path.startsWith(`native:${hex}/`)))
  assert.match(usage.sources[0].sha256, /^[0-9a-f]{64}$/)
  for (const path of [store, overlapStore]) assert.deepEqual(readdirSync(dirname(path)).map(name => join(dirname(path), name)).sort(), [...original.keys()].filter(name => dirname(name) === dirname(path)).sort())
  for (const [path, bytes] of original) assert.deepEqual(readFileSync(path), bytes, `cached input ${path} is unchanged`)
  const live = join(run, `evidence/live-stream/${encodeURIComponent('run-n:s0')}/exec.jsonl`)
  mkdirSync(dirname(live), { recursive: true }); writeFileSync(live, jsonl(LIVE_EVENTS))
  const journal = readFileSync(join(run, 'spawn-journal.jsonl'), 'utf8')
  writeFileSync(join(run, 'spawn-journal.jsonl'), jsonl(journal.trim().split('\n').map(JSON.parse).filter(row => row.event.kind !== 'settled')))
  const running = ingestRun(run, options).record
  assert.equal(running.nodes.find(node => node.id === 'run-n:s0').capture.channel, 'live')
  assert.deepEqual(running.nodes.find(node => node.id === 'run-n:s0').nativeUsage, usage)
  assert.ok(childEvents(running).every(event => event.source.path.includes('evidence/live-stream/')))
  writeFileSync(join(run, 'spawn-journal.jsonl'), journal)
  index.native.sessions.push({ ...nativeSession, nativeSessionId: 'missing', parentNativeSessionId: 'native-root' })
  writeFileSync(join(run, 'evidence/native-index.jsonl'), jsonl([index]))
  const partial = ingestRun(run, options).record.nodes.find(node => node.id === 'run-n:s0').nativeUsage
  assert.equal(partial.complete, false)
  assert.equal(partial.calls, null)
  assert.deepEqual(partial.responses, usage.responses)
  rmSync(store)
  const missingFirst = ingestRun(run, options).record.nodes.find(node => node.id === 'run-n:s0').nativeUsage
  assert.equal(missingFirst.complete, false)
  assert.equal(missingFirst.calls, null)
  assert.equal(missingFirst.responses.length, 3)
  writeFileSync(store, 'not a SQLite database')
  writeFileSync(overlapStore, 'not a SQLite database')
  const unreadable = ingestRun(run, options).record
  assert.equal(Object.hasOwn(unreadable.nodes.find(node => node.id === 'run-n:s0'), 'nativeUsage'), false)
  assert.ok(unreadable.coverage.gaps.some(gap => gap.code === 'no-transcript:opencode-store-unreadable'))
  assert.equal(readOpenCodeUsage(store), null)
  t.diagnostic(JSON.stringify({ wal, recordDigest: first.summary.recordDigest }))
})

// One framing for every harness reader: a session file belongs to one node, keeps to its line window, and each event's
// id is the file's own sha256 prefix and line or JSON Pointer, recomputed here from the bytes alone. A repeated anchor is refused.
test('every harness file in a bundle is framed alike: one owner, its line window, ids from its own bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const retained = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/native-activity', name), 'utf8')
  const bridgeCalls = { tool_calls: [{ id: 'c1', name: 'bash', arguments: '{}' }, { id: 'c2', name: 'read', arguments: '{}' }] }
  const files = {
    'claude/retained.jsonl': retained('claude.jsonl'),
    'codex/retained.jsonl': retained('codex.jsonl'),
    // Line 6 is torn, line 7 has no time, line 8 is outside the window.
    'codex/windowed.jsonl': retained('codex.jsonl') + '{"torn\n' + jsonl([{ type: 'event_msg', payload: { type: 'note' } }, { type: 'event_msg', timestamp: at(9), payload: { type: 'note' } }]),
    // Pi line 1 (the header, which still names the session) and bridge line 3 are outside their windows; the bridge sessions row has no time.
    'pi/a.jsonl': jsonl([{ type: 'session', id: 'pi-a', timestamp: at(1) }, { type: 'message', id: 'u', timestamp: at(2), message: { role: 'user', content: 'Go.' } }]),
    'bridge/s.jsonl': jsonl([{ table: 'sessions', row: { external_id: 'b-1' } }, { table: 'retained_events', row: { event_id: 'e', occurred_at: at(2), event_json: JSON.stringify({ event: bridgeCalls }) } },
      { table: 'retained_events', row: { event_id: 'f', occurred_at: at(3), event_json: JSON.stringify({ event: { content: 'Outside the window.' } }) } }]),
    'oc/s/native-trajectory.json': JSON.stringify({ messages: [{ id: 'm', data: { role: 'assistant' } }], parts: [{ id: 'p', message_id: 'm', time_created: ms(3), data: { type: 'text', text: 'Done.' } }] }),
  }
  const bundle = join(root, 'bundle')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(bundle, path)), { recursive: true })
    writeFileSync(join(bundle, path), text)
  }
  const writeBundle = (sessions) => writeFileSync(join(bundle, 'bundle.json'), JSON.stringify({ schema: 'agent-record.bundle.v1', recordId: 'harnesses', sessions }))
  writeBundle([
    { path: 'claude/retained.jsonl', harness: 'claude-code' },
    { path: 'claude/retained.jsonl', harness: 'claude-code', sessionId: 'again' },
    { path: 'codex/retained.jsonl', harness: 'codex' },
    { path: 'codex/windowed.jsonl', harness: 'codex', lines: [[1, 3], [6, 7]] },
    { path: 'pi/a.jsonl', harness: 'pi', lines: [[2, 2]] },
    { path: 'bridge/s.jsonl', harness: 'opencode-bridge', lines: [[1, 2]] },
    { path: 'oc/s/native-trajectory.json', harness: 'opencode' },
  ])
  const { record } = ingestBundle(bundle)
  for (const { id, source } of record.events) {
    const object = sha(readFileSync(join(bundle, source.path))).slice(0, 12)
    assert.equal(id, `${object}:${source.line ?? source.pointer}${source.item === undefined ? '' : `.${source.item}`}`)
  }
  assert.deepEqual(Object.fromEntries(record.nodes.map((node) => [node.id, node.capture.channel])), {
    'claude-code:retained-claude-activity': 'native', 'claude-code:again': 'none', 'codex:retained': 'codex', 'codex:windowed': 'codex', 'pi:pi-a': 'pi', 'bridge:b-1': 'bridge', 'opencode:s': 'oc',
  })
  // Each node's anchors (line, then item) after its object prefix.
  const kept = (node) => record.events.filter((event) => event.node === node).map((event) => event.id.slice(13))
  assert.deepEqual(['claude-code:again', 'codex:windowed', 'pi:pi-a', 'bridge:b-1'].map(kept), [[], ['1', '2', '3'], ['2'], ['2.0', '2.1']])
  assert.deepEqual(record.coverage.gaps.map(({ nodeId, code, detail }) => [nodeId, code, detail]), [
    ['claude-code:again', 'source-shared', 'claude/retained.jsonl is already the conversation of claude-code:retained-claude-activity'],
    ['codex:windowed', 'untimed-lines', '1 lines of codex/windowed.jsonl carry no time'],
    ['codex:windowed', 'unparsable-lines', '1 lines of codex/windowed.jsonl are not JSON'],
    ['bridge:b-1', 'untimed-lines', '1 rows of bridge/s.jsonl carry no time'],
  ])
  // One session listed twice for one node would emit every line twice: an error, never a suffix.
  writeBundle([{ path: 'pi/a.jsonl', harness: 'pi', sessionId: 's' }, { path: 'pi/a.jsonl', harness: 'pi', sessionId: 's' }])
  assert.throws(() => ingestBundle(bundle), /duplicate anchor/)
  writeBundle([{ path: 'pi/a.jsonl', harness: 'toString' }])
  assert.throws(() => ingestBundle(bundle), /pi\/a\.jsonl has an unknown harness/)
  // --run-id may repeat a bundle's recordId but never contradict it.
  writeBundle([{ path: 'pi/a.jsonl', harness: 'pi' }])
  assert.equal(spawnSync(process.execPath, [INGEST, bundle, '--run-id', 'harnesses', '--out', join(root, 'b.json')]).status, 0)
  assert.equal(spawnSync(process.execPath, [INGEST, bundle, '--run-id', 'other', '--out', join(root, 'c.json')]).status, 64)
  const trajectory = { session: { id: 'owned' }, messages: [{ id: 'same-response', session_id: 'owned', data: { role: 'assistant', tokens: { input: 0 } } }], parts: [] }
  for (const [path, suffix] of [['oc/first.json', ''], ['oc/second.json', '\n']]) writeFileSync(join(bundle, path), JSON.stringify(trajectory) + suffix)
  writeBundle(['oc/first.json', 'oc/second.json'].map(path => ({ path, harness: 'opencode', sessionId: 'overlap' })))
  const overlap = ingestBundle(bundle).record.nodes.find(node => node.id === 'opencode:overlap').nativeUsage
  assert.equal(overlap.calls, 1)
  assert.equal(overlap.sources.length, 2)
  assert.equal(overlap.responses.length, 1)
  assert.equal(ingestBundle(bundle).json, ingestBundle(bundle).json)
  trajectory.messages[0].data.tokens.input = 1
  writeFileSync(join(bundle, 'oc/second.json'), JSON.stringify(trajectory))
  const conflict = ingestBundle(bundle).record.nodes.find(node => node.id === 'opencode:overlap').nativeUsage
  assert.equal(conflict.complete, false)
  assert.equal(conflict.calls, null)
  writeFileSync(join(bundle, 'oc/first.json'), JSON.stringify({ session: { id: 'owned' }, messages: [], parts: [] }))
  writeBundle([{ path: 'oc/first.json', harness: 'opencode' }])
  assert.equal(ingestBundle(bundle).record.nodes[0].nativeUsage.calls, 0)
})

// Discovery magnetar-rust-sandbox-20261031b (Runtime 3, Codex on a Tangle Sandbox): no `spawned` line names the run's root,
// `<run>:s0` is spawned with no parent, the root's own attempts and meters carry the run id, and root-stream.jsonl holds its
// tool calls (302 on 31b; the run page read "— tool calls"). A worker aborted when its caller completed settles with no
// transcript while its recorded stream ran on to a `done` carrying the session's usage (s1:s0: 16.5M input tokens).
test('a root its journal never spawns owns its events and root stream; a settled worker keeps its recorded stream', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'converter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = join(root, 'run-r')
  const file = (path, text) => {
    mkdirSync(dirname(join(run, path)), { recursive: true })
    writeFileSync(join(run, path), text)
  }
  file('run-input.json', JSON.stringify({ task: { objective: 'fixture' }, profile: { harness: 'codex', model: { provider: 'openai', default: 'gpt-6.1-sol' } } }))
  file('result.json', JSON.stringify({ kind: 'stopped' }))
  const error = 'retained provider execution lost its transport; status in doubt: caused by ServerError: HTTP 500: materializeProfileFileMounts'
  file('spawn-journal.jsonl', jsonl([
    { kind: 'event', root: 'run-r/run-r:s0', event: { kind: 'spawned', id: 'run-r:s0', parent: null, label: 'prover-rate', at: '2026-10-31T02:09:00.000Z' } },
    { kind: 'event', root: 'run-r', event: { kind: 'root-reentered', id: 'run-r', live: ['run-r:s0'], replaced: ['run-r:s0'], at: '2026-10-31T02:41:35.204Z' } },
    { kind: 'event', root: 'run-r', event: { kind: 'driver-attempt', id: 'run-r', record: { attempt: 2, durationMs: 11571, error, classification: 'transient' }, at: '2026-10-31T02:58:31.492Z' } },
    { kind: 'event', root: 'run-r', event: { kind: 'metered', id: 'run-r', spend: { iterations: 0, tokens: { input: 0, output: 0 }, tokensKnown: false }, at: '2026-10-31T02:58:30.964Z' } },
    { kind: 'event', root: 'run-r/run-r:s0', event: { kind: 'settled', id: 'run-r:s0', status: 'down', reason: 'driver completed', failure: { code: 'aborted', owner: 'caller', cause: 'driver completed' }, spent: { iterations: 0, tokens: { input: 0, output: 0 }, tokensKnown: false }, at: '2026-10-31T02:19:36.468Z' } },
  ]))
  file('root-stream.jsonl', jsonl([
    { seq: 1, at: '2026-10-31T02:06:20.609Z', attempt: 1, event: { kind: 'text_delta', text: 'Reading the commission first.' } },
    { seq: 2, at: '2026-10-31T02:06:22.161Z', attempt: 1, event: { kind: 'tool_call', toolName: 'bash', toolCallId: 'item_1', args: { command: '/bin/bash -lc pwd' } } },
    { seq: 3, at: '2026-10-31T02:06:22.224Z', attempt: 1, event: { kind: 'tool_result', toolName: 'bash', toolCallId: 'item_1', result: { output: '/home/agent/workspace' } } },
    { seq: 4, at: '2026-10-31T02:06:25.000Z', attempt: 1, event: { kind: 'tool_call', toolName: 'mcp__agent-runtime-coordination__spawn_worker', toolCallId: 'item_2', args: { key: 'rate' } } },
  ]))
  const frame = (id, at, type, data) => ({ id, type, data: { type, ...data, sandboxId: 'sandbox-0123456789ab' }, at })
  const usage = { inputTokens: 16501830, outputTokens: 68742, reasoningTokens: 30302, cacheReadInputTokens: 16240896 }
  file(`evidence/live-stream/${encodeURIComponent('run-r:s0')}/retained-execution-a.jsonl`, jsonl([
    { id: '1', type: 'execution.started', data: { executionId: 'exec-1', effectiveBackend: { model: 'gpt-6.1-sol', source: 'profile' } }, at: '2026-10-31T02:13:36.155Z' },
    frame('2', '2026-10-31T02:13:40.000Z', 'message.updated', { properties: { info: { id: 'retained-execution-a', role: 'assistant', sessionID: 'retained-session-a' } } }),
    frame('3', '2026-10-31T02:13:41.050Z', 'message.part.updated', { part: { id: 'item_1', sessionID: 'retained-session-a', messageID: 'retained-execution-a', type: 'tool', callID: 'item_1', tool: 'bash',
      state: { status: 'completed', input: { command: '/bin/bash -lc pwd' }, output: '/home/agent/workspace\n', time: { start: Date.parse('2026-10-31T02:13:40.922Z'), end: Date.parse('2026-10-31T02:13:41.024Z') } } } }),
    { id: '4', type: 'done', data: { outcome: { type: 'completed' }, tokenUsage: usage }, at: '2026-10-31T02:41:40.069Z' },
  ]))
  // The root's output parts hold a lossy final state of the same turn (31b: 150 of its 302 tool calls); the stream wins.
  const parts = JSON.stringify({ events: [{ id: '1', type: 'message.part.updated', data: { part: { id: 'item_1', type: 'tool', tool: 'bash', callID: 'item_1',
    state: { status: 'completed', input: { command: '/bin/bash -lc pwd' }, output: '/home/agent/workspace', time: { start: Date.parse('2026-10-31T02:06:22.161Z'), end: Date.parse('2026-10-31T02:06:22.224Z') } } } } }] })
  file(`blobs/sha256-${sha(parts)}.json`, parts)
  file('spawn-journal.jsonl', readFileSync(join(run, 'spawn-journal.jsonl'), 'utf8') + jsonl([
    { kind: 'event', root: 'run-r', event: { kind: 'execution-result', id: 'run-r', outRef: `sha256:${sha(parts)}`, at: '2026-10-31T02:43:19.240Z' } }]))
  const record = ingestRun(run, { runId: 'run-r' }).record
  const head = record.nodes.find((node) => node.id === 'run-r')
  assert.equal(head?.role, 'root')
  assert.equal(record.nodes.find((node) => node.id === 'run-r:s0').parent, 'run-r')
  assert.equal(head.capture.channel, 'root')
  const own = record.events.filter((event) => event.node === 'run-r')
  assert.equal(own.filter((event) => event.kind === 'message' && event.detail.publicToolCalls).length, 2, "the root stream's tool calls")
  const results = own.filter((event) => event.kind === 'tool-result')
  assert.deepEqual(results.map((event) => event.detail.durationMs), [63], 'a result is timed from its own call row')
  assert.ok(own.some((event) => event.source.path === 'spawn-journal.jsonl'), "the root's own journal events are its own")
  const worker = record.nodes.find((node) => node.id === 'run-r:s0')
  assert.deepEqual(worker.capture, { channel: 'live', status: 'lossy', reason: 'live-stream-after-settle' })
  const recorded = record.events.filter((event) => event.node === 'run-r:s0' && event.source.path.startsWith('evidence/live-stream/'))
  assert.equal(recorded.filter((event) => event.kind === 'tool-result').length, 1)
  assert.ok(recorded.some((event) => event.detail.usageScope === 'execution-total' && event.detail.usage?.input === 16501830 - 16240896 && event.detail.usage?.cacheRead === 16240896),
    "the session's own usage, input fresh of its cache reads as every record counts it")
})
