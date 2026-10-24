import { FilePreview } from '@tangle-network/sandbox-ui/files'
import { DiffView } from '@tangle-network/sandbox-ui/workbench'
import { WorkspaceFilesPane } from '@tangle-network/sandbox-ui/workspace'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { useDocument } from './data.js'
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
  const [file, setFile] = useState<{ path: string; text: string; base: string | null } | null>(null)
  useEffect(() => {
    setFile(null)
    if (!path) return
    const controller = new AbortController()
    const read = (ref: string) => fetch(`${runUrl}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`, { signal: controller.signal }).then((response) => (response.ok ? response.text() : null))
    void Promise.all([read(refName), previous ? read(previous) : Promise.resolve(null)])
      .then(([text, base]) => setFile({ path, text: text ?? '', base }))
      .catch(() => undefined)
    return () => controller.abort()
  }, [runUrl, refName, previous, path])
  if (tree.error) return <p className="rw-empty">{tree.status === 404 ? 'No code on this host for this run.' : tree.error}</p>
  if (!tree.data) return <p className="rw-empty">Reading {label}…</p>
  const actions = previous ? (
    <span className="rw-file-modes" role="group" aria-label="Show">
      <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>File</button>
      <button type="button" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>Changes since {previous}</button>
    </span>
  ) : undefined
  const preview = path && file && file.path === path
    ? {
        path,
        actions,
        content: mode === 'diff' && previous ? <DiffView filename={path} baseline={file.base ?? ''} current={file.text} defaultWrap /> : <FilePreview filename={path.split('/').pop() ?? path} content={file.text} hideHeader />,
      }
    : undefined
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
