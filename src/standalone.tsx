import { StrictMode, useEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { ResearchReport } from './ResearchReport.js'
import { parseResearchReport, type ResearchReportData } from './report.js'
import { readReportLocation, reportLocationSearch, type ResearchDocumentSelection } from './report-selection.js'

function StandaloneReport({ report }: { report: ResearchReportData }) {
  // Match the static server markup first, then apply the browser's citation.
  const [search, setSearch] = useState('')
  useEffect(() => {
    const changed = () => setSearch(window.location.search)
    changed()
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  const selection = readReportLocation(report, search)
  function remember(playId: string, document?: ResearchDocumentSelection) {
    window.history.replaceState(null, '', window.location.pathname + reportLocationSearch(window.location.search, playId, document))
  }
  if (selection.error) return <main><h1>Source citation unavailable</h1><p role="alert">{selection.error}</p><a href={window.location.pathname}>Open the report</a></main>
  return <ResearchReport key={search} report={report} defaultPlayId={selection.playId}
    defaultDocumentSelection={selection.document} onPlayChange={playId => remember(playId)}
    onDocumentChange={document => remember(document.playId, document)} />
}

const container = document.getElementById('research-report')
const data = document.getElementById('research-report-data')
if (container && data) {
  const report = parseResearchReport(JSON.parse(data.textContent ?? 'null'))
  hydrateRoot(container, <StrictMode><StandaloneReport report={report} /></StrictMode>)
}
