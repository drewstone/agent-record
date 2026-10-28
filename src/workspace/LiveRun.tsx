import { runStatus } from '@tangle-network/ui/run'
import { useEffect, useMemo, useState } from 'react'
import type { FlowSpan, FlowTrace } from '@tangle-network/charts'
import { TraceWorkspace } from '@tangle-network/sandbox-ui/run'
import { type AgentGraphNode, type AgentGraphStatus } from '@tangle-network/sandbox-ui/workflows'

// A display-only subset of Runtime's TopSnapshot wire contract. Runtime owns all lifecycle/accounting projection.
type Spend = { usd: number; usdKnown?: boolean }
type Worker = { id: string; parent?: string; label: string; status: string; startedAt?: string; endedAt?: string; runtime?: string; verdict?: string; reason?: string; liveTail?: string[]; lastActivityAt?: number; medianEventGapMs?: number; spend?: Spend; metered?: Spend }
type Node = { id: string; runId: string; parentId?: string; label?: string; runtime?: string; status?: string; settledAt?: number; timing?: { startedAt: number; settledAt?: number }; model?: string; backend?: string }
type Snapshot = { pursuit?: { nodes: Node[] }; root: string; generatedAt: number; completeness: string; diagnostics: { source: string; reason: string }[]; supervisors: { id: string; status: string; task?: string; startedAt?: string; completedAt?: string; reason?: string; lastActivityAt?: number; medianEventGapMs?: number; driverSpend?: Spend; totals?: { tokensKnown?: boolean; tokensInput?: number; tokensOutput?: number }; workers: Worker[] }[] }
const time = (value?: string) => { const ms = value ? Date.parse(value) : Number.NaN; return Number.isFinite(ms) ? ms : undefined }
const iso = (ms?: number) => ms !== undefined && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
// A run with no spawn journal (a retained or observer-only run) has its agents only as pursuit nodes; their spawn and
// settle clocks fill the times a worker lacks, so no recorded agent loses its card or its waterfall bar.
const withNodes = (run: Snapshot['supervisors'][number], nodes: Node[]): Worker[] => [
  ...run.workers.map((worker) => { const node = nodes.find((node) => node.id === worker.id); return { ...worker, startedAt: worker.startedAt ?? iso(node?.timing?.startedAt), endedAt: worker.endedAt ?? iso(node?.timing?.settledAt ?? node?.settledAt) } }),
  ...nodes.filter((node) => node.id !== run.id && !run.workers.some((worker) => worker.id === node.id)).map((node) => ({ id: node.id, parent: node.parentId, label: node.label ?? node.id, runtime: node.runtime, status: node.status ?? 'unknown', startedAt: iso(node.timing?.startedAt), endedAt: iso(node.timing?.settledAt ?? node.settledAt) })),
]
// A missing or unknown spend is unknown, never zero, and never drops the agent.
const cost = (...spends: (Spend | undefined)[]) => spends.every((spend) => spend && spend.usdKnown !== false && Number.isFinite(spend.usd) && spend.usd >= 0) ? spends.reduce((sum, spend) => sum + (spend?.usd ?? 0), 0) : undefined
const flowStatus = (status: string) => runStatus(status === 'down' ? 'failed' : status === 'cancelled' ? 'stopped' : status)
const graphStatus = (status: string): AgentGraphStatus => { const state = flowStatus(status); return state === 'done' ? 'succeeded' : state }
const isOpen = (status: string) => ['running', 'waiting', 'needs-you'].includes(flowStatus(status))
type Frame = { sequence: number; observedAt: number; reset: boolean; snapshots: Snapshot[] }

/** Both the Discovery host and agent-runtime-top mount this same stream consumer and shared run workspace. */
export function LiveRun({ api }: { api: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [ended, setEnded] = useState(false)
  const [selected, setSelected] = useState('')
  const [rendered, setRendered] = useState(0)
  const [agent, setAgent] = useState<string>()
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
    // Runtime ends the stream when its server closes; the run is then final, not reconnecting.
    source.addEventListener('end', () => { source.close(); setEnded(true) })
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [api])
  const runs = snapshots.flatMap((snapshot, root) => snapshot.supervisors.map((run) => ({ snapshot, root, run, key: JSON.stringify([snapshot.root, run.id]) })))
  const active = runs.find((run) => run.key === selected) ?? runs[0]
  const facts = active?.snapshot.pursuit?.nodes.filter((node) => node.runId === active.run.id) ?? []
  const detail = (id: string) => { const node = facts.find((node) => node.id === id); return [node?.model, node?.backend].filter(Boolean).join(' · ') || undefined }
  const run = active && { ...active.run, workers: withNodes(active.run, facts) }
  const startedAt = run ? Math.min(...[run.startedAt, ...run.workers.map((worker) => worker.startedAt)].flatMap((value) => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : [])) : undefined
  const trace = useMemo((): FlowTrace => {
    const at = active?.snapshot.generatedAt ?? Date.now()
    const first = startedAt !== undefined && Number.isFinite(startedAt) ? startedAt : at
    const spans: FlowSpan[] = (run?.workers ?? []).flatMap((worker) => {
      if (!worker.startedAt || !Number.isFinite(Date.parse(worker.startedAt))) return []
      const start = Math.max(0, Date.parse(worker.startedAt) - first)
      const end = time(worker.endedAt) ?? (isOpen(worker.status) ? at : Date.parse(worker.startedAt))
      const costUsd = cost(worker.spend, worker.metered)
      return [{ id: worker.id, parentId: worker.parent && worker.parent !== worker.id ? worker.parent : run!.id, name: worker.label, kind: 'pipeline', startMs: start, endMs: Math.max(start, end - first), status: flowStatus(worker.status), ...(costUsd !== undefined ? { costUsd } : {}), ...(worker.lastActivityAt !== undefined ? { activityAt: [worker.lastActivityAt - first], medianEventGapMs: worker.medianEventGapMs } : {}), ...(detail(worker.id) ? { detail: detail(worker.id) } : {}), ...(flowStatus(worker.status) === 'failed' && worker.reason ? { facts: [{ label: 'Failure', value: worker.reason }] } : {}), ...(worker.status === 'cancelled' ? { outcome: { tone: 'neutral', label: 'Cancelled' } as const } : {}) }]
    })
    if (run?.startedAt && run.status !== 'unobserved' && !spans.some((span) => span.id === run.id)) spans.unshift({ id: run.id, name: 'root', kind: 'pipeline', detail: detail(run.id), startMs: Math.max(0, Date.parse(run.startedAt) - first), endMs: Math.max(0, Date.parse(run.completedAt ?? new Date(at).toISOString()) - first), status: flowStatus(run.status), ...(flowStatus(run.status) === 'failed' && run.reason ? { facts: [{ label: 'Failure', value: run.reason }] } : {}), ...(run.lastActivityAt !== undefined ? { activityAt: [run.lastActivityAt - first], medianEventGapMs: run.medianEventGapMs } : {}), ...(cost(run.driverSpend) !== undefined ? { costUsd: cost(run.driverSpend) } : {}), ...(run.status === 'cancelled' ? { outcome: { tone: 'neutral', label: 'Cancelled' } as const } : {}) })
    const totals = run?.totals
    return { spans, totalMs: Math.max(0, ...spans.map((span) => span.endMs)), ...(totals?.tokensKnown !== false && typeof totals?.tokensInput === 'number' && Number.isFinite(totals.tokensInput) && totals.tokensInput >= 0 ? { promptTokens: totals.tokensInput } : {}), ...(totals?.tokensKnown !== false && typeof totals?.tokensOutput === 'number' && Number.isFinite(totals.tokensOutput) && totals.tokensOutput >= 0 ? { completionTokens: totals.tokensOutput } : {}), errors: spans.filter((span) => span.status === 'failed').length }
  }, [active?.snapshot, active?.run, startedAt])
  // Every recorded worker gets a card, timed or not; the waterfall only places workers with a recorded start.
  const workers = run?.workers.filter((worker) => worker.id !== run.id) ?? []
  const nodes: AgentGraphNode[] = run ? [
    { id: run.id, label: 'root', status: graphStatus(run.status), model: detail(run.id), costUsd: cost(run.driverSpend), startedAt: time(run.startedAt), lastActivityAt: run.lastActivityAt, medianEventGapMs: run.medianEventGapMs, result: run.status === 'cancelled' ? 'Cancelled' : graphStatus(run.status) === 'failed' ? run.reason || 'Failure cause not recorded' : undefined },
    ...workers.map((worker) => ({ id: worker.id, label: worker.label, harness: worker.runtime, model: detail(worker.id), status: graphStatus(worker.status), costUsd: cost(worker.spend, worker.metered), startedAt: time(worker.startedAt), lastActivityAt: worker.lastActivityAt, medianEventGapMs: worker.medianEventGapMs, turn: worker.liveTail?.at(-1), events: worker.liveTail?.slice(-3).map((label, index) => ({ id: `${worker.id}:${index}:${label}`, label })), result: worker.status === 'cancelled' ? 'Cancelled' : graphStatus(worker.status) === 'failed' ? worker.reason || 'Failure cause not recorded' : worker.verdict })),
  ] : []
  const known = new Set(nodes.map((node) => node.id))
  const edges = workers.map((worker) => ({ from: worker.parent && worker.parent !== worker.id && known.has(worker.parent) ? worker.parent : run!.id, to: worker.id, kind: 'spawn' as const }))
  const agentCards = Object.fromEntries(nodes.map(({ id, label, harness, model, turn, events, result, status, costUsd, startedAt, lastActivityAt, medianEventGapMs }) => [id, { label, harness, model, turn, events, result, ...(startedAt === undefined ? { status, costUsd, lastActivityAt, medianEventGapMs } : {}) }]))
  return (
    <main className="ws-live" data-top-sequence={rendered}>
      <header>
        <h1>Live agents</h1>
        <label>Run<select aria-label="Run" value={active?.key ?? ''} onChange={(event) => { setSelected(event.target.value); setAgent(undefined) }}>{runs.map((item) => <option key={item.key} value={item.key}>{item.run.id}</option>)}</select></label>
        <span role="status">{ended ? 'Finished · viewer closed' : connected ? '● Connected' : snapshots.length ? '○ Reconnecting' : 'Connecting…'}</span>
      </header>
      {active?.run.task && active.run.task !== active.run.id && <p>{active.run.task}</p>}
      {error && <p role="alert">{error}</p>}
      {/* With no run to show, every root's diagnostics say why; an unreadable root is never "no agents". */}
      {(active ? [active.snapshot] : snapshots).filter((snapshot) => snapshot.completeness === 'partial').map((snapshot) => <p key={snapshot.root} role="alert">Partial capture: {snapshot.diagnostics.map((diagnostic) => `${diagnostic.source}: ${diagnostic.reason}`).join(' · ')}</p>)}
      {active ? (
        <TraceWorkspace key={active.key} trace={trace} label={active.run.id} selectedAgentId={agent} onSelectAgent={setAgent} live={isOpen(active.run.status) || run!.workers.some((worker) => isOpen(worker.status))} startedAt={Number.isFinite(startedAt) ? startedAt : undefined} agentCards={agentCards} agentGraph={{ defaultLayout: 'tree', edges, title: active.run.id }} defaultView="graph" maxHeight={650} streamUrl={(id) => `${api}/agents/${active.root}/${encodeURIComponent(active.run.id)}/${encodeURIComponent(id)}/stream`} />
      ) : connected && !snapshots.some((snapshot) => snapshot.completeness === 'partial') && <p role="status">No recorded agents in these roots.</p>}
    </main>
  )
}
