import { useRef } from 'react'
import { FilePreview, resolveFilePreviewKind } from '@tangle-network/sandbox-ui/files'
import { DiffView } from '@tangle-network/sandbox-ui/workbench'
import { byteSize } from './final-output.js'
import { retainedPageAbsent, runFileHref, type RunFile, type RunFilesDocument, type RunFileVersion } from './run-files.js'
import type { ArtifactNavigation } from './RunArtifacts.js'
import { FILE_PREVIEW_BYTES as TEXT_LIMIT, useFileText } from './use-file-text.js'

/** The page's colour scheme: the shared previews and diffs follow the page, as the code pane's do (sandbox-ui styles are global here). */
const pageTheme = (): 'light' | 'dark' => (typeof document !== 'undefined' && (document.querySelector('[data-theme]')?.getAttribute('data-theme') === 'dark' || (document.querySelector('[data-theme]')?.getAttribute('data-theme') !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? 'dark' : 'light')

const fileIdentity = (file: RunFileVersion) => file.sha256 ?? file.objectId ?? file.href

export function RetainedFile({ file, files, baseline, baselineInventory, comparisonSelected, beforeLabel, theme, runId, fileVersion, navigation, missingAfter = false, absenceVerified = false }: { file: RunFile; files: RunFile[]; baseline?: RunFile; baselineInventory: RunFilesDocument | null; comparisonSelected: boolean; beforeLabel?: string; theme?: 'light' | 'dark'; runId: string; fileVersion: string | null; navigation: ArtifactNavigation; missingAfter?: boolean; absenceVerified?: boolean }) {
  const { view, onView: setView } = navigation
  const candidates = [file, ...(file.alternates ?? [])]
  const chosen: RunFileVersion | undefined = navigation.identity ? candidates.find((item) => fileIdentity(item) === navigation.identity) : file
  if (!chosen) return <article className="run-file run-file-empty" role="alert"><h3>This retained file identity is unavailable</h3><p>The requested content is not in this inventory. The current file has not been substituted.</p><button type="button" onClick={() => navigation.onIdentity(null)}>Open the listed file</button></article>
  return <RetainedFileContent key={fileIdentity(chosen)} {...{ file, files, chosen, baseline, baselineInventory, comparisonSelected, beforeLabel, theme, runId, fileVersion, navigation, view, setView, missingAfter, absenceVerified }} />
}

function RetainedFileContent({ file, files, chosen, baseline, baselineInventory, comparisonSelected, beforeLabel, theme, runId, fileVersion, navigation, view, setView, missingAfter, absenceVerified }: { file: RunFile; files: RunFile[]; chosen: RunFileVersion; baseline?: RunFile; baselineInventory: RunFilesDocument | null; comparisonSelected: boolean; beforeLabel?: string; theme?: 'light' | 'dark'; runId: string; fileVersion: string | null; navigation: ArtifactNavigation; view: ArtifactNavigation['view']; setView: ArtifactNavigation['onView']; missingAfter: boolean; absenceVerified: boolean }) {
  const downloadLink = useRef<HTMLAnchorElement>(null)
  const href = runFileHref(chosen)
  const kind = resolveFilePreviewKind(chosen.path)
  const hasRichPreview = kind === 'markdown' || kind === 'csv'
  const isBinary = ['image', 'pdf', 'video', 'audio', 'spreadsheet', 'binary'].includes(kind)
  const tooLarge = chosen.bytes !== null && chosen.bytes > TEXT_LIMIT
  const content = useFileText(!isBinary && !tooLarge ? href : null)
  const prior = useFileText(view === 'diff' && baseline && !missingAfter && !isBinary && !tooLarge ? runFileHref(baseline) : null)
  const knownAbsent = !missingAfter && retainedPageAbsent(baselineInventory, chosen)
  const canCompare = Boolean(comparisonSelected && (missingAfter ? absenceVerified : baseline || knownAbsent) && !isBinary && !tooLarge)
  const filename = chosen.path.split('/').at(-1)!
  const fileLink = (path: string, identity?: string, context = { version: fileVersion, compare: navigation.compare, view }) => {
    const query = new URLSearchParams({ file: path, fileView: context.view, fileSource: 'artifacts' })
    if (context.version) query.set('fileVersion', context.version)
    if (context.compare) query.set('compareVersion', context.compare)
    if (identity) query.set('fileIdentity', identity)
    const pageContext = new URLSearchParams(window.location.search)
    for (const key of ['theme']) {
      const value = pageContext.get(key)
      if (value) query.set(key, value)
    }
    return `/run/${encodeURIComponent(runId)}?${query}`
  }
  const contentFiles = missingAfter ? baselineInventory?.items ?? [] : files
  const contentVersion = missingAfter ? baselineInventory?.version ?? navigation.compare : fileVersion
  const transform = (target: string, key: string) => {
    // Shared Markdown may link only to files this host already listed. No remote image or arbitrary-origin fetch.
    if (/^https?:\/\//i.test(target)) return key === 'href' ? target : ''
    if (target.startsWith('#')) return key === 'href' ? target : ''
    const folder = chosen.path.split('/').slice(0, -1)
    for (const part of target.split(/[?#]/)[0]!.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') { if (!folder.length) return ''; folder.pop() }
      else folder.push(part)
    }
    const related = contentFiles.find((item) => item.path === folder.join('/'))
    return related ? (key === 'src' ? runFileHref(related) ?? '' : fileLink(related.path, undefined, { version: contentVersion, compare: null, view: 'preview' })) : ''
  }
  const body = (mode: 'light' | 'dark') => {
    if (!href) return <p role="alert">This host cannot serve this file.</p>
    if (tooLarge) return <p>This file is {byteSize(chosen.bytes)}. Use Download to inspect the complete file.</p>
    if (content.error || prior.error) return <p role="alert">{content.error ?? prior.error}</p>
    if (!isBinary && content.text === undefined) return <p role="status">Loading {filename}…</p>
    if (view === 'diff' && !canCompare) return <p>Select a recorded version with a comparable retained file to inspect its diff.</p>
    if (view === 'diff' && canCompare && missingAfter) return <DiffView filename={filename} baseline={content.text ?? ''} current="" themeType={mode} defaultWrap />
    if (view === 'diff' && canCompare) return !knownAbsent && prior.text === undefined ? <p role="status">Loading the comparison…</p> : <DiffView filename={filename} baseline={knownAbsent ? '' : prior.text ?? ''} current={content.text ?? ''} themeType={mode} defaultWrap />
    return <FilePreview className="run-retained-preview" filename={view === 'source' && hasRichPreview ? `${filename}.txt` : filename} content={content.text} blobUrl={isBinary ? href : undefined} size={chosen.bytes ?? undefined} urlTransform={transform} onDownload={() => downloadLink.current?.click()} hideHeader />
  }
  // A short text file takes its natural height (root 23:24Z: an 11-byte answer sat in a tall empty frame); a long one or a diff keeps the frame.
  const fit = !isBinary && view !== 'diff' && (content.text ?? '').split('\n').length <= 40
  return <article className="run-file" data-file={file.path} data-fit={fit ? 'content' : undefined}>
    <div className="run-file-toolbar"><div className="run-file-modes" role="group" aria-label="File view">
      <button type="button" aria-pressed={view === 'preview' || (view === 'source' && !hasRichPreview)} onClick={() => setView('preview')}>{missingAfter ? 'Baseline preview' : 'Preview'}</button>
      {hasRichPreview && <button type="button" aria-pressed={view === 'source'} onClick={() => setView('source')}>{missingAfter ? 'Baseline source' : 'Source'}</button>}
      {!isBinary && (canCompare || comparisonSelected) && <button type="button" disabled={!canCompare} aria-pressed={view === 'diff'} onClick={() => setView('diff')}>Diff{beforeLabel ? ` against ${beforeLabel}` : ''}</button>}
    </div><span className="faint run-file-links" title={`${chosen.source} · ${byteSize(chosen.bytes)}`}>{href && <a ref={downloadLink} href={href} download={filename}>Download</a>}<a href={fileLink(file.path, fileIdentity(chosen))}>{fileVersion ? 'Link to this version' : 'Link'}</a><details className="run-file-proof"><summary>Provenance</summary>{chosen.sha256 || chosen.objectId ? <><span>{chosen.sha256 ? 'Recorded SHA-256' : 'Recorded Git blob identity'}</span><code>{chosen.sha256 ?? chosen.objectId}</code></> : <span>Content hash is not recorded.</span>}</details></span></div>
    {missingAfter && <p className="run-file-notice">{absenceVerified ? 'Removed from the selected version’s complete retained page tree. This preview is the comparison version’s file.' : 'Only the comparison inventory lists this file. Its absence from the selected inventory is unverified.'}</p>}
    {comparisonSelected && !canCompare && <p className="run-file-notice">{isBinary ? 'This binary file has no text diff.' : tooLarge ? 'This file exceeds the inline comparison limit.' : 'This file’s baseline is unavailable or not in a complete comparable inventory.'}</p>}
    {knownAbsent && <p className="run-file-notice">This page is absent from the comparison version’s complete retained page tree. The diff compares it with an empty file.</p>}
    {(file.alternates?.length ?? 0) > 0 && <label className="run-file-versions">Retained version <select value={fileIdentity(chosen)} onChange={(event) => navigation.onIdentity(event.target.value)}>{[file, ...(file.alternates ?? [])].map((item) => <option key={item.href} value={fileIdentity(item)}>{item.source} · {item.sha256?.slice(0, 12) ?? 'hash unavailable'}</option>)}</select><span>Different retained versions share this path.</span></label>}
    <div className="run-file-content" data-file-view={view}>{body(theme ?? pageTheme())}</div>
  </article>
}
