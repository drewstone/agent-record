import { useEffect, useMemo, useState } from 'react'
import type { FlowSpan, FlowTrace } from '@tangle-network/charts'
import { TraceWorkspace } from '@tangle-network/sandbox-ui/run'

// A display-only subset of Runtime's TopSnapshot wire contract. Runtime owns all lifecycle/accounting projection.
type Worker = { id: string; parent?: string; label: string; status: string; startedAt?: string; endedAt?: string; runtime?: string; spend: { usd: number; usdKnown?: boolean }; metered: { usd: number; usdKnown?: boolean } }
type Snapshot = { root: string; generatedAt: number; completeness: string; diagnostics: { source: string; reason: string }[]; supervisors: { id: string; status: string; startedAt?: string; completedAt?: string; driverSpend: { usd: number; usdKnown?: boolean }; workers: Worker[] }[] }
type Frame = { sequence: number; observedAt: number; reset: boolean; snapshots: Snapshot[] }

/** Both the Discovery host and agent-runtime-top mount this same stream consumer and shared run workspace. */
export function LiveRun({ api }: { api: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [selected, setSelected] = useState('')
  const [rendered, setRendered] = useState(0)
  useEffect(() => {
    const source = new EventSource(`${api}/events`)
    source.addEventListener('snapshot', (message) => {
      try {
        const frame = JSON.parse((message as MessageEvent<string>).data) as Frame
        if (!Array.isArray(frame.snapshots)) throw new Error('Invalid snapshot stream')
        setSnapshots((prior) => {
          const byRoot = new Map((frame.reset ? [] : prior).map((snapshot) => [snapshot.root, snapshot]))
          for (const snapshot of frame.snapshots) byRoot.set(snapshot.root, snapshot)
          return [...byRoot.values()]
        })
        setRendered(frame.sequence); setError(null); setConnected(true)
      } catch (cause) { setError(String(cause)) }
    })
    source.addEventListener('unavailable', () => setError('The run snapshot is unavailable'))
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [api])
  const runs = snapshots.flatMap((snapshot, root) => snapshot.supervisors.map((run) => ({ snapshot, root, run, key: JSON.stringify([snapshot.root, run.id]) })))
  const active = runs.find((run) => run.key === selected) ?? runs[0]
  const trace = useMemo((): FlowTrace => {
    const run = active?.run
    const at = active?.snapshot.generatedAt ?? Date.now()
    const times = run?.workers.flatMap((worker) => worker.startedAt ? [Date.parse(worker.startedAt)] : []) ?? []
    const first = Math.min(...times.filter(Number.isFinite), at)
    const spans: FlowSpan[] = (run?.workers ?? []).flatMap((worker) => {
      if (!worker.startedAt || !Number.isFinite(Date.parse(worker.startedAt))) return []
      const start = Math.max(0, Date.parse(worker.startedAt) - first)
      const end = worker.endedAt ? Date.parse(worker.endedAt) : at
      const costKnown = worker.spend.usdKnown !== false && worker.metered.usdKnown !== false
      return [{ id: worker.id, ...(worker.parent ? { parentId: worker.parent } : {}), name: worker.label, kind: 'pipeline', startMs: start, endMs: Math.max(start, end - first), status: worker.status === 'running' ? 'running' : worker.status === 'down' ? 'failed' : 'done', ...(costKnown ? { costUsd: worker.spend.usd + worker.metered.usd } : {}), ...(worker.runtime ? { detail: worker.runtime } : {}) }]
    })
    if (run?.startedAt && run.status !== 'unobserved' && !spans.some((span) => span.id === run.id)) spans.unshift({ id: run.id, name: 'root', kind: 'pipeline', startMs: Math.max(0, Date.parse(run.startedAt) - first), endMs: Math.max(0, Date.parse(run.completedAt ?? new Date(at).toISOString()) - first), status: run.status === 'running' ? 'running' : run.status === 'down' ? 'failed' : 'done', ...(run.driverSpend.usdKnown !== false ? { costUsd: run.driverSpend.usd } : {}) })
    return { spans, totalMs: Math.max(0, ...spans.map((span) => span.endMs)), promptTokens: 0, completionTokens: 0, modelCalls: 0, toolCalls: 0, errors: spans.filter((span) => span.status === 'failed').length }
  }, [active?.snapshot, active?.run])
  return (
    <main className="ws-live" data-top-sequence={rendered}>
      <header>
        <h1>Live agents</h1>
        <label>Run<select aria-label="Run" value={active?.key ?? ''} onChange={(event) => setSelected(event.target.value)}>{runs.map((item) => <option key={item.key} value={item.key}>{item.run.id}</option>)}</select></label>
        <span role="status">{connected ? '● Connected' : snapshots.length ? '○ Reconnecting' : 'Connecting…'}</span>
      </header>
      {error && <p role="alert">{error}</p>}
      {active?.snapshot.completeness === 'partial' && <p role="alert">Partial capture: {active.snapshot.diagnostics.map((diagnostic) => `${diagnostic.source}: ${diagnostic.reason}`).join(' · ')}</p>}
      {active ? <TraceWorkspace key={active.key} trace={trace} label={active.run.id} live={active.run.workers.some((worker) => worker.status === 'running')} summary={false} defaultView="agents" maxHeight={650} streamUrl={(id) => `${api}/agents/${active.root}/${encodeURIComponent(active.run.id)}/${encodeURIComponent(id)}/stream`} /> : connected && <p role="status">No recorded agents in these roots.</p>}
    </main>
  )
}
