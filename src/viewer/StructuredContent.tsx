import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Decode display wrappers only. Original text remains available separately. */
export function displayValue(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

export function MessageText({ text }: { text: string }) {
  return <div className="activity-prose"><Markdown skipHtml remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span>{alt || 'Image omitted'}</span>,
      table: ({ children }) => <div className="rr-table-scroll"><table>{children}</table></div>,
    }}>{text}</Markdown></div>
}

function Value({ value, depth = 0, field }: { value: unknown; depth?: number; field?: string }) {
  const [expanded, setExpanded] = useState(false)
  if (value === null || value === undefined) return <span className="small">Not supplied</span>
  if (typeof value === 'string') {
    if (field && /^(command|cmd|code|script|stdout|stderr)$/i.test(field)) return <pre className="activity-code"><code>{value}</code></pre>
    const decoded = depth < 3 ? displayValue(value) : value
    return typeof decoded === 'string' ? <MessageText text={value} /> : <Value value={decoded} depth={depth + 1} />
  }
  if (typeof value !== 'object') return <span>{String(value)}</span>
  if (Array.isArray(value)) {
    const shown = expanded ? value : value.slice(0, 12)
    return <div className="structured-items">{shown.map((item, i) => <div key={i}><Value value={item} depth={depth + 1} /></div>)}
      {value.length > shown.length && <button className="ui-button" onClick={() => setExpanded(true)}>Show all {value.length} items</button>}</div>
  }
  const data = value as Record<string, unknown>
  if (data.type === 'text' && typeof data.text === 'string') return <Value value={data.text} depth={depth + 1} />
  const entries = Object.entries(data)
  const shown = expanded ? entries : entries.slice(0, 16)
  if (depth > 4) return <details><summary>Nested data</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  return <dl className="structured-fields">{shown.map(([key, item]) => <div key={key}>
    <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}</dt><dd><Value value={item} depth={depth + 1} field={key} /></dd>
  </div>)}{entries.length > shown.length && <button className="ui-button" onClick={() => setExpanded(true)}>Show all {entries.length} fields</button>}</dl>
}

export function StructuredContent({ text, rawLabel = 'Raw data' }: { text: string; rawLabel?: string }) {
  const value = displayValue(text)
  return <div className="structured-content"><Value value={value} />
    {typeof value !== 'string' && <details className="raw-data"><summary>{rawLabel}</summary><pre>{text}</pre></details>}
  </div>
}
