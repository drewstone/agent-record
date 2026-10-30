/**
 * The one converter from an agent-runtime run directory (or a bundle of sessions, see ingestBundle) to `agent-record.v1`.
 * Node only. Each harness's session format has one reader (claude.ts, codex.ts, opencode.ts, pi.ts, bridge.ts) over
 * the shared line framing in harness-reader.ts; this file reads the run's own channels and dispatches to them.
 *
 * It reads the run directory and an optional native-transcript cache, never writes into either, and never
 * touches the network. The same inputs and ADAPTER_VERSION produce identical bytes. With a snapshot manifest
 * (evidence.snapshot.v1, the evidence store's file list) every file is verified against it before conversion and
 * every source digest comes from it; the run id comes from the caller or the manifest.
 *
 * Nodes are the `spawned` ids in spawn-journal.jsonl. Each node's conversation comes from the first channel
 * that holds it, in this order; the others are listed as sources and never duplicated as events:
 *   0. live     while a node has not settled: its Sandbox session events recorded so far (evidence/live-stream/)
 *   1. native   Claude Code session .jsonl files, each from its longest stored copy: a turn's retained-harness-transcript
 *               archive or the run's latest native-index capture (both under --native/<hex>/); else the OpenCode store
 *               (.local/share/opencode/opencode.db) in the node's latest native-index capture, its root sessions read
 *               as the rows a trajectory holds
 *   2. oc       OpenCode native-trajectory.json (bridge-native roots)
 *   3. pi       trace/pi-sessions/**, joined when sha256(JSON.stringify(first user text)) == spawned taskDigest
 *   4. part     output blob parts at the node's outRefs, collapsed to the final state of each part id
 *   5. root     root-stream.jsonl (root only; deltas collapse to one block per turn; resumed replays dropped)
 *   6. journal  lifecycle events only
 * Knowledge pages (kb/pages/**\/*.md) become finding events on node `finding:<runId>`; a run with only pages is
 * format `finding-only`.
 *
 * Event ids are anchor.v1 (anchor.ts): `<first 12 hex of the object's sha256>:<line or JSON Pointer>[.<item>]`, or
 * the object alone for a whole page. Each event's `source` carries the same sha256, line or pointer and item. Every
 * timestamped line of a session, journal or stream becomes exactly one event (or one per content item); a line the
 * converter does not interpret is a `record` event carrying its type. A duplicate anchor is an error, never suffixed.
 *
 * Sources: every input file, native file and clipped body has a `sources[]` entry. Its sha256 covers exactly
 * the bytes a source route serves: the whole file, one physical line (`line`), or the resolved JSON value
 * (`pointer`; a string's UTF-8 bytes, otherwise its JSON text). In an OpenCode store (SQLite) the pointer
 * `/part/<id>/data` names the data column of the part row with that id. Paths under the native cache start with
 * `native:<hex>/`. A clipped body keeps the first three quarters and the last quarter of `maxText` bytes;
 * `detail.clip.sha256` names the source entry holding the full text.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { recordSchema } from '../record.js'
import { anchorId, ID_SCHEME } from '../anchor.js'
import { bridgeStreams, readBridgeBundle, readBridgeStream, type BridgeStream } from './bridge.js'
import { nativeFiles, readClaudeBundle, readNative } from './claude.js'
import { readCodexBundle } from './codex.js'
import { categoryOf, filesUnder, hexOf, isoAt, num, pointerOf, sha, splitLines, str, walk, type Category, type EventSource, type Json, type Line, type SessionReader, type Source, type WorkflowAgents } from './harness-reader.js'
import { nativeStore, readOpenCode, readOpenCodeBundle, readOpenCodeStore } from './opencode.js'
import { projectPartEvents } from './part-events.js'
import { piSessions, readPi, readPiBundle, type PiSession } from './pi.js'

export const ADAPTER_VERSION = '2.7.0'
export { ID_SCHEME }
export { categoryOf, type Category } from './harness-reader.js'
export const MAX_RECORD_BYTES = 128 * 1024 * 1024

export interface SnapshotFile {
  path: string
  sha256: string
  bytes: number
  /** The file's modification time when it was captured (ISO text or epoch milliseconds). */
  mtime?: string | number
}
/** The evidence store's snapshot manifest (evidence.snapshot.v1, or the live mirror's disco.controller-mirror.v1). */
export interface SnapshotManifest {
  schema: string
  runId?: string
  files: SnapshotFile[]
  links?: { path: string; target: string }[]
}

export interface IngestOptions {
  /** Directory of extracted native archives, one `<64-hex digest>/` per archive. */
  native?: string
  /** Bodies over this many UTF-8 bytes are clipped. Default 16384. */
  maxText?: number
  /** The run id. Without it the manifest's runId, then the directory name, is used (input.runIdBasis says which). */
  runId?: string
  /** The snapshot this directory was materialized from: every file is verified against it before conversion. */
  manifest?: SnapshotManifest
  /** The sha256 hex of the manifest's bytes, recorded as input.snapshot. */
  manifestSha256?: string
  /**
   * Bytes of files an earlier conversion read (createFileCache). A process that converts a running run again and again
   * passes the same cache, so each conversion reads only the files that changed since the last one.
   */
  files?: FileCache
}

/** Reads a file's bytes and sha256. */
export interface FileCache {
  read(abs: string): { bytes: Buffer; sha256: string }
}

/**
 * A FileCache that keeps each file's bytes while its device, inode, size and change times are unchanged, least
 * recently used first out past `maxBytes`. The output never depends on it: a changed file is read again.
 */
export function createFileCache({ maxBytes = 1024 * 1024 * 1024 }: { maxBytes?: number } = {}): FileCache & { heldBytes(): number } {
  const entries = new Map<string, { key: string; bytes: Buffer; sha256: string }>()
  let held = 0
  return {
    read(abs) {
      const stats = statSync(abs)
      const key = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
      const hit = entries.get(abs)
      if (hit) {
        entries.delete(abs)
        held -= hit.bytes.length
        if (hit.key === key) {
          entries.set(abs, hit)
          held += hit.bytes.length
          return hit
        }
      }
      const bytes = readFileSync(abs)
      const entry = { key, bytes, sha256: sha(bytes) }
      if (bytes.length <= maxBytes / 4) {
        entries.set(abs, entry)
        held += bytes.length
      }
      for (const [path, old] of entries) {
        if (held <= maxBytes) break
        entries.delete(path)
        held -= old.bytes.length
      }
      return entry
    },
    heldBytes: () => held,
  }
}

export interface IngestSummary {
  runId: string
  recordDigest: string
  bytes: number
  nodes: number
  events: number
  coverage: { complete: number; lossy: number; absent: number }
}

export class RunUnreadableError extends Error {
  readonly exitCode = 2
}
export class RecordTooLargeError extends Error {
  readonly exitCode = 3
  readonly code = 'record-too-large'
}
/** The directory does not match its snapshot manifest, or two events claim one anchor. */
export class SnapshotMismatchError extends Error {
  readonly exitCode = 4
}

type Capture = { channel: string; status: 'complete' | 'lossy' | 'absent'; reason: string | null }
type Gap = { nodeId: string | null; code: string; detail: string }

interface Draft {
  id: string
  node: string
  at: string
  kind: string
  category: Category
  label: string
  source: EventSource
  detail: Record<string, unknown>
  order: number
}
type DraftInput = Omit<Draft, 'order' | 'id'>

export interface NodeDraft {
  id: string
  label: string
  parent: string | null
  kind: 'agent' | 'session' | 'finding'
  role: string
  assignment?: string
  model: string | null
  modelSource?: string
  servedModel: string | null
  harness: string | null
  start?: string
  end?: string
  status?: string
  nativeSessionId?: string
  agentId?: string
  joinBasis?: string
  joinProof?: Record<string, unknown>
  sandboxes: string[]
  capture: Capture
  taskDigest?: string
  profileRef?: string
  outRefs: string[]
  transcriptRefs: string[]
  transcriptReason?: string
  key?: string
}
/** A node no evidence has filled yet; `fields` hold what is known. */
const blankNode = (id: string, fields: Partial<NodeDraft>): NodeDraft => ({
  id,
  label: id,
  parent: null,
  kind: 'session',
  role: 'Session',
  model: null,
  servedModel: null,
  harness: null,
  sandboxes: [],
  capture: { channel: 'none', status: 'absent', reason: 'no-conversation-channel' },
  outRefs: [],
  transcriptRefs: [],
  ...fields,
})

const NATIVE_INDEX = 'evidence/native-index.jsonl'
// Each running node's Sandbox session events, one JSON line per event as delivered (discovery-lab runner/live-stream.mjs).
const LIVE_STREAM = 'evidence/live-stream'
/** A file's sha256 and length, streamed so a large file is never held. */
function hashFile(abs: string) {
  const fd = openSync(abs, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1 << 20)
    let bytes = 0
    for (let n = readSync(fd, buffer); n > 0; n = readSync(fd, buffer)) {
      hash.update(buffer.subarray(0, n))
      bytes += n
    }
    return { sha256: hash.digest('hex'), bytes }
  } finally {
    closeSync(fd)
  }
}
function utf8Slice(buffer: Buffer, start: number, end: number) {
  // Move boundaries off UTF-8 continuation bytes so no character is split.
  while (start > 0 && start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++
  while (end < buffer.length && end > 0 && (buffer[end]! & 0xc0) === 0x80) end--
  return buffer.subarray(start, end).toString('utf8')
}

/** Each node's first and last event times. */
function spans(events: Draft[]) {
  const span = new Map<string, [string, string]>()
  for (const event of events) {
    const current = span.get(event.node)
    if (!current) span.set(event.node, [event.at, event.at])
    else {
      if (event.at < current[0]) current[0] = event.at
      if (event.at > current[1]) current[1] = event.at
    }
  }
  return span
}

interface FileEntry {
  bytes: Buffer
  sha256: string
  readonly text: string
}

export class Ingest {
  readonly runId: string
  readonly runIdBasis: 'option' | 'manifest' | 'directory'
  readonly manifestFiles = new Map<string, SnapshotFile>()
  /** Object digest -> the node whose conversation it holds; a second node never re-reads it. */
  readonly claimed = new Map<string, string>()
  /** Bridge session id -> the node whose materialized receipt names it, and that journal line. */
  readonly executionOf = new Map<string, { node: string; line: number }>()
  readonly sources = new Map<string, Source>()
  readonly events: Draft[] = []
  readonly gaps: Gap[] = []
  readonly nodes = new Map<string, NodeDraft>()
  readonly fileCache = new Map<string, FileEntry>()
  nativeIndexCache: Map<string, Json> | undefined
  rootId: string
  order = 0
  format = 'other'
  runInput: Json = null
  runInputRel: string | null = null
  result: Json = null

  constructor(
    readonly runDir: string,
    readonly nativeRoot: string | undefined,
    readonly maxText: number,
    readonly options: { runId?: string; manifest?: SnapshotManifest; manifestSha256?: string; prefix?: string; files?: FileCache } = {},
  ) {
    const fromManifest = typeof options.manifest?.runId === 'string' && options.manifest.runId ? options.manifest.runId : undefined
    this.runId = options.runId ?? fromManifest ?? basename(runDir.replace(/\/+$/, ''))
    this.runIdBasis = options.runId ? 'option' : fromManifest ? 'manifest' : 'directory'
    this.rootId = this.runId
    for (const file of options.manifest?.files ?? []) this.manifestFiles.set(file.path, file)
  }

  /** A path as recorded: relative to the bundle root, or the native cache's own `native:<hex>/` path. */
  sourcePath(rel: string) {
    return !this.options.prefix || rel.startsWith('native:') ? rel : `${this.options.prefix}${rel}`
  }

  // ----- sources -----
  file(rel: string, abs = join(this.runDir, rel)) {
    const cached = this.fileCache.get(abs)
    if (cached) return cached
    const read = this.options.files?.read(abs)
    const bytes = read?.bytes ?? readFileSync(abs)
    let text: string | undefined
    // Line files are read through splitLines(bytes); only a JSON document or a page is decoded whole.
    const entry: FileEntry = { bytes, sha256: read?.sha256 ?? sha(bytes), get text() { return (text ??= bytes.toString('utf8')) } }
    const listed = this.manifestFiles.get(this.sourcePath(rel))
    if (listed && hexOf(listed.sha256) !== entry.sha256) throw new SnapshotMismatchError(`${rel} does not match its snapshot manifest`)
    this.fileCache.set(abs, entry)
    return entry
  }
  /** A file's digest without holding it: the manifest's, or a streamed hash. */
  digestOnly(rel: string, abs = join(this.runDir, rel)): { sha256: string; bytes: number } | null {
    const listed = this.manifestFiles.get(this.sourcePath(rel))
    if (listed) return { sha256: hexOf(listed.sha256)!, bytes: listed.bytes }
    try {
      const read = this.options.files?.read(abs)
      return read ? { sha256: read.sha256, bytes: read.bytes.length } : hashFile(abs)
    } catch {
      return null
    }
  }
  addSource(input: Source) {
    const source = { ...input, path: this.sourcePath(input.path) }
    const key = `${source.path}\0${source.line ?? ''}\0${source.pointer ?? ''}`
    const existing = this.sources.get(key)
    if (existing?.sha256) return existing
    this.sources.set(key, source)
    return source
  }
  fileSource(rel: string, abs?: string, label?: string) {
    const entry = this.file(rel, abs)
    return this.addSource({ path: rel, sha256: entry.sha256, bytes: entry.bytes.length, ...(label ? { label } : {}) })
  }
  /** List a file that is not an event channel; large files are hashed without being held. */
  listSource(rel: string) {
    const digest = this.digestOnly(rel)
    if (digest) this.addSource({ path: rel, ...digest })
  }
  lineSource(rel: string, line: number, raw: string) {
    const bytes = Buffer.from(raw, 'utf8')
    return this.addSource({ path: rel, line, sha256: sha(bytes), bytes: bytes.length })
  }
  pointerSource(rel: string, pointer: string, value: Json, label?: string) {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
    return this.addSource({ path: rel, pointer, sha256: sha(bytes), bytes: bytes.length, ...(label ? { label } : {}) })
  }

  /** Clip `text` to maxText bytes; `full` registers the source entry that holds the original. */
  clip(text: string, full: (() => Source | null) | null) {
    const buffer = Buffer.from(text, 'utf8')
    if (buffer.length <= this.maxText) return { text, clip: undefined }
    const head = Math.floor(this.maxText * 0.75)
    const tail = this.maxText - head
    const shown = `${utf8Slice(buffer, 0, head)}\n\n…\n\n${utf8Slice(buffer, buffer.length - tail, buffer.length)}`
    const source = full?.() ?? null
    return { text: shown, clip: { bytes: buffer.length, sha256: source?.sha256 ?? null } }
  }
  /** `{ [key]: text }` clipped as clip() does, with the clip when it was cut: spread into an event's detail. */
  shown(key: string, text: string, full: (() => Source | null) | null) {
    const { text: shown, clip } = this.clip(text, full)
    return clip ? { [key]: shown, clip } : { [key]: shown }
  }
  /** Shorten every long string inside a lifecycle payload. The full payload stays in the cited line. */
  compactValue(value: Json, depth = 0): Json {
    if (typeof value === 'string') {
      const limit = Math.min(this.maxText, 2048)
      return Buffer.byteLength(value) > limit ? this.clip(value, null).text.slice(0, limit) + '…' : value
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, 50).map((item) => this.compactValue(item, depth + 1))
      return value.length > 50 ? [...items, `… ${value.length - 50} more`] : items
    }
    if (value && typeof value === 'object') {
      if (depth > 6) return '…'
      const out: Record<string, Json> = {}
      for (const [key, item] of Object.entries(value)) out[key] = this.compactValue(item, depth + 1)
      return out
    }
    return value
  }

  /** Record one event; its id is the anchor of its source. Uniqueness is checked once the record is assembled. */
  emit(event: DraftInput) {
    const source = { ...event.source, path: this.sourcePath(event.source.path) }
    this.events.push({ ...event, source, id: anchorId(source), order: this.order++ })
  }
  /** Claim an object's events for one node; false when another node already holds them. */
  claim(objectSha256: string, nodeId: string, rel: string) {
    const holder = this.claimed.get(objectSha256)
    if (holder && holder !== nodeId) {
      this.gaps.push({ nodeId, code: 'source-shared', detail: `${this.sourcePath(rel)} is already the conversation of ${holder}` })
      return false
    }
    this.claimed.set(objectSha256, nodeId)
    return true
  }

  // ----- nodes -----
  nodeFor(id: unknown): string {
    if (typeof id === 'string') {
      let current = id
      while (current) {
        if (this.nodes.has(current)) return current
        const cut = current.lastIndexOf(':s')
        if (cut <= 0) break
        current = current.slice(0, cut)
      }
    }
    return this.rootId
  }
  /** The node `id`, created from `fields` on first sight. */
  ensureNode(id: string, fields: Partial<NodeDraft>) {
    const node = this.nodes.get(id) ?? blankNode(id, fields)
    this.nodes.set(id, node)
    return node
  }
  addSandbox(node: NodeDraft | undefined, id: unknown) {
    if (node && typeof id === 'string' && /^sandbox-/.test(id) && !node.sandboxes.includes(id)) node.sandboxes.push(id)
  }

  blob(ref: unknown): { rel: string; value: Json } | null {
    const hex = hexOf(ref)
    if (!hex) return null
    const rel = `blobs/sha256-${hex}.json`
    const abs = join(this.runDir, rel)
    if (!existsSync(abs)) return null
    try {
      return { rel, value: JSON.parse(this.file(rel).text) }
    } catch {
      return null
    }
  }

  // ----- run input -----
  readRunInput() {
    let rel = 'run-input.json'
    let abs = join(this.runDir, rel)
    if (!existsSync(abs)) {
      // A version directory (<run>.vN) shares its run's input.
      const match = /^(.*)\.v\d+$/.exec(this.runId)
      const sibling = match ? join(dirname(this.runDir), match[1]!, 'run-input.json') : null
      if (!sibling || !existsSync(sibling)) return
      rel = `../${match![1]}/run-input.json`
      abs = sibling
    }
    try {
      const entry = this.file(rel, abs)
      this.runInput = JSON.parse(entry.text)
      this.runInputRel = rel
      this.fileSource(rel, abs)
    } catch {
      this.gaps.push({ nodeId: null, code: 'input-unreadable', detail: `${rel} is not valid JSON` })
      return
    }
    const files = this.runInput?.placement?.childFiles
    if (Array.isArray(files))
      files.forEach((file: Json, i: number) => {
        if (typeof file?.content === 'string')
          this.pointerSource(rel, pointerOf('placement', 'childFiles', i, 'content'), file.content, str(file.path) || undefined)
      })
  }

  // ----- journal -----
  readJournal() {
    const rel = 'spawn-journal.jsonl'
    const abs = join(this.runDir, rel)
    if (!existsSync(abs)) return
    const entry = this.file(rel)
    this.fileSource(rel)
    const rows = splitLines(entry.bytes)
    const runtimeOf = new Map<string, string>()
    for (const row of rows) {
      const event = row.value?.event
      if (event?.kind !== 'spawned' || typeof event.id !== 'string' || this.nodes.has(event.id)) continue
      const id: string = event.id
      const cut = id.lastIndexOf(':s')
      const parent = typeof event.parent === 'string' ? event.parent : cut > 0 ? id.slice(0, cut) : null
      if (!parent && this.nodes.size === 0) this.rootId = id
      const role = str(event.label) || (parent ? 'worker' : 'root')
      const suffix = id.startsWith(this.rootId + ':') ? id.slice(this.rootId.length + 1) : id === this.rootId ? '' : id
      this.nodes.set(id, blankNode(id, {
        label: suffix ? `${suffix}${event.key ? ` · ${event.key}` : ''}` : role,
        parent,
        kind: 'agent',
        role,
        start: isoAt(event.at) ?? undefined,
        capture: { channel: 'journal', status: 'absent', reason: null },
        taskDigest: event.identity?.taskDigest,
        profileRef: event.profileRef,
        key: typeof event.key === 'string' ? event.key : undefined,
      }))
      if (typeof event.runtime === 'string') runtimeOf.set(id, event.runtime)
    }
    if (!this.nodes.size) return
    for (const node of this.nodes.values()) if (node.parent && !this.nodes.has(node.parent)) node.parent = null
    if ([...runtimeOf.values()].includes('tangle-sandbox')) this.format = 'cloud'
    else this.format = 'runtime'
    let clock: string | null = null
    let untimed = 0
    for (const row of rows) {
      const event = row.value?.event ?? row.value
      if (!event || typeof event !== 'object') continue
      // A `begin` row names its node only through the journal root path.
      const subjectId = typeof event.id === 'string' ? event.id : str(row.value?.root).split('/').at(-1)
      const node = this.nodes.get(this.nodeFor(subjectId))
      const exact = typeof event.id === 'string' ? this.nodes.get(event.id) : undefined
      const kind = str(event.kind) || 'unknown'
      if (kind === 'materialized' && exact) {
        // A materialization receipt names the model the backend was configured with; what served is only known from
        // a response, so the receipt fills the declared model when no profile does.
        const model = event.receipt?.model
        if (model?.status === 'known' && typeof model.id === 'string' && !exact.model) {
          exact.model = model.id
          exact.modelSource = 'materialization receipt'
        }
        if (event.receipt?.execution?.kind === 'environment') this.addSandbox(exact, event.receipt.execution.id)
        // A bridge session id here is what joins a retained bridge stream to this node (trace/bridge-sessions).
        if (event.receipt?.execution?.kind === 'session' && typeof event.receipt.execution.id === 'string')
          this.executionOf.set(event.receipt.execution.id, { node: exact.id, line: row.line })
      }
      if (exact) {
        this.addSandbox(exact, event.environmentId)
        this.addSandbox(exact, event.request?.source?.environmentId)
        for (const kept of Array.isArray(event.kept) ? event.kept : []) this.addSandbox(exact, kept?.environmentId)
      }
      if ((kind === 'settled' || kind === 'reconciled') && exact) {
        if (kind === 'settled' || !exact.status) {
          exact.status = str(event.status) || exact.status
          exact.end = isoAt(event.at) ?? exact.end
        }
        if (kind === 'reconciled' && !exact.end) exact.end = isoAt(event.at) ?? undefined
      }
      if (exact && typeof event.outRef === 'string' && !exact.outRefs.includes(event.outRef)) exact.outRefs.push(event.outRef)
      const transcript = event.harnessTranscript
      if (exact && transcript) {
        if (transcript.status === 'available' && typeof transcript.transcriptRef === 'string') {
          if (!exact.transcriptRefs.includes(transcript.transcriptRef)) exact.transcriptRefs.push(transcript.transcriptRef)
          if (typeof transcript.harness === 'string') exact.harness ??= transcript.harness
        } else if (typeof transcript.reason === 'string') exact.transcriptReason = transcript.reason
      }
      const observed = isoAt(event.at ?? row.value?.at)
      if (observed) clock = observed
      const at = observed ?? clock
      if (!at || !node) {
        untimed++
        continue
      }
      const { kind: _k, id: _i, seq: _s, at: _a, ...rest } = event
      const label = [kind.replaceAll('-', ' '), event.status ?? event.signal ?? event.record?.classification ?? event.admission?.phase].filter(Boolean).join(' · ')
      const reason = str(event.reason ?? event.cause ?? event.record?.error ?? event.outcome?.error ?? event.detail)
      const spent = event.spent ?? event.spend
      // Metered windows are execution-to-date totals at metering time; carried as
      // scoped usage so the viewer charts them as a cumulative series and never
      // mistakes them for per-response measurements.
      const meteredUsage =
        kind === 'metered' && typeof spent?.tokens?.input === 'number'
          ? { usage: { input: spent.tokens.input, ...(typeof spent.tokens.output === 'number' ? { output: spent.tokens.output } : {}) }, usageScope: 'metered' as const }
          : undefined
      this.emit({
        node: node.id,
        at,
        kind,
        category: 'lifecycle',
        label,
        source: { path: rel, sha256: entry.sha256, line: row.line },
        detail: {
          lifecycle: kind,
          ...(subjectId && subjectId !== node.id ? { subject: subjectId } : {}),
          ...(observed ? {} : { atBasis: 'carried' }),
          ...(reason ? this.shown('publicText', reason, () => this.lineSource(rel, row.line, row.raw)) : {}),
          ...(kind === 'settled' || kind === 'execution-result' ? { isError: event.status === 'down' || event.outcome?.success === false } : {}),
          ...(spent && (kind === 'settled' || kind === 'metered' || kind === 'reconciled') ? { spent: this.compactValue(spent) } : {}),
          ...(meteredUsage ?? {}),
          data: this.compactValue(rest),
        },
      })
    }
    if (untimed) this.gaps.push({ nodeId: null, code: 'journal-untimed-lines', detail: `${untimed} spawn-journal lines carry no time and precede every timed line` })
  }

  resultJson(): Json {
    const abs = join(this.runDir, 'result.json')
    if (!existsSync(abs)) return null
    try {
      const value = JSON.parse(this.file('result.json').text)
      this.fileSource('result.json')
      return value
    } catch {
      return null
    }
  }

  nativeCacheDir(hex: string) {
    return this.nativeRoot ? [hex, `sha256-${hex}`, `sha256:${hex}`].map((name) => join(this.nativeRoot!, name)).find((path) => existsSync(path)) : undefined
  }

  /** Where a native-index session's file sits inside its capture archive. */
  nativePath(session: Json) {
    return ['workspace/__retention__/sessions', session.sandboxSessionId, 'native', ...(typeof session.sourceId === 'string' ? [session.sourceId] : []), session.rootScope, session.path].join('/')
  }

  /** The latest stored copy per node in `evidence/native-index.jsonl` (a torn last line from a crash is skipped). */
  nativeIndex(): Map<string, Json> {
    if (this.nativeIndexCache) return this.nativeIndexCache
    const latest = new Map<string, Json>()
    const abs = join(this.runDir, NATIVE_INDEX)
    if (existsSync(abs)) {
      this.listSource(NATIVE_INDEX)
      for (const row of splitLines(this.options.files?.read(abs).bytes ?? readFileSync(abs))) {
        const entry = row.value
        if (entry?.schema !== 'disco.native-capture.v1' || typeof entry.nodeId !== 'string') continue
        const held = latest.get(entry.nodeId)
        if (!held || String(entry.at) >= String(held.at)) latest.set(entry.nodeId, entry)
      }
    }
    return (this.nativeIndexCache = latest)
  }

  /** A source line the converter does not interpret: its type, and its fields with long strings shortened. */
  emitRecord(node: NodeDraft, at: string, source: EventSource, value: Json, extra: Record<string, unknown> = {}) {
    const type = str(value?.type) || 'unknown'
    const subtype = str(value?.subtype ?? value?.customType ?? value?.payload?.type)
    const { type: _t, timestamp: _ts, message: _m, ...rest } = value ?? {}
    this.emit({
      node: node.id,
      at,
      kind: 'record',
      category: type === 'system' || type === 'session' || type.endsWith('_change') ? 'lifecycle' : 'other',
      label: [type.replaceAll('_', ' '), subtype.replaceAll('_', ' ')].filter(Boolean).join(' · '),
      source,
      detail: { recordType: type, ...(subtype ? { recordSubtype: subtype } : {}), ...extra, data: this.compactValue(value?.message ? { ...rest, message: value.message } : rest) },
    })
  }

  // ----- channel 0: the live Sandbox event stream of a node that has not settled -----
  /**
   * While a node runs, its conversation is its Sandbox session's event stream as recorded so far: the final state of each
   * part id (text, reasoning, tool call with input and output). It is the live view only: once the node settles, its
   * native session is read instead, so one turn is never shown from both.
   */
  readLiveStream(node: NodeDraft) {
    const dir = `${LIVE_STREAM}/${encodeURIComponent(node.id)}`
    let produced = 0
    for (const rel of filesUnder(this.runDir, dir, '.jsonl')) {
      const entry = this.file(rel)
      if (!this.claim(entry.sha256, node.id, rel)) continue
      this.fileSource(rel)
      const rows = splitLines(entry.bytes).filter((row) => row.value && typeof row.value === 'object')
      produced += projectPartEvents(this, node, rel, entry, rows.map((row) => row.value), {
        where: (index) => ({ line: rows[index].line }),
        full: (index) => this.lineSource(rel, rows[index].line, rows[index].raw),
      }, categoryOf)
    }
    if (!produced) return false
    node.capture = { channel: 'live', status: 'lossy', reason: 'live-stream-until-settled' }
    return true
  }

  // ----- channel 4: output blob parts -----
  readParts(node: NodeDraft) {
    const blobs = node.outRefs.map((ref) => this.blob(ref)).filter((blob): blob is { rel: string; value: Json } => Array.isArray(blob?.value?.events))
    if (!blobs.length) return false
    let produced = 0
    for (const blob of blobs) {
      const entry = this.fileSource(blob.rel)
      if (!this.claim(entry.sha256, node.id, blob.rel)) continue
      produced += projectPartEvents(this, node, blob.rel, entry, blob.value.events, {
        where: (index) => ({ pointer: pointerOf('events', index) }),
        full: (index, path, value) => this.pointerSource(blob.rel, pointerOf('events', index, ...path), value),
      }, categoryOf)
    }
    if (!produced) return false
    node.capture = { channel: 'part', status: 'lossy', reason: 'output-parts-final-state' }
    return true
  }

  // ----- channel 5: root stream -----
  readRootStream(node: NodeDraft) {
    const rel = 'root-stream.jsonl'
    const abs = join(this.runDir, rel)
    if (!existsSync(abs)) return false
    const entry = this.file(rel)
    const rows = splitLines(entry.bytes).filter((row) => row.value?.event)
    if (!rows.length) return false
    if (!this.claim(entry.sha256, node.id, rel)) return false
    this.fileSource(rel)
    // A resumed attempt can replay its predecessor from the start; drop the replayed prefix.
    const fingerprint = (row: Line) => {
      const event = row.value.event
      return `${event.kind}\0${event.toolCallId ?? ''}\0${sha(JSON.stringify(event.text ?? event.args ?? event.result ?? ''))}`
    }
    const byAttempt = new Map<number, Line[]>()
    for (const row of rows) {
      const attempt = Number(row.value.attempt ?? 1)
      const list = byAttempt.get(attempt) ?? []
      list.push(row)
      byAttempt.set(attempt, list)
    }
    const kept: Line[] = []
    let previous: Line[] = []
    let replayed = 0
    for (const attempt of [...byAttempt.keys()].sort((a, b) => a - b)) {
      const list = byAttempt.get(attempt)!
      let skip = 0
      while (skip < list.length && skip < previous.length && fingerprint(list[skip]!) === fingerprint(previous[skip]!)) skip++
      replayed += skip
      kept.push(...list.slice(skip))
      previous = list
    }
    let block: { kind: string; rows: Line[] } | null = null
    let untimed = 0
    const callIds = new Set<string>()
    const resultIds = new Set<string>()
    const flush = () => {
      if (!block) return
      const first = block.rows[0]!
      const text = block.rows.map((row) => str(row.value.event.text)).join('')
      const at = isoAt(first.value.at)
      const lastRow = block.rows.at(-1)!
      if (at && text.trim()) {
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: 'reasoning',
          label: 'assistant',
          source: { path: rel, sha256: entry.sha256, line: first.line },
          detail: {
            role: 'assistant',
            ...(first.value.seq !== undefined ? { nativeRecordId: String(first.value.seq) } : {}),
            ...this.shown(block.kind === 'text_delta' ? 'publicText' : 'reasoning', text, block.rows.length === 1 ? () => this.lineSource(rel, first.line, first.raw) : null),
            ...(block.rows.length > 1 ? { anchorRange: [first.line, lastRow.line] } : {}),
          },
        })
      }
      block = null
    }
    for (const row of kept) {
      const event = row.value.event
      const kind = str(event.kind)
      if (kind === 'text_delta' || kind === 'reasoning_delta') {
        if (block && block.kind !== kind) flush()
        block ??= { kind, rows: [] }
        block.rows.push(row)
        continue
      }
      flush()
      const at = isoAt(row.value.at)
      if (!at) {
        untimed++
        continue
      }
      const source = { path: rel, sha256: entry.sha256, line: row.line }
      const native = row.value.seq !== undefined ? { nativeRecordId: String(row.value.seq) } : {}
      const full = () => this.lineSource(rel, row.line, row.raw)
      if (kind === 'tool_call') {
        // A stream row without args says nothing about them: the call omits `input` rather than claiming `{}`.
        callIds.add(str(event.toolCallId))
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: categoryOf(str(event.toolName), event.args),
          label: `assistant · ${str(event.toolName)}`,
          source,
          detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(event.toolCallId), name: str(event.toolName), ...(event.args === undefined || event.args === null ? {} : this.shown('input', JSON.stringify(event.args), full)) }] },
        })
      } else if (kind === 'tool_result') {
        const result = event.result
        const body = typeof result === 'string' ? result : result && typeof result === 'object' && typeof result.error === 'string' && Object.keys(result).length === 1 ? result.error : JSON.stringify(result ?? null)
        resultIds.add(str(event.toolCallId))
        this.emit({
          node: node.id,
          at,
          kind: 'tool-result',
          category: categoryOf(str(event.toolName), null),
          label: `tool result · ${str(event.toolName)}`,
          source,
          detail: {
            role: 'toolResult',
            ...native,
            toolCallId: str(event.toolCallId),
            isError: Boolean(result && typeof result === 'object' && ('error' in result || result.isError === true)),
            ...this.shown('publicText', body, full),
          },
        })
      } else {
        // Turn boundaries, usage and status rows are events of their own kind.
        this.emitRecord(node, at, source, { ...event, type: kind || 'event' }, native)
      }
    }
    flush()
    if (untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} rows of ${this.sourcePath(rel)} carry no time` })
    if (replayed) this.gaps.push({ nodeId: node.id, code: 'root-replay-dropped', detail: `${replayed} rows of a resumed attempt repeat its predecessor and are not events` })
    const unanswered = [...callIds].filter((id) => !resultIds.has(id)).length
    node.capture = {
      channel: 'root',
      status: unanswered || replayed ? 'lossy' : 'complete',
      reason: unanswered ? 'tool-results-not-streamed' : replayed ? 'resumed-attempt-replay-dropped' : null,
    }
    return true
  }

  // ----- knowledge pages -----
  /** Every kb/pages/**\/*.md under `dir` (relative to the run) becomes one whole-object finding event. */
  readFindings(nodeId: string, dir = 'kb/pages', paths?: string[]) {
    const files = paths ?? filesUnder(this.runDir, dir, '.md')
    let node = this.nodes.get(nodeId)
    for (const rel of files.sort()) {
      const entry = this.file(rel)
      this.fileSource(rel)
      const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(entry.text)
      const field = (key: string) => (front ? new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(front[1]!)?.[1]?.trim() : undefined) || undefined
      // A page without createdAt (a RESULT.md) is timed by the modification time its snapshot captured; nothing else
      // (the reading host's clock or file system) is used, so the record stays a function of the snapshot.
      const declared = isoAt(field('createdAt')) ?? isoAt(field('updatedAt'))
      const listed = this.manifestFiles.get(this.sourcePath(rel))?.mtime
      const captured = declared ? null : isoAt(typeof listed === 'number' && listed < 1e11 ? listed * 1000 : listed)
      const at = declared ?? captured
      if (!at) {
        this.gaps.push({ nodeId, code: 'finding-untimed', detail: `${this.sourcePath(rel)} has no createdAt and its snapshot records no mtime` })
        continue
      }
      const bodyStart = front ? front.index + front[0].length : 0
      const raw = entry.text.slice(bodyStart)
      const body = raw.trim()
      const bodyLine = entry.text.slice(0, bodyStart + (raw.length - raw.trimStart().length)).split('\n').length
      node ??= this.ensureNode(nodeId, { label: 'Recorded findings', kind: 'finding', role: 'Findings', capture: { channel: 'kb', status: 'complete', reason: null } })
      const title = field('title')?.replace(/^(['"])(.*)\1$/, '$2')
      this.emit({
        node: nodeId,
        at,
        kind: 'finding-record',
        category: 'verification',
        label: title ?? basename(rel, '.md'),
        source: { path: rel, sha256: entry.sha256 },
        detail: {
          ...(title ? { title } : {}),
          createdAt: at,
          ...(captured ? { atBasis: 'snapshot-mtime' } : {}),
          ...(field('kind') ? { pageKind: field('kind') } : {}),
          bodyLine,
          contentSha256: sha(body),
          ...this.shown('recordedClaim', body, () => this.fileSource(rel)),
        },
      })
    }
    return files.length
  }

  /** Read every channel of the run into nodes and events. */
  convert() {
    const runDir = this.runDir
    let stats
    try {
      stats = statSync(runDir)
    } catch {
      throw new RunUnreadableError(`Run directory is unreadable: ${runDir}`)
    }
    if (!stats.isDirectory()) throw new RunUnreadableError(`Not a directory: ${runDir}`)
    this.readRunInput()
    this.readJournal()
    const result = (this.result = this.resultJson())
    const hasJournal = this.nodes.size > 0
    const pages = filesUnder(runDir, 'kb/pages', '.md')
    if (!hasJournal) {
      // Files only: a snapshot holds no empty directory, so the record cannot depend on one (an archive extraction has them).
      const runtimeFiles = ['result.json', 'root-stream.jsonl', 'native-trajectory.json', 'run-input.json'].some((name) => existsSync(join(runDir, name))) ||
        walk(join(runDir, 'trace')).length > 0
      this.format = existsSync(join(runDir, 'native-trajectory.json'))
        ? 'bridge-native'
        : existsSync(join(runDir, 'failure.json'))
          ? 'failure-only'
          : existsSync(join(runDir, 'ledger.jsonl'))
            ? 'search'
            : !runtimeFiles && pages.length
              ? 'finding-only'
              : 'other'
      if (this.format !== 'finding-only') {
        this.nodes.set(this.runId, blankNode(this.runId, { label: 'root', kind: 'agent', role: 'root', capture: { channel: 'journal', status: 'absent', reason: 'no-spawn-journal' } }))
        this.rootId = this.runId
        if (!runtimeFiles || this.format === 'search')
          this.gaps.push({ nodeId: null, code: 'unsupported-format', detail: `No spawn journal in ${this.format === 'search' ? 'a search ledger' : 'this layout'}` })
      }
    }
    const root = this.nodes.get(this.rootId)
    if (root && existsSync(join(runDir, 'native-trajectory.json')) && this.format !== 'cloud') this.format = 'bridge-native'
    if (root && filesUnder(runDir, 'trace/pi-sessions', '.jsonl').length) this.format = 'pi-local'

    // Declared models, harness and assignment from the profile and task.
    const input = this.runInput
    if (root && input?.profile) {
      const model = input.profile.model
      root.model = typeof model === 'string' ? model : typeof model?.default === 'string' ? model.default : typeof model?.id === 'string' ? model.id : root.model
      root.modelSource = 'run input profile'
      if (typeof input.profile.harness === 'string') root.harness = input.profile.harness
    }
    const task = input?.task
    const assignmentText = typeof task === 'string' ? task : typeof task?.instruction === 'string' ? task.instruction : typeof task?.objective === 'string' ? task.objective : null
    if (root && assignmentText) root.assignment = this.clip(assignmentText, null).text
    for (const node of this.nodes.values()) {
      if (node.profileRef) {
        const profile = this.blob(node.profileRef)?.value
        if (profile && typeof profile === 'object') {
          const model = profile.model
          const declared = typeof model === 'string' ? model : typeof model?.default === 'string' ? model.default : null
          if (declared) {
            node.model = declared
            node.modelSource = 'spawn profile'
          }
          if (typeof profile.harness === 'string') node.harness = profile.harness
        }
      }
      if (node.taskDigest && !node.assignment) {
        const blob = this.blob(node.taskDigest)
        if (blob && typeof blob.value === 'string') node.assignment = this.clip(blob.value, null).text
      }
    }
    if (root && result?.rootHarnessTranscript?.status === 'available' && typeof result.rootHarnessTranscript.transcriptRef === 'string') {
      if (!root.transcriptRefs.includes(result.rootHarnessTranscript.transcriptRef)) root.transcriptRefs.push(result.rootHarnessTranscript.transcriptRef)
    } else if (root && typeof result?.rootHarnessTranscript?.reason === 'string') root.transcriptReason ??= result.rootHarnessTranscript.reason

    // Conversation channels, first available wins.
    const pi = piSessions(this)
    const piByNode = new Map<string, PiSession[]>()
    const digests = new Map<string, string>()
    for (const node of this.nodes.values()) if (node.taskDigest) digests.set(node.taskDigest, node.id)
    // cli-bridge keeps each Pi session under sha256("cli-bridge/pi-session\0" + bridge session id), and that id is the
    // execution id in the child's materialization receipt: an exact join even for a session with no prompt.
    const bridgeDirs = new Map<string, { node: string; line: number; sessionId: string }>()
    for (const [sessionId, at] of this.executionOf) bridgeDirs.set(sha(`cli-bridge/pi-session\0${sessionId}`), { ...at, sessionId })
    const piBasis = new Map<string, string>()
    const piProof = new Map<string, Record<string, unknown>>()
    const unjoined: PiSession[] = []
    for (const session of pi) {
      const dir = /^trace\/pi-sessions\/cli-bridge\/([0-9a-f]{64})\//.exec(session.rel)?.[1]
      const bridge = dir ? bridgeDirs.get(dir) : undefined
      const nodeId = bridge?.node ?? (session.digest ? digests.get(session.digest) : undefined)
      if (nodeId) {
        const list = piByNode.get(nodeId) ?? []
        list.push(session)
        piByNode.set(nodeId, list)
        if (bridge) {
          piBasis.set(nodeId, 'bridge-session-directory')
          piProof.set(nodeId, { journal: { path: this.sourcePath('spawn-journal.jsonl'), line: bridge.line }, session: { path: this.sourcePath(session.rel) }, sessionId: bridge.sessionId })
        } else if (!piBasis.has(nodeId)) piBasis.set(nodeId, 'task-digest')
      } else unjoined.push(session)
    }
    const streamsByNode = new Map<string, BridgeStream>()
    for (const stream of bridgeStreams(this)) {
      const joined = stream.sessionId ? this.executionOf.get(stream.sessionId) : undefined
      if (joined && !streamsByNode.has(joined.node)) streamsByNode.set(joined.node, stream)
      else {
        this.fileSource(stream.rel)
        this.gaps.push({ nodeId: null, code: 'bridge-stream-unjoined', detail: `${this.sourcePath(stream.rel)} names no materialized session of this run` })
      }
    }
    for (const node of [...this.nodes.values()]) {
      const settled = node.status !== undefined || (node.id === this.rootId && Boolean(result))
      if (!settled && this.readLiveStream(node)) continue
      const native = nativeFiles(this, node)
      if (Array.isArray(native)) {
        readNative(this, node, native)
        continue
      }
      const store = nativeStore(this, node)
      if (store && readOpenCodeStore(this, node, store)) continue
      if (native === 'not-cached')
        this.gaps.push({ nodeId: node.id, code: 'archived-not-ingested', detail: 'A native transcript archive exists but is not in the native cache' })
      if (node.id === this.rootId && existsSync(join(runDir, 'native-trajectory.json')) && readOpenCode(this, node)) continue
      const sessions = piByNode.get(node.id)
      if (sessions?.length) {
        node.joinBasis = piBasis.get(node.id) ?? 'task-digest'
        if (piProof.has(node.id)) node.joinProof = piProof.get(node.id)
        readPi(this, node, sessions)
        continue
      }
      const stream = streamsByNode.get(node.id)
      if (stream && readBridgeStream(this, node, stream)) {
        node.joinBasis = 'bridge-session-id'
        node.joinProof = {
          journal: { path: this.sourcePath('spawn-journal.jsonl'), line: this.executionOf.get(stream.sessionId!)!.line },
          stream: { path: this.sourcePath(stream.rel), line: stream.sessionLine },
          sessionId: stream.sessionId,
        }
        continue
      }
      if (this.readParts(node)) continue
      if (node.id === this.rootId && this.readRootStream(node)) continue
      const reason = native === 'not-cached' ? 'native-archive-not-cached' : node.transcriptReason ?? (node.outRefs.length ? 'no-conversation-in-output' : 'no-conversation-channel')
      node.capture = { channel: 'journal', status: 'absent', reason }
      this.gaps.push({ nodeId: node.id, code: `no-transcript:${reason}`, detail: 'Only lifecycle events are recorded for this agent' })
    }
    this.readCoordination()
    // Every other channel is a listed source, never duplicated as events.
    for (const name of ['root-stream.jsonl', 'native-trajectory.json', 'observer.jsonl', 'driver-attempts.jsonl', 'spans.otlp.jsonl'])
      this.listSource(name)
    for (const session of unjoined) {
      const id = `pi:${session.sessionId}`
      const node = blankNode(id, { label: `pi ${session.sessionId.slice(0, 8)}`, joinBasis: 'unresolved' })
      this.nodes.set(id, node)
      readPi(this, node, [session])
      node.nativeSessionId = session.sessionId
      this.gaps.push({ nodeId: id, code: 'pi-session-unjoined', detail: 'No spawned task digest matches this session' })
    }
    if (pages.length) this.readFindings(`finding:${this.runId}`)
  }

  /** The coordination log records both a parent's outgoing instruction and what the worker received. */
  readCoordination() {
    const rel = 'coordination-log.jsonl'
    if (!existsSync(join(this.runDir, rel))) return
    const entry = this.file(rel)
    this.fileSource(rel)
    const senders = new Set<string>()
    for (const row of splitLines(entry.bytes)) {
      const instruction = row.value?.event?.type === 'instruction' ? row.value.event.instruction : null
      const text = typeof instruction?.instruction === 'string' ? instruction.instruction : ''
      const to = typeof instruction?.toWorker === 'string' ? instruction.toWorker : null
      const at = isoAt(row.value?.at)
      if (!instruction || !at) continue
      // The sender is the recipient's parent; an instruction to a worker this journal never spawned is not guessed.
      const sender = to ? this.nodes.get(to)?.parent ?? (this.nodes.has(to) ? this.rootId : null) : null
      if (!sender || !this.nodes.has(sender)) {
        this.gaps.push({ nodeId: null, code: 'coordination-target-unknown', detail: `${this.sourcePath(rel)} line ${row.line} names no spawned worker (${to ?? 'no toWorker'})` })
        continue
      }
      const kind = str(instruction.kind) || 'instruction'
      const shown = text ? this.clip(text, () => this.lineSource(rel, row.line, row.raw)) : { text: '', clip: undefined }
      this.emit({
        node: sender,
        at,
        kind: 'message',
        category: 'coordination',
        label: `${kind} → ${this.nodes.get(to)!.label}`,
        source: { path: rel, sha256: entry.sha256, line: row.line },
        detail: {
          role: 'assistant',
          ...(shown.text ? { publicText: shown.text } : {}),
          ...(shown.clip ? { clip: shown.clip } : {}),
          coordination: { kind, toNode: to, receiptId: str(instruction.receiptId) || null, interrupt: instruction.interrupt === true },
        },
      })
      if (to && shown.text && kind !== 'interrupt') {
        // A retained native user turn is the better source for the same instruction.
        const native = this.events.find((event) => event.node === to && event.detail.role === 'user' && event.detail.publicText === shown.text && Math.abs(Date.parse(event.at) - Date.parse(at)) < 60_000)
        if (native) {
          native.detail.promptKind = 'steering'
          native.detail.promptSender = 'Parent agent'
        } else {
          this.emit({
            node: to,
            at,
            kind: 'message',
            category: 'other',
            label: 'Steering',
            source: { path: rel, sha256: entry.sha256, line: row.line, item: 1 },
            detail: {
              role: 'user',
              publicText: shown.text,
              ...(shown.clip ? { clip: shown.clip } : {}),
              promptKind: 'steering',
              promptSender: 'Parent agent',
              coordination: { kind, fromNode: sender, receiptId: str(instruction.receiptId) || null },
            },
          })
        }
      }
      senders.add(sender)
    }
    for (const id of senders) {
      const node = this.nodes.get(id)!
      if (node.capture.status !== 'absent') continue
      node.capture = { channel: 'coordination', status: 'lossy', reason: 'instructions-to-workers-only' }
      const at = this.gaps.findIndex((gap) => gap.nodeId === id && gap.code.startsWith('no-transcript:'))
      const gap = { nodeId: id, code: 'conversation-not-retained', detail: 'Only the instructions this agent sent to its workers were retained (coordination log)' }
      if (at >= 0) this.gaps[at] = gap
      else this.gaps.push(gap)
    }
  }

  /** Assemble the record from what convert() (or a bundle) read. */
  assemble(extra: { title?: string; assignment?: Json; terminal?: Json; format?: string; input?: Record<string, unknown> } = {}) {
    const root = this.nodes.get(this.rootId)
    const result = this.result
    const task = this.runInput?.task
    // Results inherit their call's category; durations come from the pair when the source lacks them.
    const calls = new Map<string, Draft>()
    for (const event of this.events)
      for (const call of (event.detail.publicToolCalls as { id: string }[] | undefined) ?? []) calls.set(`${event.node}\0${call.id}`, event)
    for (const event of this.events) {
      const callId = event.detail.toolCallId
      if (typeof callId !== 'string') continue
      const call = calls.get(`${event.node}\0${callId}`)
      if (!call) continue
      if (event.category === 'other') event.category = call.category
      if (event.detail.durationMs === undefined) {
        const duration = Date.parse(event.at) - Date.parse(call.at)
        if (duration >= 0 && event.detail.atBasis !== 'carried') event.detail.durationMs = duration
      }
    }

    // Node start and end fall back to their first and last recorded events.
    const nodeOrder = new Map([...this.nodes.keys()].map((id, i) => [id, i]))
    const span = spans(this.events)
    for (const node of this.nodes.values()) {
      const bounds = span.get(node.id)
      if (!node.start && bounds) node.start = bounds[0]
      if (!node.end && bounds && node.kind === 'session') node.end = bounds[1]
    }
    // A root never settles in its own journal; the run's result is its terminal state.
    if (root && result && !root.status && typeof result.kind === 'string') {
      root.status = result.kind
      root.end ??= span.get(root.id)?.[1]
    }

    this.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (nodeOrder.get(a.node)! - nodeOrder.get(b.node)!) || a.order - b.order))
    // anchor.v1 ids are unique by construction; a repeat means two events claim the same bytes.
    const ids = new Set<string>()
    for (const event of this.events) {
      if (ids.has(event.id)) throw new SnapshotMismatchError(`duplicate anchor ${event.id} (${event.source.path}${event.source.line ? `:${event.source.line}` : event.source.pointer ?? ''})`)
      ids.add(event.id)
    }
    // A 12-hex object prefix names exactly one object among the record's sources.
    const objects = new Map<string, string>()
    for (const source of this.sources.values()) {
      if (!source.sha256 || source.line !== undefined || source.pointer !== undefined) continue
      const prefix = source.sha256.slice(0, 12)
      const known = objects.get(prefix)
      if (known && known !== source.sha256) throw new SnapshotMismatchError(`object prefix ${prefix} names two objects`)
      objects.set(prefix, source.sha256)
    }

    const captures = [...this.nodes.values()].map((node) => ({ nodeId: node.id, ...node.capture }))
    const counts = { complete: 0, lossy: 0, absent: 0 }
    for (const capture of captures) counts[capture.status]++
    // The original capture is complete only when there are agents and every one of them is fully captured: finding
    // pages alone (a finding-only run) are what an agent wrote, not the agent's record.
    const agents = captures.filter((capture) => this.nodes.get(capture.nodeId)?.kind !== 'finding')
    // "Served" needs an observed response: a node with no successful assistant message keeps its declared model only.
    const answered = new Set(
      this.events.filter((event) => event.kind === 'message' && event.detail.role === 'assistant' && event.detail.responseStatus !== 'error').map((event) => event.node),
    )
    const priced = this.events.some((event) => num(event.detail.costListUsd) !== undefined)
    const asText = (value: Json) => (typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : '')
    const knowledge = asText(task?.knowledge)
    const completion = asText(task?.completion)
    const record = {
      schema: 'agent-record.v1',
      runId: this.runId,
      title: extra.title ?? this.runId,
      producer: { name: '@drewstone/agent-record/adapters/agent-runtime', version: ADAPTER_VERSION },
      idScheme: ID_SCHEME,
      input: {
        ...(this.options.manifestSha256 ? { snapshot: `sha256:${this.options.manifestSha256}` } : {}),
        runIdBasis: this.runIdBasis,
        ...extra.input,
      },
      format: extra.format ?? this.format,
      nodes: [...this.nodes.values()].map((node) => ({
        id: node.id,
        label: node.label,
        parent: node.parent,
        kind: node.kind,
        role: node.role,
        ...(node.assignment ? { assignment: node.assignment } : {}),
        model: node.model,
        ...(node.modelSource ? { modelSource: node.modelSource } : {}),
        servedModel: answered.has(node.id) ? node.servedModel : null,
        harness: node.harness,
        ...(node.start ? { start: node.start } : {}),
        ...(node.end ? { end: node.end } : {}),
        ...(node.status ? { status: node.status } : {}),
        ...(node.nativeSessionId ? { nativeSessionId: node.nativeSessionId } : {}),
        ...(node.agentId ? { agentId: node.agentId } : {}),
        ...(node.joinBasis ? { joinBasis: node.joinBasis } : {}),
        ...(node.joinProof ? { joinProof: node.joinProof } : {}),
        sandboxes: node.sandboxes,
        capture: node.capture,
      })),
      events: this.events.map(({ order: _order, ...event }) => event),
      sources: [...this.sources.values()].map(({ sha256, ...source }) => (sha256 ? { ...source, sha256 } : source)).sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0) || (a.pointer ?? '').localeCompare(b.pointer ?? ''),
      ),
      assignment: extra.assignment ?? {
        objective: str(task?.objective),
        instruction: str(task?.instruction ?? (typeof task === 'string' ? task : '')),
        knowledge,
        completion,
        suppliedKnowledge: knowledge,
        deliverables: completion,
        constraints: '',
        source: this.runInputRel ? { path: this.sourcePath(this.runInputRel), sha256: this.file(this.runInputRel, this.runInputRel.startsWith('../') ? join(dirname(this.runDir), this.runInputRel.slice(3)) : undefined).sha256, pointer: '/task' } : null,
      },
      terminal: extra.terminal !== undefined
        ? extra.terminal
        : result
          ? {
              kind: typeof result.kind === 'string' ? result.kind : null,
              reason: typeof result.reason === 'string' ? result.reason : null,
              ...(typeof result.error?.message === 'string' ? { error: this.clip(result.error.message, null).text } : {}),
            }
          : null,
      coverage: {
        completeOriginalCapture: agents.length > 0 && agents.every((capture) => capture.status === 'complete'),
        publicContent: '',
        categoryMethod: 'Activity types are keyword matches on tool names and commands. They do not measure research value or show independent verification.',
        cost: priced ? 'List price from recorded usage; not billed.' : 'Not recorded',
        nodes: captures,
        gaps: this.gaps.map((gap) => ({ runId: this.runId, ...gap })),
      },
    }
    return { record, counts }
  }
}

/**
 * Check a directory against its snapshot manifest before anything is read: the same set of files, each with the
 * manifest's length and sha256. `prefix` is the directory's place inside the manifest (a run inside a bundle).
 */
export function verifySnapshot(dir: string, manifest: SnapshotManifest, prefix = '') {
  const listed = new Map(manifest.files.filter((file) => file.path.startsWith(prefix)).map((file) => [file.path.slice(prefix.length), file]))
  const linked = new Set((manifest.links ?? []).filter((link) => link.path.startsWith(prefix)).map((link) => link.path.slice(prefix.length)))
  const present = walk(dir).filter((path) => !linked.has(path))
  const problems: string[] = []
  for (const path of present) if (!listed.has(path)) problems.push(`${prefix}${path} is not in the snapshot`)
  for (const [path, file] of listed) {
    const abs = join(dir, path)
    if (!existsSync(abs)) {
      problems.push(`${prefix}${path} is missing`)
      continue
    }
    const { sha256, bytes } = hashFile(abs)
    if (sha256 !== hexOf(file.sha256) || bytes !== file.bytes) problems.push(`${prefix}${path} does not match its sha256 or length`)
  }
  if (problems.length) throw new SnapshotMismatchError(`${problems.length} files differ from the snapshot: ${problems.slice(0, 5).join('; ')}`)
}

/** Serialize and check a record. Throws RecordTooLargeError. */
export function finishRecord(record: Json, counts: IngestSummary['coverage']) {
  const checked = recordSchema.safeParse(record)
  if (!checked.success) throw new Error(`Produced record is invalid: ${checked.error.message.slice(0, 2000)}`)
  const json = JSON.stringify(record)
  const bytes = Buffer.byteLength(json)
  if (bytes > MAX_RECORD_BYTES) throw new RecordTooLargeError(`record-too-large: ${bytes} bytes`)
  const summary: IngestSummary = {
    runId: record.runId,
    recordDigest: sha(json),
    bytes,
    nodes: record.nodes.length,
    events: record.events.length,
    coverage: counts,
  }
  return { record, json, summary }
}

/** Convert one run directory. Throws RunUnreadableError, SnapshotMismatchError or RecordTooLargeError. */
export function ingestRun(runDir: string, options: IngestOptions = {}) {
  if (options.manifest) verifySnapshot(runDir, options.manifest)
  const ingest = new Ingest(runDir, options.native, Math.max(1024, options.maxText ?? 16384), {
    runId: options.runId,
    manifest: options.manifest,
    manifestSha256: options.manifestSha256,
    files: options.files,
  })
  ingest.convert()
  const { record, counts } = ingest.assemble()
  return finishRecord(record, counts)
}

// ---------------------------------------------------------------------------------------------------------
// Bundles: one record from several native sessions, workflow journals, agent-runtime runs and finding pages.
// bundle.json (agent-record.bundle.v1) sits at the bundle root; every path is relative to it.
// ---------------------------------------------------------------------------------------------------------
export const BUNDLE_SCHEMA = 'agent-record.bundle.v1'
export type BundleHarness = 'claude-code' | 'codex' | 'opencode' | 'opencode-bridge' | 'pi'
export interface BundleSession {
  path: string
  harness: BundleHarness
  sessionId?: string
  /** The session that launched this one; the converter records it only when the file layout proves it. */
  parentPath?: string
  agentId?: string
  label?: string
  /** Physical line windows, inclusive; lines outside them are out of the record's scope. */
  lines?: [number, number][]
}
export interface Bundle {
  schema: typeof BUNDLE_SCHEMA
  recordId: string
  title?: string
  sessions: BundleSession[]
  journals?: { path: string; kind: 'claude-workflow'; workflow?: string; parentPath?: string; label?: string }[]
  runs?: { path: string; kind: 'agent-runtime'; runId?: string }[]
  findings?: { path: string }[]
}

/** The reader of each harness a bundle session may name. */
const SESSION_READERS: Record<BundleHarness, SessionReader> = {
  'claude-code': readClaudeBundle,
  codex: readCodexBundle,
  opencode: readOpenCodeBundle,
  'opencode-bridge': readBridgeBundle,
  pi: readPiBundle,
}

function parseBundle(value: Json): Bundle {
  if (value?.schema !== BUNDLE_SCHEMA) throw new RunUnreadableError(`bundle.json is not ${BUNDLE_SCHEMA}`)
  if (typeof value.recordId !== 'string' || !value.recordId) throw new RunUnreadableError('bundle.json names no recordId')
  if (!Array.isArray(value.sessions)) throw new RunUnreadableError('bundle.json lists no sessions')
  const safe = (path: unknown) => typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.split('/').includes('..')
  for (const item of [...value.sessions, ...(value.journals ?? []), ...(value.runs ?? []), ...(value.findings ?? [])])
    if (!safe(item?.path)) throw new RunUnreadableError(`bundle.json path ${JSON.stringify(item?.path)} leaves the bundle`)
  return value as Bundle
}

/**
 * Convert a bundle directory. Joins come from evidence only and each records its basis and proof:
 *   workflow-agent-id    a Claude workflow journal's `started` agentId is the agentId carried by a session file
 *                        `agent-<id>.jsonl` beside `agent-<id>.meta.json`
 *   session-directory    a session under `<parent session id>/subagents/` belongs to that parent session
 * A session whose join does not verify stays its own node.
 */
export function ingestBundle(dir: string, options: Omit<IngestOptions, 'runId'> = {}) {
  if (options.manifest) verifySnapshot(dir, options.manifest)
  const bundleText = readFileSync(join(dir, 'bundle.json'), 'utf8')
  const bundle = parseBundle(JSON.parse(bundleText))
  const maxText = Math.max(1024, options.maxText ?? 16384)
  const main = new Ingest(dir, options.native, maxText, { runId: bundle.recordId, manifest: options.manifest, manifestSha256: options.manifestSha256 })
  main.fileSource('bundle.json')

  // Agent-runtime runs first: their nodes and sources keep the run's own ids, under the run's path.
  for (const run of bundle.runs ?? []) {
    const sub = new Ingest(join(dir, run.path), options.native, maxText, {
      runId: run.runId ?? basename(run.path),
      manifest: options.manifest,
      prefix: `${run.path.replace(/\/+$/, '')}/`,
    })
    sub.convert()
    for (const [id, node] of sub.nodes) {
      if (main.nodes.has(id)) throw new SnapshotMismatchError(`node ${id} appears twice in the bundle`)
      main.nodes.set(id, node)
    }
    for (const event of sub.events) main.events.push({ ...event, order: main.order++ })
    for (const [key, source] of sub.sources) if (!main.sources.has(key)) main.sources.set(key, source)
    for (const gap of sub.gaps) main.gaps.push(gap)
    for (const [digest, node] of sub.claimed) main.claimed.set(digest, node)
  }

  // Workflow journals: one workflow node, one agent node per started agent.
  const journalRows: { node: string; rel: string; sha256: string; row: Line; type: string; agentId: string }[] = []
  const agentNodes: WorkflowAgents = new Map()
  for (const journal of bundle.journals ?? []) {
    const entry = main.file(journal.path)
    main.fileSource(journal.path)
    const wfId = basename(dirname(journal.path))
    let workflowStart: string | undefined
    if (journal.workflow) {
      main.fileSource(journal.workflow)
      try {
        workflowStart = isoAt(JSON.parse(main.file(journal.workflow).text)?.timestamp) ?? undefined
      } catch {
        /* the workflow file is listed as a source either way */
      }
    }
    if (!main.nodes.has(wfId))
      main.nodes.set(wfId, blankNode(wfId, { label: journal.label ?? wfId, kind: 'agent', role: 'workflow', harness: 'claude-code-workflow', start: workflowStart, capture: { channel: 'journal', status: 'complete', reason: null } }))
    for (const row of splitLines(entry.bytes)) {
      const agentId = str(row.value?.agentId)
      if (!agentId) continue
      const id = `${wfId}:${agentId}`
      if (!main.nodes.has(id)) {
        main.nodes.set(id, blankNode(id, { label: `agent ${agentId.slice(0, 8)}`, parent: wfId, kind: 'agent', role: 'workflow agent', agentId: undefined }))
        agentNodes.set(agentId, { node: id, rel: journal.path, line: row.line })
      }
      journalRows.push({ node: id, rel: journal.path, sha256: entry.sha256, row, type: str(row.value?.type) || 'row', agentId })
    }
  }

  // Sessions: each harness's reader finds or creates the session's node and reads its file onto it.
  const byPath = new Map<string, string>()
  const pending: { session: BundleSession; node: NodeDraft }[] = []
  for (const session of bundle.sessions) {
    if (!Object.hasOwn(SESSION_READERS, session.harness)) throw new RunUnreadableError(`bundle.json session ${session.path} has an unknown harness`)
    const node = SESSION_READERS[session.harness](main, session, agentNodes)
    byPath.set(session.path, node.id)
    pending.push({ session, node })
  }
  // Parents: a session stored under `<parent session id>/subagents/` belongs to that parent.
  const sessionOwner = (path: string) => /(?:^|\/)([0-9a-f-]{36})\/subagents\//.exec(path)?.[1]
  const proven = (child: string, parent: string) => {
    const owner = sessionOwner(child)
    return owner !== undefined && basename(parent, '.jsonl') === owner
  }
  for (const { session, node } of pending) {
    if (!session.parentPath) continue
    const parent = byPath.get(session.parentPath)
    if (!parent || !proven(session.path, session.parentPath)) {
      main.gaps.push({ nodeId: node.id, code: 'parent-unproven', detail: `${session.path} does not sit under ${session.parentPath}` })
      continue
    }
    const target = node.parent && main.nodes.get(node.parent)?.role === 'workflow' ? main.nodes.get(node.parent)! : node
    if (target.parent && target.parent !== parent) continue
    target.parent = parent
    target.joinBasis ??= 'session-directory'
  }
  for (const journal of bundle.journals ?? []) {
    if (!journal.parentPath) continue
    const parent = byPath.get(journal.parentPath)
    const workflow = main.nodes.get(basename(dirname(journal.path)))
    if (parent && workflow && proven(journal.path, journal.parentPath)) workflow.parent = parent
    else if (workflow) main.gaps.push({ nodeId: workflow.id, code: 'parent-unproven', detail: `${journal.path} does not sit under ${journal.parentPath}` })
  }

  // Journal rows carry no time: a started row takes its session's first event, a result row its last.
  const span = spans(main.events)
  for (const item of journalRows) {
    const bounds = span.get(item.node)
    if (!bounds) {
      main.gaps.push({ nodeId: item.node, code: 'journal-untimed-lines', detail: `${item.rel}:${item.row.line} has no time and no joined session` })
      continue
    }
    const node = main.nodes.get(item.node)!
    if (item.type === 'result') node.status ??= 'settled'
    const { type: _t, agentId: _a, ...rest } = item.row.value
    main.emit({
      node: item.node,
      at: item.type === 'started' ? bounds[0] : bounds[1],
      kind: item.type,
      category: 'lifecycle',
      label: item.type,
      source: { path: item.rel, sha256: item.sha256, line: item.row.line },
      detail: { lifecycle: item.type, atBasis: item.type === 'started' ? 'session-first-event' : 'session-last-event', data: main.compactValue(rest) },
    })
  }
  for (const node of main.nodes.values())
    if (node.role === 'workflow agent' && node.capture.status === 'absent') {
      node.capture = { channel: 'journal', status: 'absent', reason: 'no-session-joined' }
      main.gaps.push({ nodeId: node.id, code: 'no-transcript:no-session-joined', detail: 'No session file carries this workflow agent id' })
    }

  for (const finding of bundle.findings ?? []) {
    const paths = finding.path.endsWith('.md') ? [finding.path] : filesUnder(dir, finding.path.replace(/\/+$/, ''), '.md')
    main.readFindings(`finding:${bundle.recordId}`, undefined, paths)
  }

  main.rootId = ''
  const { record, counts } = main.assemble({
    title: bundle.title ?? bundle.recordId,
    format: 'bundle',
    terminal: null,
    assignment: { objective: '', instruction: '', knowledge: '', completion: '', suppliedKnowledge: '', deliverables: '', constraints: '', source: null },
    input: { bundle: `sha256:${sha(bundleText)}` },
  })
  return finishRecord(record, counts)
}
