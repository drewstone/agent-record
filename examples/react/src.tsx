import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AgentRecord,
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
      const values = Array.isArray(value) ? value : [value]
      const next = values.map((item) =>
        item?.schema === 'research-publication.events.v1'
          ? fromResearchPublication(item)
          : parseRecord(item),
      )
      if (new Set(next.map((record) => record.runId)).size !== next.length)
        throw new Error('Run IDs must be unique')
      setRecords(next)
      setSelection(undefined)
      setError('')
    } catch (error) {
      setError(String(error))
    }
  }
  return (
    <main>
      <header className="demo-header">
        <div>
          <h1>Agent Record</h1>
          <p>
            Conversations, tool results, topology, and usage in one React
            component.
          </p>
        </div>
        <a href="https://github.com/drewstone/agent-record">GitHub ↗</a>
      </header>
      <div className="demo-controls">
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
        <label>
          <input
            type="checkbox"
            checked={second}
            onChange={(event) => setSecond(event.target.checked)}
          />{' '}
          Show a second independent viewer
        </label>
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
      {records.length ? (
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
