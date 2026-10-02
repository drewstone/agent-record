import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { ResearchReport } from './ResearchReport.js'
import { parseResearchReport } from './report.js'

const container = document.getElementById('research-report')
const data = document.getElementById('research-report-data')
if (container && data) {
  const report = parseResearchReport(JSON.parse(data.textContent ?? 'null'))
  hydrateRoot(
    container,
    <StrictMode>
      <ResearchReport report={report} />
    </StrictMode>,
  )
}
