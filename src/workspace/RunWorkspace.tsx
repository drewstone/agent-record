import { FilePreview } from '@tangle-network/sandbox-ui/files'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@tangle-network/sandbox-ui/primitives'
import { DiffView } from '@tangle-network/sandbox-ui/workbench'
import { WorkspaceFilesPane, WorkspaceLayout } from '@tangle-network/sandbox-ui/workspace'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { StatusPill, useDocument } from './data.js'
import type { ReactNode } from 'react'
import { shortRun } from './play-standing.js'
import { viewAsOf, viewChip } from './view.js'
import { AsOfStamp } from './AnswerStrip.js'

/**
 * The run as a workspace (agent-workspace.run-workspace.v1, tangle-tools run_workspace.py): its agents on the left, the
 * selected agent's transcript in the centre, the code it or a release holds on the right, and the releases along the
 * bottom. Selecting an agent scopes the transcript and the files; selecting a release shows that release's code and its
 * changes since the release before it.
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

const STATUS_WORD: Record<WorkspaceNode['status'], [string, 'pass' | 'attention' | 'fail' | 'neutral', string]> = {
  running: ['running', 'attention', '▶'],
  waiting: ['waiting', 'attention', '◷'],
  succeeded: ['done', 'pass', '✓'],
  failed: ['failed', 'fail', '✕'],
  stopped: ['stopped', 'neutral', '■'],
  idle: ['idle', 'neutral', '○'],
  unknown: ['unknown', 'neutral', '○'],
}
const nodeChip = (status: WorkspaceNode['status']) => {
  const [word, tone, shape] = STATUS_WORD[status] ?? STATUS_WORD.unknown
  return { axis: 'agent' as const, word, tone, shape }
}

/** The agents as a tree list: the lead first, its workers under it; the phone shows this in place of the graph. */
function AgentList({ doc, selected, onSelect }: { doc: RunWorkspaceDocument; selected: string; onSelect: (id: string) => void }) {
  const messages = new Map(doc.edges.filter((edge) => edge.kind === 'message').map((edge) => [edge.to, edge.count ?? 1]))
  const depth = useMemo(() => {
    const parent = new Map(doc.edges.filter((edge) => edge.kind === 'spawn').map((edge) => [edge.to, edge.from]))
    const of = (id: string): number => (parent.has(id) ? 1 + of(parent.get(id)!) : 0)
    return new Map(doc.nodes.map((node) => [node.id, of(node.id)]))
  }, [doc])
  return (
    <ol className="rw-agents" aria-label="Agents">
      {doc.nodes.map((node) => (
        <li key={node.id} style={{ ['--depth' as string]: depth.get(node.id) ?? 0 }}>
          <button type="button" aria-pressed={node.id === selected} onClick={() => onSelect(node.id)} data-agent={node.id}>
            <span className="rw-agent-head">
              <b>{node.role ?? node.label}</b>
              <StatusPill status={nodeChip(node.status)} />
            </span>
            <span className="rw-agent-meta">{[node.label, node.harness, node.model, messages.get(node.id) ? `${messages.get(node.id)} message${messages.get(node.id) === 1 ? '' : 's'} from the lead` : null].filter(Boolean).join(' · ')}</span>
            {node.turn && <span className="rw-agent-turn">{node.turn}</span>}
          </button>
        </li>
      ))}
    </ol>
  )
}

/** The releases in order, each with its check steps; the selected one's code shows on the right. */
function ReleaseTimeline({ releases, best, selected, onSelect }: { releases: WorkspaceRelease[]; best: string | null; selected: string | null; onSelect: (release: string) => void }) {
  if (!releases.length) return <p className="rw-empty">No release yet.</p>
  return (
    <ol className="rw-releases" aria-label="Releases">
      {releases.map((release) => (
        <li key={release.release}>
          <button type="button" aria-pressed={release.release === selected} onClick={() => onSelect(release.release)} title={release.sentence ?? 'not checked'} data-release={release.release}>
            <span className="rw-release-name">
              {release.release}
              {release.release === best && <i className="rw-best">best</i>}
            </span>
            {release.steps?.length ? (
              <span className="rw-release-steps" aria-label={release.sentence ?? undefined}>
                {release.steps.map((step, i) => <i key={i} data-step={step.state} />)}
              </span>
            ) : (
              <span className="rw-release-steps is-unchecked">not checked</span>
            )}
            <span className="rw-release-count">{release.total ? `${release.passed}/${release.total}` : '—'}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/** The code at a ref (an agent's branch or a release), its tree and one file, with a diff against the previous release. */
function CodePane({ runUrl, refName, previous, label }: { runUrl: string; refName: string; previous: string | null; label: string }) {
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

const PHONE = '(max-width: 1023px)'
/** Whether the page is phone-width: the workspace stacks there, and an agent opens as a full-screen sheet. */
function usePhone() {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(PHONE)
      query.addEventListener('change', change)
      return () => query.removeEventListener('change', change)
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  )
}

export function RunWorkspace({ api, doc, transcript }: { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode }) {
  const runUrl = `${api}/runs/${encodeURIComponent(doc.run.id)}`
  const workspace = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, doc.execution?.alive ? 15_000 : undefined, true)
  const [agent, setAgent] = useState<string>(doc.run.id)
  const [release, setRelease] = useState<string | null>(null)
  const data = workspace.data
  const best = data?.best ?? data?.releases.at(-1)?.release ?? null
  const node = data?.nodes.find((item) => item.id === agent) ?? null
  // The right pane shows the selected release, else the selected agent's own branch, else the best release.
  const refName = release ?? (node?.hasCode ? agent : best) ?? 'main'
  const shownRelease = release ?? (node?.hasCode ? null : best)
  const index = data?.releases.findIndex((item) => item.release === shownRelease) ?? -1
  const previous = index > 0 ? data!.releases[index - 1]!.release : null
  const codeLabel = shownRelease ? `Release ${shownRelease}` : `${node?.role ?? node?.label ?? 'Agent'}'s branch`
  const view = doc.view
  const phone = usePhone()
  const [sheet, setSheet] = useState<'transcript' | 'files' | null>(null)
  return (
    <section className="rw" data-run-workspace>
      <header className="rw-head">
        <nav className="crumbs" aria-label="Breadcrumb"><a href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a></nav>
        <div className="rw-title">
          <h1>Run {shortRun(doc.run.play, doc.run.id)}</h1>
          {view && <StatusPill status={viewChip(view.status)} />}
          {view && <AsOfStamp asOf={viewAsOf(view)} />}
        </div>
        {view && <p className="rw-sentence" data-field="view.sentence">{view.sentence}</p>}
      </header>
      {data && phone ? (
        <div className="rw-phone">
          <section aria-label="Releases">
            <h2 className="rw-pane-title">Releases · {data.releases.length}{best ? ` · best ${best}` : ''}</h2>
            <ReleaseTimeline releases={data.releases} best={best} selected={shownRelease} onSelect={(next) => { setRelease(next); setSheet('files') }} />
          </section>
          <section aria-label="Agents">
            <h2 className="rw-pane-title">Agents · {data.nodes.length}</h2>
            <AgentList doc={data} selected={agent} onSelect={(id) => { setAgent(id); setRelease(null); setSheet('transcript') }} />
          </section>
          <Sheet open={sheet !== null} onOpenChange={(open) => setSheet(open ? (sheet ?? 'transcript') : null)}>
            <SheetContent side="bottom" className="rw-sheet agent-record ar-ws">
              <SheetHeader>
                <SheetTitle>{shownRelease && sheet === 'files' && release ? `Release ${shownRelease}` : node ? `${node.role ?? node.label}` : 'Agent'}</SheetTitle>
                <span className="rw-file-modes" role="group" aria-label="Show">
                  <button type="button" aria-pressed={sheet === 'transcript'} onClick={() => setSheet('transcript')}>Transcript</button>
                  <button type="button" aria-pressed={sheet === 'files'} onClick={() => setSheet('files')}>Files</button>
                </span>
              </SheetHeader>
              <div className="rw-sheet-body">
                {sheet === 'files'
                  ? data.code.available ? <CodePane key={refName} runUrl={runUrl} refName={refName} previous={shownRelease ? previous : null} label={codeLabel} /> : <p className="rw-empty">No code on this host: {data.code.reason}</p>
                  : <div className="rw-transcript">{transcript(agent, (id) => { setAgent(id); setRelease(null) })}</div>}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      ) : !data ? (
        <p className="rw-empty">{workspace.error ? `The workspace is unavailable: ${workspace.error}` : 'Reading the run’s agents and releases…'}</p>
      ) : (
        <div className="rw-frame">
          <WorkspaceLayout
            density="compact"
            persistenceKey="disco-run-workspace"
            defaultLeftWidth={320}
            defaultRightWidth={480}
            defaultBottomHeight={112}
            minCenterWidth={360}
            leftLabel="Agents"
            rightLabel="Files"
            bottomLabel="Releases"
            leftHeader={<span className="rw-pane-title">Agents · {data.nodes.length}</span>}
            left={<AgentList doc={data} selected={agent} onSelect={(id) => { setAgent(id); setRelease(null) }} />}
            centerHeader={<span className="rw-pane-title">{node ? `${node.role ?? node.label}${node.harness ? ` · ${node.harness}` : ''}${node.model ? ` · ${node.model}` : ''}` : 'Transcript'}</span>}
            center={<div className="rw-transcript">{transcript(agent, (id) => { setAgent(id); setRelease(null) })}</div>}
            rightHeader={<span className="rw-pane-title">{codeLabel}</span>}
            right={data.code.available ? <CodePane key={refName} runUrl={runUrl} refName={refName} previous={shownRelease ? previous : null} label={codeLabel} /> : <p className="rw-empty">No code on this host: {data.code.reason}</p>}
            bottomHeader={<span className="rw-pane-title">Releases · {data.releases.length}{best ? ` · best ${best}` : ''}</span>}
            bottom={<ReleaseTimeline releases={data.releases} best={best} selected={shownRelease} onSelect={setRelease} />}
            defaultLeftOpen
            defaultRightOpen
            defaultBottomOpen
          />
        </div>
      )}
    </section>
  )
}
