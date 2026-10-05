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
