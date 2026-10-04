import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageText, StructuredContent } from './StructuredContent.js'
import type { RecordEvent } from '../record.js'
import {
  callsOf,
  compact,
  eventMatches,
  interval,
  ms,
  preview,
  textOf,
  toolKey,
  utcTime,
} from './model.js'
import type { RecordIndex, ToolCall } from './model.js'

function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  const path = /write|edit|patch/.test(lower)
    ? 'M10.5 2.5l3 3-8 8-3.5.5.5-3.5zM9 4l3 3'
    : /search|grep|find/.test(lower)
      ? 'M10 10l3.5 3.5M11 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0'
      : /bash|shell|exec|run/.test(lower)
        ? 'M2 3h12v10H2zM4 6l2 2-2 2M8 10h4'
        : /read|get|list/.test(lower)
          ? 'M3.5 2h6l3 3v9h-9zM9.5 2v3h3M5.5 8h5M5.5 10.5h5'
          : /web|fetch|http/.test(lower)
            ? 'M13.5 8a5.5 5.5 0 1 0-11 0 5.5 5.5 0 0 0 11 0M2.5 8h11M8 2.5c2 3 2 8 0 11c-2-3-2-8 0-11'
            : 'M10 8a2 2 0 1 0-4 0 2 2 0 0 0 4 0'
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ConversationProps {
  index: RecordIndex
  actor: string
  cutoff: number
  query: string
  category: string
  selected?: string
  inspect: (event: RecordEvent, source?: boolean) => void
}

export function Conversation({
  index,
  actor,
  cutoff,
  query,
  category,
  selected,
  inspect,
}: ConversationProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const scroll = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const setOpen = (key: string, open: boolean) =>
    setOpened((current) => {
      if (current.has(key) === open) return current
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  const bind = (id: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }
  const paired = (event: RecordEvent, call: ToolCall) => {
    const key = toolKey(event.node, call.id)
    return index.calls.get(key)?.length === 1
      ? (index.results.get(key) ?? [])
      : []
  }
  const items = useMemo(
    () =>
      (index.byActor.get(actor) ?? []).filter((event) => {
        if (ms(event.at) > cutoff) return false
        if (event.detail.toolCallId !== undefined) {
          const matching = index.calls.get(
            toolKey(event.node, event.detail.toolCallId),
          )
          if (matching?.length === 1 && ms(matching[0]!.event.at) <= cutoff)
            return false
        }
        const calls = callsOf(event)
        if (!(
          event.detail.role ||
          textOf(event) ||
          event.detail.responseStatus === 'error' ||
          calls.length
        ))
          return false
        if (eventMatches(event, index, query, category)) return true
        return calls.some((call) => {
          const key = toolKey(event.node, call.id)
          return (
            index.calls.get(key)?.length === 1 &&
            (index.results.get(key) ?? []).some(
              (result) =>
                ms(result.at) <= cutoff &&
                eventMatches(result, index, query, category),
            )
          )
        })
      }),
    [index, actor, cutoff, query, category],
  )
  const tools = items.flatMap((event) =>
    callsOf(event).map((call) => `tool:${event.id}:${call.id}`),
  )
  const allExpanded = tools.length > 0 && tools.every((key) => opened.has(key))

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0
  }, [actor])
  useEffect(() => {
    if (!selected) return
    const event = index.byEvent.get(selected)
    if (!event) return
    const keys = [`prompt:${selected}`]
    if (event.detail.toolCallId !== undefined)
      for (const match of index.calls.get(
        toolKey(event.node, event.detail.toolCallId),
      ) ?? [])
        keys.push(`tool:${match.event.id}:${match.call.id}`)
    for (const call of callsOf(event)) keys.push(`tool:${event.id}:${call.id}`)
    setOpened((current) => new Set([...current, ...keys]))
  }, [selected, index])
  useEffect(() => {
    const element = selected ? elements.current.get(selected) : undefined
    const container = scroll.current
    if (!element || !container) return
    const box = element.getBoundingClientRect(),
      viewport = container.getBoundingClientRect()
    if (box.top < viewport.top || box.bottom > viewport.bottom)
      container.scrollTop += box.top - viewport.top - 8
  }, [selected, actor, opened])

  const sourceButton = (event: RecordEvent) => (
    <button
      className="message-source"
      type="button"
      data-source-event={event.id}
      aria-label={`Inspect source of ${event.label}`}
      onClick={() => inspect(event, true)}
    >
      Details
    </button>
  )
  return (
    <>
      <div className="conversation-toolbar">
        <p className="small" data-chat-caption>
          {items.length > 0 ? `${items.length} messages · ${tools.length} tool calls` : (index.byActor.get(actor) ?? []).some(item => item.detail.role || textOf(item) || callsOf(item).length) ? (query || category !== 'all' ? 'No messages match these filters' : 'No messages at the selected time') : 'Conversation not retained in this snapshot'}
        </p>
        <button
          type="button"
          className="tool-expansion"
          data-expand-tools
          aria-pressed={allExpanded}
          disabled={!tools.length}
          onClick={() =>
            setOpened((current) => {
              const next = new Set(current)
              for (const key of tools)
                if (allExpanded) next.delete(key)
                else next.add(key)
              return next
            })
          }
        >
          {allExpanded ? 'Collapse tools' : 'Expand tools'}
        </button>
      </div>
      <div
        className="conversation-scroll"
        data-chat
        ref={scroll}
        tabIndex={0}
        aria-label="Scrollable retained conversation"
      >
        {!items.length && (
          <p className="chat-empty">
            {query || category !== 'all'
              ? 'No retained conversation entries match this filter.'
              : (index.byActor.get(actor)?.length ? 'This selection has recorded events, but no visible messages at the selected time. Inspect the event details or choose Full run.' : 'This agent is recorded in the topology, but its conversation was not included in this snapshot. This does not mean it did no work.')}
          </p>
        )}
        {items.map((event) => {
          const message = textOf(event),
            calls = callsOf(event)
          const user = event.detail.role === 'user',
            failed = event.detail.responseStatus === 'error'
          const finding = event.detail.recordedClaim !== undefined
          const standalone =
            event.detail.toolCallId !== undefined ||
            event.detail.role === 'toolResult'
          const title = user
            ? 'Assignment'
            : finding
              ? 'Recorded finding'
              : failed
                ? 'Request failed'
                : standalone
                  ? 'Tool result'
                  : event.detail.role === 'assistant'
                    ? 'Agent'
                    : (event.detail.role ?? 'Event')
          const promptKey = `prompt:${event.id}`
          return (
            <article
              key={event.id}
              ref={bind(event.id)}
              className={[
                'chat-message',
                user && 'assignment-message',
                !message && !failed && calls.length && 'tool-turn',
                finding && 'finding-message',
                failed && 'error-message',
                selected === event.id && 'selected',
              ]
                .filter(Boolean)
                .join(' ')}
              data-entry={event.id}
              data-message={event.id}
              data-message-node={event.node}
            >
              {(message || failed || standalone || !calls.length) && (
                <header className="message-heading">
                  <span className="message-mark" aria-hidden="true">
                    {user
                      ? '↳'
                      : finding
                        ? '◇'
                        : failed
                          ? '!'
                          : standalone
                            ? '↵'
                            : '·'}
                  </span>
                  <strong>{title}</strong>
                  <time dateTime={event.at}>{utcTime(event.at)}</time>
                  {sourceButton(event)}
                </header>
              )}
              {user && message ? (
                <details
                  className="prompt-body"
                  data-open-key={promptKey}
                  open={opened.has(promptKey)}
                  onToggle={(e) => setOpen(promptKey, e.currentTarget.open)}
                >
                  <summary>
                    <span>
                      {compact(message).slice(0, 210)}
                      {compact(message).length > 210 ? '…' : ''}
                    </span>
                    <span className="prompt-toggle">
                      {opened.has(promptKey)
                        ? 'Collapse prompt'
                        : 'Full prompt'}
                    </span>
                  </summary>
                  <MessageText text={message} />
                </details>
              ) : standalone ? (
                <div className="standalone-output">
                  <StructuredContent text={message || event.detail.contentOmitted || event.detail.publicationNote || 'No result text was retained for this event.'} />
                  {event.detail.toolCallId !== undefined &&
                    (index.calls.get(
                      toolKey(event.node, event.detail.toolCallId),
                    )?.length ?? 0) > 1 && (
                      <p className="publication-note">
                        Several calls share this identifier in this session.
                        This result cannot be paired unambiguously.
                      </p>
                    )}
                </div>
              ) : message ? (
                <MessageText text={message} />
              ) : failed ? (
                <p className="recorded-error">
                  The request failed. No assistant response is present in this
                  record.
                </p>
              ) : !calls.length ? (
                <p className="publication-note">
                  {event.detail.contentOmitted ??
                    'No text body is present in this record.'}
                </p>
              ) : null}
              {event.detail.publicationNote && (
                <p className="publication-note">
                  {event.detail.publicationNote}
                </p>
              )}
              {finding && event.detail.assessment && (
                <p className="publication-note">{event.detail.assessment}</p>
              )}
              {calls.length > 0 && (
                <div className="tool-stack">
                  {calls.map((call) => {
                    const allResults = paired(event, call)
                    const returned = allResults.filter(
                      (result) => ms(result.at) <= cutoff,
                    )
                    const last = returned.at(-1),
                      later = allResults.some(
                        (result) => ms(result.at) > cutoff,
                      )
                    const ambiguous =
                      (index.calls.get(toolKey(event.node, call.id))?.length ??
                        0) > 1
                    const state = ambiguous
                      ? 'ambiguous'
                      : last
                        ? last.detail.isError
                          ? 'error'
                          : 'returned'
                        : later
                          ? 'pending'
                          : 'missing'
                    const duration = last ? ms(last.at) - ms(event.at) : null
                    const key = `tool:${event.id}:${call.id}`
                    return (
                      <details
                        key={call.id}
                        className="tool-execution"
                        data-tool-call={call.id}
                        data-open-key={key}
                        data-call-at={event.at}
                        data-return-at={last?.at}
                        data-status={state}
                        open={opened.has(key)}
                        onToggle={(e) => setOpen(key, e.currentTarget.open)}
                      >
                        <summary>
                          <span className="execution-icon">
                            <ToolIcon name={call.name} />
                          </span>
                          <span className="execution-name">{call.name}</span>
                          <span
                            className="execution-preview"
                            title={preview(call)}
                          >
                            {preview(call)}
                          </span>
                          <span
                            className="execution-time"
                            data-tool-duration
                            title="Observed interval from tool call to result"
                          >
                            {duration !== null && duration >= 0
                              ? interval(duration)
                              : ''}
                          </span>
                          <span className="execution-status" data-tool-status>
                            {state === 'error'
                              ? 'Error'
                              : state === 'returned'
                                ? 'Returned'
                                : state === 'pending'
                                  ? 'Not returned'
                                  : state === 'ambiguous'
                                    ? 'Ambiguous'
                                    : 'No result'}
                          </span>
                        </summary>
                        <div className="execution-detail">
                          <section className="execution-input">
                            <header>
                              <span>Input</span>
                              {sourceButton(event)}
                            </header>
                            <StructuredContent text={call.input ?? 'Tool arguments are absent from this record.'} rawLabel="Raw input" />
                            {call.publicationNote && (
                              <p className="publication-note">
                                {call.publicationNote}
                              </p>
                            )}
                          </section>
                          {returned.map((result) => (
                            <section
                              key={result.id}
                              ref={bind(result.id)}
                              className={`execution-output ${selected === result.id ? 'selected' : ''}`}
                              data-message={result.id}
                              data-result-at={result.at}
                              data-result-error={String(
                                result.detail.isError === true,
                              )}
                            >
                              <header>
                                <span>
                                  {result.detail.isError ? 'Error' : 'Output'}
                                </span>
                                <time dateTime={result.at}>
                                  {utcTime(result.at)}
                                </time>
                                {sourceButton(result)}
                              </header>
                              <StructuredContent text={textOf(result) || result.detail.contentOmitted || 'No output text is present in this record.'} rawLabel="Raw result" />
                              {result.detail.publicationNote && (
                                <p className="publication-note">
                                  {result.detail.publicationNote}
                                </p>
                              )}
                              {ms(result.at) < ms(event.at) && (
                                <p className="publication-note">
                                  The recorded result precedes its call. Timing
                                  is unavailable.
                                </p>
                              )}
                            </section>
                          ))}
                          {(later || !returned.length) && (
                            <p className="result-pending" data-result-pending>
                              {ambiguous
                                ? 'Several calls share this identifier in this session. Results remain separate.'
                                : later
                                  ? 'The result had not returned at the selected time.'
                                  : 'No matching result was retained. Completion is unknown.'}
                            </p>
                          )}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
