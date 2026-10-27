import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { VirtualList } from './VirtualList.js'
import { ConversationRowView, isLifecycle } from './ConversationRowView.js'
import type { RecordEvent } from '../record.js'
import {
  callsOf,
  eventMatches,
  ms,
  textOf,
  toolKey,
} from './model.js'
import type { RecordIndex, ToolCall } from './model.js'
import { anchorsOf, answeredBy, collapseHollowTurns, collapsePolls, quietThinking, thinkingMarkers } from './conversation-rows.js'
import type { ConversationRow } from './conversation-rows.js'

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

export function Conversation({
  index,
  actor,
  cutoff,
  query,
  category,
  selected,
  openSource,
  flags,
  onFlag,
  lifecycle = false,
  live = false,
}: ConversationProps) {
  // The opening prompt starts open (who asked what comes first) but stays collapsible like every other row.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
    const at = anchorsOf(index.events)
    return new Set(index.events.filter((event) => event.detail.promptKind === 'initial').map((event) => `prompt:${at.get(event.id) ?? event.id}`))
  })
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
      collapseHollowTurns(
        collapsePolls(items, {
          callsOf,
          answered: (event, id) => answeredBy(index.results.get(toolKey(event.node, id))),
          keyOf: anchor,
        }),
        {
          callsOf,
          captured: (event, id) =>
            (index.results.get(toolKey(event.node, id)) ?? []).some((result) => textOf(result)),
          keyOf: anchor,
        },
      ),
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
      else if (row.kind === 'hollow') for (const event of row.events) map.set(event.id, row.key)
      else map.set(row.event.id, row.key)
    return map
  }, [rows])
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
    // A live conversation opens at its newest event and follows it; a recorded one opens at its first message.
    following.current = live && !targetRef.current
    if (scroll.current && !targetRef.current) scroll.current.scrollTop = live ? scroll.current.scrollHeight : 0
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
        ? 36
        : row.kind === 'hollow'
          ? 26
          : isLifecycle(row.event)
            ? 26
            : !textOf(row.event) && callsOf(row.event).length
              ? 16 + 36 * callsOf(row.event).length
              : 96,
    [],
  )
  const render = (row: ConversationRow) => <ConversationRowView row={row} context={{ index, cutoff, selected, opened, anchor, opener, setOpen, flagMarks, paired, thinkingSpan, flags, live }} />
  return (
    <>
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
