import { createElement, Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import type { RunRecord } from '../record.js'
import type { Spend } from '../workspace-model.js'
import { ENDING_GLYPH, hostWords } from './play-standing.js'

/** How soon a document the server marked stale (X-Workspace-Stale) is fetched again, backing off by half each time:
 * about a minute in all, the longest a plays index takes to recompose on a loaded host. */
const STALE_RETRY_MS = 2_500
const STALE_RETRIES = 6
const NETWORK_RETRIES = 4

/**
 * Same-origin JSON with ETag revalidation. `poll` refetches every `poll` ms while set; turning polling on or off keeps
 * the document. With `keepPrevious`, a new URL (a record's next digest) keeps showing the previous document until the
 * new one arrives, so a run being written never blanks between versions. A response marked stale is refetched until it is current.
 */
export function useDocument<T>(url: string | null, poll?: number, keepPrevious = false, fetcher = globalThis.fetch) {
  // `stale`: the server sent its last composed copy while it recomposes (X-Workspace-Stale); a page says how old it is,
  // and `failing` why its last compose failed when it did (X-Workspace-Compose-Error, audit F11).
  // State is tagged with its URL: a changed ref or version never shows the previous payload under the new label.
  const [state, setState] = useState<{ url: string | null; data?: T; error?: string; status?: number; loading: boolean; stale?: boolean; failing?: string }>({ url, loading: !!url })
  const etag = useRef<string | null>(null)
  const shown = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (shown.current !== url) {
      shown.current = url
      etag.current = null
      setState((current) => (keepPrevious && url && current.data !== undefined ? { ...current, url, loading: true, error: undefined } : { url, loading: !!url }))
    }
    if (!url) return
    let alive = true
    let timer = 0
    let stale = false
    let retries = 0
    // A request that never reached the server (GTR Chromium under load: ERR_NETWORK_CHANGED) is retried soon, not at the next poll.
    let dropped = 0
    let lost = false
    const controller = new AbortController()
    const load = async () => {
      lost = false
      try {
        const response = await fetcher(url, {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: etag.current ? { 'If-None-Match': etag.current } : {},
        })
        if (!alive) return
        dropped = 0
        stale = response.headers.get('X-Workspace-Stale') === '1'
        const failing = response.headers.get('X-Workspace-Compose-Error') ?? undefined
        // Only a fresh 200 or 304 ends a stale episode and restores its quick retries; an error answer is not fresh (root, #180).
        if (!stale && (response.ok || response.status === 304)) retries = 0
        if (response.status === 304) {
          setState((current) => (current.stale === stale && current.failing === failing ? current : { ...current, stale, failing }))
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
        if (alive) setState({ url, data, loading: false, status: response.status, stale, failing })
      } catch (error) {
        if (alive && !controller.signal.aborted && dropped < NETWORK_RETRIES) lost = true
        else if (alive && !controller.signal.aborted)
          setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Request failed' }))
      } finally {
        // A document served as last composed while the server recomposes it is asked for again soon, a few times at most,
        // before the page's own poll: a polled page waited a whole interval and /today showed a 2 h old copy (REVIEW-7 #2).
        if (alive && lost) {
          timer = window.setTimeout(load, 1000 * 2 ** dropped)
          dropped += 1
        } else if (alive && stale && retries < STALE_RETRIES) {
          timer = window.setTimeout(load, STALE_RETRY_MS * 1.5 ** retries)
          retries += 1
        } else if (alive && poll) timer = window.setTimeout(load, poll)
      }
    }
    void load()
    return () => {
      alive = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [url, poll, fetcher]) // eslint-disable-line react-hooks/exhaustive-deps
  return keepPrevious || state.url === url ? state : { url, loading: !!url }
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
 * blocker with severity red, or a Needs you line for a pass held for stages with no known-good fixture (the person adds the
 * fixture that settles it; the held verdict itself stays neutral). Red has no default: a past crash, an operator or Lab stop, a research miss, a verdict under
 * a retired check and an unknown are all neutral, and keep their meaning through their word and shape.
 */
export type StatusTone = 'pass' | 'live' | 'attention' | 'fail' | 'neutral'
export type StatusAxis = 'run' | 'result' | 'alert' | 'agent' | 'release' | 'cause' | 'measure'
export interface Status {
  axis: StatusAxis
  word: string
  tone: StatusTone
  shape: string
}
export type StatusInput =
  /**
   * A run, from the catalog's `state`, Runtime's `reason` and the Lab's `stopCause`; `elapsedMs` adds a running run's age.
   * A crash needs a person only while it is fresh: `endedAt` under 24 h before `now` and `newerStarted` known false (no
   * newer run of the same play has started). A caller that cannot tell leaves `newerStarted` out, and the crash is past.
   */
  | { axis: 'run'; state: string | null | undefined; reason?: string | null; stopCause?: string | null; elapsedMs?: number | null; endedAt?: string | null; newerStarted?: boolean; now?: number }
  /**
   * A verdict against a check. `current: false` is a verdict under a retired check version, named by `checker`;
   * `waiting` is a live run waiting on an undecided check; `passed`/`total` are workloads. Verdict `held` is a pass through
   * stages no known-good fixture passed, named by `held`: never Passed, never failing.
   */
  | { axis: 'result'; verdict: string | null | undefined; current?: boolean; checker?: string | null; waiting?: boolean; passed?: number | null; total?: number | null; held?: readonly string[] | null }
  /**
   * Something that may need a person: an overview `attention[]` tone, or a blocker's severity on a run that is or is not
   * live. The tone is the host's: a page never raises it.
   */
  | { axis: 'alert'; tone?: string | null; severity?: string | null; live: boolean }
  /** An agent row: its recorded status while its run is or is not live. */
  | { axis: 'agent'; status: string | null | undefined; live: boolean }
  /** A release tag's state. */
  | { axis: 'release'; state: string | null | undefined }
  /**
   * Why a driver turn ended (the receipt's `system.attempts.causes`). `live` is a run still going; `actNow` names who
   * must act when a live run's blocker is red, the only time a turn lost to the platform needs a person.
   */
  | { axis: 'cause'; cause: string; label?: string | null; live: boolean; actNow?: string | null }
  /** A measured value against its play's bar (`barSide` in play-standing.ts), toned by its own comparison only. */
  | { axis: 'measure'; side: 'within' | 'past' | 'short' | null }

const status = (axis: StatusAxis, word: string, tone: StatusTone, shape: string): Status => ({ axis, word, tone, shape })
const OPERATOR = /operator|cancel/
const FAILED = new Set(['failed', 'driver-failed', 'died'])
const FRESH_CRASH_MS = 24 * 3_600_000
/** Who acts on a fresh crash or a live agent that is down when the host names no owner. */
export const DEFAULT_OWNER = 'Discovery operator'

function freshCrash({ endedAt, newerStarted, now = Date.now() }: Extract<StatusInput, { axis: 'run' }>) {
  const at = endedAt ? Date.parse(endedAt) : NaN
  return newerStarted === false && Number.isFinite(at) && now - at >= 0 && now - at < FRESH_CRASH_MS
}

function runAxis(input: Extract<StatusInput, { axis: 'run' }>): Status {
  const { state, reason, stopCause, elapsedMs } = input
  const why = `${stopCause ?? ''} ${reason ?? ''}`
  switch (state) {
    case 'running':
    case 'building':
    case 'live': {
      const age = elapsedMs !== null && elapsedMs !== undefined && elapsedMs > 0 ? ` ${duration(elapsedMs)}` : ''
      return status('run', `Running${age}`, 'live', ENDING_GLYPH.live)
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
    case 'never-started':
    case 'not-started':
      return status('run', 'Not started', 'neutral', ENDING_GLYPH['never started'])
    case 'no-record':
    case 'missing':
    // A catalog run from before the record format, with no start time: nothing to read.
    case 'legacy':
    case 'unknown':
    case null:
    case undefined:
      return status('run', 'No record', 'neutral', ENDING_GLYPH.unknown)
    default:
      // A crash is red only while it is under 24 h old and nothing has run since (design-system section 1); after that, or
      // once a newer run of the play has started, it is a past fact: neutral □.
      if (FAILED.has(state)) {
        const word = state === 'driver-failed' ? 'Crashed (driver)' : 'Crashed'
        return freshCrash(input) ? status('run', `${word} · act now: ${DEFAULT_OWNER}`, 'fail', ENDING_GLYPH.fail) : status('run', word, 'neutral', ENDING_GLYPH.crashed)
      }
      return status('run', state.replaceAll('-', ' '), 'neutral', ENDING_GLYPH.ended)
  }
}

function resultAxis(input: Extract<StatusInput, { axis: 'result' }>): Status {
  const { verdict, current = true, checker, waiting = false, passed, total, held } = input
  // The host's words for a held pass (tangle-tools play_checks.held_label), so the run page and Needs you read the same.
  if (verdict === 'held') return status('result', `check passed; held: stages ${held?.length ? held.join(', ') : '(not named)'} have no known-good fixture`, 'neutral', ENDING_GLYPH.unknown)
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

function causeAxis({ cause, label, live, actNow = null }: Extract<StatusInput, { axis: 'cause' }>): Status {
  switch (cause) {
    case 'stopped':
      return status('cause', 'Stopped by Lab or operator', 'neutral', ENDING_GLYPH.cancelled)
    case 'budget-exhausted':
      return status('cause', 'Stopped by Lab (budget)', 'neutral', ENDING_GLYPH.stalled)
    case 'rate-limited':
      return status('cause', 'Quota hit', live ? 'attention' : 'neutral', live ? ENDING_GLYPH.attention : ENDING_GLYPH.stalled)
    case 'platform-lost':
      // A hollow △, against act-now's filled ■: attention while a live run is losing turns (it is blocked), red only when
      // that run's blocker is red, and a past fact once the run has ended (v2: amber only for running or blocked).
      return !live
        ? status('cause', 'Platform lost the turn', 'neutral', ENDING_GLYPH.lost)
        : actNow
          ? status('cause', `Platform lost the turn · act now: ${actNow}`, 'fail', ENDING_GLYPH.lost)
          : status('cause', 'Platform lost the turn', 'attention', ENDING_GLYPH.lost)
    default:
      return status('cause', label ?? cause.replaceAll('-', ' '), 'neutral', ENDING_GLYPH.ended)
  }
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
      // Down is red only while its run is live: someone must restart it. On an ended run it is "Ended" above.
      if (input.status === 'down') return status('agent', `Down · act now: ${DEFAULT_OWNER}`, 'fail', ENDING_GLYPH.fail)
      if (input.status === 'running' || input.status === 'working' || !input.status) return status('agent', 'Working', 'neutral', ENDING_GLYPH.live)
      return status('agent', 'Waiting', 'neutral', ENDING_GLYPH.stalled)
    case 'cause':
      return causeAxis(input)
    case 'measure':
      return input.side === 'within' || input.side === 'past'
        ? status('measure', input.side === 'within' ? 'within the bar' : 'past the bar', 'pass', '●')
        : status('measure', input.side === 'short' ? 'short of the bar' : 'no bar comparison', 'neutral', '○')
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
 * changes them; the rest of the sentence is printed as composed, with those words in this grammar (`hostWords`).
 */
export function standingSentence(text: string): { lead: Status | null; rest: string } {
  const head = /^(NOT SOLVED|SOLVED|UNDECIDED)\b/.exec(text)?.[0]
  return head ? { lead: statusOf({ axis: 'result', verdict: LEAD_VERDICT[head] }), rest: hostWords(text.slice(head.length)) } : { lead: null, rest: hostWords(text) }
}

/** The `data-status` every status mark carries: checks query meaning instead of pixels, and styles.css colours a status only
 * through it, so no component chooses a status hue. */
export const dataStatus = (s: Status) => `${s.axis}:${s.word}:${s.tone}`

/** A status as a pill: its shape, then its word, toned and carrying `data-status`. */
export function StatusPill({ status, title, children, className = 'state-pill' }: { status: Status; title?: string; children?: ReactNode; className?: string }) {
  return createElement(
    'span',
    { className, 'data-status': dataStatus(status), title },
    createElement('i', { className: 'status-shape', 'aria-hidden': true }, status.shape),
    ' ',
    children ?? status.word,
  )
}

/** A standing sentence with its verdict clause as the status word; the plays table prints it inline. */
export function StandingText({ text }: { text: string }) {
  const { lead, rest } = standingSentence(text)
  return createElement(Fragment, null, lead && createElement('b', { 'data-status': dataStatus(lead) }, `${lead.shape} ${lead.word}`), rest)
}

const ENDING_STATE: Record<string, string> = { solved: 'winner', died: 'failed', live: 'running', 'never started': 'never-started' }

/** A host ending word (`died`, `not solved`, `cancelled`: @tangle-network/charts RunEnding) in this grammar. */
export const endingStatus = (word: string | null | undefined): Status =>
  word === 'not solved' ? statusOf({ axis: 'result', verdict: 'not-solved' }) : statusOf({ axis: 'run', state: word ? (ENDING_STATE[word] ?? word) : word })

/**
 * Whether a newer run of the same play has started than `run`, from a served run list (the catalog's or a play's). Undefined
 * when `run` has no start time, so its crash reads as past.
 */
export function newerStarted(run: { id: string; play?: string | null; startedAt?: string | null }, runs: ReadonlyArray<{ id: string; play?: string | null; startedAt?: string | null }>) {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN
  if (!Number.isFinite(start)) return undefined
  return runs.some((other) => other.id !== run.id && (other.play ?? null) === (run.play ?? null) && !!other.startedAt && Date.parse(other.startedAt) > start)
}

/** A run's status word with its ending time when it stopped: `Stopped by Lab (stall) 03:27Z`. */
export function runStatus(
  run: { state: string | null | undefined; reason?: string | null; stopCause?: string | null; settledAt?: string | null; ending?: { at?: string | null } | null },
  newerStarted?: boolean,
): Status {
  const at = run.ending?.at ?? run.settledAt
  const base = statusOf({ axis: 'run', state: run.state, reason: run.reason, stopCause: run.stopCause, endedAt: at, newerStarted })
  return base.tone === 'neutral' && at && base.word.startsWith('Stopped') ? { ...base, word: `${base.word} ${at.slice(11, 16)}Z` } : base
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
  // pushState and replaceState emit no event: tell every useSearch, so two readers of the URL cannot disagree.
  window.dispatchEvent(new PopStateEvent('popstate'))
}
