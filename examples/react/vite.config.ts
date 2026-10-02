import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: process.env.PUBLIC_BASE || '/',
  plugins: [react()],
  build: { outDir: '../../dist-example', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4371, strictPort: true },
})
