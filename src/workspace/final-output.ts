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
