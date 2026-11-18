/**
 * A record read as a story: steps (a model turn merged with each tool call it made), episodes (steps toward one aim),
 * turning points and one summary. Everything comes from the record's own fields: node identity, parent, `agentId` join
 * and capture; each event's `category`, tool calls and results, `durationMs` and `atBasis`; usage and cost with their
 * scope; inputs' structured `check`; `claims` and recorded findings. No producer's tool names or text conventions are
 * parsed. A missing value stays missing: omitted, never printed as 0, a dash or "Unknown".
 */
import type { RecordEvent, RecordNode, RunRecord } from './record.js'
import { callSubject } from './adapters/part-events.js'

export type StepKind = 'read' | 'compute' | 'check' | 'write' | 'coordinate' | 'wait' | 'other'
export type StepOutcome = 'ok' | 'error' | 'none'
export type Tone = 'ok' | 'error' | 'warn' | 'info' | 'muted'
/** How a published text reads: JSON only when it parses; Markdown when it has headings, lists or tables; else plain. */
export type TextFormat = 'json' | 'markdown' | 'text'

/** Silence inside one agent longer than this, between observed times, starts a new episode. */
export const IDLE_SPLIT_MS = 3 * 60_000
/** A recorded call at least this long is a long call: it draws to scale and long calls form their own episodes. */
export const LONG_STEP_MS = 4 * 60_000
/** Narration opens a new episode only after this many steps and this long since the agent's last words. */
const NARRATION_STEPS = 3
const NARRATION_MS = 2 * 60_000
/** A short step stays in a stretch of long calls while another long call follows within this many items. */
const LONG_LOOKAHEAD = 10
/** An unnarrated stretch of more than UNNARRATED_MAX steps splits where its kind of work changes, once the current run
 *  has RUN_MIN steps and the new kind lasts RUN_TAIL steps. */
const UNNARRATED_MAX = 24
const RUN_MIN = 8
const RUN_TAIL = 6
/** A stretch of at most this many steps, with no words, joins a neighbouring stretch. */
const TINY_STEPS = 5
/** Endings of agents this close together, with the same status, are one turning point. */
const ENDS_TOGETHER_MS = 5_000
/** Recorded findings, or inputs to one agent, this close together are one turning point. */
const FINDING_BURST_MS = 10 * 60_000
const INPUT_BURST_MS = 10 * 60_000
/** A partly captured agent's silence at least this long, between its episodes, is shown as an uncaptured stretch;
 *  a shorter one is as likely a long model turn as missing capture. */
const UNCAPTURED_MIN_MS = 10 * 60_000
/** At most this many turning points; the start, the result and the end are always kept. */
const MAX_TURNING = 16
const EXCERPT_MAX = 160

/**
 * The one vocabulary: the importer's category of a call (`event.category`) as a kind of step and the phrase for a step
 * whose arguments are not published. Any other category is a step of kind `other`, phrased by its tool.
 */
const CATEGORY: Record<string, { kind: StepKind; phrase: string }> = {
  literature: { kind: 'read', phrase: 'Read a source' },
  compute: { kind: 'compute', phrase: 'Ran a computation' },
  setup: { kind: 'compute', phrase: 'Set up the workspace' },
  verification: { kind: 'check', phrase: 'Ran a check' },
  writing: { kind: 'write', phrase: 'Wrote a file' },
  coordination: { kind: 'coordinate', phrase: 'Coordinated with its team' },
  waiting: { kind: 'wait', phrase: 'Checked on running work' },
}

export interface RecordStep {
  id: string
  /** The agent that made the call: a session proven to be an agent's (`agentId`) is that agent. */
  node: string
  at: number
  /** `at` plus the recorded duration; `at` when none was recorded. */
  end: number
  /** False when `at` was not observed for this call (`atBasis`); such a time never opens or closes an idle stretch. */
  exact: boolean
  /** The recorded call-to-result time, present only when it is above zero. */
  durationMs?: number
  kind: StepKind
  /** Plain tool name, e.g. `Bash`; `server` names the MCP server it went through. */
  tool: string
  server?: string
  /** What kind of thing the step did, without its object: "Ran a computation", "Read a source". */
  phrase: string
  /** The action in plain words, e.g. "Ran", "Read", "Searched for", or the phrase when no object is published. */
  action: string
  /** What the action was done to, from the call's arguments: a command, path, query or address. */
  object?: string
  objectMono?: boolean
  command?: string
  /** Published arguments beyond the object, or the whole published input when it is not an argument object. */
  input?: string
  inputFormat?: TextFormat
  /** The publisher's note on the input, e.g. which of its arguments are withheld. */
  inputNote?: string
  output?: string
  outputFormat?: TextFormat
  outputNote?: string
  outcome: StepOutcome
  long: boolean
  published: boolean
  callEventId: string
  resultEventId?: string
}

/** An outside check's verdict carried by an input, set by its producer (`detail.check`); never parsed from text. */
export interface RecordCheck { outcome: 'passed' | 'failed'; by?: string; subject?: string; at?: number; reason?: string }

export type EpisodeItem =
  | { type: 'say'; id: string; at: number; text: string; note?: string }
  /** Text given to the agent (`role: 'user'`), or an outside check's verdict delivered to it. */
  | { type: 'input'; id: string; at: number; text: string; note?: string; check?: RecordCheck }
  | { type: 'note'; id: string; at: number; text: string; tone: Tone }
  | { type: 'step'; at: number; step: RecordStep }
  /** Two or more alike steps whose input and output the record does not publish. */
  | { type: 'repeat'; at: number; steps: RecordStep[]; action: string; kind: StepKind; outcome: StepOutcome }

export interface RecordEpisode {
  id: string
  n: number
  node: string
  start: number
  end: number
  title: string
  /** One line of someone's words under the title: what the agent said next, or the rest of the input. */
  quote?: string
  items: EpisodeItem[]
  steps: RecordStep[]
  errors: number
  mix: Partial<Record<StepKind, number>>
  /** A stretch of a partly captured agent's life with no captured steps. */
  notCaptured?: boolean
  /** True when some failed step in the episode publishes its error text. */
  errorTextPublished: boolean
  turningPoints: number[]
}

/** Real moments only: the start, spawns, an agent that never started, inputs and checks, findings, the result,
 *  endings. Failed steps stay on their steps and episodes. */
export type TurningKind = 'start' | 'spawn' | 'check' | 'input' | 'finding' | 'result' | 'end'
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
  /** The record's own status word in plain spelling ("done", "timed out"); "ended" when only an end is recorded, or
   *  "no end recorded". */
  status: string
  tone: Tone
  steps: number
  errors: number
  /** One sentence of what it did: its assignment or a descriptive role, or for an agent with nothing captured, why. */
  did?: string
  /** False when the record holds none of this agent's steps and its capture is absent. */
  captured: boolean
  captureNote?: string
  /** The list-price cost recorded for this agent, `billed` when every value says a bill confirms it; absent when none was. */
  cost?: { usd: number; billed: boolean }
  /** Output tokens recorded for this agent; absent when none were. */
  outputTokens?: number
}

export interface UncapturedSpan { node: string; start: number; end: number; label: string }

export interface RecordSummary {
  title: string
  asked?: string
  brief: Array<{ label: string; text: string }>
  /** Absent for a record with no timed event. */
  start?: number
  end?: number
  durationMs?: number
  agents: RecordAgent[]
  /** Agents with no captured steps. */
  uncaptured: number
  /** "Claude Opus 5.5 on Claude Code", one per distinct pair. */
  models: string[]
  steps: number
  errors: number
  noResult: number
  /** Present only when every captured agent recorded output tokens. */
  outputTokens?: number
  /** The recorded list-price cost, summed over the agents that recorded one (`of` of `agents`); `billed` only when every
   *  value says a bill confirms it (`usdKnown`). Absent when no agent recorded a cost. */
  cost?: { usd: number; billed: boolean; of: number; agents: number }
  /** Ordered record facts, each a sentence: the last check unless it gave the claim (its `by` names it), then how the
   *  run ended. */
  result: string[]
  /** The run's last recorded claim (`claims`), else its last recorded finding, else its last check's words, else the
   *  root agent's last words, with where it came from. */
  claim?: { text: string; at: number; node: string; by: string; episode?: string; eventId?: string }
  ending: { words: string; at?: number; tone: Tone }
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
// Words
// ---------------------------------------------------------------------------------------------------------------

/** Capitalised for the start of a sentence, unless its first word is an identifier such as `wf_4315e8f2` or `s2:s0`. */
const cap = (text: string) => (/^[a-z]+(?:[\s,.;·(]|$)/.test(text) ? text[0]!.toUpperCase() + text.slice(1) : text)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A producer's code word in plain spelling: `timed-out` → "timed out". */
const words = (code: string) => code.replace(/[-_]+/g, ' ').trim()
const NO_END = 'no end recorded'

/** A UTC time from an ISO string or epoch ms: `10-18 20:52Z`; `minute` gives `20:52`, `second` gives `20:52:07`. */
export function utc(value: string | number | null | undefined, form: 'day' | 'minute' | 'second' = 'day'): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return null
  const iso = date.toISOString()
  return form === 'day' ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : iso.slice(11, form === 'second' ? 19 : 16)
}

/** A length of time: `3 d 2 h`, `2 h 42 min`, `35 min`, `48 s`, `689 ms`. Null when it is not a length. */
export function span(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 59_500) return `${Math.round(ms / 1000)} s`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${hours / 24} d`
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}
const clock = (ms: number, seconds = false) => utc(ms, seconds ? 'second' : 'minute') ?? ''

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
  sentence = sentence.replace(/\s*[:;,]$/, '')
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

/** "Ran a computation" × 3 → "Ran 3 computations"; "Searched the web" × 3 → "Searched the web 3 times". */
export function countPhrase(phrase: string, n: number): string {
  if (n === 1) return phrase
  const m = /^(.+?) (?:a|an) ([\w-]+(?: [\w-]+){0,2})$/.exec(phrase)
  if (m) {
    const parts = m[2]!.split(' '), head = parts.pop()!
    const many = /[^aeiou]y$/.test(head) ? `${head.slice(0, -1)}ies` : /(s|sh|ch|x)$/.test(head) ? `${head}es` : `${head}s`
    return `${m[1]} ${n} ${[...parts, many].join(' ')}`
  }
  return `${phrase} ${n} times`
}

const VENDOR: Record<string, string> = { claude: 'Claude', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', gpt: 'GPT', glm: 'GLM', gemini: 'Gemini', pro: 'Pro', flash: 'Flash', mini: 'mini', codex: 'Codex', kimi: 'Kimi', qwen: 'Qwen', deepseek: 'DeepSeek', grok: 'Grok', o: 'o' }
const HARNESS: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'opencode', codex: 'Codex', pi: 'Pi', gemini: 'Gemini CLI', 'gemini-cli': 'Gemini CLI' }
/** "claude-opus-5-5" → "Claude Opus 5.5"; "glm-5.3" → "GLM-5.3". */
export function modelName(id: string): string {
  const parts = id.split('/').pop()!.split('-')
  if (parts.length === 2 && /^\d+(\.\d+)?$/.test(parts[1]!) && VENDOR[parts[0]!.toLowerCase()]) return `${VENDOR[parts[0]!.toLowerCase()]}-${parts[1]}`
  const out: string[] = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    if (/^\d+$/.test(part) && prev && /^\d+$/.test(prev)) out[out.length - 1] = `${prev}.${part}`
    else out.push(VENDOR[part.toLowerCase()] ?? part)
  }
  return out.join(' ')
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

/** JSON only when it parses as an object or list; Markdown when a line opens a heading, list or table. */
function textFormat(text: string, markdown: boolean): TextFormat {
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed)) try { JSON.parse(trimmed); return 'json' } catch { /* not JSON */ }
  return markdown && /\n/.test(trimmed) && /^(#{1,6} |\s*[-*] \S|\s*\d+\. \S|\|.*\|\s*$)/m.test(trimmed) ? 'markdown' : 'text'
}
const pretty = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text } }

// ---------------------------------------------------------------------------------------------------------------
// Reading the record
// ---------------------------------------------------------------------------------------------------------------

type Item = (
  | { type: 'say'; id: string; at: number; text: string; note?: string }
  | { type: 'input'; id: string; at: number; text: string; note?: string; check?: RecordCheck }
  | { type: 'note'; id: string; at: number; text: string; tone: Tone }
  | { type: 'step'; at: number; step: RecordStep }
) & { node: string; exact: boolean }
interface Finding { id: string; at: number; node: string; title: string }

/** One agent's spend in one measure (list-price USD or output tokens), by source. */
interface Spend { response: number; execution: number; session: Map<string, number>; meter: number; known: boolean; seen: boolean }
const same = (a: number, b: number | undefined) => b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))

/**
 * Spend per agent from the record's scoped values. Every source measures the same spend, so an agent's total is its
 * most complete source, never their sum: responses (no scope) and executions (`execution-total`) add up; a session's
 * cost state (`session-total`) runs to date, so each session counts its largest value; a meter (`metered`) is one
 * execution's spend to date, so a node's meters add up, except a meter that repeats the node's running total or its
 * previous meter, or a child's last meter: a settlement total or a roll-up the child already counts.
 */
function ledger(kidsOf: Map<string, string[]>) {
  const spends = new Map<string, Spend>(), meterSum = new Map<string, number>(), meterLast = new Map<string, number>()
  function add(raw: string, agent: string, value: unknown, scope: string | undefined, known: boolean) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (value === 0 && !known)) return
    let spend = spends.get(agent)
    if (!spend) spends.set(agent, (spend = { response: 0, execution: 0, session: new Map(), meter: 0, known: true, seen: false }))
    spend.seen = true
    if (!known) spend.known = false
    if (scope === 'execution-total') spend.execution += value
    else if (scope === 'session-total') spend.session.set(raw, Math.max(spend.session.get(raw) ?? 0, value))
    else if (scope === 'metered') {
      if (value === 0) return
      const sum = meterSum.get(raw) ?? 0
      const repeat = same(value, sum) || same(value, meterLast.get(raw)) || (kidsOf.get(raw) ?? []).some((kid) => same(value, meterLast.get(kid)))
      meterLast.set(raw, value)
      if (!repeat) { meterSum.set(raw, sum + value); spend.meter += value }
    } else spend.response += value
  }
  function total(agent: string): number | undefined {
    const spend = spends.get(agent)
    if (!spend?.seen) return undefined
    let session = 0
    for (const value of spend.session.values()) session += value
    return Math.max(spend.response, spend.execution, session, spend.meter)
  }
  return { add, total, known: (agent: string) => spends.get(agent)?.known ?? false }
}

const cache = new WeakMap<RunRecord, RecordStory>()

/** The whole story of a record, computed once per record object. */
export function recordStory(record: RunRecord): RecordStory {
  const hit = cache.get(record)
  if (hit) return hit
  const story = build(record)
  cache.set(record, story)
  return story
}

function build(record: RunRecord): RecordStory {
  const byId = new Map(record.nodes.map((node) => [node.id, node]))
  // A session proven to be an agent's is that agent; a finding node holds recorded findings, never steps.
  const agentOf = (id: string) => byId.get(id)?.agentId ?? id
  const events = record.events.map((event, i) => ({ event, i, at: Date.parse(event.at) })).filter((item) => Number.isFinite(item.at))
  events.sort((a, b) => a.at - b.at || a.i - b.i)

  // Results by the node that recorded them and their call id, in time order: harness call ids are unique within a
  // session, not across a run, so two agents' calls with one id never share a result.
  const results = new Map<string, RecordEvent[]>()
  for (const { event } of events) {
    if (event.kind !== 'tool-result' || event.detail.toolCallId === undefined) continue
    const key = `${event.node}\0${event.detail.toolCallId}`
    const list = results.get(key)
    if (list) list.push(event)
    else results.set(key, [event])
  }

  const items: Item[] = [], steps: RecordStep[] = [], findings: Finding[] = []
  const childIds = new Map([...group(record.nodes.filter((node) => node.parent), (node) => node.parent!)].map(([parent, list]) => [parent, list.map((node) => node.id)]))
  const usd = ledger(childIds), output = ledger(childIds)
  const firstAt = new Map<string, number>(), lastAt = new Map<string, number>(), failed = new Set<string>()
  for (const { event, at } of events) {
    const d = event.detail, raw = byId.get(event.node), node = agentOf(event.node), exact = d.atBasis === undefined
    if (raw?.kind === 'finding' || event.kind === 'finding-record') {
      const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : d.recordedClaim ? firstSentence(d.recordedClaim) : event.label
      findings.push({ id: event.id, at, node, title: plainText(title) })
      continue
    }
    if (exact) {
      if (!firstAt.has(node)) firstAt.set(node, at)
      lastAt.set(node, at)
    }
    if (event.category === 'lifecycle' && d.isError === true) failed.add(node)
    usd.add(event.node, node, d.costListUsd, d.usageScope ?? d.costScope, d.usdKnown === true)
    if (d.usageScope === 'metered' && d.costListUsd === undefined) usd.add(event.node, node, d.spent?.usd, 'metered', d.spent?.usdKnown === true)
    output.add(event.node, node, d.usage?.output, d.usageScope, true)
    const note = d.publicationNote ?? undefined

    if (event.kind === 'message' && d.role === 'assistant') {
      if (d.publicText) items.push({ type: 'say', id: event.id, node, at, exact, text: d.publicText, ...(note ? { note } : {}) })
      const published = new Map((d.publicToolCalls ?? []).map((call) => [call.id, call]))
      const ids = [...new Set([...(d.toolCallIds ?? []), ...published.keys()])]
      ids.forEach((callId, i) => {
        const call = published.get(callId)
        const name = call?.name ?? d.toolNames?.[i] ?? (d.toolNames?.length === 1 ? d.toolNames[0]! : 'tool')
        const result = results.get(`${event.node}\0${callId}`)?.shift()
        const step = makeStep(event, callId, i, ids.length, name, call?.input, call?.publicationNote ?? undefined, result, node, at, exact)
        steps.push(step)
        items.push({ type: 'step', node, at, exact, step })
      })
    } else if (d.publicText && event.kind !== 'tool-result' && (d.role === 'user' || readCheck(d.check))) {
      // Text given to the agent (`role: 'user'`), or an outside check's verdict delivered to it.
      const check = readCheck(d.check)
      items.push({ type: 'input', id: event.id, node, at, exact, text: d.publicText, ...(note ? { note } : {}), ...(check ? { check } : {}) })
    } else if (d.publicText && event.kind !== 'tool-result' && (event.category === 'lifecycle' || d.isError)) {
      // Any other text the record keeps about an agent, e.g. a reason, under the record's own label for the event.
      items.push({ type: 'note', id: event.id, node, at, exact, text: `${cap(words(event.label))}: ${firstSentence(d.publicText)}`, tone: d.isError ? 'error' : 'muted' })
    }
  }

  // Agents in tree order: each under its parent, siblings by first activity.
  const actors = record.nodes.filter((node) => node.kind === 'agent' || (node.kind === 'session' && !node.agentId && firstAt.has(node.id)))
  const start = (node: RecordNode) => { const t = Date.parse(node.start ?? ''); return Number.isFinite(t) ? t : firstAt.get(node.id) ?? Infinity }
  const isActor = new Set(actors.map((node) => node.id))
  const parentOf = (node: RecordNode) => { const parent = node.parent ? agentOf(node.parent) : undefined; return parent && isActor.has(parent) && parent !== node.id ? parent : undefined }
  const kids = new Map<string | undefined, RecordNode[]>()
  for (const node of actors) { const key = parentOf(node); const list = kids.get(key); if (list) list.push(node); else kids.set(key, [node]) }
  for (const list of kids.values()) list.sort((a, b) => start(a) - start(b))
  const ordered: Array<{ node: RecordNode; depth: number }> = []
  const seen = new Set<string>()
  const visit = (node: RecordNode, depth: number) => {
    if (seen.has(node.id)) return
    seen.add(node.id); ordered.push({ node, depth })
    for (const kid of kids.get(node.id) ?? []) visit(kid, depth + 1)
  }
  for (const root of kids.get(undefined) ?? []) visit(root, 0)
  const labelOf = (id: string) => byId.get(id)?.label ?? id
  const multi = ordered.length > 1

  const stepsBy = group(steps, (step) => step.node), itemsBy = group(items, (item) => item.node)
  const agents: RecordAgent[] = ordered.map(({ node, depth }) => {
    const own = stepsBy.get(node.id) ?? []
    const nodeStart = Date.parse(node.start ?? ''), nodeEnd = Date.parse(node.end ?? '')
    const captured = own.length > 0 || (itemsBy.get(node.id) ?? []).some((item) => item.type !== 'note') || node.capture?.status !== 'absent'
    const status = node.status ? words(node.status) : Number.isFinite(nodeEnd) || record.terminal?.kind ? 'ended' : NO_END
    const cost = usd.total(node.id), tokens = output.total(node.id), billed = usd.known(node.id)
    // What it did: its assignment or a role of more than one word; for an agent with nothing captured, why.
    const did = !captured && node.captureNote ? node.captureNote : node.assignment ?? (node.role && /\s/.test(node.role.trim()) ? node.role : undefined)
    return {
      id: node.id, label: node.label, ...(parentOf(node) ? { parent: parentOf(node)! } : {}), depth,
      ...(node.role ? { role: node.role } : {}), ...(node.assignment ? { assignment: node.assignment } : {}), ...(did?.trim() ? { did: firstSentence(did) } : {}),
      ...(node.servedModel || node.model ? { model: (node.servedModel || node.model)! } : {}), ...(node.harness ? { harness: node.harness } : {}),
      ...(Number.isFinite(nodeStart) ? { start: nodeStart } : {}), ...(Number.isFinite(nodeEnd) ? { end: nodeEnd } : {}),
      status, tone: failed.has(node.id) ? 'error' : 'muted', steps: own.length, errors: own.filter((step) => step.outcome === 'error').length,
      captured, ...(node.captureNote ? { captureNote: node.captureNote } : {}), ...(cost !== undefined ? { cost: { usd: cost, billed } } : {}), ...(tokens !== undefined ? { outputTokens: tokens } : {}),
    }
  })

  // Each agent's episodes, then the stretches of a partly captured agent's life between them with no captured items:
  // the record cannot say what it did then.
  const rank = new Map(ordered.map((entry, i) => [entry.node.id, i]))
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const episodes: RecordEpisode[] = [], gaps: UncapturedSpan[] = []
  for (const { node } of ordered) {
    const own = segment(itemsBy.get(node.id) ?? []).map((part) => episodeOf(node.id, part))
    episodes.push(...own)
    if (node.capture?.status !== 'lossy' && node.capture?.status !== 'absent') continue
    const agent = agentById.get(node.id)!
    let reach = agent.start ?? own[0]?.start
    if (reach === undefined) continue
    const close = (to: number) => { if (to - reach! >= UNCAPTURED_MIN_MS) gaps.push({ node: node.id, start: reach!, end: to, label: 'No steps captured' }) }
    for (const episode of own) { close(episode.start); reach = Math.max(reach, episode.end) }
    const end = agent.end ?? lastAt.get(node.id)
    if (end !== undefined) close(end)
  }
  for (const gap of gaps) episodes.push({
    id: '', n: 0, node: gap.node, start: gap.start, end: gap.end, title: `No steps captured for ${span(gap.end - gap.start)}`,
    items: [{ type: 'note', id: `${gap.node}:gap:${gap.start}`, at: gap.start, text: `The record keeps none of ${labelOf(gap.node)}'s steps between ${clock(gap.start)} and ${clock(gap.end)} UTC; its capture is partial.`, tone: 'muted' }],
    steps: [], errors: 0, mix: {}, notCaptured: true, errorTextPublished: false, turningPoints: [],
  })
  episodes.sort((a, b) => a.start - b.start || (rank.get(a.node) ?? 0) - (rank.get(b.node) ?? 0))
  episodes.forEach((episode, i) => { episode.n = i + 1; episode.id = `episode-${i + 1}` })
  const episodeOfStep = new Map<string, string>(), episodeOfItem = new Map<string, string>()
  for (const episode of episodes) {
    for (const step of episode.steps) episodeOfStep.set(step.id, episode.id)
    for (const item of episode.items) if ('id' in item) episodeOfItem.set(item.id, episode.id)
  }

  const summary = summarize(record, agents, items, steps, findings, labelOf)
  if (summary.claim?.eventId) { const episode = episodeOfItem.get(summary.claim.eventId); if (episode) summary.claim.episode = episode }
  const turningPoints = turning(record, agents, items, steps, findings, episodes, labelOf, multi, episodeOfStep, summary.claim)
  const byEpisode = new Map(episodes.map((episode) => [episode.id, episode]))
  for (const point of turningPoints) if (point.episode) byEpisode.get(point.episode)?.turningPoints.push(point.n)
  return { summary, steps, episodes, turningPoints, gaps }
}

function group<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of list) { const k = key(item); const held = out.get(k); if (held) held.push(item); else out.set(k, [item]) }
  return out
}

function makeStep(event: RecordEvent, callId: string, i: number, calls: number, name: string, input: string | undefined, inputNote: string | undefined,
  result: RecordEvent | undefined, node: string, at: number, exact: boolean): RecordStep {
  const { tool, server } = splitTool(name)
  const known = CATEGORY[event.category]
  const kind = known?.kind ?? 'other', phrase = known?.phrase ?? `Used ${tool}`
  const subject = input === undefined ? undefined : callSubject(input)
  const recorded = result?.detail.durationMs
  const durationMs = typeof recorded === 'number' && recorded > 0 && result?.detail.atBasis === undefined && exact ? recorded : undefined
  const output = result?.detail.publicText || undefined
  let described: Pick<RecordStep, 'action' | 'object' | 'objectMono' | 'command'> = { action: phrase }
  if (subject?.kind === 'command') described = { action: 'Ran', object: subject.text, objectMono: true, command: subject.text }
  else if (subject?.kind === 'path') described = { action: kind === 'write' ? 'Wrote' : kind === 'check' ? 'Checked' : 'Read', object: subject.text, objectMono: true }
  else if (subject?.kind === 'query') described = { action: 'Searched for', object: `“${subject.text}”` }
  else if (subject?.kind === 'url') described = { action: 'Fetched', object: subject.text, objectMono: true }
  // Published arguments beyond the object are shown whole; an object alone says everything already.
  let shown: string | undefined
  if (input !== undefined && !described.command) {
    const format = textFormat(input, true)
    if (format !== 'json') shown = input
    else {
      const value = (() => { try { return JSON.parse(input) as unknown } catch { return undefined } })()
      const rest = value && typeof value === 'object' && !Array.isArray(value) && subject ? Object.keys(value).filter((key) => key !== subject.key) : ['all']
      if (rest.length) shown = pretty(input)
    }
  }
  return {
    id: calls > 1 ? `${event.id}#${i}` : event.id, node, at, end: at + (durationMs ?? 0), exact, ...(durationMs !== undefined ? { durationMs } : {}),
    kind, tool, ...(server ? { server } : {}), phrase, ...described,
    ...(shown !== undefined ? { input: shown, inputFormat: textFormat(shown, true) } : {}), ...(input !== undefined && inputNote ? { inputNote } : {}),
    ...(output ? { output: textFormat(output, false) === 'json' ? pretty(output) : output, outputFormat: textFormat(output, false) } : {}),
    ...(output && result?.detail.publicationNote ? { outputNote: result.detail.publicationNote } : {}),
    outcome: result ? (result.detail.isError ? 'error' : 'ok') : 'none',
    long: durationMs !== undefined && durationMs >= LONG_STEP_MS,
    published: input !== undefined || !!output,
    callEventId: event.id, ...(result ? { resultEventId: result.id } : {}),
  }
}

function readCheck(value: unknown): RecordCheck | undefined {
  if (!value || typeof value !== 'object') return undefined
  const check = value as Record<string, unknown>
  if (check.outcome !== 'passed' && check.outcome !== 'failed') return undefined
  const at = typeof check.at === 'string' ? Date.parse(check.at) : NaN
  return {
    outcome: check.outcome,
    ...(typeof check.by === 'string' ? { by: check.by } : {}),
    ...(typeof check.subject === 'string' ? { subject: check.subject } : {}),
    ...(Number.isFinite(at) ? { at } : {}),
    ...(typeof check.reason === 'string' ? { reason: check.reason } : {}),
  }
}
function checkSentence(check: RecordCheck, at: number): string {
  const by = check.by ? `${cap(check.by)}${check.by.endsWith('s') ? "'" : "'s"} check` : 'An outside check'
  return `${by} ${check.outcome}${check.subject ? ` on ${check.subject}` : ''} at ${clock(check.at ?? at)} UTC`
}

// ---------------------------------------------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------------------------------------------

interface Part { items: Item[]; steps: number; lastEnd: number; wordsAt: number; long: boolean; words: boolean }
const newPart = (item?: Item): Part => ({ items: [], steps: 0, lastEnd: -Infinity, wordsAt: -Infinity, long: false, words: item?.type === 'say' || item?.type === 'input' })
const stepOf = (item: Item) => (item.type === 'step' ? item.step : undefined)
function add(part: Part, item: Item) {
  const step = stepOf(item)
  part.items.push(item)
  if (step) { part.steps++; if (step.long) part.long = true }
  if (item.exact) part.lastEnd = Math.max(part.lastEnd, step?.end ?? item.at)
  if (item.type === 'say' || item.type === 'input') part.wordsAt = item.at
}
const firstExact = (part: Part) => part.items.find((item) => item.exact)?.at
const near = (a: Part, b: Part) => { const at = firstExact(b); return at === undefined || a.lastEnd === -Infinity || at - a.lastEnd <= IDLE_SPLIT_MS }
const tiny = (part: Part) => !part.long && part.steps <= TINY_STEPS && part.items.every((item) => item.type === 'step' || item.type === 'note')

/** One agent's items, in time order, as stretches toward one aim. Every pass is linear in the items. */
function segment(items: Item[]): Item[][] {
  // The index of the next long step at or after each item.
  const nextLong = new Array<number>(items.length)
  for (let i = items.length - 1, next = Infinity; i >= 0; i--) { if (stepOf(items[i]!)?.long) next = i; nextLong[i] = next }
  const parts: Part[] = []
  let part: Part | undefined
  items.forEach((item, i) => {
    const step = stepOf(item)
    let split = !part
    if (part) {
      if (item.exact && part.lastEnd > -Infinity && item.at - part.lastEnd > IDLE_SPLIT_MS) split = true
      else if (item.type === 'input') split = true
      else if (item.type === 'say') split = part.steps >= NARRATION_STEPS && item.at - part.wordsAt > NARRATION_MS
      else if (step?.long) split = !part.long && part.steps > 2
      else if (step && part.long) split = nextLong[i]! - i > LONG_LOOKAHEAD
    }
    if (split) { part = newPart(item); parts.push(part) }
    add(part!, item)
  })
  // Words with no steps after them close the stretch before them.
  const joined: Part[] = []
  for (const p of parts) {
    const prev = joined[joined.length - 1]
    if (prev && !p.steps && p.items[0]!.type === 'say' && near(prev, p)) for (const item of p.items) add(prev, item)
    else joined.push(p)
  }
  // A long unnarrated stretch splits where its kind of work changes.
  const split: Part[] = []
  for (const p of joined) {
    if (p.words || p.long || p.steps <= UNNARRATED_MAX) { split.push(p); continue }
    const tail = new Array<number>(p.items.length)
    for (let i = p.items.length - 1, run = 0, kind = ''; i >= 0; i--) {
      const step = stepOf(p.items[i]!)
      if (step) { run = step.kind === kind ? run + 1 : 1; kind = step.kind }
      tail[i] = run
    }
    let current: Part | undefined, kind = ''
    p.items.forEach((item, i) => {
      const step = stepOf(item)
      if (!current || (step && step.kind !== kind && current.steps >= RUN_MIN && tail[i]! >= RUN_TAIL)) { current = newPart(); split.push(current) }
      if (step) kind = step.kind
      add(current, item)
    })
  }
  // Short stretches with no words join a neighbour of the same agent.
  const tidy: Part[] = []
  for (const p of split) {
    const prev = tidy[tidy.length - 1]
    if (prev && !p.words && !p.long && near(prev, p) && (tiny(p) || tiny(prev))) for (const item of p.items) add(prev, item)
    else tidy.push(p)
  }
  if (tidy.length > 1 && tiny(tidy[0]!) && !tidy[1]!.words && !tidy[1]!.long && near(tidy[0]!, tidy[1]!)) {
    const [first, second] = tidy.splice(0, 2) as [Part, Part]
    const merged = newPart()
    for (const item of [...first.items, ...second.items]) add(merged, item)
    tidy.unshift(merged)
  }
  return tidy.map((p) => p.items)
}

/** One line after a text's first sentence: the excerpt under a title taken from that sentence. */
function afterFirst(text: string): string | undefined {
  const head = firstSentence(text, Infinity).replace(/\.$/, '')
  const body = plainText(text.replace(/\*\*/g, ''))
  const at = body.indexOf(head)
  const rest = at < 0 ? '' : body.slice(at + head.length).replace(/^[.!?:;,\s]+/, '')
  return rest ? firstSentence(rest) : undefined
}

/** A step's object in a few words: a file's name, a command's program and first argument, an address's host. */
function shortObject(step: RecordStep): string {
  const text = step.object!.split('\n')[0]!.trim()
  const base = (word: string) => (word.includes('/') ? word.replace(/\/+$/, '').split('/').pop() || word : word)
  if (step.command) return text.replace(/^(?:cd \S+\s*(?:&&|;)\s*)+/, '').split(/\s+/).slice(0, 2).map(base).join(' ')
  if (step.action === 'Fetched') return text.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]!
  if (step.objectMono) return base(text)
  if (text.length <= 48) return text
  const cut = text.lastIndexOf(' ', 46)
  return `${text.slice(0, cut > 10 ? cut : 46)}”`
}

/** What an episode's steps acted on, from their published arguments: "Wrote README.md and claim.json", "Ran python3
 *  search.py". Undefined when no step publishes one. Without objects, the one kind of work most steps did. */
function aimOf(steps: RecordStep[]): string | undefined {
  const shown = steps.filter((step) => step.object)
  if (shown.length) {
    const [action, list] = [...group(shown, (step) => step.action)].sort((a, b) => b[1].length - a[1].length)[0]!
    const names = [...new Set(list.map(shortObject))]
    return `${action} ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`
  }
  if (!steps.length) return undefined
  const longs = steps.filter((step) => step.long)
  if (longs.length) {
    const mean = longs.reduce((sum, step) => sum + step.durationMs!, 0) / longs.length
    return `${countPhrase(longs[0]!.phrase, longs.length)}, about ${span(mean)}${longs.length > 1 ? ' each' : ''}`
  }
  const [phrase, list] = [...group(steps, (step) => step.phrase)].sort((a, b) => b[1].length - a[1].length)[0]!
  return countPhrase(phrase, list.length)
}

function episodeOf(node: string, items: Item[]): RecordEpisode {
  const steps = items.flatMap((item) => (item.type === 'step' ? [item.step] : []))
  const errors = steps.filter((step) => step.outcome === 'error').length
  const mix: Partial<Record<StepKind, number>> = {}
  for (const step of steps) mix[step.kind] = (mix[step.kind] ?? 0) + 1
  const said = items.find((item) => item.type === 'say') as Extract<Item, { type: 'say' }> | undefined
  const input = items.find((item) => item.type === 'input') as Extract<Item, { type: 'input' }> | undefined
  let start = Infinity, end = -Infinity
  for (const item of items) { start = Math.min(start, item.at); end = Math.max(end, item.type === 'step' ? item.step.end : item.at) }
  // The title is someone's own sentence: the input that opened the episode, else the agent's first words. Without
  // words it names what the steps acted on, else the one kind of work most of them did.
  let title: string, quote: string | undefined
  if (input) {
    title = input.check ? checkSentence(input.check, input.at) : firstSentence(input.text)
    quote = said ? firstSentence(said.text) : afterFirst(input.text)
  } else if (said) {
    title = firstSentence(said.text)
    quote = afterFirst(said.text) ?? items.filter((item): item is Extract<Item, { type: 'say' }> => item.type === 'say').slice(1).map((item) => firstSentence(item.text))[0]
  } else title = aimOf(steps) ?? 'Waited'
  return {
    id: '', n: 0, node, start, end, title, ...(quote ? { quote } : {}),
    items: foldRepeats(items), steps, errors, mix, errorTextPublished: steps.some((step) => step.outcome === 'error' && !!step.output), turningPoints: [],
  }
}

/** Runs of two or more alike steps whose input and output are not published become one row. */
function foldRepeats(items: Item[]): EpisodeItem[] {
  const out: EpisodeItem[] = []
  const alike = (a: RecordStep, b: RecordStep) => !a.published && a.phrase === b.phrase && a.kind === b.kind && a.outcome === b.outcome && !a.long
  for (const item of items) {
    const step = stepOf(item), prev = out[out.length - 1]
    if (step && !step.published && !step.long && prev) {
      if (prev.type === 'repeat' && alike(prev.steps[0]!, step)) { prev.steps.push(step); continue }
      if (prev.type === 'step' && alike(prev.step, step)) { out[out.length - 1] = { type: 'repeat', at: prev.at, steps: [prev.step, step], action: step.phrase, kind: step.kind, outcome: step.outcome }; continue }
    }
    if (item.type === 'step') out.push({ type: 'step', at: item.at, step: item.step })
    else { const { node: _n, exact: _e, ...rest } = item; out.push(rest as EpisodeItem) }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Turning points
// ---------------------------------------------------------------------------------------------------------------

function turning(record: RunRecord, agents: RecordAgent[], items: Item[], steps: RecordStep[], findings: Finding[], episodes: RecordEpisode[],
  labelOf: (id: string) => string, multi: boolean, episodeOfStep: Map<string, string>, claim: RecordSummary['claim']): RecordTurningPoint[] {
  const who = (node: string) => (multi ? cap(labelOf(node)) : 'The agent')
  const own = group(episodes, (episode) => episode.node)
  const episodeAt = (node: string, at: number) => {
    const list = own.get(node) ?? []
    let found: RecordEpisode | undefined = list[0]
    for (const episode of list) if (episode.start <= at + 1) found = episode
    return found?.id
  }
  type Candidate = Omit<RecordTurningPoint, 'n'> & { priority: number }
  const out: Candidate[] = []
  const add = (point: Omit<Candidate, 'episode'>) => {
    const episode = point.stepId ? episodeOfStep.get(point.stepId) : episodeAt(point.node, point.at)
    out.push({ ...point, ...(episode ? { episode } : {}) })
  }

  // Agents one parent started together are one turning point; a one-word role says nothing an excerpt needs to.
  const spawned = agents.filter((agent) => agent.parent && agent.start !== undefined).map((agent) => ({ at: agent.start!, agent })).sort((a, b) => a.at - b.at)
  for (const group of burst(spawned, ENDS_TOGETHER_MS, (item) => item.agent.parent!)) {
    const list = group.map((item) => item.agent), first = list[0]!
    // An agent with no captured steps is explained by its own ending point.
    const brief = !first.captured ? undefined : first.assignment ?? (first.role && /\s/.test(first.role) ? first.role : undefined)
    add({ at: first.start!, node: first.id, kind: 'spawn', tone: 'info', priority: 4,
      title: `${cap(labelOf(first.parent!))} started ${list.length === 1 ? first.label : `${list.length} agents`}`,
      ...(list.length > 1 ? { excerpt: list.map((agent) => agent.label).join(', ') } : brief ? { excerpt: firstSentence(brief) } : {}) })
  }
  for (const agent of agents) {
    if (!agent.captured && agent.end !== undefined) add({ at: agent.end, node: agent.id, kind: 'end', tone: agent.tone === 'error' ? 'error' : 'warn',
      title: `${cap(agent.label)} ${agent.status === 'ended' ? 'ended' : `ended: ${agent.status}`}${agent.start !== undefined ? ` after ${span(agent.end - agent.start)}` : ''}; none of its steps were captured`,
      ...(agent.captureNote ? { excerpt: agent.captureNote } : {}), priority: 1 })
  }
  // An input after the agent's first step changes its course; its opening prompt does not. A check always counts.
  const firstStep = new Map<string, number>()
  for (const step of steps) if (!firstStep.has(step.node)) firstStep.set(step.node, step.at)
  const prompts: Array<Extract<Item, { type: 'input' }>> = []
  for (const item of items) {
    if (item.type !== 'input') continue
    if (item.check) add({ at: item.at, node: item.node, kind: 'check', tone: item.check.outcome === 'passed' ? 'ok' : 'error', title: checkSentence(item.check, item.at), ...(item.check.reason ? { excerpt: firstSentence(item.check.reason) } : {}), priority: 1 })
    else if (firstStep.has(item.node) && item.at > firstStep.get(item.node)!) prompts.push(item)
  }
  for (const list of burst(prompts.sort((a, b) => a.node.localeCompare(b.node) || a.at - b.at), INPUT_BURST_MS, (item) => item.node)) {
    const first = list[0]!, last = list[list.length - 1]!
    add({ at: first.at, ...(list.length > 1 ? { end: last.at } : {}), node: first.node, kind: 'input', tone: 'warn', priority: 2,
      title: `${who(first.node)} received ${list.length === 1 ? 'a new prompt' : `${list.length} new prompts`}${list.length > 1 ? `, ${clock(first.at)}–${clock(last.at)}` : ''}`,
      excerpt: firstSentence(last.text) })
  }
  const bursts = burst(findings, FINDING_BURST_MS, (finding) => finding.node)
  bursts.forEach((list, i) => add({ at: list[0]!.at, ...(list.length > 1 ? { end: list[list.length - 1]!.at } : {}), node: list[0]!.node, kind: 'finding', tone: 'ok',
    title: list.length === 1 ? 'Recorded a finding' : `Recorded ${list.length} findings`, excerpt: list[list.length - 1]!.title, priority: i === bursts.length - 1 ? 2 : 5 }))
  // Endings of captured agents other than the root, grouped when they end together the same way; then the run's end.
  const ends = agents.filter((agent) => agent.parent && agent.captured && agent.end !== undefined).sort((a, b) => a.end! - b.end!)
  const together: RecordAgent[][] = []
  for (const agent of ends) {
    const last = together[together.length - 1]
    if (last && agent.end! - last[0]!.end! < ENDS_TOGETHER_MS && agent.status === last[0]!.status) last.push(agent)
    else together.push([agent])
  }
  for (const list of together) add({ at: list[0]!.end!, node: list[0]!.id, kind: 'end', tone: list.some((agent) => agent.tone === 'error') ? 'error' : 'muted',
    title: `${list.map((agent) => cap(agent.label)).join(' and ')} ${list[0]!.status === 'ended' ? 'ended' : `ended: ${list[0]!.status}`}`, priority: 3 })
  const root = agents.find((agent) => !agent.parent)
  const ending = runEnding(record, agents)
  // The run started at the earliest recorded start of any agent or observed item.
  let begun = items.find((item) => item.exact)?.at ?? Infinity
  for (const agent of agents) if (agent.start !== undefined && agent.start < begun) begun = agent.start
  if (root && Number.isFinite(begun)) add({ at: begun, node: root.id, kind: 'start', tone: 'muted', title: 'The run started', priority: 0 })
  // The result is its own moment unless it is a check's words, which the check's point already shows.
  if (claim && Number.isFinite(claim.at) && !items.some((item) => item.type === 'input' && item.check && item.id === claim.eventId)) add({ at: claim.at, node: claim.node, kind: 'result', tone: 'ok', title: 'The result', excerpt: firstSentence(claim.text), priority: 0 })
  if (root && ending.at !== undefined) add({ at: ending.at, node: root.id, kind: 'end', tone: ending.tone, title: ending.words === 'ended' ? 'The run ended' : `The run ended: ${ending.words}`, priority: 0 })
  const kept = out.sort((a, b) => a.priority - b.priority || a.at - b.at).slice(0, MAX_TURNING).sort((a, b) => a.at - b.at || a.priority - b.priority)
  return kept.map(({ priority: _priority, ...point }, i) => ({ ...point, n: i + 1 }))
}

function burst<T extends { at: number }>(list: T[], window: number, key: (item: T) => string): T[][] {
  const out: T[][] = []
  for (const item of list) {
    const current = out[out.length - 1]
    if (current && key(item) === key(current[0]!) && item.at - current[current.length - 1]!.at <= window) current.push(item)
    else out.push([item])
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------------------------

const BRIEF: Array<[string, string]> = [['objective', 'Objective'], ['suppliedKnowledge', 'Supplied knowledge'], ['deliverables', 'Deliverables'], ['constraints', 'Constraints']]

/** How the run ended, from the root's own end and status and the record's terminal state. */
function runEnding(record: RunRecord, agents: RecordAgent[]): RecordSummary['ending'] {
  const root = agents.find((agent) => !agent.parent)
  const terminal = record.terminal
  const kind = terminal?.kind ? words(terminal.kind) : root?.status && root.status !== NO_END && root.status !== 'ended' ? root.status : undefined
  const reason = terminal?.reason ? words(terminal.reason) : undefined
  const open = !terminal?.kind && (!root || root.status === NO_END)
  // The reason ("cancelled") is the more specific word; the kind stands when no reason is recorded.
  const said = open ? NO_END : reason ?? kind ?? 'ended'
  return { words: said, ...(root?.end !== undefined ? { at: root.end } : {}), tone: root?.tone === 'error' ? 'error' : 'muted' }
}

function summarize(record: RunRecord, agents: RecordAgent[], items: Item[], steps: RecordStep[], findings: Finding[], labelOf: (id: string) => string): RecordSummary {
  let start = Infinity, end = -Infinity
  const take = (t: number | undefined) => { if (t !== undefined && Number.isFinite(t)) { start = Math.min(start, t); end = Math.max(end, t) } }
  for (const agent of agents) { take(agent.start); take(agent.end) }
  for (const item of items) if (item.exact) { take(item.at); if (item.type === 'step') take(item.step.end) }
  for (const finding of findings) take(finding.at)
  const timed = Number.isFinite(start)

  const sole = agents.length === 1 ? agents[0] : undefined
  const objective = record.assignment.objective?.trim() || sole?.assignment || sole?.role
  const brief = BRIEF.flatMap(([key, label]) => {
    const value = (record.assignment as Record<string, unknown>)[key]
    // A field whose whole text says it is unknown says nothing.
    return typeof value === 'string' && value.trim() && !/^(unknown|n\/a|none)\.?$/i.test(value.trim()) ? [{ label, text: value.trim() }] : []
  })

  const ending = runEnding(record, agents)
  const checked = items.filter((item): item is Extract<Item, { type: 'input' }> => item.type === 'input' && !!item.check).pop()

  // The claim: the last recorded claim, else the last recorded finding, else the last check's own words, else the root
  // agent's last words.
  const claims = record.claims ?? []
  const lastClaim = claims[claims.length - 1], lastFinding = findings[findings.length - 1]
  const claimEvent = lastClaim?.eventId ? record.events.find((event) => event.id === lastClaim.eventId) : undefined
  const claimAt = claimEvent ? Date.parse(claimEvent.at) : NaN
  let claim: RecordSummary['claim']
  if (lastClaim) claim = { text: firstSentence(lastClaim.statement, 240), at: claimAt, node: lastClaim.agentNodeId ?? '', by: `${lastClaim.agentNodeId ? `${cap(labelOf(lastClaim.agentNodeId))}'s` : 'The'} last recorded claim${Number.isFinite(claimAt) ? `, ${clock(claimAt)} UTC` : ''}`, ...(lastClaim.eventId ? { eventId: lastClaim.eventId } : {}) }
  else if (lastFinding) claim = { text: lastFinding.title, at: lastFinding.at, node: lastFinding.node, by: `The last recorded finding, ${clock(lastFinding.at)} UTC`, eventId: lastFinding.id }
  else if (checked) claim = { text: checked.check!.reason ?? firstSentence(checked.text, 240), at: checked.at, node: checked.node, by: `${checkSentence(checked.check!, checked.at)}`, eventId: checked.id }
  else {
    // Without a claim, finding or check, the result is the run's own last words: the root agent's last message.
    const root = agents.find((agent) => !agent.parent)
    let words: Extract<Item, { type: 'say' }> | undefined
    for (const item of items) if (item.type === 'say' && item.node === root?.id) words = item
    if (words) claim = { text: firstSentence(words.text, 240), at: words.at, node: words.node, by: `${agents.length > 1 ? `${cap(root!.label)}'s` : 'The agent\'s'} last words, ${clock(words.at)} UTC`, eventId: words.id }
  }
  // The check that gave the claim is named in its `by`; the result does not say it twice.
  const result: string[] = []
  if (checked && claim?.eventId !== checked.id) result.push(`${checkSentence(checked.check!, checked.at)}.`)
  if (ending.words === NO_END) result.push(timed ? `The record has no end for the run; its last event is at ${clock(end)} UTC.` : 'The record has no end for the run.')
  else result.push(`The run ended${ending.at !== undefined ? ` at ${clock(ending.at)} UTC` : ''}${ending.words === 'ended' ? '' : `: ${ending.words}`}.`)

  const captured = agents.filter((agent) => agent.captured)
  const costs = agents.filter((agent) => agent.cost)
  const tokens = captured.length > 0 && captured.every((agent) => agent.outputTokens !== undefined) ? captured.reduce((sum, agent) => sum + agent.outputTokens!, 0) : undefined
  const withHarness = new Set(agents.filter((agent) => agent.model && agent.harness).map((agent) => modelName(agent.model!)))
  const models = [...new Set(agents.filter((agent) => agent.model && (agent.harness || !withHarness.has(modelName(agent.model)))).map((agent) => `${modelName(agent.model!)}${agent.harness ? ` on ${harnessName(agent.harness)}` : ''}`))]
  const errors = steps.filter((step) => step.outcome === 'error').length
  const noResult = steps.filter((step) => step.outcome === 'none').length

  const leavesOut: string[] = []
  const shown = new Set(agents.map((agent) => agent.id))
  const withheld = (record.coverage.nodes ?? []).filter((item) => !shown.has(item.nodeId) && !findings.some((finding) => finding.node === item.nodeId)).length
  if (!agents.length && findings.length) leavesOut.push('The record keeps recorded findings only, not the agents that made them.')
  if (withheld) leavesOut.push(`${withheld === 1 ? 'One other agent' : `${withheld} other agents`} of the run ${withheld === 1 ? 'is' : 'are'} withheld whole; ${agents.length === 1 ? `this record shows only ${agents[0]!.label}` : agents.length ? `this record shows only these ${agents.length}` : 'this record keeps no agents'}.`)
  for (const agent of agents) if (!agent.captured) leavesOut.push(agent.captureNote ? `${cap(agent.label)}: ${agent.captureNote}` : `None of ${agent.label}'s steps were captured.`)
  const bare = steps.length - steps.filter((step) => step.published).length
  if (bare) leavesOut.push(`${bare} of ${plural(steps.length, 'step')} keep their tool, time and outcome but not their input or output.`)
  if (noResult) leavesOut.push(`${plural(noResult, 'call')} ${noResult === 1 ? 'has' : 'have'} no result in the record, so ${noResult === 1 ? 'it has' : 'they have'} no outcome or duration.`)
  if (errors && !steps.some((step) => step.outcome === 'error' && step.output)) leavesOut.push('The error text of failed steps is not published.')
  if (costs.length && costs.length < captured.length) leavesOut.push(`Cost is recorded for ${costs.length} of ${plural(captured.length, 'agent')}.`)
  else if (!costs.length && steps.length) leavesOut.push('The record keeps no cost.')

  return {
    title: record.title, ...(objective ? { asked: firstSentence(objective, 240) } : {}), brief,
    ...(timed ? { start, end, durationMs: end - start } : {}), agents, uncaptured: agents.filter((agent) => !agent.captured).length, models,
    steps: steps.length, errors, noResult, ...(tokens !== undefined ? { outputTokens: tokens } : {}),
    ...(costs.length ? { cost: { usd: costs.reduce((sum, agent) => sum + agent.cost!.usd, 0), billed: costs.every((agent) => agent.cost!.billed), of: costs.length, agents: captured.length } } : {}),
    result, ...(claim ? { claim } : {}), ending, leavesOut,
  }
}
