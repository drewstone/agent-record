import { useEffect, useRef, useState } from 'react'
import type { RunRecord } from '../record.js'
import type { Spend } from '../workspace.js'

/** How soon a document the server marked stale (X-Workspace-Stale) is fetched again, backing off by half each time:
 * about a minute in all, the longest a plays index takes to recompose on a loaded host. */
const STALE_RETRY_MS = 2_500
const STALE_RETRIES = 6

/**
 * Same-origin JSON with ETag revalidation. `poll` refetches every `poll` ms while set; turning polling on or off keeps
 * the document. With `keepPrevious`, a new URL (a record's next digest) keeps showing the previous document until the
 * new one arrives, so a run being written never blanks between versions. A response marked stale is refetched until it is current.
 */
export function useDocument<T>(url: string | null, poll?: number, keepPrevious = false) {
  const [state, setState] = useState<{ data?: T; error?: string; status?: number; loading: boolean }>({ loading: !!url })
  const etag = useRef<string | null>(null)
  const shown = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (shown.current !== url) {
      shown.current = url
      etag.current = null
      setState((current) => (keepPrevious && url && current.data !== undefined ? { ...current, loading: true, error: undefined } : { loading: !!url }))
    }
    if (!url) return
    let alive = true
    let timer = 0
    let stale = false
    let retries = 0
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: etag.current ? { 'If-None-Match': etag.current } : {},
        })
        if (!alive) return
        stale = response.headers.get('X-Workspace-Stale') === '1'
        if (response.status === 304) return
        if (!response.ok) {
          let reason = `HTTP ${response.status}`
          try {
            const body = await response.json()
            if (body && typeof body === 'object' && typeof body.reason === 'string') reason = body.reason
          } catch {
            /* the status is the reason */
          }
          setState((current) => ({ ...current, loading: false, error: reason, status: response.status }))
          return
        }
        etag.current = response.headers.get('ETag')
        const data = (await response.json()) as T
        if (alive) setState({ data, loading: false, status: response.status })
      } catch (error) {
        if (alive && !controller.signal.aborted)
          setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Request failed' }))
      } finally {
        // A document served as last composed while the server recomposes it is asked for again, a few times at most.
        if (alive && poll) timer = window.setTimeout(load, poll)
        else if (alive && stale && retries < STALE_RETRIES) {
          timer = window.setTimeout(load, STALE_RETRY_MS * 1.5 ** retries)
          retries += 1
        }
      }
    }
    void load()
    return () => {
      alive = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [url, poll]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

/**
 * The workspace receives records from its own converter, which validated them at ingest. A full Zod pass over
 * a 20,000-event record costs seconds on a wall display, so the viewer checks the shape it relies on.
 */
export function readRecord(value: unknown): RunRecord {
  const record = value as RunRecord
  if (!record || record.schema !== 'agent-record.v1' || !Array.isArray(record.nodes) || !Array.isArray(record.events))
    throw new Error('Not an agent-record.v1 record')
  for (const node of record.nodes) node.parent ??= null
  for (const event of record.events) {
    event.detail ??= {}
    event.category ??= 'other'
  }
  record.sources ??= []
  return record
}

// ----- formatting -----
export const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'unknown'
    : `$${value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : value === 0 ? '0.00' : value.toFixed(value < 0.01 ? 4 : 2)}`
export const tokens = (value: number | null | undefined) =>
  value === null || value === undefined ? 'unknown' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const duration = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`
  if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} min`
  return `${(value / 3_600_000).toFixed(1)} h`
}
export const when = (value: string | null | undefined, withDate = true) => {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return '—'
  const iso = date.toISOString()
  return withDate ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : `${iso.slice(11, 19)} UTC`
}
export const stateClass = (state: string | null | undefined) => {
  switch (state) {
    case 'winner':
    case 'done':
    case 'complete':
    case 'ready':
      return 'state-ok'
    case 'running':
    case 'building':
      return 'state-run'
    case 'failed':
    case 'driver-failed':
    case 'down':
    case 'no-record':
    case 'missing':
      return 'state-fail'
    case 'no-winner':
    case 'abandoned':
      return 'state-warn'
    default:
      return 'state-unknown'
  }
}
export const stateLabel = (state: string | null | undefined) =>
  state ? state.replaceAll('-', ' ') : 'state unknown'

/** Paid and list price, with unknown kept apart. */
export function spendParts(spend: Spend | null | undefined) {
  return {
    paid: spend?.paidUsd ?? null,
    sandbox: spend?.sandboxUsd ?? null,
    router: spend?.routerUsd ?? null,
    basis: spend?.costBasisUsd ?? null,
    list: spend?.listUsd ?? null,
    known: spend?.paidKnown ?? false,
  }
}

/** Navigate the host page; the wall shells are separate documents. */
export function go(href: string) {
  window.location.assign(href)
}

export function readSearch() {
  return new URLSearchParams(window.location.search)
}
export function writeSearch(patch: Record<string, string | undefined | null>, replace = false) {
  const params = readSearch()
  for (const [key, value] of Object.entries(patch))
    if (value === undefined || value === null || value === '') params.delete(key)
    else params.set(key, value)
  const search = params.toString()
  const next = window.location.pathname + (search ? `?${search}` : '')
  if (next === window.location.pathname + window.location.search) return
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}
