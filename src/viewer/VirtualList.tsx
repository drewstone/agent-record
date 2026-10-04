import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'

/**
 * Renders only the rows near the viewport of `scroller`. Row heights are measured as they render; unmeasured
 * rows use `estimate`. Spacers keep the scroll height, so the browser's scroll anchoring holds the reading place.
 */
export function VirtualList<T>({
  items,
  keyOf,
  render,
  scroller,
  estimate = 96,
  overscan = 900,
  target,
}: {
  items: readonly T[]
  keyOf: (item: T) => string
  render: (item: T, index: number) => ReactNode
  scroller: RefObject<HTMLElement | null>
  /** Height before a row is measured. */
  estimate?: number | ((item: T) => number)
  overscan?: number
  /** Bring this row to the top of the scroller (and into the page's view) whenever it changes. */
  target?: string
}) {
  const heights = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 900 })
  const observer = useRef<ResizeObserver | null>(null)
  const nodes = useRef(new Map<Element, string>())

  const frame = useRef(0)
  // Created on the first row binding: refs attach before effects run, so an effect-created observer would
  // miss every row of the first commit.
  const observe = (element: Element) => {
    if (!observer.current && typeof ResizeObserver !== 'undefined')
      observer.current = new ResizeObserver((entries) => {
        let changed = false
        for (const entry of entries) {
          const key = nodes.current.get(entry.target)
          if (!key) continue
          const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight)
          if (height > 0 && heights.current.get(key) !== height) {
            heights.current.set(key, height)
            changed = true
          }
        }
        if (changed && !frame.current)
          frame.current = requestAnimationFrame(() => {
            frame.current = 0
            setVersion((value) => value + 1)
          })
      })
    observer.current?.observe(element)
  }
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      observer.current?.disconnect()
      observer.current = null
      nodes.current.clear()
    },
    [],
  )

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    let frame = 0
    const update = () => {
      frame = 0
      setViewport((current) =>
        current.top === element.scrollTop && current.height === element.clientHeight
          ? current
          : { top: element.scrollTop, height: element.clientHeight },
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    element.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', schedule)
      resize.disconnect()
    }
  }, [scroller])

  const offsets = useMemo(() => {
    const result = new Float64Array(items.length + 1)
    const guess = typeof estimate === 'function' ? estimate : () => estimate
    for (let i = 0; i < items.length; i++) result[i + 1] = result[i]! + (heights.current.get(keyOf(items[i]!)) ?? guess(items[i]!))
    return result
    // `version` changes when a measured height changes.
  }, [items, keyOf, estimate, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const find = (y: number) => {
    let low = 0
    let high = items.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (offsets[mid + 1]! <= y) low = mid + 1
      else high = mid
    }
    return low
  }
  const start = Math.max(0, find(viewport.top - overscan))
  const end = Math.min(items.length, find(viewport.top + viewport.height + overscan) + 1)

  const scrollTo = useCallback(
    (key: string, align: boolean) => {
      const element = scroller.current
      const index = items.findIndex((item) => keyOf(item) === key)
      if (!element || index < 0) return false
      const top = offsets[index]!
      const bottom = offsets[index + 1]!
      if (align || top < element.scrollTop || bottom > element.scrollTop + element.clientHeight)
        element.scrollTop = Math.max(0, top - 8)
      return true
    },
    [items, keyOf, offsets, scroller],
  )
  // A target is settled, not jumped to once: rows above it are measured only after the first jump renders them, which
  // moves it. Each measurement re-aligns it until the reader scrolls, or after two seconds.
  const pending = useRef<{ key: string; until: number } | null>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const settle = () => {
    const goal = pending.current
    if (!goal) return
    if (performance.now() > goal.until) {
      pending.current = null
      return
    }
    if (!scrollTo(goal.key, true)) return
    // The row is in the document once the viewport state caught up: bring it into the page's view as well, so a
    // conversation panel below the fold scrolls up with it.
    const row = rows.current.get(goal.key)
    if (row?.isConnected) {
      const box = row.getBoundingClientRect()
      if (box.top < 72 || box.top > window.innerHeight - 96) window.scrollBy({ top: box.top - 120 })
    }
  }
  useLayoutEffect(() => {
    pending.current = target ? { key: target, until: performance.now() + 2000 } : null
    settle()
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  // While settling: after each measurement, each viewport move and each change of the rows (a record that arrived late).
  useLayoutEffect(settle, [version, viewport, items]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    // The reader's own scroll ends the settling.
    const release = () => {
      pending.current = null
    }
    element.addEventListener('wheel', release, { passive: true })
    element.addEventListener('touchstart', release, { passive: true })
    element.addEventListener('pointerdown', release)
    element.addEventListener('keydown', release)
    return () => {
      element.removeEventListener('wheel', release)
      element.removeEventListener('touchstart', release)
      element.removeEventListener('pointerdown', release)
      element.removeEventListener('keydown', release)
    }
  }, [scroller])

  const bind = (key: string) => (element: HTMLDivElement | null) => {
    if (!element) {
      rows.current.delete(key)
      return
    }
    rows.current.set(key, element)
    for (const [node, value] of nodes.current) if (value === key && node !== element) {
      observer.current?.unobserve(node)
      nodes.current.delete(node)
    }
    if (!nodes.current.has(element)) {
      nodes.current.set(element, key)
      observe(element)
    }
  }
  useEffect(() => {
    // Forget elements React removed.
    for (const node of [...nodes.current.keys()])
      if (!node.isConnected) {
        observer.current?.unobserve(node)
        nodes.current.delete(node)
      }
  })

  return (
    <>
      <div style={{ height: offsets[start] }} aria-hidden="true" />
      {items.slice(start, end).map((item, i) => {
        const key = keyOf(item)
        return (
          <div key={key} ref={bind(key)} className="virtual-row">
            {render(item, start + i)}
          </div>
        )
      })}
      <div style={{ height: offsets[items.length]! - offsets[end]! }} aria-hidden="true" />
    </>
  )
}
