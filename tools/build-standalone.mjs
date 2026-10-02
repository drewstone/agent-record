import { build } from 'vite'
import react from '@vitejs/plugin-react'

await build({
  configFile: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/standalone.tsx',
      formats: ['iife'],
      name: 'AgentResearchReport',
      fileName: () => 'report-viewer.js',
    },
  },
})
