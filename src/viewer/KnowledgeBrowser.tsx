import { readSourceSearch, type SourceSearchResult } from './source-search.js'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ResearchDocument } from '../report.js'
import { useDownload } from './useDownload.js'

export interface DocumentSelection { path: string; line?: number; anchor?: string }

/** Only exact retained paths resolve. This never reads the host filesystem. */
export function resolveDocument(documents: ResearchDocument[], href: string, from?: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return undefined
  let path = href.split('#')[0] ?? ''
  try { path = decodeURIComponent(path) } catch { return undefined }
  if (!path) return documents.find((item) => item.path === from)
  const alias = (item: ResearchDocument, value: string) => item.sourcePath === value ||
    Array.isArray(item.aliases) && item.aliases.includes(value)
  const unique = (matches: ResearchDocument[]) => matches.length === 1 ? matches[0] : undefined
  if (!from || path.startsWith('/')) {
    const exact = unique(documents.filter(item => item.path === path || alias(item, path)))
    if (exact) return exact
  }
  const segments = (path.startsWith('/') ? path : (from?.split('/').slice(0, -1).join('/') ?? '') + '/' + path).split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (segment === '..') normalized.pop()
    else if (segment && segment !== '.') normalized.push(segment)
  }
  return unique(documents.filter((item) => item.path.replace(/^\//, '') === normalized.join('/'))) ??
    unique(documents.filter(item => alias(item, path)))
}

function snippet(content: string, words: string[]) {
  const lower = content.toLowerCase()
  const positions = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0)
  const start = positions.length ? Math.max(0, Math.min(...positions) - 45) : 0
  return (start ? '…' : '') + content.slice(start, start + 160).replace(/\s+/g, ' ') + (content.length > start + 160 ? '…' : '')
}

export function KnowledgeBrowser({ documents, selection, onSelect, onClear, reportsOnly = false, playId, sourceSearchEndpoint }: {
  documents: ResearchDocument[]
  selection?: DocumentSelection
  onSelect: (selection: DocumentSelection) => void
  onClear?: () => void
  reportsOnly?: boolean
  playId?: string
  sourceSearchEndpoint?: string
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [result, setResult] = useState<SourceSearchResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    request.current?.abort(); setResult(undefined); setError(''); setBusy(false)
    return () => request.current?.abort()
  }, [documents, playId, sourceSearchEndpoint])
  const index = useMemo(() => documents.map(document => ({ document, text: [document.title, document.path, document.content].join('\n').toLowerCase() })), [documents])
  const words = (result ? submittedQuery : query).toLowerCase().trim().split(/\s+/).filter(Boolean)
  const selected = documents.find(document => document.path === selection?.path)
  const candidates = result ? result.documents.map(document => ({ document, text: document.content.toLowerCase() })) : index
  const visible = candidates.filter(({ document, text }) => (!reportsOnly || document.kind === 'report') &&
    (kind === 'all' || document.kind === kind) && (sourceSearchEndpoint || words.every(word => text.includes(word))))
  async function search() {
    if (!sourceSearchEndpoint || !playId || !query.trim()) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setResult(undefined); setSubmittedQuery(query.trim())
    try {
      const params = new URLSearchParams({ play: playId, q: query.trim(), limit: '10' })
      const response = await fetch(sourceSearchEndpoint + '?' + params, { signal: controller.signal, credentials: 'same-origin' })
      if (!response.ok) throw new Error('Source index unavailable')
      const next = readSourceSearch(await response.json(), playId, documents, sourceSearchEndpoint.match(/\/revisions\/([^/]+)\//)?.[1])
      if (!controller.signal.aborted) setResult(next)
    } catch {
      if (!controller.signal.aborted) setError('Source search failed or returned text that does not match these sources.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  if (selected) return <section className="research-source-reader" aria-label="Selected source">
    <button className="ui-button source-back" onClick={onClear}>← All sources</button>
    <DocumentReader key={selected.id} document={selected} documents={documents} selection={selection} onSelect={onSelect} />
  </section>
  return <section className="rr-knowledge flat-sources" aria-label="Sources">
    <form className="rr-knowledge-controls" onSubmit={event => { event.preventDefault(); void search() }}>
      <label className="ui-field"><span className="ui-label">{sourceSearchEndpoint ? 'Search this play’s sources' : 'Search retained sources'}</span>
        <input type="search" value={query} maxLength={500} placeholder="Question keywords, result, or source…" onChange={event => setQuery(event.target.value)} /></label>
      {sourceSearchEndpoint && <button className="ui-button" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search'}</button>}
      <label className="ui-field"><span className="ui-label">File kind</span><select value={kind} onChange={event => setKind(event.target.value)}>
        <option value="all">All files</option><option value="report">Reports</option><option value="knowledge">Research notes</option><option value="code">Code</option><option value="data">Data</option>
      </select></label>
      {result && <button type="button" className="ui-button" onClick={() => { setResult(undefined); setQuery(''); setKind('all') }}>Browse all</button>}
    </form>
    {(busy || result) && <p className="small" role="status">{busy ? 'Searching…' : result?.indexedAt ? `Indexed ${result.indexedAt}` : 'Index time unknown'}</p>}
    {error && <p role="alert" className="chat-empty">{error}</p>}
    {!busy && !error && <nav className="source-results" aria-label="Retained documents">{visible.map(({ document }) => <button type="button" key={document.id} onClick={() => {
      const found = words.map(word => document.content.toLowerCase().indexOf(word)).filter(index => index >= 0)
      onSelect({ path: document.path, ...(result && found.length ? { line: document.content.slice(0, Math.min(...found)).split('\n').length } : {}) })
    }}><span className="source-kind">{document.kind}</span><strong>{document.title}</strong><small>{document.path}</small>
      {words.length > 0 && <span className="rr-search-excerpt">{snippet(document.content, words)}</span>}
    </button>)}</nav>}
    {!busy && !error && !visible.length && <p className="chat-empty">No matching sources. Only retained files are searched.</p>}
  </section>
}

function DocumentReader({ document, documents, selection, onSelect }: {
  document: ResearchDocument
  documents: ResearchDocument[]
  selection?: DocumentSelection
  onSelect: (selection: DocumentSelection) => void
}) {
  const [source, setSource] = useState(document.kind === 'code' || document.kind === 'data')
  const reader = useRef<HTMLDivElement>(null)
  const download = useDownload()
  const requestedLine = selection?.line
  const anchor = selection?.anchor
  useEffect(() => {
    if (requestedLine && source) reader.current?.querySelector(`[data-line="${requestedLine}"]`)?.scrollIntoView({ block: 'center' })
    if (anchor && !source) {
      let decoded = anchor
      try { decoded = decodeURIComponent(anchor) } catch { /* Invalid anchor stays visible in the original. */ }
      const heading = Array.from(reader.current?.querySelectorAll('h1,h2,h3,h4,h5,h6,[id]') ?? []).find((node) =>
        node.id === decoded || node.textContent?.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') === decoded,
      )
      heading?.scrollIntoView({ block: 'start' })
    }
  }, [selection, source])
  return <article className="rr-document">
    <header className="rr-document-header">
      <div><h3>{document.title}</h3><p className="rr-document-path">{document.path}</p></div>
      <div className="rr-document-actions">
        <button className="ui-button" type="button" aria-pressed={source} onClick={() => setSource(!source)}>{source ? 'Read document' : requestedLine ? 'View cited line' : 'View source'}</button>
        <button className="ui-button" type="button" onClick={() => download(document.content, document.path.split('/').pop() || 'document.txt', 'text/plain;charset=utf-8')}>Download original</button>
      </div>
    </header>
    {document.sha256 && <details className="rr-document-provenance"><summary>Source fingerprint</summary><code>SHA-256 {document.sha256}</code><p>Supplied with the report; not checked against the archive.</p></details>}
    {requestedLine && <p className="rr-meta">{requestedLine > document.content.split('\n').length ? `Referenced line ${requestedLine} is outside this document.` : `Cited line ${requestedLine}${source ? ' · source view' : ''}`}</p>}
    <div className="rr-document-content" ref={reader}>
      {source ? <pre className="rr-document-source"><code>{document.content.split('\n').map((line, i) =>
        <span key={i} data-line={i + 1} data-highlight={i + 1 === requestedLine || undefined}><span aria-hidden="true">{i + 1}</span>{line || '\n'}</span>,
      )}</code></pre> : <ResearchMarkdown document={document} documents={documents} onSelect={onSelect} />}
    </div>
  </article>
}

const ResearchMarkdown = memo(function ResearchMarkdown({ document, documents, onSelect }: {
  document: ResearchDocument
  documents: ResearchDocument[]
  onSelect: (selection: DocumentSelection) => void
}) {
  return <div className="rr-markdown"><Markdown
    skipHtml
    remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
    rehypePlugins={[[rehypeKatex, { output: 'mathml', trust: false, strict: 'warn', maxExpand: 1000, maxSize: 20 }]]}
    urlTransform={(url) => url}
    components={{
      a: ({ href = '', children }) => {
        const target = resolveDocument(documents, href, document.path)
        if (target) return <button type="button" className="rr-inline-link" onClick={() => onSelect({ path: target.path, anchor: href.split('#')[1] })}>{children}</button>
        if (/^https?:\/\/[^\s]+$/i.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        return <span title={href ? `Source not included: ${href}` : undefined}>{children}</span>
      },
      img: ({ alt, src }) => <span className="rr-media-reference">{alt || 'Image'}{src ? ` (${src})` : ''}</span>,
      table: ({ children }) => <div className="rr-table-scroll"><table>{children}</table></div>,
    }}
  >{document.content}</Markdown></div>
})
