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
  /** Scroll this row into view whenever it changes. */
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
    (key: string) => {
      const element = scroller.current
      const index = items.findIndex((item) => keyOf(item) === key)
      if (!element || index < 0) return
      const top = offsets[index]!
      const bottom = offsets[index + 1]!
      if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight)
        element.scrollTop = Math.max(0, top - 8)
    },
    [items, keyOf, offsets, scroller],
  )
  const pending = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    pending.current = target
    if (target) scrollTo(target)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  // Measured heights can move the target after the first jump; settle it once more.
  useLayoutEffect(() => {
    if (pending.current) {
      scrollTo(pending.current)
      pending.current = undefined
    }
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const bind = (key: string) => (element: HTMLDivElement | null) => {
    if (!element) return
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
