import { build } from 'vite'
import react from '@vitejs/plugin-react'

// Offline research reports retain their existing single-file browser entry.
const common = { configFile: false, plugins: [react()], define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'warn' }
await build({ ...common, build: { emptyOutDir: false, lib: { entry: 'src/standalone.tsx', formats: ['iife'], name: 'AgentResearchReport', fileName: () => 'report-viewer.js' } } })
