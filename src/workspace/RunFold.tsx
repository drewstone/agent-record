import { Spark } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { compact } from '../viewer/model.js'
import { type Play, plainWords, stamp } from './answers.js'
import { AsOfStamp } from './AnswerStrip.js'
import { dataStatus, StatusPill, statusOf } from './data.js'
import { BlockerChip } from './PlayHead.js'
import { shortRun, shortTag } from './play-standing.js'
import { inheritedGate, isLive, runOutputSlot } from './run-answers.js'
import { viewAsOf, viewChip, type ViewProgress } from './view.js'

const FIX_PREVIEW = 180
const clock = (at: string | null | undefined) => (at ? `${new Date(at).toISOString().slice(11, 16)} UTC` : null)
/** A Lab sentence with its ISO timestamps as `10-19 02:42Z`, the way the rest of the page writes times. */
const humane = (text: string) => text.replace(/\b\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)(?::\d\d(?:\.\d+)?)?Z\b/g, '$1-$2 $3Z')

/** The check's steps as one segment each: filled for a pass, red for a fail, striped for undecided, hollow for not run. */
const STEP_WORDS = { pass: 'passes', fail: 'fails', undecided: 'never decided', unrun: 'not run' } as const

function StepBar({ progress }: { progress: ViewProgress }) {
  return (
    <ol className="run-steps" aria-label={progress.sentence}>
      {progress.steps.map((step, index) => (
        <li key={index} data-step={step.state} title={`${step.label}: ${STEP_WORDS[step.state]}${step.line ? ` (${step.line})` : ''}`}>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The run page's first screen: the h1, the host's status chip and the page's one as-of, the host's status sentence,
 * then three slots: the best release step by step, what blocks the run, and what it produced. Every word but the output
 * comes from the host's view (views.run_view), so this page and the play page say the same thing about this run.
 */
export function RunFold({ doc, now = Date.now() }: { doc: RunDocument; play?: Play | null; now?: number }) {
  const run = doc.run
  const view = doc.view
  const output = runOutputSlot(doc, now)
  return (
    <header className="run-fold" data-run-fold>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={`/play/${encodeURIComponent(run.play)}`}>{run.play}</a>
      </nav>
      <div className="run-head">
        <h1>Run {shortRun(run.play, run.id)}</h1>
        {view && <StatusPill status={viewChip(view.status)} />}
        {view && <AsOfStamp asOf={viewAsOf(view)} />}
      </div>
      {view && <p className="run-state" data-field="view.sentence">{view.sentence}</p>}
      <div className="run-slots">
        <div className="run-slot" data-slot="best">
          <span className="run-slot-label">Best version</span>
          {view?.progress ? (
            <>
              <b>{view.progress.release ?? 'workspace'}: {view.progress.passed} of {view.progress.total} steps</b>
              <StepBar progress={view.progress} />
              <span className="run-slot-sub">{view.progress.sentence}</span>
            </>
          ) : (
            <b>No version scored yet</b>
          )}
        </div>
        <div className="run-slot" data-slot="blocker">
          <span className="run-slot-label">Blocker</span>
          {view?.blocker ? (
            <>
              <b data-field="view.blocker">{view.blocker.text}</b>
              <span className="run-slot-sub">{[view.blocker.owner ? `Owner: ${view.blocker.owner}` : null, view.blocker.since ? `since ${stamp(view.blocker.since, now)}` : null].filter(Boolean).join(' · ')}</span>
            </>
          ) : (
            <b>Nothing holds it</b>
          )}
        </div>
        <div className="run-slot" data-slot="output">
          <span className="run-slot-label">Output</span>
          <b>{output.headline}</b>
          {output.points && output.points.length >= 3 && <span className="run-slot-spark"><Spark points={output.points} /></span>}
          <span className="run-slot-sub">{output.sub}</span>
        </div>
      </div>
    </header>
  )
}

/** On a run's tab pages, the status block is one sticky line: the run, the host's chip, and its sentence. */
export function RunStatusLine({ doc }: { doc: RunDocument; play?: Play | null; now?: number }) {
  return (
    <p className="run-status-line" role="status" data-run-status>
      <a href={`/run/${encodeURIComponent(doc.run.id)}`}>Run {shortRun(doc.run.play, doc.run.id)}</a>
      {doc.view && <StatusPill status={viewChip(doc.view.status)} />}
      {doc.view && <span className="faint">{doc.view.progress?.sentence ?? doc.view.sentence}</span>}
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
