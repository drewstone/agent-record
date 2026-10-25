import { useEffect, useMemo, useState } from 'react'
import { FlowWaterfall } from '@tangle-network/charts/react'
import type { RunRecord } from '../record.js'
import type { RunDocument } from '../workspace-model.js'
import { readRecord, useDocument } from './data.js'
import { recordFlowTrace } from './record-flow.js'

/** The shared waterfall owns search, playback, nesting and live growth. This adapter owns record provenance. */
/** `view` is where it opens: one row per agent (the run page), or the span tree with the trace's totals. */
export function RecordFlowWaterfall({ record, live = false, defaultCollapsed, view = 'agents' }: { record: RunRecord; live?: boolean; defaultCollapsed?: boolean; view?: 'agents' | 'spans' }) {
  const trace = useMemo(() => recordFlowTrace(record, live), [record, live])
  return <div className="record-flow-waterfall" data-record-flow={record.runId}>
    <FlowWaterfall trace={trace} live={live} defaultView={view} label="Agents over time" defaultCollapsed={defaultCollapsed ?? trace.spans.length > 100} />
    <p className="faint">Captured events only; approximate timings are marked. Cost is at list price, unknown where a model has none.</p>
  </div>
}

/** Fetch the existing public record only while the reader opens the trace; settlement stops polling. */
export function RunFlowWaterfall({ api, doc }: { api: string; doc: RunDocument }) {
  const [open, setOpen] = useState(false)
  const [retained, setRetained] = useState<RunRecord | null>(null)
  const live = doc.execution?.alive ?? doc.live?.polling ?? false
  const id = doc.run?.id
  const digest = doc.run?.record?.digest
  const url = open && id ? `${api}/runs/${encodeURIComponent(id)}/record${digest ? `?digest=${encodeURIComponent(digest)}` : ''}` : null
  const loaded = useDocument<unknown>(url, live ? 3_000 : undefined, true)
  const result = useMemo(() => {
    if (loaded.data === undefined) return null
    try { return { record: readRecord(loaded.data) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'Invalid retained record' } }
  }, [loaded.data])
  useEffect(() => { if (result?.record) setRetained(result.record) }, [result])
  const candidate = result?.record ?? retained
  const record = candidate?.runId === id ? candidate : null
  return <details className="rr-drawer" data-run-waterfall open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Trace waterfall</summary>
    <div className="rr-drawer-body">
      {open && loaded.error && <p role="alert">Trace unavailable: {loaded.error}</p>}
      {open && result?.error && <p role="alert">Trace unavailable: {result.error}</p>}
      {record ? <RecordFlowWaterfall record={record} live={open && live} /> : open && !loaded.error && !result?.error && <p role="status">Loading retained trace…</p>}
    </div>
  </details>
}
