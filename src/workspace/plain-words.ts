/**
 * Plain words for the Discovery pages: agent text as a reader's line, and a time as "Oct 23 13:47Z". A module of its own
 * so play and Today import it without the run page's sandbox-ui code (which loads CSS that node tests cannot import).
 */
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const clock = (t: number) => new Date(t).toISOString().slice(11, 16)

/** Agent text as a reader's line: markdown stripped, its first sentence, at most `words` words (the raw text sits behind "full"). */
/** A ladder step's state in words, for its tooltip. */
export const stepWord = (state: string) => ({ pass: 'passed', fail: 'failed', unrun: 'not run yet', undecided: 'undecided' } as Record<string, string>)[state] ?? state

export function plainSummary(text: string | null | undefined, words = 20) {
  const plain = (text ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)(.+?)\1/g, '$2').replace(/^[#>\s]+/, '').replace(/\s+/g, ' ').trim()
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain
  const cut = first.split(' ')
  return cut.length > words ? `${cut.slice(0, words).join(' ')}…` : first
}

/** `Oct 23 13:47Z`. */
export const sinceLabel = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? `${day(Date.parse(iso))} ${clock(Date.parse(iso))}Z` : null)

/**
 * A goal as the reader needs it: never who said it or when (lead 2026-10-25). Drops a leading "Play <id>: " and a
 * leading attributed quote ("Drew, 2026-10-17: \"…\"."), keeping the goal text after it; text without either is unchanged.
 */
export function goalText(text: string | null | undefined): string {
  const raw = (text ?? '').trim()
  const goal = raw.replace(/^Play [\w.-]+:\s*/, '').replace(/^[A-Z][\w .'-]{0,40},\s*\d{4}-\d{2}-\d{2}:\s*(\u201c[^\u201d]*\u201d|"[^"]*")[.,]?\s*/, '').trim()
  return goal || raw
}
