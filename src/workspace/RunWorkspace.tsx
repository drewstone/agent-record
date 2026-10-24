import { FilePreview } from '@tangle-network/sandbox-ui/files'
import { WorkspaceFilesPane } from '@tangle-network/sandbox-ui/workspace'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { useDocument } from './data.js'
import { RefDiff, useRefFile } from './ref-file.js'
import { RunJourney } from './RunJourney.js'
import { usePhone } from './use-phone.js'

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
  tokens: number | null
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
}

/** The code at a ref (an agent's branch or a release), its tree and one file, with a diff against the previous release. */
export function CodePane({ runUrl, refName, previous, label }: { runUrl: string; refName: string; previous: string | null; label: string }) {
  const tree = useDocument<{ commit: string; paths: string[]; cut: boolean }>(`${runUrl}/tree?ref=${encodeURIComponent(refName)}`)
  const [path, setPath] = useState<string | null>(null)
  const [mode, setMode] = useState<'file' | 'diff'>('file')
  // Read through the verified reader: a failed or unverified read is an error, never an empty file (root 10478 review).
  const file = useRefFile(runUrl, refName, path)
  if (tree.error) return <p className="rw-empty">{tree.status === 404 ? 'No code on this host for this run.' : tree.error}</p>
  if (!tree.data) return <p className="rw-empty">Reading {label}…</p>
  const actions = previous ? (
    <span className="rw-file-modes" role="group" aria-label="Show">
      <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>File</button>
      <button type="button" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>Changes since {previous}</button>
    </span>
  ) : undefined
  const content = !path ? null
    : mode === 'diff' && previous ? <RefDiff key={`${previous}:${path}`} runUrl={runUrl} base={previous} head={refName} path={path} />
    : file.state === 'error' ? <p className="rw-empty" role="alert">{file.error}</p>
    : file.state === 'absent' ? <p className="rw-empty">This file is not in {label}.</p>
    : file.state === 'ready' ? <FilePreview filename={path.split('/').pop() ?? path} content={file.text} hideHeader />
    : <p className="rw-empty" role="status">Reading {path}…</p>
  const preview = path ? { path, actions, content } : undefined
  return (
    <WorkspaceFilesPane
      paths={tree.data.paths}
      selectedPath={path ?? undefined}
      onSelect={(next) => setPath(next)}
      onBack={() => setPath(null)}
      preview={preview}
      search
      label={`${label} · ${tree.data.paths.length.toLocaleString()} files${tree.data.cut ? ' (first shown)' : ''}`}
      expansionKey={refName}
      surface="plain"
    />
  )
}

type RunWorkspaceProps = { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode }

export function RunWorkspace({ api, doc, transcript }: RunWorkspaceProps) {
  return <RunJourney api={api} doc={doc} transcript={transcript} phone={usePhone()} />
}
