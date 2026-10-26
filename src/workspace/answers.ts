import { viewAsOf } from './view.js'
import type { OverviewAttention, OverviewDocument, PlayDocument } from '../workspace-model.js'
import { type Status, statusOf } from './data.js'
import { ENDING_GLYPH, hostWords, type PlayHead } from './play-standing.js'

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

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
/** Commits per 30 minutes as a cumulative step series, for the charts Spark. */
export function cumulative(bins: { at: string; n: number }[]): [number, number][] {
  let total = 0
  return [[0, 0], ...bins.map((bin, i): [number, number] => [i + 1, (total += bin.n)])]
}

// ----- the play -----

const BLOCKER_WORD: Record<string, string> = { 'stuck-turn': 'Hung turn', 'check-infra': 'Check infrastructure', 'quota-wall': 'Quota wall', 'gate-undecided': 'Check unverified' }
export const blockerName = (blocker: { class: string }) => BLOCKER_WORD[blocker.class] ?? blocker.class.replaceAll('-', ' ')
/** Host prose in the page's words, with the release check named as such: "gate" belongs to "How the check works" only. */
export const plainWords = (text: string) => hostWords(text).replace(/\b(?:tag )?gate\b/gi, (match) => (match[0] === match[0]!.toUpperCase() ? 'Release check' : 'release check'))
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

/** The play page's one as-of: the newest time its answers record. */
export const playAsOf = (play: Play): AsOf | null => (play.view ? viewAsOf(play.view) : null)

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
