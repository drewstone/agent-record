import type { HumanGrade, PanelReview, Readout, ReadoutChart } from '../workspace.js'

/**
 * A run's scores side by side, all on the readout's absolute 0–100 vs world-class scale: the readout's AI judges, the
 * AI persona panel and people's grades. Each source keeps its own label: AI judges and personas are advisory unless a
 * judge is calibrated, and a person's grade is that person's. Types only, so the node tests load this file directly.
 */

export const ABSOLUTE_SCALE = 'absolute 0–100 vs world-class'

/** The persona panel names the readout judges' `graphics` category `visuals`. */
const ALIASES: Record<string, string> = { visuals: 'graphics' }
const canonical = (category: string) => ALIASES[category] ?? category

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10
}

export interface PersonaScore {
  persona: string
  score: number
  band: string | null
  competence: string | null
  why: string | null
}

export interface ScoreRow {
  category: string
  /** The readout judge's absolute score; `retired` when it judged on the retired relative scale; null when none judged. */
  ai: { score: number | null; calibrated: boolean | null } | 'retired' | null
  personas: { median: number | null; min: number | null; max: number | null; scores: PersonaScore[] }
  people: HumanGrade[]
}

type Judge = Readout['judges'][number] & { scale?: unknown }

/**
 * One row per category any source scored, `overall` first: the AI judge, the personas' median with their range, and
 * each person's latest grade of this target in that category. The overall row's AI cell is the judges' median when any
 * judged on the absolute scale.
 */
export function scoreRows(
  readout: Readout | null | undefined,
  panel: readonly PanelReview[] | null | undefined,
  grades: readonly HumanGrade[] | null | undefined,
  target: { kind: HumanGrade['target']['kind']; id: string },
): ScoreRow[] {
  const judges = (readout && readout.status !== 'pending' ? readout.judges : []) as Judge[]
  const reviews = panel ?? []
  const mine = (grades ?? []).filter((grade) => grade.target.kind === target.kind && grade.target.id === target.id)
  const categories = new Set<string>(['overall'])
  for (const judge of judges) categories.add(canonical(judge.category))
  for (const review of reviews) for (const category of Object.keys(review.scores)) categories.add(canonical(category))
  for (const grade of mine) categories.add(canonical(grade.category))
  const absolute = judges.filter((judge) => typeof judge.score === 'number' && judge.max === 100)
  return [...categories].map((category) => {
    let ai: ScoreRow['ai'] = null
    if (category === 'overall') {
      const scores = absolute.map((judge) => judge.score as number)
      ai = scores.length ? { score: median(scores), calibrated: absolute.every((judge) => judge.calibrated === true) } : judges.length ? 'retired' : null
    } else {
      const judge = judges.find((item) => canonical(item.category) === category)
      if (judge) ai = typeof judge.score === 'number' && judge.max === 100 ? { score: judge.score, calibrated: judge.calibrated } : 'retired'
    }
    const scores: PersonaScore[] = []
    for (const review of reviews) {
      if (category === 'overall') {
        if (typeof review.overall === 'number') scores.push({ persona: review.persona, score: review.overall, band: null, competence: null, why: review.verdict })
        continue
      }
      for (const [name, value] of Object.entries(review.scores))
        if (canonical(name) === category && typeof value.score === 'number')
          scores.push({ persona: review.persona, score: value.score, band: value.band, competence: value.competence, why: value.why })
    }
    const values = scores.map((item) => item.score)
    return {
      category,
      ai,
      personas: { median: median(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, scores },
      people: mine.filter((grade) => canonical(grade.category) === category),
    }
  })
}

/** The headline score for the answer strip: the AI judges' absolute median, else the personas' overall median. */
export function headlineScore(rows: readonly ScoreRow[]): { score: number; source: 'judges' | 'personas'; n: number } | null {
  const overall = rows.find((row) => row.category === 'overall')
  if (!overall) return null
  if (overall.ai && overall.ai !== 'retired' && typeof overall.ai.score === 'number') return { score: overall.ai.score, source: 'judges', n: rows.filter((row) => row.category !== 'overall' && row.ai && row.ai !== 'retired').length }
  if (overall.personas.median !== null) return { score: overall.personas.median, source: 'personas', n: overall.personas.scores.length }
  return null
}

export interface ChartPair {
  before: ReadoutChart | null
  after: ReadoutChart | null
  /** How the two were paired: the same chart id, the same unit, or not paired. */
  match: 'id' | 'unit' | null
}

/**
 * Two versions' readout charts paired for a before-and-after view: the same chart id first, then charts with the same
 * unit in order, then the rest alone. A unit pair can plot different breakdowns, so the view names both titles.
 */
export function chartPairs(before: readonly ReadoutChart[] | null | undefined, after: readonly ReadoutChart[] | null | undefined): ChartPair[] {
  const left = [...(before ?? [])]
  const right = [...(after ?? [])]
  const pairs: ChartPair[] = []
  for (const chart of [...right]) {
    const index = left.findIndex((item) => item.id === chart.id)
    if (index >= 0) {
      pairs.push({ before: left.splice(index, 1)[0]!, after: chart, match: 'id' })
      right.splice(right.indexOf(chart), 1)
    }
  }
  for (const chart of [...right]) {
    const index = chart.unit ? left.findIndex((item) => item.unit === chart.unit) : -1
    if (index >= 0) {
      pairs.push({ before: left.splice(index, 1)[0]!, after: chart, match: 'unit' })
      right.splice(right.indexOf(chart), 1)
    }
  }
  for (const chart of right) pairs.push({ before: null, after: chart, match: null })
  for (const chart of left) pairs.push({ before: chart, after: null, match: null })
  // The run's own process charts (who worked when, dollars and tokens per agent) after the charts of its findings.
  const process = (pair: ChartPair) => /^run-/.test((pair.after ?? pair.before)!.id)
  return [...pairs.filter((pair) => !process(pair)), ...pairs.filter(process)]
}
