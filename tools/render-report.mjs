#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve, dirname, basename, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement, StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { ResearchReport } from '../dist/index.js'
import { parseResearchReport, reportToLatex } from '../dist/report.js'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const htmlText = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  )

/** Pure rendering: the caller owns source collection, permissions, retention, and publication. */
export function renderReportHtml(report, { css, script }) {
  const data = JSON.stringify(report)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  const executable = script.replace(/<\/script/gi, '<\\/script')
  const scriptHash = createHash('sha256').update(executable).digest('base64')
  const body = renderToString(
    createElement(
      StrictMode,
      null,
      createElement(ResearchReport, { report }),
    ),
  )
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-' +
    scriptHash +
    "'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'\">" +
    '<title>' +
    htmlText(report.title) +
    '</title><style>html{background:#fffefa;color:#252522}body{margin:0 auto;max-width:1440px;padding:24px} @media(max-width:600px){body{padding:12px}} @media(prefers-color-scheme:dark){html{background:#12101f;color:#e8e5ef}}' +
    css +
    '</style></head><body><main id="research-report">' +
    body +
    '</main><script id="research-report-data" type="application/json">' +
    data +
    '</script><script>' +
    executable +
    '</script></body></html>\n'
  )
}

export async function renderReportFile(input, output) {
  const report = parseResearchReport(
    JSON.parse(await readFile(input, 'utf8')),
  )
  const [css, script] = await Promise.all([
    readFile(join(packageRoot, 'dist/styles.css'), 'utf8'),
    readFile(join(packageRoot, 'dist/report-viewer.js'), 'utf8'),
  ])
  const tex = resolve(
    dirname(output),
    basename(output, extname(output)) + '.tex',
  )
  if (resolve(input) === resolve(output) || resolve(input) === tex)
    throw new Error('Output must not overwrite the input report')
  await writeFile(output, renderReportHtml(report, { css, script }), {
    mode: 0o600,
  })
  await writeFile(tex, reportToLatex(report), { mode: 0o600 })
  return {
    html: resolve(output),
    latex: tex,
    plays: report.plays.length,
    generatedAt: report.generatedAt,
  }
}

const entryPath = process.argv[1]
  ? await realpath(resolve(process.argv[1])).catch(() => null)
  : null
if (entryPath && pathToFileURL(entryPath).href === import.meta.url) {
  const [input, output, extra] = process.argv.slice(2)
  if (!input || !output || extra) {
    console.error('Usage: agent-record-report REPORT.json OUTPUT.html')
    process.exitCode = 2
  } else {
    try {
      console.log(JSON.stringify(await renderReportFile(input, output)))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
