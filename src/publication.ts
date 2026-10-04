/**
 * What a publisher needs from the converter, without the converter: the anchor.v1 id rule, a check that every event id
 * is recomputable from its stored object, the old-to-new id map for a converter upgrade, and the input schemas the
 * converter reads (an evidence-store snapshot manifest and a bundle). No file or network access: callers pass bytes.
 *
 * The publication's own files (manifest, review overlay, lock, id map ledger) belong to the site that publishes them.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { anchorId, parseAnchor, ID_SCHEME, type AnchorSource } from './anchor.js'
import type { RunRecord } from './record.js'

export { anchorId, parseAnchor, ID_SCHEME, type AnchorSource }

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const relative = z.string().min(1).refine((path) => !path.startsWith('/') && !path.split('/').includes('..'), 'a relative path inside the snapshot')

/** evidence.snapshot.v1 (an import) or disco.controller-mirror.v1 (the live mirror): a directory as stored objects. */
export const snapshotSchema = z
  .object({
    schema: z.enum(['evidence.snapshot.v1', 'disco.controller-mirror.v1']),
    runId: z.string().min(1),
    files: z.array(z.object({ path: relative, sha256: digest, bytes: z.number().int().nonnegative() }).catchall(z.unknown())),
    links: z.array(z.object({ path: relative, target: z.string() })).optional(),
  })
  .catchall(z.unknown())

const window = z.tuple([z.number().int().positive(), z.number().int().positive()])
/** agent-record.bundle.v1: several native sessions, workflow journals, runs and finding pages as one record. */
export const bundleSchema = z.object({
  schema: z.literal('agent-record.bundle.v1'),
  recordId: z.string().min(1),
  title: z.string().optional(),
  sessions: z.array(
    z.object({
      path: relative,
      harness: z.enum(['claude-code', 'codex', 'opencode', 'opencode-bridge', 'pi']),
      sessionId: z.string().optional(),
      parentPath: relative.optional(),
      agentId: z.string().optional(),
      label: z.string().optional(),
      lines: z.array(window).optional(),
    }),
  ),
  journals: z.array(z.object({ path: relative, kind: z.literal('claude-workflow'), workflow: relative.optional(), parentPath: relative.optional(), label: z.string().optional() })).optional(),
  runs: z.array(z.object({ path: relative, kind: z.literal('agent-runtime'), runId: z.string().optional() })).optional(),
  findings: z.array(z.object({ path: relative })).optional(),
})

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/** The bytes a source location names: one physical line (LF-split, CR trimmed), a JSON Pointer value, or the object. */
export function sourceBytes(object: Uint8Array, source: { line?: number; pointer?: string }): Buffer | null {
  const buffer = Buffer.from(object)
  if (source.line !== undefined) {
    const lines = buffer.toString('utf8').split('\n')
    if (source.line > lines.length) return null
    return Buffer.from(lines[source.line - 1]!.replace(/\r$/, ''), 'utf8')
  }
  if (source.pointer !== undefined) {
    let value: unknown = JSON.parse(buffer.toString('utf8'))
    for (const raw of source.pointer.split('/').slice(1)) {
      const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
      if (value === null || typeof value !== 'object' || !(key in (value as object))) return null
      value = (value as Record<string, unknown>)[key]
    }
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
  }
  return buffer
}

/**
 * Every event id must be the anchor of its own source, and (when `readObject` is given) that source must exist:
 * the object hashes to `source.sha256` and holds the line or pointer. Returns the problems; empty means valid.
 */
export function checkAnchors(record: Pick<RunRecord, 'events'>, readObject?: (path: string) => Uint8Array | null): string[] {
  const problems: string[] = []
  const objects = new Map<string, Uint8Array | null>()
  const seen = new Set<string>()
  for (const event of record.events) {
    const source = event.source as (AnchorSource & { path?: string }) | null | undefined
    if (!source?.sha256 || !source.path) {
      problems.push(`${event.id}: no source`)
      continue
    }
    if (seen.has(event.id)) problems.push(`${event.id}: duplicate id`)
    seen.add(event.id)
    let expected: string
    try {
      expected = anchorId(source)
    } catch (error) {
      problems.push(`${event.id}: ${(error as Error).message}`)
      continue
    }
    if (expected !== event.id) problems.push(`${event.id}: its source anchors to ${expected}`)
    if (!readObject) continue
    if (!objects.has(source.path)) objects.set(source.path, readObject(source.path))
    const object = objects.get(source.path)
    if (!object) problems.push(`${event.id}: ${source.path} is missing`)
    else if (sha256(object) !== source.sha256) problems.push(`${event.id}: ${source.path} does not hash to ${source.sha256.slice(0, 12)}`)
    else if (!sourceBytes(object, source)) problems.push(`${event.id}: ${source.path} has no ${source.line ?? source.pointer}`)
  }
  return problems
}

type EventLike = { id: string; source?: { path?: string; sha256?: string; line?: number; pointer?: string; item?: number } | null; detail?: Record<string, unknown> }

/**
 * Map every event id of an earlier record to the event of a new record that holds the same bytes: the same object
 * (sha256) and the same line or pointer, and the same item when one line holds several; a whole-object event maps by
 * object. A candidate that matches more than one new event, or none, is reported instead of guessed.
 */
export function buildIdMap(previous: { events: EventLike[] }, next: { events: EventLike[] }) {
  const key = (source: EventLike['source'], withItem: boolean) =>
    source?.sha256 ? `${source.sha256}\0${source.line ?? ''}\0${source.pointer ?? ''}${withItem ? `\0${source.item ?? ''}` : ''}` : null
  const exact = new Map<string, string[]>()
  const loose = new Map<string, string[]>()
  for (const event of next.events) {
    for (const [map, withItem] of [[exact, true], [loose, false]] as const) {
      const k = key(event.source, withItem)
      if (k) map.set(k, [...(map.get(k) ?? []), event.id])
    }
  }
  const nextIds = new Set(next.events.map((event) => event.id))
  const map: Record<string, string> = {}
  const unmapped: { id: string; reason: string }[] = []
  for (const event of previous.events) {
    if (nextIds.has(event.id)) continue
    const candidates = exact.get(key(event.source, true) ?? '') ?? loose.get(key(event.source, false) ?? '') ?? []
    if (candidates.length === 1) map[event.id] = candidates[0]!
    else unmapped.push({ id: event.id, reason: candidates.length ? `${candidates.length} events hold these bytes` : 'no event holds these bytes' })
  }
  return { map, unmapped }
}
