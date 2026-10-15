import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const sourceCss = await readFile('src/styles.css', 'utf8')
let distributedCss = sourceCss
for (const name of ['react/live.css', 'figure.css']) {
  const specifier = `@tangle-network/charts/${name}`
  const css = await readFile(fileURLToPath(import.meta.resolve(specifier)), 'utf8')
  const directive = `@import '${specifier}';`
  if (!distributedCss.includes(directive)) throw new Error(`Missing shared chart CSS import: ${specifier}`)
  distributedCss = distributedCss.replace(directive, css)
}
await writeFile('dist/styles.css', distributedCss)
// Bundlers may discard the entry directive. Keep the distributed React entry explicit for RSC hosts.
const entry = await readFile('dist/index.js', 'utf8')
await writeFile('dist/index.js', `'use client'\n${entry}`)
