import { useEffect, useState } from 'react'
import type { RecordEvent } from '../record.js'
import type { RecordIndex } from '../viewer/model.js'
import { textOf, utcTime } from '../viewer/model.js'
import { StructuredContent, VerbatimContent } from '../viewer/StructuredContent.js'

export function EventDetail({
  event,
  full,
  index,
  onClose,
  load,
}: {
  event: RecordEvent
  /** Source hash of a clipped body to show in full. */
  full?: string
  index: RecordIndex
  onClose: () => void
  load: (sha: string) => Promise<string>
}) {
  const [raw, setRaw] = useState<{ text?: string; error?: string }>({})
  const [whole, setWhole] = useState<{ text?: string; error?: string }>({})
  const source = event.source as { path?: string; sha256?: string; line?: number; pointer?: string } | null | undefined
  useEffect(() => {
    if (!full) return
    load(full)
      .then((text) => setWhole({ text }))
      .catch((error: unknown) => setWhole({ error: error instanceof Error ? error.message : 'Unavailable' }))
  }, [full, load])
  const loadLine = (sha: string, line?: number) => load(`${sha}${line ? `?line=${line}` : ''}`)
  useEffect(() => {
    const close = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <aside className="event-detail" role="dialog" aria-label="Event details" data-event-detail={event.id}>
      <header>
        <div>
          <h3>{event.label}</h3>
          <p className="faint mono">
            {utcTime(event.at, true)} · {index.nodes.get(index.canonical(event.node))?.label ?? event.node} · {event.category}
          </p>
        </div>
        <button type="button" className="ui-button" onClick={onClose}>Close</button>
      </header>
      <p className="mono faint event-id">{event.id}</p>
      {full ? (
        <section className="event-full" data-full-output={whole.text !== undefined ? full : undefined}>
          <h4>Full output</h4>
          <p className="mono faint">sha256 {full}</p>
          {whole.error && <p role="alert">{whole.error}</p>}
          {whole.text === undefined && !whole.error && <p className="faint">Loading…</p>}
          {whole.text !== undefined && <VerbatimContent text={whole.text} rawLabel="Original bytes" />}
        </section>
      ) : (
        textOf(event) && (event.detail.toolCallId !== undefined || event.category === 'lifecycle' ? <VerbatimContent text={textOf(event)} /> : <StructuredContent text={textOf(event)} />)
      )}
      <details className="raw-data" open={!full}>
        <summary>Recorded detail</summary>
        <pre>{JSON.stringify(event.detail, null, 2)}</pre>
      </details>
      {source?.path && (
        <section className="event-source">
          <h4>Source</h4>
          <p className="mono">
            {source.path}
            {source.line ? `:${source.line}` : ''}
            {source.pointer ? `#${source.pointer}` : ''}
          </p>
          {source.sha256 && <p className="mono faint">sha256 {source.sha256}</p>}
          {source.sha256 && source.line && raw.text === undefined && (
            <button
              type="button"
              className="ui-button"
              onClick={() =>
                loadLine(source.sha256!, source.line)
                  .then((text) => setRaw({ text }))
                  .catch((error: unknown) => setRaw({ error: error instanceof Error ? error.message : 'Unavailable' }))
              }
            >
              Original line
            </button>
          )}
          {raw.error && <p role="alert">{raw.error}</p>}
          {raw.text !== undefined && <VerbatimContent text={raw.text} rawLabel="Original bytes" />}
        </section>
      )}
    </aside>
  )
}
