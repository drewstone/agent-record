import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        record: 'src/record.ts',
        report: 'src/report.ts',
        'research-publication': 'src/adapters/research-publication.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'zod'],
    },
  },
})
