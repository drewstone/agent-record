import { viewAsOf, viewChip } from './view.js'
import type { OverviewAttention, OverviewDocument, PlayDocument, RunDocument } from '../workspace-model.js'
import type { PlayReportDocument } from '../play-report.js'
import { newerStarted, type Status, statusOf } from './data.js'
import { ENDING_GLYPH, hostWords, lineReason, metricValue, type PlayBest, type PlayBlocker, type PlayHead, RELEASE_STATE, shortRun, shortTag } from './play-standing.js'

/**
 * The one place a decision page's answers are read from served fields (design-system sections 3 and 6). Change 1's fields
 * (`standing.answer`, `play_head.built`, `progress.output`, `run.check.gate.inherited`, `rulers[].rerunSpread`,
 * `runningAt`) lead when served; otherwise each answer falls back to fields served before them. Components only lay
 * these out, so the word and figure limits below hold on every page.
 */

/** The share of settled runs that should end clean (no infrastructure, platform or quota failure): Today's target line and the overview's verdict. */
export const CLEAN_RUN_TARGET = 0.8

export type Play = PlayDocument & PlayHead
export type Slot = 'did-it-work' | 'is-it-working' | 'what-was-built' | 'needs-me' | 'is-discovery-reliable'

export type Figure =
  | { kind: 'num'; value: string; unit: string; tip: string }
  | { kind: 'spark'; points: [number, number][]; label: string; tip: string }

/** A drawer line: a term, its words, and optionally a status mark or a link. */
export interface DetailRow {
  term: string
  text: string
  status?: Status
  /** The status mark's own words when they differ from its word: a red mark names who acts. */
  pill?: string
  href?: string
}

export interface Answer {
  slot: Slot
  label: string
  /** At most 8 words. */
  headline: string
  figure: Figure
  /** At most 12 words. */
  subline: string
  rows: DetailRow[]
}

export const HEADLINE_WORDS = 8
export const SUBLINE_WORDS = 12
export const STATE_WORDS = 18

/** Cut text to `n` whitespace words, marking a cut with an ellipsis. */
export function clampWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length <= n ? words.join(' ') : `${words.slice(0, n).join(' ').replace(/[,;:·.]+$/, '')}…`
}

export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN)
const pad = (value: number) => String(value).padStart(2, '0')
/** `04:33Z`. */
export const hm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}
/** `04:33Z` on the day of `now`, else `10-19 03:27Z`. */
export const stamp = (iso: string, now: number) => {
  const d = new Date(iso)
  const day = (t: number) => new Date(t).toISOString().slice(5, 10)
  return day(d.valueOf()) === day(now) ? hm(iso) : `${day(d.valueOf())} ${hm(iso)}`
}
/** An age in the unit a reader compares: minutes under two hours, then hours, then days. Never seconds. */
export function age(fromMs: number, now: number): string {
  const minutes = Math.max(0, (now - fromMs) / 60_000)
  if (minutes < 120) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  return hours < 48 ? `${hours.toFixed(1)} h` : `${Math.round(hours / 24)} days`
}
export const hoursText = (value: number) => `${value.toFixed(1)} h`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The newest valid time among these, or null. */
export function newest(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const value of values) if (value && Number.isFinite(ms(value)) && (best === null || ms(value) > ms(best))) best = value
  return best
}

/** One as-of per page: the time on screen, its date, meaning and source in the tip. */
export interface AsOf {
  at: string
  meaning: string
  source: string
}
export const asOfTip = (asOf: AsOf) => `${new Date(asOf.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${asOf.meaning} · ${asOf.source}`

// ----- change 1's fields, read loosely: served by tangle-tools when it lands, absent before -----

interface ServedAnswer {
  text?: string | null
  numbers?: Record<string, unknown> | null
  asOf?: string | null
  source?: string | null
}
type StandingAnswer = { solved?: ServedAnswer | null; producing?: ServedAnswer | null; measurement?: ServedAnswer | null; platform?: ServedAnswer | null }
type Built = NonNullable<PlayReportDocument['built']>
type Output = {
  codeCommits?: number | null
  newestCodeCommitAt?: string | null
  codeCommitsBy30Min?: { at: string; n: number }[] | null
  releaseTags?: { tag: string; at: string; published?: boolean | null; inherited?: boolean | null }[] | null
  lastOutputAt?: string | null
  lastOutputKind?: 'commit' | 'agent event' | 'page write' | string | null
  asOf?: string | null
}

const standingAnswer = (play: Play): StandingAnswer => ((play.standing as { answer?: StandingAnswer } | null | undefined)?.answer ?? {}) as StandingAnswer
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
export const runOutput = (doc: RunDocument | null | undefined): Output | null => ((doc?.progress as { output?: Output | null } | null | undefined)?.output ?? null)

/** Commits per 30 minutes as a cumulative step series, for the charts Spark. */
export function cumulative(bins: { at: string; n: number }[]): [number, number][] {
  let total = 0
  return [[0, 0], ...bins.map((bin, i): [number, number] => [i + 1, (total += bin.n)])]
}

// ----- the play -----

/** The play's best release under the current check: `standing.answer.solved` when served, else `standing.bestCurrent`. */
function bestOf(play: Play) {
  const current = play.standing?.bestCurrent ?? null
  const served = standingAnswer(play).solved?.numbers?.best as { tag?: string; runId?: string; workloads?: { passed: number; total: number }; reached?: number; of?: number } | undefined
  if (!served) return current
  return { ...(current && current.tag === served.tag && current.runId === served.runId ? current : {}), ...served } as PlayBest
}

const workloadFigure = (best: PlayBest | null): Figure => {
  const w = best?.workloads
  if (w?.total) return { kind: 'num', value: String(w.passed ?? 0), unit: `/${w.total} workloads`, tip: `${w.passed ?? 0} of ${w.total} workloads${best?.reached && best.of ? `, stage ${best.reached} of ${best.of}` : ''}` }
  if (best?.reached && best.of) return { kind: 'num', value: String(best.reached), unit: `/${best.of} stages`, tip: `stage ${best.reached} of ${best.of}` }
  return { kind: 'num', value: '0', unit: 'checked releases', tip: 'no release has a check result yet' }
}

/** Why a release was not published, in a few words from its check line. */
const notPublished = (line: string | null | undefined) => {
  const reason = lineReason(line)
  const prover = /prover for ([\w-]+)/.exec(reason)
  if (prover) return `a prover failed (${prover[1]})`
  return reason ? clampWords(reason, 6) : 'its public stages did not pass'
}

function didItWork(play: Play, now: number): Answer {
  const served = standingAnswer(play).solved ?? null
  const best = bestOf(play)
  const runs = num(served?.numbers?.runs)
  const passed = num(served?.numbers?.passed) ?? (play.standing?.status === 'solved' ? 1 : null)
  const run = best?.runId ? shortRun(play.id, best.runId) : null
  const checked = best?.count && best.count > 1 ? `checked ${best.count}×` : 'checked once'
  const release = best?.state ?? (typeof best?.release === 'string' ? best.release : null)
  const rows: DetailRow[] = []
  if (play.goal?.text) rows.push({ term: 'The goal', text: play.goal.text })
  if (served?.text) rows.push({ term: 'Answer', text: served.text })
  if (best?.tag)
    rows.push({
      term: 'Best release',
      text: [
        `${shortTag(best.tag)}${run ? ` (run ${run})` : ''}`,
        best.workloads?.total ? `${best.workloads.passed ?? 0} of ${best.workloads.total} workloads` : null,
        best.reached && best.of ? `stage ${best.reached} of ${best.of}` : null,
        best.at ? `${checked} at ${stamp(best.at, now)}` : checked,
      ].filter(Boolean).join(', ') + (release && release !== 'published' ? `. ${RELEASE_STATE[release] === 'not published' ? `Not published: ${notPublished(best.line)}` : (RELEASE_STATE[release] ?? release)}.` : '.'),
      href: best.runId ? `/run/${encodeURIComponent(best.runId)}` : undefined,
    })
  if (runs !== null) rows.push({ term: 'Runs', text: `${passed ?? 0} of ${runs} runs passed the current check.` })
  // The headline and figure are the host's view (views.play_view), the run page's words for the same release.
  const view = play.view
  const progress = view?.progress ?? null
  if (progress) rows.unshift({ term: 'Steps', text: progress.sentence, href: progress.runId ? `/run/${encodeURIComponent(progress.runId)}` : undefined })
  return {
    slot: 'did-it-work',
    label: 'Solved?',
    headline: view ? view.status.label : passed ? 'Solved' : best ? 'Not yet' : 'No check result yet',
    figure: progress ? { kind: 'num', value: String(progress.passed), unit: `/${progress.total} steps`, tip: progress.sentence } : workloadFigure(best),
    subline: progress ? `${progress.release ?? 'workspace'}${progress.runId ? ` of ${shortRun(play.id, progress.runId)}` : ''}` : best?.tag ? `${shortTag(best.tag)}${run ? ` of ${run}` : ''}, ${checked}` : 'no release checked yet',
    rows,
  }
}

/** The play's last ending as a status, with the newer-run rule a crash needs. */
function endingStatus(play: Play, now: number): Status | null {
  const ending = play.standing?.lastEnding ?? null
  if (!ending) return null
  if (ending.status) return viewChip(ending.status)
  // A crash needs a person for its first 24 h only while no newer run started; a play that does not list the run cannot tell.
  const listed = play.runs.find((run) => run.id === ending.runId)
  const newer = listed ? newerStarted({ id: ending.runId, play: listed.play, startedAt: ending.startedAt ?? listed.startedAt }, play.runs) : undefined
  return statusOf({ axis: 'run', state: ending.word, reason: ending.reason, endedAt: ending.at, newerStarted: newer, now })
}

function isItWorking(play: Play, now: number): Answer {
  const live = play.live ?? null
  const producing = standingAnswer(play).producing ?? null
  const n = producing?.numbers ?? {}
  const rows: DetailRow[] = []
  if (!live) {
    const ending = play.standing?.lastEnding ?? null
    const status = endingStatus(play, now)
    if (ending && status)
      rows.push({ term: 'Last run', text: `${ending.run ?? shortRun(play.id, ending.runId)}${ending.at ? `, ended ${stamp(ending.at, now)}` : ''}${ending.wallHours != null ? ` after ${hoursText(ending.wallHours)}` : ''}`, status, href: `/run/${encodeURIComponent(ending.runId)}` })
    if (ending?.reason) rows.push({ term: 'Why it ended', text: ending.reason.replaceAll('-', ' ') })
    return {
      slot: 'is-it-working',
      label: 'Producing?',
      headline: 'Nothing running',
      figure: { kind: 'num', value: '0', unit: 'runs live', tip: 'no run of this play is live' },
      subline: ending ? clampWords(`last run ${ending.run ?? shortRun(play.id, ending.runId)} ${status?.word.toLowerCase() ?? 'ended'}${ending.at ? ` ${stamp(ending.at, now)}` : ''}`, SUBLINE_WORDS) : 'no run recorded',
      rows,
    }
  }
  const run = live.run ?? shortRun(play.id, live.runId)
  const elapsed = live.elapsedMs ?? (live.startedAt ? now - ms(live.startedAt) : null)
  const liveHours = num(n.liveHours) ?? (elapsed !== null ? elapsed / 3_600_000 : null)
  const commits = num(n.codeCommits)
  const newestCommit = typeof n.newestCodeCommitAt === 'string' ? n.newestCodeCommitAt : null
  const lastPublished = (n.lastPublished ?? (play.standing as { lastPublished?: unknown } | null | undefined)?.lastPublished ?? null) as { tag?: string; run?: string; at?: string } | null
  const releasedSince = Boolean(lastPublished?.at && live.startedAt && ms(lastPublished.at) > ms(live.startedAt))
  const bins = (n.codeCommitsBy30Min as Output['codeCommitsBy30Min']) ?? null
  rows.push({ term: 'Live run', text: `${run}${live.startedAt ? `, started ${stamp(live.startedAt, now)}` : ''}`, status: statusOf({ axis: 'run', state: 'running', elapsedMs: elapsed ?? undefined }), href: `/run/${encodeURIComponent(live.runId)}` })
  if (producing?.text) rows.push({ term: 'Output', text: producing.text })
  if (lastPublished?.tag) rows.push({ term: 'Last published release', text: `${shortTag(lastPublished.tag)}${lastPublished.run ? ` of run ${lastPublished.run}` : ''}${lastPublished.at ? `, ${age(ms(lastPublished.at), now)} ago` : ''}` })
  const checkpoint = (live.killCheckpoints ?? []).find((item) => item.due) ?? live.killCheckpoints?.[0] ?? null
  if (checkpoint) {
    const measured = checkpoint.measured ?? null
    rows.push({
      term: `Next checkpoint · ${checkpoint.label}`,
      text: [checkpoint.clause ? clampWords(checkpoint.clause, 15) : null, checkpoint.at ? `due ${stamp(checkpoint.at, now)}` : null, `measured: ${measured ? 'yes' : 'not yet'}`].filter(Boolean).join(' · '),
    })
  }
  if (live.blocker && live.blocker.severity !== 'red') rows.push({ term: 'Holding it', text: blockerWords(live.blocker), status: statusOf({ axis: 'alert', severity: live.blocker.severity, live: true }) })
  const figure: Figure = bins?.length
    ? { kind: 'spark', points: cumulative(bins), label: `${commits ?? 0} commits`, tip: `${commits ?? 0} code commits; per 30 min: ${bins.map((bin) => bin.n).join(', ')}` }
    : commits !== null
      ? { kind: 'num', value: String(commits), unit: 'commits', tip: `${commits} code commits since ${live.startedAt ? hm(live.startedAt) : 'the run started'}` }
      : { kind: 'num', value: liveHours !== null ? liveHours.toFixed(1) : '?', unit: 'h running', tip: 'hours since the live run started' }
  return {
    slot: 'is-it-working',
    label: 'Producing?',
    headline: commits === null ? `${run} running` : commits === 0 ? 'Running, no code yet' : releasedSince ? 'Writing code and releasing' : 'Writing code, no release yet',
    figure,
    subline: [newestCommit ? `newest commit ${hm(newestCommit)}` : null, liveHours !== null ? `${hoursText(liveHours)} in` : null].filter(Boolean).join(' · ') || `${run} live`,
    rows,
  }
}

/** The report's inventory, or `play_head.built` when served: what the best release is made of. */
function whatWasBuilt(play: Play, report: PlayReportDocument | null | undefined, now: number): Answer {
  const built = ((play as { play_head?: { built?: Built | null } | null }).play_head?.built ?? report?.built ?? null) as Built | null
  const crates = Array.isArray(built?.crates?.value) ? (built!.crates!.value as string[]) : []
  if (!built || !crates.length) {
    // No inventory: point at what exists, the best release's code one click away, never "not reported" beside a run
    // that built it (re-audit 2026-10-24: 21c showed 2,236 files while this card read "Not reported yet · — crates").
    const best = play.view?.progress ?? null
    if (best?.runId && best.release)
      return {
        slot: 'what-was-built', label: 'Built', headline: 'Best release code',
        figure: { kind: 'num', value: best.release, unit: '', tip: 'the best release; the play report lists no build inventory' },
        subline: `run ${shortRun(play.id, best.runId)} · open its files`,
        rows: [{ term: 'Best release code', text: `${best.release} in run ${shortRun(play.id, best.runId)}`, href: `/run/${encodeURIComponent(best.runId)}` }],
      }
    return { slot: 'what-was-built', label: 'Built', headline: 'No release yet', figure: { kind: 'num', value: '—', unit: '', tip: 'no release has been scored' }, subline: 'no release has been scored', rows: [] }
  }
  const commands = (built.commands?.value ?? {}) as Record<string, unknown>
  const guests = num(built.guests?.value)
  const parts = [commands.prover ? 'prover' : null, commands.verifier ? 'verifier' : null, guests ? `${guests} guest programs` : null].filter(Boolean) as string[]
  const headline = parts.length ? parts.join(', ') : plural(crates.length, 'crate')
  const external = num(built.externalCrates?.value)
  const release = built.release ?? null
  const rows: DetailRow[] = [
    { term: `At ${release?.tag ?? 'the best release'}${release?.runId ? ` (run ${shortRun(play.id, release.runId)})` : ''}`, text: crates.join(', ') },
  ]
  if (Object.keys(commands).length) rows.push({ term: 'Commands', text: Object.keys(commands).join(' · ') })
  if (guests) rows.push({ term: 'Guest programs', text: String(guests) })
  if (built.docs?.length) rows.push({ term: 'Design docs', text: String(built.docs.length) })
  if (release?.builtAt) rows.push({ term: 'Read at', text: stamp(release.builtAt, now) })
  return {
    slot: 'what-was-built',
    label: 'Built',
    headline: headline.charAt(0).toUpperCase() + headline.slice(1),
    figure: { kind: 'num', value: String(crates.length), unit: 'crates', tip: `${crates.length} workspace crates${num(built.lockedPackages?.value) !== null ? `, ${built.lockedPackages!.value} locked packages` : ''}` },
    subline: [release?.tag ? `at ${release.tag}` : null, external === 0 ? 'no outside crates' : external !== null ? `${plural(external, 'outside crate')}` : null].filter(Boolean).join(', '),
    rows,
  }
}

const BLOCKER_WORD: Record<string, string> = { 'stuck-turn': 'Hung turn', 'check-infra': 'Check infrastructure', 'quota-wall': 'Quota wall', 'gate-undecided': 'Check unverified' }
export const blockerName = (blocker: { class: string }) => BLOCKER_WORD[blocker.class] ?? blocker.class.replaceAll('-', ' ')
/** Host prose in the page's words, with the release check named as such: "gate" belongs to "How the check works" only. */
export const plainWords = (text: string) => hostWords(text).replace(/\b(?:tag )?gate\b/gi, (match) => (match[0] === match[0]!.toUpperCase() ? 'Release check' : 'release check'))
const blockerWords = (blocker: PlayBlocker) => [blockerName(blocker), blocker.evidence ? plainWords(blocker.evidence) : null].filter(Boolean).join(': ')

/** An attention item's age: exact from its raise time, else a lower bound from the composition that first served it. */
export function itemAge(raisedAt: string | null | undefined, seenSince: string | null | undefined, now: number): string {
  if (raisedAt) return `${age(ms(raisedAt), now)} old`
  if (seenSince) return `seen since ${stamp(seenSince, now)} · at least ${age(ms(seenSince), now)} old`
  return 'age not recorded'
}

export interface NeedsItem {
  text: string
  status: Status
  /** Counts toward "needs you now" whatever its tone: an item of a play's view. */
  counted?: boolean
  age: string
  owner?: string | null
  next?: string | null
  href?: string
}

/** Needs you: act now is `tone == 'crit'` (or a live red blocker) only; every other item carries its state word and age. */
function needsAnswer(items: NeedsItem[], quiet: string, served = false): Answer {
  // A served list is every item that needs a person; a composed one counts only the red ones.
  const act = served ? items : items.filter((item) => item.status.tone === 'fail' || item.counted)
  const first = act[0]
  return {
    slot: 'needs-me',
    label: 'Needs you',
    headline: act.length ? `${act.length} need${act.length === 1 ? 's' : ''} you now` : 'Nothing needs you now',
    figure: { kind: 'num', value: String(act.length), unit: '', tip: `${act.length} of ${items.length} items need a person now` },
    subline: first ? clampWords(`${first.owner ?? 'Discovery operator'} · ${first.age}`, SUBLINE_WORDS) : quiet,
    rows: items.map((item) => ({ term: item.text, text: [item.owner ? `Owner: ${item.owner}` : null, item.next, item.age].filter(Boolean).join(' · '), status: item.status, pill: item.status.tone === 'fail' && !item.status.word.includes('act now:') ? `act now: ${item.owner ?? 'Discovery operator'}` : undefined, href: item.href })),
  }
}

function playNeeds(play: Play, now: number): Answer {
  // The host's list (views.play_view), the one the overview shows for this play.
  if (play.view)
    return needsAnswer(
      play.view.needsYou.map((item) => ({ text: item.text, status: statusOf({ axis: 'alert', tone: 'warn', live: false }), age: item.since ? `${age(ms(item.since), now)} old` : 'age not recorded', owner: item.owner ?? null, href: item.href ?? undefined })),
      'nothing recorded needs a person',
      true,
    )
  const items: NeedsItem[] = []
  const live = play.live ?? null
  if (live?.blocker) {
    const status = statusOf({ axis: 'alert', severity: live.blocker.severity, live: true })
    items.push({ text: blockerWords(live.blocker), status, age: live.blocker.since ? `${age(ms(live.blocker.since), now)} old` : 'age not recorded', owner: live.blocker.owner ?? null, href: `/run/${encodeURIComponent(live.runId)}` })
  }
  const ending = play.standing?.lastEnding ?? null
  const ended = endingStatus(play, now)
  if (ending && ended?.tone === 'fail') items.push({ text: `${ending.run ?? shortRun(play.id, ending.runId)} ${ended.word}`, status: ended, age: ending.at ? `${age(ms(ending.at), now)} old` : 'age not recorded', owner: 'Discovery operator', href: `/run/${encodeURIComponent(ending.runId)}` })
  if (ending?.blocker) items.push({ text: blockerWords(ending.blocker), status: statusOf({ axis: 'alert', severity: ending.blocker.severity, live: false }), age: ending.blocker.since ? `${age(ms(ending.blocker.since), now)} old` : 'age not recorded', owner: ending.blocker.owner ?? null, href: `/run/${encodeURIComponent(ending.runId)}` })
  const quiet = ending?.blocker ? clampWords(`${blockerName(ending.blocker).toLowerCase()} on ${ending.run ?? shortRun(play.id, ending.runId)} is past`, SUBLINE_WORDS) : live ? `no blocker on ${live.run ?? shortRun(play.id, live.runId)}` : 'no blocker recorded'
  return needsAnswer(items, quiet)
}

/** The four answers a play page opens with: Solved?, Producing?, Built, Needs you. */
export function playAnswers(play: Play, report: PlayReportDocument | null | undefined, now = Date.now()): Answer[] {
  return [didItWork(play, now), isItWorking(play, now), whatWasBuilt(play, report, now), playNeeds(play, now)]
}

/** The play page's one as-of: the newest time its answers record. */
export function playAsOf(play: Play): AsOf | null {
  if (play.view) return viewAsOf(play.view)
  const answer = standingAnswer(play)
  const at = newest(answer.solved?.asOf, answer.producing?.asOf, answer.measurement?.asOf, play.standing?.bestCurrent?.at, play.standing?.lastEnding?.at, play.live?.startedAt, ...play.runs.map((run) => run.startedAt))
  return at ? { at, meaning: 'the newest time this play’s answers record', source: answer.producing?.source ?? answer.solved?.source ?? 'the play document' } : null
}

/** The current check's version line, for "How the check works": `Check v4 since 10-18 20:52Z (operator); 4 versions`. */
export function checkVersionLine(play: Play, now: number): string | null {
  const current = play.checkers?.find((item) => item.current) ?? null
  if (!current) return null
  const since = current.ruling?.at ?? current.firstAt ?? null
  return `Check ${current.label}${since ? ` since ${stamp(since, now)}` : ''}${current.ruling?.by ? ` (${current.ruling.by})` : ''}; ${plural(play.checkers!.length, 'version')}`
}

/** The measurement noise line: `rulers[].rerunSpread` when served, else `standing.answer.measurement`; null omits it. */
export function measurementLine(play: Play): string | null {
  const rulers = (play as { rulers?: { current?: boolean; rerunSpread?: { min?: number; max?: number; of?: number; undecided?: number; capS?: number; owner?: string } | null }[] | null }).rulers ?? null
  const spread = rulers?.find((ruler) => ruler.current)?.rerunSpread ?? rulers?.find((ruler) => ruler.rerunSpread)?.rerunSpread ?? null
  if (spread && spread.min != null && spread.max != null)
    return `check spread ${spread.min}–${spread.max} of ${spread.of ?? 15} on one commit${spread.undecided ? ` · ${spread.undecided} undecided at the ${spread.capS ?? 300} s prover cap` : ''}${spread.owner ? ` · owner ${spread.owner}` : ''}`
  return standingAnswer(play).measurement?.text ?? null
}

/** A bar metric's ratio to the bar in words: `Proving rate 0.2 M of 7.2–8.7 M cycles/s · 36× short`. Null when unmeasured. */
export function barRatioLine(metric: NonNullable<Play['bar']>['metrics'][number]): string | null {
  const shown = metric.best ?? metric.nearest ?? null
  if (!shown) return null
  const t = metric.target ?? null
  const low = t?.min ?? t?.approx ?? t?.max ?? null
  const high = t?.max ?? t?.approx ?? t?.min ?? null
  const target = low === null ? null : low === high ? `≈${metricValue(low, metric.unit)}` : `${metricValue(low, metric.unit)}–${metricValue(high!, metric.unit)}`
  const head = `${metric.label} ${metricValue(shown.value, metric.unit)}${target ? ` of ${target}` : ''}`
  // A value that does not count never gets a ratio to the bar: it says why instead.
  if (!metric.best) return `${head} · ${shown.short ?? shown.why ?? 'not comparable'}`
  if (low === null || high === null) return head
  const value = shown.value
  const better = metric.direction === 'down' ? value <= high : value >= low
  if (value >= low && value <= high) return `${head} · within the bar`
  const ratio = value < low ? low / value : value / high
  const times = ratio >= 10 ? Math.round(ratio).toString() : ratio.toFixed(1)
  return `${head} · ${times}× ${better ? 'past' : metric.direction === 'down' ? 'over' : 'short'}`
}

// ----- the overview -----

/** The overview's four answers: Needs you, Running now, Clean runs, This week. */
export function overviewAnswers(doc: OverviewDocument, reliability: { rate?: number | null; settled?: number | null; clean?: number | null; day?: string | null } | null, now = Date.now()): Answer[] {
  const attention = doc.attention ?? []
  const running = doc.now ?? []
  const week = doc.week ?? []
  const seen = doc.composedAt
  const items = attention.map((item) => attentionItem(item, seen, now))
  const cleared = items.find((item) => item.status.word === 'cleared')
  const runningAt = doc.runningAt ?? doc.composedAt
  const passed = week.filter((play) => play.lead?.kind === 'check').length
  const first = running[0]
  const rate = reliability?.rate ?? null
  return [
    needsAnswer(items, cleared ? clampWords(`${cleared.text} cleared`, SUBLINE_WORDS - 4) : `${attention.length} items, none urgent`),
    {
      slot: 'is-it-working',
      label: 'Running now',
      headline: running.length ? `${plural(running.length, 'run')} running` : 'Nothing running',
      figure: { kind: 'num', value: String(running.length), unit: 'live', tip: `${running.length} running, ${doc.state.queued} queued, read ${hm(runningAt)}` },
      subline: first ? clampWords(`${first.title} · started ${first.startedAt ? stamp(first.startedAt, now) : 'at an unrecorded time'}`, SUBLINE_WORDS) : `${doc.state.queued} queued`,
      rows: running.map((run) => ({ term: run.title, text: `started ${run.startedAt ? stamp(run.startedAt, now) : 'unrecorded'}${run.activeAt ? ` · active ${stamp(run.activeAt, now)}` : ''}${run.agents !== null ? ` · ${plural(run.agents, 'agent')}` : ''}`, href: `/run/${encodeURIComponent(run.runId)}`, status: statusOf({ axis: 'run', state: 'running' }) })),
    },
    {
      slot: 'is-discovery-reliable',
      label: 'Clean runs',
      headline: rate === null ? 'Not measured yet' : rate >= CLEAN_RUN_TARGET ? 'At target' : 'Below target',
      figure: { kind: 'num', value: rate === null ? '?' : String(Math.round(rate * 100)), unit: '%', tip: rate === null ? 'reliability not served' : `${reliability?.clean ?? '?'} of ${reliability?.settled ?? '?'} settled runs clean; target ${Math.round(CLEAN_RUN_TARGET * 100)}%` },
      subline: rate === null ? 'reliability is not served' : `${reliability?.clean ?? '?'} of ${reliability?.settled ?? '?'} settled runs clean`,
      rows: [{ term: 'Run reliability', text: 'Settled runs that no infrastructure, platform or quota failure ended.', href: '/plays' }],
    },
    {
      slot: 'did-it-work',
      label: 'This week',
      headline: week.length ? `${passed} of ${week.length} plays passed` : 'No plays ran',
      figure: { kind: 'num', value: String(passed), unit: `/${week.length}`, tip: `${passed} of ${week.length} plays passed their check in ${doc.weekDays ?? 7} days` },
      subline: `${week.length - passed} without a passing check`,
      rows: week.map((play) => ({ term: play.title, text: play.lead?.kind === 'check' ? 'check passed' : `${play.runCount} runs, no passing check`, href: `/play/${encodeURIComponent(play.play)}` })),
    },
  ]
}

const ALERT_STATE: Record<string, string> = { crit: 'act now', warn: 'not urgent', info: 'cleared', neutral: 'past' }
/** An overview item's pill: a play view's item reads "needs you" (it is counted), any other its tone's word. */
export function attentionStatus(item: OverviewAttention): Status {
  const base = statusOf({ axis: 'alert', tone: item.tone, live: true })
  if (item.needsYou && base.tone !== 'fail') return { ...base, word: 'needs you', tone: 'attention', shape: ENDING_GLYPH.attention }
  return base.tone === 'fail' ? base : { ...base, word: ALERT_STATE[item.tone] ?? base.word }
}
function attentionItem(item: OverviewAttention, seen: string, now: number): NeedsItem {
  const status = attentionStatus(item)
  const raisedAt = (item as { raisedAt?: string | null }).raisedAt ?? null
  // A play view's item (views.play_view) needs a person whatever its tone: the play page counts the same list.
  const counted = item.needsYou === true
  return { text: item.text, status, counted, age: itemAge(raisedAt, (item as { seenSince?: string | null }).seenSince ?? seen, now), owner: item.owner ?? null, next: item.next ?? null, href: item.href }
}
