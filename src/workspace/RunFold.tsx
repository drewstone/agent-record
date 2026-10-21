import { Spark } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { compact } from '../viewer/model.js'
import { type Play, plainWords } from './answers.js'
import { AsOfStamp } from './AnswerStrip.js'
import { dataStatus, StatusPill, statusOf } from './data.js'
import { BlockerChip } from './PlayHead.js'
import { shortRun, shortTag } from './play-standing.js'
import { clockWords, inheritedGate, isLive, runAsOf, runBest, runBlocker, runChip, runClock, runOutputSlot, runState, successorOf } from './run-answers.js'

const FIX_PREVIEW = 180
const clock = (at: string | null | undefined) => (at ? `${new Date(at).toISOString().slice(11, 16)} UTC` : null)
/** A Lab sentence with its ISO timestamps as `10-19 02:42Z`, the way the rest of the page writes times. */
const humane = (text: string) => text.replace(/\b\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)(?::\d\d(?:\.\d+)?)?Z\b/g, '$1-$2 $3Z')

/** Workloads passed against the bar: the fill is passed ÷ total, the end is the bar, a thin tick the play's previous best. */
function WorkloadMeter({ value, of, previous }: { value: number; of: number; previous: number | null }) {
  const at = (n: number) => `${Math.max(0, Math.min(100, (n / of) * 100)).toFixed(1)}%`
  return (
    <span className="run-meter" role="img" aria-label={`${value} of ${of} workloads${previous !== null ? `; previous best ${previous}` : ''}`}>
      <i style={{ width: at(value) }} />
      {previous !== null && <b className="run-meter-prev" style={{ left: at(previous) }} title={`previous best ${previous} of ${of}`} />}
      <b className="run-meter-bar" title={`the bar: all ${of}`} />
    </span>
  )
}

/**
 * The run page's first screen (v2): the h1 and the page's one status chip and as-of, then exactly four slots: what the
 * run is doing (or how it ended), its best release, what blocks it (with the one clock), and what it produced.
 */
export function RunFold({ doc, play, now = Date.now() }: { doc: RunDocument; play?: Play | null; now?: number }) {
  const run = doc.run
  const successor = successorOf(play, run.id)
  const chip = runChip(doc, successor ? true : undefined, now)
  const best = runBest(doc, play, now)
  const blocker = runBlocker(doc, successor, now)
  const output = runOutputSlot(doc, now)
  return (
    <header className="run-fold" data-run-fold>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={`/play/${encodeURIComponent(run.play)}`}>{run.play}</a>
      </nav>
      <div className="run-head">
        <h1>Run {shortRun(run.play, run.id)}</h1>
        <StatusPill status={chip} />
        <AsOfStamp asOf={runAsOf(doc)} />
      </div>
      <div className="run-slots">
        <div className="run-slot is-state" data-slot="state">
          <p className="run-state">{runState(doc, chip, now)}</p>
        </div>
        <div className="run-slot" data-slot="best">
          <span className="run-slot-label">Best release</span>
          <b>{best.headline}</b>
          {best.meter && <WorkloadMeter {...best.meter} />}
          <span className="run-slot-sub">{best.sub}</span>
        </div>
        <div className="run-slot" data-slot="blocker">
          <span className="run-slot-label">Blocker</span>
          {blocker.status ? <StatusPill status={blocker.status}>{blocker.headline}</StatusPill> : <b>{blocker.headline}</b>}
          <span className="run-slot-sub">{blocker.sub}</span>
        </div>
        <div className="run-slot" data-slot="output">
          <span className="run-slot-label">Output</span>
          <b>{output.headline}</b>
          {output.points && <span className="run-slot-spark"><Spark points={output.points} /></span>}
          <span className="run-slot-sub">{output.sub}</span>
        </div>
      </div>
    </header>
  )
}

/** On a run's tab pages, the status block is one sticky line: the run, its chip, and its one clock or its ending. */
export function RunStatusLine({ doc, play, now = Date.now() }: { doc: RunDocument; play?: Play | null; now?: number }) {
  const successor = successorOf(play, doc.run.id)
  const chip = runChip(doc, successor ? true : undefined, now)
  const at = runClock(doc)
  const ended = doc.run.ending?.at ?? doc.run.settledAt ?? null
  return (
    <p className="run-status-line" role="status" data-run-status>
      <a href={`/run/${encodeURIComponent(doc.run.id)}`}>Run {shortRun(doc.run.play, doc.run.id)}</a>
      <StatusPill status={chip} />
      <span className="faint">{isLive(doc) ? (at ? clockWords(at, now) : 'no output recorded') : ended ? `ended ${ended.slice(5, 10)} ${ended.slice(11, 16)}Z` : ''}</span>
    </p>
  )
}

/**
 * The detail behind the fold's blocker and ending, closed: why an ended run stopped (the Lab's reason, what blocked it
 * just before it ended, quota hits, the newest check that did not pass) or what holds a live one, the start point the
 * run inherited from its fork in neutral, how to resume it, and the driver's ending evidence.
 */
export function RunWhy({ doc, play }: { doc: RunDocument; play?: Play | null }) {
  const execution = doc.execution ?? null
  const live = isLive(doc)
  const raw = (doc.run.ending?.reason ?? doc.receipt?.outcome?.reason ?? (doc.run.state === 'stalled' ? doc.run.reason : null))?.replace(/^stalled:\s*/, '') ?? null
  const reason = raw ? plainWords(humane(raw)) : null
  const diagnosis = execution?.diagnoses[0]
  const fix = diagnosis ? compact(diagnosis.fix) : ''
  const fixLine = fix.length > FIX_PREVIEW ? `${fix.slice(0, FIX_PREVIEW - 1).trimEnd()}…` : fix
  const start = inheritedGate(doc, play)
  const gate = doc.progress?.outcome?.gate
  const blockedGate = gate?.line && gate.verdict && gate.verdict !== 'pass' ? gate : null
  const block = live ? (doc.progress?.blocker ?? null) : (doc.progress?.endBlocker ?? null)
  const classes = new Set([block?.class, ...(block?.also ?? []).map((item) => item.class)].filter(Boolean))
  // An unverified run that only repeats the inherited start point is that start point, not the run's own result.
  const own = doc.run.check?.gateUnknown?.tags?.filter((tag) => !start || tag !== shortTag(doc.run.check?.gate?.tag))
  const undecided = doc.run.check?.gateUnknown?.count && !classes.has('gate-undecided') && (!start || own?.length) ? doc.run.check.gateUnknown : null
  const quota = classes.has('quota-wall') ? null : (doc.receipt?.system?.attempts?.causes.find((cause) => cause.cause === 'rate-limited' && cause.tries > 0) ?? null)
  const resume = execution && (execution.resume.status === 'preserved' || execution.resume.reason || execution.resume.command)
  const ended = live ? null : (doc.run.ending?.at ?? execution?.lastActivityAt ?? null)
  const wallHours = doc.receipt?.work?.wallHours ?? null
  // What blocks a live run is attention; on an ended run the same lines are history, neutral.
  const blocking = statusOf({ axis: 'alert', severity: 'amber', live })
  const neutral = statusOf({ axis: 'alert', live: false })
  const evidence = !live && execution && (execution.endingError?.message || execution.runnerTail || execution.diagnosisError || execution.diagnoses.length > 0 || execution.lastAttempt)
  if (!reason && !start && !blockedGate && !block && !undecided && !quota && !resume && !evidence) return null
  return (
    <details className="run-why" data-run-why>
      <summary>{live ? 'What holds it' : 'Why it stopped'}</summary>
      {reason && <p data-field="run.ending.reason">{reason}</p>}
      {diagnosis && <p>{diagnosis.id}: {fixLine}</p>}
      {block && <div className="run-end-blocker" data-run-blocker={block.class}><BlockerChip blocker={block} until={ended} wallHours={wallHours} /></div>}
      <ul className="run-blockers" aria-label={live ? 'What holds the run' : 'Why the run stopped'}>
        {start && <li data-field="run.check.gate" data-inherited data-status={dataStatus(neutral)}>{neutral.shape} {start}</li>}
        {undecided && <li data-field="run.check.gateUnknown" data-status={dataStatus(blocking)}><strong>{blocking.shape} Release check unverified {undecided.count}×</strong> {clock(undecided.from)}{undecided.count > 1 && <>–{clock(undecided.to)}</>}{undecided.tags?.length ? <> on <code>{undecided.tags.join(', ')}</code></> : null}{undecided.line && <>: <span className="run-blocker-line">{plainWords(undecided.line)}</span></>}</li>}
        {blockedGate && <li data-field="progress.outcome.gate" data-status={dataStatus(blocking)}><strong>{blocking.shape} Release check: {blockedGate.verdict === 'fail' ? 'did not pass' : 'unverified'}</strong>{shortTag(blockedGate.tag) && <> on <code>{shortTag(blockedGate.tag)}</code></>}{clock(blockedGate.at) && <> at {clock(blockedGate.at)}</>}: <span className="run-blocker-line">{plainWords(blockedGate.line ?? "")}</span></li>}
        {quota && <li data-field="receipt.system.attempts.causes" data-status={dataStatus(blocking)}><strong>{blocking.shape} {quota.tries} quota hits</strong>: {quota.label ?? 'a 429 ended the turn'}{quota.hours ? ` (${quota.hours} h of turns)` : ''}</li>}
      </ul>
      {resume && <p>{execution!.resume.status === 'preserved' ? 'Source sandbox preserved. Resume with ' : execution!.resume.reason ? `${execution!.resume.reason} ` : ''}{execution!.resume.command && <code>{execution!.resume.command}</code>}</p>}
      {evidence && (
        <>
          {execution!.lastAttempt && <p>Last driver attempt: {execution!.lastAttempt.error ?? 'no error recorded'} ({execution!.lastAttempt.classification ?? 'classification unknown'})</p>}
          {execution!.diagnoses.length > 0 && <dl>{execution!.diagnoses.map((item) => <div key={item.id}><dt><strong>{item.id}</strong></dt><dd>{item.fix}</dd></div>)}</dl>}
          {execution!.endingError?.message && <pre>{execution!.endingError.message}</pre>}
          {execution!.diagnosisError && <p>Known failure lookup unavailable: {execution!.diagnosisError}</p>}
          {execution!.runnerTail && <><p>Runner log tail</p><pre>{execution!.runnerTail}</pre></>}
        </>
      )}
    </details>
  )
}
