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
        workspace: 'src/workspace.ts',
        assessment: 'src/assessment.ts',
        'research-publication': 'src/adapters/research-publication.ts',
        'agent-runtime': 'src/adapters/agent-runtime.ts',
        'harness-sessions': 'src/adapters/harness-sessions.ts',
        'trace-spans': 'src/adapters/trace-spans.ts',
        publication: 'src/publication.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      external: [/^node:/, /^@tangle-network\//, 'react', 'react-dom', 'react/jsx-runtime', 'zod', 'react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
    },
  },
})
