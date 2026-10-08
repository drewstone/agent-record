import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const sourceCss = await readFile('src/styles.css', 'utf8')
const chartCss = await readFile(fileURLToPath(import.meta.resolve('@tangle-network/charts/react/live.css')), 'utf8')
const chartImport = "@import '@tangle-network/charts/react/live.css';"
if (!sourceCss.startsWith(chartImport)) throw new Error('Shared chart CSS import must be first')
await writeFile('dist/styles.css', sourceCss.replace(chartImport, chartCss))
// Bundlers may discard the entry directive. Keep the distributed React entry explicit for RSC hosts.
const entry = await readFile('dist/index.js', 'utf8')
await writeFile('dist/index.js', `'use client'\n${entry}`)
