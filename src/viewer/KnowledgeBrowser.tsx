import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
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

export function KnowledgeBrowser({ documents, selection, onSelect, reportsOnly = false }: {
  documents: ResearchDocument[]
  selection?: DocumentSelection
  onSelect: (selection: DocumentSelection) => void
  reportsOnly?: boolean
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const index = useMemo(() => documents.map((document) => ({
    document, text: [document.title, document.path, document.content].join('\n').toLowerCase(),
  })), [documents])
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const candidates = index.filter(({ document }) => !reportsOnly || document.kind === 'report')
  const visible = candidates.filter(({ document, text }) =>
    (kind === 'all' || document.kind === kind) && words.every((word) => text.includes(word)),
  )
  useEffect(() => {
    // A source jump may reveal a hidden target; selecting an existing result
    // keeps the query so the reader can work through the matching documents.
    if (selection && !visible.some(({ document }) => document.path === selection.path)) {
      setQuery('')
      setKind('all')
    }
  }, [selection])
  const selected = visible.find(({ document }) => document.path === selection?.path)?.document ?? visible[0]?.document
  const uid = useId()
  return (
    <section className="rr-knowledge" aria-label={reportsOnly ? 'Research papers and reports' : 'Knowledge base'}>
      <div className="rr-knowledge-controls">
        <label className="ui-field">
          <span className="ui-label">{reportsOnly ? 'Search reports' : 'Search all retained documents'}</span>
          <input type="search" value={query} placeholder="Search titles, paths, and full text…" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {!reportsOnly && <label className="ui-field">
          <span className="ui-label">File kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">All files</option>
            <option value="report">Reports</option>
            <option value="knowledge">Research notes</option>
            <option value="code">Code</option>
            <option value="data">Data</option>
          </select>
        </label>}
        <output className="rr-meta" aria-live="polite">{visible.length} of {candidates.length} documents</output>
      </div>
      <div className="rr-knowledge-layout">
        <nav className="rr-document-list" aria-label="Retained documents">
          {visible.map(({ document }) => <button
            type="button" key={document.id} aria-current={selected?.id === document.id ? 'true' : undefined}
            aria-controls={uid} onClick={() => onSelect({ path: document.path })}
          >
            <strong>{document.title}</strong>
            <small>{document.path}</small>
            {words.length > 0 && <span className="rr-search-excerpt">{snippet(document.content, words)}</span>}
          </button>)}
          {!visible.length && <p className="chat-empty">No documents match this search.</p>}
        </nav>
        <div id={uid} className="rr-document-panel">
          {selected ? <DocumentReader
            key={selected.id} document={selected} documents={documents}
            selection={selected.path === selection?.path ? selection : undefined} onSelect={(next) => {
              // Cross-document references must remain reachable after filtering.
              setQuery('')
              setKind('all')
              onSelect(next)
            }}
          /> : <p className="chat-empty">{documents.length ? 'Clear the search or choose another file kind.' : 'No documents were included in this snapshot.'}</p>}
        </div>
      </div>
    </section>
  )
}

function DocumentReader({ document, documents, selection, onSelect }: {
  document: ResearchDocument
  documents: ResearchDocument[]
  selection?: DocumentSelection
  onSelect: (selection: DocumentSelection) => void
}) {
  const [source, setSource] = useState(!!selection?.line || document.kind === 'code' || document.kind === 'data')
  const reader = useRef<HTMLDivElement>(null)
  const download = useDownload()
  const requestedLine = selection?.line
  const anchor = selection?.anchor
  useEffect(() => {
    if (requestedLine) setSource(true)
  }, [selection])
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
        <button className="ui-button" type="button" aria-pressed={source} onClick={() => setSource(!source)}>{source ? 'Read document' : 'View source'}</button>
        <button className="ui-button" type="button" onClick={() => download(document.content, document.path.split('/').pop() || 'document.txt', 'text/plain;charset=utf-8')}>Download original</button>
      </div>
    </header>
    {document.sha256 && <details className="rr-document-provenance"><summary>Source fingerprint</summary><code>SHA-256 {document.sha256}</code><p>Supplied by the producer. This viewer does not verify the archive.</p></details>}
    {requestedLine && source && <p className="rr-meta">{requestedLine > document.content.split('\n').length ? `Referenced line ${requestedLine} is outside this document.` : `Source reference: line ${requestedLine}`}</p>}
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
