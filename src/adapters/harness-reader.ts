/**
 * What the harness readers share (Node only). readLines reads a session file once, claims it for one node, lists it as
 * a source, keeps the lines inside a bundle's line window and anchors each timed line to the file's sha256 and its line;
 * a HarnessReader (claude.ts, codex.ts, pi.ts, bridge.ts) says only when a line happened and which events it holds.
 * opencode.ts anchors JSON Pointers into one document instead.
 */
import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BundleSession, Ingest, NodeDraft } from './agent-runtime.js'
import { num, type Json } from './part-events.js'

export { isoAt, num, str, type Json } from './part-events.js'
export type Source = { path: string; sha256: string; bytes: number; line?: number; pointer?: string; label?: string }
export type EventSource = { path: string; sha256: string; line?: number; pointer?: string; item?: number }

export const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
export const hexOf = (digest: unknown) =>
  typeof digest === 'string' && /^(sha256[:-])?[0-9a-f]{64}$/.test(digest) ? digest.slice(-64) : null
export const pointerOf = (...parts: (string | number)[]) =>
  '/' + parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')

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
  let value = input as Json
  if (typeof input === 'string')
    try {
      value = JSON.parse(input)
    } catch {
      value = null
    }
  const command = typeof value?.command === 'string' ? value.command : typeof value?.cmd === 'string' ? value.cmd : ''
  let category = TOOL_CATEGORIES.find(([pattern]) => pattern.test(tool))?.[1] ?? 'other'
  if (category === 'other' && /coordination/.test(server)) category = 'coordination'
  if ((category === 'compute' || category === 'other') && command) return SHELL_CATEGORIES.find(([pattern]) => pattern.test(command))?.[1] ?? 'compute'
  return category
}

// ---------------------------------------------------------------------------------------------------------
// File access. Reads only; every path stays inside the run directory or the native cache.
// ---------------------------------------------------------------------------------------------------------
export interface Line {
  line: number
  raw: string
  value: Json
}
/**
 * The non-blank physical lines (split on LF) of a file, each decoded on its own: a session larger than the longest
 * string V8 can hold (about 512 MiB) still converts. Lines `keep` rejects (outside a bundle's line window) are
 * neither decoded nor parsed.
 */
export function* splitLines(bytes: Buffer, keep?: (line: number) => boolean): Generator<Line> {
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
        yield { line, raw, value }
      }
    }
    start = end + 1
    line++
  }
}
const listDir = (path: string) => {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}
export function walk(root: string, rel = '', out: string[] = []): string[] {
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
/** The files under `dir` (relative to `root`) whose names end with `suffix`, as `<dir>/<path>`; none when it is absent. */
export const filesUnder = (root: string, dir: string, suffix: string) =>
  walk(join(root, dir)).filter((path) => path.endsWith(suffix)).map((path) => `${dir}/${path}`)

/**
 * A session file: its path as recorded, where it is when not inside the run directory, a bundle's inclusive line
 * windows, and its lines when the reader already split them to find which node it belongs to (the windows still apply).
 */
export interface SessionFile {
  rel: string
  abs?: string
  window?: [number, number][]
  rows?: Line[]
}
/**
 * One timed line of a session file: its anchor (the file's sha256 and the line), the source entry holding it whole, and
 * `emit`, which records an event of the line at its time (`item` when the line holds several).
 */
export interface Frame {
  value: Json
  at: string
  source: EventSource
  full: () => Source
  emit(event: { kind: string; category: Category; label: string; item?: number; detail: Record<string, unknown> }): void
}
/** One harness's line format: when a line happened (`last` is the previous timed line's time) and the events it holds. */
export interface HarnessReader {
  at(value: Json, last: string | null): string | null
  line(frame: Frame): void
  /** What one line holds, as a gap names it. */
  unit?: string
}

/** Read a session file onto `node`: null when another node already holds it. Torn and untimed lines are reported as gaps. */
export function readLines(ingest: Ingest, node: NodeDraft, { rel, abs, window, rows }: SessionFile, reader: HarnessReader) {
  const entry = ingest.file(rel, abs)
  if (!ingest.claim(entry.sha256, node.id, rel)) return null
  ingest.fileSource(rel, abs)
  const counts = { unparsable: 0, untimed: 0 }
  const keep = (line: number) => !window || window.some(([from, to]) => line >= from && line <= to)
  let last: string | null = null
  for (const row of rows?.filter((row) => keep(row.line)) ?? splitLines(entry.bytes, window && keep)) {
    const at: string | null = row.value ? reader.at(row.value, last) : null
    if (!row.value) counts.unparsable++
    else if (!at) counts.untimed++
    else {
      last = at
      const source = { path: rel, sha256: entry.sha256, line: row.line }
      const emit: Frame['emit'] = ({ kind, category, label, item, detail }) =>
        ingest.emit({ node: node.id, at, kind, category, label, source: item === undefined ? source : { ...source, item }, detail })
      reader.line({ value: row.value, at, source, full: () => ingest.lineSource(rel, row.line, row.raw), emit })
    }
  }
  const path = ingest.sourcePath(rel)
  if (counts.untimed) ingest.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${counts.untimed} ${reader.unit ?? 'lines'} of ${path} carry no time` })
  if (counts.unparsable) ingest.gaps.push({ nodeId: node.id, code: 'unparsable-lines', detail: `${counts.unparsable} lines of ${path} are not JSON` })
  return counts
}

/** A workflow journal's started agents: agent id -> its node and the journal line that started it. */
export type WorkflowAgents = Map<string, { node: string; rel: string; line: number }>
/** One harness's sessions in a bundle: the node a session becomes (found or created), with its file read onto it. */
export type SessionReader = (main: Ingest, session: BundleSession, agents: WorkflowAgents) => NodeDraft

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
      entries.delete(abs)
      if (hit?.key === key) {
        entries.set(abs, hit)
        return hit
      }
      if (hit) held -= hit.bytes.length
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

/** A file's sha256 and length, streamed so a large file is never held. */
export function hashFile(abs: string) {
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
export function utf8Slice(buffer: Buffer, start: number, end: number) {
  // Move boundaries off UTF-8 continuation bytes so no character is split.
  while (start > 0 && start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++
  while (end < buffer.length && end > 0 && (buffer[end]! & 0xc0) === 0x80) end--
  return buffer.subarray(start, end).toString('utf8')
}

function shellWords(segment: string) {
  const words: string[] = []
  let word = '', quote = '', escaped = false, started = false
  for (const char of segment) {
    if (escaped) { word += char; escaped = false; continue }
    if (char === '\\' && quote !== "'") { escaped = true; started = true; continue }
    if (quote) { if (char === quote) quote = ''; else word += char; continue }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/\s/.test(char)) { if (started) words.push(word); word = ''; started = false }
    else { word += char; started = true }
  }
  if (quote || escaped) return segment.trim().split(/\s+/)
  if (started) words.push(word)
  return words
}
function commandVerb(command: string) {
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const words = shellWords(segment).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
    while (words.length && (['sudo', 'env', 'time', 'exec', 'nohup', 'timeout'].includes(words[0]!) || /^\d+[smh]?$/.test(words[0]!))) words.shift()
    if (!words.length || ['cd', 'export', 'set', 'source', '.'].includes(words[0]!)) continue
    const program = words[0]!.split('/').at(-1)!
    if (!/^[A-Za-z0-9_.+\-]+$/.test(program)) return ''
    return [program, /^[a-z][a-z0-9\-]{1,24}$/.test(words[1] ?? '') ? words[1] : ''].filter(Boolean).join(' ')
  }
  return ''
}
function stepName(tool: string | null, input: Json) {
  let args = input
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = null } }
  const key = ['filePath', 'path', 'pattern', 'command', 'url', 'query'].find(key => typeof args?.[key] === 'string' && args[key].trim())
  let target: string = key ? args[key].trim().split(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u)[0] : ''
  if (key === 'filePath' || key === 'path') target = target.replace(/\/+$/, '').split('/').at(-1) ?? ''
  else if (key === 'command') target = commandVerb(target)
  else if (key === 'url') target = target.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]!.split('@').at(-1) ?? ''
  else target = [...target.replace(/[\p{L}\p{N}_+/=.\-]{20,}/gu, '…')].slice(0, 40).join('')
  return tool && target ? `${tool} · ${target}` : tool
}
function canonicalInput(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(', ')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${canonicalInput(key)}: ${canonicalInput(value[key])}`).join(', ')}}`
  return JSON.stringify(value ?? null).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
/** Safe activity metadata: command arguments and URL credentials never become a display name. */
export function toolObservation(tool: unknown, state: Json) {
  const name = typeof tool === 'string' ? tool : null, args = state?.input ?? null
  return { tool: name, start: num(state?.time?.start) ?? null, end: num(state?.time?.end) ?? null, failed: state?.status === 'error',
    inputDigest: sha(canonicalInput([tool ?? null, args])).slice(0, 16), name: stepName(name, args) }
}
