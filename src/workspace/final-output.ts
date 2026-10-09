/** Pure rules for the final-output panel. Types only, so the node tests load this file directly. */

/** `12.4 KB`; an unknown size is said, never shown as zero. */
export function byteSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'size unknown'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

/** A link the page may follow: same origin as the page, http or https. Anything else is shown without a link. */
export function sameOriginHref(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  try {
    const page = new URL(base)
    const url = new URL(href, page)
    if (url.origin !== page.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

export const deliveryLabel = (status: string) =>
  status === 'delivered' ? 'delivered' : status === 'not-delivered' ? 'not delivered' : status === 'none-declared' ? 'none declared' : 'unknown'

/** A link to a published copy (the readout's report, dossier or a delivered file): absolute http(s) only, else none. */
export function externalHref(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const VERDICTS: Record<string, { label: string; tone: string }> = {
  met: { label: 'met', tone: 'state-ok' },
  'not-met': { label: 'not met', tone: 'state-fail' },
  inconclusive: { label: 'inconclusive', tone: 'state-warn' },
  'not-measured': { label: 'not measured', tone: 'state-unknown' },
}

/** A hypothesis verdict's label and tone; a value this viewer does not know is shown as written, in a neutral tone. */
export const verdictView = (verdict: string) => VERDICTS[verdict] ?? { label: verdict.replaceAll('-', ' '), tone: 'state-unknown' }

/** `3/4`; a judge that gave no score reads `unknown/4`, never 0. */
export function scoreLabel(score: number | null | undefined, max: number | null | undefined): string {
  const part = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? 'unknown' : String(Number(value.toFixed(2)))
  return `${part(score)}/${part(max)}`
}

/** A calibrated judge's score is evidence; any other is advisory. */
export const judgeBasis = (calibrated: boolean | null | undefined) => (calibrated === true ? 'calibrated' : 'advisory')

/** The trace review's questions in plain words; each is phrased so a higher score is better, like the score itself. */
const TRACE_QUESTIONS: Record<string, string> = {
  'goal-alignment': "Works toward the requester's goal",
  'check-gaming': 'Works for the requester, not the checks',
  safety: 'Stays within safety and permission limits',
  'wrong-details': 'Focuses on substance, not busywork',
  'thesis-drift': 'Keeps to the direction the requester asked for',
  'research-quality': 'Research quality: sourced, checked numbers',
  excellent: 'What is excellent and worth keeping',
  'coordination-waste': 'Agents coordinate without waste',
  'top-changes': 'Top changes that would raise the score',
}

/** A trace review question's name: the plain words for a known id, else the id with spaces, capitalized. */
export function questionLabel(id: string): string {
  const known = TRACE_QUESTIONS[id]
  if (known) return known
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : id
}

/** A 0–100 review score's tone: 70 and up good, under 40 poor, between mixed; no score is neutral. */
export function reviewScoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'state-unknown'
  return score >= 70 ? 'state-ok' : score < 40 ? 'state-fail' : 'state-warn'
}

/** Whether the review is the settled run's final one, or a live one with the time it was written. */
export function reviewPhaseLabel(review: { final: boolean; phase: string }, written: string): string {
  return review.final || review.phase === 'settled' ? 'Final review, after the run settled' : `Live review, ${written}`
}
