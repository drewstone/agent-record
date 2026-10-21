import type { RunDocument } from '../workspace-model.js'
import { type Status, statusOf } from './data.js'
import { age, type AsOf, blockerName, clampWords, cumulative, hm, hoursText, ms, newest, type Play, runOutput, STATE_WORDS, stamp } from './answers.js'
import { shortRun, shortTag } from './play-standing.js'
import type { ContractDelivery, RunReceipt } from './run-receipt.js'

/**
 * A run page's first screen, read from served fields: its one status chip, its one clock, and the four slots (state, best,
 * blocker, output). The play document, when the page has it, supplies the play's best, the run's lineage and the run
 * that continued it; without it each slot falls back to the run document alone.
 */

export const isLive = (doc: RunDocument) => doc.execution?.alive ?? (doc.progress ? !(doc.progress.final || doc.progress.phase === 'settled') : doc.run.state === 'running')

/** The agent whose stream moved last: a live run's conversations open at its newest event. */
export function newestAgent(doc: RunDocument): string | null {
  let best: { node: string; at: number } | null = null
  for (const agent of doc.progress?.agents ?? []) {
    const at = ms(agent.lastActiveAt)
    if (Number.isFinite(at) && (!best || at > best.at)) best = { node: agent.node, at }
  }
  return best?.node ?? null
}

/** The run that continued this one: a newer run of the play forked from it, or that names it as predecessor. */
export function successorOf(play: Play | null | undefined, runId: string): { runId: string; run: string } | null {
  if (!play) return null
  const parents = new Map<string, string>()
  for (const run of play.runs) {
    const parent = run.forkedFrom ?? run.predecessor ?? run.supersedes ?? null
    if (parent) parents.set(run.id, parent)
  }
  for (const row of play.ledger?.rows ?? []) if (row.lineage?.parentRun) parents.set(row.runId, row.lineage.parentRun)
  const started = (id: string) => ms(play.runs.find((run) => run.id === id)?.startedAt ?? play.ledger?.rows.find((row) => row.runId === id)?.startedAt)
  const children = [...parents].filter(([, parent]) => parent === runId).map(([child]) => child)
  // The newest child is where the work went on; a live one wins.
  const next = children.sort((a, b) => (started(b) || 0) - (started(a) || 0))[0]
  return next ? { runId: next, run: shortRun(play.id, next) } : null
}

/** The run's one status word, the same in the chip and the ending sentence. */
export function runChip(doc: RunDocument, newerStarted?: boolean, now = Date.now()): Status {
  if (isLive(doc)) {
    const started = doc.run.startedAt ?? doc.progress?.startedAt ?? null
    return statusOf({ axis: 'run', state: 'running', elapsedMs: started ? now - ms(started) : undefined })
  }
  const state = doc.run.ending?.state ?? doc.run.state
  return statusOf({ axis: 'run', state, reason: doc.run.reason ?? doc.run.ending?.reason ?? null, endedAt: doc.run.ending?.at ?? doc.run.settledAt, newerStarted, now })
}

/**
 * The run's one clock: `progress.output.lastOutputAt` and its kind when served, else the newer of the agent stream and
 * the run's recorded activity, named. Null when neither is recorded.
 */
export function runClock(doc: RunDocument): { at: string; kind: string } | null {
  const output = runOutput(doc)
  if (output?.lastOutputAt) return { at: output.lastOutputAt, kind: output.lastOutputKind ?? 'agent event' }
  const stream = doc.progress?.outcome?.lastStreamAt ?? null
  const activity = doc.execution?.lastActivityAt ?? null
  // The agent stream names the output; the run's own activity leads only when it is a minute or more newer.
  if (stream && (!activity || ms(activity) - ms(stream) < 60_000)) return { at: stream, kind: 'agent event' }
  return activity ? { at: activity, kind: 'run activity' } : null
}
export const clockWords = (clock: { at: string; kind: string }, now: number) => `last output ${age(ms(clock.at), now)} ago (${clock.kind})`

/** Why the run ended, as the clause the ending sentence carries; the rest of the reason folds into "Why it stopped". */
function endingClause(reason: string | null | undefined): string | null {
  const silent = /nothing streamed for (\d+) min/.exec(reason ?? '')
  return silent ? `when ${silent[1]} minutes passed with no agent output` : null
}

/** The first slot: one sentence of at most 18 words saying what the run is doing, or how it ended. */
export function runState(doc: RunDocument, chip: Status, now: number): string {
  const started = doc.run.startedAt ?? doc.progress?.startedAt ?? null
  if (isLive(doc)) {
    const hours = started ? (now - ms(started)) / 3_600_000 : null
    const output = runOutput(doc)
    if (output?.codeCommits != null) {
      const published = (output.releaseTags ?? []).filter((tag) => tag.published === true && !tag.inherited).length
      return clampWords(`Writing code: ${output.codeCommits} commits${hours !== null ? ` in ${hoursText(hours)}` : ''}${output.newestCodeCommitAt ? `, newest ${hm(output.newestCodeCommitAt)}` : ''}; ${published ? `${published} published release${published === 1 ? '' : 's'}` : 'no published release yet'}.`, STATE_WORDS)
    }
    const latest = doc.run.check?.latest ?? doc.progress?.outcome?.latestCheck ?? null
    return clampWords(`Running ${hours !== null ? hoursText(hours) : ''}${latest?.at ? `; newest check ${hm(latest.at)}: ${latest.line ?? 'no line recorded'}` : '; no check yet'}.`.replace(/\s+;/, ';'), STATE_WORDS)
  }
  const ended = doc.run.ending?.at ?? doc.run.settledAt ?? null
  const wall = doc.receipt?.work?.wallHours ?? (started && ended ? (ms(ended) - ms(started)) / 3_600_000 : null)
  const clause = endingClause(doc.run.ending?.reason ?? doc.run.reason)
  return clampWords(`${chip.word}${ended ? ` at ${stamp(ended, now)}` : ''}${wall !== null ? ` after ${hoursText(wall)}` : ''}${clause ? `, ${clause}` : ''}.`, STATE_WORDS)
}

export interface BestSlot {
  headline: string
  sub: string
  meter: { value: number; of: number; previous: number | null } | null
}

/** The second slot: this run's best release under the current check, or the play's best when the run has none. */
export function runBest(doc: RunDocument, play: Play | null | undefined, now: number): BestSlot {
  const runId = doc.run.id
  const current = play?.standing?.bestCurrent ?? null
  const row = play?.ledger?.rows.find((item) => item.runId === runId)?.best ?? null
  const own = current?.runId === runId ? current : row && (!current?.checker || row.checker === current.checker) ? row : null
  const fromCheck = doc.run.check?.best ?? null
  const best = own ?? (fromCheck?.score?.workloads ? { tag: fromCheck.tag, workloads: fromCheck.score.workloads, reached: fromCheck.score.reached, of: fromCheck.score.of, at: fromCheck.at, line: fromCheck.line } : null)
  const previous = (play?.ledger?.rows ?? []).filter((item) => item.runId !== runId && item.best?.workloads?.passed != null && (!current?.checker || item.best.checker === current.checker)).reduce<number | null>((max, item) => Math.max(max ?? 0, item.best!.workloads!.passed!), null)
  const total = best?.workloads?.total ?? 0
  if (best?.workloads && total) {
    const w = best.workloads
    const release = (best as { release?: unknown; state?: string }).state ?? (typeof (best as { release?: unknown }).release === 'string' ? ((best as { release?: string }).release as string) : null)
    const prover = /prover for ([\w-]+)[^|]*?(panick|exited|did not finish)/.exec(best.line ?? '')
    const sub = isLive(doc)
      ? release === 'withheld'
        ? `not published: ${prover ? `the ${prover[1]} prover ${prover[2] === 'did not finish' ? 'timed out' : 'failed'}` : 'its public stages did not pass'}`
        : release === 'published' ? 'published' : 'checked'
      : [best.reached && best.of ? `stage ${best.reached} of ${best.of}` : null, best.at ? stamp(best.at, now) : null].filter(Boolean).join(' · ')
    return { headline: `${shortTag(best.tag) ?? 'workspace'}: ${w.passed ?? 0} of ${total} workloads`, sub, meter: { value: w.passed ?? 0, of: total, previous } }
  }
  if (current?.runId && current.workloads?.total)
    return {
      headline: `None from ${shortRun(doc.run.play, runId)} yet`,
      sub: `the play’s best: ${shortTag(current.tag)} of ${shortRun(doc.run.play, current.runId)}, ${current.workloads.passed ?? 0} of ${current.workloads.total}`,
      meter: null,
    }
  return { headline: 'No checked release yet', sub: doc.run.check?.counts?.checks ? `${doc.run.check.counts.checks} checks, none on a release` : 'no check has run', meter: null }
}

export interface BlockerSlot {
  headline: string
  sub: string
  status: Status | null
}

/** The third slot: a live run's blocker with its owner and age, else "None"; an ended run's lineage. Live runs carry the clock here. */
export function runBlocker(doc: RunDocument, successor: { runId: string; run: string } | null, now: number): BlockerSlot {
  const clock = runClock(doc)
  if (isLive(doc)) {
    const blocker = doc.progress?.blocker ?? null
    const clockText = clock ? clockWords(clock, now) : 'no output recorded'
    if (!blocker) return { headline: 'None', sub: clockText, status: null }
    const status = statusOf({ axis: 'alert', severity: blocker.severity, live: true })
    return {
      headline: `${blockerName(blocker)}${status.tone === 'fail' ? ` · act now: ${blocker.owner ?? 'Discovery operator'}` : ''}`,
      sub: [blocker.since ? `${age(ms(blocker.since), now)} old` : null, clockText].filter(Boolean).join(' · '),
      status,
    }
  }
  const ended = doc.run.ending?.at ?? doc.run.settledAt ?? null
  return { headline: 'None open', sub: [ended ? `ended ${age(ms(ended), now)} ago` : null, successor ? `continued in ${successor.run}` : null].filter(Boolean).join(' · '), status: null }
}

export interface OutputSlot {
  headline: string
  sub: string
  points: [number, number][] | null
}

/** The fourth slot: what the run produced. `progress.output` when served, else the files its agents wrote over time. */
export function runOutputSlot(doc: RunDocument, now: number): OutputSlot {
  const output = runOutput(doc)
  if (output?.codeCommits != null) {
    const own = (output.releaseTags ?? []).filter((tag) => !tag.inherited)
    return {
      headline: `${output.codeCommits} code commits`,
      sub: [output.newestCodeCommitAt ? `newest ${stamp(output.newestCodeCommitAt, now)}` : null, own.length ? `${own.length} release tags, ${own.filter((tag) => tag.published).length} published` : 'no release yet'].filter(Boolean).join(' · '),
      points: output.codeCommitsBy30Min?.length ? cumulative(output.codeCommitsBy30Min) : null,
    }
  }
  const samples = doc.progress?.samples ?? []
  const last = samples.at(-1)
  if (!last) return { headline: 'No output recorded', sub: 'the run wrote no progress samples', points: null }
  return {
    headline: `${doc.progress?.files ?? last.files} files written`,
    sub: `as of ${stamp(last.at, now)}`,
    points: samples.length > 1 ? samples.map((sample): [number, number] => [ms(sample.at), sample.files]) : null,
  }
}

/** The run page's one as-of: when the run's progress was last composed. */
export function runAsOf(doc: RunDocument): AsOf | null {
  const at = newest(doc.progress?.generatedAt, runOutput(doc)?.asOf, (doc.receipt as { generatedAt?: string } | null | undefined)?.generatedAt, doc.live.mirrorAt)
  return at ? { at, meaning: 'when this run’s progress was last composed', source: 'run-progress.json and the run receipt' } : null
}

/** The start point's commit: the gate the run inherited from its fork, which is not the run's own result. */
export function inheritedGate(doc: RunDocument, play: Play | null | undefined): string | null {
  const gate = doc.run.check?.gate ?? null
  if (!gate) return null
  const fork = (doc.receipt as { codeRepository?: { forkCommit?: string | null } | null } | null | undefined)?.codeRepository?.forkCommit ?? null
  const inherited = (gate as { inherited?: boolean }).inherited === true || Boolean(fork && gate.commit && (fork.startsWith(gate.commit) || gate.commit.startsWith(fork)))
  if (!inherited) return null
  const lineage = play?.ledger?.rows.find((row) => row.runId === doc.run.id)?.lineage ?? null
  const from = lineage?.parentRun && lineage.parentTag ? `${shortRun(doc.run.play, lineage.parentRun)} ${shortTag(lineage.parentTag)}` : (shortTag(gate.tag) ?? gate.commit?.slice(0, 8) ?? 'the fork')
  const score = gate.score
  const w = score?.workloads
  const timeout = /prover for ([\w-]+) .*did not finish in (\d+) s/.exec(gate.line ?? '')
  const verdict = gate.verdict === 'pass' ? 'passed' : gate.verdict === 'fail' ? 'failed' : 'unverified'
  return `Start point (${from}) rechecked: ${w?.total ? `${w.passed ?? 0}/${w.total}` : 'no score'}${score?.reached ? ` at stage ${score.reached}` : ''}, ${verdict}${timeout ? ` (${timeout[1]} over ${timeout[2]} s)` : ''}`
}

/**
 * When a release tag was cut, as the receipt records it: the first score on that tag (the Lab checks a tag as it is cut),
 * else when the line it resolved was resolved.
 */
function tagCutAt(receipt: RunReceipt, tag: string | null | undefined): number | null {
  if (!tag) return null
  const name = shortTag(tag)
  const times = (receipt.system?.play?.scores ?? []).filter((point) => shortTag(point.tag) === name).map((point) => ms(typeof point.firstAt === 'string' ? point.firstAt : point.at)).filter(Number.isFinite)
  return times.length ? Math.min(...times) : null
}

/** "Fixed in" only when the fixing tag was cut after the line was sent; otherwise the line was not fixed by a later release. */
export function fixedIn(receipt: RunReceipt, line: ContractDelivery): { tag: string; commit: string | null } | null {
  if (!line.fixCommit && !line.resolvedOn) return null
  const tag = shortTag(line.resolvedOn) ?? line.fixCommit!.slice(0, 8)
  const cut = tagCutAt(receipt, line.resolvedOn) ?? (line.resolvedAt ? ms(line.resolvedAt) : null)
  if (cut === null || !(cut > ms(line.at))) return null
  return { tag, commit: line.fixCommit?.slice(0, 8) ?? null }
}
