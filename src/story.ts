/**
 * A record read as a story: steps (a model turn merged with the tool call it made), episodes (steps toward one aim),
 * turning points and one summary. Every number a viewer shows comes from here, so the blog, sandbox-ui and the Lab
 * compute the same values. Missing values stay missing: a field is omitted, never printed as 0, a dash or "Unknown".
 */
import type { RecordEvent, RecordNode, RunRecord } from './record.js'

export type StepKind = 'read' | 'compute' | 'check' | 'write' | 'coordinate' | 'wait' | 'other'
export type StepOutcome = 'ok' | 'error' | 'none'
export type Tone = 'ok' | 'error' | 'warn' | 'info' | 'muted'

/** Tool durations under this are end-state stamps in part captures, not measurements; they are left out. */
export const MEASURED_FLOOR_MS = 5
/** Silence inside one agent longer than this starts a new episode. */
export const IDLE_SPLIT_MS = 3 * 60_000
/** A measured call at least this long is a long call: it draws as a bar and gets its own episode. */
export const LONG_STEP_MS = 4 * 60_000
/** Errors by one agent within this window are one turning point. */
export const ERROR_BURST_MS = 5 * 60_000
const EXCERPT_MAX = 160

export interface RecordPage { path: string; name: string; title?: string; body: string; bytes: number }

export interface RecordStep {
  id: string
  node: string
  at: number
  /** `at` plus the measured duration; `at` when the duration was not measured. */
  end: number
  /** Present only when measured (at least MEASURED_FLOOR_MS). */
  durationMs?: number
  kind: StepKind
  /** Plain tool name, e.g. `knowledge_record`; `server` names an MCP server when the call went through one. */
  tool: string
  server?: string
  /** The action in plain words, e.g. "Ran", "Recorded the page", "Read a file". */
  action: string
  /** What the action was done to, shown in monospace beside the action: a command, path or query. */
  object?: string
  objectMono?: boolean
  command?: string
  page?: RecordPage
  /** Published input that is neither a command nor a page. `inputJson` is true only when it parses as JSON. */
  input?: string
  inputJson?: boolean
  output?: string
  outputNote?: string
  outcome: StepOutcome
  long: boolean
  published: boolean
  callEventId: string
  resultEventId?: string
}

export type EpisodeItem =
  | { type: 'say'; id: string; at: number; text: string; note?: string }
  | { type: 'input'; id: string; at: number; text: string; note?: string; check?: RecordCheck }
  | { type: 'steer'; id: string; at: number; to?: string; toLabel?: string; text: string }
  | { type: 'note'; id: string; at: number; text: string; tone: Tone }
  | { type: 'step'; at: number; step: RecordStep }
  /** Two or more identical steps whose input and output the record does not publish. */
  | { type: 'repeat'; at: number; steps: RecordStep[]; action: string; kind: StepKind; outcome: StepOutcome }

export interface RecordEpisode {
  id: string
  n: number
  node: string
  start: number
  end: number
  title: string
  /** The agent's own first sentence (or the input's), cut at a sentence boundary. */
  quote?: string
  items: EpisodeItem[]
  steps: RecordStep[]
  errors: number
  mix: Partial<Record<StepKind, number>>
  /** An attempt the runtime timed but whose steps it did not keep. */
  notCaptured?: boolean
  /** True when some failed step in the episode publishes its error text. */
  errorTextPublished: boolean
  turningPoints: number[]
}

export type TurningKind = 'spawn' | 'never-started' | 'check' | 'input' | 'steer' | 'page' | 'attempt' | 'errors' | 'end'
export interface RecordTurningPoint {
  n: number
  at: number
  end?: number
  node: string
  kind: TurningKind
  tone: Tone
  title: string
  excerpt?: string
  episode?: string
  stepId?: string
}

/** An outside check's verdict carried by an input, set by its producer (`detail.check`); never parsed from text. */
export interface RecordCheck { outcome: 'passed' | 'failed'; by?: string; subject?: string; at?: number; reason?: string }

export interface RecordAgent {
  id: string
  label: string
  parent?: string
  depth: number
  role?: string
  assignment?: string
  model?: string
  harness?: string
  start?: number
  end?: number
  /** Plain words: finished, cancelled, never started, failed, running or ended. */
  status: string
  tone: Tone
  steps: number
  errors: number
  neverStarted: boolean
  captureNote?: string
}

export interface UncapturedSpan { node: string; start: number; end: number; label: string }

export interface RecordSummary {
  title: string
  asked?: string
  brief: Array<{ label: string; text: string }>
  start: number
  end: number
  durationMs: number
  agents: RecordAgent[]
  neverStarted: number
  /** "Claude Opus 5.5 on Claude Code", one per distinct pair. */
  models: string[]
  steps: number
  errors: number
  noResult: number
  withInput: number
  withOutput: number
  unmeasuredDurations: number
  /** Present only when every agent's metering is a running total. */
  outputTokens?: number
  /** The final running list-price total, summed over agents. Absent when the record keeps no cost. */
  costUsd?: number
  /** Ordered record facts, each a sentence. */
  result: string[]
  /** The claim of the run's last published page, with where it came from. */
  claim?: { text: string; at: number; node: string; by: string; stepId?: string; episode?: string }
  ending: { status: 'finished' | 'cancelled' | 'failed' | 'ended' | 'running'; at: number; by?: string; accepted?: boolean }
  /** What the record leaves out, in plain sentences. */
  leavesOut: string[]
}

export interface RecordStory {
  summary: RecordSummary
  steps: RecordStep[]
  episodes: RecordEpisode[]
  turningPoints: RecordTurningPoint[]
  gaps: UncapturedSpan[]
}

// ---------------------------------------------------------------------------------------------------------------
// Words and text
// ---------------------------------------------------------------------------------------------------------------

const T = (value: string | undefined) => (value ? Date.parse(value) : NaN)
const cap = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const basename = (path: string) => path.split('/').filter(Boolean).pop() ?? path
export const clockUtc = (ms: number, seconds = false) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, seconds ? 19 : 16) : '')

/** "3 h 5 min", "12 min", "48 s", "689 ms". */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60), rs = s % 60
  if (m < 60) return rs && m < 10 ? `${m} min ${rs} s` : `${m} min`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h} h ${rm} min` : `${h} h`
}

/** Plain text for a sentence shown as content: ISO stamps become clock times and long hex digests are dropped. */
export function plainText(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z/g, '$1 UTC')
    .replace(/\s*\((?:commit|sha256:?|digest)?\s*[0-9a-f]{12,}\)/gi, '')
    .replace(/\bsha256:[0-9a-f]{12,}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const ABBREVIATION = /\b(e\.g|i\.e|vs|cf|Fig|Eq|Def|Prop|No|Thm|Lem|Cor|Sec|Ch|approx|ca|al|rev|vol|pp|ver)\.$/i
/** The first sentence of a text, cut at a sentence boundary; a longer sentence is cut at its last clause boundary. */
export function firstSentence(text: string, max = EXCERPT_MAX): string {
  const raw = plainText(String(text).split(/\n\s*\n|\n(?=\s*(?:#|[-*] |\d+\. ))|\s…\s/)[0] ?? '').replace(/^[#>\s*-]+/, '').replace(/\*\*/g, '')
  const boundary = /([.!?])(\s+)(?=[A-Z0-9“"'`(*[])/g
  let sentence = raw
  for (let m = boundary.exec(raw); m; m = boundary.exec(raw)) {
    const before = raw.slice(0, m.index + 1)
    if (ABBREVIATION.test(before) || (/\d\.$/.test(before) && /^\s*\d/.test(raw.slice(m.index + 1)))) continue
    if ((before.match(/[([]/g)?.length ?? 0) > (before.match(/[)\]]/g)?.length ?? 0)) continue
    if (before.length >= 14) { sentence = before; break }
  }
  if (sentence.length <= max) return sentence
  // A long first sentence keeps its longest leading clause that fits (outside brackets); failing that, all of it.
  let best = '', depth = 0
  for (let i = 0; i < Math.min(sentence.length, max); i++) {
    const c = sentence[i]!
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    else if (!depth && i >= 60 && (c === ';' || (c === ':' && sentence[i + 1] === ' ') || (c === '—' && sentence[i - 1] === ' '))) best = sentence.slice(0, i).trim()
  }
  return best ? `${best}.` : sentence
}

/** A page's title: its first heading, without a leading label such as "notes/x FINAL (leaf L, run):". */
export function pageTitle(body: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  if (!heading) return undefined
  // A label before ": " that names a file, a FINAL or ends in a bracket is not part of the claim.
  const cut = /:\s+/g
  for (let m = cut.exec(heading); m && m.index <= 140; m = cut.exec(heading)) {
    const label = heading.slice(0, m.index), rest = heading.slice(m.index + m[0].length)
    if (rest.length >= 20 && (/\)$/.test(label) || /\/\S/.test(label) || /\bFINAL\b/.test(label))) return cap(plainText(rest))
  }
  return cap(plainText(heading))
}

const VENDOR: Record<string, string> = { claude: 'Claude', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', gpt: 'GPT', glm: 'GLM', gemini: 'Gemini', pro: 'Pro', flash: 'Flash', mini: 'mini', codex: 'Codex', kimi: 'Kimi', qwen: 'Qwen', deepseek: 'DeepSeek', grok: 'Grok', o: 'o' }
const HARNESS: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'opencode', codex: 'Codex', pi: 'Pi', gemini: 'Gemini CLI', 'gemini-cli': 'Gemini CLI' }
/** "claude-opus-5-5" → "Claude Opus 5.5"; "glm-5.3" → "GLM-5.3". */
export function modelName(id: string): string {
  const parts = id.split('/').pop()!.split('-')
  if (parts.length === 2 && /^\d+(\.\d+)?$/.test(parts[1]!) && VENDOR[parts[0]!.toLowerCase()]) return `${VENDOR[parts[0]!.toLowerCase()]}-${parts[1]}`
  const words: string[] = []
  for (const part of parts) {
    if (/^\d+$/.test(part) && words.length && /^\d+(\.\d+)?$/.test(words[words.length - 1]!) && !words[words.length - 1]!.includes('.')) words[words.length - 1] += `.${part}`
    else words.push(VENDOR[part.toLowerCase()] ?? part)
  }
  return words.join(' ')
}
export const harnessName = (id: string) => HARNESS[id.toLowerCase()] ?? id

/** `mcp__server__name` and `server-name_tool` split into the tool's own name and its server. */
export function splitTool(raw: string): { tool: string; server?: string } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(raw)
  if (mcp) return { tool: mcp[2]!, server: mcp[1]! }
  const prefixed = /^([a-z0-9]+(?:-[a-z0-9]+)+)_(.+)$/.exec(raw)
  if (prefixed) return { tool: prefixed[2]!, server: prefixed[1]! }
  return { tool: raw }
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------

const SHELL = new Set(['bash', 'shell', 'command', 'execute', 'exec', 'exec_command', 'run_command', 'terminal'])
const SHELL_PHRASE: Record<string, [string, StepKind]> = {
  compute: ['Ran a computation', 'compute'],
  literature: ['Read sources in the shell', 'read'],
  writing: ['Wrote files in the shell', 'write'],
  waiting: ['Checked on running work', 'wait'],
  setup: ['Set up the workspace', 'compute'],
  verification: ['Ran a check', 'check'],
  coordination: ['Ran a coordination command', 'coordinate'],
}
const TOOL_PHRASE: Record<string, [string, StepKind]> = {
  read: ['Read a file', 'read'], read_file: ['Read a file', 'read'], view: ['Read a file', 'read'],
  write: ['Wrote a file', 'write'], write_file: ['Wrote a file', 'write'], create_file: ['Wrote a file', 'write'],
  edit: ['Edited a file', 'write'], multiedit: ['Edited a file', 'write'], str_replace: ['Edited a file', 'write'], apply_patch: ['Edited files', 'write'], notebookedit: ['Edited a notebook', 'write'],
  glob: ['Listed files', 'read'], grep: ['Searched files', 'read'], ls: ['Listed files', 'read'], list: ['Listed files', 'read'],
  websearch: ['Searched the web', 'read'], web_search: ['Searched the web', 'read'], webfetch: ['Fetched a web page', 'read'], web_fetch: ['Fetched a web page', 'read'],
  toolsearch: ['Looked up its tools', 'other'], todowrite: ['Updated its task list', 'other'], monitor: ['Started a monitor', 'wait'], bashoutput: ['Checked on running work', 'wait'],
  knowledge_read: ['Read a knowledge page', 'read'], knowledge_search: ['Searched the knowledge pages', 'read'], knowledge_resolve: ['Looked up a knowledge page', 'read'], knowledge_record: ['Recorded a page', 'write'],
  spawn_worker: ['Asked for a helper agent', 'coordinate'], spawn_agent: ['Asked for a helper agent', 'coordinate'], task: ['Started a subagent', 'coordinate'], agent: ['Started a subagent', 'coordinate'],
  steer_agent: ['Steered an agent', 'coordinate'], send_message: ['Sent a message to an agent', 'coordinate'], observe_agent: ['Checked on a helper', 'coordinate'],
  read_journal: ['Read the run journal', 'read'], submit_result: ['Submitted its result', 'coordinate'], report_blocked: ['Reported that it was blocked', 'coordinate'],
  structuredoutput: ['Returned its answer', 'coordinate'], workflow: ['Started a workflow', 'coordinate'], taskstop: ['Stopped a background task', 'wait'], taskoutput: ['Checked on running work', 'wait'],
  kb_search: ['Searched the knowledge base', 'read'], kb_read: ['Read a knowledge page', 'read'], askuserquestion: ['Asked a question', 'coordinate'], exitplanmode: ['Proposed a plan', 'other'],
}
const CATEGORY_KIND: Record<string, StepKind> = { literature: 'read', compute: 'compute', writing: 'write', waiting: 'wait', verification: 'check', coordination: 'coordinate', setup: 'compute' }

function parseInput(raw: string | undefined): { page?: RecordPage; object?: Record<string, unknown>; text?: string; json?: boolean } {
  if (raw === undefined) return {}
  const file = /^---FILE:\s*(.+?)---\n?/.exec(raw)
  if (file) {
    const body = raw.slice(file[0].length), path = file[1]!.trim()
    return { page: { path, name: basename(path), title: pageTitle(body), body, bytes: new TextEncoder().encode(body).length } }
  }
  const trimmed = raw.trim()
  if (/^[[{]/.test(trimmed)) {
    try {
      const value = JSON.parse(trimmed) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) return { object: value as Record<string, unknown>, json: true }
      return { text: raw, json: true }
    } catch { /* not JSON */ }
  }
  return { text: raw }
}
const field = (object: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) if (typeof object?.[key] === 'string' && (object[key] as string).trim()) return object[key] as string
  return undefined
}

function describe(rawTool: string, category: string, input: ReturnType<typeof parseInput>, nodes: Map<string, RecordNode>): Pick<RecordStep, 'tool' | 'server' | 'action' | 'object' | 'objectMono' | 'command' | 'page' | 'kind'> {
  const { tool, server } = splitTool(rawTool), key = tool.toLowerCase()
  const shell = SHELL.has(key)
  const [phrase, toolKind] = shell ? SHELL_PHRASE[category] ?? ['Ran a command', 'compute'] : TOOL_PHRASE[key] ?? [`Used ${tool}`, CATEGORY_KIND[category] ?? 'other']
  const kind: StepKind = shell ? (category === 'verification' ? 'check' : toolKind) : toolKind
  const base = { tool, ...(server ? { server } : {}), kind }
  if (input.page) return { ...base, kind: 'write', action: 'Recorded the page', object: input.page.name, objectMono: true, page: input.page }
  const object = input.object
  const command = shell ? field(object, 'command', 'cmd', 'script') ?? (input.text?.trim() || undefined) : undefined
  if (command) return { ...base, action: 'Ran', object: command, objectMono: true, command }
  const path = field(object, 'file_path', 'filePath', 'path', 'file', 'notebook_path')
  const query = field(object, 'query', 'pattern', 'q', 'search')
  const url = field(object, 'url', 'uri')
  if (key.startsWith('knowledge_') && (path || query || field(object, 'id', 'page'))) {
    const what = path ?? query ?? field(object, 'id', 'page')!
    return { ...base, action: key === 'knowledge_search' ? 'Searched the knowledge pages for' : key === 'knowledge_record' ? 'Recorded the page' : 'Read the knowledge page', object: key === 'knowledge_search' ? `“${what}”` : what, objectMono: key !== 'knowledge_search' }
  }
  if (/^web_?search$/.test(key) && query) return { ...base, action: 'Searched the web for', object: `“${query}”` }
  if (/^web_?fetch$/.test(key) && url) return { ...base, action: 'Fetched', object: url, objectMono: true }
  if ((key === 'grep' || key === 'glob') && query) return { ...base, action: key === 'grep' ? 'Searched files for' : 'Listed files matching', object: `“${query}”` }
  if (path) return { ...base, action: phrase.replace(/ a file$| files$| a notebook$/, ''), object: path, objectMono: true }
  if ((key === 'steer_agent' || key === 'send_message' || key === 'observe_agent') && field(object, 'agent', 'agentId', 'to', 'target')) {
    const target = field(object, 'agent', 'agentId', 'to', 'target')!
    const node = [...nodes.values()].find((item) => item.id === target || item.id.endsWith(`:${target}`))
    return { ...base, action: phrase.replace(/ an agent$| a helper$/, ''), object: node?.label ?? target }
  }
  return { ...base, action: phrase }
}

// ---------------------------------------------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------------------------------------------

type Item = Exclude<EpisodeItem, { type: 'repeat' }> & { node: string }
interface Life { type: 'spawn' | 'end' | 'attempt'; node: string; at: number; status?: string; error?: boolean; by?: string; accepted?: boolean; n?: number; met?: boolean; reprompted?: boolean; durationMs?: number }

const cache = new WeakMap<RunRecord, RecordStory>()

/** The whole story of a record, computed once per record object. */
export function recordStory(record: RunRecord): RecordStory {
  const hit = cache.get(record)
  if (hit) return hit
  const story = build(record)
  cache.set(record, story)
  return story
}
export const summarizeRecord = (record: RunRecord) => recordStory(record).summary
export const recordSteps = (record: RunRecord) => recordStory(record).steps
export const recordEpisodes = (record: RunRecord) => recordStory(record).episodes
export const recordTurningPoints = (record: RunRecord) => recordStory(record).turningPoints

function build(record: RunRecord): RecordStory {
  const nodes = new Map(record.nodes.filter((node) => node.kind === 'agent' || node.kind === 'session').map((node) => [node.id, node]))
  const events = record.events.map((event, i) => ({ event, i, at: T(event.at) })).filter((item) => Number.isFinite(item.at) && nodes.has(item.event.node))
    .sort((a, b) => a.at - b.at || a.i - b.i)
  const results = new Map<string, RecordEvent>()
  for (const { event } of events) if (event.kind === 'tool-result' && event.detail.toolCallId) results.set(event.detail.toolCallId, event)
  const labelOf = (id: string) => nodes.get(id)?.label ?? id
  const target = (name: string) => [...nodes.values()].find((node) => node.id.endsWith(`:${name}`) || node.label === name)

  const items: Item[] = [], life: Life[] = [], steps: RecordStep[] = []
  const usd = new Map<string, number>(), outputs = new Map<string, number[]>()
  let unmeasured = 0
  const spawned = new Set<string>()
  for (const { event, at } of events) {
    const d = event.detail, node = event.node, data = (d.data ?? {}) as Record<string, any>
    if (event.kind === 'message' && d.role === 'assistant') {
      const calls = d.toolCallIds ?? []
      const steer = /^(\w+) → (.+)$/.exec(event.label)
      const coordination = d.coordination as { toNode?: string } | undefined
      if (d.publicText && (steer || coordination?.toNode)) {
        const to = coordination?.toNode ? nodes.get(coordination.toNode) : steer ? target(steer[2]!) : undefined
        items.push({ type: 'steer', id: event.id, node, at, text: d.publicText, ...(to ? { to: to.id, toLabel: to.label } : {}) })
      } else if (d.publicText) {
        items.push({ type: 'say', id: event.id, node, at, text: d.publicText, ...(d.publicationMode === 'excerpt' && d.publicationNote ? { note: d.publicationNote } : {}) })
      }
      calls.forEach((callId, i) => {
        const raw = d.toolNames?.[i] ?? d.toolNames?.[0] ?? 'tool'
        const call = d.publicToolCalls?.find((item) => item.id === callId)
        const result = results.get(callId)
        const input = parseInput(call?.input)
        let durationMs = typeof result?.detail.durationMs === 'number' ? result.detail.durationMs : undefined
        if (durationMs !== undefined && durationMs < MEASURED_FLOOR_MS) { durationMs = undefined; unmeasured++ }
        const described = describe(raw, event.category, input, nodes)
        const output = result?.detail.publicText
        const step: RecordStep = {
          id: callId, node, at, end: at + (durationMs ?? 0), ...(durationMs !== undefined ? { durationMs } : {}),
          ...described,
          ...(input.text !== undefined && !described.command ? { input: input.text, inputJson: !!input.json } : {}),
          ...(input.object && !described.command ? { input: JSON.stringify(input.object, null, 2), inputJson: true } : {}),
          ...(output ? { output } : {}),
          ...(output && result?.detail.publicationMode === 'excerpt' && result.detail.publicationNote ? { outputNote: result.detail.publicationNote } : {}),
          outcome: result ? (result.detail.isError ? 'error' : 'ok') : 'none',
          long: durationMs !== undefined && durationMs >= LONG_STEP_MS,
          published: call?.input !== undefined || !!output,
          callEventId: event.id, ...(result ? { resultEventId: result.id } : {}),
        }
        steps.push(step)
        items.push({ type: 'step', at, step, node })
      })
    } else if (event.kind === 'execution-input' && d.publicText) {
      const check = readCheck(d.check)
      items.push({ type: 'input', id: event.id, node, at, text: d.publicText, ...(d.publicationNote ? { note: d.publicationNote } : {}), ...(check ? { check } : {}) })
    } else if (event.kind === 'spawned') {
      if (!spawned.has(node)) { spawned.add(node); life.push({ type: 'spawn', node, at }) }
    } else if (event.kind === 'settled') {
      const verdict = data.verdict as { valid?: boolean } | undefined
      life.push({ type: 'end', node, at, status: String(data.status ?? nodes.get(node)?.status ?? 'ended'), error: !!d.isError, ...(verdict?.valid !== undefined ? { accepted: verdict.valid } : {}) })
    } else if (event.kind === 'cancelled') {
      const source = typeof data.source === 'string' ? data.source : undefined
      life.push({ type: 'end', node, at, status: 'cancelled', ...(source ? { by: `the ${source.split('/').pop()!.replace(/[-_]/g, ' ')}` } : {}) })
    } else if (event.kind === 'driver-attempt') {
      const rec = (data.record ?? {}) as { attempt?: number; contract?: string; reprompted?: boolean; durationMs?: number }
      if (typeof rec.attempt === 'number')
        life.push({ type: 'attempt', node, at, n: rec.attempt, met: rec.contract === 'met', reprompted: !!rec.reprompted, ...(typeof rec.durationMs === 'number' ? { durationMs: rec.durationMs } : {}) })
    } else if (event.kind === 'metered') {
      const spent = d.spent as { usd?: number } | undefined
      if (typeof spent?.usd === 'number' && spent.usd > 0) usd.set(node, Math.max(usd.get(node) ?? 0, spent.usd))
      const output = (d.usage as { output?: number } | undefined)?.output
      if (typeof output === 'number' && output > 0) outputs.set(node, [...(outputs.get(node) ?? []), output])
    } else if (d.role === 'user' && d.promptKind === 'steering') {
      items.push({ type: 'note', id: event.id, node, at, text: `${typeof d.promptSender === 'string' ? d.promptSender : 'Its parent'} steered it`, tone: 'info' })
    }
  }

  // Agents in tree order: each under its parent, siblings by start.
  const agentNodes = [...nodes.values()].filter((node) => node.kind === 'agent' || events.some((item) => item.event.node === node.id))
  const kids = new Map<string | undefined, RecordNode[]>()
  for (const node of agentNodes) {
    const parent = node.parent && nodes.has(node.parent) ? node.parent : undefined
    kids.set(parent, [...(kids.get(parent) ?? []), node])
  }
  const firstAt = (node: RecordNode) => T(node.start) || (events.find((item) => item.event.node === node.id)?.at ?? Infinity)
  const ordered: Array<{ node: RecordNode; depth: number }> = []
  const visit = (node: RecordNode, depth: number) => {
    ordered.push({ node, depth })
    for (const kid of [...(kids.get(node.id) ?? [])].sort((a, b) => firstAt(a) - firstAt(b))) visit(kid, depth + 1)
  }
  for (const root of [...(kids.get(undefined) ?? [])].sort((a, b) => firstAt(a) - firstAt(b))) visit(root, 0)
  const rank = new Map(ordered.map((entry, i) => [entry.node.id, i]))

  // Attempts the runtime timed but whose steps it did not keep.
  const gaps: UncapturedSpan[] = []
  for (const attempt of life.filter((item) => item.type === 'attempt')) {
    if (!attempt.durationMs || attempt.durationMs < 60_000) continue
    const start = attempt.at - attempt.durationMs
    const before = life.filter((item) => item.type === 'attempt' && item.node === attempt.node && item.at < attempt.at).pop()
    const from = Math.max(start, before?.at ?? -Infinity)
    if (!steps.some((step) => step.node === attempt.node && step.at >= from && step.at <= attempt.at))
      gaps.push({ node: attempt.node, start: from, end: attempt.at, label: `Attempt ${attempt.n}, steps not captured` })
  }

  const episodes = segment(ordered.map((entry) => entry.node.id), items, gaps, life)
  episodes.sort((a, b) => a.start - b.start || (rank.get(a.node) ?? 0) - (rank.get(b.node) ?? 0))
  episodes.forEach((episode, i) => { episode.n = i + 1; episode.id = `episode-${i + 1}` })

  const agents: RecordAgent[] = ordered.map(({ node, depth }) => {
    const own = steps.filter((step) => step.node === node.id), end = life.filter((item) => item.type === 'end' && item.node === node.id).pop()
    const ran = own.length > 0 || items.some((item) => item.node === node.id && item.type === 'say')
    const neverStarted = !ran && !!end && (end.error || end.status === 'down' || end.status === 'failed')
    const recorded = end?.status ?? node.status
    const status = neverStarted ? 'never started' : end?.error ? 'failed' : recorded === 'cancelled' ? 'cancelled' : recorded === 'running' && !end ? 'running' : recorded ? endWords(recorded).replace(/^was /, '') : 'ended'
    const tone: Tone = neverStarted || status === 'failed' ? 'error' : status === 'finished' ? 'ok' : status === 'cancelled' ? 'warn' : 'muted'
    return {
      id: node.id, label: node.label, ...(node.parent && nodes.has(node.parent) ? { parent: node.parent } : {}), depth,
      ...(node.role ? { role: node.role } : {}), ...(node.assignment ? { assignment: node.assignment } : {}),
      ...(node.servedModel || node.model ? { model: (node.servedModel || node.model)! } : {}), ...(node.harness ? { harness: node.harness } : {}),
      ...(Number.isFinite(T(node.start)) ? { start: T(node.start) } : {}), ...(Number.isFinite(T(node.end)) ? { end: T(node.end) } : {}),
      status, tone, steps: own.length, errors: own.filter((step) => step.outcome === 'error').length, neverStarted,
      ...(node.captureNote ? { captureNote: node.captureNote } : {}),
    }
  })

  const turningPoints = turning(record, agents, items, steps, episodes, life, labelOf)
  for (const point of turningPoints) episodes.find((episode) => episode.id === point.episode)?.turningPoints.push(point.n)
  const summary = summarize(record, agents, items, steps, life, usd, outputs, unmeasured, labelOf)
  if (summary.claim) {
    const { inputId, ...claim } = summary.claim as RecordSummary['claim'] & { inputId?: string }
    const episode = episodes.find((item) => item.steps.some((step) => step.id === claim.stepId) || item.items.some((entry) => 'id' in entry && entry.id === inputId))
    summary.claim = { ...claim, ...(episode ? { episode: episode.id } : {}) }
  }
  return { summary, steps, episodes, turningPoints, gaps }
}

function readCheck(value: unknown): RecordCheck | undefined {
  if (!value || typeof value !== 'object') return undefined
  const check = value as Record<string, unknown>
  if (check.outcome !== 'passed' && check.outcome !== 'failed') return undefined
  return {
    outcome: check.outcome,
    ...(typeof check.by === 'string' ? { by: check.by } : {}),
    ...(typeof check.subject === 'string' ? { subject: check.subject } : {}),
    ...(typeof check.at === 'string' && Number.isFinite(T(check.at)) ? { at: T(check.at) } : {}),
    ...(typeof check.reason === 'string' ? { reason: check.reason } : {}),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------------------------------------------

interface Segment { items: Item[]; lastEnd: number; wordsAt: number; mode: 'said' | 'input' | 'write' | 'long' | 'short' }
/** The next items of a long stretch, up to the next write: short steps between long calls stay with them. */
function lookahead(own: Item[], from: Item): Item[] {
  const out: Item[] = []
  for (const item of own.slice(own.indexOf(from), own.indexOf(from) + 10)) {
    if (item.type === 'step' && (item.step.page || item.step.tool.toLowerCase() === 'knowledge_record')) break
    out.push(item)
  }
  return out
}
const stepOf = (item: Item) => (item.type === 'step' ? item.step : undefined)
const familyOf = (step: RecordStep) => (step.long ? `long:${step.kind}` : step.kind)

function segment(order: string[], items: Item[], gaps: UncapturedSpan[], life: Life[]): RecordEpisode[] {
  const out: RecordEpisode[] = []
  for (const node of order) {
    const own = items.filter((item) => item.node === node)
    const segments: Segment[] = []
    let current: Segment | undefined
    for (const item of own) {
      const step = stepOf(item), end = step?.end ?? item.at
      let split = !current
      if (current) {
        const last = current.items[current.items.length - 1]!
        if (item.at - current.lastEnd > IDLE_SPLIT_MS) split = true
        else if (item.type === 'input') split = true
        else if (item.type === 'say') split = current.mode === 'write' || (current.items.filter((x) => x.type === 'step').length >= 3 && item.at - current.wordsAt > 120_000)
        else if (step?.page) split = !(current.mode === 'write' && last.type === 'step' && item.at - last.at < 120_000)
        else if (current.mode === 'write') split = true
        else if (step?.long) split = current.mode !== 'long' && current.items.filter((x) => x.type === 'step').length > 2
        else if (current.mode === 'long' && step) split = !lookahead(own, item).some((x) => stepOf(x)?.long)
      }
      if (split) {
        current = { items: [], lastEnd: -Infinity, wordsAt: -Infinity, mode: item.type === 'say' ? 'said' : item.type === 'input' ? 'input' : step?.page ? 'write' : step?.long ? 'long' : 'short' }
        segments.push(current)
      } else if (current!.mode === 'short' && step?.long) current!.mode = 'long'
      current!.items.push(item)
      current!.lastEnd = Math.max(current!.lastEnd, end)
      if (item.type === 'say' || item.type === 'input') current!.wordsAt = item.at
    }
    // Words with no steps after them belong to the stretch they close.
    for (let i = segments.length - 1; i > 0; i--) {
      const seg = segments[i]!, prev = segments[i - 1]!
      if (seg.mode === 'said' && !seg.items.some((x) => x.type === 'step') && seg.items[0]!.at - prev.lastEnd <= IDLE_SPLIT_MS) {
        prev.items.push(...seg.items)
        prev.lastEnd = Math.max(prev.lastEnd, seg.lastEnd)
        segments.splice(i, 1)
      }
    }
    // A long unnarrated stretch splits where its kind of work changes; one- and two-step stretches join a neighbour.
    const split: Segment[] = []
    for (const seg of segments) {
      const count = seg.items.filter((x) => x.type === 'step').length
      if (seg.mode !== 'short' || count <= 24) { split.push(seg); continue }
      let run: Segment | undefined, family = ''
      for (const item of seg.items) {
        const step = stepOf(item), f = step ? familyOf(step) : family
        if (!run || (f !== family && run.items.filter((x) => x.type === 'step').length >= 8 && remaining(seg.items, item, f) >= 6)) {
          run = { items: [], lastEnd: -Infinity, wordsAt: -Infinity, mode: 'short' }
          split.push(run)
        }
        family = f
        run.items.push(item)
        run.lastEnd = Math.max(run.lastEnd, step?.end ?? item.at)
      }
    }
    // Stretches of five steps or fewer with no words join a neighbouring stretch of the same agent.
    const tiny = (x: Segment) => x.mode === 'short' && x.items.filter((i) => i.type === 'step').length <= 5 && !x.items.some((i) => i.type !== 'step' && i.type !== 'note')
    const joins = (a: Segment, b: Segment) => (a.mode === 'short' || a.mode === 'said' || a.mode === 'long') && b.mode === 'short' && b.items[0]!.at - a.lastEnd <= IDLE_SPLIT_MS
    const tidy: Segment[] = []
    for (const seg of split) {
      const prev = tidy[tidy.length - 1]
      if (prev && joins(prev, seg) && (tiny(seg) || tiny(prev))) {
        prev.items.push(...seg.items)
        prev.lastEnd = Math.max(prev.lastEnd, seg.lastEnd)
      } else tidy.push(seg)
    }
    for (let i = tidy.length - 2; i >= 0; i--) {
      const seg = tidy[i]!, next = tidy[i + 1]!
      if (tiny(seg) && next.mode === 'short' && next.items[0]!.at - seg.lastEnd <= IDLE_SPLIT_MS) {
        next.items.unshift(...seg.items)
        tidy.splice(i, 1)
      }
    }
    for (const seg of tidy) out.push(episodeOf(node, seg))
    for (const gap of gaps.filter((item) => item.node === node)) {
      const attempt = life.find((item) => item.type === 'attempt' && item.node === node && item.at === gap.end)
      const before = life.find((item) => item.type === 'attempt' && item.node === node && item.n === (attempt?.n ?? 0) - 1)
      const asked = before && !before.met && before.reprompted ? 'The agent was asked again after the previous attempt ended before finishing. ' : ''
      const met = attempt?.met ? ' It met its finish condition.' : ''
      out.push({
        id: '', n: 0, node, start: gap.start, end: gap.end, title: gap.label,
        items: [{ type: 'note', id: `${node}:gap:${gap.start}`, at: gap.start, text: `${asked}The runtime timed this attempt but kept none of its steps.${met}`, tone: attempt?.met ? 'ok' : 'muted' }], steps: [], errors: 0, mix: {}, notCaptured: true, errorTextPublished: false, turningPoints: [],
      })
    }
  }
  return out
}
function remaining(items: Item[], from: Item, family: string): number {
  let n = 0
  for (const item of items.slice(items.indexOf(from))) {
    const step = stepOf(item)
    if (!step) continue
    if (familyOf(step) !== family) break
    n++
  }
  return n
}

const GIST: Record<StepKind, [string, (n: number) => string]> = {
  read: ['Read sources', (n) => `Read ${plural(n, 'source')}`],
  compute: ['Ran a computation', (n) => `Ran ${n} computations`],
  check: ['Ran a check', (n) => `Ran ${n} checks`],
  write: ['Wrote a file', (n) => `Wrote ${n} files`],
  coordinate: ['Coordinated with its team', (n) => `Coordinated with its team, ${n} steps`],
  wait: ['Checked on running work', (n) => `Checked on running work ${n} times`],
  other: ['Set up its tools', (n) => `Set up its tools, ${n} steps`],
}
/** One step's aim in a few words, for titles: the step's own phrase without its object. */
function gistOf(steps: RecordStep[]): string {
  const actions = new Map<string, number>()
  for (const step of steps) {
    const phrase = step.page ? 'Recorded a page' : step.object && step.action === 'Ran' ? SHELL_GIST[step.kind] : TOOL_GIST(step)
    actions.set(phrase, (actions.get(phrase) ?? 0) + 1)
  }
  const [top] = [...actions].sort((a, b) => b[1] - a[1])
  return top ? countPhrase(top[0], top[1]) : 'Worked'
}
const SHELL_GIST: Record<StepKind, string> = { read: 'Read sources in the shell', compute: 'Ran a computation', check: 'Ran a check', write: 'Wrote files in the shell', coordinate: 'Ran a coordination command', wait: 'Checked on running work', other: 'Ran a command' }
const TOOL_GIST = (step: RecordStep) => (TOOL_PHRASE[step.tool.toLowerCase()]?.[0] ?? (SHELL.has(step.tool.toLowerCase()) ? step.action : `Used ${step.tool}`))
/** "Ran a computation" × 3 → "Ran 3 computations"; "Searched the web" × 3 → "Searched the web 3 times". */
export function countPhrase(phrase: string, n: number): string {
  if (n === 1) return phrase
  const m = /^(.+?) (?:a|an) ([\w-]+(?: [\w-]+){0,2})$/.exec(phrase)
  if (m) {
    const words = m[2]!.split(' '), head = words.pop()!
    const plural = /[^aeiou]y$/.test(head) ? `${head.slice(0, -1)}ies` : /(s|sh|ch|x)$/.test(head) ? `${head}es` : `${head}s`
    return `${m[1]} ${n} ${[...words, plural].join(' ')}`
  }
  return `${phrase} ${n} times`
}
/** A rounded length for "about" phrases: "10 min", "1 h 20 min", "40 s". */
function about(ms: number): string {
  if (ms >= 3_600_000) return formatSpan(Math.round(ms / 60_000) * 60_000)
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`
  return `${Math.round(ms / 1000)} s`
}

function episodeOf(node: string, seg: Segment): RecordEpisode {
  const items = seg.items
  const steps = items.flatMap((item) => (item.type === 'step' ? [item.step] : []))
  const errors = steps.filter((step) => step.outcome === 'error').length
  const mix: Partial<Record<StepKind, number>> = {}
  for (const step of steps) mix[step.kind] = (mix[step.kind] ?? 0) + 1
  const said = items.find((item) => item.type === 'say') as Extract<Item, { type: 'say' }> | undefined
  const input = items.find((item) => item.type === 'input') as Extract<Item, { type: 'input' }> | undefined
  const pages = steps.filter((step) => step.page)
  const longs = steps.filter((step) => step.long)
  const steers = items.filter((item) => item.type === 'steer') as Array<Extract<Item, { type: 'steer' }>>
  let title: string
  if (input) title = input.check ? checkSentence(input.check, input.at) : inputName(input.note) ?? 'A new input arrived'
  else if (pages.length) title = pages.length === 1 ? `Recorded the page ${pages[0]!.page!.name}` : `Recorded ${pages.length} pages`
  else if (longs.length && longs.reduce((sum, step) => sum + step.durationMs!, 0) >= 0.5 * (Math.max(...steps.map((step) => step.end)) - steps[0]!.at)) {
    const mean = longs.reduce((sum, step) => sum + step.durationMs!, 0) / longs.length
    title = longs.length === 1 ? `Ran one ${about(mean)} computation` : `Ran ${longs.length} long computations, about ${about(mean)} each`
  } else if (steers.length) {
    const names = [...new Set(steers.map((steer) => steer.toLabel ?? 'an agent'))]
    title = names.length > 2 ? `Steered ${names.length} agents` : `Steered ${names.join(' and ')}`
  }
  else {
    const byKind = new Map<StepKind, RecordStep[]>()
    for (const step of steps) byKind.set(step.kind, [...(byKind.get(step.kind) ?? []), step])
    const ranked = [...byKind.values()].sort((a, b) => b.length - a.length)
    const parts = ranked.slice(0, 2).filter((list, i) => i === 0 || list.length >= 2).map((list) => gistOf(list))
    title = parts.length ? parts.map((part, i) => (i ? part[0]!.toLowerCase() + part.slice(1) : part)).join(', then ') : said ? 'Said what it would do next' : 'Waited'
  }
  if (!steps.length && said && !input) title = 'Explained its next move'
  // Only words someone wrote are quoted: the input's or the agent's own.
  const quote = input ? inputExcerpt(input.text) : said ? firstSentence(said.text) : undefined
  const ends = steps.map((step) => step.end)
  return {
    id: '', n: 0, node, start: items[0]!.at, end: Math.max(items[items.length - 1]!.at, ...ends), title, ...(quote ? { quote } : {}),
    items: foldRepeats(items), steps, errors, mix, errorTextPublished: steps.some((step) => step.outcome === 'error' && !!step.output), turningPoints: [],
  }
}

/** Runs of two or more identical unpublished steps become one row. */
function foldRepeats(items: Item[]): EpisodeItem[] {
  const out: EpisodeItem[] = []
  for (const item of items) {
    const { node: _node, ...plain } = item
    const step = stepOf(item)
    const prev = out[out.length - 1]
    const same = (other: RecordStep) => !other.published && other.action === step!.action && other.kind === step!.kind && other.outcome === step!.outcome && !other.long
    if (step && !step.published && !step.long && prev) {
      if (prev.type === 'repeat' && same(prev.steps[0]!)) { prev.steps.push(step); continue }
      if (prev.type === 'step' && same(prev.step)) { out[out.length - 1] = { type: 'repeat', at: prev.at, steps: [prev.step, step], action: step.action, kind: step.kind, outcome: step.outcome }; continue }
    }
    out.push(plain as EpisodeItem)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Turning points
// ---------------------------------------------------------------------------------------------------------------

const MAX_TURNING = 10
function checkSentence(check: RecordCheck, at: number): string {
  const by = check.by ? `${cap(check.by)}${check.by.endsWith('s') ? "'" : "'s"} check` : 'An outside check'
  return `${by} ${check.outcome === 'passed' ? 'passed' : 'failed'}${check.subject ? ` on ${check.subject}` : ''} at ${clockUtc(check.at ?? at)} UTC`
}

function turning(record: RunRecord, agents: RecordAgent[], items: Item[], steps: RecordStep[], episodes: RecordEpisode[], life: Life[], labelOf: (id: string) => string): RecordTurningPoint[] {
  const multi = agents.length > 1
  const who = (node: string) => (multi ? labelOf(node) : 'the agent')
  const episodeAt = (node: string, at: number) => episodes.filter((episode) => episode.node === node && episode.start <= at + 1).pop() ?? episodes.find((episode) => episode.node === node)
  type Candidate = Omit<RecordTurningPoint, 'n'> & { priority: number }
  const out: Candidate[] = []
  const add = (point: Omit<Candidate, 'episode'>) => out.push({ ...point, ...(episodeAt(point.node, point.at) ? { episode: episodeAt(point.node, point.at)!.id } : {}) })
  const roots = new Set(agents.filter((agent) => agent.depth === 0).map((agent) => agent.id))

  for (const agent of agents) {
    if (roots.has(agent.id)) continue
    const spawn = life.find((item) => item.type === 'spawn' && item.node === agent.id)
    if (agent.neverStarted && spawn) add({ at: spawn.at, node: agent.id, kind: 'never-started', tone: 'error', title: `${cap(agent.label)} never started`, ...(agent.assignment ? { excerpt: agent.assignment } : {}), priority: 1 })
    else if (spawn) {
      const parent = agent.parent ? labelOf(agent.parent) : 'Its parent'
      add({ at: spawn.at, node: agent.id, kind: 'spawn', tone: 'info', title: `${cap(parent)} started ${agent.label}`, ...(agent.assignment ? { excerpt: agent.assignment } : {}), priority: 4 })
    }
  }
  for (const item of items) {
    if (item.type === 'input') {
      const title = item.check ? checkSentence(item.check, item.at) : inputName(item.note) ?? `${multi ? cap(labelOf(item.node)) : 'The agent'} received a new input`
      add({ at: item.at, node: item.node, kind: item.check ? 'check' : 'input', tone: item.check ? (item.check.outcome === 'passed' ? 'ok' : 'error') : 'warn', title, excerpt: item.check?.reason ? firstSentence(item.check.reason) : inputExcerpt(item.text), priority: 1 })
    }
  }
  const pages = steps.filter((step) => step.page)
  const last = pages[pages.length - 1]
  if (last) add({ at: last.at, node: last.node, kind: 'page', tone: 'ok', title: `${multi ? `${cap(labelOf(last.node))} recorded` : 'Recorded'} the page ${last.page!.name}`, ...(last.page!.title ? { excerpt: firstSentence(last.page!.title) } : {}), stepId: last.id, priority: 2 })
  // Earlier page writes, one turning point per burst.
  for (const burst of bursts(pages.slice(0, -1), 10 * 60_000)) {
    add({ at: burst[0]!.at, node: burst[0]!.node, kind: 'page', tone: 'ok', title: burst.length === 1 ? `Recorded the page ${burst[0]!.page!.name}` : `Recorded ${burst.length} pages`, excerpt: burst.map((step) => step.page!.name).join(', '), stepId: burst[0]!.id, priority: 5 })
  }
  for (const attempt of life.filter((item) => item.type === 'attempt')) {
    if (!attempt.met && attempt.reprompted) add({ at: attempt.at, node: attempt.node, kind: 'attempt', tone: 'warn', title: `Attempt ${attempt.n} ended before finishing; ${who(attempt.node)} was asked again`, ...(attempt.durationMs ? { excerpt: `${multi ? cap(labelOf(attempt.node)) : 'It'} ran ${formatSpan(attempt.durationMs)} without meeting its finish condition.` } : {}), priority: 2 })
    else if (attempt.met && life.some((other) => other.type === 'attempt' && other.node === attempt.node && other.n === (attempt.n ?? 0) - 1 && !other.met))
      add({ at: attempt.at, node: attempt.node, kind: 'attempt', tone: 'ok', title: `Attempt ${attempt.n} met its finish condition`, ...(attempt.durationMs ? { excerpt: `After ${formatSpan(attempt.durationMs)}.` } : {}), priority: 3 })
  }
  for (const agent of agents) {
    const failed = steps.filter((step) => step.node === agent.id && step.outcome === 'error')
    for (const burst of bursts(failed, ERROR_BURST_MS, (step) => (SHELL.has(step.tool.toLowerCase()) ? 'shell' : step.tool))) {
      const first = burst[0]!, lastStep = burst[burst.length - 1]!
      const same = burst.every((step) => step.tool === first.tool)
      const what = same ? errorPhrase(first, burst.length) : `${burst.length} steps failed`
      const span = burst.length > 1 ? `, ${clockUtc(first.at)}–${clockUtc(lastStep.at)}` : ''
      const excerpt = first.output ? errorExcerpt(first.output) : undefined
      add({ at: first.at, ...(burst.length > 1 ? { end: lastStep.at } : {}), node: agent.id, kind: 'errors', tone: 'error', title: `${what}${span}`, ...(excerpt ? { excerpt } : {}), stepId: first.id, priority: burst.length >= 3 ? 3 : 6 })
    }
  }
  // Endings: grouped when agents end together the same way.
  const ends = life.filter((item) => item.type === 'end')
  const groups: Array<{ at: number; status: string; by?: string; nodes: string[]; accepted?: boolean }> = []
  for (const end of ends) {
    const agent = agents.find((item) => item.id === end.node)
    if (!agent || agent.neverStarted) continue
    const group = groups.find((item) => Math.abs(item.at - end.at) < 5_000 && item.status === end.status)
    if (group) group.nodes.push(end.node)
    else groups.push({ at: end.at, status: end.status ?? 'ended', ...(end.by ? { by: end.by } : {}), nodes: [end.node], ...(end.accepted !== undefined ? { accepted: end.accepted } : {}) })
  }
  for (const group of groups) {
    const names = group.nodes.map((id) => cap(labelOf(id))).join(' and ')
    const done = FINISHED.has(group.status)
    const title = group.status === 'cancelled' ? `${names} ${group.nodes.length > 1 ? 'were' : 'was'} cancelled${group.by ? ` by ${group.by}` : ''}` : `${names} ${endWords(group.status)}`
    add({ at: group.at, node: group.nodes[0]!, kind: 'end', tone: done ? 'ok' : group.status === 'cancelled' ? 'warn' : 'error', title, ...(done && group.accepted ? { excerpt: 'The runtime accepted its output.' } : {}), priority: 2 })
  }
  // A run that ended without its root settling ends at the root's last record.
  for (const root of agents.filter((agent) => roots.has(agent.id))) {
    if (ends.some((end) => end.node === root.id || end.status === 'cancelled') || root.end === undefined || !record.terminal?.kind) continue
    const reason = record.terminal.reason ? ` (${record.terminal.reason.replace(/[-_]+/g, ' ')})` : ''
    add({ at: root.end, node: root.id, kind: 'end', tone: record.terminal.kind === 'winner' ? 'ok' : 'warn', title: record.terminal.kind === 'no-winner' ? `The run ended without a winner${reason}` : record.terminal.kind === 'winner' ? 'The run ended with a winner' : `The run ended${reason}`, priority: 2 })
  }
  // About ten at most: the most important first, then in time order.
  const kept = [...out].sort((a, b) => a.priority - b.priority || a.at - b.at).slice(0, MAX_TURNING).sort((a, b) => a.at - b.at || a.priority - b.priority)
  return kept.map(({ priority: _priority, ...point }, i) => ({ ...point, n: i + 1 }))
}
const FINISHED = new Set(['done', 'settled', 'winner', 'finished', 'complete', 'completed', 'succeeded'])
/** A recorded end status in words: "finished", "went down", "failed", "ended without a winner". */
function endWords(status: string): string {
  if (FINISHED.has(status)) return 'finished'
  if (status === 'down') return 'went down'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'no-winner') return 'ended without a winner'
  if (status === 'cancelled') return 'was cancelled'
  return 'ended'
}
function bursts(list: RecordStep[], window: number, key: (step: RecordStep) => string = () => ''): RecordStep[][] {
  const out: RecordStep[][] = []
  for (const step of list) {
    const current = out[out.length - 1]
    if (current && step.node === current[0]!.node && key(step) === key(current[0]!) && step.at - current[current.length - 1]!.at <= window) current.push(step)
    else out.push([step])
  }
  return out
}
/** The line of an error's text that says what went wrong: the last line naming an error, else the first line. */
function errorExcerpt(text: string): string | undefined {
  const lines = plainText(text.replace(/<\/?tool_use_error>/g, '')).length ? text.replace(/<\/?tool_use_error>/g, '').split('\n').map((line) => line.trim()).filter((line) => line && !/^exit code \d+$/i.test(line)) : []
  const named = lines.filter((line) => /error|exception|no such file|not found|denied|refused|timed out|cannot|failed|unmatched|invalid/i.test(line)).pop()
  const line = named ?? lines[0]
  return line ? firstSentence(line) : undefined
}
function errorPhrase(step: RecordStep, n: number): string {
  if (step.page || step.tool.toLowerCase() === 'knowledge_record') return n === 1 ? 'A page write was refused' : `${n} page writes were refused`
  if (SHELL.has(step.tool.toLowerCase())) return n === 1 ? 'A command failed' : `${n} commands failed`
  const gist = TOOL_GIST(step)
  const lower = (text: string) => text[0]!.toLowerCase() + text.slice(1)
  return n === 1 ? `A step failed: ${lower(gist)}` : `${n} steps failed: ${lower(countPhrase(gist, n))}`
}

// ---------------------------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------------------------

const BRIEF: Array<[string, string]> = [['objective', 'Objective'], ['suppliedKnowledge', 'Supplied knowledge'], ['deliverables', 'Deliverables'], ['constraints', 'Constraints']]

function summarize(record: RunRecord, agents: RecordAgent[], items: Item[], steps: RecordStep[], life: Life[], usd: Map<string, number>, outputs: Map<string, number[]>, unmeasured: number, labelOf: (id: string) => string): RecordSummary {
  const times = [...agents.flatMap((agent) => [agent.start, agent.end]), ...items.map((item) => item.at), ...steps.map((step) => step.end), ...life.map((item) => item.at)].filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
  const start = times.length ? Math.min(...times) : NaN, end = times.length ? Math.max(...times) : NaN
  const roots = agents.filter((agent) => agent.depth === 0)
  const multi = agents.length > 1

  // What was asked: the run's objective, or the sole agent's own assignment when it is a sentence.
  const sole = agents.length === 1 ? record.nodes.find((node) => node.id === agents[0]!.id) : undefined
  let asked = record.assignment.objective?.trim() || undefined
  if (sole?.role && sole.role.split(/\s+/).length >= 5) asked = sole.role.replace(/^[A-Z][a-z]+:\s+/, '')
  if (asked) asked = askedSentence(asked)
  const brief = BRIEF.flatMap(([key, label]) => {
    const value = (record.assignment as Record<string, unknown>)[key]
    return typeof value === 'string' && value.trim() ? [{ label, text: value.trim() }] : []
  })

  const ends = life.filter((item) => item.type === 'end')
  const rootEnd = roots.map((root) => ends.filter((item) => item.node === root.id).pop()).filter(Boolean).pop()
  const cancels = ends.filter((item) => item.status === 'cancelled')
  const terminal = record.terminal
  let ending: RecordSummary['ending']
  if (rootEnd && FINISHED.has(rootEnd.status ?? '') && !rootEnd.error) ending = { status: 'finished', at: rootEnd.at, ...(rootEnd.accepted !== undefined ? { accepted: rootEnd.accepted } : {}) }
  else if (rootEnd?.status === 'cancelled' || terminal?.reason === 'cancelled' || (!rootEnd && cancels.length)) {
    const first = rootEnd?.status === 'cancelled' ? rootEnd : cancels[0]
    ending = { status: 'cancelled', at: first?.at ?? end, ...(first?.by ? { by: first.by } : {}) }
  } else if (rootEnd) ending = { status: rootEnd.error ? 'failed' : 'ended', at: rootEnd.at }
  else ending = { status: roots.some((root) => root.status === 'running') ? 'running' : 'ended', at: end }

  // The result, as ordered record facts.
  const result: string[] = []
  const checks = items.filter((item): item is Extract<Item, { type: 'input' }> => item.type === 'input' && !!item.check)
  const passed = checks.filter((item) => item.check!.outcome === 'passed').pop()
  const lastInput = items.filter((item): item is Extract<Item, { type: 'input' }> => item.type === 'input' && item.at <= ending.at).pop()
  let since: number | undefined
  if (passed) { result.push(`${checkSentence(passed.check!, passed.at)}.`); since = passed.check!.at ?? passed.at }
  else if (lastInput && ending.status !== 'finished') {
    const name = inputName(lastInput.note)
    const receiver = multi ? agentWords(labelOf(lastInput.node)) : 'the agent'
    result.push(name ? `At ${clockUtc(lastInput.at)} UTC ${receiver} received ${name[0]!.toLowerCase()}${name.slice(1)}.` : `At ${clockUtc(lastInput.at)} UTC ${receiver} received a new input.`)
    since = lastInput.at
  }
  const attempts = life.filter((item) => item.type === 'attempt' && roots.some((root) => root.id === item.node))
  const metAttempt = attempts.filter((item) => item.met).pop()
  if (ending.status === 'finished') {
    const accepted = ending.accepted ? 'Result accepted' : 'Finished'
    result.push(metAttempt && attempts.length > 1 ? `${accepted} on attempt ${metAttempt.n}; finished ${clockUtc(ending.at)} UTC.` : `${accepted}; finished ${clockUtc(ending.at)} UTC.`)
  } else if (ending.status === 'cancelled') {
    const after = since !== undefined && ending.at > since ? `, ${formatSpan(ending.at - since)} later` : ''
    const winner = terminal?.kind === 'no-winner' ? '; it ended without a winner' : ''
    result.push(`${ending.by ? cap(ending.by) : 'The run'} cancelled ${ending.by ? 'the run ' : ''}at ${clockUtc(ending.at)} UTC${after}${winner}.`.replace('The run cancelled', 'The run was cancelled'))
  } else if (ending.status === 'running') result.push(`Still running at ${clockUtc(end)} UTC.`)
  else if (Number.isFinite(ending.at)) result.push(`${ending.status === 'failed' ? 'Failed' : 'Ended'}${terminal?.kind === 'winner' ? ' with a winner' : ''} at ${clockUtc(ending.at)} UTC${terminal?.kind === 'no-winner' ? ' without a winner' : ''}.`)

  const pages = steps.filter((step) => step.page?.title)
  const lastPage = pages[pages.length - 1]
  const claim = lastPage ? { text: lastPage.page!.title!, at: lastPage.at, node: lastPage.node, stepId: lastPage.id, by: `${cap(labelOf(lastPage.node))}'s last published page, ${clockUtc(lastPage.at)} UTC` }
    : lastInput && ending.status !== 'finished' && !passed ? { text: inputExcerpt(lastInput.text), at: lastInput.at, node: lastInput.node, inputId: lastInput.id, by: `${inputName(lastInput.note) ?? 'The last input'}, ${clockUtc(lastInput.at)} UTC` } : undefined

  // Output tokens only when each agent's last metered count is its running total.
  const totals = [...outputs.values()].map((list) => (list[list.length - 1]! >= Math.max(...list) ? list[list.length - 1]! : NaN))
  const outputTokens = totals.length && totals.length === agents.filter((agent) => !agent.neverStarted).length && totals.every(Number.isFinite) && !multi ? totals.reduce((a, b) => a + b, 0) : undefined
  const costText = record.coverage.cost
  const costUsd = usd.size && !/^not recorded$/i.test(costText ?? '') ? [...usd.values()].reduce((a, b) => a + b, 0) : undefined

  const models = [...new Set(agents.filter((agent) => agent.model).map((agent) => `${modelName(agent.model!)}${agent.harness ? ` on ${harnessName(agent.harness)}` : ''}`))]
  const errors = steps.filter((step) => step.outcome === 'error').length
  const noResult = steps.filter((step) => step.outcome === 'none').length
  const withInput = steps.filter((step) => step.command || step.page || step.input !== undefined).length
  const withOutput = steps.filter((step) => step.output).length

  const leavesOut: string[] = []
  const shown = new Set(agents.map((agent) => agent.id))
  const withheld = (record.coverage.nodes ?? []).filter((item) => !shown.has(item.nodeId)).length
  if (withheld) leavesOut.push(`${withheld === 1 ? 'One other agent' : `${withheld} other agents`} of the run ${withheld === 1 ? 'is' : 'are'} withheld whole; ${agents.length === 1 ? `this record shows only ${agents[0]!.label}` : agents.length ? `this record shows only these ${agents.length}` : 'this record keeps no agent sessions'}.`)
  for (const agent of agents) if (agent.neverStarted) leavesOut.push(`${cap(agent.label)} never started, so it has no steps.`)
  const bare = steps.length - steps.filter((step) => step.published).length
  if (bare) leavesOut.push(`${bare} of ${plural(steps.length, 'step')} keep their tool, time and outcome but not their input or output.`)
  if (noResult) leavesOut.push(`${plural(noResult, 'call')} ${noResult === 1 ? 'has' : 'have'} no result in the record.`)
  if (errors && !steps.some((step) => step.outcome === 'error' && step.output)) leavesOut.push('The error text of failed steps is not published.')
  if (unmeasured) leavesOut.push(`${plural(unmeasured, 'step duration')} could not be measured (the capture stamps them at their end), so ${unmeasured === 1 ? 'it is' : 'they are'} not shown.`)
  if (steps.length - unmeasured - steps.filter((step) => step.durationMs !== undefined).length > 0) leavesOut.push('Steps with no result have no duration.')

  return {
    title: record.title, ...(asked ? { asked } : {}), brief, start, end, durationMs: end - start, agents,
    neverStarted: agents.filter((agent) => agent.neverStarted).length, models, steps: steps.length, errors, noResult, withInput, withOutput,
    unmeasuredDurations: unmeasured, ...(outputTokens !== undefined ? { outputTokens } : {}), ...(costUsd !== undefined ? { costUsd } : {}),
    result, ...(claim ? { claim } : {}), ending, leavesOut,
  }
}

/** An input's name from its publication note: "Wake input: the Lab's rc1 failure, from input blob sha256:…" → "The Lab's rc1 failure". */
export function inputName(note: string | undefined): string | undefined {
  if (!note) return undefined
  const name = note.replace(/^[A-Z][\w ]{0,24}:\s+/, '').replace(/,?\s*from [^,]*?sha256:[0-9a-f]+.*$/i, '').replace(/[\s.,;]+$/, '').trim()
  return name && name.length <= 80 ? cap(name) : undefined
}
/** The telling part of an input: a JSON verdict's reason, else the first sentence after a heading that ends in a colon. */
export function inputExcerpt(text: string): string {
  const parts = text.split(/\s…\s/)
  for (const part of parts) {
    const json = /\{[\s\S]*\}/.exec(part)?.[0]
    if (!json) continue
    try {
      const value = JSON.parse(json) as Record<string, unknown>
      for (const key of ['reason', 'message', 'error']) if (typeof value[key] === 'string') return cap(firstSentence(value[key] as string, 240))
    } catch { /* not JSON */ }
  }
  const head = plainText(parts[0] ?? '')
  return firstSentence(head.endsWith(':') && parts[1] ? parts[1] : head)
}
const agentWords = (label: string) => (/^[a-z]/.test(label) ? `the ${label}` : label)
/** "Recheck the table" → "Asked to recheck the table." */
function askedSentence(text: string): string {
  const sentence = firstSentence(text, 240)
  const body = sentence.replace(/[.\s]+$/, '')
  return `Asked to ${body[0]!.toLowerCase()}${body.slice(1)}.`
}
