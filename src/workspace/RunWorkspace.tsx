import { FilePreview } from '@tangle-network/sandbox-ui/files'
import { WorkspaceFilesPane } from '@tangle-network/sandbox-ui/workspace'
import type { ReactNode } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { useDocument } from './data.js'
import { useSearch } from './navigation.js'
import { RefDiff, type RefTree, useRefFile } from './ref-file.js'
import type { ReleaseLineage } from './play-standing.js'
import { RunJourney } from './RunJourney.js'
import type { Play } from './answers.js'

/**
 * The run's workspace document (agent-workspace.run-workspace.v1, tangle-tools run_workspace.py): its agents with their
 * hours, the releases with the commits and files each agent's work put in them, and the code at any release. The run
 * page draws it as the journey (RunJourney); the code pane below browses a release's files.
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

/** The code at a ref (an agent's branch or a release), its tree and one file, with a diff against the previous release. */
/**
 * The code at a ref (a release or branch): its tree once, pinned, and every file read and diff at that tree's commit.
 * The selected file and view live in the URL (codeFile, codeView), like the artifacts pane's, so a link or reload keeps them.
 */
export function CodePane({ runUrl, refName, previous, label }: { runUrl: string; refName: string; previous: string | null; label: string }) {
  const tree = useDocument<RefTree>(`${runUrl}/tree?ref=${encodeURIComponent(refName)}`)
  const [params, update] = useSearch()
  const path = params.get('codeFile')
  const mode = params.get('codeView') === 'diff' && previous ? 'diff' : 'file'
  const file = useRefFile(runUrl, refName, path, tree.data)
  if (tree.error) return <p className="rw-empty">{tree.status === 404 ? 'No code on this host for this run.' : tree.error}</p>
  if (!tree.data) return <p className="rw-empty">Reading {label}…</p>
  const actions = previous ? (
    <span className="rw-file-modes" role="group" aria-label="Show">
      <button type="button" aria-pressed={mode === 'file'} onClick={() => update({ codeView: null })}>File</button>
      <button type="button" aria-pressed={mode === 'diff'} onClick={() => update({ codeView: 'diff' })}>Changes since {previous}</button>
    </span>
  ) : undefined
  const content = !path ? null
    : mode === 'diff' ? <RefDiff key={`${previous}:${path}`} runUrl={runUrl} base={previous} head={refName} path={path} headTree={tree.data} />
    : file.state === 'error' ? <p className="rw-empty" role="alert">{file.error}</p>
    : file.state === 'absent' ? <p className="rw-empty">This file is not in {label}.</p>
    : file.state === 'binary' ? <p className="rw-empty">This file is not text, so it has no inline preview. <a href={file.href} download={path.split('/').pop()}>Download it at {file.commit.slice(0, 12)}</a>.</p>
    : file.state === 'ready' ? <FilePreview filename={path.split('/').pop() ?? path} content={file.text} hideHeader />
    : <p className="rw-empty" role="status">Reading {path}…</p>
  return (
    <WorkspaceFilesPane
      paths={tree.data.paths}
      selectedPath={path ?? undefined}
      // The pane reports folder clicks too (trailing `/`, it expands them itself); only a listed file is opened.
      onSelect={(next) => { if (tree.data!.paths.includes(next)) update({ codeFile: next }) }}
      onBack={() => update({ codeFile: null, codeView: null })}
      preview={path ? { path, actions, content } : undefined}
      search
      label={`${label} at ${tree.data.commit.slice(0, 12)} · ${tree.data.paths.length.toLocaleString()} files${tree.data.cut ? ' (first shown)' : ''}`}
      expansionKey={`${refName}:${tree.data.commit}`}
      surface="plain"
      // Drew's layout gate 3: the code is a [tree | editor] frame at 70vh with tabs (sandbox-ui 0.138.0 layout='split').
      layout="split"
      style={{ height: '70vh' }}
    />
  )
}

type RunWorkspaceProps = { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode; play?: Play | null }

export function RunWorkspace(props: RunWorkspaceProps) {
  return <RunJourney {...props} />
}
