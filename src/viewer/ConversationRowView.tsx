import type { ReactNode } from 'react'
import { MessageText, VerbatimContent } from './StructuredContent.js'
import type { RecordEvent } from '../record.js'
import { callsOf, compact, interval, ms, preview, textOf, toolKey, utcTime } from './model.js'
import type { RecordIndex, ToolCall } from './model.js'
import { argsLabel, callStatus, hollowSummary, outputTokens, pollSummary, thinkingMarkers } from './conversation-rows.js'
import type { CallState, ConversationRow } from './conversation-rows.js'
import type { EventFlag } from './Conversation.js'
import { messageIdentity } from './message-identity.js'

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

type Clip = { bytes: number; sha256: string | null }
/** `mcp__server__tool` reads as `tool`; the full name stays in the title. */
const toolName = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) || name : name)
const clipOf = (value: unknown): Clip | undefined =>
  value && typeof value === 'object' && 'bytes' in value ? (value as Clip) : undefined
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

export interface ConversationRenderContext {
  index: RecordIndex
  cutoff: number
  selected?: string
  opened: ReadonlySet<string>
  anchor: (event: RecordEvent) => string
  opener: (event: RecordEvent) => ((sha256: string) => void) | undefined
  setOpen: (key: string, open: boolean) => void
  sourceButton: (event: RecordEvent) => ReactNode
  flagMarks: (event: RecordEvent) => ReactNode
  paired: (event: RecordEvent, call: ToolCall) => RecordEvent[]
  thinkingSpan: ReadonlyMap<string, number>
  flags?: ReadonlyMap<string, readonly EventFlag[]>
  live: boolean
}

function HollowRow({ row, context }: { row: Extract<ConversationRow, { kind: 'hollow' }>; context: ConversationRenderContext }) {
    const { opened, selected, setOpen, sourceButton } = context
    const open = opened.has(row.key)
    const chosen = row.events.some((event) => event.id === selected)
    return (
      <details
        className={`hollow-group ${chosen ? 'selected' : ''}`}
        data-hollow-group={row.events.length}
        data-open-key={row.key}
        data-entry={row.events[0]!.id}
        open={open}
        onToggle={(e) => setOpen(row.key, e.currentTarget.open)}
      >
        <summary>
          <span className="execution-icon">
            <ToolIcon name={row.calls[0]?.name ?? 'tool'} />
          </span>
          <span className="hollow-facts">{hollowSummary(row.calls)} · arguments and results not captured</span>
          <span className="execution-time" title="Time from the first to the last call in this run">
            {row.spanMs ? interval(row.spanMs) : ''}
          </span>
          <time dateTime={row.events[0]!.at}>{utcTime(row.events[0]!.at)}</time>
        </summary>
        {open && (
          <ol className="hollow-calls">
            {row.events.flatMap((event) =>
              callsOf(event).map((call) => (
                <li key={`${event.id}:${call.id}`} data-message={event.id}>
                  <time dateTime={event.at}>{utcTime(event.at)}</time>
                  <span className="mono">{toolName(call.name)}</span>
                  <span className="poll-args">{argsLabel(call.input) ?? compact(call.input ?? '')}</span>
                  {sourceButton(event)}
                </li>
              )),
            )}
          </ol>
        )}
      </details>
    )
  }

function PollRows({ row, context }: { row: Extract<ConversationRow, { kind: 'polls' }>; context: ConversationRenderContext }) {
    const { opened, selected, setOpen, sourceButton, live } = context
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
function ToolExecutionStack({ event, at, message, context }: { event: RecordEvent; at: string; message: string; context: ConversationRenderContext }) {
  const { index, cutoff, paired, opened, setOpen, flags, flagMarks, sourceButton, opener, selected, live } = context
  const calls = callsOf(event)
  return (
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
  )
}

export function ConversationRowView({ row, context }: { row: ConversationRow; context: ConversationRenderContext }) {
    const { index, selected, anchor, thinkingSpan, opened, setOpen, flagMarks, sourceButton, opener, flags } = context
    if (row.kind === 'polls') return <PollRows row={row} context={context} />
    if (row.kind === 'hollow') return <HollowRow row={row} context={context} />
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
      ? event.detail.promptReconstructed === true ? 'Recorded assignment' : 'User message'
      : finding
        ? 'Recorded finding'
        : failed
          ? 'Request failed'
          : standalone
            ? 'Tool result'
            : event.detail.role === 'assistant'
              ? 'Agent'
              : (event.detail.role ?? 'Event')
    const author = messageIdentity(index, event)
    const agent = index.nodes.get(index.canonical(event.node))
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
            {user ? <span className="prompt-sender">{author.label}</span> : event.detail.role === 'assistant' && <span className="prompt-sender">{agent?.label ?? event.node}{agent?.harness ? ` · ${agent.harness}` : ''}</span>}
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
                {event.detail.promptKind === 'initial' ? 'Full input' : 'Full prompt'}
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
        {calls.length > 0 && <ToolExecutionStack event={event} at={at} message={message} context={context} />}
      </article>
    )
  }
