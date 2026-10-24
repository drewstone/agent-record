import { build } from 'vite'
import react from '@vitejs/plugin-react'

// Self-contained browser bundles: the offline research report (one IIFE file) and the run workspace viewer, an ES module
// whose heavy parts (the sandbox-ui run workspace: file tree, code and diff views, their grammars) load as chunks under
// dist/viewer/ only when a page opens them, so a page's first paint stays near the old single-file size.
const common = { configFile: false, plugins: [react()], define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'warn' }
await build({ ...common, build: { emptyOutDir: false, lib: { entry: 'src/standalone.tsx', formats: ['iife'], name: 'AgentResearchReport', fileName: () => 'report-viewer.js' } } })
await build({
  ...common,
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/workspace-standalone.tsx', formats: ['es'], fileName: () => 'workspace-viewer.js' },
    rollupOptions: { output: { chunkFileNames: 'viewer/[name]-[hash].js', assetFileNames: 'viewer/[name]-[hash][extname]' } },
  },
})
