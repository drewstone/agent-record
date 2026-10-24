import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

// Self-contained browser bundles: the offline research report and the run workspace viewer.
for (const [entry, name, fileName] of [
  ['src/standalone.tsx', 'AgentResearchReport', 'report-viewer.js'],
  ['src/workspace-standalone.tsx', 'AgentWorkspace', 'workspace-viewer.js'],
])
  await build({
    configFile: false,
    plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'warn',
    build: {
      emptyOutDir: false,
      lib: { entry, formats: ['iife'], name, fileName: () => fileName },
    },
  })

// One producer binds a preview or release to its actual source and built assets.
const gitIdentity = (revision) => {
  try { return execFileSync('git', ['rev-parse', revision], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}
const files = Object.fromEntries(await Promise.all(['workspace-viewer.js', 'report-viewer.js', 'styles.css'].map(async (file) => {
  const bytes = await readFile(`dist/${file}`)
  return [file, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
})))
await writeFile('dist/build-provenance.json', JSON.stringify({ schema: 'agent-record.build.v1',
  commit: gitIdentity('HEAD'), tree: gitIdentity('HEAD^{tree}'), files }, null, 2) + '\n')
