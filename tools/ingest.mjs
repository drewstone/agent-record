#!/usr/bin/env node
// node tools/ingest.mjs <dir> --out <file> [--run-id <id>] [--manifest <snapshot.json>] [--native <dir>] [--max-text 16384]
// <dir> is an agent-runtime run directory, or a bundle directory holding bundle.json (agent-record.bundle.v1).
// With --manifest (the evidence store's snapshot manifest) every file is verified against it first and the run id
// comes from --run-id or the manifest. Writes <file> and <file>.gz, prints one JSON summary line.
// Exit 2: unreadable input; 3: record over 128 MiB; 4: the directory differs from its manifest, or an anchor repeats.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ingestBundle, ingestRun } from '../dist/agent-runtime.js'

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
const dir = args[0]
if (!dir || !out || args.length !== 1) {
  process.stderr.write('usage: ingest <dir> --out <file> [--run-id <id>] [--manifest <snapshot.json>] [--native <dir>] [--max-text 16384]\n')
  process.exit(64)
}
try {
  let manifest
  let manifestSha256
  if (manifestPath) {
    const bytes = readFileSync(manifestPath)
    manifest = JSON.parse(bytes.toString('utf8'))
    manifestSha256 = createHash('sha256').update(bytes).digest('hex')
  }
  const options = { native, maxText: maxText ? Number(maxText) : undefined, manifest, manifestSha256 }
  const bundle = existsSync(join(dir, 'bundle.json'))
  // A bundle names its own recordId; --run-id may repeat it (a publisher passes the record id either way), never differ.
  const recordId = bundle ? JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8')).recordId : null
  if (bundle && runId && runId !== recordId) throw Object.assign(new Error(`--run-id ${runId} differs from the bundle's recordId ${recordId}`), { exitCode: 64 })
  const { json, summary } = bundle ? ingestBundle(dir, options) : ingestRun(dir, { ...options, runId })
  mkdirSync(dirname(out), { recursive: true })
  // Write beside the target and rename so readers never see a partial record.
  writeFileSync(out + '.tmp', json)
  writeFileSync(out + '.gz.tmp', gzipSync(json, { level: 9 }))
  renameSync(out + '.tmp', out)
  renameSync(out + '.gz.tmp', out + '.gz')
  process.stdout.write(JSON.stringify(summary) + '\n')
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1)
}
