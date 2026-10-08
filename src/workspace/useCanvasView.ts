import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

/** A canvas's view of its world: translation in screen pixels and scale. */
export interface View {
  x: number
  y: number
  k: number
}

/** Where a node sits in world coordinates (the world includes the canvas padding). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

const MIN_K = 0.12
const MAX_K = 2
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))

/**
 * Pan, zoom and keyboard focus for a node canvas: drag or two-finger scroll pans; a mouse wheel, ctrl-wheel or pinch
 * zooms at the pointer; arrows move a roving focus through `neighbour`; `+`, `-`, `0` and `f` zoom, fit and centre.
 * A press that moves less than a few pixels stays a click on the node under it. Until the reader moves the canvas, the
 * opening view (`open`) follows the viewport's size as the page settles.
 */
export function useCanvasView({
  width,
  height,
  box,
  focus,
  selectedId,
  neighbour,
  open,
}: {
  width: number
  height: number
  box: (id: string) => Box | null
  focus: string | null
  selectedId: string | null
  neighbour: (id: string, key: ArrowKey) => string | null
  /** The opening view for a viewport size, given the fitted view; null keeps the fit. */
  open?: (size: { w: number; h: number }, fit: View) => View | null
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [view, setRawView] = useState<View | null>(null)
  const touched = useRef(false)
  const setView = (next: View | null | ((current: View | null) => View | null)) => {
    touched.current = true
    setRawView(next)
  }
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const [hover, setHover] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const keyboard = useRef(false)

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitView = useCallback((): View | null => {
    if (!size) return null
    const k = clampK(Math.min((size.w - 32) / width, (size.h - 32) / height, 1))
    return { k, x: (size.w - width * k) / 2, y: Math.max(8, (size.h - height * k) / 2) }
  }, [size, width, height])
  const centred = useCallback(
    (id: string, k: number): View | null => {
      const at = box(id)
      if (!at || !size) return null
      return { k, x: size.w / 2 - (at.x + at.w / 2) * k, y: size.h / 2 - (at.y + at.h / 2) * k }
    },
    [box, size],
  )
  const visible = (at: Box, v: View, margin = 0) =>
    !!size && v.x + at.x * v.k >= margin && v.y + at.y * v.k >= margin && v.x + (at.x + at.w) * v.k <= size.w - margin && v.y + (at.y + at.h) * v.k <= size.h - margin

  const opening = useRef({ fitView, open })
  opening.current = { fitView, open }
  useEffect(() => {
    if (touched.current || !size) return
    const fit = opening.current.fitView()
    if (!fit) return
    setRawView(opening.current.open?.(size, fit) ?? fit)
  }, [size])

  // A selection made outside the canvas (a link in the inspector, the URL) is brought into view.
  useEffect(() => {
    if (!selectedId || !size) return
    const at = box(selectedId)
    const current = viewRef.current
    if (at && current && !visible(at, current)) setView(centred(selectedId, Math.max(current.k, 0.6)))
  }, [selectedId, size, box, centred]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((current) => {
      if (!current) return current
      const k = clampK(current.k * factor)
      return { k, x: px - (px - current.x) * (k / current.k), y: py - (py - current.y) * (k / current.k) }
    })
  const zoomCentre = (factor: number) => size && zoomAt(size.w / 2, size.h / 2, factor)

  // A pinch (ctrl) or a mouse wheel zooms at the pointer; a two-finger trackpad scroll pans.
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 40)
      if (event.ctrlKey || event.metaKey || mouseWheel) {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey && !mouseWheel ? 0.01 : 0.0015) * (event.deltaMode === 1 ? 16 : 1))
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor)
      } else setView((current) => (current ? { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY } : current))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ from: View; x: number; y: number; dist: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const startGesture = () => {
    const points = [...pointers.current.values()]
    const current = viewRef.current
    if (!current || !points.length) return (gesture.current = null)
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    const dist = points.length > 1 ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0
    gesture.current = { from: current, x, y, dist, moved: gesture.current?.moved ?? false }
  }
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    dragged.current = false
    startGesture()
  }
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (!g) return
    const points = [...pointers.current.values()]
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    if (!g.moved && Math.hypot(x - g.x, y - g.y) < 5 && points.length < 2) return
    if (!g.moved) {
      g.moved = true
      viewport.current?.setPointerCapture(event.pointerId)
    }
    dragged.current = true
    const rect = viewport.current!.getBoundingClientRect()
    if (points.length > 1 && g.dist > 0) {
      const dist = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
      const k = clampK(g.from.k * (dist / g.dist))
      const px = g.x - rect.left
      const py = g.y - rect.top
      setView({ k, x: px - (px - g.from.x) * (k / g.from.k) + (x - g.x), y: py - (py - g.from.y) * (k / g.from.k) + (y - g.y) })
    } else setView({ ...g.from, x: g.from.x + (x - g.x), y: g.from.y + (y - g.y) })
  }
  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId)
    // The click that ends a drag fires after this; any later click (a key, assistive tech) must go through.
    if (dragged.current) window.setTimeout(() => (dragged.current = false), 0)
    if (pointers.current.size) startGesture()
    else gesture.current = null
  }

  const current = active && box(active) ? active : selectedId && box(selectedId) ? selectedId : focus
  useEffect(() => {
    if (!keyboard.current || !current) return
    keyboard.current = false
    buttons.current.get(current)?.focus({ preventScroll: true })
  }, [current])
  /** Moves the keyboard focus to a node (one that replaces a card the reader just used, for example). */
  const moveFocus = (id: string) => {
    keyboard.current = true
    setActive(id)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      const next = current ? neighbour(current, key) : focus
      if (!next) return
      moveFocus(next)
      setHover(next)
      const at = box(next)
      const v = viewRef.current
      if (at && v && !visible(at, v, 16)) setView(centred(next, v.k))
    } else if (key === '+' || key === '=') zoomCentre(1.25)
    else if (key === '-' || key === '_') zoomCentre(0.8)
    else if (key === '0') setView(fitView())
    else if (key === 'f' && current) setView(centred(current, Math.max(viewRef.current?.k ?? 0.85, 0.85)))
    else if (key === 'Escape') setHover(null)
  }

  const viewportProps = { ref: viewport, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown }
  return {
    view,
    k: view?.k ?? 1,
    viewportProps,
    worldStyle: { width, height, transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined, visibility: view ? ('visible' as const) : ('hidden' as const) },
    hover,
    setHover,
    current,
    setActive,
    moveFocus,
    /** True while the click in flight ends a drag; a node's click handler ignores it. */
    wasDragged: () => dragged.current,
    register: (id: string) => (element: HTMLButtonElement | null) => {
      if (element) buttons.current.set(id, element)
      else buttons.current.delete(id)
    },
    zoomIn: () => zoomCentre(1.25),
    zoomOut: () => zoomCentre(0.8),
    fit: () => setView(fitView()),
    centre: (id: string) => setView(centred(id, Math.max(view?.k ?? 0.85, 0.85))),
  }
}
