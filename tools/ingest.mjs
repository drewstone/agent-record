#!/usr/bin/env node
// node tools/ingest.mjs <runDir> --out <file> [--native <dir>] [--max-text 16384]
// Writes <file> and <file>.gz, prints one JSON summary line. Exit 2: unreadable run; 3: record over 128 MiB.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ingestRun } from '../dist/agent-runtime.js'

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
const runDir = args[0]
if (!runDir || !out || args.length !== 1) {
  process.stderr.write('usage: ingest <runDir> --out <file> [--native <dir>] [--max-text 16384]\n')
  process.exit(64)
}
try {
  const { json, summary } = ingestRun(runDir, { native, maxText: maxText ? Number(maxText) : undefined })
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
