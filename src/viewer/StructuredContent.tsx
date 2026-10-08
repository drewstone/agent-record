import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Decode display wrappers only. Original text remains available separately. */
export function displayValue(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

export function MessageText({ text, resolveHref }: { text: string; resolveHref?: (href: string) => string | null }) {
  return <div className="activity-prose"><Markdown skipHtml remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => {
        const target = /^https?:\/\//i.test(href ?? '') ? href : resolveHref?.(href ?? '')
        return target && (/^https?:\/\//i.test(target) || /^\/(?!\/)/.test(target))
          ? <a href={target} target="_blank" rel="noreferrer">{children}</a>
          : <span>{children}</span>
      },
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

/** Fields whose value is code or text to read whole, however short: a shell command, a file's content, a patch. */
const BODY_FIELDS = /^(command|cmd|code|script|content|new_string|old_string|patch|text|stdout|stderr|output|query|prompt)$/i

/** Every string in a JSON value that reads as a body (a newline, long, or a code field), with the path that holds it. */
function bodies(value: unknown, path: string[] = [], out: { path: string; text: string }[] = []) {
  if (out.length >= 24 || path.length > 8) return out
  if (typeof value === 'string') {
    if (value.includes('\n') || value.length > 120 || BODY_FIELDS.test(path.at(-1) ?? '')) out.push({ path: path.join(' › ') || 'text', text: value })
  } else if (Array.isArray(value)) value.forEach((item, i) => bodies(item, [...path, String(i)], out))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) bodies(item, [...path, key], out)
  return out
}

/**
 * Tool input and output exactly as recorded: plain text in a monospace block with its line breaks. A JSON body shows
 * its text-bearing fields as blocks too, and the JSON itself one disclosure away; nothing is read as Markdown.
 */
export function VerbatimContent({ text, rawLabel = 'Raw data' }: { text: string; rawLabel?: string }) {
  const value = displayValue(text)
  if (typeof value !== 'object' || value === null)
    return <pre className="activity-code verbatim" data-verbatim><code>{text}</code></pre>
  const blocks = bodies(value)
  return (
    <div className="structured-content verbatim" data-verbatim>
      {blocks.map((block, i) => (
        <section key={i} className="verbatim-block">
          <span className="verbatim-path mono">{block.path}</span>
          <pre className="activity-code"><code>{block.text}</code></pre>
        </section>
      ))}
      <details className="raw-data" open={!blocks.length}>
        <summary>{rawLabel}</summary>
        <pre className="activity-code"><code>{JSON.stringify(value, null, 2)}</code></pre>
      </details>
    </div>
  )
}
