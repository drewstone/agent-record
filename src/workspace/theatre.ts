/**
 * The theatre page's model: a theatre's hill-climb drawn from the views the Lab wrote (discovery-lab
 * `runner/theatre.mjs`, `bar-<digest>/view.json`). Nothing here scores anything: heights, steps, acts, costs and results
 * are read from the view, and this module only places them (docs/theatre.md#acts).
 */

export interface ActSpend {
  apiEquivalentUsd: number | null
  apiEquivalentKnown: boolean
  billedUsd: number | null
  billedKnownUsd: number | null
  billedComplete: boolean
  plays: number
  playsWithSpend: number
}

export interface ActResult {
  status: 'new-best' | 'no-gain' | 'invalid' | 'unread' | 'live' | 'not-on-bar'
  text: string
}

export interface TheatreAct {
  act: number
  decided: string | null
  proposer: 'operator' | 'reflector'
  change: string
  plays: string[]
  onBar: string[]
  spend: ActSpend
  rounds: { own: number; complete: number; offBarRead: number }
  best: { play: string; tag: string; taggedAt: string | null; passed: number; total: number } | null
  result: ActResult
}

export interface StaircaseStep {
  play: string
  act: number | null
  tag: string
  taggedAt: string | null
  status: 'selected' | 'rejected' | 'invalid'
  inside: boolean
  reason: string | null
  passed: number
  total: number
}

export interface TheatreRound {
  play: string
  act: number | null
  tag: string
  taggedAt: string | null
  score: { passed: number; total: number } | null
}

export interface TheatreOffBar {
  owner: string
  act: number | null
  readRounds: { tag: string; taggedAt: string | null; passed: number; total: number }[]
}

export interface TheatrePlay {
  play: string
  act: number | null
  fork: { play: string; tag: string } | null
}

export interface TheatreBarView {
  theatre: string
  goal: string | null
  asOf: string | null
  bar: { digest: string; checkCount: number; policy: string; set: { source: string }; test: string | { state: string } }
  headline: { best: { play: string; tag: string; taggedAt: string | null; text: string } | null; plays: { onBar: number; live: string[] } }
  acts: TheatreAct[]
  unplaced?: string[]
  staircase: StaircaseStep[]
  rounds: TheatreRound[]
  playbill: TheatrePlay[]
  offBar: TheatreOffBar[]
}

export interface TheatreViewsDocument {
  schema: 'discovery-lab.theatre-views'
  theatre: string
  bars: TheatreBarView[]
}

export type RoundKind = 'selected' | 'rejected' | 'inside' | 'invalid' | 'unread' | 'earlier'

export interface Dot {
  key: string
  play: string
  tag: string
  act: number | null
  at: number
  kind: RoundKind
  passed: number | null
  total: number | null
  x: number
  y: number
  reason: string | null
  best: boolean
}

export interface Column {
  act: number | null
  x0: number
  x1: number
  card: TheatreAct | null
  plays: string[]
}

export interface Panel {
  title: string
  span: string
  max: number
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  ticks: { value: number; y: number }[]
  columns: Column[]
  dots: Dot[]
  line: string
  edges: { from: string; to: string; path: string; play: string }[]
  best: Dot | null
  bestText: string | null
  unreadCount: number
}

const time = (value: string | null | undefined) => {
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : 0
}

/** `terraform-dc-build-20261009g-fork` reads `g-fork`: the letter and suffix after the play's date. A name two plays share keeps its whole id. */
export function playNames(ids: readonly string[]): Map<string, string> {
  const short = (id: string) => /-\d{8}([a-z](?:-[a-z0-9]+)*)$/u.exec(id)?.[1] ?? id
  const each = [...new Set(ids)]
  const counts = new Map<string, number>()
  for (const id of each) counts.set(short(id), (counts.get(short(id)) ?? 0) + 1)
  return new Map(each.map((id) => [id, (counts.get(short(id)) ?? 0) > 1 ? id.replace(/^[a-z]+-/u, '') : short(id)]))
}

/** Axis ticks over 0 to `max` checks: thirds when they are whole numbers, else halves. */
export function axisTicks(max: number): number[] {
  const steps = max >= 3 && max % 3 === 0 ? [0, max / 3, (2 * max) / 3, max] : [0, Math.round(max / 2), max]
  return [...new Set(steps)]
}

/** A day in the page's words: `9 Oct`. */
export const day = (value: string | null | undefined) => {
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'undated'
}

/** One dollar figure as the page says it; unknown stays unknown and a partial sum says so. */
export function dollars(value: number | null | undefined, lowerBound = false): string {
  if (value === null || value === undefined) return 'unknown'
  const text = value >= 100 ? `$${Math.round(value).toLocaleString('en-US')}` : `$${value.toFixed(2)}`
  return lowerBound ? `at least ${text}` : text
}

/** API-equivalent cost of an act: a figure with an unpriced call or a play without a figure is a lower bound. */
export function apiCost(spend: ActSpend): string {
  return spend.apiEquivalentUsd === null ? 'unknown' : dollars(spend.apiEquivalentUsd, !spend.apiEquivalentKnown || spend.playsWithSpend < spend.plays)
}

/** Billed cost of an act: the whole when every part was read, else the part that was, else unknown. */
export function billedCost(spend: ActSpend): string {
  if (spend.billedUsd !== null) return dollars(spend.billedUsd)
  return spend.billedKnownUsd === null ? 'unknown' : dollars(spend.billedKnownUsd, true)
}

/** The theatre's best round for the header: the newest bar that has one, said with the bars after it that have none. */
export function headlineBest(views: readonly TheatreBarView[]) {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    const view = views[i]!
    const best = view.headline.best
    if (!best) continue
    const step = view.staircase.find((item) => item.play === best.play && item.tag === best.tag)
    const names = playNames([best.play])
    return {
      bar: i + 1,
      play: names.get(best.play) ?? best.play,
      tag: best.tag,
      taggedAt: best.taggedAt,
      passed: step?.passed ?? null,
      total: step?.total ?? view.bar.checkCount,
      newer: views.slice(i + 1).map((item, j) => ({ bar: i + 2 + j, live: item.headline.plays.live.length })),
    }
  }
  return null
}

const kindOf = (step: StaircaseStep | undefined, round: TheatreRound): RoundKind => {
  if (!step || !round.score) return 'unread'
  if (step.status === 'selected') return 'selected'
  if (step.status === 'invalid') return 'invalid'
  return step.inside ? 'inside' : 'rejected'
}

/**
 * Place one bar's staircase. x is the act (equal columns, oldest left) and, inside a column, the order the rounds were
 * tagged; y is the checks a round passed. Every round is a dot, the best-so-far line follows the accepted steps, and each
 * fork edge joins a play's first round to the round it forked.
 */
export function panelModel(view: TheatreBarView, index: number, size: { width: number; height: number }): Panel {
  const max = Math.max(1, view.bar.checkCount)
  const plot = { left: size.width < 560 ? 34 : 52, right: 10, top: 34, bottom: size.height - 42 }
  const innerW = size.width - plot.left - plot.right
  const here = view.acts.filter((act) => act.onBar.length > 0 || act.rounds.offBarRead > 0)
  const loose = view.rounds.some((round) => round.act === null) || view.offBar.some((item) => item.act === null && item.readRounds.length > 0)
  const columns: Column[] = [...here.map((act) => ({ act: act.act as number | null, card: act as TheatreAct | null, plays: act.plays })), ...(loose || here.length === 0 ? [{ act: null as number | null, card: null as TheatreAct | null, plays: [] as string[] }] : [])]
    .map((column, i, all) => ({ ...column, x0: plot.left + (innerW * i) / all.length, x1: plot.left + (innerW * (i + 1)) / all.length }))

  const steps = new Map(view.staircase.map((step) => [`${step.play} ${step.tag}`, step]))
  const draft: Omit<Dot, 'x' | 'y' | 'best'>[] = [
    ...view.rounds.map((round) => {
      const step = steps.get(`${round.play} ${round.tag}`)
      const kind = kindOf(step, round)
      return { key: `${round.play} ${round.tag}`, play: round.play, tag: round.tag, act: round.act, at: time(round.taggedAt), kind, passed: kind === 'unread' ? null : round.score!.passed, total: kind === 'unread' ? null : round.score!.total, reason: step?.reason ?? null }
    }),
    ...view.offBar.flatMap((item) => item.readRounds.map((round) => ({ key: `${item.owner} ${round.tag}`, play: item.owner, tag: round.tag, act: item.act, at: time(round.taggedAt), kind: 'earlier' as RoundKind, passed: round.passed, total: round.total, reason: null }))),
  ]
  const yOf = (passed: number | null) => plot.bottom - ((passed ?? 0) / max) * (plot.bottom - plot.top)
  const dots: Dot[] = []
  for (const column of columns) {
    const mine = draft.filter((item) => item.act === column.act).sort((a, b) => a.at - b.at || (a.tag < b.tag ? -1 : 1))
    mine.forEach((item, i) => dots.push({ ...item, x: column.x0 + 12 + ((column.x1 - column.x0 - 24) * (i + 0.5)) / mine.length, y: yOf(item.passed), best: false }))
  }
  const bestKey = view.headline.best ? `${view.headline.best.play} ${view.headline.best.tag}` : null
  const best = dots.find((dot) => dot.key === bestKey && dot.kind !== 'earlier') ?? null
  if (best) best.best = true

  // The best-so-far line: the incumbent's height from each accepted step until the next one, to the right edge.
  const accepted = view.staircase.filter((step) => step.status === 'selected').map((step) => dots.find((dot) => dot.key === `${step.play} ${step.tag}` && dot.kind !== 'earlier')).filter((dot): dot is Dot => dot !== undefined)
  accepted.sort((a, b) => a.x - b.x)
  let line = ''
  accepted.forEach((dot, i) => { line += i === 0 ? `M${dot.x.toFixed(1)} ${dot.y.toFixed(1)}` : ` H${dot.x.toFixed(1)} V${dot.y.toFixed(1)}` })
  if (line) line += ` H${(plot.left + innerW).toFixed(1)}`

  const edges: Panel['edges'] = []
  for (const play of view.playbill) {
    if (!play.fork) continue
    const parent = dots.find((dot) => dot.play === play.fork!.play && dot.tag === play.fork!.tag)
    // The play's first round that was read; a play with none yet starts at its first tick.
    const own = dots.filter((dot) => dot.play === play.play && dot.kind !== 'earlier').sort((a, b) => a.at - b.at)
    const child = own.find((dot) => dot.kind !== 'unread') ?? own[0]
    if (!parent || !child) continue
    const mid = (parent.x + child.x) / 2
    edges.push({ from: parent.key, to: child.key, play: play.play, path: `M${parent.x.toFixed(1)} ${parent.y.toFixed(1)} C${mid.toFixed(1)} ${parent.y.toFixed(1)} ${mid.toFixed(1)} ${child.y.toFixed(1)} ${child.x.toFixed(1)} ${child.y.toFixed(1)}` })
  }

  const names = playNames(dots.map((dot) => dot.play))
  // The bar's own span: rounds of earlier acts that it read were tagged before the bar began.
  const times = dots.filter((dot) => dot.kind !== 'earlier').map((dot) => dot.at).filter((ms) => ms > 0)
  const span = times.length === 0 ? '' : `${day(new Date(Math.min(...times)).toISOString())}${day(new Date(Math.min(...times)).toISOString()) === day(new Date(Math.max(...times)).toISOString()) ? '' : ` to ${day(new Date(Math.max(...times)).toISOString())}`}`
  return {
    title: `Bar ${index + 1}`, span, max, width: size.width, height: size.height, plot,
    ticks: axisTicks(max).map((value) => ({ value, y: yOf(value) })),
    columns: columns.map((column) => ({ ...column, plays: column.plays.map((play) => names.get(play) ?? play) })),
    dots, line, edges, best,
    bestText: best ? `${names.get(best.play) ?? best.play} ${best.tag} · ${best.passed} of ${best.total}` : null,
    unreadCount: dots.filter((dot) => dot.kind === 'unread').length,
  }
}

/** What a dot says when hovered or read aloud. */
export function dotLabel(dot: Dot, names: Map<string, string>): string {
  const who = `${names.get(dot.play) ?? dot.play} ${dot.tag}`
  if (dot.kind === 'unread') return `${who}: no complete reading yet`
  const score = `${dot.passed} of ${dot.total} checks`
  const how = { selected: 'accepted step up', rejected: 'rejected', inside: 'judge-only gain inside the noise', invalid: 'broke a rule of the gate', earlier: 'earlier act, read on this bar' }[dot.kind]
  return `${who}: ${score}, ${how}`
}
