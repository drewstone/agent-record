import { FilePreview } from '@tangle-network/sandbox-ui/files'
import { WorkspaceFilesPane } from '@tangle-network/sandbox-ui/workspace'
import { type ReactNode, useState } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { useDocument } from './data.js'
import { atQuery, RefDiff, type RefTree, useRefFile } from './ref-file.js'
import { RunJourney } from './RunJourney.js'

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

/**
 * The code editor frame (Drew 2026-10-25: "a unified editor view, [FileDirViewer | Editor] in one view frame, expandable"):
 * the tree at a ref (a release, or an agent's branch) read once and pinned, as it stood at `at` when the page's time cursor
 * is set, beside a read-only editor with a tab per opened file and a diff against `previous`. The open file lives in this
 * frame's state, never in the route: a file click stays on the page (lead gate 3). `initial` opens first, then a README.
 */
export function CodePane({ runUrl, refName, previous, label, at = null, initial = null }: { runUrl: string; refName: string; previous: string | null; label: string; at?: string | null; initial?: string | null }) {
  const tree = useDocument<RefTree>(`${runUrl}/tree?ref=${encodeURIComponent(refName)}${atQuery(at)}`)
  const [chosen, setChosen] = useState<string | null>(null)
  const paths = tree.data?.paths ?? []
  const path = chosen && paths.includes(chosen) ? chosen : [initial, 'README.md'].find((p): p is string => Boolean(p && paths.includes(p))) ?? null
  const file = useRefFile(runUrl, refName, path, tree.data, at)
  if (tree.error) return <p className="rw-empty">{tree.status === 404 ? `No code for ${label} on this host${at ? ' by then' : ''}.` : tree.error}</p>
  if (!tree.data) return <p className="rw-empty" role="status">Reading {label}…</p>
  const content = !path ? null
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
      onSelect={(next) => { if (tree.data!.paths.includes(next)) setChosen(next) }}
      onBack={() => setChosen(null)}
      preview={path ? { path, content, ...(previous ? { compare: { label: previous, content: <RefDiff key={`${previous}:${path}`} runUrl={runUrl} base={previous} head={refName} path={path} headTree={tree.data} at={at} /> } } : {}) } : undefined}
      search
      label={`${label} at ${tree.data.commit.slice(0, 12)} · ${tree.data.paths.length.toLocaleString()} files${tree.data.cut ? ' (first shown)' : ''}`}
      expansionKey={`${refName}:${tree.data.commit}`}
      surface="plain"
    />
  )
}

type RunWorkspaceProps = { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode }

export function RunWorkspace({ api, doc, transcript }: RunWorkspaceProps) {
  return <RunJourney api={api} doc={doc} transcript={transcript} />
}
