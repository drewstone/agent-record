import type { RunWorkspaceDocument, WorkspaceNode, WorkspaceRelease } from '../RunWorkspace.js'

/**
 * The run page's one model, built from the workspace document (tangle-tools run_workspace + agent_usage): every agent
 * with its recorded usage and steps, and the run's totals. Every number on the page is derived here from recorded
 * steps or the host's per-agent usage; an absent measurement stays null, never zero.
 */
export type ByClass = { input: number; output: number; cacheRead: number; cacheWrite?: number }
export type ToolUsage = { calls: number; failures: number; ms: number }
/** One step as the host recorded it (epoch ms), with the per-step metrics tangle-tools #2190 added where known. */
export type RawStep = {
  kind: 'model' | 'tool' | 'waiting'
  startMs: number
  endMs: number
  failed: boolean
  name?: string
  tool?: string
  model?: string
  modelCalls?: number
  toolCalls?: number
  failures?: number
  retries?: number
  billedUsd?: number
  latencyMs?: number
  byClass?: Partial<ByClass>
}
export type Usage = {
  billedUsd: number | null
  billedComplete?: boolean
  listUsd: number | null
  listComplete: boolean
  calls: number | null
  pricedCalls: number | null
  tokens: number | null
  at: string | null
  source: string
  byClass?: ByClass | null
  models?: Record<string, number> | null
  latencyMs?: { p50: number | null; p90: number | null; max: number | null } | null
  tools?: Record<string, ToolUsage> | null
  failures?: { model: number; tool: number } | null
  retries?: { model: number; tool: number } | null
  steps?: RawStep[]
}
export type Node = WorkspaceNode & { start?: string | null; end?: string | null; seat?: string | null; usage?: Usage | null }
export type RunRelease = WorkspaceRelease & { by?: Record<string, number>; files?: Record<string, string[]>; tagged?: boolean; held?: string[] }
export type WorkspaceDoc = Omit<RunWorkspaceDocument, 'nodes' | 'releases'> & { nodes: Node[]; releases: RunRelease[]; runUsage?: Usage | null }

/** A step on the run's clock: `t` and `d` in ms from the run's start. */
export interface Step {
  t: number
  d: number
  kind: 'model' | 'tool' | 'waiting'
  failed: boolean
  /** The tool's name (`read`), never its arguments. */
  tool: string | null
  /** What the tool acted on, as the host named it (`import-protocol.md`); the host already strips command text. */
  target: string | null
  model: string | null
  latency: number | null
  tokens: ByClass | null
  usd: number | null
}
export interface ToolStats {
  name: string
  calls: number
  failures: number
  ms: number
  durations: number[]
  p50: number | null
  p90: number | null
  p99: number | null
}
export type Tone = 'ok' | 'live' | 'none' | 'fail' | ''
export interface Agent {
  id: string
  /** The name people use: its role, else its label. */
  name: string
  /** The name without the run's shared prefix (`peer-director-3-battery3-poll2` → `3-battery3-poll2`): what tells it apart. */
  short: string
  node: Node
  parent: string | null
  children: string[]
  depth: number
  team: string | null
  status: Node['status']
  state: { label: string; tone: Tone }
  model: string | null
  harness: string | null
  /** ms from the run's start; null when the journal has no time. */
  start: number | null
  end: number | null
  tokens: number | null
  byClass: ByClass | null
  billedUsd: number | null
  listUsd: number | null
  steps: Step[]
  modelCalls: number
  toolCalls: number
  failedSteps: number
  toolFailures: number
  retries: number
  latency: { p50: number | null; p90: number | null; p99: number | null }
  tools: ToolStats[]
  busy: number
  first: number | null
  last: number | null
  restarts: number[]
  turns: number | null
  commits: number | null
}
export interface RunModel {
  t0: number
  duration: number
  live: boolean
  agents: Agent[]
  byId: Map<string, Agent>
  root: Agent | null
  /** Tree order (depth first, children by start). */
  tree: Agent[]
  teams: { id: string; label: string; members: string[] }[]
  tools: ToolStats[]
  steps: { agent: Agent; step: Step }[]
  totals: { steps: number; model: number; tool: number; failed: number; toolFailures: number; retries: number; tokens: number | null; byClass: ByClass | null; billedUsd: number | null; listUsd: number | null; busy: number; lastStep: number | null }
  pauses: { from: number; to: number; reason: string }[]
  releases: RunRelease[]
  best: RunRelease | null
  ws: WorkspaceDoc
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

/** The nearest-rank percentile of `values`; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

export function toolStats(name: string, durations: number[], failures: number, ms: number): ToolStats {
  return { name, calls: durations.length, failures, ms, durations, p50: percentile(durations, 50), p90: percentile(durations, 90), p99: percentile(durations, 99) }
}

/** Short model words: `opencode/glm-5.3-flash-free` reads `glm-5.3-flash-free`. */
export const shortModel = (model: string | null | undefined) => (model ? (model.split('/').pop() ?? model) : null)

/** A step's target: the host names a tool step `read · file.md`; the tool is its own field. */
const targetOf = (step: RawStep) => {
  const name = step.name ?? ''
  const cut = name.indexOf(' · ')
  return cut >= 0 ? name.slice(cut + 3) : null
}

/** An agent's state word and tone, from the spawn journal's settle; one with commits shipped, whatever the settle (21c: memscale-5 committed, then failed). */
function stateOf(node: Node, live: boolean, steps: number): Agent['state'] {
  if (node.status === 'running' || (live && node.status === 'waiting')) return { label: node.status === 'waiting' ? 'Waiting' : 'Running', tone: 'live' }
  if (node.shipped) return { label: 'Shipped', tone: 'ok' }
  if (node.status === 'succeeded') return { label: 'Done', tone: 'ok' }
  if (node.status === 'failed') return { label: 'Failed', tone: 'fail' }
  if (!steps && (!node.start || !node.usage)) return { label: 'Never ran', tone: 'none' }
  return { label: node.status === 'idle' ? 'Idle' : 'Stopped', tone: '' }
}

export function buildModel(ws: WorkspaceDoc, run: { startedAt?: string | null; durationMs?: number | null }): RunModel {
  const nodes = ws.nodes
  const spawned = new Map(ws.edges.filter((e) => e.kind === 'spawn').map((e) => [e.to, e.from]))
  const ids = new Set(nodes.map((n) => n.id))
  const starts = nodes.map((n) => time(n.start)).filter(Number.isFinite)
  const t0 = Number.isFinite(time(run.startedAt)) ? time(run.startedAt) : starts.length ? Math.min(...starts) : Date.now()
  const ends = nodes.map((n) => time(n.end ?? n.lastAt)).filter(Number.isFinite)
  const duration = ws.live ? Math.max(0, Date.now() - t0) : run.durationMs ?? Math.max(0, (ends.length ? Math.max(...ends) : t0) - t0)
  const parentOf = (n: Node) => {
    const from = spawned.get(n.id)
    if (from && ids.has(from)) return from
    const cut = n.id.lastIndexOf(':')
    const prefix = cut > 0 ? n.id.slice(0, cut) : null
    return prefix && ids.has(prefix) ? prefix : null
  }
  const agents: Agent[] = nodes.map((node) => {
    const usage = node.usage ?? null
    const steps: Step[] = (usage?.steps ?? []).map((s) => ({
      t: s.startMs - t0,
      d: Math.max(0, s.endMs - s.startMs),
      kind: s.kind,
      failed: Boolean(s.failed),
      tool: s.kind === 'tool' ? (s.tool ?? s.name?.split(' · ')[0] ?? 'tool') : null,
      target: s.kind === 'tool' ? targetOf(s) : null,
      model: s.model ?? null,
      latency: s.kind === 'model' ? (s.latencyMs ?? Math.max(0, s.endMs - s.startMs)) : null,
      tokens: s.byClass ? { input: s.byClass.input ?? 0, output: s.byClass.output ?? 0, cacheRead: s.byClass.cacheRead ?? 0 } : null,
      usd: s.billedUsd ?? null,
    }))
    steps.sort((a, b) => a.t - b.t)
    const model = steps.filter((s) => s.kind === 'model')
    const byTool = new Map<string, { d: number[]; f: number; ms: number }>()
    for (const s of steps) {
      if (s.kind !== 'tool' || !s.tool) continue
      const entry = byTool.get(s.tool) ?? { d: [], f: 0, ms: 0 }
      entry.d.push(s.d)
      entry.f += s.failed ? 1 : 0
      entry.ms += s.d
      byTool.set(s.tool, entry)
    }
    // Steps are the store's timed calls; an agent whose store lost them keeps the host's per-tool counts.
    const tools = byTool.size
      ? [...byTool].map(([name, t]) => toolStats(name, t.d, t.f, t.ms))
      : Object.entries(usage?.tools ?? {}).map(([name, t]) => ({ ...toolStats(name, [], t.failures, t.ms), calls: t.calls }))
    tools.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    const latencies = model.map((s) => s.latency!).filter((v) => Number.isFinite(v))
    const ends = steps.map((s) => s.t + s.d)
    const start = Number.isFinite(time(node.start)) ? time(node.start) - t0 : steps[0]?.t ?? null
    const end = Number.isFinite(time(node.end)) ? time(node.end) - t0 : ends.length ? Math.max(...ends) : null
    const toolCalls = byTool.size ? steps.filter((s) => s.kind === 'tool').length : tools.reduce((t, x) => t + x.calls, 0)
    return {
      id: node.id,
      name: node.role ?? node.label,
      short: node.role ?? node.label,
      node,
      parent: parentOf(node),
      children: [],
      depth: 0,
      team: null,
      status: node.status,
      state: stateOf(node, ws.live, steps.length),
      model: shortModel(node.model ?? Object.keys(usage?.models ?? {})[0]),
      harness: node.harness,
      start,
      end,
      tokens: usage?.tokens ?? null,
      byClass: usage?.byClass ?? null,
      billedUsd: usage?.billedUsd ?? null,
      listUsd: usage?.listUsd ?? null,
      steps,
      modelCalls: model.length || usage?.calls || 0,
      toolCalls,
      failedSteps: steps.length ? steps.filter((s) => s.failed).length : (usage?.failures?.model ?? 0) + (usage?.failures?.tool ?? 0),
      toolFailures: steps.length ? steps.filter((s) => s.kind === 'tool' && s.failed).length : usage?.failures?.tool ?? 0,
      retries: (usage?.retries?.model ?? 0) + (usage?.retries?.tool ?? 0),
      latency: latencies.length ? { p50: percentile(latencies, 50), p90: percentile(latencies, 90), p99: percentile(latencies, 99) } : { p50: usage?.latencyMs?.p50 ?? null, p90: usage?.latencyMs?.p90 ?? null, p99: usage?.latencyMs?.max ?? null },
      tools,
      busy: steps.filter((s) => s.kind !== 'waiting').reduce((t, s) => t + s.d, 0),
      first: steps.length ? steps[0]!.t : null,
      last: ends.length ? Math.max(...ends) : null,
      restarts: (node.restarts ?? []).map((at) => time(at) - t0).filter(Number.isFinite),
      turns: node.turns ?? null,
      commits: typeof node.shipped === 'number' ? node.shipped : null,
    }
  })
  const byId = new Map(agents.map((a) => [a.id, a]))
  for (const a of agents) if (a.parent) byId.get(a.parent)?.children.push(a.id)
  const startOf = (id: string) => byId.get(id)?.start ?? Number.MAX_SAFE_INTEGER
  for (const a of agents) a.children.sort((x, y) => startOf(x) - startOf(y))
  const root = agents.find((a) => !a.parent) ?? null
  const tree: Agent[] = []
  const seen = new Set<string>()
  const walk = (a: Agent, depth: number) => {
    if (seen.has(a.id)) return
    seen.add(a.id)
    a.depth = depth
    tree.push(a)
    for (const c of a.children) walk(byId.get(c)!, depth + 1)
  }
  for (const a of agents.filter((x) => !x.parent).sort((x, y) => (x.start ?? 0) - (y.start ?? 0))) walk(a, 0)
  for (const a of agents) if (!seen.has(a.id)) walk(a, 0)
  // The longest name prefix (ending at a '-') that half the agents share and at least three: a cut label keeps what
  // tells the agents apart, not the prefix they share.
  const prefixes = new Map<string, number>()
  for (const a of agents) for (let i = a.name.indexOf('-'); i > 0; i = a.name.indexOf('-', i + 1)) prefixes.set(a.name.slice(0, i + 1), (prefixes.get(a.name.slice(0, i + 1)) ?? 0) + 1)
  const shared = [...prefixes].filter(([, n]) => n >= 3 && n * 2 >= agents.length).sort((x, y) => y[0].length - x[0].length)[0]?.[0] ?? ''
  for (const a of agents) a.short = shared && a.name.startsWith(shared) && a.name.length > shared.length ? a.name.slice(shared.length) : a.name
  // A lead with more than eight spawned agents is a team: every agent-scaled view groups its members.
  const teams = agents.filter((a) => a.children.length > 8).map((a) => ({ id: a.id, label: `${a.name} team`, members: a.children }))
  for (const t of teams) for (const m of t.members) byId.get(m)!.team = t.id
  for (const t of teams) byId.get(t.id)!.team ??= t.id
  const steps = agents.flatMap((agent) => agent.steps.map((step) => ({ agent, step }))).sort((a, b) => a.step.t - b.step.t)
  const runTools = new Map<string, { d: number[]; f: number; ms: number }>()
  for (const { step } of steps) {
    if (step.kind !== 'tool' || !step.tool) continue
    const entry = runTools.get(step.tool) ?? { d: [], f: 0, ms: 0 }
    entry.d.push(step.d)
    entry.f += step.failed ? 1 : 0
    entry.ms += step.d
    runTools.set(step.tool, entry)
  }
  const tools = [...runTools].map(([name, t]) => toolStats(name, t.d, t.f, t.ms)).sort((a, b) => b.calls - a.calls)
  const whole = ws.runUsage ?? null
  const sum = (pick: (a: Agent) => number | null) => (agents.some((a) => pick(a) !== null) ? agents.reduce((t, a) => t + (pick(a) ?? 0), 0) : null)
  const lastEnds = steps.map(({ step }) => step.t + step.d)
  const releases = ws.releases.map((r) => ({ ...r, tagged: Boolean(r.taggedAt), taggedAt: r.taggedAt ?? r.at ?? null }))
  return {
    t0,
    duration,
    live: ws.live,
    agents,
    byId,
    root,
    tree,
    teams,
    tools,
    steps,
    totals: {
      steps: steps.length,
      model: steps.filter((s) => s.step.kind === 'model').length,
      tool: steps.filter((s) => s.step.kind === 'tool').length,
      failed: steps.filter((s) => s.step.failed).length,
      toolFailures: steps.filter((s) => s.step.kind === 'tool' && s.step.failed).length,
      retries: (whole?.retries?.model ?? 0) + (whole?.retries?.tool ?? 0),
      tokens: whole?.tokens ?? sum((a) => a.tokens),
      byClass: whole?.byClass ?? null,
      billedUsd: whole?.billedUsd ?? sum((a) => a.billedUsd),
      listUsd: whole?.listUsd ?? null,
      busy: agents.reduce((t, a) => t + a.busy, 0),
      lastStep: lastEnds.length ? Math.max(...lastEnds) : null,
    },
    pauses: (ws.pauses ?? []).map((p) => ({ from: time(p.from) - t0, to: time(p.to) - t0, reason: p.reason })).filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to)),
    releases,
    best: releases.find((r) => r.release === ws.best) ?? null,
    ws,
  }
}

/** Every agent in the subtree of `id`, itself included. */
export function subtree(m: RunModel, id: string): Set<string> {
  const out = new Set<string>()
  const walk = (x: string) => {
    if (out.has(x)) return
    out.add(x)
    for (const c of m.byId.get(x)?.children ?? []) walk(c)
  }
  walk(id)
  return out
}

/** The tool statistics of a set of agents, merged by tool. */
export function mergeTools(agents: readonly Agent[]): ToolStats[] {
  const merged = new Map<string, { d: number[]; f: number; ms: number; calls: number }>()
  for (const a of agents)
    for (const t of a.tools) {
      const entry = merged.get(t.name) ?? { d: [], f: 0, ms: 0, calls: 0 }
      entry.d.push(...t.durations)
      entry.f += t.failures
      entry.ms += t.ms
      entry.calls += t.calls
      merged.set(t.name, entry)
    }
  return [...merged].map(([name, t]) => ({ ...toolStats(name, t.d, t.f, t.ms), calls: t.calls })).sort((a, b) => b.calls - a.calls)
}

// ----- formatting on the run's clock -----
const pad = (n: number) => String(n).padStart(2, '0')
export const clockOf = (t0: number) => (ms: number) => {
  const d = new Date(t0 + ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const clockSecondsOf = (t0: number) => (ms: number) => {
  const d = new Date(t0 + ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
/** `1 step`, `201 steps`. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
/** A span on the run's clock: `09:09–09:31` within one UTC day, else its start and length (`02:38, 23h 55m`), so an end
 * never reads earlier than its start. */
export const spanOf = (t0: number, from: number, to: number | 'now') => {
  const clock = clockOf(t0)
  if (to === 'now') return `${clock(from)}–now`
  return new Date(t0 + from).toISOString().slice(0, 10) === new Date(t0 + to).toISOString().slice(0, 10) ? `${clock(from)}–${clock(to)}` : `${clock(from)}, ${elapsed(to - from)}`
}
/** A UTC time with its day when the run spans more than one: `02:37 UTC` or `Oct 26 02:37 UTC`. */
export const stampOf = (iso: string, days: boolean) => `${days ? `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ` : ''}${iso.slice(11, 16)} UTC`
/** A run length: `8h 58m`, `26 min`, `4m 05s`, `12 s`. */
export function elapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 59_500) return `${(ms / 1000).toFixed(ms < 9_950 ? 1 : 0)} s`
  // Round the whole length first, then split it, so 23h 59m 40s reads 24h 00m and never 23h 60m.
  if (ms < 3_600_000) {
    const total = Math.round(ms / 1000)
    if (total < 3600) return total % 60 ? `${Math.floor(total / 60)}m ${pad(total % 60)}s` : `${total / 60} min`
  }
  const minutes = Math.round(ms / 60_000)
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}
/** A call length, abbr for tables: `796ms`, `9.3s`, `2m00s`. */
export function lat(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 59_500) return `${(ms / 1000).toFixed(ms < 9_950 ? 1 : 0)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${pad(seconds % 60)}s`
  return elapsed(ms)
}
/** An offset into the run: `+0:26:04`. */
export function offset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `+${h ? `${h}:${pad(m)}` : m}:${pad(s % 60)}`
}
export const count = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'))
export const abbr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: n >= 1e8 ? 0 : n >= 1e6 ? 2 : 1 }).format(n)
export const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
