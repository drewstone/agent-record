// Private native proof: two real public converter CLIs over exactly the same filesystem bytes.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const beforeCli = resolve(process.argv[2] ?? '')
const afterCli = resolve(process.argv[3] ?? fileURLToPath(new URL('../../tools/ingest.mjs', import.meta.url)))
assert.ok(process.argv[2], 'pass the baseline08a public tools/ingest.mjs path')
const root = await mkdtemp(join(tmpdir(), 'runtime-parts-bytes-'))
const at = '2026-10-01T00:00:00.000Z', time = Date.parse(at), runId = 'parts-byte-probe'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const put = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }

function events(known) {
  const part = (id, type, fields) => ({ type: 'message.part.updated', data: { part: { id, messageID: 'm', type, ...fields } } })
  return [null, { type: 'message.updated', data: { info: { id: 'm', role: 'assistant' } } },
    part('text', 'text', { text: 'superseded', time: { start: time } }),
    part('tool', 'tool', { tool: 'fixture_command', callID: 'c', state: { status: 'running', input: { command: 'inert fixture text' }, time: { start: time } } }),
    part('text', 'text', { text: '終é\n'.repeat(20_000), time: { start: time + 1000 } }),
    part('tool', 'tool', { tool: 'fixture_command', callID: 'c', state: { status: 'completed', input: { command: 'inert fixture text' }, output: 'output-é\n'.repeat(10_000), time: { start: time, end: time + 2000 } } }),
    { type: 'raw', data: { event: { type: 'item.completed', item: { id: 'item', type: 'command_execution', command: 'inert fixture', aggregated_output: 'old' } } } },
    { type: 'raw', data: { event: { type: 'item.completed', item: { id: 'item', type: 'command_execution', command: 'inert fixture', aggregated_output: 'new-é\n'.repeat(10_000), exit_code: 1 } } } },
    { type: 'raw', data: { event: { role: 'tool', tool_call_id: 'orphan', content: [{ type: 'text', text: 'retained result' }] } } },
    { type: 'raw', data: { event: { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'fiveHour', unifiedWindows: { fiveHour: { utilization: 0 } }, status: 'allowed' } } } },
    { type: 'result', data: { outcome: { type: 'failed', error: 'fixture failure' } } },
    { type: 'done', data: { tokensKnown: known, effectiveBackend: { model: 'fixture-model' } }, usage: { inputTokens: known ? 10 : 0, outputTokens: known ? 2 : 0, cost: 0 } },
  ]
}

async function fixture() {
  const run = join(root, 'run'), liveNode = `${runId}:s0`, blobNode = `${runId}:s1`
  const files = new Map(), input = { runId, task: { objective: 'Byte and anchor parity over synthetic public events.' } }
  files.set('run-input.json', Buffer.from(JSON.stringify(input)))
  const blob = Buffer.from(JSON.stringify({ events: events(true) })), hex = sha(blob)
  files.set(`blobs/sha256-${hex}.json`, blob)
  const spawned = id => ({ kind: 'event', root: runId, event: { kind: 'spawned', id, at, runtime: 'tangle-sandbox' } })
  const journal = [spawned(runId), spawned(liveNode), spawned(blobNode), { kind: 'event', root: runId, event: { kind: 'settled', id: blobNode, at, status: 'done', outRef: `sha256:${hex}` } }]
  files.set('spawn-journal.jsonl', Buffer.from(journal.map(JSON.stringify).join('\n') + '\n'))
  files.set('result.json', Buffer.from(JSON.stringify({ kind: 'no-winner', reason: 'fixture only' })))
  const path = `evidence/live-stream/${encodeURIComponent(liveNode)}/session.jsonl`
  const physical = ['', '{invalid', ...events(false).map(JSON.stringify), '', '{torn']
  files.set(path, Buffer.from(physical.join('\r\n')))
  for (const [path, bytes] of files) await put(join(run, path), bytes)
  const manifest = join(root, 'manifest.json')
  await put(manifest, JSON.stringify({ schema: 'evidence.snapshot.v1', runId, files: [...files].map(([path, bytes]) => ({ path, sha256: `sha256:${sha(bytes)}`, bytes: bytes.length, mtime: at })) }))
  return { run, files, manifest, liveNode, blobNode }
}

function convert(cli, fixture, name) {
  const output = join(root, `${name}.json`)
  const result = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$@"', 'parts-byte-probe', process.execPath, cli, fixture.run, '--out', output, '--run-id', runId, '--manifest', fixture.manifest],
    { encoding: 'utf8', timeout: 90_000, maxBuffer: 1 << 20, env: { PATH: process.env.PATH, HOME: join(root, 'home'), LANG: 'C.UTF-8', TZ: 'UTC' } })
  assert.equal(result.status, 0, `${name}: ${result.signal ?? ''} ${result.stderr}`)
  return output
}

function verifySources(record, files) {
  for (const source of record.sources) {
    const bytes = files.get(source.path)
    assert.ok(bytes, source.path)
    let body = bytes
    if (source.line !== undefined) body = Buffer.from(bytes.toString('utf8').split('\n')[source.line - 1].replace(/\r$/, ''))
    if (source.pointer !== undefined) {
      let value = JSON.parse(bytes)
      for (const key of source.pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) value = value[key]
      body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
    }
    assert.equal(source.sha256, sha(body), `${source.path}:${source.line ?? source.pointer ?? 'whole'}`)
  }
  for (const event of record.events) {
    const bytes = files.get(event.source.path)
    assert.ok(bytes, event.source.path)
    assert.equal(event.source.sha256, sha(bytes), event.id)
    if (event.source.line !== undefined) assert.ok(event.source.line > 0)
  }
}

try {
  const data = await fixture(), before = await readFile(convert(beforeCli, data, 'before')), after = await readFile(convert(afterCli, data, 'after'))
  const oldRecord = JSON.parse(before), newRecord = JSON.parse(after)
  assert.equal(oldRecord.producer.version, newRecord.producer.version, 'compare held-constant08a converter version; do not normalize producer drift')
  assert.deepEqual(after, before, 'full uncompressed record bytes, including digests, order, anchors and unknowns')
  verifySources(newRecord, data.files)
  assert.ok(newRecord.events.some(event => event.node === data.blobNode && event.source.pointer?.startsWith('/events/')))
  assert.ok(newRecord.events.some(event => event.node === data.liveNode && event.source.line > 2))
  const clipped = newRecord.events.filter(event => event.detail.clip?.bytes > 0)
  assert.ok(clipped.length > 0, 'retained final text was clipped')
  for (const event of clipped) {
    const full = newRecord.sources.find(source => source.sha256 === event.detail.clip.sha256)
    assert.ok(full, 'each clip resolves to an actual verified source receipt')
    assert.equal(full.path, event.source.path)
    if (event.source.line !== undefined) assert.equal(full.line, event.source.line)
  }
  assert.ok(newRecord.events.filter(event => event.node === data.liveNode).every(event => event.detail.usage === undefined), 'unmetered zero remains unknown')
  console.log(JSON.stringify({ sameBytes: true, digest: sha(after), bytes: after.length, events: newRecord.events.length, sources: newRecord.sources.length, producer: newRecord.producer, cases: ['CRLF', 'blank/invalid/torn rows', 'UTF8 clipping', 'superseded parts', 'tool result', 'codex replacement', 'orphan tool', 'rate-limit zero', 'error', 'known and unknown metering', 'line and JSON-pointer anchors'] }))
} finally { await rm(root, { recursive: true, force: true }) }
