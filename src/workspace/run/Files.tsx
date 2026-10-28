import { useEffect, useMemo, useState } from 'react'
import { FilePreview, resolveFilePreviewKind } from '@tangle-network/sandbox-ui/files'
import { WorkspaceFilesPane } from '@tangle-network/sandbox-ui/workspace'
import { Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@tangle-network/ui/primitives'
import { byteSize } from '../final-output.js'
import { useDocument } from '../data.js'
import { readRunFiles, runFileHref, type RunFile } from '../run-files.js'
import { RefDiff, useRefFile } from '../ref-file.js'
import { useFileText } from '../use-file-text.js'
import { usePhone } from '../use-phone.js'
import { agentParam, agentFromParam, type TabProps } from './RunPage.js'
import type { Agent } from './model.js'
import { agentOptions, Icon, Picker } from './ui.js'

type Diff = { base: string; head: string; baseCommit: string; commit: string; cut: boolean; files: { path: string; additions: number; deletions: number }[] }
type Entry =
  | { key: string; kind: 'page'; tree: string; path: string; file: RunFile }
  | { key: string; kind: 'code'; tree: string; path: string; agent: Agent; status: 'A' | 'M'; additions: number; deletions: number; diff: Diff }

const PAGES = 'Pages'
const CODE = 'Code'
/** An agent branch's folder in the tree: its name, unique among the run's agents. */
const folder = (a: Agent) => a.name.replaceAll('/', '∕')

/** Every changed file of each agent branch against main, read once per branch (the run's code, not its whole checkout). */
function useBranchDiffs(runUrl: string, agents: Agent[]) {
  const [diffs, setDiffs] = useState<Map<string, Diff | { error: string }>>(new Map())
  const key = agents.map((a) => a.id).join('|')
  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    for (const a of agents)
      fetch(`${runUrl}/diff?base=main&head=${encodeURIComponent(a.id)}`, { credentials: 'same-origin', signal: controller.signal })
        .then(async (r) => (r.ok ? ((await r.json()) as Diff) : { error: `HTTP ${r.status}` }))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'request failed' }))
        .then((value) => { if (alive) setDiffs((current) => new Map(current).set(a.id, value)) })
    return () => { alive = false; controller.abort() }
  }, [runUrl, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return diffs
}

/**
 * What the run left: its retained pages and every file each agent branch changed against main, in one framed tree and
 * editor (sandbox-ui WorkspaceFilesPane). The open file's metadata (path, size, author, commit, hash, history) lives in its
 * Provenance popover, not in strips around the document.
 */
export function Files({ api, runUrl, doc, m, route }: TabProps) {
  const inventory = useDocument<unknown>(`${runUrl}/files`, m.live ? 15_000 : undefined)
  const pages = useMemo(() => {
    if (!inventory.data) return null
    try { return readRunFiles(inventory.data, doc.run.id, null, api) } catch { return null }
  }, [inventory.data, doc.run.id, api])
  const coders = useMemo(() => m.tree.filter((a) => a.node.hasCode).slice(0, 40), [m])
  const scope = agentFromParam(m, doc.run.id, route.params.get('scope')) ?? (route.params.get('scope') === 'pages' ? 'pages' : null)
  const shown = useMemo(() => (scope === 'pages' ? [] : scope ? coders.filter((a) => a.id === scope) : coders), [coders, scope])
  const diffs = useBranchDiffs(runUrl, shown)
  const main = useDocument<{ paths: string[] }>(`${runUrl}/tree?ref=main`)
  const entries = useMemo(() => {
    const out: Entry[] = []
    if (scope === null || scope === 'pages')
      for (const file of pages?.items ?? []) out.push({ key: `page:${file.path}`, kind: 'page', tree: `${PAGES}/${file.path.replace(/^pages\//, '')}`, path: file.path, file })
    const onMain = new Set(main.data?.paths ?? [])
    for (const a of shown) {
      const diff = diffs.get(a.id)
      if (!diff || 'error' in diff) continue
      for (const f of diff.files) out.push({ key: `code:${agentParam(doc.run.id, a.id)}:${f.path}`, kind: 'code', tree: `${CODE}/${folder(a)}/${f.path}`, path: f.path, agent: a, status: onMain.has(f.path) ? 'M' : 'A', additions: f.additions, deletions: f.deletions, diff })
    }
    return out
  }, [pages, shown, diffs, main.data, scope, doc.run.id])
  const byTree = useMemo(() => new Map(entries.map((e) => [e.tree, e])), [entries])
  // Each branch file's mark against main: A added, M modified (sandbox-ui 1.1.0 draws them in the tree).
  const status = useMemo(() => Object.fromEntries(entries.filter((e) => e.kind === 'code').map((e) => [e.tree, e.kind === 'code' && e.status === 'A' ? 'added' as const : 'modified' as const])), [entries])
  const asked = route.params.get('file')
  // Side by side, the first file opens with the tree; on a phone the tree comes first, and Back returns to it.
  const phone = usePhone('(max-width: 720px)')
  const open = entries.find((e) => e.key === asked) ?? (asked || phone ? null : entries[0] ?? null)
  const loading = !pages && !inventory.error ? 'Reading the retained files…' : shown.some((a) => !diffs.has(a.id)) && !entries.length ? 'Reading the agent branches…' : null
  // A branch's count is the files it changed against main.
  // A branch the host cannot read says so, rather than open to nothing (22a: nine branches answered 404).
  const scopeOptions = agentOptions(m, (a) => a.node.hasCode, (a) => { const d = diffs.get(a.id); return !d ? '' : 'error' in d ? 'not retained' : `${d.files.length} changed` })
  const scopePicker = (
    <Picker label="Files written by" options={[{ id: 'pages', label: 'Pages', meta: pages ? `${pages.items.length} pages` : '' }, ...scopeOptions]} all={{ label: 'Pages and every branch' }} value={scope} placeholder={`Search ${coders.length} branches`} width={300} className="rp-fscope"
      onChange={(value) => route.go('files', { scope: value === 'pages' ? 'pages' : value ? agentParam(doc.run.id, value) : null, file: null })}>
      {scope === 'pages' ? 'Pages' : scope ? (m.byId.get(scope)?.name ?? 'Branch') : 'All files'}
    </Picker>
  )
  return (
    <div className="rp-files">
      <WorkspaceFilesPane
        paths={entries.map((e) => e.tree)}
        status={status}
        selectedPath={open?.tree}
        onSelect={(path) => { const hit = byTree.get(path); if (hit) route.go('files', { file: hit.key }) }}
        onBack={() => route.go('files', { file: null })}
        headerActions={scopePicker}
        search
        label="Files"
        expansionKey={`${doc.run.id}:files`}
        emptyState={<p className="ws-status" role={inventory.error ? 'alert' : 'status'}>{inventory.error ? `The retained files are unavailable: ${inventory.error}` : loading ?? 'This run left no pages and no branch changed a file.'}</p>}
        preview={open ? { path: open.tree, ...reader(open, runUrl, route.href('files', { file: open.key })) } : undefined}
        style={{ height: '100%' }}
      />
    </div>
  )
}

function reader(entry: Entry, runUrl: string, link: string) {
  return { actions: <FileActions entry={entry} runUrl={runUrl} link={link} />, content: <FileBody key={entry.key} entry={entry} runUrl={runUrl} /> }
}

const useView = () => {
  const [view, setView] = useState<'preview' | 'source' | 'diff'>(() => {
    const asked = new URLSearchParams(window.location.search).get('fileView')
    return asked === 'source' || asked === 'diff' ? asked : 'preview'
  })
  useEffect(() => {
    const changed = (event: Event) => setView((event as CustomEvent<'preview' | 'source' | 'diff'>).detail)
    window.addEventListener('rp-file-view', changed)
    return () => window.removeEventListener('rp-file-view', changed)
  }, [])
  const set = (next: 'preview' | 'source' | 'diff') => {
    const params = new URLSearchParams(window.location.search)
    next === 'preview' ? params.delete('fileView') : params.set('fileView', next)
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    window.dispatchEvent(new CustomEvent('rp-file-view', { detail: next }))
  }
  return [view, set] as const
}

function FileActions({ entry, runUrl, link }: { entry: Entry; runUrl: string; link: string }) {
  const [view, setView] = useView()
  const [copied, setCopied] = useState(false)
  const name = entry.path.split('/').pop() ?? entry.path
  const kind = resolveFilePreviewKind(entry.path)
  const rich = kind === 'markdown' || kind === 'csv'
  const options = [...(rich ? [{ value: 'preview' as const, label: 'Preview' }, { value: 'source' as const, label: 'Source' }] : []), ...(entry.kind === 'code' ? [{ value: 'diff' as const, label: 'Changes' }] : [])]
  const href = entry.kind === 'page' ? runFileHref(entry.file) : `${runUrl}/blob?ref=${encodeURIComponent(entry.agent.id)}&path=${encodeURIComponent(entry.path)}`
  return (
    <span className="rp-factions">
      {options.length > 1 && <SegmentedControl aria-label="File view" value={options.some((o) => o.value === view) ? view : options[0]!.value} onValueChange={setView} options={options} />}
      <span className="rp-group ph-hide">
        {href && <a className="rp-btn ic" href={href} download={name} aria-label={`Download ${name}`} title="Download"><Icon name="download" /></a>}
        <button type="button" className="rp-btn ic" aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'} onClick={() => { void navigator.clipboard?.writeText(new URL(link, window.location.href).toString()).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }}>
          <Icon name={copied ? 'check' : 'link'} />
        </button>
        <Popover>
          <PopoverTrigger asChild><button type="button" className="rp-btn ic" aria-label="Provenance" title="Provenance"><Icon name="info" /></button></PopoverTrigger>
          <PopoverContent className="rp-pop" align="end"><Provenance entry={entry} /></PopoverContent>
        </Popover>
      </span>
    </span>
  )
}

function Provenance({ entry }: { entry: Entry }) {
  const name = entry.path.split('/').pop()
  if (entry.kind === 'page') {
    const f = entry.file as RunFile & { at?: string | null; author?: string | null }
    return (
      <>
        <div className="ph"><b>{name}</b><span>{entry.path}</span></div>
        <div className="pb"><dl>
          <dt>Source</dt><dd>{f.source === 'knowledge' ? "Knowledge page in the run's pages" : f.source}</dd>
          <dt>Size</dt><dd>{byteSize(f.bytes)}</dd>
          <dt>{f.sha256 ? 'SHA-256' : 'Git blob'}</dt><dd className="mono">{f.sha256 ?? f.objectId ?? 'not recorded'}</dd>
          {(f.alternates?.length ?? 0) > 0 && <><dt>Versions</dt><dd>{(f.alternates?.length ?? 0) + 1} retained copies share this path</dd></>}
        </dl></div>
      </>
    )
  }
  return (
    <>
      <div className="ph"><b>{name}</b><span>{entry.path}</span></div>
      <div className="pb"><dl>
        <dt>Branch</dt><dd>{entry.agent.name}</dd>
        <dt>Commit</dt><dd className="mono">{entry.diff.commit.slice(0, 12)}</dd>
        <dt>Against main</dt><dd>{entry.status === 'A' ? 'added' : 'modified'} · <span className="ok">+{entry.additions.toLocaleString('en-US')}</span> <span className="f">−{entry.deletions.toLocaleString('en-US')}</span> · base <span className="mono">{entry.diff.baseCommit.slice(0, 8)}</span></dd>
      </dl></div>
    </>
  )
}

function FileBody({ entry, runUrl }: { entry: Entry; runUrl: string }) {
  const [view] = useView()
  const name = entry.path.split('/').pop() ?? entry.path
  const kind = resolveFilePreviewKind(entry.path)
  const rich = kind === 'markdown' || kind === 'csv'
  const binary = ['image', 'pdf', 'video', 'audio', 'spreadsheet', 'binary'].includes(kind)
  const pageHref = entry.kind === 'page' ? runFileHref(entry.file) : null
  const page = useFileText(entry.kind === 'page' && !binary ? pageHref : null)
  const code = useRefFile(runUrl, entry.kind === 'code' ? entry.agent.id : null, entry.kind === 'code' ? entry.path : null)
  const shownName = view === 'source' && rich ? `${name}.txt` : name
  if (entry.kind === 'code' && view === 'diff') return <div className="rp-doc"><RefDiff runUrl={runUrl} base={entry.status === 'A' ? null : 'main'} head={entry.agent.id} path={entry.path} /></div>
  if (entry.kind === 'page') {
    if (binary && pageHref) return <div className="rp-doc"><FilePreview filename={name} blobUrl={pageHref} size={entry.file.bytes ?? undefined} hideHeader /></div>
    if (page.error) return <p className="ws-status" role="alert">{page.error}</p>
    if (page.text === undefined) return <p className="ws-status" role="status">Reading {name}…</p>
    return <div className={`rp-doc${view === 'source' || !rich ? ' code' : ''}`}><FilePreview filename={shownName} content={page.text} hideHeader /></div>
  }
  if (code.state === 'error') return <p className="ws-status" role="alert">{code.error}</p>
  if (code.state === 'absent') return <p className="ws-status">This file is not on the branch any more.</p>
  if (code.state === 'binary') return <p className="ws-status">This file is not text. <a href={code.href} download={name}>Download it at {code.commit.slice(0, 12)}</a>.</p>
  if (code.state !== 'ready') return <p className="ws-status" role="status">Reading {name}…</p>
  return <div className={`rp-doc${view === 'source' || !rich ? ' code' : ''}`}><FilePreview filename={shownName} content={code.text} hideHeader /></div>
}
