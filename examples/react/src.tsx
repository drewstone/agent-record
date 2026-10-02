import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AgentRecord,
  ResearchReport,
  parseResearchReport,
  type ResearchReportData,
  type RecordSelection,
  type RunRecord,
  parseRecord,
} from '@drewstone/agent-record'
import { fromResearchPublication } from '@drewstone/agent-record/adapters/research-publication'
import '@drewstone/agent-record/styles.css'
import './style.css'

const files = [
  'ftqc-zips-2026-08-05-r1',
  'fc-audit-smoke-a',
  'q-conj-entropy-bcww-repair',
  'q-q36-lw6-unbounded-ladder',
  'q-ca-bcww-shareable-pkg',
]
function App() {
  const [records, setRecords] = useState<RunRecord[]>([])
  const [report, setReport] = useState<ResearchReportData>()
  const [surface, setSurface] = useState('report')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto')
  const [second, setSecond] = useState(false)
  const [selection, setSelection] = useState<RecordSelection>()
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(
      files.map(async (id) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}records/${id}.json`,
          { signal: controller.signal },
        )
        if (!response.ok)
          throw new Error(`Could not load ${id}: HTTP ${response.status}`)
        return fromResearchPublication(await response.json())
      }),
    )
      .then(setRecords)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error))
      })
    return () => controller.abort()
  }, [])
  async function load(file?: File) {
    if (!file) return
    try {
      const value: unknown = JSON.parse(await file.text())
      if (
        value &&
        typeof value === 'object' &&
        'schema' in value &&
        value.schema === 'agent-research-report.v1'
      ) {
        setReport(parseResearchReport(value))
        setSurface('report')
        setError('')
        return
      }
      const values = Array.isArray(value) ? value : [value]
      const next = values.map((item) =>
        item?.schema === 'research-publication.events.v1'
          ? fromResearchPublication(item)
          : parseRecord(item),
      )
      if (new Set(next.map((record) => record.runId)).size !== next.length)
        throw new Error('Run IDs must be unique')
      setReport(undefined)
      setRecords(next)
      setSelection(undefined)
      setError('')
    } catch (error) {
      setError(String(error))
    }
  }
  const publicationReport =
    report ??
    (records.length
      ? parseResearchReport({
          schema: 'agent-research-report.v1',
          id: 'reviewed-publication-records',
          title: 'Research claims and their recorded evidence',
          generatedAt: new Date().toISOString(),
          assessmentBy: 'Retained publication annotations',
          summary:
            'Five published research records, with their original claims, assessment notes, and retained execution evidence.',
          limitations: [
            'Recorded claims are presented as unresolved here. Read each publication assessment and its sources; this example performs no new scientific verification.',
            'The original capture is incomplete. Missing events, attribution, and costs remain unknown.',
          ],
          plays: records.map((record) => ({
            id: record.runId,
            title: record.title,
            summary: record.assignment.objective || record.title,
            updatedAt: record.events.reduce<string | null>(
              (latest, event) =>
                !latest || Date.parse(event.at) > Date.parse(latest)
                  ? event.at
                  : latest,
              null,
            ),
            status: record.terminal?.kind ?? null,
            claims: record.events
              .filter((event) => event.detail.recordedClaim)
              .map((event) => ({
                id: event.id,
                statement: event.label,
                status: 'unresolved',
                method: event.detail.assessment,
                limitations:
                  typeof event.detail.authorAttribution === 'string'
                    ? [event.detail.authorAttribution]
                    : [],
                evidence: [
                  {
                    ...event.source,
                    eventId: event.id,
                    label: event.label,
                    excerpt: event.detail.recordedClaim,
                  },
                ],
              })),
            record,
          })),
        })
      : undefined)
  return (
    <main>
      <header className="demo-header">
        <div>
          <h1>Agent Record</h1>
          <p>
            Claims, sources, conversations, and recorded activity in one React
            component.
          </p>
        </div>
        <a href="https://github.com/drewstone/agent-record">GitHub ↗</a>
      </header>
      <div className="demo-controls">
        <label>
          View{' '}
          <select
            aria-label="View"
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
          >
            <option value="report">Research report</option>
            <option value="trace">Trace viewer</option>
          </select>
        </label>
        <label>
          Open record{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => void load(event.target.files?.[0])}
          />
        </label>
        <label>
          Theme{' '}
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => setTheme(event.target.value as typeof theme)}
          >
            <option value="auto">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {surface === 'trace' && (
          <label>
            <input
              type="checkbox"
              checked={second}
              onChange={(event) => setSecond(event.target.checked)}
            />{' '}
            Show a second independent viewer
          </label>
        )}
      </div>
      <p className="demo-note">
        The example contains real, reviewed research records. Files you open are
        read in this browser and are never uploaded.
      </p>
      {error && (
        <pre className="demo-error" role="alert">
          {error}
        </pre>
      )}
      {surface === 'report' && publicationReport ? (
        <ResearchReport report={publicationReport} theme={theme} />
      ) : records.length ? (
        <>
          <AgentRecord
            records={records}
            theme={theme}
            onSelectionChange={setSelection}
          />
          <output className="demo-selection" aria-label="Latest selection">
            {selection
              ? JSON.stringify(selection)
              : 'Select an event to inspect its source.'}
          </output>
          {second && (
            <section className="second-viewer">
              <h2>Independent viewer</h2>
              <AgentRecord records={records} theme={theme} />
            </section>
          )}
        </>
      ) : (
        !error && <p role="status">Loading recorded evidence…</p>
      )}
      <footer>
        <a href="https://drewstone.github.io/research/">
          Research and source context
        </a>{' '}
        ·{' '}
        <a href="https://github.com/drewstone/agent-record#readme">
          Use the component
        </a>
      </footer>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
