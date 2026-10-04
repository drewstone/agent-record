import { build } from 'vite'
import react from '@vitejs/plugin-react'

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
