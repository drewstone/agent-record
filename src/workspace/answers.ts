import type { OverviewAttention, OverviewDocument, PlayDocument, RunDocument } from '../workspace-model.js'
import type { PlayReportDocument } from '../play-report.js'
import { type Status, statusOf } from './data.js'
import type { PlayHead } from './play-standing.js'
import { shortRun, shortTag } from './play-standing.js'
import type { ReliabilityDocument } from './reliability-model.js'
import { builtOf, hostAnswer, outputOf, raisedAtOf, runningAtOf } from './served-fields.js'

/**
 * The answers each decision page opens with (design-system sections 3 and 6, wall redesign v2): four tiles, each a
 * label, a headline of at most 8 words, exactly one figure, a sub-line of at most 12 words, and a drawer with the detail.
 * Each tile reads the host's worded answer when it is served and the fields served before it otherwise, chosen per tile,
 * so a tile never mixes the two. This module only derives; `AnswerStrip` renders.
 */

export type AnswerSlot = 'needs-me' | 'is-it-working' | 'is-discovery-reliable' | 'did-it-work' | 'what-was-built'
export type Figure =
  | { kind: 'num'; value: string; small?: string; unit?: string; tip: string }
  | { kind: 'spark'; points: [number, number][]; label: string; tip: string }
export interface Answer {
  slot: AnswerSlot
  label: string
  headline: string
  figure: Figure
  subline: string
  /** A tile that needs a person carries its act-now mark; every other tile is unmarked. */
  status?: Status | null
  href?: string
}

export const HEADLINE_WORDS = 8
export const SUBLINE_WORDS = 12

/** Body words as the checks count them: whitespace tokens that hold a letter or a digit. */
export const words = (text: string) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length

/** The text cut to `max` body words, marked with an ellipsis when cut; host sentences fit a tile this way. */
export function clip(text: string, max: number) {
  const out: string[] = []
  let count = 0
  for (const token of text.trim().split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token) && ++count > max) return `${out.join(' ').replace(/[,;:·(]+$/, '')}…`
    out.push(token)
  }
  return out.join(' ')
}

/** An age for live freshness (design-system section 3): minutes under 2 h, then hours to one decimal, then days. */
export function age(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const minutes = ms / 60_000
  if (minutes < 120) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  return hours < 48 ? `${hours.toFixed(1)} h` : `${Math.round(hours / 24)} days`
}
export const since = (at: string | null | undefined, now: number) => (at ? age(now - Date.parse(at)) : null)

/** `04:33Z` on the as-of day, `10-19 03:27Z` on another. */
export function clockZ(at: string | null | undefined, now: number) {
  if (!at) return null
  const date = new Date(at)
  if (!Number.isFinite(date.valueOf())) return null
  const iso = date.toISOString()
  const day = new Date(now).toISOString().slice(0, 10)
  return `${iso.slice(0, 10) === day ? '' : `${iso.slice(5, 10)} `}${iso.slice(11, 16)}Z`
}

const num = (value: string | number, tip: string, unit?: string, small?: string): Figure => ({ kind: 'num', value: String(value), tip, ...(unit ? { unit } : {}), ...(small ? { small } : {}) })
const firstSentence = (text: string) => /^[^.]+/.exec(text)?.[0]?.trim() ?? text
const cumulative = (steps: { at: number; n: number }[]): [number, number][] => {
  let total = 0
  return [[0, 0], ...steps.map((step, i) => [i + 1, (total += step.n)] as [number, number])]
}

/** A run's newest output and what it was: the host's `lastOutputAt` and kind, else the newer of agent stream and run activity. */
export function lastOutput(doc: Pick<RunDocument, 'progress' | 'execution'> | null | undefined): { at: string; kind: string } | null {
  const output = outputOf(doc?.progress)
  if (output?.lastOutputAt) return { at: output.lastOutputAt, kind: (output.lastOutputKind ?? 'output').replaceAll('-', ' ') }
  const candidates = [
    { at: doc?.progress?.outcome?.lastStreamAt ?? null, kind: 'agent event' },
    { at: doc?.execution?.lastActivityAt ?? null, kind: 'run activity' },
  ].filter((item): item is { at: string; kind: string } => !!item.at && Number.isFinite(Date.parse(item.at)))
  return candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
}

/** Code commits, else files written, over the run as a cumulative series, with what it counts. */
export function outputSeries(doc: Pick<RunDocument, 'progress'> | null | undefined): { points: [number, number][]; total: number; what: 'commits' | 'files'; newestAt: string | null } | null {
  const output = outputOf(doc?.progress)
  if (output?.codeCommitsBy30Min?.length) {
    const points = cumulative(output.codeCommitsBy30Min.map((bin) => ({ at: Date.parse(bin.at), n: bin.n })))
    return { points, total: output.codeCommits ?? points.at(-1)![1], what: 'commits', newestAt: output.newestCodeCommitAt ?? null }
  }
  const samples = doc?.progress?.samples ?? []
  if (samples.length < 2) return null
  return { points: samples.map((sample, i) => [i, sample.files] as [number, number]), total: samples.at(-1)!.files, what: 'files', newestAt: null }
}

/** When a play page's facts are as of: the host's composition time, else the live run's elapsed time at composition. */
export function playAsOf(play: PlayHead & { composedAt?: unknown }, report?: Pick<PlayReportDocument, 'asOf'> | null) {
  if (typeof play.composedAt === 'string') return play.composedAt
  const live = play.live
  if (live?.startedAt && typeof live.elapsedMs === 'number') return new Date(Date.parse(live.startedAt) + live.elapsedMs).toISOString()
  return report?.asOf ?? null
}

type Play = PlayDocument & PlayHead

const BLOCKER_WORD: Record<string, string> = { 'stuck-turn': 'Hung turn', 'check-infra': 'Check host', 'quota-wall': 'Quota wall', 'gate-undecided': 'Unverified releases' }
export const blockerWord = (cls: string) => BLOCKER_WORD[cls] ?? cls.replaceAll('-', ' ')

/** The play's four answers: solved?, producing?, built, needs you. */
export function playAnswers({ play, report, liveRun, now }: { play: Play; report?: PlayReportDocument | null; liveRun?: RunDocument | null; now: number }): Answer[] {
  return [solvedAnswer(play), producingAnswer(play, liveRun ?? null, now), builtAnswer(play, report ?? null), needsAnswer(play, now)]
}

function solvedAnswer(play: Play): Answer {
  const host = hostAnswer(play.standing, 'solved')
  const best = play.standing?.bestCurrent ?? null
  const result = statusOf({ axis: 'result', verdict: best ? (best.verdict ?? 'unknown') : 'no-tag' })
  const workloads = best?.workloads?.total ? best.workloads : null
  const run = best?.runId ? shortRun(play.id, best.runId) : null
  const figure = workloads
    ? num(workloads.passed ?? 0, `${workloads.passed ?? 0} of ${workloads.total} workloads${best?.reached && best.of ? `, stage ${best.reached} of ${best.of}` : ''}`, 'workloads', `/${workloads.total}`)
    : best?.reached && best.of
      ? num(best.reached, `stage ${best.reached} of ${best.of}`, 'stages', `/${best.of}`)
      : num(play.standing?.releases?.passingCurrent ?? 0, 'releases that pass the current check', 'passing')
  const count = best?.count ?? 1
  const unpublished = best?.state === 'withheld' || best?.release === 'withheld'
  return {
    slot: 'did-it-work',
    label: 'Solved?',
    headline: clip(host?.headline ?? (host?.text ? firstSentence(host.text) : result.word), HEADLINE_WORDS),
    figure,
    subline: best ? `${shortTag(best.tag) ?? 'workspace'}${run ? ` of ${run}` : ''}, checked ${count === 1 ? 'once' : `${count} times`}${unpublished ? ', not published' : ''}` : 'No release checked yet',
  }
}

function producingAnswer(play: Play, liveRun: RunDocument | null, now: number): Answer {
  const host = hostAnswer(play.standing, 'producing')
  const live = play.live ?? null
  if (!live) {
    const ending = play.standing?.lastEnding ?? null
    const ended = ending ? statusOf({ axis: 'run', state: ending.word, reason: ending.reason, endedAt: ending.at }) : null
    return {
      slot: 'is-it-working',
      label: 'Producing?',
      headline: clip(host?.headline ?? (ended ? `No run live; last ${ended.word.toLowerCase()}` : 'No run yet'), HEADLINE_WORDS),
      figure: num(ending?.wallHours !== null && ending?.wallHours !== undefined ? ending.wallHours.toFixed(1) : '0', ending ? `${ending.run ?? shortRun(play.id, ending.runId)} ran ${ending.wallHours ?? '?'} h` : 'no run recorded', 'h last run'),
      subline: ending ? `${ending.run ?? shortRun(play.id, ending.runId)} ended ${clockZ(ending.at, now) ?? 'at an unrecorded time'}` : 'Press the play to start a run',
    }
  }
  const startedAt = live.startedAt ? Date.parse(live.startedAt) : NaN
  const hours = ((Number.isFinite(startedAt) ? now - startedAt : (live.elapsedMs ?? 0)) / 3_600_000).toFixed(1)
  const series = outputSeries(liveRun)
  const published = (outputOf(liveRun?.progress)?.releaseTags ?? []).filter((tag) => tag.published && !tag.inherited).length
  const last = lastOutput(liveRun)
  const headline = host?.headline
    ?? (series?.what === 'commits'
      ? series.total ? `Writing code, ${published ? 'releases out' : 'no release yet'}` : 'No code commits yet'
      : series ? (series.total > series.points[0]![1] ? 'Writing files, no release yet' : 'No new output yet') : 'Running, output not read yet')
  const newest = series?.newestAt ? `newest commit ${clockZ(series.newestAt, now)}` : last ? `last ${last.kind} ${since(last.at, now)} ago` : null
  return {
    slot: 'is-it-working',
    label: 'Producing?',
    headline: clip(headline, HEADLINE_WORDS),
    figure: series
      ? { kind: 'spark', points: series.points, label: `${series.total} ${series.what}`, tip: `${series.total} ${series.what} since ${clockZ(live.startedAt, now) ?? 'the start'}` }
      : num(hours, `${live.run ?? shortRun(play.id, live.runId)} running ${hours} h`, 'h running'),
    subline: [newest, `${hours} h in`].filter(Boolean).join(' · '),
  }
}

function builtAnswer(play: Play, report: PlayReportDocument | null): Answer {
  const served = play as unknown as { built?: unknown; play_head?: { built?: unknown } }
  const built = builtOf(served.play_head?.built ?? served.built) ?? builtOf(report?.built)
  const href = `/play/${encodeURIComponent(play.id)}/report#built`
  if (!built?.crates?.value?.length)
    return { slot: 'what-was-built', label: 'Built', headline: 'Not read yet', figure: num('–', 'no inventory read', 'crates'), subline: 'The play report lists no release contents', href }
  const crates = built.crates.value
  const commands = Object.keys(built.commands?.value ?? {}).filter((name) => name === 'prover' || name === 'verifier')
  const guests = built.guests?.value ?? null
  const parts = [...commands, ...(guests ? [`${guests} guest programs`] : [])]
  const headline = parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : `${crates.length} crates`
  const external = built.externalCrates?.value ?? null
  const tag = shortTag(built.release?.tag)
  const run = built.release?.runId ? shortRun(play.id, built.release.runId) : null
  return {
    slot: 'what-was-built',
    label: 'Built',
    headline: clip(headline, HEADLINE_WORDS),
    figure: num(crates.length, `${crates.length} workspace crates: ${crates.join(', ')}`, 'crates'),
    subline: `${tag ? `at ${tag}${run ? ` of ${run}` : ''}` : 'at the best release'}, ${external ? `${external} outside crates` : external === 0 ? 'no outside crates' : 'outside crates not read'}`,
    href,
  }
}

function needsAnswer(play: Play, now: number): Answer {
  const live = play.live ?? null
  const blocker = live?.blocker ?? null
  const status = blocker ? statusOf({ axis: 'alert', severity: blocker.severity, live: true }) : null
  if (blocker && status?.tone === 'fail') {
    const old = since(blocker.since, now)
    return {
      slot: 'needs-me',
      label: 'Needs you',
      headline: '1 needs you now',
      figure: num(1, `${blockerWord(blocker.class)} on ${live!.run ?? shortRun(play.id, live!.runId)}`),
      subline: `act now: ${blocker.owner ?? 'Discovery operator'}${old ? ` · ${old} old` : ''}`,
      status,
    }
  }
  const past = play.standing?.lastEnding?.blocker ?? null
  return {
    slot: 'needs-me',
    label: 'Needs you',
    headline: 'Nothing needs you now',
    figure: num(0, 'open items on this play that need a person'),
    subline: blocker
      ? `${blockerWord(blocker.class)} on ${live!.run ?? shortRun(play.id, live!.runId)}, owner ${clip(blocker.owner ?? 'Discovery operator', 4)}`
      : past
        ? `${blockerWord(past.class)} ended with ${play.standing!.lastEnding!.run ?? 'the last run'}`
        : live ? `No blocker on ${live.run ?? shortRun(play.id, live.runId)}` : 'No run is live',
  }
}

/** An attention item's state word (cleared, past, not urgent or act now) from statusOf. */
export const attentionStatus = (item: OverviewAttention) => statusOf({ axis: 'alert', tone: item.tone, live: true, heldPass: Boolean(item.held?.length) })

/** An attention item's age: exact from its raise time; with none served, a lower bound from the composition that served it. */
export function attentionAge(item: OverviewAttention, composedAt: string, now: number) {
  const raised = raisedAtOf(item)
  if (raised) return { basis: 'raised', at: raised, text: `${since(raised, now)} old` }
  return { basis: 'seen since', at: composedAt, text: `at least ${since(composedAt, now)} old` }
}

/** The overview's four answers: needs you, running now, clean runs, this week. */
export function overviewAnswers({ doc, reliability, now }: { doc: OverviewDocument; reliability?: ReliabilityDocument | null; now: number }): Answer[] {
  const attention = doc.attention ?? []
  const act = attention.filter((item) => attentionStatus(item).tone === 'fail')
  const cleared = attention.filter((item) => item.tone === 'info')
  const lead = act[0] ?? cleared[0] ?? null
  const running = doc.now ?? []
  const runningAt = runningAtOf(doc) ?? doc.composedAt
  const newest = [...running].sort((a, b) => Date.parse(b.activeAt ?? '') - Date.parse(a.activeAt ?? ''))[0] ?? null
  const day = reliability?.daily?.filter((item) => item.rate !== null && item.runs > 0).at(-1) ?? null
  const week = doc.week ?? []
  const passed = week.filter((play) => play.lead?.kind === 'check').length
  return [
    {
      slot: 'needs-me',
      label: 'Needs you',
      headline: act.length ? `${act.length} need${act.length === 1 ? 's' : ''} you now` : 'Nothing needs you now',
      figure: num(act.length, `${act.length} of ${attention.length} items need a person; ${cleared.length} cleared`),
      subline: lead ? `${clip(lead.text, 6)}${act.length ? '' : ' cleared'} · ${attentionAge(lead, doc.composedAt, now).text}` : 'No open items',
      status: act.length ? attentionStatus(act[0]!) : null,
    },
    {
      slot: 'is-it-working',
      label: 'Running now',
      headline: running.length === 1 ? `${shortRun(running[0]!.play, running[0]!.runId)} of ${running[0]!.play} is running` : running.length ? `${running.length} runs running` : 'Nothing running',
      figure: num(running.length, `${running.length} running, ${doc.state.queued} queued at ${clockZ(runningAt, now)}`, 'running'),
      subline: newest ? `newest activity ${since(newest.activeAt ?? newest.startedAt, now) ?? 'unknown'} ago` : `${doc.state.queued} queued`,
    },
    {
      slot: 'is-discovery-reliable',
      label: 'Clean runs',
      headline: day ? (day.rate! >= 0.8 ? 'At the 80% target' : 'Below the 80% target') : 'Not measured yet',
      figure: day ? num(Math.round(day.rate! * 100), `${day.clean} of ${day.runs} settled runs clean on ${day.day}`, undefined, '%') : num('–', 'the reliability record was not read', 'clean'),
      subline: day ? `${day.day.slice(5)}: ${day.clean} of ${day.runs} settled runs` : 'reliability record not read',
    },
    {
      slot: 'did-it-work',
      label: 'This week',
      headline: `${passed} of ${week.length} plays passed`,
      figure: num(passed, `${passed} of ${week.length} plays passed their check at least once in ${doc.weekDays ?? 7} days`, 'plays', `/${week.length}`),
      subline: `${week.reduce((sum, play) => sum + play.runCount, 0)} runs in ${doc.weekDays ?? 7} days`,
    },
  ]
}
