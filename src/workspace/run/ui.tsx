import { createContext, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type Agent, abbr, count, finished, lat, type RunModel, elapsed, type ToolStats, usd } from './model.js'

/** The run page's glyphs, 16 px strokes in the text colour. */
const PATHS = {
  search: 'M11 11l3.5 3.5M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z',
  chevron: 'M4 6l4 4 4-4',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  x: 'M4 4l8 8M12 4l-8 8',
  stop: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM3.5 12.5l9-9',
  download: 'M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.2v4M8 4.8v.2',
  max: 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9',
  min: 'M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  users: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 2.2a2.5 2.5 0 0 1 0 4.6M12.5 9.7c1.2.6 2 1.9 2 3.3',
  alert: 'M8 1.8l6.5 11.5h-13zM8 6v3.5M8 11.4v.2',
  check: 'M3 8.5l3 3 7-7',
  clock: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  flag: 'M3 14.5V2M3 2.5h8l-1.5 3 1.5 3H3',
  down: 'M8 2.5v11M3.5 9L8 13.5 12.5 9',
  file: 'M9.5 1.8h-5a1.5 1.5 0 0 0-1.5 1.5v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.3zM9.5 1.8v3.5H13M5.5 8.5h5M5.5 11h3.5',
} as const
export type IconName = keyof typeof PATHS
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`rp-i${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export const StateDot = ({ tone }: { tone: Agent['state']['tone'] | 'held' }) => <span className={`rp-dot${tone ? ` ${tone}` : ''}`} aria-hidden="true" />

/** Long names keep their start and their end: `records-grap…20261026a.md`. */
export function middle(text: string, max: number) {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.55)
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`
}

/** An agent's name in `max` characters: whole when it fits, else what tells it apart (its short name) cut in the middle. */
export const nameFit = (a: { name: string; short: string }, max: number) => (a.name.length <= max ? a.name : middle(a.short, max))

/** The match in a label, underlined. */
export function Hilite({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

// ----------------------------------------------------------------- the hover card: one component for every mark

type CardRequest = { content: ReactNode; rect: { top: number; bottom: number; left: number; right: number }; x?: number; bounds?: DOMRect; follow?: boolean; vertical?: boolean; wide?: boolean }
type CardApi = { show: (request: CardRequest) => void; hide: () => void; hideNow: () => void; pin: () => void; pinned: () => boolean }
const CardContext = createContext<CardApi | null>(null)
export const useCard = () => useContext(CardContext)!

/**
 * The card layer. A static anchor's card waits 160 ms before closing, so the pointer can move onto it; a card that follows the
 * pointer lets it pass (pointer-events none) until a click pins it, which adds a close button. Escape closes it.
 */
export function CardLayer({ children }: { children: ReactNode }) {
  const [card, setCard] = useState<(CardRequest & { pinned?: boolean }) | null>(null)
  const pinnedRef = useRef(false)
  const timer = useRef(0)
  const element = useRef<HTMLDivElement>(null)
  const api = useMemo<CardApi>(() => ({
    show: (request) => {
      if (pinnedRef.current) return
      window.clearTimeout(timer.current)
      setCard(request)
    },
    hide: () => {
      if (pinnedRef.current) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (!element.current?.matches(':hover') && !element.current?.contains(document.activeElement)) setCard(null)
      }, 160)
    },
    hideNow: () => {
      window.clearTimeout(timer.current)
      pinnedRef.current = false
      setCard(null)
    },
    pin: () => {
      pinnedRef.current = true
      setCard((current) => (current ? { ...current, follow: false, pinned: true } : current))
    },
    pinned: () => pinnedRef.current,
  }), [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') api.hideNow() }
    const down = (event: PointerEvent) => { if (pinnedRef.current && element.current && !element.current.contains(event.target as Node)) api.hideNow() }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down) }
  }, [api])
  useLayoutEffect(() => {
    const el = element.current
    if (!el || !card) return
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 12
    const { rect, bounds } = card
    let left: number, top: number
    if (vw <= 720 || (card.vertical && bounds)) {
      // Below the mark, else above it, inside the bounds (topology nodes, phones).
      left = Math.max((bounds?.left ?? 0) + 8, Math.min(rect.left, (bounds?.right ?? vw) - 8 - w))
      if (vw <= 720) left = Math.max(m, (vw - w) / 2)
      top = rect.bottom + 8
      if (top + h > Math.min(vh, bounds?.bottom ?? vh) - 8) top = rect.top - 8 - h
    } else {
      const B = bounds ? { l: Math.max(m, bounds.left + 8), r: Math.min(vw - m, bounds.right - 8), t: Math.max(m, bounds.top + 8), b: Math.min(vh - m, bounds.bottom - 8) } : { l: m, r: vw - m, t: m, b: vh - m }
      const right = card.x ?? rect.right, leftEdge = card.x ?? rect.left
      left = right + 14
      if (left + w > B.r) left = leftEdge - 14 - w
      if (left < B.l) left = Math.max(m, Math.min(vw - w - m, right + 14))
      top = rect.top + (rect.bottom - rect.top) / 2 - h / 2
      top = h <= B.b - B.t ? Math.max(B.t, Math.min(top, B.b - h)) : Math.max(m, Math.min(top, vh - h - m))
    }
    el.style.left = `${Math.round(Math.max(m, left))}px`
    el.style.top = `${Math.round(Math.max(m, Math.min(top, vh - h - m)))}px`
  }, [card])
  return (
    <CardContext.Provider value={api}>
      {children}
      {card && typeof document !== 'undefined' && createPortal(
        <div ref={element} className={`rp-hc${card.wide ? ' wide' : ''}${card.follow ? ' follow' : ''}`} role={card.pinned ? 'dialog' : 'tooltip'} data-pinned={card.pinned || undefined}
          onPointerLeave={() => { if (!pinnedRef.current) setCard(null) }}>
          {card.pinned && <button type="button" className="rp-card-x" aria-label="Close" onClick={api.hideNow}><Icon name="x" size={14} /></button>}
          {card.content}
        </div>,
        document.querySelector('.agent-record') ?? document.body,
      )}
    </CardContext.Provider>
  )
}

/** Hover and focus handlers that open `content()` beside the element. */
export function useHoverTarget(content: () => ReactNode, options: { bounds?: () => DOMRect | undefined; vertical?: boolean; wide?: boolean } = {}) {
  const card = useCard()
  const open = (target: Element) => {
    const r = target.getBoundingClientRect()
    card.show({ content: content(), rect: r, bounds: options.bounds?.(), vertical: options.vertical, wide: options.wide })
  }
  return {
    onPointerEnter: (e: ReactPointerEvent) => open(e.currentTarget),
    onPointerLeave: () => card.hide(),
    onFocus: (e: ReactFocusEvent) => open(e.currentTarget),
    onBlur: () => card.hide(),
  }
}

function ToolTable({ tools, rows = 9 }: { tools: ToolStats[]; rows?: number }) {
  const max = Math.max(1, ...tools.map((t) => t.calls))
  return (
    <div className="rp-tt">
      <span className="h">Tool</span><span className="h" /><span className="h r">calls</span><span className="h r">✕ · p50</span>
      {tools.slice(0, rows).map((t) => (
        <ToolRow key={t.name} t={t} max={max} />
      ))}
      {tools.length > rows && (
        <>
          <span className="l">{tools.length - rows} more tools</span><span /><span className="r">{count(tools.slice(rows).reduce((s, t) => s + t.calls, 0))}</span><span />
        </>
      )}
    </div>
  )
}
function ToolRow({ t, max }: { t: ToolStats; max: number }) {
  return (
    <>
      <span className="l" title={t.name}>{t.name}</span>
      <Bar ok={t.calls - t.failures} failed={t.failures} max={max} />
      <span className="r">{count(t.calls)}</span>
      <span className={t.failures ? 'f' : 'r'}>{t.failures ? `${t.failures} ✕` : lat(t.p50)}</span>
    </>
  )
}
/** A count bar with its failed part in the failure ink. */
export function Bar({ ok, failed = 0, max }: { ok: number; failed?: number; max: number }) {
  return (
    <span className="rp-bar" aria-hidden="true">
      <b style={{ width: `${(Math.max(0, ok) / max) * 100}%` }} />
      {failed > 0 && <b className="f" style={{ width: `${(failed / max) * 100}%` }} />}
    </span>
  )
}

export const agentCost = (a: { billedUsd: number | null; listUsd: number | null }) =>
  a.listUsd !== null ? `${usd(a.listUsd)} list · ${usd(a.billedUsd ?? 0)} billed` : a.billedUsd !== null ? `${usd(a.billedUsd)} billed` : 'not recorded'

/** An agent's whole-run metrics, with tool calls by tool beside them: the card every agent mark opens. */
export function AgentCard({ m, a, head }: { m: RunModel; a: Agent; head?: ReactNode }) {
  const clock = (ms: number) => new Date(m.t0 + ms).toISOString().slice(11, 16)
  const parent = a.parent ? m.byId.get(a.parent) : null
  return (
    <>
      {head ?? (
        <div className="rp-card-h">
          <div className="t"><StateDot tone={a.state.tone} /><span className="nm">{a.name}</span><span className="v">{a.state.label}</span></div>
          <div className="s">{parent ? `spawned by ${parent.name}${a.start !== null ? ` at ${clock(Math.max(0, a.start))} UTC` : ''}` : `run root · ${clock(0)} UTC`}</div>
        </div>
      )}
      <div className={`rp-card-cols${a.tools.length ? ' two' : ''}`}>
        <section>
          <h6>Whole run{a.model ? ` · ${a.model}` : ''}</h6>
          <dl>
            <dt>Tokens</dt><dd>{a.tokens === null ? 'not recorded' : abbr(a.tokens)}</dd>
            {a.tokens !== null && <><dt>In · out · cached</dt><dd>{a.byClass ? `${abbr(a.byClass.input)} · ${abbr(a.byClass.output)} · ${abbr(a.byClass.cacheRead)}` : <small>not recorded</small>}</dd></>}
            <dt>Cost</dt><dd>{agentCost(a)}</dd>
            <dt>Model calls</dt><dd>{count(a.modelCalls)}</dd>
            {a.latency.p50 !== null && <><dt>Model p50 · p90 · p99</dt><dd>{lat(a.latency.p50)} · {lat(a.latency.p90)} · {lat(a.latency.p99)}</dd></>}
            <dt>Tool calls</dt><dd>{count(a.toolCalls)}{a.toolFailures ? <span className="f"> · {a.toolFailures} failed</span> : null}</dd>
            {a.retries > 0 && <><dt>Retried steps</dt><dd>{a.retries}</dd></>}
            <dt>Restarts</dt><dd>{a.restarts.length}</dd>
            <dt>Spawned · commits</dt><dd>{a.children.length} · {a.commits ?? '—'}</dd>
            <dt>Active</dt><dd>{a.first === null ? 'never' : `${clock(a.first)}–${a.state.tone === 'live' ? 'now' : clock(a.last ?? a.first)} UTC`}</dd>
            {a.first !== null && <><dt>Busy</dt><dd>{elapsed(a.busy)}</dd></>}
          </dl>
        </section>
        {a.tools.length > 0 && (
          <section>
            <h6>Tool calls by tool</h6>
            <ToolTable tools={a.tools} />
          </section>
        )}
      </div>
    </>
  )
}

/** The totals of a team: its members' tokens, calls and tools. */
export function TeamCard({ m, team }: { m: RunModel; team: { id: string; label: string; members: string[] } }) {
  const members = team.members.map((id) => m.byId.get(id)!).filter(Boolean)
  const tools = new Map<string, ToolStats>()
  for (const a of members) for (const t of a.tools) {
    const x = tools.get(t.name) ?? { ...t, calls: 0, failures: 0, ms: 0, durations: [] }
    tools.set(t.name, { ...x, calls: x.calls + t.calls, failures: x.failures + t.failures, ms: x.ms + t.ms, durations: [...x.durations, ...t.durations] })
  }
  const sum = (pick: (a: Agent) => number) => members.reduce((s, a) => s + pick(a), 0)
  const running = members.filter((a) => a.state.tone === 'live').length
  return (
    <>
      <div className="rp-card-h"><div className="t"><Icon name="users" /><span className="nm">{team.label}</span><span className="v">{members.length} agents</span></div><div className="s">{running} running · {members.filter((a) => finished(a.state.tone)).length} done</div></div>
      <div className="rp-card-cols two">
        <section><h6>Team totals</h6><dl>
          <dt>Tokens</dt><dd>{abbr(sum((a) => a.tokens ?? 0))}</dd>
          <dt>Model calls</dt><dd>{count(sum((a) => a.modelCalls))}</dd>
          <dt>Tool calls</dt><dd>{count(sum((a) => a.toolCalls))}<span className="f"> · {sum((a) => a.toolFailures)} failed</span></dd>
          <dt>Commits</dt><dd>{sum((a) => a.commits ?? 0)}</dd>
        </dl></section>
        <section><h6>Tool calls by tool</h6><ToolTable tools={[...tools.values()].sort((a, b) => b.calls - a.calls)} /></section>
      </div>
    </>
  )
}

// ----------------------------------------------------------------- the picker: one designed, searchable listbox

export type PickerOption = { id: string; label: string; meta?: string; group?: string | null; tone?: Agent['state']['tone']; find?: string }
type Row = { kind: 'all' } | { kind: 'group'; id: string; label: string; members: string[] } | { kind: 'option'; option: PickerOption }
type PickerValue<M extends boolean> = M extends true ? ReadonlySet<string> : string | null
type PickerProps<M extends boolean> = {
  label: string
  options: readonly PickerOption[]
  groups?: readonly { id: string; label: string }[]
  all?: { label: string; meta?: string }
  placeholder?: string
  width?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  multi?: M
  value: PickerValue<M>
  onChange: (value: PickerValue<M>) => void
}
type AnyPicker = { label: string; options: readonly PickerOption[]; groups?: readonly { id: string; label: string }[]; all?: { label: string; meta?: string }; placeholder?: string; width?: number; multi?: boolean; value: string | null | ReadonlySet<string>; onChange: (value: never) => void }

const ROW = 36
/**
 * A combobox for every choice on the page: search with the match underlined, groups (a group row selects its members),
 * check marks or checkboxes, counts, and the keyboard (arrows, Page Up/Down, Home/End, Enter, Escape). Only the rows in
 * view are in the document, so a 100-agent list costs what a 10-agent one does.
 */
export function Picker<M extends boolean = false>(props: PickerProps<M>) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={trigger} type="button" className={`rp-cbx${props.className ? ` ${props.className}` : ''}`} style={props.style} aria-haspopup="listbox" aria-expanded={open} aria-label={props.label} onClick={() => setOpen(!open)}>
        <span className="lbl">{props.children}</span>
        <span className="cv"><Icon name="chevron" size={14} /></span>
      </button>
      {open && <PickerList {...(props as unknown as AnyPicker)} anchor={trigger.current!} onClose={(focus) => { setOpen(false); if (focus) trigger.current?.focus() }} />}
    </>
  )
}

function PickerList(props: AnyPicker & { anchor: HTMLElement; onClose: (focus: boolean) => void }) {
  const { options, groups, all, multi, anchor, onClose } = props
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [scroll, setScroll] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useMemo(() => `pk-${Math.random().toString(36).slice(2, 8)}`, [])
  const selected = (option: string) => (multi ? (props.value as ReadonlySet<string>).has(option) : props.value === option)
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const hit = (o: PickerOption) => !q || `${o.label} ${o.find ?? ''}`.toLowerCase().includes(q)
    const out: Row[] = []
    if (all && !q) out.push({ kind: 'all' })
    const grouped = new Set((groups ?? []).map((g) => g.id))
    for (const o of options) if (!o.group || !grouped.has(o.group)) { if (hit(o)) out.push({ kind: 'option', option: o }) }
    for (const g of groups ?? []) {
      const members = options.filter((o) => o.group === g.id)
      const shown = members.filter(hit)
      if (!shown.length) continue
      out.push({ kind: 'group', id: g.id, label: g.label, members: members.map((o) => o.id) })
      for (const o of shown) out.push({ kind: 'option', option: o })
    }
    return out
  }, [options, groups, all, query])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const r = anchor.getBoundingClientRect()
    const w = Math.max(r.width, props.width ?? 280)
    el.style.width = `${Math.min(w, window.innerWidth - 24)}px`
    el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - el.offsetWidth - 12))}px`
    const below = window.innerHeight - r.bottom
    el.style.top = below > el.offsetHeight + 16 || below > r.top ? `${r.bottom + 6}px` : `${Math.max(12, r.top - 6 - el.offsetHeight)}px`
  }, [anchor, rows.length, props.width])
  useEffect(() => {
    const down = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false) }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [anchor, onClose])
  useEffect(() => setActive(0), [query])
  const choose = (row: Row | undefined) => {
    if (!row) return
    if (!multi) {
      const change = props.onChange as (v: string | null) => void
      change(row.kind === 'option' ? row.option.id : row.kind === 'group' ? row.id : null)
      onClose(true)
      return
    }
    const current = new Set(props.value as ReadonlySet<string>)
    const change = props.onChange as (v: ReadonlySet<string>) => void
    if (row.kind === 'all') return change(new Set())
    if (row.kind === 'group') {
      const every = row.members.every((m) => current.has(m))
      for (const m of row.members) every ? current.delete(m) : current.add(m)
      return change(current)
    }
    current.has(row.option.id) ? current.delete(row.option.id) : current.add(row.option.id)
    change(current)
  }
  const keep = (index: number) => {
    const el = list.current
    if (!el) return
    const top = index * ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  }
  const move = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to))
    setActive(next)
    keep(next)
  }
  const key = (event: ReactKeyboardEvent) => {
    const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 360) / ROW) - 1)
    const map: Record<string, () => void> = {
      ArrowDown: () => move(active + 1), ArrowUp: () => move(active - 1), PageDown: () => move(active + page), PageUp: () => move(active - page),
      Home: () => move(0), End: () => move(rows.length - 1), Enter: () => choose(rows[active]), Escape: () => onClose(true), Tab: () => onClose(false),
    }
    const run = map[event.key]
    if (!run) return
    if (event.key !== 'Tab') event.preventDefault()
    run()
  }
  const height = Math.min(rows.length * ROW + 8, 8 * ROW + 8)
  const first = Math.max(0, Math.floor(scroll / ROW) - 4)
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 4)
  const allChosen = multi ? (props.value as ReadonlySet<string>).size === 0 : props.value === null
  return createPortal(
    <div ref={box} className="rp-lb" role="presentation">
      <div className="rp-lb-s">
        <Icon name="search" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={key} placeholder={props.placeholder ?? 'Search'} aria-label={props.placeholder ?? props.label}
          role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={rows[active] ? `${id}-${active}` : undefined} aria-autocomplete="list" />
        <kbd>Esc</kbd>
      </div>
      {rows.length ? (
        <div ref={list} id={id} className="rp-lb-l" role="listbox" aria-multiselectable={multi || undefined} aria-label={props.label} style={{ height }} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {rows.slice(first, last).map((row, k) => {
              const i = first + k
              const style = { top: i * ROW + 4 }
              const cls = `rp-lb-r${i === active ? ' active' : ''}`
              if (row.kind === 'group') {
                const n = row.members.filter((m) => selected(m)).length
                return (
                  <div key={`g:${row.id}`} id={`${id}-${i}`} role="option" aria-selected={multi ? n === row.members.length : selected(row.id)} className={`${cls} grp`} style={style} onPointerEnter={() => setActive(i)} onClick={() => choose(row)}>
                    {multi ? <span className={`box${n && n < row.members.length ? ' part' : ''}`}>{n === row.members.length ? <Icon name="check" size={12} /> : n ? '–' : null}</span> : <span className="ck" />}
                    <Icon name="users" size={14} />
                    <span className="nm">{row.label}</span>
                    <span className="mt">{row.members.length}</span>
                  </div>
                )
              }
              const on = row.kind === 'all' ? allChosen : selected(row.option.id)
              const label = row.kind === 'all' ? all!.label : row.option.label
              const meta = row.kind === 'all' ? all!.meta : row.option.meta
              return (
                <div key={row.kind === 'all' ? 'all' : row.option.id} id={`${id}-${i}`} role="option" aria-selected={on} className={`${cls} opt`} style={style} onPointerEnter={() => setActive(i)} onClick={() => choose(row)}>
                  {multi ? <span className="box">{on ? <Icon name="check" size={12} /> : null}</span> : <span className="ck">{on ? <Icon name="check" size={14} /> : null}</span>}
                  {row.kind === 'option' && row.option.tone !== undefined && <StateDot tone={row.option.tone} />}
                  <span className="nm"><Hilite text={label} query={query} /></span>
                  {meta && <span className="mt">{meta}</span>}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rp-lb-e">Nothing matches “{query}”</div>
      )}
      {multi && (
        <div className="rp-lb-f">
          <span>{(props.value as ReadonlySet<string>).size ? `${(props.value as ReadonlySet<string>).size} selected` : 'All'}</span>
          <span className="end">
            <button type="button" className="rp-btn sm" onClick={() => (props.onChange as (v: ReadonlySet<string>) => void)(new Set())}>Clear</button>
            <button type="button" className="rp-btn sm framed" onClick={() => onClose(true)}>Done</button>
          </span>
        </div>
      )}
    </div>,
    anchor.closest('.agent-record') ?? document.body,
  )
}

/** The agents as picker options, grouped by team when the run has teams. */
export function agentOptions(m: RunModel, keep: (a: Agent) => boolean = () => true, meta: (a: Agent) => string = (a) => (a.tokens === null ? '—' : abbr(a.tokens))): PickerOption[] {
  return m.tree.filter(keep).map((a) => ({ id: a.id, label: a.name, find: a.node.label, tone: a.state.tone, meta: meta(a), group: m.teams.length ? (a.team && a.team !== a.id ? a.team : null) : null }))
}
export const agentGroups = (m: RunModel) => (m.teams.length ? m.teams.map((t) => ({ id: t.id, label: t.label })) : undefined)

/** A fixed-row window over a scroller: the first and last row to render, the spacer heights, and the scroller's width. */
export function useRows(scroller: RefObject<HTMLElement | null>, count: number, row: number, overscan = 6) {
  const [view, setView] = useState({ top: 0, height: 800, width: 0 })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const update = () => { frame = 0; setView({ top: el.scrollTop, height: el.clientHeight || 800, width: el.clientWidth }) }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    return () => { cancelAnimationFrame(frame); el.removeEventListener('scroll', schedule); resize.disconnect() }
  }, [scroller])
  const first = Math.max(0, Math.floor(view.top / row) - overscan)
  const last = Math.min(count, Math.ceil((view.top + view.height) / row) + overscan)
  return { first, last, before: first * row, after: Math.max(0, (count - last) * row), width: view.width }
}

export function useNarrow() {
  const query = '(max-width: 720px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const change = () => setNarrow(list.matches)
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [])
  return narrow
}

export const useStable = <T,>(fn: T) => {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: unknown[]) => (ref.current as unknown as (...a: unknown[]) => unknown)(...args), []) as unknown as T
}
