/**
 * The one converter from an agent-runtime run directory to `agent-record.v1`. Node only.
 *
 * It reads the run directory and an optional native-transcript cache, never writes into either, and never
 * touches the network. The same inputs and ADAPTER_VERSION produce identical bytes.
 *
 * Nodes are the `spawned` ids in spawn-journal.jsonl. Each node's conversation comes from the first channel
 * that holds it, in this order; the others are listed as sources and never duplicated as events:
 *   1. native   Claude Code session .jsonl inside a retained-harness-transcript archive under --native/<hex>/
 *   2. oc       OpenCode native-trajectory.json (bridge-native roots)
 *   3. pi       trace/pi-sessions/**, joined when sha256(JSON.stringify(first user text)) == spawned taskDigest
 *   4. part     output blob parts at the node's outRefs, collapsed to the final state of each part id
 *   5. root     root-stream.jsonl (root only; deltas collapse to one block per turn; resumed replays dropped)
 *   6. journal  lifecycle events only
 *
 * Event ids are `<nodeId>#<channel>:<key>`; keys come from the source, never from filtered positions:
 *   journal:<line>            physical line in spawn-journal.jsonl (seq restarts at every `begin`)
 *   root:<seq>                root-stream seq of the first row in a collapsed block
 *   part:<partId>[.result]    output part id; `.result` is a tool part's result; part:@<blob8>.<id> blob events
 *   native:[<session>:]<line>[.<i>] physical line; `.i` numbers tool results when a line holds several
 *   pi:[<session>:]<line>     physical line
 *   oc:<partId>[.result]      OpenCode part id
 *
 * Sources: every input file, native file and clipped body has a `sources[]` entry. Its sha256 covers exactly
 * the bytes a source route serves: the whole file, one physical line (`line`), or the resolved JSON value
 * (`pointer`; a string's UTF-8 bytes, otherwise its JSON text). Paths under the native cache start with
 * `native:<hex>/`. A clipped body keeps the first three quarters and the last quarter of `maxText` bytes;
 * `detail.clip.sha256` names the source entry holding the full text.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { recordSchema } from '../record.js'

export const ADAPTER_VERSION = '1.0.1'
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

export interface IngestOptions {
  /** Directory of extracted native archives, one `<64-hex digest>/` per archive. */
  native?: string
  /** Bodies over this many UTF-8 bytes are clipped. Default 16384. */
  maxText?: number
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

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Source = { path: string; sha256: string; bytes: number; line?: number; pointer?: string; label?: string }
type Capture = { channel: string; status: 'complete' | 'lossy' | 'absent'; reason: string | null }
type Gap = { nodeId: string | null; code: string; detail: string }

interface Draft {
  id: string
  node: string
  at: string
  kind: string
  category: Category
  label: string
  source: { path: string; sha256: string; line?: number; pointer?: string } | null
  detail: Record<string, unknown>
  order: number
}

interface NodeDraft {
  id: string
  label: string
  parent: string | null
  kind: 'agent' | 'session'
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
// Placeholder times such as the Unix epoch are not observations.
const EARLIEST = Date.UTC(2001, 0, 1)
const LATEST = Date.UTC(2100, 0, 1)
const isoAt = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value)
  const time = date.valueOf()
  return Number.isFinite(time) && time >= EARLIEST && time < LATEST ? date.toISOString() : null
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
function splitLines(text: string): Line[] {
  const rows: Line[] = []
  let start = 0
  let line = 1
  while (start <= text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    let raw = text.slice(start, end)
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
    start = end + 1
    line++
  }
  return rows
}
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

// ---------------------------------------------------------------------------------------------------------
class Ingest {
  readonly runId: string
  readonly sources = new Map<string, Source>()
  readonly events: Draft[] = []
  readonly gaps: Gap[] = []
  readonly nodes = new Map<string, NodeDraft>()
  readonly fileCache = new Map<string, { bytes: Buffer; text: string; sha256: string }>()
  rootId: string
  order = 0
  format = 'other'
  runInput: Json = null
  runInputRel: string | null = null

  constructor(
    readonly runDir: string,
    readonly nativeRoot: string | undefined,
    readonly maxText: number,
  ) {
    this.runId = basename(runDir.replace(/\/+$/, ''))
    this.rootId = this.runId
  }

  // ----- sources -----
  file(rel: string, abs = join(this.runDir, rel)) {
    const cached = this.fileCache.get(abs)
    if (cached) return cached
    const bytes = readFileSync(abs)
    const entry = { bytes, text: bytes.toString('utf8'), sha256: sha(bytes) }
    this.fileCache.set(abs, entry)
    return entry
  }
  addSource(source: Source) {
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
  /** List a file that is not an event channel. Files over 8 MiB are listed by size without a hash. */
  listSource(rel: string) {
    const abs = join(this.runDir, rel)
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      return
    }
    if (size <= 8 * 1024 * 1024) this.fileSource(rel)
    else this.addSource({ path: rel, sha256: '', bytes: size })
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

  emit(event: Omit<Draft, 'order'>) {
    this.events.push({ ...event, order: this.order++ })
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
    const rows = splitLines(entry.text)
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
    for (const row of rows) {
      const event = row.value?.event ?? row.value
      if (!event || typeof event !== 'object') continue
      // A `begin` row names its node only through the journal root path.
      const subjectId = typeof event.id === 'string' ? event.id : str(row.value?.root).split('/').at(-1)
      const node = this.nodes.get(this.nodeFor(subjectId))
      const exact = typeof event.id === 'string' ? this.nodes.get(event.id) : undefined
      const kind = str(event.kind) || 'unknown'
      if (kind === 'materialized' && exact) {
        const model = event.receipt?.model
        if (model?.status === 'known' && typeof model.id === 'string') {
          exact.servedModel ??= model.id
        }
        if (event.receipt?.execution?.kind === 'environment') this.addSandbox(exact, event.receipt.execution.id)
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
      if (!at || !node) continue
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
        id: `${node.id}#journal:${row.line}`,
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
  nativeFiles(node: NodeDraft): { rel: string; abs: string; hex: string; sessionId: string | null }[] | 'not-cached' | null {
    const manifests: Json[] = []
    for (const ref of node.transcriptRefs) {
      const blob = this.blob(ref)
      if (blob?.value?.kind === 'retained-harness-transcript') {
        manifests.push(blob.value)
        this.fileSource(blob.rel)
      }
    }
    if (!manifests.length) return null
    const found: { rel: string; abs: string; hex: string; sessionId: string | null }[] = []
    let missing = false
    for (const manifest of manifests) {
      const hex = hexOf(manifest.snapshot?.archive?.sha256 ?? manifest.snapshot?.archive?.locator?.digest)
      const sessionId = typeof manifest.source?.nativeSessionId === 'string' ? manifest.source.nativeSessionId : null
      node.nativeSessionId ??= sessionId ?? undefined
      if (typeof manifest.harness === 'string') node.harness ??= manifest.harness
      this.addSandbox(node, manifest.source?.environmentId)
      const files = (Array.isArray(manifest.files) ? manifest.files : []).filter(
        (file: Json) => typeof file?.path === 'string' && /\/\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/.test(file.path),
      )
      const main = files.filter((file: Json) => !sessionId || file.path.endsWith(`/${sessionId}.jsonl`))
      if (!hex || !main.length) continue
      const dir = this.nativeRoot
        ? [hex, `sha256-${hex}`, `sha256:${hex}`].map((name) => join(this.nativeRoot!, name)).find((path) => existsSync(path))
        : undefined
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
        this.fileSource(rel, abs)
        found.push({ rel, abs, hex, sessionId })
      }
    }
    if (found.length) return found
    return missing ? 'not-cached' : null
  }

  readNative(node: NodeDraft, files: { rel: string; abs: string; sessionId: string | null }[]) {
    let lossy = false
    const seenMessages = new Set<string>()
    for (const file of files) {
      const entry = this.file(file.rel, file.abs)
      const prefix = files.length > 1 ? `native:${(file.sessionId ?? entry.sha256).slice(0, 8)}:` : 'native:'
      let lastAssistant: Draft | undefined
      let last = node.start ?? null
      for (const row of splitLines(entry.text)) {
        const value = row.value
        if (!value) {
          lossy = true
          continue
        }
        const at = isoAt(value.timestamp) ?? last
        if (!at) continue
        last = at
        const source = { path: file.rel, sha256: entry.sha256, line: row.line }
        const full = () => this.lineSource(file.rel, row.line, row.raw)
        const message = value.message
        if (value.type === 'assistant' && message) {
          const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
          const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
          const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
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
          const draft: Omit<Draft, 'order'> = {
            id: `${node.id}#${prefix}${row.line}`,
            node: node.id,
            at,
            kind: 'message',
            category: calls.length ? categoryOf(str(calls[0].name), calls[0].input) : 'reasoning',
            label: calls.length ? `assistant · ${calls.map((c) => str(c.name)).join(', ')}` : 'assistant',
            source,
            detail: {
              role: 'assistant',
              ...(shownText ? { publicText: shownText.text } : {}),
              ...(shownReasoning ? { reasoning: shownReasoning.text } : {}),
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
              ...(value.isSidechain ? { sidechain: true } : {}),
            },
          }
          this.emit(draft)
          lastAssistant = this.events.at(-1)
          continue
        }
        if (value.type === 'user' && message) {
          if (typeof message.content === 'string') {
            const shown = this.clip(message.content, full)
            this.emit({
              id: `${node.id}#${prefix}${row.line}`,
              node: node.id,
              at,
              kind: 'message',
              category: 'other',
              label: 'user',
              source,
              detail: { role: 'user', publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), ...(value.isSidechain ? { sidechain: true } : {}) },
            })
            continue
          }
          const blocks: Json[] = Array.isArray(message.content) ? message.content : []
          const results = blocks.filter((b) => b?.type === 'tool_result')
          const texts = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
          results.forEach((block, i) => {
            const body = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((part: Json) => (part?.type === 'text' ? str(part.text) : part?.type === 'image' ? '[image]' : JSON.stringify(part))).join('\n')
                : str(block.content)
            const shown = this.clip(body, full)
            this.emit({
              id: `${node.id}#${prefix}${row.line}${results.length > 1 ? `.${i}` : ''}`,
              node: node.id,
              at,
              kind: 'tool-result',
              category: 'other',
              label: 'tool result',
              source,
              detail: {
                role: 'toolResult',
                toolCallId: str(block.tool_use_id),
                isError: block.is_error === true,
                publicText: shown.text,
                ...(shown.clip ? { clip: shown.clip } : {}),
              },
            })
          })
          if (texts && !results.length) {
            const shown = this.clip(texts, full)
            this.emit({
              id: `${node.id}#${prefix}${row.line}`,
              node: node.id,
              at,
              kind: 'message',
              category: 'other',
              label: 'user',
              source,
              detail: { role: 'user', publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) },
            })
          }
          continue
        }
        if (value.type === 'cost-state' && lastAssistant && num(value.totalCostUSD) !== undefined) {
          lastAssistant.detail.costListUsd = value.totalCostUSD
          lastAssistant.detail.usdKnown = false
          lastAssistant.detail.costScope = 'session-total'
        }
      }
    }
    node.capture = { channel: 'native', status: lossy ? 'lossy' : 'complete', reason: lossy ? 'unparsable-lines' : null }
    if (node.harness === null) node.harness = 'claude-code'
  }

  // ----- channel 2: OpenCode native trajectory -----
  readOpenCode(node: NodeDraft) {
    const rel = 'native-trajectory.json'
    let doc: Json
    try {
      doc = JSON.parse(this.file(rel).text)
    } catch {
      return false
    }
    if (!Array.isArray(doc?.messages) || !Array.isArray(doc?.parts)) return false
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
    for (const { part, index } of parts) {
      let data: Json
      try {
        data = typeof part.data === 'string' ? JSON.parse(part.data) : part.data
      } catch {
        continue
      }
      const message = roles.get(part.message_id) ?? {}
      const role = message.role === 'user' ? 'user' : 'assistant'
      const pointer = pointerOf('parts', index, 'data')
      const source = { path: rel, sha256: this.sources.get(`${rel}\0\0`)!.sha256, pointer }
      const full = () => this.pointerSource(rel, pointer, part.data)
      const at = isoAt(data?.time?.start ?? part.time_created) ?? node.start
      if (!at) continue
      if (role === 'assistant' && typeof message.modelID === 'string') node.servedModel = [message.providerID, message.modelID].filter(Boolean).join('/')
      if (data?.type === 'text' || data?.type === 'reasoning') {
        const shown = this.clip(str(data.text), full)
        if (!shown.text && data.type !== 'text') continue
        this.emit({
          id: `${node.id}#oc:${part.id}`,
          node: node.id,
          at,
          kind: 'message',
          category: role === 'user' ? 'other' : 'reasoning',
          label: role,
          source,
          detail: {
            role,
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
        this.emit({
          id: `${node.id}#oc:${part.id}`,
          node: node.id,
          at: start,
          kind: 'message',
          category,
          label: `assistant · ${str(data.tool)}`,
          source,
          detail: {
            role: 'assistant',
            publicToolCalls: [{ id: str(data.callID || part.id), name: str(data.tool), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }],
          },
        })
        lastOfMessage.set(part.message_id, this.events.at(-1)!)
        if (state.status === 'completed' || state.status === 'error') {
          const body = state.status === 'error' ? str(state.error) : str(state.output)
          const shown = this.clip(body, full)
          this.emit({
            id: `${node.id}#oc:${part.id}.result`,
            node: node.id,
            at: end ?? start,
            kind: 'tool-result',
            category,
            label: `tool result · ${str(data.tool)}`,
            source,
            detail: {
              role: 'toolResult',
              toolCallId: str(data.callID || part.id),
              isError: state.status === 'error',
              publicText: shown.text,
              ...(shown.clip ? { clip: shown.clip } : {}),
              ...(end && state.time?.start ? { durationMs: Math.max(0, Number(state.time.end) - Number(state.time.start)) } : {}),
            },
          })
        }
      } else if (data?.type === 'step-finish') {
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
    }
    node.capture = { channel: 'oc', status: 'complete', reason: null }
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
        const rows = splitLines(entry.text)
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
    for (const session of sessions) {
      this.fileSource(session.rel)
      const prefix = sessions.length > 1 ? `pi:${session.sessionId.slice(0, 8)}:` : 'pi:'
      node.nativeSessionId ??= session.sessionId
      for (const row of session.rows) {
        const value = row.value
        if (!value) continue
        if (value.type === 'model_change' && typeof value.modelId === 'string') {
          node.model ??= value.modelId
          continue
        }
        if (value.type !== 'message') continue
        const message = value.message ?? {}
        const at = isoAt(value.timestamp)
        if (!at) continue
        const source = { path: session.rel, sha256: session.sha256, line: row.line }
        const full = () => this.lineSource(session.rel, row.line, row.raw)
        const blocks: Json[] = Array.isArray(message.content) ? message.content : [{ type: 'text', text: str(message.content) }]
        const text = blocks.filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n\n')
        if (message.role === 'toolResult') {
          const shown = this.clip(text, full)
          this.emit({
            id: `${node.id}#${prefix}${row.line}`,
            node: node.id,
            at,
            kind: 'tool-result',
            category: 'other',
            label: `tool result · ${str(message.toolName)}`,
            source,
            detail: { role: 'toolResult', toolCallId: str(message.toolCallId), isError: message.isError === true, publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}) },
          })
          continue
        }
        const reasoning = blocks.filter((b) => b?.type === 'thinking').map((b) => str(b.thinking)).filter(Boolean).join('\n\n')
        const calls = blocks.filter((b) => b?.type === 'toolCall' || b?.type === 'tool_use')
        if (typeof message.model === 'string' && message.stopReason !== 'error') node.servedModel = message.model
        const shownText = text ? this.clip(text, full) : null
        const shownReasoning = reasoning ? this.clip(reasoning, full) : null
        const usage = message.usage
        this.emit({
          id: `${node.id}#${prefix}${row.line}`,
          node: node.id,
          at,
          kind: 'message',
          category: calls.length ? categoryOf(str(calls[0].name), calls[0].arguments ?? calls[0].input) : message.role === 'user' ? 'other' : 'reasoning',
          label: message.stopReason === 'error' ? 'failed assistant request' : calls.length ? `${str(message.role)} · ${calls.map((c) => str(c.name)).join(', ')}` : str(message.role),
          source,
          detail: {
            role: str(message.role),
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
            ...(message.stopReason === 'error' ? { responseStatus: 'error' } : {}),
          },
        })
      }
    }
    node.capture = { channel: 'pi', status: 'complete', reason: null }
  }

  // ----- channel 4: output blob parts -----
  readParts(node: NodeDraft) {
    const blobs = node.outRefs.map((ref) => this.blob(ref)).filter((blob): blob is { rel: string; value: Json } => Array.isArray(blob?.value?.events))
    if (!blobs.length) return false
    let produced = 0
    for (const blob of blobs) {
      const entry = this.fileSource(blob.rel)
      const tag = entry.sha256.slice(0, 8)
      const events: Json[] = blob.value.events
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
        const pointerBase = ['events', index, 'data', 'part'] as const
        if (part.type === 'text' || part.type === 'reasoning') {
          const text = str(part.text)
          if (!text) continue
          const pointer = pointerOf(...pointerBase, 'text')
          const shown = this.clip(text, () => this.pointerSource(blob.rel, pointer, text))
          const at = atOf(num(part.time?.start) ?? firstMs)
          if (!at) continue
          this.emit({
            id: `${node.id}#part:${id}`,
            node: node.id,
            at,
            kind: 'message',
            category: 'reasoning',
            label: 'assistant',
            source: { path: blob.rel, sha256: entry.sha256, pointer: pointerOf(...pointerBase) },
            detail: { role: 'assistant', ...(part.type === 'text' ? { publicText: shown.text } : { reasoning: shown.text }), ...(shown.clip ? { clip: shown.clip } : {}), ...(part.time?.start ? {} : { atBasis: 'carried' }) },
          })
          produced++
          lastText = this.events.at(-1)
        } else if (part.type === 'tool') {
          const state = part.state ?? {}
          const name = str(part.tool)
          const callId = str(part.callID || id)
          const category = categoryOf(name, state.input)
          const inputPointer = pointerOf(...pointerBase, 'state', 'input')
          const input = this.clip(JSON.stringify(state.input ?? {}), () => this.pointerSource(blob.rel, inputPointer, state.input ?? {}))
          const startMs = num(state.time?.start) ?? firstMs
          const at = atOf(startMs)
          if (!at) continue
          this.emit({
            id: `${node.id}#part:${id}`,
            node: node.id,
            at,
            kind: 'message',
            category,
            label: `assistant · ${name}`,
            source: { path: blob.rel, sha256: entry.sha256, pointer: pointerOf(...pointerBase) },
            detail: { role: 'assistant', publicToolCalls: [{ id: callId, name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
          })
          produced++
          if (state.status === 'completed' || state.status === 'error') {
            const field = state.status === 'error' ? 'error' : 'output'
            const body = str(state[field])
            const outPointer = pointerOf(...pointerBase, 'state', field)
            const shown = this.clip(body, () => this.pointerSource(blob.rel, outPointer, state[field]))
            const endMs = num(state.time?.end)
            this.emit({
              id: `${node.id}#part:${id}.result`,
              node: node.id,
              at: atOf(endMs ?? startMs)!,
              kind: 'tool-result',
              category,
              label: `tool result · ${name}`,
              source: { path: blob.rel, sha256: entry.sha256, pointer: pointerOf(...pointerBase, 'state') },
              detail: {
                role: 'toolResult',
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
        const itemPointer = pointerOf('events', index, 'data', 'event', 'item')
        const input = this.clip(JSON.stringify(inputValue), () => this.pointerSource(blob.rel, itemPointer, item))
        const category = categoryOf(name, inputValue)
        this.emit({
          id: `${node.id}#part:${id}`,
          node: node.id,
          at,
          kind: 'message',
          category,
          label: `assistant · ${name}`,
          source: { path: blob.rel, sha256: entry.sha256, pointer: itemPointer },
          detail: { role: 'assistant', publicToolCalls: [{ id: str(id), name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
        })
        const body = str(item.aggregated_output ?? item.result ?? item.output ?? item.status)
        const shown = this.clip(body, () => this.pointerSource(blob.rel, itemPointer, item))
        this.emit({
          id: `${node.id}#part:${id}.result`,
          node: node.id,
          at,
          kind: 'tool-result',
          category,
          label: `tool result · ${name}`,
          source: { path: blob.rel, sha256: entry.sha256, pointer: itemPointer },
          detail: {
            role: 'toolResult',
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
          const pointer = pointerOf('events', extra.index, 'data', 'event', 'content')
          const shown = this.clip(body, () => this.pointerSource(blob.rel, pointer, content))
          this.emit({
            id: `${node.id}#part:@${tag}.${events[extra.index]?.id ?? extra.index}`,
            node: node.id,
            at,
            kind: 'tool-result',
            category: 'other',
            label: 'tool result',
            source: { path: blob.rel, sha256: entry.sha256, pointer: pointerOf('events', extra.index) },
            detail: { role: 'toolResult', toolCallId: str(extra.data.tool_call_id), isError: /<system>ERROR/.test(body), publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), atBasis: 'carried' },
          })
          produced++
          continue
        }
        const window = extra.data.rateLimitType ?? null
        const utilization = window ? num(extra.data.unifiedWindows?.[window]?.utilization) ?? null : null
        this.emit({
          id: `${node.id}#part:@${tag}.${events[extra.index]?.id ?? extra.index}`,
          node: node.id,
          at,
          kind: extra.kind,
          category: 'lifecycle',
          label: extra.kind === 'rate-limit' ? `rate limit · ${window ?? 'window unknown'}` : 'execution error',
          source: { path: blob.rel, sha256: entry.sha256, pointer: pointerOf('events', extra.index) },
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
        const target = lastText ?? [...this.events].reverse().find((event) => event.node === node.id && event.source?.path === blob.rel)
        if (target && usage) {
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
    this.fileSource(rel)
    const rows = splitLines(entry.text).filter((row) => row.value?.event)
    if (!rows.length) return false
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
          id: `${node.id}#root:${first.value.seq ?? first.line}`,
          node: node.id,
          at,
          kind: 'message',
          category: 'reasoning',
          label: 'assistant',
          source: { path: rel, sha256: entry.sha256, line: first.line },
          detail: {
            role: 'assistant',
            ...(block.kind === 'text_delta' ? { publicText: shown.text } : { reasoning: shown.text }),
            ...(shown.clip ? { clip: shown.clip } : {}),
            ...(block.rows.length > 1 ? { lines: [first.line, lastRow.line] } : {}),
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
      if (!at) continue
      const key = `${node.id}#root:${row.value.seq ?? row.line}`
      const source = { path: rel, sha256: entry.sha256, line: row.line }
      const full = () => this.lineSource(rel, row.line, row.raw)
      if (kind === 'tool_call') {
        const input = this.clip(JSON.stringify(event.args ?? {}), full)
        callIds.add(str(event.toolCallId))
        this.emit({
          id: key,
          node: node.id,
          at,
          kind: 'message',
          category: categoryOf(str(event.toolName), event.args),
          label: `assistant · ${str(event.toolName)}`,
          source,
          detail: { role: 'assistant', publicToolCalls: [{ id: str(event.toolCallId), name: str(event.toolName), input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
        })
      } else if (kind === 'tool_result') {
        const result = event.result
        const body = typeof result === 'string' ? result : result && typeof result === 'object' && typeof result.error === 'string' && Object.keys(result).length === 1 ? result.error : JSON.stringify(result ?? null)
        const shown = this.clip(body, full)
        resultIds.add(str(event.toolCallId))
        this.emit({
          id: key,
          node: node.id,
          at,
          kind: 'tool-result',
          category: categoryOf(str(event.toolName), null),
          label: `tool result · ${str(event.toolName)}`,
          source,
          detail: {
            role: 'toolResult',
            toolCallId: str(event.toolCallId),
            isError: Boolean(result && typeof result === 'object' && ('error' in result || result.isError === true)),
            publicText: shown.text,
            ...(shown.clip ? { clip: shown.clip } : {}),
          },
        })
      }
    }
    flush()
    const unanswered = [...callIds].filter((id) => !resultIds.has(id)).length
    node.capture = {
      channel: 'root',
      status: unanswered || replayed ? 'lossy' : 'complete',
      reason: unanswered ? 'tool-results-not-streamed' : replayed ? 'resumed-attempt-replay-dropped' : null,
    }
    return true
  }

  build() {
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
    const result = this.resultJson()
    const hasJournal = this.nodes.size > 0
    if (!hasJournal) {
      const runtimeFiles = ['result.json', 'root-stream.jsonl', 'native-trajectory.json', 'trace'].some((name) => existsSync(join(runDir, name)))
      this.format = existsSync(join(runDir, 'native-trajectory.json'))
        ? 'bridge-native'
        : existsSync(join(runDir, 'failure.json'))
          ? 'failure-only'
          : existsSync(join(runDir, 'ledger.jsonl'))
            ? 'search'
            : 'other'
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
    const root = this.nodes.get(this.rootId)!
    if (existsSync(join(runDir, 'native-trajectory.json')) && this.format !== 'cloud') this.format = 'bridge-native'
    if (existsSync(join(runDir, 'trace/pi-sessions'))) this.format = 'pi-local'

    // Declared models, harness and assignment from the profile and task.
    const input = this.runInput
    if (input?.profile) {
      const model = input.profile.model
      root.model = typeof model === 'string' ? model : typeof model?.default === 'string' ? model.default : typeof model?.id === 'string' ? model.id : root.model
      root.modelSource = 'run input profile'
      if (typeof input.profile.harness === 'string') root.harness = input.profile.harness
    }
    const task = input?.task
    const assignmentText = typeof task === 'string' ? task : typeof task?.instruction === 'string' ? task.instruction : typeof task?.objective === 'string' ? task.objective : null
    if (assignmentText) root.assignment = this.clip(assignmentText, null).text
    for (const node of this.nodes.values()) {
      if (node.profileRef) {
        const profile = this.blob(node.profileRef)?.value
        if (profile && typeof profile === 'object') {
          const model = profile.model
          node.model = typeof model === 'string' ? model : typeof model?.default === 'string' ? model.default : node.model
          node.modelSource = 'spawn profile'
          if (typeof profile.harness === 'string') node.harness = profile.harness
        }
      }
      if (node.taskDigest && !node.assignment) {
        const blob = this.blob(node.taskDigest)
        if (blob && typeof blob.value === 'string') node.assignment = this.clip(blob.value, null).text
      }
    }
    if (result?.rootHarnessTranscript?.status === 'available' && typeof result.rootHarnessTranscript.transcriptRef === 'string') {
      if (!root.transcriptRefs.includes(result.rootHarnessTranscript.transcriptRef)) root.transcriptRefs.push(result.rootHarnessTranscript.transcriptRef)
    } else if (typeof result?.rootHarnessTranscript?.reason === 'string') root.transcriptReason ??= result.rootHarnessTranscript.reason

    // Conversation channels, first available wins.
    const pi = this.piSessions()
    const piByNode = new Map<string, typeof pi>()
    const digests = new Map<string, string>()
    for (const node of this.nodes.values()) if (node.taskDigest) digests.set(node.taskDigest, node.id)
    const unjoined: typeof pi = []
    for (const session of pi) {
      const nodeId = session.digest ? digests.get(session.digest) : undefined
      if (nodeId) {
        const list = piByNode.get(nodeId) ?? []
        list.push(session)
        piByNode.set(nodeId, list)
      } else unjoined.push(session)
    }
    for (const node of [...this.nodes.values()]) {
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
        node.joinBasis = 'task-digest'
        this.readPi(node, sessions)
        continue
      }
      if (this.readParts(node)) continue
      if (node.id === this.rootId && this.readRootStream(node)) continue
      const reason = native === 'not-cached' ? 'native-archive-not-cached' : node.transcriptReason ?? (node.outRefs.length ? 'no-conversation-in-output' : 'no-conversation-channel')
      node.capture = { channel: 'journal', status: 'absent', reason }
      this.gaps.push({ nodeId: node.id, code: `no-transcript:${reason}`, detail: 'Only lifecycle events are recorded for this agent' })
    }
    // Every other channel is a listed source, never duplicated as events.
    for (const name of ['root-stream.jsonl', 'native-trajectory.json', 'observer.jsonl', 'coordination-log.jsonl', 'driver-attempts.jsonl', 'spans.otlp.jsonl'])
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
    for (const name of listDir(join(runDir, 'kb/pages')).filter((name) => name.endsWith('.md'))) this.listSource(`kb/pages/${name}`)

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
    if (result && !root.status && typeof result.kind === 'string') {
      root.status = result.kind
      root.end ??= span.get(root.id)?.[1]
    }

    this.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (nodeOrder.get(a.node)! - nodeOrder.get(b.node)!) || a.order - b.order))
    const ids = new Set<string>()
    for (const event of this.events) {
      let id = event.id
      for (let n = 2; ids.has(id); n++) id = `${event.id}~${n}`
      event.id = id
      ids.add(id)
    }

    const captures = [...this.nodes.values()].map((node) => ({ nodeId: node.id, ...node.capture }))
    const counts = { complete: 0, lossy: 0, absent: 0 }
    for (const capture of captures) counts[capture.status]++
    const knowledge = task?.knowledge
    const completion = task?.completion
    const record = {
      schema: 'agent-record.v1',
      runId: this.runId,
      title: this.runId,
      producer: { name: '@drewstone/agent-record/adapters/agent-runtime', version: ADAPTER_VERSION },
      format: this.format,
      nodes: [...this.nodes.values()].map((node) => ({
        id: node.id,
        label: node.label,
        parent: node.parent,
        kind: node.kind,
        role: node.role,
        ...(node.assignment ? { assignment: node.assignment } : {}),
        model: node.model,
        ...(node.modelSource ? { modelSource: node.modelSource } : {}),
        servedModel: node.servedModel,
        harness: node.harness,
        ...(node.start ? { start: node.start } : {}),
        ...(node.end ? { end: node.end } : {}),
        ...(node.status ? { status: node.status } : {}),
        ...(node.nativeSessionId ? { nativeSessionId: node.nativeSessionId } : {}),
        ...(node.agentId ? { agentId: node.agentId } : {}),
        ...(node.joinBasis ? { joinBasis: node.joinBasis } : {}),
        sandboxes: node.sandboxes,
        capture: node.capture,
      })),
      events: this.events.map(({ order: _order, ...event }) => event),
      sources: [...this.sources.values()].map(({ sha256, ...source }) => (sha256 ? { ...source, sha256 } : source)).sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0) || (a.pointer ?? '').localeCompare(b.pointer ?? ''),
      ),
      assignment: {
        objective: str(task?.objective),
        instruction: str(task?.instruction ?? (typeof task === 'string' ? task : '')),
        knowledge: typeof knowledge === 'string' ? knowledge : knowledge ? JSON.stringify(knowledge, null, 2) : '',
        completion: typeof completion === 'string' ? completion : completion ? JSON.stringify(completion, null, 2) : '',
        suppliedKnowledge: typeof knowledge === 'string' ? knowledge : knowledge ? JSON.stringify(knowledge, null, 2) : '',
        deliverables: typeof completion === 'string' ? completion : completion ? JSON.stringify(completion, null, 2) : '',
        constraints: '',
        source: this.runInputRel ? { path: this.runInputRel, sha256: this.file(this.runInputRel, this.runInputRel.startsWith('../') ? join(dirname(this.runDir), this.runInputRel.slice(3)) : undefined).sha256, pointer: '/task' } : null,
      },
      terminal: result
        ? {
            kind: typeof result.kind === 'string' ? result.kind : null,
            reason: typeof result.reason === 'string' ? result.reason : null,
            ...(typeof result.error?.message === 'string' ? { error: this.clip(result.error.message, null).text } : {}),
          }
        : null,
      coverage: {
        completeOriginalCapture: counts.lossy === 0 && counts.absent === 0,
        publicContent: '',
        categoryMethod: 'Activity types come from a fixed map of tool names and shell commands in the agent-runtime adapter. They describe what a call did, not its value.',
        cost: 'List price from recorded usage; not billed.',
        nodes: captures,
        gaps: this.gaps.map((gap) => ({ runId: this.runId, ...gap })),
      },
    }
    return { record, counts }
  }
}

/** Convert one run directory. Throws RunUnreadableError or RecordTooLargeError. */
export function ingestRun(runDir: string, options: IngestOptions = {}) {
  const ingest = new Ingest(runDir, options.native, Math.max(1024, options.maxText ?? 16384))
  const { record, counts } = ingest.build()
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
