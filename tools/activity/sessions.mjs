import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { basename, join } from 'node:path'
import { classifyActivity } from './classify.mjs'
import { sessionCache } from './cache.mjs'
import { partitionIntervals } from './intervals.mjs'
import { readClaudeSessions } from './claude.mjs'

// Reference fit from the handoff, not measured cognitive time. Each observed
// step duration is apportioned by these weights; it is never predicted duration.
export const modelSplitMethod = { kind: 'estimate', unit: 'seconds', basis: 'handoff lane_fit regression; normalized to observed step duration', rSquared: 0.51,
  weights: { overhead: 4.42, readingPerThousandUncachedInput: 0.067, writingPerThousandNonReasoningOutput: 6.68, reasoningPerThousandOutput: 23.67 } }
const iso = n => new Date(n).toISOString()
function splitModel(seconds, usage) {
  if (!usage) return null
  const input = Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0))
  const reasoning = Math.max(0, usage.reasoning_output_tokens ?? 0)
  const written = Math.max(0, (usage.output_tokens ?? 0) - reasoning)
  const fit = modelSplitMethod.weights
  const weights = [fit.overhead, fit.readingPerThousandUncachedInput * input / 1000,
    fit.writingPerThousandNonReasoningOutput * written / 1000, fit.reasoningPerThousandOutput * reasoning / 1000]
  const total = weights.reduce((a,b)=>a+b,0)
  const parts = weights.map(w=>seconds*w/total)
  parts[3] = seconds - parts[0] - parts[1] - parts[2]
  return Object.fromEntries(['overhead','reading','writing','reasoning'].map((key,i)=>[key,parts[i]]))
}
async function* files(root, since) {
  let entries
  try { entries = await readdir(root, {withFileTypes:true}) } catch { return }
  for (const entry of entries) {
    const path = join(root,entry.name)
    if (entry.isDirectory()) yield* files(path,since)
    else if (entry.name.endsWith('.jsonl')) {
      // Old sessions may remain active; mtime, not filename date, decides eligibility.
      try { if ((await stat(path)).mtimeMs >= since) yield path } catch {}
    }
  }
}
export async function discoverSessions(home, since, coverage) {
  const roots = [join(home,'.codex','sessions')]
  const accounts = join(home,'.config','agent-accounts','codex')
  try { for (const seat of await readdir(accounts)) roots.push(join(accounts,seat,'sessions')) } catch {}
  const unique = new Set(), found = []
  for (const path of roots) {
    let resolved
    try { resolved = await realpath(path) } catch { continue }
    if (unique.has(resolved)) { coverage.duplicateRoots++; continue }
    unique.add(resolved); coverage.roots++
    const seat = path.includes('agent-accounts') ? basename(join(path,'..')) : 'default-home'
    for await (const file of files(resolved,since)) found.push({path:file,seat})
  }
  return found
}
function continuation(text, running) {
  const candidates = [...text.matchAll(/(?:session_id|cell_id)\s*["']?\s*:\s*["']?([\w-]+)/g)].map(m=>m[1])
  for (const id of candidates) if (running.has(id)) return running.get(id)
  return null
}
function remember(output, classification, running) {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  for (const m of text.matchAll(/(?:session_id["']?\s*:\s*|session ID\s+|cell ID\s+|cell_id["']?\s*:\s*)["']?([\w-]+)/g)) running.set(m[1],classification)
}
export async function readActivitySession(file, {since, now, coverage}) {
  const segments = [], calls = new Map(), running = new Map(), context = {variables:{}}
  const pendingModels = []
  let meta, active = false, mark, turn, last = since, offset = 0
  const add = (at,end,phase,classification,id) => {
    if (!(end>at) && !classification.incomplete) return null
    const segment = {id:id ?? `${meta?.id ?? basename(file.path)}:${offset++}`,at:iso(at),end:iso(end),phase,...classification,category:classification.activity}
    segments.push(segment); return segment
  }
  const model = (end,classification) => {
    if (active && mark !== undefined && !calls.size) {
      const item = add(mark,end,'model',classification)
      if (item) pendingModels.push({item,turn})
    }
    mark = end
  }
  const stream = createReadStream(file.path)
  const lines = createInterface({input:stream,crlfDelay:Infinity})
  try {
    for await (const line of lines) {
      let d
      try { d=JSON.parse(line) } catch { coverage.malformedLines++; continue }
      if (!d || typeof d !== 'object' || Array.isArray(d) || (d.payload != null && (typeof d.payload !== 'object' || Array.isArray(d.payload)))) { coverage.malformedLines++; continue }
      const p=d.payload ?? {}, at=Date.parse(d.timestamp), type=p.type
      if (d.type==='session_meta') { if (!meta) meta=p; continue }
      if (!Number.isFinite(at) || at>now) continue
      last=Math.max(last,at)
      if (d.type==='token_usage_record') {
        // The record closes the model response that produced the preceding call
        // or message. Match only within its recorded turn; never steal older usage.
        const candidate = [...pendingModels].reverse().find(x=>!x.item.usage && (!p.turn_id || !x.turn || p.turn_id===x.turn))
        if (candidate && p.usage) { candidate.item.usage=p.usage; candidate.item.modelSplitEstimated=true }
        continue
      }
      if (d.type==='event_msg' && type==='task_started') {
        if (!active && mark!==undefined) add(mark,at,'idle',{activity:'waiting',activities:['waiting'],label:'between turns'})
        active=true; mark=at; turn=p.turn_id; continue
      }
      if (d.type==='event_msg' && type==='task_complete') {
        model(at,{activity:'messaging',activities:['messaging'],label:'reply / end of turn'})
        active=false; mark=at; continue
      }
      if (d.type!=='response_item') continue
      if (['custom_tool_call','function_call'].includes(type)) {
        if (typeof p.name !== 'string' || typeof p.call_id !== 'string') { coverage.malformedLines++; continue }
        const input=p.input ?? p.arguments ?? '', name=p.namespace ? `${p.namespace}.${p.name}` : p.name ?? ''
        const base = classifyActivity(name,input,context)
        const short = name.split(/[.:]/).at(-1)
        const isContinuation = base.activity === 'waiting' && (['wait','write_stdin'].includes(short) ||
          (short === 'exec' && /tools\.(?:write_stdin|wait)\s*\(/.test(String(input))))
        const inherited = isContinuation ? continuation(typeof input==='string'?input:JSON.stringify(input),running) : null
        const classification=inherited ? {...inherited,label:'continuation: '+inherited.label} : base
        model(at,classification)
        calls.set(p.call_id,{at,classification,id:p.call_id})
      } else if (['custom_tool_call_output','function_call_output'].includes(type)) {
        const call=calls.get(p.call_id)
        if (call) {
          add(call.at,at,'tool',call.classification,call.id)
          remember(p.output,call.classification,running)
          calls.delete(p.call_id)
          if (!calls.size) mark=at
        } else coverage.unmatchedOutputs++
      } else if (['message','agent_message'].includes(type) && p.role!=='user' && p.role!=='developer' && p.role!=='system') {
        model(at,{activity:'messaging',activities:['messaging'],label:'reply'})
      }
    }
  } catch { coverage.unreadableFiles++; return null }
  // Snapshot unfinished calls only through capture time; do not fabricate ongoing
  // model time after the last observed event (an old open turn may be abandoned).
  for (const call of calls.values()) add(call.at,call.at,'tool',{...call.classification,incomplete:true,durationUnknown:true},call.id)
  if (typeof meta?.id !== 'string' || typeof meta?.cwd !== 'string') { coverage.missingSessionIdentity++; return null }
  const retained=segments.filter(s=>Date.parse(s.end)>since).map(s=> {
    if (Date.parse(s.at)<since) s.at=iso(since)
    if (s.phase==='model') {
      s.modelSplit=splitModel((Date.parse(s.end)-Date.parse(s.at))/1000,s.usage)
      if (!s.usage) s.modelSplitUnavailable='missing step token usage'
    }
    return s
  }).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))
  if (!retained.length) return null
  return {id:meta.id,nativeSessionId:meta.id,harness:'codex',lane:basename(meta.cwd ?? '') || 'unknown',cwd:meta.cwd ?? '',seat:file.seat,start:retained[0].at,end:retained.reduce((a,s)=>a>s.end?a:s.end,retained[0].end),segments:retained}
}
export async function ingestActivity(home, {since, now=Date.now(), audit}={}) {
  const started=performance.now()
  const sinceMs=Date.parse(since)
  if (!Number.isFinite(sinceMs) || sinceMs>now) throw Object.assign(new Error('--since must be an ISO timestamp no later than capture time'),{exitCode:64})
  const coverage={roots:0,duplicateRoots:0,files:0,duplicateSessions:0,malformedLines:0,unreadableFiles:0,unmatchedOutputs:0,missingSessionIdentity:0}
  const cached = await sessionCache(home)
  const sessionsById=new Map()
  for (const file of await discoverSessions(home,sinceMs,coverage)) {
    coverage.files++
    const session=await cached(file.path, 'codex', options => readActivitySession(file, options), {since:sinceMs,now,coverage})
    if (!session) continue
    const prior=sessionsById.get(session.id)
    if (prior) {
      coverage.duplicateSessions++
      // Resumed/copy files can overlap. Preserve distinct call IDs and keep the
      // richer copy of a repeated interval, rather than silently losing a tail.
      const byId=new Map(prior.segments.map(s=>[s.id,s]))
      for (const s of session.segments) if (!byId.has(s.id) || s.end>byId.get(s.id).end) byId.set(s.id,s)
      prior.segments=[...byId.values()].sort((a,b)=>a.at.localeCompare(b.at)); prior.end=prior.end>session.end?prior.end:session.end
    } else sessionsById.set(session.id,session)
  }
  for (const session of await readClaudeSessions(home, { since: sinceMs, now, coverage, cached })) sessionsById.set(session.id, session)
  const sessions=[...sessionsById.values()].map(session => {
    const events = session.segments.filter(event => Date.parse(event.end) >= sinceMs)
    const segments = partitionIntervals(events, sinceMs, now)
    return {...session, events, segments, start:segments[0]?.at ?? session.start,
      end:segments.reduce((end,s)=>s.end>end?s.end:end,segments[0]?.end ?? session.end)}
  }).filter(session => session.segments.length).sort((a,b)=>a.lane.localeCompare(b.lane)||a.id.localeCompare(b.id))
  coverage.modelSteps=sessions.reduce((n,s)=>n+s.segments.filter(x=>x.phase==='model').length,0)
  coverage.modelStepsWithUsage=sessions.reduce((n,s)=>n+s.segments.filter(x=>x.phase==='model'&&x.usage).length,0)
  coverage.occupiedSeconds = sessions.reduce((sum, s) => sum + s.segments.reduce((n,e) => n + (Date.parse(e.end)-Date.parse(e.at))/1000,0),0)
  coverage.concurrentIntervals = sessions.reduce((sum,s) => sum + s.segments.filter(e => e.concurrentCalls > 1).length,0)
  coverage.openCalls = sessions.reduce((sum,s) => sum + s.segments.filter(e => e.incomplete).length,0)
  coverage.overlappingSegments = sessions.reduce((sum,s) => sum + s.segments.filter((e,i,a) => i && !e.incomplete && !a[i-1].incomplete && e.at < a[i-1].end).length,0)
  coverage.modelSplitMismatches = sessions.reduce((sum,s) => sum + s.segments.filter(e => e.modelSplit && Math.abs(Object.values(e.modelSplit).reduce((a,b)=>a+b,0) - (Date.parse(e.end)-Date.parse(e.at))/1000)>0.001).length,0)
  coverage.importDurationMs=Math.round(performance.now()-started)
  return {schema:'agent-record.activity.v1',generatedAt:iso(now),since:iso(sinceMs),sessions,coverage,modelSplitMethod,...(audit?{audit:replayAudit(audit)}:{})}
}
export function replayAudit(audit) {
  const calls=Array.isArray(audit)?audit:audit.calls
  if (!Array.isArray(calls)) throw new Error('--audit requires a JSON array or {calls: [...]}')
  const predictions=calls.map(call=>{
    const predicted=classifyActivity(call.name ?? call.tool ?? 'exec',call.input ?? call.arguments ?? '')
    const expected=call.expected ?? call.activity
    return {id:call.id,predicted,expected,...(expected?{correct:predicted.activity===expected,accepted:predicted.activity===expected||(call.expectedAlternatives??[]).includes(predicted.activity)}:{})}
  })
  const labeled=predictions.filter(x=>x.expected), correct=labeled.filter(x=>x.correct).length
  return {count:predictions.length,labeled:labeled.length,correct,accuracy:labeled.length?correct/labeled.length:null,accepted:labeled.filter(x=>x.accepted).length,predictions}
}

/** Adapt the already classified intervals for the existing Timeline; no reclassification. */
export function activityToRecord(activity) {
  return {schema:'agent-record.v1',runId:'native-activity:'+activity.since,title:'Native session activity',
    nodes:activity.sessions.map(s=>({id:s.id,label:s.lane,kind:'session',parent:null,nativeSessionId:s.id,start:s.start,end:s.end})),
    events:activity.sessions.flatMap(s=>s.segments.map(segment=>({
      id:s.id+':'+segment.id,node:s.id,at:segment.at,end:segment.end,kind:'activity',category:segment.activity,
      activity:segment.activity,phase:segment.phase,label:segment.label,source:null,
      detail:{activities:segment.activities,editMethod:segment.editMethod,editTarget:segment.editTarget,
        modelSplit:segment.modelSplit,modelSplitEstimated:segment.modelSplitEstimated,modelSplitUnavailable:segment.modelSplitUnavailable,stepUsage:segment.usage},
    }))),terminal:null,sources:[],artifacts:[],coverage:{completeOriginalCapture:false,
      publicContent:'Metadata only; review native lane identifiers before publication',categoryMethod:'Static importer classification',cost:'Unknown',gaps:[]},
  }
}
