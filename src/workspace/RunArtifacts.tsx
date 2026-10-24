import { useMemo, useState } from 'react'
import { RichFileTree } from '@tangle-network/ui/files'
import type { RunDocument } from '../workspace-model.js'
import { readRunFiles, retainedPageAbsent } from './run-files.js'
import { RetainedFile } from './RetainedFile.js'
import { SharedFileUi } from './SharedFileUi.js'
import { useDocument } from './data.js'
import type { RunDesignVariant } from './RunDesignPreview.js'

export interface ArtifactNavigation {
  version: string | null
  compare: string | null
  identity: string | null
  view: 'preview' | 'source' | 'diff'
  onVersion: (version: string | null) => void
  onCompare: (version: string | null) => void
  onIdentity: (identity: string | null) => void
  onView: (view: 'preview' | 'source' | 'diff') => void
}
interface Props {
  api: string
  doc: RunDocument
  selected: string | null
  onSelect: (path: string | null) => void
  navigation?: ArtifactNavigation
  theme?: 'light' | 'dark'
  layout?: RunDesignVariant
}

/** The work is inspectable in place. Shared owners render the tree, artifacts and diffs. */
export function RunArtifacts({ api, doc, selected, onSelect, navigation, theme, layout = 'workspace' }: Props) {
  const [localVersion, setLocalVersion] = useState<string | null>(null)
  const [localCompare, setLocalCompare] = useState<string | null>(null)
  const [localIdentity, setLocalIdentity] = useState<string | null>(null)
  const [localView, setLocalView] = useState<ArtifactNavigation['view']>('preview')
  const nav = navigation ?? { identity: localIdentity, view: localView, onIdentity: setLocalIdentity, onView: setLocalView, version: localVersion, compare: localCompare, onVersion: (value: string | null) => { setLocalVersion(value); onSelect(null) }, onCompare: setLocalCompare }
  const validVersion = (value: string | null) => value === null || /^[a-f0-9]{40}$/.test(value)
  const url = `${api}/runs/${encodeURIComponent(doc.run.id)}/files`
  const current = useDocument<unknown>(url, doc.live.polling ? 15_000 : undefined)
  const chosen = useDocument<unknown>(nav.version && validVersion(nav.version) ? `${url}?version=${nav.version}` : null)
  const comparison = useDocument<unknown>(nav.compare && validVersion(nav.compare) ? `${url}?version=${nav.compare}` : null)
  const parse = (value: unknown, version: string | null) => {
    if (value === undefined) return { data: null, error: null }
    try { return { data: readRunFiles(value, doc.run.id, version, api), error: null } }
    catch { return { data: null, error: 'The retained-file inventory is invalid or belongs to another run or version.' } }
  }
  const currentView = useMemo(() => parse(current.data, null), [current.data, doc.run.id, api])
  const selectedView = useMemo(() => nav.version ? parse(chosen.data, nav.version) : currentView, [chosen.data, nav.version, currentView, doc.run.id, api])
  const before = useMemo(() => parse(comparison.data, nav.compare), [comparison.data, nav.compare, doc.run.id, api])
  const inventory = selectedView.data
  const files = inventory?.items ?? []
  const versions = currentView.data?.history.versions ?? []
  const error = !validVersion(nav.version) || !validVersion(nav.compare) ? 'A file version must be an exact recorded commit.' : selectedView.error ?? (nav.version ? chosen.error : current.error)
  const answer = doc.findings?.items.find((item) => item.kind === 'result')?.path
  const paths = [...new Set([...files.map((item) => item.path), ...(before.data?.items ?? []).map((item) => item.path)])].sort()
  const path = selected ?? files.find((item) => item.path === answer)?.path ?? paths[0] ?? null
  const file = files.find((item) => item.path === path)
  const baseline = before.data?.items.find((item) => item.path === path)
  const unknownVersion = Boolean(nav.version && !versions.some((item) => item.commit === nav.version))
  const unknownCompare = Boolean(nav.compare && !versions.some((item) => item.commit === nav.compare))
  const beforeLabel = versions.find((item) => item.commit === nav.compare)?.label
  const tree = (
    <aside className="run-file-tree" aria-label="Captured files">
      <header><h2>Files</h2><span className="faint">Retained with this run</span></header>
      {paths.length ? <SharedFileUi theme={theme} style={{ flex: 1 }}><RichFileTree paths={paths} selectedPath={path ?? undefined} onSelect={(next) => { if (paths.includes(next)) onSelect(next) }} initialExpansion="open" height="100%" /></SharedFileUi>
        : <p className="run-file-empty">{!inventory && !error ? 'Loading retained files…' : inventory?.state === 'available' ? 'No file was retained in this version’s artifact scope.' : 'The retained-file inventory is unavailable. This is not an empty workspace.'}</p>}
      <p className="run-file-scope">{inventory?.scopeDetails ?? 'The retained-file scope has not been received.'}{inventory && <> Inventory composed at {inventory.generatedAt.slice(11, 16)} UTC.</>}{inventory?.source.runDocumentStale && <> Its source document is stale.</>}</p>
    </aside>
  )
  return <section className="run-artifacts-wrap" aria-label="Files and artifacts" data-run-artifacts data-layout={layout}>
    <div className="run-file-selection">
      <label>Version <select value={nav.version ?? ''} onChange={(event) => nav.onVersion(event.target.value || null)}><option value="">Current retained files</option>{unknownVersion && <option value={nav.version!}>Requested version · {nav.version!.slice(0, 8)}</option>}{versions.map((item) => <option key={item.commit} value={item.commit}>{item.label} · {item.commit.slice(0, 8)}</option>)}</select></label>
      <label>Compare with <select value={nav.compare ?? ''} onChange={(event) => { nav.onCompare(event.target.value || null); if (layout === 'review' && event.target.value) nav.onView('diff') }}><option value="">Choose a recorded version</option>{unknownCompare && <option value={nav.compare!}>Requested version · {nav.compare!.slice(0, 8)}</option>}{versions.map((item) => <option key={item.commit} value={item.commit}>{item.label} · {item.commit.slice(0, 8)}</option>)}</select></label>
    </div>
    {error && <p className="run-file-notice" role="alert">Files are unavailable: {error}</p>}
    {inventory?.reason && <p className="run-file-notice" role="status">{inventory.reason}</p>}
    {currentView.data?.history.state === 'unavailable' && <p className="run-file-notice">Version history is unavailable: {currentView.data.history.reason ?? 'No reason was recorded.'}</p>}
    {nav.compare && (before.error || comparison.error) && <p className="run-file-notice" role="alert">The comparison is unavailable: {before.error ?? comparison.error}</p>}
    <div className="run-artifacts">
    {layout === 'document' ? <details className="run-file-drawer"><summary>Browse retained files</summary>{tree}</details> : tree}
    <div className="run-artifact-reader">
      {file || baseline ? <RetainedFile key={`${doc.run.id}:${nav.version}:${path}`} file={(file ?? baseline)!} files={files} missingAfter={!file} absenceVerified={!file && !!baseline && retainedPageAbsent(inventory, baseline)} baseline={baseline} baselineInventory={before.data} comparisonSelected={nav.compare !== null} beforeLabel={beforeLabel} theme={theme} runId={doc.run.id} fileVersion={nav.version} navigation={nav} />
        : <div className="run-file-empty" role={selected ? 'alert' : undefined}><h3>{!inventory && !error ? 'Loading the retained work…' : selected ? 'This file is not in the retained inventory' : 'No artifact to preview'}</h3>{(inventory || error) && <p>{selected ?? 'No file content is available from this inventory.'}</p>}</div>}
    </div>
    </div>
    {currentView.data && <a className="run-file-provenance" href={currentView.data.provenanceHref}>Inspect the profiles and configuration that produced this work</a>}
  </section>
}

