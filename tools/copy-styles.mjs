import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const sourceCss = await readFile('src/styles.css', 'utf8')
let distributedCss = sourceCss
for (const specifier of ['@tangle-network/sandbox-ui/styles', '@tangle-network/charts/react/agent-graph.css', '@tangle-network/charts/react/live.css', '@tangle-network/charts/figure.css', '@tangle-network/charts/react/flow-waterfall.css']) {
  const css = await readFile(fileURLToPath(import.meta.resolve(specifier)), 'utf8')
  const directive = `@import '${specifier}';`
  if (!distributedCss.includes(directive)) throw new Error(`Missing shared CSS import: ${specifier}`)
  distributedCss = distributedCss.replace(directive, css)
}
// The shared page system (run page, Today, the wall pages' controls) is its own file beside the component that owns it.
const viewerCss = await Promise.all((await readdir('dist/viewer')).filter((file) => file.endsWith('.css')).sort().map((file) => readFile(`dist/viewer/${file}`, 'utf8')))
await writeFile('dist/styles.css', `${distributedCss}\n${await readFile('src/workspace/run/run.css', 'utf8')}\n${viewerCss.join('\n')}`)
// Bundlers may discard the entry directive. Keep the distributed React entry explicit for RSC hosts.
const entry = await readFile('dist/index.js', 'utf8')
await writeFile('dist/index.js', `'use client'\n${entry}`)
