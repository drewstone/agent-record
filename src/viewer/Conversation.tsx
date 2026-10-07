import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageText, VerbatimContent } from './StructuredContent.js'
import { VirtualList } from './VirtualList.js'
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
import { anchorsOf, answeredBy, argsLabel, callStatus, collapsePolls, outputTokens, pollSummary, quietThinking, thinkingMarkers } from './conversation-rows.js'
import type { CallState, ConversationRow } from './conversation-rows.js'

/** A withheld-thinking bar is full at this many output tokens; larger turns stay full. */
const THINKING_FULL_TOKENS = 80_000
const tokenLabel = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const spanLabel = (value: number) => {
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} m ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} m`
}

function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  const path = /write|edit|patch/.test(lower)
    ? 'M10.5 2.5l3 3-8 8-3.5.5.5-3.5zM9 4l3 3'
    : /search|grep|find/.test(lower)
      ? 'M10 10l3.5 3.5M11 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0'
      : /bash|shell|exec|run|command/.test(lower)
        ? 'M2 3h12v10H2zM4 6l2 2-2 2M8 10h4'
        : /read|get|list/.test(lower)
          ? 'M3.5 2h6l3 3v9h-9zM9.5 2v3h3M5.5 8h5M5.5 10.5h5'
          : /web|fetch|http/.test(lower)
            ? 'M13.5 8a5.5 5.5 0 1 0-11 0 5.5 5.5 0 0 0 11 0M2.5 8h11M8 2.5c2 3 2 8 0 11c-2-3-2-8 0-11'
            : /await|wait|sleep|poll/.test(lower)
              ? 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M8 5v3l2 1.5'
              : /spawn|agent|task|delegate|message/.test(lower)
                ? 'M5 5.5a2 2 0 1 0 0-.1M11 5.5a2 2 0 1 0 0-.1M2 13c.5-2 1.7-3 3-3s2.5 1 3 3M8 13c.5-2 1.7-3 3-3s2.5 1 3 3'
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

export interface EventFlag {
  dimension: string
  label: string
  polarity: string
  title: string
}

interface ConversationProps {
  index: RecordIndex
  actor: string
  cutoff: number
  query: string
  category: string
  selected?: string
  inspect: (event: RecordEvent, source?: boolean) => void
  /** Open the full text of a clipped body by its source hash. */
  openSource?: (sha256: string, event: RecordEvent) => void
  /** Assessment labels that cite an event, drawn in the message gutter. */
  flags?: ReadonlyMap<string, readonly EventFlag[]>
  onFlag?: (flag: EventFlag, event: RecordEvent) => void
  /** Show lifecycle events (spawn, pause, settle) between messages. */
  lifecycle?: boolean
  /** The agent can still act: a call without a result is pending, not uncaptured. */
  live?: boolean
}

type Clip = { bytes: number; sha256: string | null }
/** `mcp__server__tool` reads as `tool`; the full name stays in the title. */
const toolName = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) || name : name)
const clipOf = (value: unknown): Clip | undefined =>
  value && typeof value === 'object' && 'bytes' in value ? (value as Clip) : undefined
const isLifecycle = (event: RecordEvent) =>
  event.category === 'lifecycle' || event.detail.lifecycle !== undefined

/** A clipped body with a control that opens its full source text. */
function FullOutput({
  clip,
  open,
  children,
}: {
  clip?: Clip
  open?: (sha256: string) => void
  children: React.ReactNode
}) {
  if (!clip) return <>{children}</>
  return (
    <>
      {children}
      <p className="clip-note">
        <span>{new Intl.NumberFormat('en-US').format(clip.bytes)} bytes, middle omitted.</span>
        {clip.sha256 && open ? (
          <button type="button" className="ui-button" data-load-full={clip.sha256} onClick={() => open(clip.sha256!)}>
            Full output
          </button>
        ) : null}
      </p>
    </>
  )
}

export function Conversation({
  index,
  actor,
  cutoff,
  query,
  category,
  selected,
  inspect,
  openSource,
  flags,
  onFlag,
  lifecycle = false,
  live = false,
}: ConversationProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const scroll = useRef<HTMLDivElement>(null)
  // Open rows and measured heights are keyed by source position, which a live rebuild keeps; event ids change.
  const anchors = useMemo(() => anchorsOf(index.events), [index])
  const anchor = useCallback((event: RecordEvent) => anchors.get(event.id) ?? event.id, [anchors])
  const opener = (event: RecordEvent) => (openSource ? (sha256: string) => openSource(sha256, event) : undefined)

  const setOpen = (key: string, open: boolean) =>
    setOpened((current) => {
      if (current.has(key) === open) return current
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  const paired = (event: RecordEvent, call: ToolCall) => {
    const key = toolKey(event.node, call.id)
    return index.calls.get(key)?.length === 1
      ? (index.results.get(key) ?? [])
      : []
  }
  // The row that holds the selected event: a paired result renders inside its call.
  const target = useMemo(() => {
    if (!selected) return undefined
    const event = index.byEvent.get(selected)
    if (event?.detail.toolCallId !== undefined) {
      const calls = index.calls.get(toolKey(event.node, event.detail.toolCallId))
      if (calls?.length === 1) return calls[0]!.event.id
    }
    return selected
  }, [selected, index])
  const items = useMemo(
    () =>
      (index.byActor.get(actor) ?? []).filter((event) => {
        if (ms(event.at) > cutoff) return false
        // A cited or linked event shows whatever the filters say: the reader asked for it.
        if (event.id === target) return true
        if (isLifecycle(event)) return lifecycle && eventMatches(event, index, query, category)
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
          event.detail.reasoning ||
          event.detail.responseStatus === 'error' ||
          calls.length
        ))
          return false
        // An empty assistant turn stays hidden unless it records substantial thinking the provider withheld; its usage
        // stays in the charts.
        if (event.detail.role === 'assistant' && !textOf(event) && !event.detail.reasoning && !calls.length && event.detail.responseStatus !== 'error' && !event.detail.contentOmitted && (!thinkingMarkers(event.detail).length || quietThinking(event.detail)))
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
    [index, actor, cutoff, query, category, lifecycle, target],
  )
  const rows = useMemo(
    () =>
      collapsePolls(items, {
        callsOf,
        answered: (event, id) => answeredBy(index.results.get(toolKey(event.node, id))),
        keyOf: anchor,
      }),
    [items, index, anchor],
  )
  // How long each withheld-thinking turn took: the time since this agent's previous event.
  const thinkingSpan = useMemo(() => {
    const spans = new Map<string, number>()
    let previous: number | null = null
    for (const event of index.byActor.get(actor) ?? []) {
      const at = ms(event.at)
      if (previous !== null && Number.isFinite(at) && thinkingMarkers(event.detail).length) spans.set(event.id, Math.max(0, at - previous))
      if (Number.isFinite(at)) previous = at
    }
    return spans
  }, [index, actor])
  // The row that shows each event: a poll is drawn inside its collapsed group.
  const rowOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows)
      if (row.kind === 'polls') for (const event of row.events) map.set(event.id, row.key)
      else map.set(row.event.id, row.key)
    return map
  }, [rows])
  const shown = rows.flatMap((row) => (row.kind === 'event' ? [row.event] : []))
  const tools = shown.flatMap((event) => callsOf(event).map((call) => `tool:${anchor(event)}:${call.id}`))
  const thoughts = shown.filter((event) => typeof event.detail.reasoning === 'string' && event.detail.reasoning).map((event) => `reasoning:${anchor(event)}`)
  const allExpanded = tools.length > 0 && tools.every((key) => opened.has(key))
  const allThinking = thoughts.length > 0 && thoughts.every((key) => opened.has(key))
  const retained = (index.byActor.get(actor) ?? []).some(
    (item) => !isLifecycle(item) && (item.detail.role || textOf(item) || callsOf(item).length),
  )
  // Another agent starts at its first message, unless the change came with an event to show.
  const targetRef = useRef(target)
  targetRef.current = target
  // Follow the tail only while the reader is at the bottom: new rows of a live record keep them there; anywhere
  // else, the rows above keep their measured heights and the reading place does not move.
  const following = useRef(false)
  useLayoutEffect(() => {
    following.current = false
    if (scroll.current && !targetRef.current) scroll.current.scrollTop = 0
  }, [actor])
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const track = () => {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    }
    element.addEventListener('scroll', track, { passive: true })
    return () => element.removeEventListener('scroll', track)
  }, [])
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element || !following.current) return
    element.scrollTop = element.scrollHeight
    // New rows are measured after they render; hold the bottom until they settle.
    let frames = 0
    let frame = requestAnimationFrame(function pin() {
      if (!following.current) return
      element.scrollTop = element.scrollHeight
      if (++frames < 20) frame = requestAnimationFrame(pin)
    })
    return () => cancelAnimationFrame(frame)
  }, [rows])
  useEffect(() => {
    if (!selected) return
    const event = index.byEvent.get(selected)
    if (!event) return
    const keys = [`prompt:${anchor(event)}`, `reasoning:${anchor(event)}`]
    if (event.detail.toolCallId !== undefined)
      for (const match of index.calls.get(
        toolKey(event.node, event.detail.toolCallId),
      ) ?? [])
        keys.push(`tool:${anchor(match.event)}:${match.call.id}`, rowOf.get(match.event.id) ?? '')
    for (const call of callsOf(event)) keys.push(`tool:${anchor(event)}:${call.id}`)
    const row = rowOf.get(selected)
    if (row?.startsWith('polls:')) keys.push(row)
    setOpened((current) => new Set([...current, ...keys.filter(Boolean)]))
  }, [selected, index]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const flagMarks = (event: RecordEvent) => {
    const marks = flags?.get(event.id)
    if (!marks?.length) return null
    return (
      <span className="event-flags">
        {marks.map((flag) => (
          <button
            key={`${flag.dimension}:${flag.label}`}
            type="button"
            className={`event-flag polarity-${flag.polarity}`}
            title={flag.title}
            data-flag={flag.dimension}
            onClick={() => onFlag?.(flag, event)}
          >
            {flag.dimension}
          </button>
        ))}
      </span>
    )
  }
  const keyOf = useCallback((row: ConversationRow) => row.key, [])
  const estimate = useCallback(
    (row: ConversationRow) =>
      row.kind === 'polls'
        ? 48
        : isLifecycle(row.event)
          ? 34
          : !textOf(row.event) && callsOf(row.event).length
            ? 8 + 40 * callsOf(row.event).length
            : 150,
    [],
  )
  const renderPolls = (row: Extract<ConversationRow, { kind: 'polls' }>) => {
    const summary = pollSummary(row.events)
    const open = opened.has(row.key)
    const chosen = row.events.some((event) => event.id === selected)
    return (
      <details
        className={`poll-group ${chosen ? 'selected' : ''}`}
        data-poll-group={row.events.length}
        data-open-key={row.key}
        data-entry={row.events[0]!.id}
        open={open}
        onToggle={(e) => setOpen(row.key, e.currentTarget.open)}
      >
        <summary>
          <span className="execution-icon">
            <ToolIcon name={row.name} />
          </span>
          <span className="execution-name" title={row.name}>{toolName(row.name)}</span>
          <span className="poll-facts">{summary.label}</span>
          <span className="poll-args">{argsLabel(row.input) ?? compact(row.input ?? '')}</span>
          <time dateTime={row.events[0]!.at}>{utcTime(row.events[0]!.at)}</time>
        </summary>
        {open && (
          <ol className="poll-calls">
            {row.events.map((event) => {
              const call = callsOf(event)[0]!
              return (
                <li key={event.id} data-message={event.id} className={selected === event.id ? 'selected' : ''}>
                  <time dateTime={event.at}>{utcTime(event.at)}</time>
                  <span className="mono">{call.id}</span>
                  <span className="poll-args">{argsLabel(call.input) ?? compact(call.input ?? '')}</span>
                  <span className="execution-status">{callStatus('missing', live)}</span>
                  {sourceButton(event)}
                </li>
              )
            })}
          </ol>
        )}
      </details>
    )
  }
  const render = (row: ConversationRow) => {
    if (row.kind === 'polls') return renderPolls(row)
    const event = row.event
    const at = anchor(event)
    if (isLifecycle(event)) {
      const text = textOf(event)
      return (
        <article
          className={`lifecycle-note ${selected === event.id ? 'selected' : ''} ${event.detail.isError ? 'lifecycle-error' : ''}`}
          data-entry={event.id}
          data-message={event.id}
        >
          <time dateTime={event.at}>{utcTime(event.at)}</time>
          <strong>{event.label}</strong>
          {text && <span className="lifecycle-text">{compact(text).slice(0, 280)}</span>}
          {flagMarks(event)}
          {sourceButton(event)}
        </article>
      )
    }
    const message = textOf(event),
      calls = callsOf(event)
    const reasoning = typeof event.detail.reasoning === 'string' ? event.detail.reasoning : ''
    const withheld = thinkingMarkers(event.detail)
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
    const promptKey = `prompt:${at}`
    const reasoningKey = `reasoning:${at}`
    const clip = clipOf(event.detail.clip)
    // A turn that holds only withheld thinking is one line sized by the work it recorded: its output tokens and the
    // time since the agent's previous event. The provider withheld the text; the size is what the record measured.
    if (withheld.length && !message && !reasoning && !calls.length && !failed && !event.detail.contentOmitted) {
      const output = outputTokens(event.detail)
      const span = thinkingSpan.get(event.id)
      return (
        <article
          className={`thinking-note ${selected === event.id ? 'selected' : ''} ${output !== null ? 'thinking-sized' : ''}`}
          data-entry={event.id}
          data-message={event.id}
          data-thinking-withheld
          title={withheld.join(' · ')}
        >
          <time dateTime={event.at}>{utcTime(event.at)}</time>
          <span className="thinking-label">
            {output !== null ? `Thought ${span !== undefined && span >= 1000 ? `for ${spanLabel(span)} ` : ''}· ${tokenLabel(output)} output tokens` : withheld.join(' · ')}
          </span>
          {output !== null && (
            <span className="thinking-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(3, Math.min(100, (output / THINKING_FULL_TOKENS) * 100))}%` }} />
            </span>
          )}
          {output !== null && <span className="thinking-why">text withheld by the provider</span>}
          {flagMarks(event)}
          {sourceButton(event)}
        </article>
      )
    }
    return (
      <article
        className={[
          'chat-message',
          user && 'assignment-message',
          !message && !failed && calls.length && 'tool-turn',
          finding && 'finding-message',
          failed && 'error-message',
          selected === event.id && 'selected',
          flags?.has(event.id) && 'flagged',
        ]
          .filter(Boolean)
          .join(' ')}
        data-entry={event.id}
        data-message={event.id}
        data-message-node={event.node}
      >
        {(message || failed || standalone || reasoning || withheld.length > 0 || !calls.length) && (
          <header className="message-heading">
            <span className="message-mark" aria-hidden="true">
              {user ? '↳' : finding ? '◇' : failed ? '!' : standalone ? '↵' : '·'}
            </span>
            <strong>{title}</strong>
            <time dateTime={event.at}>{utcTime(event.at)}</time>
            {flagMarks(event)}
            {sourceButton(event)}
          </header>
        )}
        {reasoning && (
          <details
            className="reasoning-body"
            open={opened.has(reasoningKey)}
            onToggle={(e) => setOpen(reasoningKey, e.currentTarget.open)}
          >
            <summary>
              <span>Reasoning</span>
              <span className="reasoning-preview">{compact(reasoning).slice(0, 160)}</span>
            </summary>
            {opened.has(reasoningKey) && <MessageText text={reasoning} />}
          </details>
        )}
        {withheld.length > 0 && (
          <p className="thinking-withheld" data-thinking-withheld>
            {withheld.join(' · ')}
          </p>
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
                {opened.has(promptKey) ? 'Collapse prompt' : 'Full prompt'}
              </span>
            </summary>
            {opened.has(promptKey) && (
              <FullOutput clip={clip} open={opener(event)}>
                <MessageText text={message} />
              </FullOutput>
            )}
          </details>
        ) : standalone ? (
          <div className="standalone-output">
            <FullOutput clip={clip} open={opener(event)}>
              <VerbatimContent text={message || event.detail.contentOmitted || event.detail.publicationNote || 'No result text was retained for this event.'} />
            </FullOutput>
            {event.detail.toolCallId !== undefined &&
              (index.calls.get(toolKey(event.node, event.detail.toolCallId))?.length ?? 0) > 1 && (
                <p className="publication-note">
                  Several calls share this identifier in this session.
                  This result cannot be paired unambiguously.
                </p>
              )}
          </div>
        ) : message ? (
          <FullOutput clip={calls.length ? undefined : clip} open={opener(event)}>
            <MessageText text={message} />
          </FullOutput>
        ) : failed ? (
          <p className="recorded-error">
            The request failed. No assistant response is present in this record.
          </p>
        ) : !calls.length && !reasoning && !withheld.length ? (
          <p className="publication-note">
            {event.detail.contentOmitted ?? 'No text body is present in this record.'}
          </p>
        ) : null}
        {event.detail.publicationNote && (
          <p className="publication-note">{event.detail.publicationNote}</p>
        )}
        {finding && event.detail.assessment && (
          <p className="publication-note">{event.detail.assessment}</p>
        )}
        {calls.length > 0 && (
          <div className="tool-stack">
            {calls.map((call) => {
              const allResults = paired(event, call)
              const returned = allResults.filter((result) => ms(result.at) <= cutoff)
              const last = returned.at(-1),
                later = allResults.some((result) => ms(result.at) > cutoff)
              const ambiguous = (index.calls.get(toolKey(event.node, call.id))?.length ?? 0) > 1
              const state: CallState = ambiguous
                ? 'ambiguous'
                : last
                  ? last.detail.isError
                    ? 'error'
                    : 'returned'
                  : later
                    ? 'pending'
                    : 'missing'
              const recorded = typeof last?.detail.durationMs === 'number' ? last.detail.durationMs : null
              const duration = recorded ?? (last && last.detail.atBasis !== 'carried' ? ms(last.at) - ms(event.at) : null)
              const key = `tool:${at}:${call.id}`
              const open = opened.has(key)
              const callClip = clipOf((call as { clip?: unknown }).clip)
              const resultFlags = returned.some((result) => flags?.has(result.id))
              return (
                <details
                  key={call.id}
                  className={`tool-execution ${resultFlags ? 'flagged' : ''}`}
                  data-tool-call={call.id}
                  data-open-key={key}
                  data-call-at={event.at}
                  data-return-at={last?.at}
                  data-status={state}
                  open={open}
                  onToggle={(e) => setOpen(key, e.currentTarget.open)}
                >
                  <summary>
                    <span className="execution-icon">
                      <ToolIcon name={call.name} />
                    </span>
                    <span className="execution-name" title={call.name}>{toolName(call.name)}</span>
                    <span className={`execution-preview ${argsLabel(call.input) ? 'not-captured' : ''}`} title={preview(call)}>
                      {argsLabel(call.input) ?? preview(call)}
                    </span>
                    <span className="execution-time" data-tool-duration title="Recorded time from call to result">
                      {duration !== null && duration >= 0 ? interval(duration) : ''}
                    </span>
                    {!message && flagMarks(event)}
                    <span className="execution-status" data-tool-status>
                      {callStatus(state, live)}
                    </span>
                  </summary>
                  {open && (
                    <div className="execution-detail">
                      <section className="execution-input">
                        <header>
                          <span>Input</span>
                          {flagMarks(event)}
                          {sourceButton(event)}
                        </header>
                        <FullOutput clip={callClip} open={opener(event)}>
                          {call.input === undefined ? (
                            <p className="publication-note">Args not captured.</p>
                          ) : (
                            <VerbatimContent text={call.input} rawLabel="Raw input" />
                          )}
                        </FullOutput>
                        {call.publicationNote && <p className="publication-note">{call.publicationNote}</p>}
                      </section>
                      {returned.map((result) => (
                        <section
                          key={result.id}
                          className={`execution-output ${selected === result.id ? 'selected' : ''}`}
                          data-message={result.id}
                          data-result-at={result.at}
                          data-result-error={String(result.detail.isError === true)}
                        >
                          <header>
                            <span>{result.detail.isError ? 'Error' : 'Output'}</span>
                            <time dateTime={result.at}>{utcTime(result.at)}</time>
                            {flagMarks(result)}
                            {sourceButton(result)}
                          </header>
                          <FullOutput clip={clipOf(result.detail.clip)} open={opener(result)}>
                            <VerbatimContent text={textOf(result) || result.detail.contentOmitted || 'No output text is present in this record.'} rawLabel="Raw result" />
                          </FullOutput>
                          {result.detail.publicationNote && <p className="publication-note">{result.detail.publicationNote}</p>}
                          {ms(result.at) < ms(event.at) && (
                            <p className="publication-note">
                              The recorded result precedes its call. Timing is unavailable.
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
                              : live
                                ? 'Pending. The result has not been recorded yet.'
                                : 'Result not captured. Completion is unknown.'}
                        </p>
                      )}
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        )}
      </article>
    )
  }
  return (
    <>
      {(tools.length > 0 || thoughts.length > 0) && (
        <div className="conversation-toolbar">
          {thoughts.length > 0 && (
            <button
              type="button"
              className="tool-expansion"
              data-expand-thinking
              aria-pressed={allThinking}
              onClick={() =>
                setOpened((current) => {
                  const next = new Set(current)
                  for (const key of thoughts)
                    if (allThinking) next.delete(key)
                    else next.add(key)
                  return next
                })
              }
            >
              {allThinking ? 'Collapse all thinking' : 'Expand all thinking'}
            </button>
          )}
          {tools.length > 0 && <button
            type="button"
            className="tool-expansion"
            data-expand-tools
            aria-pressed={allExpanded}
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
          </button>}
        </div>
      )}
      <div
        className="conversation-scroll"
        data-chat
        ref={scroll}
        tabIndex={0}
        aria-label="Scrollable retained conversation"
      >
        {!rows.length && (
          <p className="chat-empty">
            {query || category !== 'all'
              ? 'No messages match this filter.'
              : retained
                ? 'No messages at the selected time.'
                : 'Conversation not retained. Its absence does not mean the agent did no work.'}
          </p>
        )}
        <VirtualList items={rows} keyOf={keyOf} render={render} scroller={scroll} target={target ? rowOf.get(target) : undefined} estimate={estimate} />
      </div>
    </>
  )
}
