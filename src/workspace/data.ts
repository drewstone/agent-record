import { createElement, useEffect, useRef, useState } from 'react'
import type { RunRecord } from '../record.js'
import type { Spend } from '../workspace.js'
import { ENDING_GLYPH } from './play-standing.js'

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
  // `stale`: the server sent its last composed copy while it recomposes (X-Workspace-Stale); a page says how old it is.
  const [state, setState] = useState<{ data?: T; error?: string; status?: number; loading: boolean; stale?: boolean }>({ loading: !!url })
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
        if (response.status === 304) {
          setState((current) => (current.stale === stale ? current : { ...current, stale }))
          return
        }
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
        if (alive) setState({ data, loading: false, status: response.status, stale })
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
/** The five status tones (design system §1). Red (`fail`) is earned only by a fault that is happening now and a person can act on. */
export type StatusTone = 'fail' | 'attention' | 'live' | 'pass' | 'neutral'
/** Which question a status answers: how a run went, what it achieved, an agent row, a release, or bookkeeping. */
export type StatusAxis = 'run' | 'result' | 'agent' | 'release' | 'bookkeeping'
export interface Status {
  axis: StatusAxis
  word: string
  tone: StatusTone
  shape: string
  /** Who acts on a `fail` status; every fail mark names it in visible text and in `data-owner`. */
  owner?: string
}

const DAY_MS = 86_400_000
/** The Lab's runner starts, stalls and resumes every run, so it owns a crash or a lost agent on one. */
const RUNNER = 'discovery-lab runner'

/**
 * One status grammar for every page: a word from the design system's fixed vocabulary, a tone, and a shape that keeps
 * the meaning without colour. `now` is passed in so a crash's age is decided by the caller's clock.
 *
 * - run: `state` with the host's `reason` and `stopCause`. A crash is `fail` only while it is under 24 h old and the
 *   caller knows (`newerRun: false`) that no newer run of the same play has started; otherwise it is history (□).
 * - result: a check verdict under `checker`; a verdict under a check other than `current` is neutral with its version.
 *   Undecided is "Unverified", attention only while a live run waits on it.
 * - agent: an agent row; Down is `fail` only while its run is live, otherwise the agent Ended.
 */
export function statusOf(input: StatusInput): Status {
  const status = (axis: StatusAxis, word: string, tone: StatusTone, shape: string): Status => (tone === 'fail' ? { axis, word, tone, shape, owner: RUNNER } : { axis, word, tone, shape })
  if (input.axis === 'agent') {
    switch (input.status) {
      case 'running':
      case 'working':
        return status('agent', 'Working', 'live', ENDING_GLYPH.live!)
      case 'waiting':
        return status('agent', 'Waiting', 'neutral', ENDING_GLYPH.ended!)
      case 'down':
        return input.live ? status('agent', 'Down', 'fail', ENDING_GLYPH.died!) : status('agent', 'Ended', 'neutral', ENDING_GLYPH.ended!)
      case 'done':
        return status('agent', 'Ended', 'neutral', ENDING_GLYPH.ended!)
      default:
        return status('agent', 'Ended', 'neutral', ENDING_GLYPH.ended!)
    }
  }
  if (input.axis === 'result') {
    const version = input.checker ? ` ${input.checker}` : ''
    const retired = !!input.checker && !!input.current && input.checker !== input.current
    switch (input.verdict) {
      case 'solved':
      case 'contract-held':
      case 'pass':
        return retired ? status('result', `Passed${version} (superseded)`, 'neutral', ENDING_GLYPH.ended!) : status('result', `Passed${version}`, 'pass', ENDING_GLYPH.solved!)
      case 'not-solved':
      case 'contract-failed':
      case 'fail':
        return status('result', retired ? `No pass yet under${version} (retired)` : 'No pass yet', 'neutral', ENDING_GLYPH.ended!)
      case 'superseded':
        return status('result', `Passed${version} (superseded)`, 'neutral', ENDING_GLYPH.ended!)
      case 'no-tag':
      case null:
      case undefined:
        return status('result', 'Not checked', 'neutral', ENDING_GLYPH.unknown!)
      default:
        return status('result', 'Unverified', input.waiting ? 'attention' : 'neutral', input.waiting ? ENDING_GLYPH.attention! : ENDING_GLYPH.unknown!)
    }
  }
  const cause = `${input.stopCause ?? ''} ${input.reason ?? ''}`
  const settled = input.settledAt ? Date.parse(input.settledAt) : NaN
  const crashed = () => {
    const now = Number.isFinite(settled) && input.now - settled < DAY_MS && input.newerRun === false
    return now ? status('run', 'Crashed', 'fail', ENDING_GLYPH.fail!) : status('run', 'Crashed', 'neutral', ENDING_GLYPH.crashed!)
  }
  switch (input.state) {
    case 'running':
    case 'building':
      return status('run', 'Running', 'live', ENDING_GLYPH.live!)
    case 'winner':
    case 'done':
    case 'complete':
    case 'ready':
      return status('run', 'Finished', 'pass', ENDING_GLYPH.solved!)
    case 'stalled':
      // The runner cancels a stalled run (discovery-lab runner/stall.mjs); one not yet settled is stuck now.
      return input.settledAt || !input.live ? status('run', 'Stopped by Lab (stall)', 'neutral', ENDING_GLYPH.stalled!) : status('run', 'Stuck', 'attention', ENDING_GLYPH.attention!)
    case 'failed':
    case 'driver-failed':
    case 'died':
    case 'down':
      // A run the operator cancelled is marked failed when its agents abandon their work: a stop, not a crash.
      return /\bcancel(led)? requested\b|\boperator-cancel\b/.test(cause) ? status('run', 'Stopped by operator', 'neutral', ENDING_GLYPH.cancelled!) : crashed()
    case 'cancelled':
    case 'abandoned':
      return status('run', 'Stopped by operator', 'neutral', ENDING_GLYPH.cancelled!)
    case 'no-record':
    case 'missing':
    case 'legacy':
      return status('run', 'No record', 'neutral', ENDING_GLYPH.unknown!)
    case 'not-started':
    case 'pending':
    case 'queued':
      return status('run', 'Not started', 'neutral', ENDING_GLYPH['never started']!)
    case 'no-winner':
      if (/\bbudget-exhausted\b/.test(cause)) return status('run', 'Stopped by Lab (budget)', 'neutral', ENDING_GLYPH.cancelled!)
      if (/\bstall/.test(cause)) return status('run', 'Stopped by Lab (stall)', 'neutral', ENDING_GLYPH.stalled!)
      if (/\b(operator-cancel|cancelled)\b/.test(cause)) return status('run', 'Stopped by operator', 'neutral', ENDING_GLYPH.cancelled!)
      if (/\b(driver-failed|all-children-down|died)\b/.test(cause)) return crashed()
      return status('run', 'Finished', 'neutral', ENDING_GLYPH.ended!)
    default:
      return status('run', 'No record', 'neutral', ENDING_GLYPH.unknown!)
  }
}

export type StatusInput =
  | {
      axis: 'run'
      state: string | null | undefined
      reason?: string | null
      stopCause?: string | null
      settledAt?: string | null
      /** The run is live: a stalled state that has not settled is stuck now. */
      live?: boolean
      /** Whether a newer run of the same play has started; unknown (undefined) keeps a crash neutral. */
      newerRun?: boolean
      now: number
    }
  | { axis: 'result'; verdict: string | null | undefined; checker?: string | null; current?: string | null; waiting?: boolean }
  | { axis: 'agent'; status: string | null | undefined; live: boolean }

/** `<axis>:<word>:<tone>`, the attribute every status mark carries so checks query meaning instead of pixels. */
export const statusData = (value: Status) => `${value.axis}:${value.word}:${value.tone}`
/** The attributes of a status mark: `data-status`, and `data-owner` on an earned fail. */
export const statusAttrs = (value: Status) => ({ 'data-status': statusData(value), 'data-owner': value.tone === 'fail' ? value.owner : undefined })

/** Whether another run of the same play started after `run`: a crash with a newer run is history, not a fault now. */
export const newerRunOf = (runs: readonly { id?: string; runId?: string; startedAt?: string | null }[], run: { id?: string; runId?: string; startedAt?: string | null }) =>
  !!run.startedAt && runs.some((other) => (other.id ?? other.runId) !== (run.id ?? run.runId) && !!other.startedAt && other.startedAt > run.startedAt!)

/** A status pill: the shape, then the word, toned and marked with `data-status`; a fail names its owner. */
export function StatusPill({ status: value, label, title, className }: { status: Status; label?: string; title?: string; className?: string }) {
  return createElement(
    'span',
    { className: `state-pill tone-${value.tone}${className ? ` ${className}` : ''}`, ...statusAttrs(value), title },
    createElement('span', { className: `status-shape${value.shape === ENDING_GLYPH.unknown ? ' is-dashed' : ''}`, 'aria-hidden': true }, value.shape),
    ' ',
    label ?? value.word,
    value.tone === 'fail' && value.owner ? ` · owner: ${value.owner}` : null,
  )
}

/** The tone class of a bare state, for callers that only colour a mark; a crash without its age reads as history. */
export const stateClass = (state: string | null | undefined) => `tone-${statusOf({ axis: 'run', state, now: 0 }).tone}`

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
