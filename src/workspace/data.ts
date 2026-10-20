import { createElement, type ReactNode, useEffect, useRef, useState } from 'react'
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
/**
 * One status grammar (design-system section 1, v2 tone rule). Five tones, each with one meaning: neutral; the accent for
 * data series and links (never a status); pass only for passed under the current check; attention only for running or
 * blocked; fail only for "a person must act now", which is an `attention[]` item the host marks crit or a live run's
 * blocker with severity red. Red has no default: a past crash, an operator or Lab stop, a research miss, a verdict under
 * a retired check and an unknown are all neutral, and keep their meaning through their word and shape.
 */
export type StatusTone = 'pass' | 'attention' | 'fail' | 'neutral'
export type StatusAxis = 'run' | 'result' | 'alert' | 'agent' | 'release'
export interface Status {
  axis: StatusAxis
  word: string
  tone: StatusTone
  shape: string
}
export type StatusInput =
  /** A run, from the catalog's `state`, Runtime's `reason` and the Lab's `stopCause`; `elapsedMs` adds a running run's age. */
  | { axis: 'run'; state: string | null | undefined; reason?: string | null; stopCause?: string | null; elapsedMs?: number | null }
  /**
   * A verdict against a check. `current: false` is a verdict under a retired check version, named by `checker`;
   * `waiting` is a live run waiting on an undecided check; `passed`/`total` are workloads.
   */
  | { axis: 'result'; verdict: string | null | undefined; current?: boolean; checker?: string | null; waiting?: boolean; passed?: number | null; total?: number | null }
  /** Something that may need a person: an overview `attention[]` tone, or a blocker's severity on a run that is or is not live. */
  | { axis: 'alert'; tone?: string | null; severity?: string | null; live: boolean }
  /** An agent row: its recorded status while its run is or is not live. */
  | { axis: 'agent'; status: string | null | undefined; live: boolean }
  /** A release tag's state. */
  | { axis: 'release'; state: string | null | undefined }

const status = (axis: StatusAxis, word: string, tone: StatusTone, shape: string): Status => ({ axis, word, tone, shape })
const OPERATOR = /operator|cancel/
const FAILED = new Set(['failed', 'driver-failed', 'died'])

function runAxis(input: Extract<StatusInput, { axis: 'run' }>): Status {
  const { state, reason, stopCause, elapsedMs } = input
  const why = `${stopCause ?? ''} ${reason ?? ''}`
  switch (state) {
    case 'running':
    case 'building':
    case 'live': {
      const age = elapsedMs !== null && elapsedMs !== undefined && elapsedMs > 0 ? ` ${duration(elapsedMs)}` : ''
      return status('run', `Running${age}`, 'attention', ENDING_GLYPH.live)
    }
    case 'winner':
    case 'solved':
      return status('result', 'Passed', 'pass', ENDING_GLYPH.solved)
    case 'stalled':
      return status('run', 'Stopped by Lab (stall)', 'neutral', ENDING_GLYPH.stalled)
    case 'cancelled':
    case 'operator-cancel':
      return status('run', 'Stopped by operator', 'neutral', ENDING_GLYPH.cancelled)
    case 'budget-exhausted':
      return status('run', 'Stopped by Lab (budget)', 'neutral', ENDING_GLYPH.stalled)
    case 'no-winner':
      if (/budget-exhausted/.test(why)) return status('run', 'Stopped by Lab (budget)', 'neutral', ENDING_GLYPH.stalled)
      if (/stall/.test(why)) return status('run', 'Stopped by Lab (stall)', 'neutral', ENDING_GLYPH.stalled)
      if (OPERATOR.test(why)) return status('run', 'Stopped by operator', 'neutral', ENDING_GLYPH.cancelled)
      return status('run', 'Finished', 'neutral', ENDING_GLYPH.ended)
    case 'no-result-selected':
    case 'done':
    case 'complete':
      return status('run', 'Finished', 'neutral', ENDING_GLYPH.ended)
    case 'abandoned':
      return status('run', 'Ended', 'neutral', ENDING_GLYPH.ended)
    case 'never started':
    case 'not-started':
      return status('run', 'Not started', 'neutral', ENDING_GLYPH['never started'])
    case 'no-record':
    case 'missing':
    case 'unknown':
    case null:
    case undefined:
      return status('run', 'No record', 'neutral', ENDING_GLYPH.unknown)
    default:
      // A crash is a past fact: it needs a person only when the host raises it as an act-now item.
      if (FAILED.has(state)) return status('run', state === 'driver-failed' ? 'Crashed (driver)' : 'Crashed', 'neutral', ENDING_GLYPH.crashed)
      return status('run', state.replaceAll('-', ' '), 'neutral', ENDING_GLYPH.ended)
  }
}

function resultAxis(input: Extract<StatusInput, { axis: 'result' }>): Status {
  const { verdict, current = true, checker, waiting = false, passed, total } = input
  const under = checker ? ` ${current ? '' : 'under '}${checker}${current ? '' : ' (retired)'}` : ''
  const count = passed !== null && passed !== undefined && total ? ` · ${passed}/${total}` : ''
  if (verdict === 'solved' || verdict === 'contract-held' || verdict === 'pass' || verdict === 'met')
    return current
      ? status('result', `Passed${checker ? ` ${checker}` : ''}`, 'pass', ENDING_GLYPH.solved)
      : status('result', `Passed${checker ? ` ${checker}` : ''} (superseded)`, 'neutral', ENDING_GLYPH.ended)
  if (verdict === 'undecided' || verdict === 'inconclusive' || verdict === 'error' || verdict === null || verdict === undefined || verdict === 'unknown')
    return waiting ? status('result', 'Unverified', 'attention', ENDING_GLYPH.attention) : status('result', `Unverified${current ? '' : under}`, 'neutral', ENDING_GLYPH.unknown)
  if (verdict === 'superseded') return status('result', 'Superseded', 'neutral', ENDING_GLYPH.ended)
  if (verdict === 'no-tag') return status('result', 'Not checked', 'neutral', ENDING_GLYPH.unknown)
  return status('result', `No pass yet${current ? '' : under}${count}`, 'neutral', ENDING_GLYPH.ended)
}

/** The one place a status chooses its word, tone and shape. */
export function statusOf(input: StatusInput): Status {
  switch (input.axis) {
    case 'run':
      return runAxis(input)
    case 'result':
      return resultAxis(input)
    case 'alert':
      if (input.tone === 'crit' || (input.live && input.severity === 'red')) return status('alert', 'act now', 'fail', ENDING_GLYPH.fail)
      if (input.live && input.severity) return status('alert', 'Blocked', 'attention', ENDING_GLYPH.attention)
      if (!input.live && input.severity) return status('alert', 'past', 'neutral', ENDING_GLYPH.ended)
      return status('alert', input.tone === 'info' ? 'cleared' : 'not urgent', 'neutral', ENDING_GLYPH.ended)
    case 'agent':
      if (!input.live || input.status === 'done' || input.status === 'ended') return status('agent', 'Ended', 'neutral', ENDING_GLYPH.ended)
      if (input.status === 'down') return status('agent', 'Down', 'attention', ENDING_GLYPH.attention)
      if (input.status === 'running' || input.status === 'working' || !input.status) return status('agent', 'Working', 'neutral', ENDING_GLYPH.live)
      return status('agent', 'Waiting', 'neutral', ENDING_GLYPH.stalled)
    case 'release':
      return input.state === 'published' || !input.state
        ? status('release', 'Published', 'neutral', ENDING_GLYPH.ended)
        : input.state === 'withheld'
          ? status('release', 'not published', 'neutral', ENDING_GLYPH.ended)
          : status('release', input.state === 'superseded' ? 'superseded' : 'state unknown', 'neutral', ENDING_GLYPH.unknown)
  }
}

const LEAD_VERDICT: Record<string, string> = { 'NOT SOLVED': 'not-solved', SOLVED: 'solved', UNDECIDED: 'undecided' }

/**
 * The host's standing sentence in this grammar: its leading verdict clause as a result status (`NOT SOLVED` reads "No
 * pass yet") and a gate-held release as "not published". The host still composes the old words until tangle-tools
 * changes them; the rest of the sentence is printed as composed.
 */
export function standingSentence(text: string): { lead: Status | null; rest: string } {
  const rest = text.replaceAll('withheld by the gate', statusOf({ axis: 'release', state: 'withheld' }).word)
  const head = /^(NOT SOLVED|SOLVED|UNDECIDED)\b/.exec(rest)?.[0]
  return head ? { lead: statusOf({ axis: 'result', verdict: LEAD_VERDICT[head] }), rest: rest.slice(head.length) } : { lead: null, rest }
}

/** The `data-status` every status mark carries, so checks query meaning instead of pixels. */
export const dataStatus = (s: Status) => `${s.axis}:${s.word}:${s.tone}`

/** A status as a pill: its shape, then its word, toned and carrying `data-status`. */
export function StatusPill({ status, title, children, className = 'state-pill' }: { status: Status; title?: string; children?: ReactNode; className?: string }) {
  return createElement(
    'span',
    { className: `${className} tone-${status.tone}`, 'data-status': dataStatus(status), title },
    createElement('i', { className: 'status-shape', 'aria-hidden': true }, status.shape),
    ' ',
    children ?? status.word,
  )
}

/** A run's status word with its ending time when it stopped: `Stopped by Lab (stall) 03:27Z`. */
export function runStatus(run: { state: string | null | undefined; reason?: string | null; stopCause?: string | null; settledAt?: string | null; ending?: { at?: string | null } | null }): Status {
  const base = statusOf({ axis: 'run', state: run.state, reason: run.reason, stopCause: run.stopCause })
  const at = run.ending?.at ?? run.settledAt
  return base.tone === 'neutral' && at && base.word.startsWith('Stopped') ? { ...base, word: `${base.word} ${at.slice(11, 16)}Z` } : base
}


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
