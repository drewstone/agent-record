/**
 * anchor.v1: an event's id names the stored bytes it came from, never its place in a record.
 *
 *   <o>:<loc>[.<k>]   o   the first 12 hex digits of the sha256 of the stored object (the whole file)
 *                     loc the 1-based physical line (split on LF only) of a line file, or the JSON Pointer of a JSON document
 *                     k   the index of the item in the source's own content array, when one line or item yields
 *                         several events (a tool call and its result are items 0 and 1 of one tool part)
 *   <o>               a whole-object event (a knowledge page)
 *
 * The id holds no node id, channel, record position, timestamp order or suffix, so a new join, a channel choice or a
 * converter release never moves a link. An event's `source` carries the same parts (sha256, line or pointer, item),
 * which is what lets anyone recompute the id from the object alone.
 */
export const ID_SCHEME = 'anchor.v1'

const HEX64 = /^[0-9a-f]{64}$/
const ANCHOR = /^([0-9a-f]{12})(?::(\d+|\/[^]*?))?(?:\.(\d+))?$/

export interface AnchorSource {
  sha256: string
  line?: number
  pointer?: string
  item?: number
}

/** The anchor.v1 id of an event whose bytes come from `source`. */
export function anchorId(source: AnchorSource): string {
  if (!HEX64.test(source.sha256)) throw new Error(`anchor: ${source.sha256} is not a sha256 hex digest`)
  if (source.line !== undefined && source.pointer !== undefined) throw new Error('anchor: a source has a line or a pointer, not both')
  if (source.line !== undefined && !(Number.isInteger(source.line) && source.line > 0)) throw new Error(`anchor: line ${source.line} is not a positive integer`)
  if (source.pointer !== undefined && !source.pointer.startsWith('/')) throw new Error(`anchor: ${source.pointer} is not a JSON Pointer`)
  if (source.item !== undefined && !(Number.isInteger(source.item) && source.item >= 0)) throw new Error(`anchor: item ${source.item} is not an index`)
  const loc = source.line ?? source.pointer
  return `${source.sha256.slice(0, 12)}${loc === undefined ? '' : `:${loc}`}${source.item === undefined ? '' : `.${source.item}`}`
}

/** The parts of an anchor.v1 id, or null when the string is not one. */
export function parseAnchor(id: string): { object: string; line?: number; pointer?: string; item?: number } | null {
  const match = ANCHOR.exec(id)
  if (!match) return null
  const [, object, loc, item] = match
  return {
    object: object!,
    ...(loc === undefined ? {} : loc.startsWith('/') ? { pointer: loc } : { line: Number(loc) }),
    ...(item === undefined ? {} : { item: Number(item) }),
  }
}
