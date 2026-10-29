import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseRecord, type RunRecord } from '@drewstone/agent-record/record'
import { fromResearchPublication } from '@drewstone/agent-record/adapters/research-publication'
import { Gantt, LIVE_SERIES } from '@tangle-network/charts/react'
import { Conversation, indexRecord, withPrompts } from '@tangle-network/sandbox-ui/run/record'
import './style.css'
import { publicationIds, readPublication } from './publications.js'

const readRecord = (value: unknown): RunRecord => value && typeof value === 'object' && 'schema' in value && value.schema === 'research-publication.events.v1' ? fromResearchPublication(value) : parseRecord(value)
const clock = (at: number) => new Date(at).toISOString().slice(11, 19)

/** The example composes public owners; it holds no private chart or transcript renderer. */
function Viewer({ record }: { record: RunRecord }) {
  const index = useMemo(() => indexRecord(withPrompts(record)), [record])
  const [chosen, choose] = useState(index.actors[0]?.id ?? '')
  const [selected, select] = useState<string>()
  const actor = index.actors.some(node => node.id === chosen) ? chosen : index.actors[0]?.id ?? ''
  const events = index.byActor.get(actor) ?? []
  const colors = Object.fromEntries([...new Set(events.map(event => event.category))].map((category, i) => [category, LIVE_SERIES[i % LIVE_SERIES.length]!]))
  const lanes = events.map(event => ({ id: event.id, label: event.label, spans: [{ start: Date.parse(event.at), end: Date.parse(event.end ?? event.at), state: event.category, note: `${event.category} · ${event.at}` }] }))
  return <section className="demo-viewer" aria-label="Recorded activity">
    <label>Agent <select aria-label="Agent" value={actor} onChange={event => { choose(event.target.value); select(undefined) }}>{index.actors.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
    <p>Recorded timestamps are points; only events with a recorded end have duration. Select an event to open its conversation and source.</p>
    <Gantt lanes={lanes} colors={colors} axis={clock} span={(start, end) => end === start ? 'Timestamp only' : `${((end - start) / 1000).toFixed(2)} s`} selectedId={selected} onSelect={select} maxHeight={360} />
    <Conversation index={index} actor={actor} cutoff={index.end} query="" category="all" selected={selected} />
    {selected && <details className="demo-source" open><summary>Recorded source</summary><pre>{JSON.stringify(index.byEvent.get(selected)?.source ?? { status: 'Source not recorded' }, null, 2)}</pre></details>}
  </section>
}

function App() {
  const [records, setRecords] = useState<RunRecord[]>([])
  const bootstrap = useRef<AbortController | undefined>(undefined)
  const [chosen, choose] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])
  useEffect(() => {
    const controller = new AbortController()
    bootstrap.current = controller
    Promise.all(publicationIds.map(async id => readRecord(JSON.parse(await readPublication(id, controller.signal)))))
      .then(value => { if (!controller.signal.aborted) setRecords(value) })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => controller.abort()
  }, [])
  async function load(file?: File) {
    if (!file) return
    try {
      const value: unknown = JSON.parse(await file.text())
      const next = (Array.isArray(value) ? value : [value]).map(readRecord)
      if (new Set(next.map(record => record.runId)).size !== next.length) throw new Error('Run IDs must be unique')
      bootstrap.current?.abort()
      setRecords(next); choose(''); setError('')
    } catch (error) { setError(String(error)) }
  }
  const record = records.find(record => record.runId === chosen) ?? records[0]
  return <main>
    <header><h1>Agent records</h1><a href="https://github.com/drewstone/agent-record">Record format and adapters ↗</a></header>
    <p>Read retained conversations with Charts and Sandbox UI. Opened files stay in this browser and are never uploaded.</p>
    <div className="demo-controls">
      <label>Record <select aria-label="Record" value={record?.runId ?? ''} onChange={event => choose(event.target.value)}>{records.map(record => <option key={record.runId} value={record.runId}>{record.title}</option>)}</select></label>
      <label>Open record <input type="file" accept=".json,application/json" onChange={event => void load(event.target.files?.[0])} /></label>
      <label>Theme <select aria-label="Theme" value={theme} onChange={event => setTheme(event.target.value as typeof theme)}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </div>
    {error && <pre className="demo-error" role="alert">{error}</pre>}
    {record ? <Viewer key={record.runId} record={record} /> : !error && <p role="status">Loading recorded evidence…</p>}
    <footer>These are retained observations, not new verification. Missing timing, usage and attribution stay unknown. Research reports remain available through the report CLI.</footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
