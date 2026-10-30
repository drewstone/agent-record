// PRIVATE native public-CLI differential; every input is synthetic, no network/model/service access.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { getHeapStatistics } from 'node:v8'

assert.ok(process.argv[2] && process.argv[3], 'pass baseline08a/tools/ingest.mjs and fixed/tools/ingest.mjs')
const beforeCli = resolve(process.argv[2]), afterCli = resolve(process.argv[3])
const root = await mkdtemp(join(tmpdir(), 'parts-big-source-'))
const evidence = await mkdtemp(join(tmpdir(), 'parts-big-evidence-'))
const started = performance.now(), at = '2026-10-01T00:00:00.000Z', runId = 'memory-large-live'
const live = `evidence/live-stream/${encodeURIComponent(`${runId}:s0`)}/retained-execution-fixture.jsonl`
const line = `${JSON.stringify({ type: 'message.part.updated', data: { part: { id: 'part-memory', messageID: 'message-memory', type: 'text', text: 'synthetic bounded final part', time: { start: Date.parse(at) } } } })}\n`
const log = row => process.stdout.write(`${JSON.stringify(row)}\n`)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

async function input(targetBytes) {
  const run = join(root, runId), path = join(run, live)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(join(run, 'run-input.json'), JSON.stringify({ runId, task: { objective: 'Synthetic records memory boundary.' }, profile: { name: 'memory-probe', harness: 'codex', model: { default: 'fixture' } } }))
  const spawned = id => ({ kind: 'event', root: runId, event: { kind: 'spawned', id, at, label: id === runId ? 'root' : 'worker', runtime: 'tangle-sandbox' } })
  await writeFile(join(run, 'spawn-journal.jsonl'), [spawned(runId), spawned(`${runId}:s0`)].map(JSON.stringify).join('\n') + '\n')
  await writeFile(join(run, 'result.json'), JSON.stringify({ kind: 'no-winner', reason: 'synthetic-input-only' }))
  const rows = Math.floor(targetBytes / Buffer.byteLength(line)), blockRows = 4096
  const block = Buffer.from(line.repeat(blockRows)), file = await open(path, 'w'), digest = createHash('sha256')
  try {
    for (let remaining = rows; remaining > 0; remaining -= blockRows) {
      const bytes = remaining >= blockRows ? block : Buffer.from(line.repeat(remaining))
      digest.update(bytes); await file.writeFile(bytes)
    }
  } finally { await file.close() }
  return { run, sourceRows: rows, sourceBytes: rows * Buffer.byteLength(line), sourceSha256: digest.digest('hex') }
}

async function rss(pid) {
  try { return Number(/^VmRSS:\s+(\d+) kB$/m.exec(await readFile(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024 }
  catch { return null }
}

async function convert(cli, data, label) {
  const output = join(evidence, `${label}.json`), observation = { peakRssBytes: null, peakHeapBytes: null, stdoutTail: '', stderrTail: '', logBytes: 0, stop: null }
  const stdout = createWriteStream(join(evidence, `${label}.stdout.log`)), stderr = createWriteStream(join(evidence, `${label}.stderr.log`))
  const child = spawn('bash', ['-c', 'ulimit -c 0; exec "$@"', 'parts-big-probe', process.execPath, '--trace-gc-nvp', cli, data.run, '--out', output, '--run-id', runId],
    { env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), LANG: 'C.UTF-8', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const began = performance.now()
  for (const [stream, writer, key] of [[child.stdout, stdout, 'stdoutTail'], [child.stderr, stderr, 'stderrTail']]) {
    stream.pipe(writer)
    stream.on('data', bytes => {
      const text = String(bytes)
      observation[key] = (observation[key] + text).slice(-128 * 1024); observation.logBytes += bytes.length
      for (const match of text.matchAll(/(?:start_object_size|total_size_before)=(\d+)/g)) observation.peakHeapBytes = Math.max(observation.peakHeapBytes ?? 0, Number(match[1]))
      if (observation.logBytes > 16 * 1024 ** 2) observation.stop = 'private-log-byte-stop'
    })
  }
  let ended = false
  const terminal = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { ended = true; resolve({ code, signal }) }) })
  while (!ended) {
    const current = await rss(child.pid)
    if (current !== null) observation.peakRssBytes = Math.max(observation.peakRssBytes ?? 0, current)
    if (current > 6 * 1024 ** 3) observation.stop = 'private-rss-stop'
    if (performance.now() - began > 90_000 || performance.now() - started > 210_000) observation.stop = 'private-deadline'
    if (observation.stop) { child.kill('SIGTERM'); await Promise.race([terminal, pause(1000)]); if (!ended) child.kill('SIGKILL') }
    await Promise.race([terminal, pause(100)])
  }
  const exit = await terminal
  await Promise.all([finished(stdout), finished(stderr)])
  const json = observation.stdoutTail.split('\n').filter(text => text.startsWith('{')).flatMap(text => { try { return [JSON.parse(text)] } catch { return [] } })
  const result = { label, cli, ...exit, stop: observation.stop, ms: Math.round(performance.now() - began),
    peakRssBytes: observation.peakRssBytes, peakHeapBytes: observation.peakHeapBytes, summary: json.at(-1) ?? null,
    fatal: /heap out of memory|Reached heap limit/.test(observation.stderrTail), logBytes: observation.logBytes, output }
  await writeFile(join(evidence, `${label}.metrics.json`), JSON.stringify(result, null, 2) + '\n')
  log(result)
  return result
}

async function bytesOf(result) {
  assert.equal(result.code, 0, `${result.label}: ${result.signal ?? result.stop ?? 'failed'}`)
  const bytes = await readFile(result.output)
  assert.equal(result.summary.recordDigest, sha(bytes))
  return bytes
}

try {
  await mkdir(join(root, 'tmp')); await mkdir(join(root, 'home'))
  log({ case: 'identity', node: process.version, heapLimit: getHeapStatistics().heap_size_limit, evidence, childCoreLimitBytes: 0,
    deadlinePerChildMs: 90_000, totalDeadlineMs: 210_000, rssStopBytes: 6 * 1024 ** 3, rawLogStopBytes: 16 * 1024 ** 2 })
  const small = await input(8 * 1024 ** 2)
  const beforeSmall = await convert(beforeCli, small, 'before-small'), afterSmall = await convert(afterCli, small, 'after-small')
  assert.deepEqual(await bytesOf(afterSmall), await bytesOf(beforeSmall), 'same08a producer: exact ordinary-small bytes')
  const large = await input(1_294_927_928)
  log({ case: 'large-source', ...large, expectedFinalParts: 1 })
  const before = await convert(beforeCli, large, 'before-large')
  assert.equal(before.fatal, true, 'preserve a real default-heap RED; resource-stop/other failure is not OOM evidence')
  assert.equal(before.stop, null)
  const after = await convert(afterCli, large, 'after-large'), bytes = await bytesOf(after), record = JSON.parse(bytes)
  const final = record.events.filter(event => event.node === `${runId}:s0` && event.kind === 'message')
  assert.equal(final.length, 1); assert.equal(final[0].source.line, large.sourceRows)
  assert.equal(final[0].source.sha256, large.sourceSha256)
  assert.equal(final[0].detail.publicText, 'synthetic bounded final part')
  const source = record.sources.find(source => source.path === live && source.line === undefined && source.pointer === undefined)
  assert.equal(source.sha256, large.sourceSha256); assert.equal(source.bytes, large.sourceBytes)
  const result = { case: 'proof', sourceBytes: large.sourceBytes, sourceRows: large.sourceRows, outputBytes: bytes.length,
    recordDigest: sha(bytes), before: { code: before.code, signal: before.signal, ms: before.ms, rss: before.peakRssBytes, heap: before.peakHeapBytes },
    after: { code: after.code, signal: after.signal, ms: after.ms, rss: after.peakRssBytes, heap: after.peakHeapBytes }, evidence }
  await writeFile(join(evidence, 'proof.json'), JSON.stringify(result, null, 2) + '\n'); log(result)
} finally {
  await rm(root, { recursive: true, force: true })
  log({ case: 'cleanup', scratchRemoved: true, evidenceRetained: evidence, files: ['before-small.stdout.log', 'before-small.stderr.log', 'before-large.stdout.log', 'before-large.stderr.log', 'after-large.stdout.log', 'after-large.stderr.log', 'proof.json'] })
}
