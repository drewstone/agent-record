import type { ReleaseLineage } from './play-standing.js'

/**
 * The run's workspace document (agent-workspace.run-workspace.v1, tangle-tools run_workspace.py): its agents with their
 * hours, the releases with the commits and files each agent's work put in them, and the code at any release. The run
 * page (run/RunPage) builds its one model from it (run/model).
 */
export interface WorkspaceNode {
  id: string
  label: string
  role: string | null
  assignment: string | null
  harness: string | null
  model: string | null
  status: 'running' | 'waiting' | 'succeeded' | 'failed' | 'stopped' | 'idle' | 'unknown'
  turn: string | null
  lastAt: string | null
  /** From the spawn journal: driver turns, worker restarts (ISO), and its "<label>:" commits in the run's deliverables. */
  turns?: number | null
  restarts?: string[]
  shipped?: number
  /** Its tool calls as the record counts them (nodeStats calls). */
  toolCalls?: number | null
  hasCode: boolean
}
export interface WorkspaceRelease {
  release: string
  commit: string | null
  taggedAt: string | null
  /** When its check ran; the time of a release that was checked but never tagged (test-disposable-smoke rc2). */
  at?: string | null
  /** The check version that scored it (v1, v7). */
  checker?: string | null
  checked: boolean
  passed?: number | null
  total?: number | null
  steps?: { label: string; state: 'pass' | 'fail' | 'undecided' | 'unrun' }[] | null
  sentence?: string | null
}
export interface RunWorkspaceDocument {
  schema: 'agent-workspace.run-workspace.v1'
  runId: string
  live: boolean
  nodes: WorkspaceNode[]
  edges: { from: string; to: string; kind: 'spawn' | 'message' | 'delegation'; count?: number }[]
  releases: WorkspaceRelease[]
  best: string | null
  code: { available: boolean; reason: string | null }
  /** Stretches over 30 min with no agent turn, named by the cancellation that opened them (tangle-tools run_journal). */
  pauses?: { from: string; to: string; reason: string }[]
  /** Where its releases sit in the play (tangle-tools run_workspace.release_lineage). */
  lineage?: ReleaseLineage | null
}
