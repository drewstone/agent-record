import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { basename, join } from 'node:path'
import { classifyActivity } from './classify.mjs'

const iso = n => new Date(n).toISOString()

async function* candidates(root, since) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* candidates(path, since)
    else if (entry.name.endsWith('.jsonl')) {
      try { if ((await stat(path)).mtimeMs >= since) yield path } catch {}
    }
  }
}

/** Claude native timestamps bound tool intervals; no Codex usage is inferred. */
export async function readClaudeActivity(file, { since, now, coverage }) {
  const calls = new Map(), segments = [], seen = new Set()
  let identity, cwd = '', agentId, mark, active = false, serial = 0
  const add = (start, end, phase, classification, id) => {
    if (end <= since || end <= start) return
    const at = Math.max(since, start)
    segments.push({ id: id ?? `claude:${serial++}`, at: iso(at), end: iso(end), phase,
      ...classification, category: classification.activity,
      ...(phase === 'model' ? { modelSplit: null, modelSplitUnavailable: 'Claude capture has no per-step reasoning token record', atBasis: 'native-message-boundary' } : {}) })
  }
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      let d
      try { d = JSON.parse(line) } catch { coverage.malformedLines++; continue }
      if (!d || typeof d !== 'object' || Array.isArray(d)) { coverage.malformedLines++; continue }
      const at = Date.parse(d.timestamp)
      if (!Number.isFinite(at) || at > now) continue
      if (typeof d.sessionId === 'string') identity ??= d.sessionId
      if (!cwd && typeof d.cwd === 'string') cwd = d.cwd
      if (typeof d.agentId === 'string') agentId ??= d.agentId
      if (!['user', 'assistant'].includes(d.type) || !d.message || seen.has(d.uuid)) continue
      if (d.uuid) seen.add(d.uuid)
      const parts = Array.isArray(d.message.content) ? d.message.content.filter(part => part && typeof part === 'object') : []
      if (d.type === 'user') {
        const results = parts.filter(p => p.type === 'tool_result')
        for (const result of results) {
          const call = calls.get(result.tool_use_id)
          if (call) {
            add(call.at, at, 'tool', call.classification, call.id)
            calls.delete(call.id)
          } else coverage.unmatchedOutputs++
        }
        if (results.length) { if (!calls.size) { active = true; mark = at } }
        else {
          if (!active && mark !== undefined) add(mark, at, 'idle', { activity: 'waiting', activities: ['waiting'], label: 'between turns' })
          active = true; mark = at
        }
      } else {
        const tools = parts.filter(p => p.type === 'tool_use' && typeof p.name === 'string' && typeof p.id === 'string')
        if (tools.length) {
          const first = classifyActivity(tools[0].name, tools[0].input)
          if (active && mark !== undefined && !calls.size) add(mark, at, 'model', first)
          for (const tool of tools) calls.set(tool.id, { at, id: tool.id, classification: classifyActivity(tool.name, tool.input) })
          mark = at
        } else if (parts.some(p => p.type === 'text') && d.message.stop_reason !== 'tool_use') {
          if (active && mark !== undefined && !calls.size) add(mark, at, 'model', { activity: 'messaging', activities: ['messaging'], label: 'reply' })
          active = false; mark = at
        }
      }
    }
  } catch { coverage.unreadableFiles++; return null }
  // Open calls have no measured result boundary and remain explicit unknowns.
  coverage.claudeOpenCalls = (coverage.claudeOpenCalls ?? 0) + calls.size
  for (const call of calls.values()) if (call.at >= since) segments.push({id:call.id,at:iso(call.at),end:iso(call.at),phase:'tool',
    ...call.classification,category:call.classification.activity,incomplete:true,durationUnknown:true})
  if (!identity || !segments.length) return null
  segments.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  return { id: `claude:${identity}${agentId ? ':' + agentId : ''}`, nativeSessionId: identity,
    harness: 'claude', lane: basename(cwd) || 'unknown', cwd, seat: 'claude',
    start: segments[0].at, end: segments.reduce((end, s) => s.end > end ? s.end : end, segments[0].end), segments }
}

export async function readClaudeSessions(home, { since, now, coverage, cached }) {
  const roots = [join(home, '.claude', 'projects')]
  const accounts = join(home, '.config', 'agent-accounts', 'claude')
  try { for (const seat of await readdir(accounts)) roots.push(join(accounts, seat, 'projects')) } catch {}
  const unique = new Set(), sessions = new Map()
  for (const root of roots) {
    let path
    try { path = await realpath(root) } catch { continue }
    if (unique.has(path)) continue
    unique.add(path)
    for await (const file of candidates(path, since)) {
      coverage.claudeFiles = (coverage.claudeFiles ?? 0) + 1
      const session = cached ? await cached(file, 'claude', options => readClaudeActivity(file, options), {since,now,coverage})
        : await readClaudeActivity(file, { since, now, coverage })
      if (!session) continue
      const prior = sessions.get(session.id)
      if (!prior || session.end > prior.end) sessions.set(session.id, session)
    }
  }
  return [...sessions.values()]
}
