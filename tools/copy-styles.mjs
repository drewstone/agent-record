import { copyFile, readFile, writeFile } from 'node:fs/promises'
await copyFile('src/styles.css', 'dist/styles.css')
// Bundlers may discard the entry directive. Keep the distributed React entry explicit for RSC hosts.
const entry = await readFile('dist/index.js', 'utf8')
await writeFile('dist/index.js', `'use client'\n${entry}`)
