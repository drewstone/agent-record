import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** How many characters of a value show while it is collapsed. */
export const VALUE_PREVIEW = 240

const count = new Intl.NumberFormat('en-US')

/**
 * What a value shows while it is collapsed: its first `limit` characters on one line, or null when the value is short
 * enough to show whole. The cut never splits a surrogate pair.
 */
export function valuePreview(text: string, limit: number = VALUE_PREVIEW): string | null {
  if (text.length <= limit) return null
  let head = text.replace(/\s+/gu, ' ').trim().slice(0, limit)
  if (/[\uD800-\uDBFF]$/u.test(head)) head = head.slice(0, -1)
  return head
}

/** A value's length as the toggle states it. */
export const valueChars = (text: string): string => `${count.format(text.length)} chars`

interface Command {
  /** Whether the last expand all / collapse all left the page's values open. */
  openAll: boolean
  /** Counts the page's commands: a value that sees a new one follows it, whatever it was showing. */
  epoch: number
  /** A long value announces itself while it is on the page, so the controls know there is something to expand. */
  register: () => () => void
  set: (open: boolean) => void
}

/** A value's own state after the page's latest command: the command wins once, then the reader's clicks win again. */
export function followCommand(
  state: { open: boolean; seen: number },
  command: { openAll: boolean; epoch: number },
): { open: boolean; seen: number } {
  return state.seen === command.epoch ? state : { open: command.openAll, seen: command.epoch }
}

const noop = () => undefined
const Commands = createContext<Command>({ openAll: false, epoch: 0, register: () => noop, set: noop })
const Longs = createContext(0)

/**
 * One page's values: the expand all / collapse all controls act on every collapsible value inside it, and a value that
 * appears later (another profile selected) starts as the last command left the rest.
 */
export function ValueScope({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [state, setState] = useState({ openAll: defaultOpen, epoch: 0 })
  const [longs, setLongs] = useState(0)
  const register = useCallback(() => {
    setLongs((value) => value + 1)
    return () => setLongs((value) => value - 1)
  }, [])
  const set = useCallback((openAll: boolean) => setState((value) => ({ openAll, epoch: value.epoch + 1 })), [])
  const command = useMemo(() => ({ ...state, register, set }), [state, register, set])
  return (
    <Commands.Provider value={command}>
      <Longs.Provider value={longs}>{children}</Longs.Provider>
    </Commands.Provider>
  )
}

/** Expand all / collapse all for the values of the enclosing ValueScope; hidden while the page has no long value. */
export function ValueControls() {
  const { set } = useContext(Commands)
  const longs = useContext(Longs)
  return (
    <div className="cv-bar" role="group" aria-label="Long values" hidden={longs === 0} data-value-controls>
      <button type="button" className="ui-button" data-value-command="expand" onClick={() => set(true)}>Expand all</button>
      <button type="button" className="ui-button" data-value-command="collapse" onClick={() => set(false)}>Collapse all</button>
      <span className="faint">{longs} long {longs === 1 ? 'value' : 'values'}, each shown whole in place</span>
    </div>
  )
}

/**
 * One value that is never cut without a way to see it whole. A value of at most `limit` characters shows as it is. A
 * longer one shows its first `limit` characters and "show full (N chars)"; the toggle expands the whole value in place
 * as a pre-wrap block. It is made of inline elements, so it sits in a paragraph, a definition or a list item.
 */
export function CollapsibleValue({
  value,
  limit = VALUE_PREVIEW,
  empty = 'not set',
  className,
}: {
  value: string | null | undefined
  limit?: number
  /** What shows for a missing or blank value. */
  empty?: string
  className?: string
}) {
  const command = useContext(Commands)
  const [state, setState] = useState({ open: command.openAll, seen: command.epoch })
  const current = followCommand(state, command)
  if (current !== state) setState(current)
  const { open } = current
  const text = value ?? ''
  const blank = text.trim() === ''
  const preview = useMemo(() => (blank ? null : valuePreview(text, limit)), [blank, text, limit])
  const long = preview !== null
  const { register } = command
  useEffect(() => (long ? register() : undefined), [long, register])
  const id = useId()
  if (blank) return <span className="faint">{empty}</span>
  if (preview === null) return <span className={className}>{text}</span>
  const chars = valueChars(text)
  const toggle = (
    <button type="button" className="link-button cv-toggle" aria-expanded={open} aria-controls={id} onClick={() => setState({ ...current, open: !open })}>
      {open ? `collapse (${chars})` : `show full (${chars})`}
    </button>
  )
  return (
    <span className={`cv ${open ? 'cv-open' : ''} ${className ?? ''}`.trim()} data-value-chars={text.length}>
      {open ? (
        <>
          {toggle}
          <span id={id} className="cv-full">{text}</span>
        </>
      ) : (
        <>
          <span id={id} className="cv-head">{preview}…</span> {toggle}
        </>
      )}
    </span>
  )
}
