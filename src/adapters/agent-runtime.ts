/**
 * The one converter from an agent-runtime run directory (or a bundle of sessions, see bundle.ts) to `agent-record.v1`.
 * Node only.
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
 *               archive or the run's latest native-index capture (both under --native/<hex>/)
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
 * (`pointer`; a string's UTF-8 bytes, otherwise its JSON text). Paths under the native cache start with
 * `native:<hex>/`. A clipped body keeps the first three quarters and the last quarter of `maxText` bytes;
 * `detail.clip.sha256` names the source entry holding the full text.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { recordSchema } from '../record.js'
import { anchorId, ID_SCHEME } from '../anchor.js'

export const ADAPTER_VERSION = '2.4.0'
export { ID_SCHEME }
export const MAX_RECORD_BYTES = 128 * 1024 * 1024

export type Category =
  | 'coordination'
  | 'compute'
  | 'verification'
  | 'literature'
  | 'writing'
  | 'setup'
  | 'waiting'
  | 'reasoning'
  | 'lifecycle'
  | 'other'

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

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Source = { path: string; sha256: string; bytes: number; line?: number; pointer?: string; label?: string }
type EventSource = { path: string; sha256: string; line?: number; pointer?: string; item?: number }
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

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hexOf = (digest: unknown) =>
  typeof digest === 'string' && /^(sha256[:-])?[0-9a-f]{64}$/.test(digest) ? digest.slice(-64) : null
// A Claude Code main session file inside a harness home; subagent transcripts under `<session>/subagents/` are not.
const CLAUDE_SESSION = /(^|\/)\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/
const sessionKey = (path: string) => (CLAUDE_SESSION.test(path) ? path.slice(path.lastIndexOf('.claude/projects/')) : null)
const NATIVE_INDEX = 'evidence/native-index.jsonl'
// Each running node's Sandbox session events, one JSON line per event as delivered (discovery-lab runner/live-stream.mjs).
const LIVE_STREAM = 'evidence/live-stream'
// Placeholder times such as the Unix epoch are not observations.
const EARLIEST = Date.UTC(2001, 0, 1)
const LATEST = Date.UTC(2100, 0, 1)
const isoAt = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value)
  const time = date.valueOf()
  return Number.isFinite(time) && time >= EARLIEST && time < LATEST ? date.toISOString() : null
}
/**
 * Python's `json.dumps(value, sort_keys=True)` (ASCII escapes, `, ` and `: ` separators). The earlier publication
 * converter hashed native message content this way, so the same content keeps the same contentSha256.
 */
function pythonJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : value < 0 ? '-Infinity' : 'NaN'
    if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value)
    // repr(float): the shortest round-trip digits; fixed notation for exponents -4..15, otherwise d.ddde[+-]XX.
    const [mantissa, exponent] = value.toExponential().split('e') as [string, string]
    if (Number(exponent) >= -4 && Number(exponent) < 16) return /[.e]/.test(String(value)) ? String(value) : `${value}.0`
    return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, '0')}`
  }
  if (typeof value === 'string') {
    let out = '"'
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      const char = value[i]!
      if (char === '"') out += '\\"'
      else if (char === '\\') out += '\\\\'
      else if (char === '\n') out += '\\n'
      else if (char === '\r') out += '\\r'
      else if (char === '\t') out += '\\t'
      else if (char === '\b') out += '\\b'
      else if (char === '\f') out += '\\f'
      else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`
      else out += char
    }
    return `${out}"`
  }
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`
  if (typeof value === 'object')
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${pythonJson(key)}: ${pythonJson((value as Record<string, unknown>)[key])}`)
      .join(', ')}}`
  return 'null'
}
/** A native message's content digest and its character count (text, or thinking where a block has no text). */
function contentDigest(content: Json[]) {
  let characters = 0
  for (const block of content) {
    const body = block && typeof block === 'object' ? ('text' in block ? block.text : 'thinking' in block ? block.thinking : '') : ''
    characters += [...(typeof body === 'string' ? body : body === null ? 'None' : String(body))].length
  }
  return { contentSha256: sha(pythonJson(content)), contentCharacters: characters }
}
const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value))
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

// ---------------------------------------------------------------------------------------------------------
// Category map. Documented here so readers know what an activity type means: it is a keyword map on the
// tool name and, for shell tools, the command. It does not measure research value.
// ---------------------------------------------------------------------------------------------------------
const TOOL_CATEGORIES: [RegExp, Category][] = [
  [/await|wait_?for|wait_agent|^wait$|sleep|poll|watch_events|next_event/, 'waiting'],
  [/spawn|delegate|subagent|^task$|^agent$|send_message|post_message|coordinat|assign|settle|todowrite|^todo|cancel_child|children/, 'coordination'],
  [/^(write|edit|multiedit|notebookedit|str_replace|apply_patch|patch|create_file|write_file|edit_file|file_change|replace)/, 'writing'],
  [/web_?search|web_?fetch|^fetch$|search_papers|arxiv|scholar|knowledge|retriev|literature|crossref|^read|^view|^glob$|^grep$|^ls$|list_dir|open_file|^cat$|search_files|find_files/, 'literature'],
  [/verif|^check|_check|test|lean|prove|proof|validate|assert/, 'verification'],
  [/bash|shell|exec|command|^run|python|terminal|jupyter|interpreter|compute|^sh$/, 'compute'],
]
const SHELL_CATEGORIES: [RegExp, Category][] = [
  [/\b(pip3? install|python3? -m pip install|npm (i|install|ci)\b|pnpm (i|install|add)\b|yarn add|apt(-get)? install|brew install|cargo install|uv (pip|add|sync)\b|conda install|git clone|elan |rustup )/, 'setup'],
  [/^\s*(sleep\b|while\b.*\bsleep\b|until\b)|\bwait\b\s*$/, 'waiting'],
  [/\b(pytest|unittest|cargo test|(npm|pnpm|yarn) (run )?test|lake (build|env)|lean\b|coqc|z3\b|verify|--check\b|sha256sum -c|diff -q)/, 'verification'],
  [/\b(curl|wget)\b[^|]*(arxiv|doi\.org|semanticscholar|scholar|crossref|openalex|https?:)/, 'literature'],
  [/^\s*(cat|head|tail|less|rg|grep|find|ls|wc|tree|file|stat|jq)\b|\bsed -n\b/, 'literature'],
  [/(^|[;&|]\s*)(cat\s*>|tee\b)|\bsed -i\b|>\s*\S+\.(md|tex|json|py|ts|mjs|txt)\b/, 'writing'],
]
export function categoryOf(name: string, input: unknown): Category {
  const tool = name.toLowerCase().replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
  const server = /^mcp__([^_]+(?:[-_][^_]+)*?)__/.exec(name.toLowerCase())?.[1] ?? ''
  const command = (() => {
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input)
        return typeof parsed?.command === 'string' ? parsed.command : typeof parsed?.cmd === 'string' ? parsed.cmd : ''
      } catch {
        return ''
      }
    }
    const value = input as Json
    return typeof value?.command === 'string' ? value.command : typeof value?.cmd === 'string' ? value.cmd : ''
  })()
  let category: Category = 'other'
  for (const [pattern, mapped] of TOOL_CATEGORIES)
    if (pattern.test(tool)) {
      category = mapped
      break
    }
  if (category === 'other' && /coordination/.test(server)) category = 'coordination'
  if ((category === 'compute' || category === 'other') && command) {
    for (const [pattern, mapped] of SHELL_CATEGORIES)
      if (pattern.test(command)) return mapped
    return 'compute'
  }
  return category
}

// ---------------------------------------------------------------------------------------------------------
// File access. Reads only; every path stays inside the run directory or the native cache.
// ---------------------------------------------------------------------------------------------------------
interface Line {
  line: number
  raw: string
  value: Json
}
/**
 * The non-blank physical lines (split on LF) of a file, each decoded on its own: a session larger than the longest
 * string V8 can hold (about 512 MiB) still converts. Lines `keep` rejects (outside a bundle's line window) are
 * neither decoded nor parsed.
 */
function splitLines(bytes: Buffer, keep?: (line: number) => boolean): Line[] {
  const rows: Line[] = []
  let start = 0
  let line = 1
  while (start <= bytes.length) {
    let end = bytes.indexOf(0x0a, start)
    if (end < 0) end = bytes.length
    if (!keep || keep(line)) {
      let raw = bytes.toString('utf8', start, end)
      if (raw.endsWith('\r')) raw = raw.slice(0, -1)
      if (raw.trim()) {
        let value: Json
        try {
          value = JSON.parse(raw)
        } catch {
          value = undefined
        }
        rows.push({ line, raw, value })
      }
    }
    start = end + 1
    line++
  }
  return rows
}
const inWindow = (window?: [number, number][]) =>
  window ? (line: number) => window.some(([from, to]) => line >= from && line <= to) : undefined
const listDir = (path: string) => {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}
function walk(root: string, rel = '', out: string[] = []): string[] {
  for (const name of listDir(join(root, rel))) {
    const child = rel ? `${rel}/${name}` : name
    let stats
    try {
      stats = statSync(join(root, child))
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(root, child, out)
    else if (stats.isFile()) out.push(child)
  }
  return out
}

function resolvePointer(value: Json, pointer: string): Json {
  let current = value
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === null || typeof current !== 'object' || !(key in current)) return undefined
    current = current[key]
  }
  return current
}
const pointerOf = (...parts: (string | number)[]) =>
  '/' + parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')

function utf8Slice(buffer: Buffer, start: number, end: number) {
  // Move boundaries off UTF-8 continuation bytes so no character is split.
  while (start > 0 && start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++
  while (end < buffer.length && end > 0 && (buffer[end]! & 0xc0) === 0x80) end--
  return buffer.subarray(start, end).toString('utf8')
}

interface FileEntry {
  bytes: Buffer
  sha256: string
  readonly text: string
}

// ---------------------------------------------------------------------------------------------------------
export interface SharedIngest {
  /** Paths are recorded relative to the bundle root: `<prefix><path inside this run>`. */
  prefix?: string
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
    if (this.options.files) {
      try {
        const read = this.options.files.read(abs)
        return { sha256: read.sha256, bytes: read.bytes.length }
      } catch {
        return null
      }
    }
    let fd: number
    try {
      fd = openSync(abs, 'r')
    } catch {
      return null
    }
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
  readJournal(): Line[] {
    const rel = 'spawn-journal.jsonl'
    const abs = join(this.runDir, rel)
    if (!existsSync(abs)) return []
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
      this.nodes.set(id, {
        id,
        label: suffix ? `${suffix}${event.key ? ` · ${event.key}` : ''}` : role,
        parent,
        kind: 'agent',
        role,
        model: null,
        servedModel: null,
        harness: null,
        start: isoAt(event.at) ?? undefined,
        sandboxes: [],
        capture: { channel: 'journal', status: 'absent', reason: null },
        taskDigest: event.identity?.taskDigest,
        profileRef: event.profileRef,
        outRefs: [],
        transcriptRefs: [],
        key: typeof event.key === 'string' ? event.key : undefined,
      })
      if (typeof event.runtime === 'string') runtimeOf.set(id, event.runtime)
    }
    if (!this.nodes.size) return rows
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
      const label = [
        kind.replaceAll('-', ' '),
        event.status ?? event.signal ?? event.record?.classification ?? event.admission?.phase,
      ]
        .filter(Boolean)
        .join(' · ')
      const reason = str(event.reason ?? event.cause ?? event.record?.error ?? event.outcome?.error ?? event.detail)
      const shown = reason ? this.clip(reason, () => this.lineSource(rel, row.line, row.raw)) : null
      const spent = event.spent ?? event.spend
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
          ...(shown ? { publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) } : {}),
          ...(kind === 'settled' || kind === 'execution-result' ? { isError: event.status === 'down' || event.outcome?.success === false } : {}),
          ...(spent && (kind === 'settled' || kind === 'metered' || kind === 'reconciled') ? { spent: this.compactValue(spent) } : {}),
          data: this.compactValue(rest),
        },
      })
    }
    if (untimed) this.gaps.push({ nodeId: null, code: 'journal-untimed-lines', detail: `${untimed} spawn-journal lines carry no time and precede every timed line` })
    return rows
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

  // ----- channel 1: Claude Code native transcripts -----
  /**
   * Every stored copy of each of a node's Claude Code session files, keyed by its path inside the harness home
   * (`.claude/projects/<project>/<session>.jsonl`). A session file is append-only, so every copy is a prefix of the
   * same bytes and the longest copy is the most complete one; an equal-length tie keeps the earlier source below.
   *   1. a turn's retained-harness-transcript archive (spawn journal transcriptRef), under the native cache;
   *   2. the latest copy in the run's native index (`evidence/native-index.jsonl`, disco.native-capture.v1: a capture
   *      taken while the turn runs and when it ends), under the native cache.
   */
  nativeFiles(node: NodeDraft): { rel: string; abs: string; hex: string | null; sessionId: string | null }[] | 'not-cached' | null {
    const copies = new Map<string, { rel: string; abs: string; hex: string | null; sessionId: string | null; bytes: number; order: number }>()
    let order = 0
    let missing = false
    const offer = (key: string, rel: string, abs: string, hex: string | null, sessionId: string | null) => {
      let bytes: number
      try {
        bytes = statSync(abs).size
      } catch {
        return
      }
      const held = copies.get(key)
      if (!held || bytes > held.bytes) copies.set(key, { rel, abs, hex, sessionId, bytes, order: held?.order ?? order++ })
    }
    const cacheDir = (hex: string) =>
      this.nativeRoot ? [hex, `sha256-${hex}`, `sha256:${hex}`].map((name) => join(this.nativeRoot!, name)).find((path) => existsSync(path)) : undefined

    for (const ref of node.transcriptRefs) {
      const blob = this.blob(ref)
      if (blob?.value?.kind !== 'retained-harness-transcript') continue
      const manifest = blob.value
      this.fileSource(blob.rel)
      const hex = hexOf(manifest.snapshot?.archive?.sha256 ?? manifest.snapshot?.archive?.locator?.digest)
      const sessionId = typeof manifest.source?.nativeSessionId === 'string' ? manifest.source.nativeSessionId : null
      node.nativeSessionId ??= sessionId ?? undefined
      if (typeof manifest.harness === 'string') node.harness ??= manifest.harness
      this.addSandbox(node, manifest.source?.environmentId)
      const files = (Array.isArray(manifest.files) ? manifest.files : []).filter(
        (file: Json) => typeof file?.path === 'string' && CLAUDE_SESSION.test(file.path),
      )
      const main = files.filter((file: Json) => !sessionId || file.path.endsWith(`/${sessionId}.jsonl`))
      if (!hex || !main.length) continue
      const dir = cacheDir(hex)
      if (!dir) {
        missing = true
        continue
      }
      for (const file of main) {
        const segments = file.path.split('/')
        const candidates = [file.path, ['workspace/__retention__/sessions', segments[0], 'native', ...segments.slice(1)].join('/')]
        const relInside = candidates.find((candidate) => existsSync(join(dir, candidate)))
        if (!relInside) {
          this.gaps.push({ nodeId: node.id, code: 'no-transcript:native-file-missing', detail: `${file.path} is not in archive ${hex}` })
          continue
        }
        const abs = join(dir, relInside)
        const rel = `native:${hex}/${relInside}`
        const entry = this.file(rel, abs)
        const expected = hexOf(file.sha256)
        if (expected && expected !== entry.sha256) {
          this.gaps.push({ nodeId: node.id, code: 'no-transcript:native-sha256-mismatch', detail: `${rel} does not match its manifest` })
          continue
        }
        offer(sessionKey(file.path)!, rel, abs, hex, sessionId)
      }
    }

    const indexed = this.nativeIndex().get(node.id)
    if (indexed) {
      const hex = hexOf(indexed.snapshot?.archive)
      this.addSandbox(node, indexed.environmentId)
      if (typeof indexed.harness === 'string') node.harness ??= indexed.harness
      const dir = hex ? cacheDir(hex) : undefined
      if (hex && !dir) missing = true
      for (const session of dir && Array.isArray(indexed.native?.sessions) ? indexed.native.sessions : []) {
        const key = typeof session?.path === 'string' ? sessionKey(session.path) : null
        if (!key || typeof session.sandboxSessionId !== 'string' || typeof session.rootScope !== 'string') continue
        const relInside = ['workspace/__retention__/sessions', session.sandboxSessionId, 'native', ...(typeof session.sourceId === 'string' ? [session.sourceId] : []), session.rootScope, session.path].join('/')
        offer(key, `native:${hex}/${relInside}`, join(dir!, relInside), hex, null)
      }
    }


    if (copies.size) {
      const found = [...copies.values()].sort((a, b) => a.order - b.order)
      for (const copy of found) this.fileSource(copy.rel, copy.abs)
      return found
    }
    return missing ? 'not-cached' : null
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

  readNative(node: NodeDraft, files: { rel: string; abs: string; sessionId: string | null }[]) {
    let lossy = false
    for (const file of files) {
      const read = this.readClaudeSession(node, file.rel, file.abs)
      if (read === null) continue
      lossy ||= read.unparsable > 0
    }
    node.capture = { channel: 'native', status: lossy ? 'lossy' : 'complete', reason: lossy ? 'unparsable-lines' : null }
    if (node.harness === null) node.harness = 'claude-code'
  }

  /**
   * One Claude Code session file. Every timestamped line inside `window` (every line when absent) becomes one event,
   * or one per item when a line carries several tool results. Returns null when another node already holds the file.
   */
  readClaudeSession(node: NodeDraft, rel: string, abs?: string, window?: [number, number][]) {
    const entry = this.file(rel, abs)
    if (!this.claim(entry.sha256, node.id, rel)) return null
    this.fileSource(rel, abs)
    const counts = { events: 0, unparsable: 0, untimed: 0 }
    const seenMessages = new Set<string>()
    let lastAssistant: Draft | undefined
    let last = node.start ?? null
    for (const row of splitLines(entry.bytes, inWindow(window))) {
      const value = row.value
      if (!value) {
        counts.unparsable++
        continue
      }
      const at: string | null = isoAt(value.timestamp) ?? last
      if (!at) {
        counts.untimed++
        continue
      }
      last = at
      const source = { path: rel, sha256: entry.sha256, line: row.line }
      const full = () => this.lineSource(rel, row.line, row.raw)
      const native = typeof value.uuid === 'string' ? { nativeRecordId: value.uuid } : {}
      const sidechain = value.isSidechain ? { sidechain: true } : {}
      const message = value.message
      const before = this.events.length
      if (value.type === 'assistant' && message) {
        const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
        const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
        const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
        // Thinking the provider did not return as text: a signed block with no text (display omitted), or an
        // encrypted redacted_thinking block. Counted so a reader sees that the model thought, never invented text.
        const reasoningOmitted = blocks.filter((b) => b?.type === 'thinking' && !str(b.thinking)).length
        const reasoningRedacted = blocks.filter((b) => b?.type === 'redacted_thinking').length
        const calls = blocks.filter((b) => b?.type === 'tool_use' || b?.type === 'server_tool_use')
        const usage = message.usage
        const first = typeof message.id === 'string' ? !seenMessages.has(message.id) : true
        if (typeof message.id === 'string') seenMessages.add(message.id)
        if (typeof message.model === 'string' && message.model !== '<synthetic>') {
          node.servedModel = message.model
          node.modelSource = 'native response'
        }
        const shownText = text ? this.clip(text, full) : null
        const shownReasoning = reasoning ? this.clip(reasoning, full) : null
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: calls.length ? categoryOf(str(calls[0].name), calls[0].input) : 'reasoning',
          label: calls.length ? `assistant · ${calls.map((c) => str(c.name)).join(', ')}` : 'assistant',
          source,
          detail: {
            role: 'assistant',
            ...native,
            ...(shownText ? { publicText: shownText.text } : {}),
            ...(shownReasoning ? { reasoning: shownReasoning.text } : {}),
            ...(reasoningOmitted ? { reasoningOmitted } : {}),
            ...(reasoningRedacted ? { reasoningRedacted } : {}),
            ...(shownText?.clip ?? shownReasoning?.clip ? { clip: shownText?.clip ?? shownReasoning?.clip } : {}),
            ...(calls.length
              ? {
                  publicToolCalls: calls.map((call) => {
                    const input = this.clip(JSON.stringify(call.input ?? {}), full)
                    return { id: str(call.id), name: str(call.name), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }
                  }),
                }
              : {}),
            ...(usage && first
              ? {
                  usage: {
                    input: num(usage.input_tokens),
                    output: num(usage.output_tokens),
                    cacheRead: num(usage.cache_read_input_tokens),
                    cacheWrite: num(usage.cache_creation_input_tokens),
                  },
                }
              : {}),
            ...(typeof message.model === 'string' ? { responseReportedModel: message.model } : {}),
            ...(value.isApiErrorMessage ? { responseStatus: 'error' } : {}),
            ...sidechain,
          },
        })
        lastAssistant = this.events.at(-1)
      } else if (value.type === 'user' && message && typeof message.content === 'string') {
        const shown = this.clip(message.content, full)
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: 'other',
          label: 'user',
          source,
          detail: { role: 'user', ...native, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), ...sidechain },
        })
      } else if (value.type === 'user' && message) {
        const blocks: Json[] = Array.isArray(message.content) ? message.content : []
        const items: { index: number; block?: Json; text?: string }[] = []
        blocks.forEach((block, index) => {
          if (block?.type === 'tool_result') items.push({ index, block })
        })
        const textIndex = blocks.findIndex((b) => b?.type === 'text' || b?.type === 'image')
        const text = blocks.filter((b) => b?.type === 'text' || b?.type === 'image').map((b) => (b.type === 'image' ? '[image]' : str(b.text))).join('\n\n')
        if (text) items.push({ index: textIndex, text })
        items.sort((a, b) => a.index - b.index)
        const several = items.length > 1
        for (const item of items) {
          const itemSource = several ? { ...source, item: item.index } : source
          if (item.block) {
            const block = item.block
            const body = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((part: Json) => (part?.type === 'text' ? str(part.text) : part?.type === 'image' ? '[image]' : JSON.stringify(part))).join('\n')
                : str(block.content)
            const shown = this.clip(body, full)
            this.emit({
              node: node.id,
              at,
              kind: 'tool-result',
              category: 'other',
              label: 'tool result',
              source: itemSource,
              detail: { role: 'toolResult', ...native, toolCallId: str(block.tool_use_id), isError: block.is_error === true, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), ...sidechain },
            })
          } else {
            const shown = this.clip(item.text!, full)
            this.emit({
              node: node.id,
              at,
              kind: 'message',
              category: 'other',
              label: 'user',
              source: itemSource,
              detail: { role: 'user', ...native, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), ...sidechain },
            })
          }
        }
      }
      if (value.type === 'cost-state' && lastAssistant && num(value.totalCostUSD) !== undefined) {
        lastAssistant.detail.costListUsd = value.totalCostUSD
        lastAssistant.detail.usdKnown = false
        lastAssistant.detail.costScope = 'session-total'
      }
      // Every other timestamped line (system, attachment, cost state, an empty user turn) is kept as what it is.
      if (this.events.length === before) this.emitRecord(node, at, source, value, native)
      counts.events += this.events.length - before
    }
    if (counts.untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${counts.untimed} lines of ${this.sourcePath(rel)} carry no time` })
    if (counts.unparsable) this.gaps.push({ nodeId: node.id, code: 'unparsable-lines', detail: `${counts.unparsable} lines of ${this.sourcePath(rel)} are not JSON` })
    return counts
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
    const files = walk(join(this.runDir, dir)).filter((path) => path.endsWith('.jsonl'))
    let produced = 0
    for (const path of files) {
      const rel = `${dir}/${path}`
      const entry = this.file(rel)
      if (!this.claim(entry.sha256, node.id, rel)) continue
      this.fileSource(rel)
      const rows = splitLines(entry.bytes).filter((row) => row.value && typeof row.value === 'object')
      produced += this.readPartEvents(node, rel, entry, rows.map((row) => row.value), {
        where: (index) => ({ line: rows[index].line }),
        full: (index) => this.lineSource(rel, rows[index].line, rows[index].raw),
      })
    }
    if (!produced) return false
    node.capture = { channel: 'live', status: 'lossy', reason: 'live-stream-until-settled' }
    return true
  }

  // ----- channel 2: OpenCode native trajectory -----
  readOpenCode(node: NodeDraft, rel = 'native-trajectory.json') {
    let doc: Json
    let entry
    try {
      entry = this.file(rel)
      doc = JSON.parse(entry.text)
    } catch {
      return false
    }
    if (!Array.isArray(doc?.messages) || !Array.isArray(doc?.parts)) return false
    if (!this.claim(entry.sha256, node.id, rel)) return false
    this.fileSource(rel)
    const session = Array.isArray(doc.session) ? doc.session[0] : doc.session
    if (session?.model) {
      try {
        const model = typeof session.model === 'string' ? JSON.parse(session.model) : session.model
        if (typeof model?.id === 'string') node.model ??= [model.providerID, model.id].filter(Boolean).join('/')
      } catch {
        /* keep the declared model */
      }
    }
    if (typeof session?.id === 'string') node.nativeSessionId ??= session.id
    node.harness ??= 'opencode'
    const roles = new Map<string, Json>()
    doc.messages.forEach((message: Json) => {
      try {
        roles.set(message.id, typeof message.data === 'string' ? JSON.parse(message.data) : message.data)
      } catch {
        roles.set(message.id, {})
      }
    })
    const parts = doc.parts
      .map((part: Json, index: number) => ({ part, index }))
      .sort((a: Json, b: Json) => (a.part.time_created ?? 0) - (b.part.time_created ?? 0) || a.index - b.index)
    const lastOfMessage = new Map<string, Draft>()
    let unparsable = 0
    let untimed = 0
    for (const { part, index } of parts) {
      let data: Json
      try {
        data = typeof part.data === 'string' ? JSON.parse(part.data) : part.data
      } catch {
        unparsable++
        continue
      }
      const message = roles.get(part.message_id) ?? {}
      const role = message.role === 'user' ? 'user' : 'assistant'
      const pointer = pointerOf('parts', index, 'data')
      const source = { path: rel, sha256: entry.sha256, pointer }
      const full = () => this.pointerSource(rel, pointer, part.data)
      const at = isoAt(data?.time?.start ?? part.time_created) ?? node.start
      if (!at) {
        untimed++
        continue
      }
      const native = typeof part.id === 'string' ? { nativeRecordId: part.id } : {}
      if (role === 'assistant' && typeof message.modelID === 'string') node.servedModel = [message.providerID, message.modelID].filter(Boolean).join('/')
      if ((data?.type === 'text' || data?.type === 'reasoning') && (str(data.text) || data.type === 'text')) {
        const shown = this.clip(str(data.text), full)
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: role === 'user' ? 'other' : 'reasoning',
          label: role,
          source,
          detail: {
            role,
            ...native,
            ...(data.type === 'text' ? { publicText: shown.text } : { reasoning: shown.text }),
            ...(shown.clip ? { clip: shown.clip } : {}),
            ...(data.synthetic ? { synthetic: true } : {}),
          },
        })
        lastOfMessage.set(part.message_id, this.events.at(-1)!)
      } else if (data?.type === 'tool') {
        const state = data.state ?? {}
        const input = this.clip(JSON.stringify(state.input ?? {}), full)
        const start = isoAt(state.time?.start) ?? at
        const end = isoAt(state.time?.end)
        const category = categoryOf(str(data.tool), state.input)
        const settled = state.status === 'completed' || state.status === 'error'
        this.emit({
          node: node.id,
          at: start,
          kind: 'message',
          category,
          label: `assistant · ${str(data.tool)}`,
          source: settled ? { ...source, item: 0 } : source,
          detail: {
            role: 'assistant',
            ...native,
            publicToolCalls: [{ id: str(data.callID || part.id), name: str(data.tool), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }],
          },
        })
        lastOfMessage.set(part.message_id, this.events.at(-1)!)
        if (settled) {
          const body = state.status === 'error' ? str(state.error) : str(state.output)
          const shown = this.clip(body, full)
          this.emit({
            node: node.id,
            at: end ?? start,
            kind: 'tool-result',
            category,
            label: `tool result · ${str(data.tool)}`,
            source: { ...source, item: 1 },
            detail: {
              role: 'toolResult',
              ...native,
              toolCallId: str(data.callID || part.id),
              isError: state.status === 'error',
              publicText: shown.text,
              ...(shown.clip ? { clip: shown.clip } : {}),
              ...(end && state.time?.start ? { durationMs: Math.max(0, Number(state.time.end) - Number(state.time.start)) } : {}),
            },
          })
        }
      } else {
        if (data?.type === 'step-finish') {
          const target = lastOfMessage.get(part.message_id)
          const tokens = data.tokens
          if (target && tokens) {
            target.detail.usage = {
              input: num(tokens.input),
              output: num(tokens.output),
              cacheRead: num(tokens.cache?.read),
              cacheWrite: num(tokens.cache?.write),
              ...(num(tokens.reasoning) !== undefined ? { reasoning: tokens.reasoning } : {}),
            }
            if (num(data.cost) !== undefined && data.cost > 0) {
              target.detail.costListUsd = data.cost
              target.detail.usdKnown = false
            }
          }
        }
        // Step boundaries, patches, files, snapshots and empty reasoning parts stay as what they are.
        this.emitRecord(node, at, source, { ...data, type: str(data?.type) || 'part' }, native)
      }
    }
    if (untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} parts of ${this.sourcePath(rel)} carry no time` })
    node.capture = { channel: 'oc', status: unparsable ? 'lossy' : 'complete', reason: unparsable ? 'unparsable-parts' : null }
    return true
  }

  // ----- channel 3: pi sessions -----
  piSessions(): { rel: string; sessionId: string; digest: string | null; rows: Line[]; sha256: string }[] {
    const root = join(this.runDir, 'trace/pi-sessions')
    if (!existsSync(root)) return []
    return walk(root)
      .filter((path) => path.endsWith('.jsonl'))
      .map((path) => {
        const rel = `trace/pi-sessions/${path}`
        const entry = this.file(rel)
        const rows = splitLines(entry.bytes)
        const session = rows.find((row) => row.value?.type === 'session')?.value
        const firstUser = rows.find((row) => row.value?.type === 'message' && row.value.message?.role === 'user')?.value?.message
        const text = !firstUser
          ? null
          : typeof firstUser.content === 'string'
            ? firstUser.content
            : Array.isArray(firstUser.content)
              ? firstUser.content.filter((b: Json) => b?.type === 'text').map((b: Json) => str(b.text)).join('')
              : null
        return {
          rel,
          sessionId: str(session?.id) || basename(path, '.jsonl'),
          digest: text === null ? null : `sha256:${sha(JSON.stringify(text))}`,
          rows,
          sha256: entry.sha256,
        }
      })
  }

  readPi(node: NodeDraft, sessions: { rel: string; sessionId: string; rows: Line[]; sha256: string }[]) {
    node.harness ??= 'pi'
    const callIds = new Set<string>()
    const resultIds = new Set<string>()
    for (const session of sessions) {
      if (!this.claim(session.sha256, node.id, session.rel)) continue
      this.fileSource(session.rel)
      node.nativeSessionId ??= session.sessionId
      let untimed = 0
      let last: string | null = null
      for (const row of session.rows) {
        const value = row.value
        if (!value) continue
        const at: string | null = isoAt(value.timestamp) ?? last
        if (!at) {
          untimed++
          continue
        }
        last = at
        const source = { path: session.rel, sha256: session.sha256, line: row.line }
        const native = typeof value.id === 'string' ? { nativeRecordId: value.id } : {}
        if (value.type === 'model_change' && typeof value.modelId === 'string') node.model ??= value.modelId
        if (value.type !== 'message') {
          // The session header, model and thinking-level changes and custom entries are events too.
          this.emitRecord(node, at, source, value, native)
          continue
        }
        const message = value.message ?? {}
        const full = () => this.lineSource(session.rel, row.line, row.raw)
        const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
        const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
        // Identity of the message without its body: parent, digest and size of its content (contentDigest).
        const meta = {
          ...(typeof value.parentId === 'string' ? { nativeParentId: value.parentId } : {}),
          ...contentDigest(Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]),
        }
        if (message.role === 'toolResult') {
          const shown = this.clip(text, full)
          if (typeof message.toolCallId === 'string') resultIds.add(message.toolCallId)
          this.emit({
            node: node.id,
            at,
            kind: 'tool-result',
            category: 'other',
            label: `tool result · ${str(message.toolName)}`,
            source,
            detail: { role: 'toolResult', ...native, ...meta, toolCallId: str(message.toolCallId), isError: message.isError === true, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) },
          })
          continue
        }
        const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
        const calls = blocks.filter((b) => b?.type === 'toolCall' || b?.type === 'tool_use')
        for (const call of calls) if (typeof call.id === 'string') callIds.add(call.id)
        if (typeof message.model === 'string' && message.stopReason !== 'error') node.servedModel = message.model
        // What the response itself reported: its model, stop reason and id.
        const response =
          message.role === 'assistant'
            ? {
                ...(typeof message.model === 'string' ? { responseReportedModel: message.model } : {}),
                ...(typeof message.stopReason === 'string' ? { responseStatus: message.stopReason } : {}),
                ...(typeof message.responseId === 'string' ? { responseId: message.responseId } : {}),
              }
            : {}
        const shownText = text ? this.clip(text, full) : null
        const shownReasoning = reasoning ? this.clip(reasoning, full) : null
        const usage = message.usage
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: calls.length ? categoryOf(str(calls[0].name), calls[0].arguments ?? calls[0].input) : message.role === 'user' ? 'other' : 'reasoning',
          label: message.stopReason === 'error' ? 'failed assistant request' : calls.length ? `${str(message.role)} · ${calls.map((c) => str(c.name)).join(', ')}` : str(message.role),
          source,
          detail: {
            role: str(message.role),
            ...native,
            ...meta,
            ...response,
            ...(shownText ? { publicText: shownText.text } : {}),
            ...(shownReasoning ? { reasoning: shownReasoning.text } : {}),
            ...(shownText?.clip ?? shownReasoning?.clip ? { clip: shownText?.clip ?? shownReasoning?.clip } : {}),
            ...(calls.length
              ? {
                  publicToolCalls: calls.map((call) => {
                    const input = this.clip(JSON.stringify(call.arguments ?? call.input ?? {}), full)
                    return { id: str(call.id), name: str(call.name), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }
                  }),
                }
              : {}),
            ...(usage && message.stopReason !== 'error'
              ? { usage: { input: num(usage.input), output: num(usage.output), cacheRead: num(usage.cacheRead), cacheWrite: num(usage.cacheWrite) } }
              : {}),
            ...(num(usage?.cost?.total) !== undefined && usage.cost.total > 0 ? { costListUsd: usage.cost.total, usdKnown: false } : {}),
          },
        })
      }
      if (untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} lines of ${this.sourcePath(session.rel)} carry no time` })
    }
    // A call whose result no session line holds: the call is recorded, its outcome is not (the root stream's rule).
    const unanswered = [...callIds].filter((id) => !resultIds.has(id)).length
    if (unanswered) this.gaps.push({ nodeId: node.id, code: 'tool-results-not-retained', detail: `${unanswered} tool calls have no result in the session` })
    node.capture = { channel: 'pi', status: unanswered ? 'lossy' : 'complete', reason: unanswered ? 'tool-results-not-retained' : null }
  }

  // ----- channel 3b: retained bridge streams -----
  /** Retained cli-bridge exports (trace/bridge-sessions/*.jsonl): rows of {table, row} from the bridge store. */
  bridgeStreams() {
    const root = join(this.runDir, 'trace/bridge-sessions')
    if (!existsSync(root)) return []
    return walk(root)
      .filter((path) => path.endsWith('.jsonl'))
      .map((path) => {
        const rel = `trace/bridge-sessions/${path}`
        const entry = this.file(rel)
        const rows = splitLines(entry.bytes)
        const session = rows.find((row) => row.value?.table === 'sessions')
        return { rel, rows, sha256: entry.sha256, sessionId: str(session?.value?.row?.external_id) || null, sessionLine: session?.line ?? null }
      })
  }

  readBridgeStream(node: NodeDraft, stream: { rel: string; rows: Line[]; sha256: string }) {
    if (!this.claim(stream.sha256, node.id, stream.rel)) return false
    this.fileSource(stream.rel)
    let untimed = 0
    for (const row of stream.rows) {
      const value = row.value
      if (!value || typeof value.table !== 'string') continue
      const fields = value.row ?? {}
      const at = isoAt(fields.occurred_at) ?? isoAt(fields.received_at) ?? isoAt(Number(fields.created_at)) ?? isoAt(Number(fields.updated_at))
      if (!at) {
        untimed++
        continue
      }
      const source = { path: stream.rel, sha256: stream.sha256, line: row.line }
      const full = () => this.lineSource(stream.rel, row.line, row.raw)
      if (value.table !== 'retained_events') {
        this.emitRecord(node, at, source, { type: `bridge ${value.table.replaceAll('_', ' ')}`, ...fields })
        continue
      }
      let event: Json
      try {
        event = JSON.parse(str(fields.event_json))
      } catch {
        event = null
      }
      const inner = event?.event ?? {}
      const native = typeof fields.event_id === 'string' ? { nativeRecordId: fields.event_id } : {}
      if (typeof inner.content === 'string' && inner.content) {
        const shown = this.clip(inner.content, full)
        this.emit({ node: node.id, at, kind: 'message', category: 'reasoning', label: 'assistant', source, detail: { role: 'assistant', ...native, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) } })
      } else if (Array.isArray(inner.tool_calls) && inner.tool_calls.length) {
        const several = inner.tool_calls.length > 1
        inner.tool_calls.forEach((call: Json, index: number) => {
          const input = this.clip(typeof call?.arguments === 'string' ? call.arguments : JSON.stringify(call?.arguments ?? {}), full)
          this.emit({
            node: node.id,
            at,
            kind: 'message',
            category: categoryOf(str(call?.name), call?.arguments),
            label: `assistant · ${str(call?.name)}`,
            source: several ? { ...source, item: index } : source,
            detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(call?.id), name: str(call?.name), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
          })
        })
      } else {
        const kind = Object.keys(inner)[0] ?? str(event?.type) ?? 'event'
        this.emitRecord(node, at, source, { type: `bridge ${kind.replaceAll('_', ' ')}`, ...inner }, { ...native, ...(inner.error ? { isError: true } : {}) })
      }
    }
    if (untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} rows of ${this.sourcePath(stream.rel)} carry no time` })
    node.harness ??= 'opencode'
    node.capture = { channel: 'bridge', status: 'lossy', reason: 'bridge-stream-without-prompts-or-results' }
    return true
  }

  // ----- Codex rollouts (bundles) -----
  /** One Codex rollout .jsonl: every timestamped line inside `window` becomes one event (one per tool call item). */
  readCodex(node: NodeDraft, rel: string, window?: [number, number][]) {
    const entry = this.file(rel)
    if (!this.claim(entry.sha256, node.id, rel)) return null
    this.fileSource(rel)
    node.harness ??= 'codex'
    const counts = { unparsable: 0, untimed: 0 }
    for (const row of splitLines(entry.bytes, inWindow(window))) {
      const value = row.value
      if (!value) {
        counts.unparsable++
        continue
      }
      const at = isoAt(value.timestamp)
      if (!at) {
        counts.untimed++
        continue
      }
      const source = { path: rel, sha256: entry.sha256, line: row.line }
      const full = () => this.lineSource(rel, row.line, row.raw)
      const payload = value.payload ?? {}
      if (value.type === 'session_meta' && typeof payload.id === 'string') node.nativeSessionId ??= payload.id
      if (value.type === 'turn_context' && typeof payload.model === 'string') {
        node.model ??= payload.model
        node.servedModel = payload.model
        node.modelSource ??= 'codex turn context'
      }
      if (value.type === 'response_item' && payload.type === 'message') {
        const role = str(payload.role) || 'assistant'
        const parts: Json[] = Array.isArray(payload.content) ? payload.content : []
        const text = parts.map((part) => (part?.type === 'input_image' ? '[image]' : str(part?.text))).filter(Boolean).join('\n\n')
        const shown = this.clip(text, full)
        this.emit({ node: node.id, at, kind: 'message', category: role === 'assistant' ? 'reasoning' : 'other', label: role, source, detail: { role, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) } })
        continue
      }
      if (value.type === 'response_item' && payload.type === 'reasoning') {
        // Only the readable summary; encrypted reasoning is never decoded or copied.
        const summary = (Array.isArray(payload.summary) ? payload.summary : []).map((part: Json) => str(part?.text)).filter(Boolean).join('\n\n')
        const shown = summary ? this.clip(summary, full) : null
        this.emit({ node: node.id, at, kind: 'message', category: 'reasoning', label: 'reasoning', source, detail: { role: 'assistant', ...(shown ? { reasoning: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) } : { contentOmitted: 'encrypted reasoning' }) } })
        continue
      }
      const call =
        value.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call' || payload.type === 'web_search_call')
          ? {
              id: str(payload.call_id ?? payload.id),
              name: payload.type === 'local_shell_call' ? 'shell' : payload.type === 'web_search_call' ? 'web_search' : str(payload.name),
              input: payload.type === 'function_call' ? str(payload.arguments) : payload.type === 'custom_tool_call' ? str(payload.input) : JSON.stringify(payload.action ?? {}),
            }
          : null
      if (call) {
        const input = this.clip(call.input, full)
        this.emit({ node: node.id, at, kind: 'message', category: categoryOf(call.name, call.input), label: `assistant · ${call.name}`, source, detail: { role: 'assistant', publicToolCalls: [{ id: call.id, name: call.name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] } })
        continue
      }
      if (value.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
        const output = payload.output
        const body = typeof output === 'string' ? output : typeof output?.content === 'string' ? output.content : JSON.stringify(output ?? null)
        const shown = this.clip(body, full)
        this.emit({ node: node.id, at, kind: 'tool-result', category: 'other', label: 'tool result', source, detail: { role: 'toolResult', toolCallId: str(payload.call_id), isError: output?.success === false, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) } })
        continue
      }
      if (value.type === 'event_msg' && payload.type === 'token_count' && payload.info?.last_token_usage) {
        const usage = payload.info.last_token_usage
        const cached = num(usage.cached_input_tokens) ?? 0
        this.emit({
          node: node.id,
          at,
          kind: 'usage',
          category: 'other',
          label: 'token count',
          source,
          detail: { recordType: 'event_msg', recordSubtype: 'token_count', usage: { input: Math.max(0, (num(usage.input_tokens) ?? 0) - cached), output: num(usage.output_tokens), cacheRead: cached, ...(num(usage.reasoning_output_tokens) !== undefined ? { reasoning: usage.reasoning_output_tokens } : {}) } },
        })
        continue
      }
      this.emitRecord(node, at, source, { ...payload, type: str(value.type) || 'line', ...(payload.type ? { subtype: payload.type } : {}) })
    }
    if (counts.untimed) this.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${counts.untimed} lines of ${this.sourcePath(rel)} carry no time` })
    if (counts.unparsable) this.gaps.push({ nodeId: node.id, code: 'unparsable-lines', detail: `${counts.unparsable} lines of ${this.sourcePath(rel)} are not JSON` })
    node.capture = { channel: 'codex', status: counts.unparsable ? 'lossy' : 'complete', reason: counts.unparsable ? 'unparsable-lines' : null }
    return counts
  }

  // ----- channel 4: output blob parts -----
  readParts(node: NodeDraft) {
    const blobs = node.outRefs.map((ref) => this.blob(ref)).filter((blob): blob is { rel: string; value: Json } => Array.isArray(blob?.value?.events))
    if (!blobs.length) return false
    let produced = 0
    for (const blob of blobs) {
      const entry = this.fileSource(blob.rel)
      if (!this.claim(entry.sha256, node.id, blob.rel)) continue
      produced += this.readPartEvents(node, blob.rel, entry, blob.value.events, {
        where: (index) => ({ pointer: pointerOf('events', index) }),
        full: (index, path, value) => this.pointerSource(blob.rel, pointerOf('events', index, ...path), value),
      })
    }
    if (!produced) return false
    node.capture = { channel: 'part', status: 'lossy', reason: 'output-parts-final-state' }
    return true
  }

  /**
   * Sandbox session events (an output blob's `events`, or one line each in a live stream file) as conversation events:
   * the final state of each part id, in first-seen order, with the carried clock at first sight.
   */
  readPartEvents(
    node: NodeDraft,
    rel: string,
    entry: { sha256: string },
    events: Json[],
    loc: { where(index: number): { pointer: string } | { line: number }; full(index: number, path: (string | number)[], value: Json): Source | null },
  ) {
    let produced = 0
    // Final state per part id, in first-seen order, with the carried clock at first sight.
    const order: string[] = []
    const final = new Map<string, { part: Json; index: number; firstMs: number | null }>()
    const codex = new Map<string, { item: Json; index: number; firstMs: number | null }>()
    const codexOrder: string[] = []
    let clock: number | null = node.start ? Date.parse(node.start) : null
    let lastText: Draft | undefined
    let done: Json = null
    const extras: { index: number; at: number | null; kind: string; data: Json }[] = []
    events.forEach((event, index) => {
      const data = event?.data ?? {}
      if (event?.type === 'message.part.updated' && data.part?.id) {
        const part = data.part
        const time = num(part.state?.time?.start) ?? num(part.time?.start)
        if (time !== undefined) clock = Math.max(clock ?? 0, time)
        if (!final.has(part.id)) order.push(part.id)
        const previous = final.get(part.id)
        final.set(part.id, { part, index, firstMs: previous?.firstMs ?? clock })
        const end = num(part.state?.time?.end) ?? num(part.time?.end)
        if (end !== undefined) clock = Math.max(clock ?? 0, end)
      } else if (event?.type === 'raw' && data.event?.type === 'item.completed' && data.event.item?.id) {
        const item = data.event.item
        if (!codex.has(item.id)) codexOrder.push(item.id)
        codex.set(item.id, { item, index, firstMs: clock })
      } else if (event?.type === 'raw' && data.event?.role === 'tool' && typeof data.event.tool_call_id === 'string') {
        // Kimi streams tool results without their calls.
        extras.push({ index, at: clock, kind: 'tool-result', data: data.event })
      } else if (event?.type === 'raw' && data.event?.type === 'rate_limit_event') {
        extras.push({ index, at: clock, kind: 'rate-limit', data: data.event.rate_limit_info ?? {} })
      } else if (event?.type === 'done') {
        done = { data, usage: event.usage, index }
      } else if (event?.type === 'result' && data.outcome && data.outcome.type !== 'completed') {
        extras.push({ index, at: clock, kind: 'execution-error', data: data.outcome })
      }
    })
    const atOf = (ms: number | null) => isoAt(ms ?? undefined) ?? node.start ?? null
    for (const id of order) {
      const { part, index } = final.get(id)!
      const firstMs = final.get(id)!.firstMs
            if (part.type === 'text' || part.type === 'reasoning') {
        const text = str(part.text)
        if (!text) continue
        const shown = this.clip(text, () => loc.full(index, ['data', 'part', 'text'], text))
        const at = atOf(num(part.time?.start) ?? firstMs)
        if (!at) continue
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: 'reasoning',
          label: 'assistant',
          source: { path: rel, sha256: entry.sha256, ...loc.where(index) },
          detail: { role: 'assistant', nativeRecordId: id, ...(part.type === 'text' ? { publicText: shown.text } : { reasoning: shown.text }), ...(shown.clip ? { clip: shown.clip } : {}), ...(part.time?.start ? {} : { atBasis: 'carried' }) },
        })
        produced++
        lastText = this.events.at(-1)
      } else if (part.type === 'tool') {
        const state = part.state ?? {}
        const name = str(part.tool)
        const callId = str(part.callID || id)
        const category = categoryOf(name, state.input)
        const input = this.clip(JSON.stringify(state.input ?? {}), () => loc.full(index, ['data', 'part', 'state', 'input'], state.input ?? {}))
        const startMs = num(state.time?.start) ?? firstMs
        const at = atOf(startMs)
        if (!at) continue
        const settled = state.status === 'completed' || state.status === 'error'
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category,
          label: `assistant · ${name}`,
          source: { path: rel, sha256: entry.sha256, ...loc.where(index), ...(settled ? { item: 0 } : {}) },
          detail: { role: 'assistant', nativeRecordId: id, publicToolCalls: [{ id: callId, name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
        })
        produced++
        if (settled) {
          const field = state.status === 'error' ? 'error' : 'output'
          const body = str(state[field])
          const shown = this.clip(body, () => loc.full(index, ['data', 'part', 'state', field], state[field]))
          const endMs = num(state.time?.end)
          this.emit({
            node: node.id,
            at: atOf(endMs ?? startMs)!,
            kind: 'tool-result',
            category,
            label: `tool result · ${name}`,
            source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 1 },
            detail: {
              role: 'toolResult',
              nativeRecordId: id,
              toolCallId: callId,
              isError: state.status === 'error',
              publicText: shown.text,
              ...(shown.clip ? { clip: shown.clip } : {}),
              ...(endMs !== undefined && startMs !== null && startMs !== undefined ? { durationMs: Math.max(0, endMs - startMs) } : {}),
            },
          })
        }
      }
    }
    for (const id of codexOrder) {
      const { item, index, firstMs } = codex.get(id)!
      if (item.type !== 'command_execution' && item.type !== 'mcp_tool_call' && item.type !== 'web_search' && item.type !== 'file_change') continue
      const at = atOf(firstMs)
      if (!at) continue
      const name = item.type === 'mcp_tool_call' ? str(item.tool ?? item.name) : item.type
      const inputValue = item.type === 'command_execution' ? { command: item.command } : item.type === 'web_search' ? { query: item.query } : item.type === 'file_change' ? { changes: item.changes } : item.arguments ?? {}
      const input = this.clip(JSON.stringify(inputValue), () => loc.full(index, ['data', 'event', 'item'], item))
      const category = categoryOf(name, inputValue)
      this.emit({
        node: node.id,
        at,
        kind: 'message',
        category,
        label: `assistant · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 0 },
        detail: { role: 'assistant', nativeRecordId: str(id), publicToolCalls: [{ id: str(id), name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
      })
      const body = str(item.aggregated_output ?? item.result ?? item.output ?? item.status)
      const shown = this.clip(body, () => loc.full(index, ['data', 'event', 'item'], item))
      this.emit({
        node: node.id,
        at,
        kind: 'tool-result',
        category,
        label: `tool result · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 1 },
        detail: {
          role: 'toolResult',
          nativeRecordId: str(id),
          toolCallId: str(id),
          isError: (typeof item.exit_code === 'number' && item.exit_code !== 0) || item.status === 'failed',
          publicText: shown.text,
          ...(shown.clip ? { clip: shown.clip } : {}),
          atBasis: 'carried',
        },
      })
      produced += 2
    }
    for (const extra of extras) {
      const at = atOf(extra.at)
      if (!at) continue
      if (extra.kind === 'tool-result') {
        const content = extra.data.content
        const body = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: Json) => str(part?.text ?? part)).join('\n') : str(content)
        const shown = this.clip(body, () => loc.full(extra.index, ['data', 'event', 'content'], content))
        this.emit({
          node: node.id,
          at,
          kind: 'tool-result',
          category: 'other',
          label: 'tool result',
          source: { path: rel, sha256: entry.sha256, ...loc.where(extra.index) },
          detail: { role: 'toolResult', toolCallId: str(extra.data.tool_call_id), isError: /<system>ERROR/.test(body), publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), atBasis: 'carried' },
        })
        produced++
        continue
      }
      const window = extra.data.rateLimitType ?? null
      const utilization = window ? num(extra.data.unifiedWindows?.[window]?.utilization) ?? null : null
      this.emit({
        node: node.id,
        at,
        kind: extra.kind,
        category: 'lifecycle',
        label: extra.kind === 'rate-limit' ? `rate limit · ${window ?? 'window unknown'}` : 'execution error',
        source: { path: rel, sha256: entry.sha256, ...loc.where(extra.index) },
        detail:
          extra.kind === 'rate-limit'
            ? { rateLimit: { window, utilization, status: extra.data.status ?? null }, data: this.compactValue(extra.data) }
            : { responseStatus: 'error', isError: true, publicText: this.clip(str(extra.data.error ?? extra.data), null).text },
      })
    }
    if (done) {
      const backend = done.data?.effectiveBackend
      if (typeof backend?.model === 'string') {
        node.servedModel ??= backend.model
        node.modelSource ??= 'effective backend'
      }
      const usage = done.usage ?? done.data?.tokenUsage
      const cost = num(usage?.cost) ?? num(done.data?.totalCostUsd)
      const target = lastText ?? [...this.events].reverse().find((event) => event.node === node.id && event.source?.path === this.sourcePath(rel))
      // A zero report from an execution Runtime did not meter (tokensKnown false) is no evidence of zero use: a rate-limited
      // or lost attempt reports nothing for the attempts before it. Its usage stays unknown.
      const unmeteredZero =
        (done.data?.tokensKnown === false || done.tokensKnown === false) &&
        !num(usage?.inputTokens) && !num(usage?.outputTokens) && !num(usage?.cacheReadInputTokens) && !num(usage?.cacheCreationInputTokens) && !cost
      if (target && usage && !unmeteredZero) {
        target.detail.usage = {
          input: num(usage.inputTokens),
          output: num(usage.outputTokens),
          cacheRead: num(usage.cacheReadInputTokens),
          cacheWrite: num(usage.cacheCreationInputTokens),
        }
        target.detail.usageScope = 'execution-total'
        if (cost !== undefined) {
          target.detail.costListUsd = cost
          target.detail.usdKnown = false
        }
      }
    }

    return produced
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
        const shown = this.clip(text, block.rows.length === 1 ? () => this.lineSource(rel, first.line, first.raw) : null)
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
            ...(block.kind === 'text_delta' ? { publicText: shown.text } : { reasoning: shown.text }),
            ...(shown.clip ? { clip: shown.clip } : {}),
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
        const input = event.args === undefined || event.args === null ? null : this.clip(JSON.stringify(event.args), full)
        callIds.add(str(event.toolCallId))
        this.emit({
          node: node.id,
          at,
          kind: 'message',
          category: categoryOf(str(event.toolName), event.args),
          label: `assistant · ${str(event.toolName)}`,
          source,
          detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(event.toolCallId), name: str(event.toolName), ...(input ? { input: input.text } : {}), ...(input?.clip ? { clip: input.clip } : {}) }] },
        })
      } else if (kind === 'tool_result') {
        const result = event.result
        const body = typeof result === 'string' ? result : result && typeof result === 'object' && typeof result.error === 'string' && Object.keys(result).length === 1 ? result.error : JSON.stringify(result ?? null)
        const shown = this.clip(body, full)
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
            publicText: shown.text,
            ...(shown.clip ? { clip: shown.clip } : {}),
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
    const files = paths ?? walk(join(this.runDir, dir)).filter((path) => path.endsWith('.md')).map((path) => `${dir}/${path}`)
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
      if (!node) {
        node = {
          id: nodeId,
          label: 'Recorded findings',
          parent: null,
          kind: 'finding',
          role: 'Findings',
          model: null,
          servedModel: null,
          harness: null,
          sandboxes: [],
          capture: { channel: 'kb', status: 'complete', reason: null },
          outRefs: [],
          transcriptRefs: [],
        }
        this.nodes.set(nodeId, node)
      }
      const shown = this.clip(body, () => this.fileSource(rel))
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
          recordedClaim: shown.text,
          ...(shown.clip ? { clip: shown.clip } : {}),
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
    const pages = walk(join(runDir, 'kb/pages')).filter((path) => path.endsWith('.md'))
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
        this.nodes.set(this.runId, {
          id: this.runId,
          label: 'root',
          parent: null,
          kind: 'agent',
          role: 'root',
          model: null,
          servedModel: null,
          harness: null,
          sandboxes: [],
          capture: { channel: 'journal', status: 'absent', reason: 'no-spawn-journal' },
          outRefs: [],
          transcriptRefs: [],
        })
        this.rootId = this.runId
        if (!runtimeFiles || this.format === 'search')
          this.gaps.push({ nodeId: null, code: 'unsupported-format', detail: `No spawn journal in ${this.format === 'search' ? 'a search ledger' : 'this layout'}` })
      }
    }
    const root = this.nodes.get(this.rootId)
    if (root && existsSync(join(runDir, 'native-trajectory.json')) && this.format !== 'cloud') this.format = 'bridge-native'
    if (root && walk(join(runDir, 'trace/pi-sessions')).some((path) => path.endsWith('.jsonl'))) this.format = 'pi-local'

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
    const pi = this.piSessions()
    const piByNode = new Map<string, typeof pi>()
    const digests = new Map<string, string>()
    for (const node of this.nodes.values()) if (node.taskDigest) digests.set(node.taskDigest, node.id)
    // cli-bridge keeps each Pi session under sha256("cli-bridge/pi-session\0" + bridge session id), and that id is the
    // execution id in the child's materialization receipt: an exact join even for a session with no prompt.
    const bridgeDirs = new Map<string, { node: string; line: number; sessionId: string }>()
    for (const [sessionId, at] of this.executionOf) bridgeDirs.set(sha(`cli-bridge/pi-session\0${sessionId}`), { ...at, sessionId })
    const piBasis = new Map<string, string>()
    const piProof = new Map<string, Record<string, unknown>>()
    const unjoined: typeof pi = []
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
    const streamsByNode = new Map<string, ReturnType<Ingest['bridgeStreams']>[number]>()
    for (const stream of this.bridgeStreams()) {
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
      const native = this.nativeFiles(node)
      if (Array.isArray(native)) {
        this.readNative(node, native)
        continue
      }
      if (native === 'not-cached')
        this.gaps.push({ nodeId: node.id, code: 'archived-not-ingested', detail: 'A native transcript archive exists but is not in the native cache' })
      if (node.id === this.rootId && existsSync(join(runDir, 'native-trajectory.json')) && this.readOpenCode(node)) continue
      const sessions = piByNode.get(node.id)
      if (sessions?.length) {
        node.joinBasis = piBasis.get(node.id) ?? 'task-digest'
        if (piProof.has(node.id)) node.joinProof = piProof.get(node.id)
        this.readPi(node, sessions)
        continue
      }
      const stream = streamsByNode.get(node.id)
      if (stream && this.readBridgeStream(node, stream)) {
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
      this.nodes.set(id, {
        id,
        label: `pi ${session.sessionId.slice(0, 8)}`,
        parent: null,
        kind: 'session',
        role: 'Session',
        model: null,
        servedModel: null,
        harness: 'pi',
        sandboxes: [],
        capture: { channel: 'pi', status: 'complete', reason: null },
        outRefs: [],
        transcriptRefs: [],
        joinBasis: 'unresolved',
      })
      this.readPi(this.nodes.get(id)!, [session])
      this.nodes.get(id)!.nativeSessionId = session.sessionId
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

  result: Json = null

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
    const span = new Map<string, [string, string]>()
    for (const event of this.events) {
      const current = span.get(event.node)
      if (!current) span.set(event.node, [event.at, event.at])
      else {
        if (event.at < current[0]) current[0] = event.at
        if (event.at > current[1]) current[1] = event.at
      }
    }
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
    const knowledge = task?.knowledge
    const completion = task?.completion
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
        knowledge: typeof knowledge === 'string' ? knowledge : knowledge ? JSON.stringify(knowledge, null, 2) : '',
        completion: typeof completion === 'string' ? completion : completion ? JSON.stringify(completion, null, 2) : '',
        suppliedKnowledge: typeof knowledge === 'string' ? knowledge : knowledge ? JSON.stringify(knowledge, null, 2) : '',
        deliverables: typeof completion === 'string' ? completion : completion ? JSON.stringify(completion, null, 2) : '',
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

  build() {
    this.convert()
    return this.assemble()
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
    const hash = createHash('sha256')
    let bytes = 0
    const fd = openSync(abs, 'r')
    try {
      const buffer = Buffer.allocUnsafe(1 << 20)
      for (let n = readSync(fd, buffer); n > 0; n = readSync(fd, buffer)) {
        hash.update(buffer.subarray(0, n))
        bytes += n
      }
    } finally {
      closeSync(fd)
    }
    if (hash.digest('hex') !== hexOf(file.sha256) || bytes !== file.bytes) problems.push(`${prefix}${path} does not match its sha256 or length`)
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
  const { record, counts } = ingest.build()
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
  const agentNodes = new Map<string, { node: string; rel: string; line: number }>()
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

  // Sessions.
  const byPath = new Map<string, string>()
  const pending: { session: BundleSession; node: NodeDraft }[] = []
  for (const session of bundle.sessions) {
    let node: NodeDraft | undefined
    if (session.harness === 'claude-code') {
      const rows = splitLines(main.file(session.path).bytes)
      const carried = rows.find((row) => typeof row.value?.agentId === 'string')
      const agentId = session.agentId ?? (carried ? str(carried.value.agentId) : '')
      const sessionId = session.sessionId ?? str(rows.find((row) => typeof row.value?.sessionId === 'string')?.value?.sessionId)
      const meta = session.path.replace(/\.jsonl$/, '.meta.json')
      const joined = agentId ? agentNodes.get(agentId) : undefined
      if (joined && carried && basename(session.path) === `agent-${agentId}.jsonl` && existsSync(join(dir, meta))) {
        node = main.nodes.get(joined.node)!
        node.joinBasis = 'workflow-agent-id'
        node.joinProof = { journal: { path: joined.rel, line: joined.line }, session: { path: session.path, line: carried.line }, meta: { path: meta } }
        node.nativeSessionId = sessionId || undefined
        main.fileSource(meta)
      } else {
        const id = `claude-code:${agentId || sessionId || basename(session.path, '.jsonl')}`
        node = main.nodes.get(id) ?? blankNode(id, { label: session.label ?? `claude code ${(agentId || sessionId).slice(0, 8)}`, nativeSessionId: sessionId || undefined })
        main.nodes.set(id, node)
      }
      node.harness ??= 'claude-code'
      if (session.label) node.label = session.label
      const read = main.readClaudeSession(node, session.path, undefined, session.lines)
      if (read) node.capture = { channel: 'native', status: read.unparsable ? 'lossy' : 'complete', reason: read.unparsable ? 'unparsable-lines' : session.lines ? 'line-window' : null }
    } else if (session.harness === 'codex') {
      const id = `codex:${session.sessionId ?? basename(session.path, '.jsonl')}`
      node = main.nodes.get(id) ?? blankNode(id, { label: session.label ?? `codex ${(session.sessionId ?? basename(session.path)).slice(-12)}` })
      main.nodes.set(id, node)
      const read = main.readCodex(node, session.path, session.lines)
      if (read && session.lines) node.capture = { ...node.capture, reason: node.capture.reason ?? 'line-window' }
    } else if (session.harness === 'opencode') {
      const id = `opencode:${session.sessionId ?? basename(dirname(session.path))}`
      node = main.nodes.get(id) ?? blankNode(id, { label: session.label ?? id })
      main.nodes.set(id, node)
      main.readOpenCode(node, session.path)
    } else if (session.harness === 'opencode-bridge') {
      const entry = main.file(session.path)
      const rows = splitLines(entry.bytes)
      const sessionRow = rows.find((row) => row.value?.table === 'sessions')
      const id = `bridge:${session.sessionId ?? (str(sessionRow?.value?.row?.external_id) || basename(session.path, '.jsonl'))}`
      node = main.nodes.get(id) ?? blankNode(id, { label: session.label ?? id })
      main.nodes.set(id, node)
      main.readBridgeStream(node, { rel: session.path, rows, sha256: entry.sha256 })
    } else if (session.harness === 'pi') {
      const entry = main.file(session.path)
      const rows = splitLines(entry.bytes)
      const header = rows.find((row) => row.value?.type === 'session')?.value
      const sessionId = session.sessionId ?? (str(header?.id) || basename(session.path, '.jsonl'))
      const id = `pi:${sessionId}`
      node = main.nodes.get(id) ?? blankNode(id, { label: session.label ?? `pi ${sessionId.slice(0, 8)}` })
      main.nodes.set(id, node)
      main.readPi(node, [{ rel: session.path, sessionId, rows, sha256: entry.sha256 }])
    } else {
      throw new RunUnreadableError(`bundle.json session ${session.path} has an unknown harness`)
    }
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
  const span = new Map<string, [string, string]>()
  for (const event of main.events) {
    const current = span.get(event.node)
    if (!current) span.set(event.node, [event.at, event.at])
    else {
      if (event.at < current[0]) current[0] = event.at
      if (event.at > current[1]) current[1] = event.at
    }
  }
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
    const paths = finding.path.endsWith('.md') ? [finding.path] : walk(join(dir, finding.path)).filter((path) => path.endsWith('.md')).map((path) => `${finding.path.replace(/\/+$/, '')}/${path}`)
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
