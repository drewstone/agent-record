#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve, dirname, basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement, StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { ResearchReport } from '@tangle-network/sandbox-ui/record/ResearchReport'
import { parseResearchReport, reportToLatex, parseReportOptions } from '../dist/report.js'

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
export function renderReportHtml(report, { css, script, sourceSearchEndpoint }) {
  const options = parseReportOptions({ sourceSearchEndpoint })
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
      createElement(ResearchReport, { report, ...options }),
    ),
  )
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-' +
    scriptHash +
    "'; style-src 'unsafe-inline'; img-src data:; connect-src " + (options.sourceSearchEndpoint ? "'self'" : "'none'") + "; base-uri 'none'; form-action 'none'\">" +
    '<title>' +
    htmlText(report.title) +
    '</title><style>html{background:var(--bg-page);color:var(--text-primary)}body{margin:0 auto;max-width:1800px;padding:0}' +
    css +
    '</style></head><body><main id="research-report">' +
    body +
    '</main><script id="research-report-data" type="application/json">' +
    data +
    '</script>' + (options.sourceSearchEndpoint ? '<script id="research-report-options" type="application/json">' + JSON.stringify(options).replace(/</g, '\\u003c') + '</script>' : '') + '<script>' +
    executable +
    '</script></body></html>\n'
  )
}

export async function renderReportFile(input, output, options = {}) {
  const report = parseResearchReport(
    JSON.parse(await readFile(input, 'utf8')),
  )
  const [css, script] = await Promise.all([
    readFile(fileURLToPath(import.meta.resolve('@tangle-network/sandbox-ui/styles')), 'utf8'),
    readFile(fileURLToPath(import.meta.resolve('@tangle-network/sandbox-ui/report-viewer.js')), 'utf8'),
  ])
  const tex = resolve(
    dirname(output),
    basename(output, extname(output)) + '.tex',
  )
  if (resolve(input) === resolve(output) || resolve(input) === tex)
    throw new Error('Output must not overwrite the input report')
  await writeFile(output, renderReportHtml(report, { css, script, ...parseReportOptions(options) }), {
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
  const [input, output, flag, endpoint, extra] = process.argv.slice(2)
  if (!input || !output || extra || (flag !== undefined && (flag !== '--source-search-endpoint' || !endpoint))) {
    console.error('Usage: agent-record-report REPORT.json OUTPUT.html [--source-search-endpoint PATH]')
    process.exitCode = 2
  } else {
    try {
      console.log(JSON.stringify(await renderReportFile(input, output, { sourceSearchEndpoint: endpoint })))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
