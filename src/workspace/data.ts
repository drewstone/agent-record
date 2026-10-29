import { ENDING_GLYPH, hostWords } from './play-standing.js'

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

const ENDING_STATE: Record<string, string> = { solved: 'winner', died: 'failed', live: 'running', 'never started': 'never-started' }

/** A host ending word (`died`, `not solved`, `cancelled`: @tangle-network/charts RunEnding) in this grammar. */
export const endingStatus = (word: string | null | undefined): Status =>
  word === 'not solved' ? statusOf({ axis: 'result', verdict: 'not-solved' }) : statusOf({ axis: 'run', state: word ? (ENDING_STATE[word] ?? word) : word })
