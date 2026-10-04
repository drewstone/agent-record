import { parseReportOptions, type ReportOptions } from './report-options.js'
import type { RecordSelection } from './record.js'
import type { ResearchView } from './report-selection.js'
import { StrictMode, useEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { ResearchReport } from './ResearchReport.js'
import { parseResearchReport, type ResearchReportData } from './report.js'
import { readReportLocation, reportLocationSearch, type ResearchDocumentSelection } from './report-selection.js'

function StandaloneReport({ report, options }: { report: ResearchReportData; options: ReportOptions }) {
  // Match the static server markup first, then apply the browser's citation.
  const [search, setSearch] = useState('')
  useEffect(() => {
    const changed = () => setSearch(window.location.search)
    changed()
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  const selection = readReportLocation(report, search)
  function remember(playId: string, document?: ResearchDocumentSelection, view?: ResearchView, activity?: RecordSelection) {
    const next = reportLocationSearch(window.location.search, playId, document, view, activity)
    if (next !== window.location.search) window.history.pushState(null, '', window.location.pathname + next)
  }
  if (selection.error) return <main><h1>Source citation unavailable</h1><p role="alert">{selection.error}</p><a href={window.location.pathname}>Open the report</a></main>
  return <ResearchReport key={search} report={report} defaultPlayId={selection.playId}
    defaultView={selection.view} defaultActivitySelection={selection.activity}
    onActivityChange={(playId, activity) => remember(playId, undefined, 'activity', activity)} sourceSearchEndpoint={options.sourceSearchEndpoint}
    defaultDocumentSelection={selection.document} onPlayChange={playId => { remember(playId); setSearch(window.location.search) }}
    onViewChange={view => remember(new URLSearchParams(window.location.search).get('play') ?? report.plays[0]!.id, undefined, view)}
    onDocumentChange={document => remember(document.playId, document)} />
}

const container = document.getElementById('research-report')
const data = document.getElementById('research-report-data')
if (container && data) {
  const report = parseResearchReport(JSON.parse(data.textContent ?? 'null'))
  hydrateRoot(container, <StrictMode><StandaloneReport report={report} options={parseReportOptions(JSON.parse(document.getElementById('research-report-options')?.textContent ?? '{}'))} /></StrictMode>)
}
