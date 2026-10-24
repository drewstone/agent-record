import type { HostView } from './workspace/view.js'
// The Discovery overview document's types: served by tangle-tools at `overview`, read by Overview.tsx and answers.ts.
type Bin = { lo: number; hi: number; n: number }
/** The Discovery overview (`agent-workspace.overview.v1`, served at `overview`): runs, findings, tokens, money, the
 * sandbox fleet, storage and subscription seats over its `days`. Every series is aligned to `days`. */
/**
 * A run's lead finding on the overview: a passed play check (`check`: its SOLVED line, else the run's stated answer), else
 * its best result or claim page, a page that states its answer first.
 */
export interface OverviewLead {
  /** `progress`: no check passed, so the run's newest check line and its best score lead (tangle-tools `progress_lead`). */
  title: string | null; kind: 'result' | 'claim' | 'check' | 'progress'; agentLabel?: string | null; at?: string | null; text?: string; sha256?: string | null; runId?: string
  /** A `progress` lead's newest verdict: solved, not-solved or unknown. */
  verdict?: string | null
}
export interface OverviewRun { /** The run's view (views.run_view), for Today. */ view?: HostView;
  runId: string; state: string; startedAt: string | null; activeAt: string | null; agents: number | null; depth: number | null
  results: number; claims: number; findingsPending?: boolean; lead: OverviewLead | null; lostHours: number; listUsd: number; paidUsd: number
  /** Subscription use priced at API list (not billed), model API billed through Router, sandbox compute billed. */
  subscriptionUsd?: number; apiUsd?: number | null; sandboxUsd?: number | null
  play: string; title: string; purpose: string | null; supersedes?: string | null
}
export interface OverviewPlayWeek {
  play: string; title: string; running: number; runs: { runId: string; state: string; startedAt: string | null; lostHours: number }[]; runCount: number
  results: number; claims: number; findingsPending?: number; lead: OverviewLead | null; lostHours: number; listUsd: number; paidUsd: number; lastStartedAt: string | null; lastActiveAt: string | null
  subscriptionUsd?: number; apiUsd?: number | null; sandboxUsd?: number | null; costUnknownRuns?: number
  apiKnownRuns?: number; sandboxKnownRuns?: number
  /** The runs' API-equivalent dollars (each run receipt's cost.apiEquivalentUsd): every token at list price, whoever paid. */
  apiEquivalentUsd?: number | null
}
/** A Needs you line; `held` names a held pass's stages, `dispute` and `referees` an undecided check dispute (tangle-tools overview). */
export interface OverviewAttention { tone: 'crit' | 'warn' | 'info' | 'neutral'; text: string; detail?: string | null; href?: string; owner?: string; next?: string; runId?: string; held?: string[]; dispute?: string; /** What to do, the blocker's kind and since when (views.blocker_action), on a run's needs-you item. */ action?: string | null; kind?: string | null; since?: string | null; /** Drew's choices, each with the command it runs and what follows (views.need_choice). */ options?: { label: string; verdict: string; command: string; consequence: string }[]; consequence?: string | null; /** An item of a play's view (views.play_view): it needs a person whatever its tone. */ needsYou?: boolean; play?: string; referees?: { seat: string | null; family: string | null; verdict: string | null }[] }

export interface OverviewDocument {
  schema: 'agent-workspace.overview.v1'
  now?: OverviewRun[]
  week?: OverviewPlayWeek[]
  weekDays?: number
  attention?: OverviewAttention[]
  /** Each play active this week as its view (views.play_view), newest first. */
  plays?: { play: string; title: string; view: HostView }[]
  composedAt: string
  /** When the running runs were read (change 1); the rest of the overview is as of `composedAt`. */
  runningAt?: string | null
  days: string[]
  state: { standdown: { reason?: string; by?: string; at?: string } | null; lastRunStart: string | null; running: number; queued: number; sandboxesRunning: number | null; sandboxesByKind: Record<string, number>; boxesUnreleased: number | null; censusAt: string | null }
  runs: { byDay: Record<string, number[]>; total: number; causes: [string, number][]; depth: [string, number][]; agentsHistogram: Bin[]; lostHoursHistogram: Bin[]; lostHours: number; lostByDay?: Record<string, number[]>; scope?: string }
  findings: { byDay: Record<string, number[]>; runsByDay?: number[]; runsWithFindings: number; claims: number; pending?: number; pendingByDay?: number[] }
  tokens: {
    byDay: { input: number[]; output: number[]; cacheRead: number[]; cacheWrite: number[] }
    harness: { harness: string; agents: number; measured: number; output: number; list: number }[]
    agentOutputHistogram: Bin[]
    topPlays: { play: string; output: number; input: number; cacheRead: number; list: number; paid: number; subscription?: number; api?: number | null; sandbox?: number | null; apiKnown?: number; sandboxKnown?: number; runs: number; claims: number }[]
  }
  money: {
    costByDay?: { subscription: (number | null)[]; otherList: (number | null)[]; api: (number | null)[]; sandbox: (number | null)[] }
    costTotals?: { subscription: number; otherList: number; api: number; sandbox: number }
    costRuns?: { counted: number; snapshots: number; subscription: number; otherList: number; api: number; sandbox: number }
    infra?: {
      schema: 'discovery-infra-cost.v1'; generatedAt: string; window: { from: string | null; to: string; basis?: string }
      totals: { hostUsd: number | null; volumeUsd: number | null; snapshotUsd: number | null; r2Usd: number | null; r2ListUsd?: number | null; r2StorageListUsd?: number | null; r2OperationsListUsd?: number | null; r2EgressUsd?: number | null; egressBytes: number | null; egressUsd: number | null; r2DownloadBytesLowerBound?: number | null }
      byDay: { date: string; hostUsd: number | null; volumeUsd: number | null; snapshotUsd: number | null; r2Usd: number | null; r2ListUsd?: number | null; r2StorageListUsd?: number | null; r2OperationsListUsd?: number | null; r2ClassARequests?: number | null; r2ClassBRequests?: number | null; r2EgressUsd?: number | null; egressBytes: number | null; egressUsd: number | null; r2DownloadBytesLowerBound?: number | null }[]
      hosts: { id: number | string; name: string | null; monthlyUsd: number | null; discoverySidecars?: number; discoveryShare: number | null; discoveryUsd: number | null; outgoingBytes: number | null; includedTrafficBytes?: number | null; egressUsd: number | null }[]
      storage: { volumes: unknown[]; hetznerSnapshots: unknown[]; r2Buckets: unknown[]; traces: { path: string; usedBytes: number | null; usd: number | null } | null }
      runs: { runId: string; hostUsd: number | null; storageUsd: number | null; egressBytes: number | null; egressUsd: number | null }[]
      gaps: { code: string; detail: string }[]
      reconciliation?: { status: string; period: string; billedUsd: number | null; estimatedUsd: number | null; reason: string; priorBillEvidence: { vendor: string; item: string; monthlyUsd: number; asOf: string }[] }
      sources?: Record<string, unknown>
    }
    listByDay: number[]; paidByDay: number[]; listTotal: number; paidTotal: number; runListHistogram: Bin[]; runPaidHistogram: Bin[]; fleetKey: { cap: number | null; spent: number | null; debits48h: number | null; history?: [number, number][] } }
  fleet: {
    hosts: { name: string; type: string; active: number; parked: number; capacity: number; cpu: number | null; memory: number | null; monthlyUsd: number | null; autoScaled: boolean; draining: boolean }[]
    utilization: Record<string, number>
    totals: Record<string, number | null>
    waste: { label: string; boxes: number; hours: number | null; waste: boolean }[]
    reaper: Record<string, number>
    history: [number, number, number, number, number][]
  }
  storage: { volume: { path: string; total: number; used: number; free: number } | null; recordsBytes: number | null; byProgram: [string, number][]; runSizeHistogram: Bin[] }
  seats: { now: { tool: string; email: string; status: string; h5: number | null; d7: number | null }[]; history: Record<string, [number, number][]> }
}
