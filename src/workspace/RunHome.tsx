import type { RunDocument } from '../workspace-model.js'
import { RunArtifacts, type ArtifactNavigation } from './RunArtifacts.js'
import { isLive, runAsOf, runChip } from './run-answers.js'
import { AsOfStamp } from './AnswerStrip.js'
import { shortRun } from './play-standing.js'
import type { RunSection } from './RunTabs.js'
import { goalSentence } from './run-story.js'
import { runCheckView } from './run-check-view.js'
import { outcomeOfCheck } from './RunOverview.js'
import type { RunDesignVariant } from './RunDesignPreview.js'

interface Props {
  api: string
  doc: RunDocument
  selected: string | null
  onSelect: (path: string | null) => void
  onOpen: (section: RunSection) => void
  navigation: ArtifactNavigation
  variant: RunDesignVariant
  onInspect: () => void
}

/** Purpose, actual work and the evidence needed to decide whether it is finished share one reading context. */
export function RunHome({ api, doc, selected, onSelect, onOpen, navigation, variant, onInspect }: Props) {
  const goal = doc.input?.objective ?? doc.run.purpose ?? null
  const receipt = doc.receipt
  const retention = receipt?.system?.retention
  const check = doc.run.check?.latest ?? doc.run.check?.best
  const verdict = runCheckView(doc.run.check ?? null, doc.progress?.outcome ?? (receipt ? outcomeOfCheck(receipt) : null))
  const live = isLive(doc)
  const chip = runChip(doc)
  const disposable = retention?.disposition === 'disposable'
  const cleanupUnverified = disposable && (retention.pending > 0 || retention.snapshotAbsenceVerified !== true)
  return <section className="run-home" data-run-home data-composition={variant}>
    <header className="run-purpose">
      <div className="run-purpose-context"><span>{doc.run.play} · Run {shortRun(doc.run.play, doc.run.id)}</span><span>{live ? 'Running' : 'Execution ended'}</span><AsOfStamp asOf={runAsOf(doc)} /></div>
      <h1>{goalSentence(goal, 140) ?? doc.run.play.replaceAll('-', ' ')}</h1>
      <div className="run-purpose-state">
        <span>{verdict.result ? verdict.verdict : live ? 'Work is in progress' : `Recorded execution: ${chip.word.toLowerCase()}`}</span>
        {cleanupUnverified && <a href="#rr-retention" onClick={onInspect}>Resource cleanup unverified</a>}
        {check?.at && <time dateTime={check.at}>Checked {check.at.slice(5, 10)} at {check.at.slice(11, 16)} UTC</time>}
      </div>
    </header>
    <div className="run-work-layout">
      <RunArtifacts api={api} doc={doc} selected={selected} onSelect={onSelect} navigation={navigation} layout={variant} />
      <aside className="run-work-context" aria-label="Purpose and verification">
        <section><h2>What was asked</h2><p>{goal ?? 'The original request is unavailable.'}</p><button type="button" className="link-button" onClick={() => onOpen('input')}>Open the full brief</button></section>
        <section><h2>What establishes success</h2>
          <p>{check?.line ?? 'No deciding check output was recorded.'}</p>
          {verdict.result && <p className="run-context-note">The check result applies to the version and criteria it evaluated. Requirements outside that check still need evidence.</p>}
          {doc.run.check?.calibration?.state === 'unknown' && <p className="run-context-note">Check calibration has not been recorded.</p>}
          <a className="link-button" href="#run-verification" onClick={onInspect}>Inspect the check and its evidence</a>
        </section>
        {retention && <section className={cleanupUnverified ? 'run-context-attention' : undefined}><h2>{cleanupUnverified ? 'Still needs attention' : 'Resource disposition'}</h2>
          <p>{cleanupUnverified ? 'Removal of the disposable environment and snapshot absence have not both been verified.' : disposable ? 'The recorded environment removals and snapshot absence are verified.' : `Requested retention: ${retention.disposition}.`}</p>
          <a className="link-button" href="#rr-retention" onClick={onInspect}>Review cleanup evidence</a>
        </section>}
        <section><h2>Follow the work</h2><button type="button" className="link-button" onClick={() => onOpen('agents')}>Read the agent conversation</button><button type="button" className="link-button" onClick={() => onOpen('findings')}>Inspect findings and sources</button></section>
      </aside>
    </div>
  </section>
}
