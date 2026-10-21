import type { PlayDocument, RunDocument } from '../workspace-model.js'
import { blockerWord, clip, clockZ, lastOutput, outputSeries, since } from './answers.js'
import { type Status, statusOf } from './data.js'
import type { PlayHead, PlayBlocker } from './play-standing.js'
import { hostWords, shortRun, shortTag, utc } from './play-standing.js'
import { inheritedOf, outputOf } from './served-fields.js'

/**
 * The run page's first screen as data (wall redesign v2): the run's name and one status, then four slots: what it is
 * doing (`state`, one sentence of at most 18 words), its best release (`best`), what blocks it (`blocker`) and its
 * output (`output`). Each slot reads the host's change-1 fields when served and the fields served before them otherwise.
 * The page shows one liveness clock, "last output", in the blocker slot when nothing blocks the run, else in `state`.
 */

type Play = PlayDocument & PlayHead
const SENTENCE_WORDS = 18
const hoursOf = (from: string | null | undefined, to: number) => (from ? (to - Date.parse(from)) / 3_600_000 : null)

export interface BestSlot {
  headline: string
  /** Workloads passed of total, drawn as a meter; null when no own release was scored. */
  meter: { used: number; total: number } | null
  subline: string
}
export interface BlockerSlot {
  headline: string
  subline: string
  blocker: PlayBlocker | null
  status: Status | null
}
export interface RunFold {
  title: string
  play: string
  live: boolean
  status: Status
  state: string
  best: BestSlot
  /** The tag gate read on the commit the run started from, worded as the start point and never as the run's own result. */
  startPoint: string | null
  blocker: BlockerSlot
  output: ReturnType<typeof outputSeries>
  /** The run of the play that continued this one, from its lineage; null when none names it. */
  successor: string | null
  /** A newer run of the play has started, so a rerun of this run's check decides nothing. */
  superseded: boolean
  asOf: string | null
}

/** The play's run that continues `id`: one whose fork, predecessor or supersedes names it. */
export function successorOf(id: string, runs: PlayDocument['runs'] | null | undefined) {
  return (runs ?? []).find((run) => run.forkedFrom === id || run.predecessor === id || run.supersedes === id)?.id ?? null
}

/** Why an ended run stopped, in a clause the sentence can carry: the keeper's silence window, else the host's reason, cut. */
function endingWhy(reason: string | null | undefined) {
  if (!reason) return null
  const silence = /nothing streamed for (\d+) min/.exec(reason)
  if (silence) return `when nothing streamed for ${silence[1]} min`
  if (/no agent is live/.test(reason)) return 'when no agent was live'
  return clip(hostWords(reason.replace(/^(stalled|superseded|cancelled):\s*/i, '')), 7)
}

const ownTag = (tag: string | null | undefined, runId: string) => !!tag && (!tag.includes('/') || tag.startsWith(`${runId}/`))

/** The run's own best scored release under the current check: the play's best when it is this run's, else its newest check or gate. */
function ownBest(doc: RunDocument, play: Play | null) {
  const best = play?.standing?.bestCurrent ?? null
  if (best?.runId === doc.run.id && best.workloads?.total)
    return { tag: shortTag(best.tag), passed: best.workloads.passed ?? 0, total: best.workloads.total, at: best.at ?? null, reached: best.reached ?? null, of: best.of ?? null, unpublished: best.state === 'withheld' || best.release === 'withheld', line: best.line ?? null }
  const outcome = doc.progress?.outcome
  const rows = [outcome?.gate, outcome?.latestCheck].filter((row) => row && ownTag(row.tag, doc.run.id) && row.score?.workloads?.total)
  const top = rows.sort((a, b) => (b!.score!.workloads!.passed ?? 0) - (a!.score!.workloads!.passed ?? 0))[0]
  if (!top) return null
  return { tag: shortTag(top.tag), passed: top.score!.workloads!.passed ?? 0, total: top.score!.workloads!.total, at: top.at ?? null, reached: top.score!.reached ?? null, of: top.score!.of ?? null, unpublished: top.verdict === 'fail', line: top.line ?? null }
}

/** Why a scored release was not published, in a few words: a prover that panicked or failed, else its first failing words. */
function unpublishedWhy(line: string | null) {
  if (!line) return 'not published'
  if (/panick/i.test(line)) return 'not published: a prover panicked'
  const prover = /prover for (\S+) .*?(exited|did not finish)/.exec(line)
  if (prover) return `not published: the ${prover[1]} prover ${prover[2] === 'exited' ? 'failed' : 'timed out'}`
  return `not published: ${clip(hostWords(line.replace(/^NOT SOLVED:\s*/, '')), 6)}`
}

export function runFold({ doc, play, now }: { doc: RunDocument; play: Play | null; now: number }): RunFold {
  const run = doc.run
  const short = shortRun(run.play, run.id)
  const live = doc.execution?.alive ?? run.state === 'running'
  const endedAt = run.ending?.at ?? run.settledAt ?? null
  const until = live ? now : endedAt ? Date.parse(endedAt) : now
  const hours = hoursOf(run.startedAt ?? doc.progress?.startedAt, until)
  const h = hours === null ? '?' : hours.toFixed(1)
  const output = outputOf(doc.progress)
  const series = outputSeries(doc)
  const last = lastOutput(doc)
  const blocker = live ? (doc.progress?.blocker ?? null) : null
  const alert = blocker ? statusOf({ axis: 'alert', severity: blocker.severity, live: true }) : null
  // The one clock: in the blocker slot when nothing blocks the run, else in the state sentence.
  const clockInState = live && !!blocker && !!last
  const lastWords = last ? `last output ${since(last.at, now)} ago (${last.kind})` : null
  const status = live ? statusOf({ axis: 'run', state: 'running', elapsedMs: hours === null ? null : hours * 3_600_000 }) : statusOf({ axis: 'run', state: run.state, reason: run.ending?.reason ?? run.reason, endedAt })
  const tags = (output?.releaseTags ?? []).filter((tag) => !tag.inherited)
  const published = tags.filter((tag) => tag.published).length
  let state: string
  if (!live) {
    const why = endingWhy(run.ending?.reason ?? run.reason)
    state = `${status.word} at ${utc(endedAt) ?? 'an unrecorded time'} after ${h} h${why ? `, ${why}` : ''}.`
  } else if (output?.codeCommits !== null && output?.codeCommits !== undefined) {
    state = `Writing code: ${output.codeCommits} commits in ${h} h${output.newestCodeCommitAt ? `, newest ${clockZ(output.newestCodeCommitAt, now)}` : ''}; ${published ? `${published} published release${published === 1 ? '' : 's'}` : 'no published release yet'}${clockInState ? `; ${lastWords}` : ''}.`
  } else {
    const checks = run.check?.counts?.checks ?? null
    const released = run.check?.latest?.tag ?? doc.progress?.outcome?.tag ?? null
    state = `Running ${h} h: ${checks !== null ? `${checks} ${checks === 1 ? 'check' : 'checks'}, ` : ''}${released ? `newest release ${shortTag(released)}` : 'no release yet'}${clockInState ? `; ${lastWords}` : ''}.`
  }
  state = clip(state, SENTENCE_WORDS)

  const own = ownBest(doc, play)
  const playBest = play?.standing?.bestCurrent ?? null
  const best: BestSlot = own
    ? {
        headline: `${own.tag ?? 'workspace'}: ${own.passed} of ${own.total} workloads`,
        meter: { used: own.passed, total: own.total },
        subline: live ? (own.unpublished ? unpublishedWhy(own.line) : `stage ${own.reached ?? '?'} of ${own.of ?? '?'}`) : `stage ${own.reached ?? '?'} of ${own.of ?? '?'} · ${utc(own.at) ?? 'time not recorded'}`,
      }
    : {
        headline: `None from ${short} yet`,
        meter: null,
        subline: playBest?.tag
          ? `the play's best: ${shortTag(playBest.tag)} of ${shortRun(run.play, playBest.runId)}, ${playBest.workloads?.passed ?? '?'} of ${playBest.workloads?.total ?? '?'}`
          : 'no release scored yet',
      }

  const gate = run.check?.gate ?? null
  const fork = (doc.receipt as { codeRepository?: { forkCommit?: string | null } } | null | undefined)?.codeRepository?.forkCommit ?? output?.forkCommit ?? null
  const inherited = gate && (inheritedOf(gate) || (!!fork && !!gate.commit && fork.startsWith(gate.commit.slice(0, 8))))
  let startPoint: string | null = null
  if (inherited && gate) {
    const score = gate.score
    const cap = /prover for (\S+) .*did not finish in (\d+) s/.exec(gate.line ?? '')
    const verdict = gate.verdict === 'pass' ? 'passed' : gate.verdict === 'fail' ? 'did not pass' : `unverified${cap ? ` (${cap[1]} over ${cap[2]} s)` : ''}`
    startPoint = `Start point (${shortTag(gate.tag) ?? gate.commit?.slice(0, 8)}) re-checked: ${score?.workloads?.total ? `${score.workloads.passed ?? 0}/${score.workloads.total}` : 'no score'}${score?.reached ? ` at stage ${score.reached}` : ''}, ${verdict}`
  }

  const successor = live ? null : successorOf(run.id, play?.runs)
  const superseded = !live && (!!successor || (play?.runs ?? []).some((other) => other.id !== run.id && !!other.startedAt && !!run.startedAt && Date.parse(other.startedAt) > Date.parse(run.startedAt)))
  const blockerSlot: BlockerSlot = blocker
    ? {
        headline: `${blockerWord(blocker.class)}: ${blocker.owner ?? 'Discovery operator'}`,
        subline: `since ${clockZ(blocker.since, now) ?? 'an unrecorded time'}${blocker.since ? ` · ${since(blocker.since, now)} old` : ''}`,
        blocker,
        status: alert,
      }
    : live
      ? { headline: 'None', subline: lastWords ?? 'no output read yet', blocker: null, status: null }
      : { headline: 'None open', subline: `ended ${endedAt ? `${since(endedAt, now)} ago` : 'at an unrecorded time'}${successor ? ` · continued in ${shortRun(run.play, successor)}` : ''}`, blocker: null, status: null }

  return {
    title: `Run ${short}`,
    play: run.play,
    live,
    status,
    state,
    best,
    startPoint,
    blocker: blockerSlot,
    output: series,
    successor,
    superseded,
    asOf: output?.asOf ?? doc.progress?.generatedAt ?? doc.live?.mirrorAt ?? null,
  }
}

/** A tag's release number within its run (`rc16` → 16), for ordering the run's own releases. */
const ordinal = (tag: string | null | undefined) => {
  const match = /(?:^|\/)rc(\d+)$/.exec(tag ?? '')
  return match ? Number(match[1]) : null
}

/**
 * Whether a contract line's fix came from a later release than the one it was sent on: the fixing tag must be cut after
 * the line was sent. A fix credited to the same or an older release (rc14 for a line sent on rc16) is no fix.
 */
export function fixedLater(line: { at: string; tag: string | null; resolvedOn?: string | null; resolvedAt?: string | null; fixCommit?: string | null }) {
  if (!line.fixCommit || !line.resolvedOn) return false
  const sent = ordinal(line.tag)
  const fixed = ordinal(line.resolvedOn)
  const sameRun = (line.tag ?? '').split('/')[0] === line.resolvedOn.split('/')[0]
  if (sent !== null && fixed !== null && sameRun) return fixed > sent
  return !!line.resolvedAt && Date.parse(line.resolvedAt) > Date.parse(line.at)
}
