// This repository is public. Evidence screenshots and recordings belong in private storage, and tailnet addresses
// stay off it: every tracked file is checked, so a capture or an address committed by mistake fails the release checks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|webm|mp4|mov|mkv|avi)$/i
// Tailscale assigns IPs from the CGNAT block (100.x with a second octet of 64 to 127) and MagicDNS names under ts.net.
const TAILNET = /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b|\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/i

test('no screenshot or recording is committed under docs/evidence', () => {
  assert.deepEqual(tracked.filter((path) => path.startsWith('docs/evidence/') && MEDIA.test(path)), [])
})

test('no tracked text file names a tailnet address', () => {
  const hits = tracked.flatMap((path) => {
    const file = `${root}/${path}`
    if (!existsSync(file)) return []
    const bytes = readFileSync(file)
    if (bytes.includes(0)) return []
    const match = bytes.toString('utf8').match(TAILNET)
    return match ? [`${path}: ${match[0]}`] : []
  })
  assert.deepEqual(hits, [])
})
