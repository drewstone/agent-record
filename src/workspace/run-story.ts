/**
 * The run page's five answers, computed from the run document the host composes (`story`, `lineage`, `progress`, `spend`)
 * and the record's node list. Every function here is pure: the page draws what they return, and the tests pin each rule.
 *
 * 1. Is it working and on track?        `clockView`, `riskOf`
 * 2. How good is the best version?      `bestOf`, `stall`
 * 3. What is still missing?             `missingChecks`
 * 4. What has it cost?                  `costView`
 * 5. Where is the product?              `stripMachineKeys`, `readerTest`
 *
 * Plus the team (`teamCards`), the lineage (`lineageSegments`), profile changes (`roleHistory`) and what the record could not
 * measure (`dataQuality`), said once instead of as "unknown" on every row.
 */

export type Vector = { exact: [number, number] | null; heldOut: [number, number] | null; blockers: number | null; judge: number | null }
/** One check of a tag: id, tier, pass (null when its evaluator errored: not measured), value. */
export type Result = [string, string | null, boolean | null, number | null]
export interface StoryTag {
  name: string
  commit: string | null
  at: string | null
  scoredAt: string | null
  by: string | null
  best: boolean
  run: string
  complete: boolean | null
  vector: Vector | null
  flags: string[]
  results: Result[]
}
export interface Releases {
  rule: string | null
  best: string | null
  tags: StoryTag[]
  /** Each check's evidence for the best tag and the newest scored one. */
  evidence: Record<string, Record<string, string | null>>
}
export interface Clock {
  deadlineAt: string | null
  spanMs: number | null
  basis: string | null
  inheritedFrom: string | null
}
export interface ReceiptFile {
  file: string
  label: string
  bytes: number | null
  href: string
}
export interface Receipt {
  tag: string
  status: string | null
  commit: string | null
  taggedAt: string | null
  href: string
  files: ReceiptFile[]
  summary: { heading: string | null; markdown: string | null; source: string | null } | null
  deliverables: { id: string; present: boolean | null }[]
}
export interface ProfileChange {
  commit: string
  at: string | null
  role: string
  path: string
  digest: string | null
  parentDigest: string | null
  parentNode: string | null
  status: string | null
  reason: string | null
  run: string
}
export interface Meter {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  tokensKnown: boolean
  agents?: number
  turns: number
  usd: number | null
  at: string | null
}
export interface Segment {
  runId: string
  state: string
  startedAt: string | null
  settledAt: string | null
  from: string | null
  forkedAt: string | null
  sourceCommit: string | null
  meter: Meter | null
  series: [string, number][]
  apiEquivalentUsd: { usd: number | null; provenance: string | null } | null
  billedUsd: { usd: number | null; provenance: string | null } | null
}
export interface Story {
  clock: Clock | null
  series: [string, number][]
  releases: Releases | null
  receipt: Receipt | null
  profiles: ProfileChange[]
}

const HOUR = 3_600_000
export const t = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN)
export const hoursText = (ms: number) =>
  ms >= 48 * HOUR ? `${(ms / 24 / HOUR).toFixed(1)} days` : ms >= HOUR ? `${(ms / HOUR).toFixed(1)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`
export const agoText = (ms: number) => (ms < 90_000 ? 'just now' : `${hoursText(ms)} ago`)
const isoOf = (value: string | null | undefined) => {
  const time = t(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
export const utcClock = (value: string | null | undefined) => {
  const iso = isoOf(value)
  return iso ? `${iso.slice(11, 16)} UTC` : ''
}
export const utcDay = (value: string | null | undefined) => {
  const iso = isoOf(value)
  return iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC` : ''
}
export const tokensText = (value: number) =>
  value >= 1e9 ? `${(value / 1e9).toFixed(1)} B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)} M` : value >= 1e3 ? `${Math.round(value / 1e3)} K` : String(Math.round(value))
export const meterTotal = (meter: Pick<Meter, 'tokens'> | null | undefined) =>
  meter ? meter.tokens.input + meter.tokens.output + meter.tokens.cacheRead + meter.tokens.cacheWrite : null

/** The run's short name in a lineage: `terraform-dc-tokens-20261008f-c1` → `f-c1`; a run id without a date stays whole. */
export function runLabel(runId: string, play?: string) {
  const own = play && runId.startsWith(`${play}-`) ? runId.slice(play.length + 1) : runId
  const dated = /^\d{8}(.+)$/.exec(own)
  return dated ? dated[1]! : own
}

/** The goal in one sentence: the objective up to its first sentence end (or colon), never cut mid-word. */
export function goalSentence(text: string | null | undefined, limit = 220) {
  if (!text) return null
  const clean = text.replace(/\s+/g, ' ').trim().replace(/…$/, '')
  const end = clean.search(/[.:;](\s|$)/)
  const first = end > 0 ? clean.slice(0, end + 1) : clean
  if (first.length <= limit) return first.replace(/[:;]$/, '.')
  const cut = first.slice(0, limit)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

// ------------------------------------------------------------------------------------------------- 1. on track

export interface ClockView {
  elapsedMs: number
  leftMs: number | null
  spanMs: number | null
  /** Share of the deadline window used, 0-1; null without a deadline. */
  used: number | null
  deadlineAt: string | null
}

/** Time used and left. The window is the deadline's span (a fork inherits its source's deadline, so its window began
 * before the fork), else the run's own start to its deadline. A settled run's clock stops at its settle (or, without a
 * settle time, at its recorded duration); only a running run's clock reads `now`. */
export function clockView(clock: Clock | null, startedAt: string | null, settledAt: string | null, now: number, running = !settledAt, durationMs: number | null = null): ClockView {
  const start = t(startedAt)
  const end = running ? now : settledAt ? t(settledAt) : Number.isFinite(start) && durationMs !== null ? start + durationMs : Number.NaN
  const elapsedMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : (durationMs ?? 0)
  const deadline = t(clock?.deadlineAt)
  if (!Number.isFinite(deadline)) return { elapsedMs, leftMs: null, spanMs: null, used: null, deadlineAt: null }
  const span = clock?.spanMs ?? (Number.isFinite(start) ? deadline - start : null)
  const windowStart = span ? deadline - span : start
  const leftMs = running ? Math.max(0, deadline - now) : 0
  const used = span && Number.isFinite(end) ? Math.min(1, Math.max(0, (end - windowStart) / span)) : null
  return { elapsedMs, leftMs, spanMs: span, used, deadlineAt: clock!.deadlineAt }
}

// ------------------------------------------------------------------------------------------------- 2. best version

/** The tags that were scored, in tag order. */
export const scoredTags = (releases: Releases | null) => (releases?.tags ?? []).filter((tag) => tag.vector !== null)

/** The best tag by the registered rule (the Lab marks it), else the newest scored. */
export function bestOf(releases: Releases | null): StoryTag | null {
  const scored = scoredTags(releases)
  return scored.find((tag) => tag.best) ?? releases?.tags.find((tag) => tag.best) ?? scored.at(-1) ?? null
}

/** A tag's score in words: `8 of 18 must-pass checks · 2 of 6 held-out · judge 71`. */
export function scoreWords(vector: Vector | null) {
  if (!vector) return 'not scored'
  return [
    vector.exact ? `${vector.exact[0]} of ${vector.exact[1]} must-pass checks` : null,
    vector.heldOut ? `${vector.heldOut[0]} of ${vector.heldOut[1]} held-out` : null,
    vector.judge !== null ? `judge ${Math.round(vector.judge)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const rank = (vector: Vector | null) => [vector?.exact?.[0] ?? -1, vector?.heldOut?.[0] ?? -1, -(vector?.blockers ?? 99), vector?.judge ?? -1]
function better(a: Vector | null, b: Vector | null) {
  const x = rank(a)
  const y = rank(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! > y[i]!
  return false
}

export interface Stall {
  /** The tag that first reached the best score. */
  since: StoryTag
  ms: number
  /** Versions tagged after it, none better. */
  after: number
  /** Tokens used since it, from Runtime's meter across the lineage; null when nothing was metered. */
  tokens: number | null
}

/** Since when the run has not improved: the first tag whose score equals the best, the time since, and the usage since.
 * Null while the newest scored version is the best's first appearance and less than an hour old. */
export function stall(releases: Releases | null, usage: [number, number][], now: number): Stall | null {
  const scored = scoredTags(releases)
  const best = bestOf(releases)
  if (!best || !scored.length) return null
  // The first tag that reached the best tag's score (a later equal tag is no improvement).
  let since = best
  for (const tag of scored) {
    if (!better(best.vector, tag.vector) && !better(tag.vector, best.vector)) {
      since = tag
      break
    }
  }
  const at = t(since.at)
  if (!Number.isFinite(at)) return null
  const ms = now - at
  const after = scored.filter((tag) => t(tag.at) > at).length
  if (ms < HOUR && after === 0) return null
  const before = cumulativeAt(usage, at)
  const latest = usage.at(-1)?.[1] ?? null
  return { since, ms, after, tokens: latest !== null && before !== null ? Math.max(0, latest - before) : null }
}

/** The cumulative usage at time `at` (the last point at or before it), 0 before the first point, null with no points. */
export function cumulativeAt(points: [number, number][], at: number) {
  if (!points.length) return null
  let value = 0
  for (const [time, total] of points) {
    if (time > at) break
    value = total
  }
  return value
}

/** The lineage's cumulative usage over time as one series: every run's metered turns together, since runs of a lineage
 * overlap (a fork starts while its source still runs). */
export function lineageUsage(segments: Segment[], own: [string, number][]): [number, number][] {
  const runs = segments.length ? segments.map((segment) => segment.series) : [own]
  const turns: [number, number][] = []
  for (const series of runs) {
    let before = 0
    for (const [at, total] of series) {
      const time = t(at)
      if (Number.isFinite(time)) turns.push([time, total - before])
      before = total
    }
  }
  turns.sort((a, b) => a[0] - b[0])
  let sum = 0
  return turns.map(([time, used]) => [time, (sum += used)])
}

export type Risk = { level: 'on-track' | 'at-risk' | 'ended'; reason: string }

/** On track or at risk, with the one reason a reader acts on. A run that has not improved for STALL_RISK of its window (or
 * two hours without a window) is at risk; so is one with less time left than it has gone without improving. */
export function riskOf(state: string, clock: ClockView, best: StoryTag | null, stalled: Stall | null, stop?: string | null): Risk {
  if (state !== 'running') return { level: 'ended', reason: stop ?? `ended ${state.replaceAll('-', ' ')}` }
  if (!best) return { level: 'on-track', reason: 'no version scored yet' }
  if (stalled) {
    const limit = clock.spanMs ? clock.spanMs * STALL_RISK : 2 * HOUR
    if (stalled.ms >= limit || (clock.leftMs !== null && clock.leftMs < stalled.ms))
      return { level: 'at-risk', reason: `no better version in ${hoursText(stalled.ms)} (since ${stalled.since.name})` }
  }
  return { level: 'on-track', reason: stalled ? `best is ${stalled.since.name}, ${hoursText(stalled.ms)} ago` : `improving: ${best.name} is the newest best` }
}
export const STALL_RISK = 0.25

// ------------------------------------------------------------------------------------------------- 3. what's left

const TIER_WORD: Record<string, string> = { exact: 'must-pass', heldOut: 'held-out', referee: 'referee', judge: 'judge' }
export const tierWord = (tier: string | null) => (tier ? (TIER_WORD[tier] ?? tier) : 'check')

/** A check id as words: `plan-gantt-30-60-90` → `Plan gantt 30 60 90`, `dispatch-lp-8760` → `Dispatch LP 8760`. */
export function checkWords(id: string) {
  const words = id.split(/[-_]+/).filter(Boolean).map((word) => (/^(lp|llm|irr|npv|dscr|ui|api|pdf|csv)$/i.test(word) ? word.toUpperCase() : word))
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** An agent's words as a reader sees them: digests and machine keys removed. */
export function plainWords(text: string | null | undefined) {
  if (!text) return null
  return text
    .replace(/,?\s*sha256[:\s-]*[0-9a-f]{8,64}/gi, '')
    .replace(/[0-9a-f]{16,}/g, '')
    .replace(/\[H:[^\]]*\]/g, '')
    .replace(/\s+([,;:.)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Evidence as a reader sees it: no hashes, no machine keys, no paths beyond their file name. */
export function cleanEvidence(text: string | null | undefined, limit = 240) {
  if (!text) return null
  const clean = text
    .replace(/,?\s*sha256[:\s]*[0-9a-f]{8,64}/gi, '')
    .replace(/\b[0-9a-f]{12,64}\b/g, '')
    .replace(/[0-9a-f]{16,}/g, '')
    .replace(/\[H:[^\]]*\]/g, '')
    .replace(/(?:[\w.-]+\/)+([\w.-]+)/g, '$1')
    .replace(/\s+([,;:)])/g, '$1')
    .replace(/,\s*([,:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean
}

export interface MissingCheck {
  id: string
  title: string
  tier: string | null
  evidence: string | null
  /** pass/fail per scored tag, oldest first; null where the tag did not run the check. */
  track: { tag: string; pass: boolean | null }[]
  /** `never passed`, `failing since rc16 (passed at rc15)`, ... */
  movement: string
  regressed: boolean
}

/** Every check the best tag fails, must-pass first, each with its record across the scored tags. */
export function missingChecks(releases: Releases | null): MissingCheck[] {
  const best = bestOf(releases)
  if (!best || !releases) return []
  const scored = scoredTags(releases)
  const evidence = releases.evidence[best.name] ?? {}
  const order = ['exact', 'heldOut', 'referee', 'judge']
  return best.results
    .filter(([, , pass]) => pass === false)
    .map(([id, tier]) => {
      const track = scored.map((tag) => {
        const found = tag.results.find(([check]) => check === id)
        return { tag: tag.name, pass: found ? found[2] : null }
      })
      const ran = track.filter((row) => row.pass !== null)
      const lastPass = [...ran].reverse().find((row) => row.pass)
      let movement = 'never passed'
      let regressed = false
      if (lastPass) {
        const after = ran.slice(ran.indexOf(lastPass) + 1)
        regressed = true
        movement = `passed at ${lastPass.tag}, failing since ${after[0]?.tag ?? best.name}`
      } else if (ran.length) movement = `never passed in ${ran.length} version${ran.length === 1 ? '' : 's'}`
      return { id, title: checkWords(id), tier, evidence: cleanEvidence(evidence[id]), track, movement, regressed }
    })
    .sort((a, b) => order.indexOf(a.tier ?? '') - order.indexOf(b.tier ?? '') || Number(b.regressed) - Number(a.regressed))
}

/** The reader test of a tag, when its evaluator set has one: its score against the bar the evidence states. */
export function readerTest(releases: Releases | null, tag: StoryTag | null) {
  const found = tag?.results.find(([id]) => id === 'reader-test')
  if (!found || !tag) return null
  const evidence = releases?.evidence[tag.name]?.['reader-test'] ?? null
  const bar = evidence ? /score\s*≥\s*([0-9.]+)/.exec(evidence)?.[1] : undefined
  return { score: found[3], pass: found[2], bar: bar ? Number(bar) : null }
}

// ------------------------------------------------------------------------------------------------- 4. cost

export interface CostView {
  /** Tokens Runtime metered for this run's agents. */
  tokens: number | null
  /** At least this many: some turns were metered without counts. */
  tokensFloor: boolean
  /** API-equivalent dollars: every token at list price, whoever paid. */
  apiUsd: number | null
  apiBasis: string | null
  /** What the company paid: model (Router) plus compute (Sandbox). */
  billedUsd: number | null
  billedNote: string | null
  /** Why API-equivalent dollars are missing, when they are. */
  apiMissing: string | null
}

/** The run's two cost figures (discovery-lab #1437): API-equivalent and billed, each with what is known about it. A $0
 * that Runtime could not price is no figure, so the tokens it metered are shown instead. */
export function costView(input: {
  meter: Meter | null
  listUsd: number | null
  listKnown: boolean | undefined
  basis: string | null | undefined
  gaps: { code: string; detail: string }[]
  readoutApi: { usd: number | null; provenance: string | null } | null
  readoutBilled: { usd: number | null; provenance: string | null } | null
  sandboxUsd: number | null
  apiUsd: number | null
  models: string[]
}): CostView {
  const tokens = meterTotal(input.meter)
  const unpriced = input.gaps.find((gap) => gap.code === 'price-unknown')
  const readoutApi = input.readoutApi && input.readoutApi.usd !== null && input.readoutApi.provenance !== 'unknown-floor' ? input.readoutApi : null
  const apiUsd = readoutApi?.usd ?? (input.listUsd !== null && !(input.listUsd === 0 && unpriced) ? input.listUsd : null)
  const billedUsd = input.readoutBilled?.usd ?? (input.sandboxUsd !== null && input.apiUsd !== null ? input.sandboxUsd + input.apiUsd : null)
  return {
    tokens,
    tokensFloor: input.meter ? !input.meter.tokensKnown : false,
    apiUsd,
    apiBasis: readoutApi?.provenance ?? (apiUsd !== null ? (input.listKnown === false ? 'partial' : (input.basis ?? null)) : null),
    billedUsd,
    billedNote: billedUsd === null ? 'not reconciled yet' : (input.readoutBilled?.provenance ?? null),
    apiMissing:
      apiUsd !== null ? null : unpriced || tokens ? `No API list price for ${input.models.join(', ') || 'its model'} yet` : 'Nothing metered yet',
  }
}

// ------------------------------------------------------------------------------------------------- 5. the product

/** The receipt's quoted summary for a reader: the model's `[H:key]` markers and stray reference keys removed. */
export function stripMachineKeys(markdown: string | null | undefined) {
  if (!markdown) return ''
  return markdown
    .replace(/\s*\[H:[^\]]+\]/g, '')
    .replace(/\s*\[(?:src|S|ref):[^\]]+\]/g, '')
    .replace(/ +([.,;:)])/g, '$1')
}

/** The receipt files a reader opens first: the report, the deck, the workbook, then the rest. */
export function productFiles(files: ReceiptFile[]) {
  const kind = (file: ReceiptFile) => {
    const name = `${file.file} ${file.label}`.toLowerCase()
    if (/deck|slides|\.pptx/.test(name)) return 'Deck'
    if (/\.xlsx|workbook/.test(name)) return 'Workbook'
    if (/report/.test(name) && /\.html/.test(name)) return 'Report'
    if (/report/.test(name)) return 'Report (Markdown)'
    if (/\.zip|code/.test(name)) return 'Model code'
    return file.label
  }
  const order = ['Report', 'Deck', 'Workbook', 'Report (Markdown)', 'Model code']
  const seen = new Set<string>()
  return files
    .map((file) => ({ ...file, kind: kind(file) }))
    .sort((a, b) => (order.indexOf(a.kind) + 1 || 99) - (order.indexOf(b.kind) + 1 || 99))
    .map((file) => {
      // A second workbook keeps its own file name.
      const label = seen.has(file.kind) ? file.label.replace(/^XLSX\s+/i, '') : file.kind
      seen.add(file.kind)
      return { ...file, kind: label }
    })
}

// ------------------------------------------------------------------------------------------------- team

export interface TeamInput {
  id: string
  label: string
  role: string | null
  parent: string | null
  model: string | null
  harness: string | null
  status: string | null
  start: string | null
  end: string | null
  /** From the progress document: Runtime's view of a live agent. */
  liveStatus: string | null
  lastActiveAt: string | null
  calls: number | null
  lastText: string | null
  lastTextAt: string | null
  meter: Meter | null
  recordTokens: number | null
  usd: number | null
  usdEstimated: boolean
}
export interface TeamCard {
  id: string
  title: string
  short: string
  model: string | null
  state: 'working' | 'finished' | 'failed' | 'stopped' | 'ended'
  /** `working · 47 min · 23 tool calls · active 2 min ago` */
  line: string
  tokens: number | null
  usd: number | null
  usdEstimated: boolean
  lastText: string | null
  depth: number
}

const FAILED = /^(down|failed|error|driver-failed)$/i
const STOPPED = /^(cancelled|canceled|stopped|abandoned)$/i

/** One card per agent: what it is, whether it works now, for how long, how much it did and used, and its latest words. */
export function teamCards(agents: TeamInput[], live: boolean, now: number): TeamCard[] {
  const depthOf = new Map<string, number>()
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const depth = (id: string, guard = 0): number => {
    if (depthOf.has(id)) return depthOf.get(id)!
    const parent = byId.get(id)?.parent
    const value = parent && byId.has(parent) && guard < 50 ? depth(parent, guard + 1) + 1 : 0
    depthOf.set(id, value)
    return value
  }
  return agents.map((agent) => {
    const status = agent.status ?? (live ? agent.liveStatus : null)
    const state: TeamCard['state'] =
      status && FAILED.test(status) ? 'failed' : status && STOPPED.test(status) ? 'stopped' : status && /^(done|winner|no-winner|complete)$/i.test(status) ? 'finished' : live && (!status || /running|active|pending|spawned/i.test(status)) ? 'working' : status ? 'finished' : 'ended'
    const start = t(agent.start)
    const end = state === 'working' ? now : t(agent.end ?? agent.lastActiveAt ?? agent.lastTextAt)
    const span = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null
    const active = Math.max(t(agent.lastActiveAt) || 0, t(agent.lastTextAt) || 0)
    const parts = [
      state === 'working' ? 'working' : state === 'ended' ? 'ended' : state,
      span !== null ? hoursText(span) : null,
      agent.calls ? `${agent.calls} tool call${agent.calls === 1 ? '' : 's'}` : null,
      state === 'working' && active ? `active ${agoText(now - active)}` : state !== 'working' && Number.isFinite(t(agent.end)) ? `ended ${utcClock(agent.end)}` : null,
    ].filter(Boolean)
    const title = agent.role && !/^(agent|worker|root)$/i.test(agent.role) ? agent.role : agent.label
    return {
      id: agent.id,
      title: title.replace(/^Run [a-z0-9-]+ (integration )?/i, '').replace(/^./, (c) => c.toUpperCase()),
      short: agent.label.split(' · ')[0] ?? agent.label,
      model: agent.model,
      state,
      line: parts.join(' · '),
      // A meter whose turns carried no counts measured nothing: no tokens, not zero.
      tokens: agent.recordTokens ?? (agent.meter && (agent.meter.tokensKnown || meterTotal(agent.meter)) ? meterTotal(agent.meter) : null),
      usd: agent.usd,
      usdEstimated: agent.usdEstimated,
      lastText: plainWords(agent.lastText),
      depth: depth(agent.id),
    }
  })
}

const STATE_ORDER: Record<TeamCard['state'], number> = { working: 0, failed: 1, stopped: 2, finished: 3, ended: 4 }
export const byState = (cards: TeamCard[]) => [...cards].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.depth - b.depth)

// ------------------------------------------------------------------------------------------------- lineage

export interface SegmentView {
  runId: string
  label: string
  state: string
  current: boolean
  startedAt: string | null
  forkedAt: string | null
  /** Tags this run made, and the best score any of them reached. */
  tags: string[]
  bestTag: StoryTag | null
  improved: boolean
  tokens: number | null
  apiUsd: number | null
  billedUsd: number | null
}

/** Each run of the lineage with what it contributed: the versions it tagged, whether it beat the score it inherited,
 * the tokens its agents used and its cost. */
export function lineageSegments(segments: Segment[], releases: Releases | null, current: string, play?: string): SegmentView[] {
  let inherited: Vector | null = null
  return segments.map((segment) => {
    const tags = (releases?.tags ?? []).filter((tag) => tag.run === segment.runId)
    const scored = tags.filter((tag) => tag.vector)
    const top = scored.reduce<StoryTag | null>((acc, tag) => (acc === null || better(tag.vector, acc.vector) ? tag : acc), null)
    const improved = !!top && (inherited === null || better(top.vector, inherited))
    if (top && (inherited === null || better(top.vector, inherited))) inherited = top.vector
    return {
      runId: segment.runId,
      label: runLabel(segment.runId, play),
      state: segment.state,
      current: segment.runId === current,
      startedAt: segment.startedAt,
      forkedAt: segment.forkedAt,
      tags: tags.map((tag) => tag.name),
      bestTag: top,
      improved,
      // A meter whose turns carried no counts measured nothing.
      tokens: segment.meter && (segment.meter.tokensKnown || meterTotal(segment.meter)) ? meterTotal(segment.meter) : null,
      apiUsd: segment.apiEquivalentUsd?.usd ?? null,
      billedUsd: segment.billedUsd?.usd ?? null,
    }
  })
}

// ------------------------------------------------------------------------------------------------- profile changes

export interface RoleVersion extends ProfileChange {
  /** The next scored version after this change, and the one before it: the change's measured neighbourhood. */
  next: StoryTag | null
  previous: StoryTag | null
}

/** Each role's profile versions across the lineage, newest role change first, each with the score before and after. */
export function roleHistory(changes: ProfileChange[], releases: Releases | null): { role: string; versions: RoleVersion[] }[] {
  const scored = scoredTags(releases)
  const roles = new Map<string, RoleVersion[]>()
  for (const change of changes) {
    const at = t(change.at)
    const next = scored.find((tag) => t(tag.at) >= at) ?? null
    const previous = [...scored].reverse().find((tag) => t(tag.at) < at) ?? null
    roles.set(change.role, [...(roles.get(change.role) ?? []), { ...change, next, previous }])
  }
  return [...roles.entries()]
    .map(([role, versions]) => ({ role, versions }))
    .sort((a, b) => (t(b.versions.at(-1)?.at) || 0) - (t(a.versions.at(-1)?.at) || 0))
}

/** What a profile change did to the score: `next version rc17: 7 of 18 must-pass (was 7, rc16)`. */
export function effectWords(version: RoleVersion) {
  if (!version.next) return 'no version scored after this change yet'
  const now = version.next.vector?.exact
  const was = version.previous?.vector?.exact
  if (!now) return `next version ${version.next.name}`
  if (!was || !version.previous) return `next version ${version.next.name}: ${now[0]} of ${now[1]} must-pass`
  const delta = now[0] - was[0]
  return `next version ${version.next.name}: ${now[0]} of ${now[1]} must-pass (${delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${delta}`} from ${version.previous.name})`
}

// ------------------------------------------------------------------------------------------------- data quality

/** What the record could not measure, once: conversations captured partly or not at all, and agents without usage. */
export function dataQuality(input: {
  capture: { complete: number; lossy: number; absent: number } | null
  agents: number
  metered: number
  priced: number
  live: boolean
  unpricedModels: string[]
}) {
  const parts: string[] = []
  const reasons: string[] = []
  if (input.capture && input.capture.lossy + input.capture.absent > 0) {
    const partial = input.capture.lossy
    parts.push(
      [partial ? `conversations partial for ${partial} of ${input.agents} agents` : null, input.capture.absent ? `missing for ${input.capture.absent}` : null]
        .filter(Boolean)
        .join(', '),
    )
    if (input.live) reasons.push('A live agent’s conversation is streamed in fragments until it settles; the full session is read then.')
  }
  if (input.agents && input.metered < input.agents)
    parts.push(`usage metered for ${input.metered} of ${input.agents} agents`)
  if (input.live && input.metered < input.agents) reasons.push('Codex reports usage when a turn ends, so an agent in its first turn has none yet.')
  if (input.metered && input.priced < input.metered) {
    parts.push(`priced for ${input.priced}`)
    if (input.unpricedModels.length) reasons.push(`Runtime has no API list price for ${input.unpricedModels.join(', ')} yet; its tokens are counted.`)
  }
  return parts.length ? { line: parts.join(' · '), reasons } : null
}
