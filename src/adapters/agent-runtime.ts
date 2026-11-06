/**
 * The one converter from an agent-runtime run directory (or a bundle of sessions, see ingestBundle) to `agent-record.v1`.
 * Node only. Each harness's session format has one reader (claude.ts, codex.ts, opencode.ts, pi.ts, bridge.ts) over the
 * shared line framing in harness-reader.ts; this file reads the run's own channels and dispatches to them. It reads the run
 * directory and an optional native-transcript cache, never writes either, never touches the network; the same inputs and
 * ADAPTER_VERSION produce identical bytes. With a snapshot manifest (evidence.snapshot.v1) every file is verified against
 * it and every source digest comes from it; the run id comes from the caller or the manifest.
 *
 * Nodes are the `spawned` ids in spawn-journal.jsonl, and the run's root when spawned ids name it as parent without a
 * `spawned` line of its own. Each node's conversation comes from the first channel that holds it, in this order; the
 * others are listed as sources and never duplicated as events:
 *   0. live     while a node has not settled: its Sandbox session events recorded so far (evidence/live-stream/)
 *   1. native   Claude Code session .jsonl files, each from its longest stored copy: a turn's retained-harness-transcript
 *               archive or the run's latest native-index capture (both under --native/<hex>/); else the OpenCode store
 *               (.local/share/opencode/opencode.db) in the node's latest native-index capture, its root sessions read
 *               as the rows a trajectory holds
 *   2. oc       OpenCode native-trajectory.json (bridge-native roots)
 *   3. pi       trace/pi-sessions/**, joined when sha256(JSON.stringify(first user text)) == spawned taskDigest
 *   4. root     root-stream.jsonl (root only; deltas collapse to one block per turn; resumed replays dropped)
 *   5. part     output blob parts at the node's outRefs, collapsed to the final state of each part id
 *   6. live     a settled node's recorded live stream, when no channel above holds it
 *   7. journal  lifecycle events only
 * Knowledge pages (kb/pages/**\/*.md) become finding events on node `finding:<runId>`; a run with only pages is
 * format `finding-only`.
 *
 * Event ids are anchor.v1 (anchor.ts): `<first 12 hex of the object's sha256>:<line or JSON Pointer>[.<item>]`, or the
 * object alone for a whole page; each event's `source` carries the same sha256, line or pointer and item. Every timestamped
 * line becomes exactly one event (or one per content item); an uninterpreted line is a `record` event carrying its type.
 * A duplicate anchor is an error, never suffixed.
 *
 * Sources: every input file, native file and clipped body has a `sources[]` entry whose sha256 covers exactly the bytes a
 * source route serves: the whole file, one physical line (`line`), or the resolved JSON value (`pointer`; a string's UTF-8
 * bytes, otherwise its JSON text; in an OpenCode store `/part/<id>/data` names that part row's data column). Native cache
 * paths start with `native:<hex>/`. A clipped body keeps the first three quarters and the last quarter of `maxText` bytes;
 * `detail.clip.sha256` names the source entry holding the full text.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { recordSchema, type RecordNode } from '../record.js'
import { anchorId, ID_SCHEME } from '../anchor.js'
import { bridgeStreams, readBridgeStream, readRootStream, type BridgeStream } from './bridge.js'
import { nativeFiles, readNative } from './claude.js'
import { categoryOf, hashFile, utf8Slice, filesUnder, hexOf, isoAt, num, pointerOf, sha, splitLines, str, walk, type Category, type EventSource, type Json, type Line, type Source, type FileCache } from './harness-reader.js'
import { nativeStore, readOpenCode, readOpenCodeStore } from './opencode.js'
import { projectPartEvents, projectPartFrames } from './part-events.js'
import { assembleRecord, type AssemblyOptions } from './harness-sessions.js'
import { piSessions, readPi, type PiSession } from './pi.js'

export const ADAPTER_VERSION = '2.8.0'
export { readOpenCodeUsage } from './opencode.js'
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

export { createFileCache, type FileCache } from './harness-reader.js'

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
  nativeUsage?: RecordNode['nativeUsage']
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
export const blankNode = (id: string, fields: Partial<NodeDraft>): NodeDraft => ({
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
    const rows = [...splitLines(entry.bytes)]
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
    if (!this.nodes.has(this.rootId) && [...this.nodes.values()].some((node) => node.parent === this.rootId))
      this.nodes.set(this.rootId, blankNode(this.rootId, { label: 'root', kind: 'agent', role: 'root', start: rows.map((row) => isoAt(row.value?.event?.at)).find(Boolean) ?? undefined, capture: { channel: 'journal', status: 'absent', reason: null } }))
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

  // ----- channels 0 and 6: the live Sandbox event stream of a node -----
  /** A node's Sandbox session event stream as recorded (the final state of each part id): its live view while it runs, and
   *  after it settles only when no other channel holds its conversation, so one turn is never shown from two. */
  readLiveStream(node: NodeDraft, reason = 'live-stream-until-settled') {
    const dir = `${LIVE_STREAM}/${encodeURIComponent(node.id)}`
    let produced = 0
    for (const rel of filesUnder(this.runDir, dir, '.jsonl')) {
      const entry = this.file(rel)
      if (!this.claim(entry.sha256, node.id, rel)) continue
      this.fileSource(rel)
      const ingest = this
      function* frames() {
        for (const row of splitLines(entry.bytes)) if (row.value && typeof row.value === 'object') yield {
          event: row.value, where: () => ({ line: row.line }), full: () => ingest.lineSource(rel, row.line, row.raw),
        }
      }
      produced += projectPartFrames(this, node, rel, entry, frames(), categoryOf)
    }
    if (!produced) return false
    node.capture = { channel: 'live', status: 'lossy', reason }
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
  readRootStream(node: NodeDraft) { return readRootStream(this, node) }

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
      const store = nativeStore(this, node)
      if (!settled && this.readLiveStream(node)) {
        if (store) readOpenCodeStore(this, node, store, true)
        continue
      }
      const native = nativeFiles(this, node)
      if (Array.isArray(native)) {
        readNative(this, node, native)
        if (store) readOpenCodeStore(this, node, store, true)
        continue
      }
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
      // The root's whole stream before its output parts: on 31b the parts held 150 of the turn's 302 tool calls.
      if ((node.id === this.rootId && this.readRootStream(node)) || this.readParts(node)) continue
      if (settled && this.readLiveStream(node, 'live-stream-after-settle')) continue // channel 6: 31b s1:s0's 28 min and `done` usage
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

  assemble(extra: AssemblyOptions = {}) { return assembleRecord(this, extra) }
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

export { BUNDLE_SCHEMA, ingestBundle, type BundleHarness, type BundleSession, type Bundle } from './harness-sessions.js'
