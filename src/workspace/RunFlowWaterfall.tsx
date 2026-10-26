import { useMemo } from 'react'
import { FlowWaterfall } from '@tangle-network/charts/react'
import type { RunRecord } from '../record.js'
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
