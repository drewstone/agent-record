#!/usr/bin/env node
// Native activity: node tools/ingest.mjs <home> --activity --since ISO --out FILE [--audit FILE]
// node tools/ingest.mjs <dir> --out <file> [--run-id <id>] [--manifest <snapshot.json>] [--native <dir>] [--max-text 16384]
// <dir> is an agent-runtime run directory, or a bundle directory holding bundle.json (agent-record.bundle.v1).
// With --manifest (the evidence store's snapshot manifest) every file is verified against it first and the run id
// comes from --run-id or the manifest. Writes <file> and <file>.gz, prints one JSON summary line.
// Exit 2: unreadable input; 3: record over 128 MiB; 4: the directory differs from its manifest, or an anchor repeats.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const started = performance.now()
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}
const out = flag('--out')
const native = flag('--native')
const maxText = flag('--max-text')
const runId = flag('--run-id')
const manifestPath = flag('--manifest')
const activityIndex = args.indexOf('--activity')
const activity = activityIndex >= 0
if (activity) args.splice(activityIndex, 1)
const since = flag('--since')
const auditPath = flag('--audit')
const dir = args[0]
if (!dir || !out || args.length !== 1) {
  process.stderr.write('usage: ingest <dir> --out <file> [--run-id <id>] [--manifest <snapshot.json>] [--native <dir>] [--max-text 16384] | <home> --activity --since ISO --out FILE [--audit FILE]\n')
  process.exit(64)
}
try {
  if (activity && (!since || native || maxText || runId || manifestPath)) throw Object.assign(new Error('--activity requires --since and does not accept run/bundle options'), { exitCode: 64 })
  if (!activity && (since || auditPath)) throw Object.assign(new Error('--since/--audit require --activity'), { exitCode: 64 })
  let manifest
  let manifestSha256
  if (manifestPath) {
    const bytes = readFileSync(manifestPath)
    manifest = JSON.parse(bytes.toString('utf8'))
    manifestSha256 = createHash('sha256').update(bytes).digest('hex')
  }
  const options = { native, maxText: maxText ? Number(maxText) : undefined, manifest, manifestSha256 }
  const bundle = !activity && existsSync(join(dir, 'bundle.json'))
  // A bundle names its own recordId; --run-id may repeat it (a publisher passes the record id either way), never differ.
  const recordId = bundle ? JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8')).recordId : null
  if (bundle && runId && runId !== recordId) throw Object.assign(new Error(`--run-id ${runId} differs from the bundle's recordId ${recordId}`), { exitCode: 64 })
  let json, summary
  if (activity) {
    const { ingestActivity } = await import('./activity/sessions.mjs')
    const record = await ingestActivity(dir, { since, audit: auditPath ? JSON.parse(readFileSync(auditPath, 'utf8')) : undefined })
    json = JSON.stringify(record)
    summary = { schema: record.schema, sessions: record.sessions.length, coverage: record.coverage, ...(record.audit ? { audit: { count: record.audit.count, correct: record.audit.correct, accuracy: record.audit.accuracy } } : {}) }
  } else {
    const { ingestBundle, ingestRun } = await import('../dist/agent-runtime.js')
    ;({ json, summary } = bundle ? ingestBundle(dir, options) : ingestRun(dir, { ...options, runId }))
  }
  mkdirSync(dirname(out), { recursive: true })
  // Write beside the target and rename so readers never see a partial record.
  writeFileSync(out + '.tmp', json, activity ? { mode: 0o600 } : undefined)
  writeFileSync(out + '.gz.tmp', gzipSync(json, { level: activity ? 1 : 9 }), activity ? { mode: 0o600 } : undefined)
  renameSync(out + '.tmp', out)
  renameSync(out + '.gz.tmp', out + '.gz')
  if (activity) summary.exportDurationMs = Math.round(performance.now() - started)
  process.stdout.write(JSON.stringify(summary) + '\n')
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1)
}
