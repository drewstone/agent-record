import { useEffect, useMemo, useState } from 'react'
import type { FlowSpan, FlowTrace } from '@tangle-network/charts'
import { TraceWorkspace } from '@tangle-network/sandbox-ui/run'
import { AgentGraph, type AgentGraphNode, type AgentGraphStatus } from '@tangle-network/sandbox-ui/workflows'

// A display-only subset of Runtime's TopSnapshot wire contract. Runtime owns all lifecycle/accounting projection.
type Spend = { usd: number; usdKnown?: boolean }
type Worker = { id: string; parent?: string; label: string; status: string; startedAt?: string; endedAt?: string; runtime?: string; verdict?: string; liveTail?: string[]; spend?: Spend; metered?: Spend }
type Node = { id: string; runId: string; model?: string; backend?: string }
type Snapshot = { pursuit?: { nodes: Node[] }; root: string; generatedAt: number; completeness: string; diagnostics: { source: string; reason: string }[]; supervisors: { id: string; status: string; task?: string; startedAt?: string; completedAt?: string; driverSpend?: Spend; workers: Worker[] }[] }
const time = (value?: string) => { const ms = value ? Date.parse(value) : Number.NaN; return Number.isFinite(ms) ? ms : undefined }
// A missing or unknown spend is unknown, never zero, and never drops the agent.
const cost = (...spends: (Spend | undefined)[]) => spends.every((spend) => spend && spend.usdKnown !== false) ? spends.reduce((sum, spend) => sum + (spend?.usd ?? 0), 0) : undefined
const graphStatus = (status: string): AgentGraphStatus => status === 'running' ? 'running' : status === 'done' ? 'succeeded' : status === 'down' ? 'failed' : status === 'cancelled' ? 'stopped' : 'unknown'
type Frame = { sequence: number; observedAt: number; reset: boolean; snapshots: Snapshot[] }

/** Both the Discovery host and agent-runtime-top mount this same stream consumer and shared run workspace. */
export function LiveRun({ api }: { api: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [selected, setSelected] = useState('')
  const [rendered, setRendered] = useState(0)
  const [agent, setAgent] = useState<string>()
  const [layout, setLayout] = useState<'tree' | 'hub'>('tree')
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
  const facts = active?.snapshot.pursuit?.nodes.filter((node) => node.runId === active.run.id) ?? []
  const detail = (id: string) => { const node = facts.find((node) => node.id === id); return [node?.model, node?.backend].filter(Boolean).join(' · ') || undefined }
  const startedAt = active ? Math.min(...[active.run.startedAt, ...active.run.workers.map((worker) => worker.startedAt)].flatMap((value) => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : [])) : undefined
  const trace = useMemo((): FlowTrace => {
    const run = active?.run
    const at = active?.snapshot.generatedAt ?? Date.now()
    const first = startedAt !== undefined && Number.isFinite(startedAt) ? startedAt : at
    const spans: FlowSpan[] = (run?.workers ?? []).flatMap((worker) => {
      if (!worker.startedAt || !Number.isFinite(Date.parse(worker.startedAt))) return []
      const start = Math.max(0, Date.parse(worker.startedAt) - first)
      const end = time(worker.endedAt) ?? (worker.status === 'running' ? at : Date.parse(worker.startedAt))
      const costUsd = cost(worker.spend, worker.metered)
      return [{ id: worker.id, ...(worker.parent ? { parentId: worker.parent } : {}), name: worker.label, kind: 'pipeline', startMs: start, endMs: Math.max(start, end - first), status: worker.status === 'running' ? 'running' : worker.status === 'down' ? 'failed' : 'done', ...(costUsd !== undefined ? { costUsd } : {}), ...(detail(worker.id) ? { detail: detail(worker.id) } : {}), ...(worker.status === 'cancelled' ? { outcome: { tone: 'neutral', label: 'Cancelled' } as const } : {}) }]
    })
    if (run?.startedAt && run.status !== 'unobserved' && !spans.some((span) => span.id === run.id)) spans.unshift({ id: run.id, name: 'root', kind: 'pipeline', detail: detail(run.id), startMs: Math.max(0, Date.parse(run.startedAt) - first), endMs: Math.max(0, Date.parse(run.completedAt ?? new Date(at).toISOString()) - first), status: run.status === 'running' ? 'running' : run.status === 'down' ? 'failed' : 'done', ...(cost(run.driverSpend) !== undefined ? { costUsd: cost(run.driverSpend) } : {}), ...(run.status === 'cancelled' ? { outcome: { tone: 'neutral', label: 'Cancelled' } as const } : {}) })
    return { spans, totalMs: Math.max(0, ...spans.map((span) => span.endMs)), promptTokens: 0, completionTokens: 0, modelCalls: 0, toolCalls: 0, errors: spans.filter((span) => span.status === 'failed').length }
  }, [active?.snapshot, active?.run, startedAt])
  // Every recorded worker gets a card, timed or not; the waterfall only places workers with a recorded start.
  const run = active?.run
  const workers = run?.workers.filter((worker) => worker.id !== run.id) ?? []
  const nodes: AgentGraphNode[] = run ? [
    { id: run.id, label: 'root', status: graphStatus(run.status), model: detail(run.id), costUsd: cost(run.driverSpend), startedAt: time(run.startedAt), result: run.status === 'cancelled' ? 'Cancelled' : undefined },
    ...workers.map((worker) => ({ id: worker.id, label: worker.label, harness: worker.runtime, model: detail(worker.id), status: graphStatus(worker.status), costUsd: cost(worker.spend, worker.metered), startedAt: time(worker.startedAt), turn: worker.liveTail?.at(-1), events: worker.liveTail?.slice(-3).map((label, index) => ({ id: `${worker.id}:${index}:${label}`, label })), result: worker.status === 'cancelled' ? 'Cancelled' : worker.verdict })),
  ] : []
  const known = new Set(nodes.map((node) => node.id))
  const edges = workers.map((worker) => ({ from: worker.parent && worker.parent !== worker.id && known.has(worker.parent) ? worker.parent : run!.id, to: worker.id, kind: 'spawn' as const }))
  const agentCards = Object.fromEntries([...(active?.run.workers ?? []).filter((worker) => worker.status === 'cancelled').map((worker) => [worker.id, { status: 'stopped' as const, result: 'Cancelled' }]), ...(active?.run.status === 'cancelled' ? [[active.run.id, { status: 'stopped' as const, result: 'Cancelled' }]] : [])])
  return (
    <main className="ws-live" data-top-sequence={rendered}>
      <header>
        <h1>Live agents</h1>
        <label>Run<select aria-label="Run" value={active?.key ?? ''} onChange={(event) => { setSelected(event.target.value); setAgent(undefined) }}>{runs.map((item) => <option key={item.key} value={item.key}>{item.run.id}</option>)}</select></label>
        <span role="status">{connected ? '● Connected' : snapshots.length ? '○ Reconnecting' : 'Connecting…'}</span>
      </header>
      {active?.run.task && active.run.task !== active.run.id && <p>{active.run.task}</p>}
      {error && <p role="alert">{error}</p>}
      {active?.snapshot.completeness === 'partial' && <p role="alert">Partial capture: {active.snapshot.diagnostics.map((diagnostic) => `${diagnostic.source}: ${diagnostic.reason}`).join(' · ')}</p>}
      {active ? (
        <div className="ws-live-split">
          <section aria-label="Agent graph">
            <div role="group" aria-label="Graph layout">{(['tree', 'hub'] as const).map((option) => <button key={option} type="button" aria-pressed={layout === option} onClick={() => setLayout(option)}>{option}</button>)}</div>
            <AgentGraph key={active.key} nodes={nodes} edges={edges} layout={layout} live={nodes.some((node) => node.status === 'running')} selectedId={agent ?? null} onSelect={setAgent} title={active.run.id} className="ws-live-graph" />
          </section>
          <TraceWorkspace key={active.key} trace={trace} label={active.run.id} selectedAgentId={agent} onSelectAgent={setAgent} live={active.run.status === 'running' || active.run.workers.some((worker) => worker.status === 'running')} startedAt={Number.isFinite(startedAt) ? startedAt : undefined} agentCards={agentCards} summary={false} defaultView="agents" maxHeight={650} streamUrl={(id) => `${api}/agents/${active.root}/${encodeURIComponent(active.run.id)}/${encodeURIComponent(id)}/stream`} />
        </div>
      ) : connected && <p role="status">No recorded agents in these roots.</p>}
    </main>
  )
}
