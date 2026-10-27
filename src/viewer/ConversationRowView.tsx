import type { ReactNode } from 'react'
import { AgentTimeline, UserMessage, type AgentTimelineItem } from '@tangle-network/ui/chat'
import { InlineThinkingItem, RunRowShell, type ToolCallType } from '@tangle-network/ui/run'
import type { ToolPart } from '@tangle-network/ui/types'
import { getToolDisplayMetadata } from '@tangle-network/ui/utils'
import type { RecordEvent } from '../record.js'
import { callsOf, compact, ms, preview, textOf, toolKey, utcTime } from './model.js'
import type { RecordIndex, ToolCall } from './model.js'
import { argsLabel, callStatus, hollowSummary, outputTokens, pollSummary, thinkingMarkers } from './conversation-rows.js'
import type { CallState, ConversationRow } from './conversation-rows.js'
import type { EventFlag } from './Conversation.js'
import { promptText } from './prompt-text.js'

/**
 * Every transcript is the kit's chat (Drew 2026-10-27: "make it look like a chat, like how agent-apps look"): the
 * prompts an agent received are the reader's right-aligned bubbles, the agent's words read as prose on the left, and its
 * reasoning and tool calls are the kit's one-line rows (InlineThinkingItem, InlineToolItem through AgentTimeline),
 * collapsed until opened, a failure shown on its row. Time is the row's hover title; no row carries an author line,
 * a timestamp row or a Details link.
 */

/** A run-lifecycle event (start, stop, restart), drawn as a thin marker row. */
export const isLifecycle = (event: RecordEvent) =>
  event.category === 'lifecycle' || event.detail.lifecycle !== undefined

const tokenLabel = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const spanLabel = (value: number) => {
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} m ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} m`
}

function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  const path = /think|reason/.test(lower)
    ? 'M8 2.5a4 4 0 0 0-2.5 7.1V11h5V9.6A4 4 0 0 0 8 2.5M6 13.5h4'
    : /search|grep|find/.test(lower)
      ? 'M10 10l3.5 3.5M11 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0'
      : /bash|shell|exec|run|command/.test(lower)
        ? 'M2 3h12v10H2zM4 6l2 2-2 2M8 10h4'
        : /await|wait|sleep|poll/.test(lower)
          ? 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M8 5v3l2 1.5'
          : 'M10 8a2 2 0 1 0-4 0 2 2 0 0 0 4 0'
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The tools the kit names itself ("Read", "Shell"); any other tool reads by its own name. */
const KIT_TOOLS = new Set(['bash', 'shell', 'command', 'execute', 'write', 'write_file', 'create_file', 'edit', 'patch', 'read', 'read_file', 'cat', 'grep', 'search', 'rg', 'glob', 'find', 'ls', 'web_search', 'web_fetch', 'fetch', 'task', 'agent', 'spawn'])
const TYPES: Record<string, ToolCallType> = { bash: 'bash', shell: 'bash', command: 'bash', execute: 'bash', read: 'read', read_file: 'read', cat: 'read', write: 'write', write_file: 'write', create_file: 'write', edit: 'edit', patch: 'edit', grep: 'grep', search: 'grep', rg: 'grep', glob: 'glob', find: 'glob', ls: 'list' }
/** `mcp__server__tool` reads as `tool` and `agent-runtime-coordination_send` as `coordination_send`. */
const toolName = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) || name : name).replace(/^agent-runtime-/, '')
const inputOf = (raw: string | undefined): unknown => {
  if (raw === undefined) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? value : raw
  } catch {
    return raw
  }
}
const firstLine = (text: string) => compact(text.split('\n').find((line) => line.trim()) ?? '').slice(0, 200)

/** One tool call as the kit's row: its verb and subject, collapsed; the input and output when opened; failures inline. */
function toolItem(id: string, call: ToolCall, result: RecordEvent | undefined, state: CallState, durationMs: number | null, live: boolean): AgentTimelineItem {
  const name = toolName(call.name)
  const output = result ? textOf(result) || result.detail.contentOmitted || '' : undefined
  const status = state === 'error' ? 'error' : state === 'pending' || (state === 'missing' && live) ? 'running' : 'completed'
  const note = state === 'ambiguous' || (state === 'missing' && !live) ? callStatus(state, live) : undefined
  const part: ToolPart = {
    type: 'tool',
    id,
    tool: name,
    state: {
      status,
      input: inputOf(call.input),
      ...(output !== undefined ? { output } : {}),
      ...(status === 'error' ? { error: firstLine(output ?? '') || 'The call failed.' } : {}),
      ...(durationMs !== null && durationMs >= 0 ? { time: { start: 0, end: durationMs } } : {}),
      ...(note ? { metadata: { note } } : {}),
    },
  }
  const known = KIT_TOOLS.has(name.toLowerCase())
  const meta = getToolDisplayMetadata(part)
  const detail = argsLabel(call.input) ?? (meta.description || (known ? undefined : preview(call)))
  return {
    id,
    kind: 'tool',
    part,
    call: { id, type: TYPES[name.toLowerCase()] ?? 'unknown', label: known ? meta.title : name.replaceAll('_', ' '), status: status === 'error' ? 'error' : status === 'running' ? 'running' : 'success', ...(detail ? { detail } : {}), ...(durationMs !== null && durationMs >= 0 ? { duration: durationMs } : {}) },
  }
}

const toolNote = (part: ToolPart) => {
  const note = (part.state.metadata as { note?: string } | undefined)?.note
  return note ? <span className="tool-note">{note}</span> : null
}
/** A row the kit draws as one step of the timeline: the glyph on the prose edge, like its tool rows. */
const Step = ({ id, children }: { id: string; children: ReactNode }) => <AgentTimeline className="ar-tl" items={[{ id, kind: 'custom', content: children }]} />

type Clip = { bytes: number; sha256: string | null }
const clipOf = (value: unknown): Clip | undefined => (value && typeof value === 'object' && 'bytes' in value ? (value as Clip) : undefined)
/** A clipped body names what was left out and opens its full source text. */
function ClipNote({ clip, open }: { clip?: Clip; open?: (sha256: string) => void }) {
  if (!clip) return null
  return (
    <p className="clip-note">
      <span>{new Intl.NumberFormat('en-US').format(clip.bytes)} bytes, middle omitted.</span>
      {clip.sha256 && open ? <button type="button" className="link-button" data-load-full={clip.sha256} onClick={() => open(clip.sha256!)}>Full output</button> : null}
    </p>
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
  flagMarks: (event: RecordEvent) => ReactNode
  paired: (event: RecordEvent, call: ToolCall) => RecordEvent[]
  thinkingSpan: ReadonlyMap<string, number>
  flags?: ReadonlyMap<string, readonly EventFlag[]>
  live: boolean
}

/** Repeated calls answered only by pending receipts: one row, the calls listed when opened. */
function PollRows({ row, context }: { row: Extract<ConversationRow, { kind: 'polls' }>; context: ConversationRenderContext }) {
  const summary = pollSummary(row.events)
  const args = argsLabel(row.input) ?? compact(row.input ?? '')
  return (
    <div className={`chat-row poll-group${row.events.some((event) => event.id === context.selected) ? ' selected' : ''}`} data-poll-group={row.events.length} data-entry={row.events[0]!.id} title={utcTime(row.events[0]!.at)}>
      <Step id={row.key}>
        <RunRowShell icon={<ToolIcon name={row.name} />} title={toolName(row.name)} description={[summary.label, args].filter(Boolean).join(' · ')} descriptionMono>
          <ol className="poll-calls">
            {row.events.map((event) => (
              <li key={event.id} data-message={event.id}><time dateTime={event.at}>{utcTime(event.at)}</time><span className="mono">{argsLabel(callsOf(event)[0]?.input) ?? compact(callsOf(event)[0]?.input ?? '')}</span></li>
            ))}
          </ol>
        </RunRowShell>
      </Step>
    </div>
  )
}

/** Consecutive tool turns whose arguments and results were not captured: one row naming the calls. */
function HollowRow({ row, context }: { row: Extract<ConversationRow, { kind: 'hollow' }>; context: ConversationRenderContext }) {
  return (
    <div className={`chat-row hollow-group${row.events.some((event) => event.id === context.selected) ? ' selected' : ''}`} data-hollow-group={row.events.length} data-entry={row.events[0]!.id} title={utcTime(row.events[0]!.at)}>
      <Step id={row.key}>
        <RunRowShell icon={<ToolIcon name={row.calls[0]?.name ?? 'tool'} />} title={hollowSummary(row.calls)} description="args not captured" durationMs={row.spanMs || undefined} />
      </Step>
    </div>
  )
}

export function ConversationRowView({ row, context }: { row: ConversationRow; context: ConversationRenderContext }) {
  if (row.kind === 'polls') return <PollRows row={row} context={context} />
  if (row.kind === 'hollow') return <HollowRow row={row} context={context} />
  const { index, cutoff, selected, anchor, thinkingSpan, opened, setOpen, flagMarks, opener, flags, paired, live } = context
  const event = row.event
  const rowProps = {
    className: ['chat-row', selected === event.id && 'selected', flags?.has(event.id) && 'flagged'].filter(Boolean).join(' '),
    'data-entry': event.id,
    'data-message': event.id,
    'data-message-node': event.node,
    title: utcTime(event.at),
  }
  if (isLifecycle(event)) {
    const text = textOf(event)
    return (
      <p {...rowProps} className={`${rowProps.className} lifecycle-note${event.detail.isError ? ' lifecycle-error' : ''}`}>
        <b>{event.label}</b>{text && <span>{compact(text).slice(0, 280)}</span>}{flagMarks(event)}
      </p>
    )
  }
  const message = textOf(event)
  const calls = callsOf(event)
  const reasoning = typeof event.detail.reasoning === 'string' ? event.detail.reasoning : ''
  const withheld = thinkingMarkers(event.detail)
  const user = event.detail.role === 'user'
  const failed = event.detail.responseStatus === 'error'
  const finding = event.detail.recordedClaim !== undefined
  const standalone = event.detail.toolCallId !== undefined || event.detail.role === 'toolResult'
  const clip = clipOf(event.detail.clip)
  // The prompt an agent received is the reader's own bubble; a long one opens in full on request.
  if (user && message && !standalone) {
    const body = promptText(message)
    const key = `prompt:${anchor(event)}`
    const long = body.length > 280
    const short = long && !opened.has(key)
    return (
      <article {...rowProps}>
        <div className="ar-user">
          <UserMessage content={short ? `${body.slice(0, 280).trimEnd()}…` : body} timestamp={new Date(event.at)}
            actions={long ? <button type="button" className="link-button" data-open-key={key} aria-expanded={!short} onClick={() => setOpen(key, short)}>{short ? 'Full prompt' : 'Shorter'}</button> : undefined} />
        </div>
        {!short && <ClipNote clip={clip} open={opener(event)} />}
        {flagMarks(event)}
      </article>
    )
  }
  const items: AgentTimelineItem[] = []
  if (reasoning) items.push({ id: `${event.id}:reasoning`, kind: 'custom', content: <InlineThinkingItem part={{ type: 'reasoning', text: reasoning }} autoCollapse={false} /> })
  if (withheld.length) {
    // The provider withheld the text; the turn is sized by what the record measured: its output tokens and the time
    // since the agent's previous event.
    const output = outputTokens(event.detail)
    const span = thinkingSpan.get(event.id)
    const label = output !== null ? `${span !== undefined && span >= 1000 ? `for ${spanLabel(span)} · ` : ''}${tokenLabel(output)} output tokens · ${withheld.join(' · ')}` : withheld.join(' · ')
    items.push({ id: `${event.id}:thinking`, kind: 'custom', content: <span data-thinking-withheld><RunRowShell icon={<ToolIcon name="think" />} title="Thought" description={label} /></span> })
  }
  if (failed) items.push({ id: event.id, kind: 'status', tone: 'error', label: 'The request failed', detail: message ? compact(message).slice(0, 400) : 'No assistant response is present in this record.' })
  else if (finding) items.push({ id: event.id, kind: 'status', tone: 'info', label: 'Recorded finding', detail: compact(message).slice(0, 600) })
  else if (standalone) {
    const unpaired = event.detail.toolCallId !== undefined && (index.calls.get(toolKey(event.node, event.detail.toolCallId))?.length ?? 0) > 1
    items.push(toolItem(event.id, { id: event.id, name: event.label || 'Tool result' }, event, unpaired ? 'ambiguous' : event.detail.isError ? 'error' : 'returned', null, live))
  } else if (message) items.push({ id: event.id, kind: 'message', role: 'assistant', content: message })
  else if (!calls.length && !reasoning && !withheld.length) items.push({ id: event.id, kind: 'status', label: event.detail.contentOmitted ?? 'No text body is present in this record.' })
  const at = anchor(event)
  for (const call of calls) {
    const all = paired(event, call)
    const returned = all.filter((result) => ms(result.at) <= cutoff)
    const last = returned.at(-1)
    const ambiguous = (index.calls.get(toolKey(event.node, call.id))?.length ?? 0) > 1
    const state: CallState = ambiguous ? 'ambiguous' : last ? (last.detail.isError ? 'error' : 'returned') : all.some((result) => ms(result.at) > cutoff) ? 'pending' : 'missing'
    const recorded = typeof last?.detail.durationMs === 'number' ? last.detail.durationMs : null
    const duration = recorded ?? (last && last.detail.atBasis !== 'carried' ? ms(last.at) - ms(event.at) : null)
    items.push(toolItem(`tool:${at}:${call.id}`, call, last, state, duration, live))
  }
  const notes = [event.detail.publicationNote, finding ? event.detail.assessment : undefined].filter((note): note is string => Boolean(note))
  return (
    <article {...rowProps}>
      <AgentTimeline className="ar-tl" items={items} renderToolActions={toolNote} />
      {message && !standalone && <ClipNote clip={calls.length ? undefined : clip} open={opener(event)} />}
      {notes.map((note) => <p key={note} className="publication-note">{note}</p>)}
      {flagMarks(event)}
    </article>
  )
}
