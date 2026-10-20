import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordEvent, RunRecord } from '../record.js'
import type { RunDocument } from '../workspace.js'
import { Conversation } from '../viewer/Conversation.js'
import { compact, indexRecord } from '../viewer/model.js'
import { projectPartEvents } from '../adapters/part-events.js'
import { EventDetail } from './EventDetail.js'
import { dataStatus, runStatus, StatusPill, statusOf } from './data.js'
import { BlockerChip } from './PlayHead.js'

type StreamRow = { seq: number; at?: string; stream?: string; attempt?: number; event?: { kind: string; text?: string; toolCallId?: string; toolName?: string; args?: unknown; result?: unknown }; type?: string; data?: unknown }
type StreamNode = { id: string; label: string; parent: string | null }
type StreamPage = { runId: string; node: string; generation?: string; reset?: boolean; events: StreamRow[]; firstSeq: number | null; lastSeq: number | null; hasEarlier: boolean; hasMore: boolean; alive: boolean; nodes: StreamNode[] }
const LIMIT = 200
const RETAIN = 2000
const FIX_PREVIEW = 180

/** Project the runtime's normalized stream into the existing Conversation and its tool-pairing model. */
function streamRecord(runId: string, node: string, nodes: StreamNode[], rows: StreamRow[]): RunRecord {
  const events: RecordEvent[] = []
  const native = new Map<string, StreamRow[]>()
  for (const row of rows) {
    if (!row.at || !Number.isFinite(Date.parse(row.at))) continue
    if (!row.event) {
      const stream = row.stream ?? node
      const group = native.get(stream) ?? []
      group.push(row)
      native.set(stream, group)
      continue
    }
    const value = row.event
    const id = `${node}:${row.attempt ?? 1}:${row.seq}`
    const callId = `${row.stream ?? node}:${row.attempt ?? 1}:${value.toolCallId ?? row.seq}`
    const base = { id, node, at: row.at, kind: 'message', category: 'other', label: 'assistant' }
    if (value.kind === 'text_delta' || value.kind === 'reasoning_delta') {
      const field = value.kind === 'text_delta' ? 'publicText' : 'reasoning'
      const previous = events.at(-1)
      // The first sequence stays the identity as more deltas arrive, preserving expanded rows and reading position.
      if (previous?.detail.streamKind === value.kind && previous.detail.attempt === (row.attempt ?? 1)) {
        previous.detail[field] = `${previous.detail[field] ?? ''}${value.text ?? ''}`
      } else events.push({ ...base, detail: { role: 'assistant', [field]: value.text ?? '', streamKind: value.kind, attempt: row.attempt ?? 1 } })
    } else if (value.kind === 'tool_call') {
      events.push({ ...base, label: value.toolName ?? 'Tool call', detail: { role: 'assistant', publicToolCalls: [{ id: callId, name: value.toolName ?? 'Tool call', ...(value.args == null ? {} : { input: typeof value.args === 'string' ? value.args : JSON.stringify(value.args) }) }] } })
    } else if (value.kind === 'tool_result') {
      const result = value.result
      events.push({ ...base, kind: 'tool-result', detail: { role: 'toolResult', toolCallId: callId, publicText: typeof result === 'string' ? result : JSON.stringify(result ?? null), isError: !!result && typeof result === 'object' && ('error' in result || ('isError' in result && result.isError === true)) } })
    } else events.push({ ...base, kind: value.kind, category: 'lifecycle', label: value.kind.replaceAll('_', ' '), detail: { lifecycle: value.kind, ...(value.text ? { publicText: value.text } : {}) } })
  }
  for (const [stream, group] of native) {
    projectPartEvents({
      events,
      clip: (text: string) => ({ text }),
      compactValue: (value: unknown) => value,
      sourcePath: (path: string) => path,
      emit: (event: RecordEvent) => {
        const nativeId = event.detail.nativeRecordId ?? event.source?.line
        const detail = { ...event.detail }
        if (detail.publicToolCalls) detail.publicToolCalls = detail.publicToolCalls.map((call) => ({ ...call, id: `${stream}:${call.id}` }))
        if (detail.toolCallId) detail.toolCallId = `${stream}:${detail.toolCallId}`
        events.push({ ...event, detail, id: `${stream}:${nativeId}:${event.kind}:${event.source?.item ?? 0}` })
      },
    }, { id: node, start: group[0]!.at }, stream, { sha256: '' }, group, { where: (i) => ({ line: group[i]!.seq + 1 }), full: () => null }, () => 'other')
  }
  return { schema: 'agent-record.v1', runId, title: runId, nodes: nodes.map((item) => ({ ...item, kind: 'agent' })), events, sources: [], assignment: { objective: '', suppliedKnowledge: '', deliverables: '', constraints: '', source: null }, terminal: null, coverage: { completeOriginalCapture: false, publicContent: 'Live stream window', categoryMethod: 'Runtime event kind', cost: 'Unknown' } }
}

const clock = (at: string | null | undefined) => at ? `${new Date(at).toISOString().slice(11, 16)} UTC` : null
/** A Lab sentence with its ISO timestamps as `10-19 02:42Z`, the way the rest of the page writes times. */
const humane = (text: string) => text.replace(/\b\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)(?::\d\d(?:\.\d+)?)?Z\b/g, '$1-$2 $3Z')
const shortTag = (tag: string | null | undefined) => tag?.split('/').pop() ?? null

/**
 * The run's status first, with what blocks it as the headline (M4): how it ended in one name and why (the receipt's
 * outcome reason), the newest tag gate that did not pass, and the turns a quota (HTTP 429) ended. The driver's own last
 * error and the runner log stay under Ending evidence.
 */
export function RunExecution({ doc, onConversations }: { doc: RunDocument; onConversations: () => void }) {
  const execution = doc.execution
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!execution?.alive) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [execution?.alive])
  if (!execution) return null
  const diagnosis = execution.diagnoses[0]
  const fix = diagnosis ? compact(diagnosis.fix) : ''
  const fixLine = fix.length > FIX_PREVIEW ? `${fix.slice(0, FIX_PREVIEW - 1).trimEnd()}…` : fix
  const age = execution.lastActivityAt ? Math.max(0, Math.floor((now - Date.parse(execution.lastActivityAt)) / 1000)) : null
  const ending = execution.alive ? statusOf({ axis: 'run', state: 'running' }) : doc.run.ending || doc.run.state === 'stalled' ? runStatus(doc.run) : statusOf({ axis: 'run', state: execution.settleKind ?? 'unknown' })
  const raw = (doc.receipt?.outcome?.reason ?? doc.run.ending?.reason ?? (doc.run.state === 'stalled' ? doc.run.reason : null))?.replace(/^stalled:\s*/, '') ?? null
  const reason = raw ? humane(raw) : null
  const gate = doc.progress?.outcome?.gate
  const blockedGate = gate?.line && gate.verdict && gate.verdict !== 'pass' ? gate : null
  // The gate's newest verdicts that could not decide (the host's check summary): the prover ran past its limit N times.
  // The Lab's blocker leads; a list line that repeats one of its classes is left out.
  const live = execution.alive ? (doc.progress?.blocker ?? null) : (doc.progress?.endBlocker ?? null)
  const classes = new Set([live?.class, ...(live?.also ?? []).map((item) => item.class)].filter(Boolean))
  const undecided = doc.run.check?.gateUnknown?.count && !classes.has('gate-undecided') ? doc.run.check.gateUnknown : null
  const quota = classes.has('quota-wall') ? null : (doc.receipt?.system?.attempts?.causes.find((cause) => cause.cause === 'rate-limited' && cause.tries > 0) ?? null)
  const resume = execution.resume.status === 'preserved' || execution.resume.reason || execution.resume.command
  // What blocked the run, as the play page shows it (discovery-lab blockerOf): the live blocker, or for an ended run what
  // blocked it just before it ended. 19b's page said only "driver-failed" while the Lab had its stuck turn and refused push.
  const block = live
  const ended = execution.alive ? null : (doc.run.ending?.at ?? execution.lastActivityAt ?? null)
  const wallHours = doc.receipt?.work?.wallHours ?? null
  // What blocks a live run is attention; on an ended run the same lines are history, neutral.
  const blocking = statusOf({ axis: 'alert', severity: 'amber', live: execution.alive })
  return <section className="run-execution" aria-label="Run status">
    <p role="status" data-run-status>
      <StatusPill status={ending} />
      {execution.alive ? <> · last activity {age !== null && Number.isFinite(age) ? `${age} s ago` : 'unknown'} · attempts failed {execution.failedAttempts}</> : <>
        {reason ? <span data-field="receipt.outcome.reason"> · {reason}</span> : <>
          {execution.endingError && <> · {execution.endingError.name}</>}
          {execution.lastAttempt && <> · last driver attempt: {execution.lastAttempt.error ?? 'no error recorded'} ({execution.lastAttempt.classification ?? 'classification unknown'})</>}
        </>}
        {diagnosis && <span> · {diagnosis.id}: {fixLine}</span>}
      </>}
    </p>
    {block && <div className="run-end-blocker" data-run-blocker={block.class}><BlockerChip blocker={block} until={ended} wallHours={wallHours} /></div>}
    {(blockedGate || undecided || quota) && <ul className="run-blockers" aria-label="What blocks the run">
      {undecided && <li data-field="run.check.gateUnknown" className={`tone-${blocking.tone}`} data-status={dataStatus(blocking)}><strong>Tag gate undecided {undecided.count}×</strong> {clock(undecided.from)}{undecided.count > 1 && <>–{clock(undecided.to)}</>}{undecided.tags?.length ? <> on <code>{undecided.tags.join(', ')}</code></> : null}{undecided.line && <>: <span className="run-blocker-line">{undecided.line}</span></>}</li>}
      {blockedGate && <li data-field="progress.outcome.gate" className={`tone-${blocking.tone}`} data-status={dataStatus(blocking)}><strong>Tag gate {blockedGate.verdict}</strong>{shortTag(blockedGate.tag) && <> on <code>{shortTag(blockedGate.tag)}</code></>}{clock(blockedGate.at) && <> at {clock(blockedGate.at)}</>}: <span className="run-blocker-line">{blockedGate.line}</span></li>}
      {quota && <li data-field="receipt.system.attempts.causes" className={`tone-${blocking.tone}`} data-status={dataStatus(blocking)}><strong>{quota.tries} quota hits</strong>: {quota.label ?? 'a 429 ended the turn'}{quota.hours ? ` (${quota.hours} h of turns)` : ''}</li>}
    </ul>}
    <div className="run-execution-next">
      {resume ? <span>{execution.resume.status === 'preserved' ? 'Source sandbox preserved. Resume with ' : execution.resume.reason ? `${execution.resume.reason} ` : ''}{execution.resume.command && <code>{execution.resume.command}</code>}</span> : <span />}
      <button type="button" className="ui-button" onClick={onConversations}>Conversations</button>
    </div>
    {!execution.alive && (execution.endingError?.message || execution.runnerTail || execution.diagnosisError || execution.diagnoses.length > 0 || (reason && execution.lastAttempt)) && <details><summary>Ending evidence</summary>
      {reason && execution.lastAttempt && <p>Last driver attempt: {execution.lastAttempt.error ?? 'no error recorded'} ({execution.lastAttempt.classification ?? 'classification unknown'})</p>}
      {execution.diagnoses.length > 0 && <dl>{execution.diagnoses.map((item) => <div key={item.id}><dt><strong>{item.id}</strong></dt><dd>{item.fix}</dd></div>)}</dl>}
      {execution.endingError?.message && <pre>{execution.endingError.message}</pre>}
      {execution.diagnosisError && <p>Known failure lookup unavailable: {execution.diagnosisError}</p>}
      {execution.runnerTail && <><p>Runner log tail</p><pre>{execution.runnerTail}</pre></>}
    </details>}
  </section>
}

/** A bounded stream window. Only the selected agent is fetched; settled runs load once, without a timer. */
export function LiveTranscript({ runUrl, runId, alive, selected, onSelect, onRecorded, onEmpty }: { runUrl: string; runId: string; alive: boolean; selected: string | null; onSelect: (node: string) => void; onRecorded?: () => void; onEmpty?: () => void }) {
  const node = selected ?? runId
  const [state, setState] = useState<{ rows: StreamRow[]; nodes: StreamNode[]; earlier: boolean; loading: boolean; error: string | null; trimmed: boolean; history: boolean; emptyTail: boolean }>({ rows: [], nodes: [], earlier: false, loading: true, error: null, trimmed: false, history: false, emptyTail: false })
  const [reload, setReload] = useState(0)
  const [detail, setDetail] = useState<RecordEvent | null>(null)
  const older = useRef<(() => void) | null>(null)
  const wasAlive = useRef(alive)
  const windowState = useRef({ node, rows: [] as StreamRow[], earlier: false, generation: undefined as string | undefined, first: null as number | null, last: null as number | null })
  useEffect(() => {
    let cancelled = false
    let timer = 0
    const controller = new AbortController()
    const sameNode = windowState.current.node === node
    // When the run settles, retain the displayed window and fetch the final suffix once.
    const retain = sameNode && wasAlive.current && !alive
    wasAlive.current = alive
    let rows: StreamRow[] = retain ? windowState.current.rows : []
    let earlier = retain ? windowState.current.earlier : false
    let generation = retain ? windowState.current.generation : undefined
    let first = retain ? windowState.current.first : null
    let last = retain ? windowState.current.last : null
    let readingHistory = false
    let forwardPending = false
    let olderPending = false
    setState((prior) => ({ ...prior, rows, earlier, loading: true, error: null, trimmed: retain && prior.trimmed, history: false, emptyTail: false }))
    setDetail(null)
    const load = async (direction: 'tail' | 'after' | 'before') => {
      if (cancelled || (direction === 'before' ? olderPending : forwardPending)) return
      if (direction === 'before') olderPending = true
      else forwardPending = true
      const cursor = direction === 'after' ? last : direction === 'before' ? first : null
      try {
        const query = new URLSearchParams({ node, limit: String(LIMIT) })
        if (cursor !== null) query.set(direction, String(cursor))
        if (generation && cursor !== null) query.set('generation', generation)
        const response = await fetch(`${runUrl}/transcript?${query}`, { signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error(`Transcript unavailable (HTTP ${response.status})`)
        const page = await response.json() as StreamPage
        if (cancelled) return
        const merged = direction === 'tail' || page.reset ? page.events : direction === 'before' ? [...page.events, ...rows] : [...rows, ...page.events]
        generation = page.generation
        if (direction === 'tail' || page.reset) { first = page.firstSeq; last = page.lastSeq }
        else if (direction === 'before') first = page.firstSeq ?? first
        else last = page.lastSeq ?? last
        const seen = new Map(merged.map((row) => [row.seq, row]))
        rows = [...seen.values()].sort((a, b) => a.seq - b.seq)
        const trimmed = rows.length > RETAIN
        if (trimmed) rows = readingHistory ? rows.slice(0, RETAIN) : rows.slice(-RETAIN)
        if (trimmed && !readingHistory) first = rows[0]?.seq ?? first
        if (direction !== 'after' || page.reset) earlier = page.hasEarlier
        if (trimmed && direction !== 'before') earlier = true
        windowState.current = { node, rows, earlier, generation, first, last }
        setState((prior) => ({ rows, nodes: page.nodes, earlier, loading: false, error: null, trimmed: trimmed || prior.trimmed, history: readingHistory, emptyTail: !page.alive && rows.length === 0 && first === null && last === null }))
        // Drain bounded pages before waiting. No periodic requests remain once the endpoint reports settlement.
        if (direction !== 'before' && page.hasMore && last !== cursor) timer = window.setTimeout(() => void load('after'), 0)
        else if (direction !== 'before' && page.alive && alive) timer = window.setTimeout(() => void load('after'), 3_000)
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setState((prior) => ({ ...prior, loading: false, error: error instanceof Error ? error.message : 'Transcript unavailable' }))
          if (alive && direction !== 'before') timer = window.setTimeout(() => void load('after'), 3_000)
        }
      } finally {
        if (direction === 'before') olderPending = false
        else forwardPending = false
      }
    }
    older.current = () => { readingHistory = true; setState((prior) => ({ ...prior, history: true })); void load('before') }
    void load(retain && last !== null ? 'after' : 'tail')
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); older.current = null }
  }, [runUrl, node, alive, reload])
  useEffect(() => { if (state.emptyTail && onEmpty) onEmpty() }, [state.emptyTail, onEmpty])
  const nodes = state.nodes.some((item) => item.id === node) ? state.nodes : [...state.nodes, { id: node, label: node === runId ? 'Root' : node, parent: null }]
  const index = useMemo(() => indexRecord(streamRecord(runId, node, nodes, state.rows)), [runId, node, state.nodes, state.rows])
  return <section className="run-panel live-transcript" aria-label="Conversations">
    <div className="message-filters">
      <label>Agent <select aria-label="Agent conversation" value={node} onChange={(event) => onSelect(event.target.value)}>{nodes.map((item) => <option key={item.id} value={item.id}>{item.label}{item.parent ? ' (child)' : ' (root)'}</option>)}</select></label>
      <button type="button" className="ui-button" disabled={!state.earlier || state.loading} onClick={() => older.current?.()}>Load older</button>
      <button type="button" className="ui-button" onClick={() => setReload((value) => value + 1)}>Latest</button>
      {onRecorded && <button type="button" className="ui-button" onClick={onRecorded}>Timeline and usage</button>}
      <span className="muted">{state.history && alive ? 'Reading history, new output continues' : alive ? 'Live transcript' : 'Settled transcript'} · {state.rows.length} stream events{state.trimmed ? ' · window limited to 2,000 events' : ''}</span>
    </div>
    {state.loading && <p role="status">Loading transcript…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.rows.filter((row) => row.event?.kind === 'capture_gap' && (!row.at || !Number.isFinite(Date.parse(row.at)))).map((row) => <p className="faint" key={row.seq}>{row.event?.text ?? 'A stream record could not be displayed.'}</p>)}
    {!state.loading && !state.rows.length && !state.error && <p>No stream events have been retained for this agent.</p>}
    {(!state.loading || state.rows.length > 0) && <Conversation index={index} actor={node} cutoff={Infinity} query="" category="all" inspect={setDetail} lifecycle live={alive} />}
    {detail && <EventDetail key={detail.id} event={detail} index={index} onClose={() => setDetail(null)} load={async () => { throw new Error('Original bytes are available in the captured record.') }} />}
  </section>
}
