import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'

test('the public workspace asset and stylesheet carry the standalone graph styles', async () => {
  const require = createRequire(import.meta.url)
  const viewer = require.resolve('@drewstone/agent-record/workspace-viewer.js')
  const styles = require.resolve('@drewstone/agent-record/styles.css')
  assert.ok((await stat(viewer)).size > 0)
  const css = await readFile(styles, 'utf8')
  assert.match(css, /\.react-flow__node\s*\{[^}]*position:\s*absolute/)
  assert.match(css, /\.xterm/)
})
