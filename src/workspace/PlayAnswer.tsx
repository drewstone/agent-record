import type { PlayDocument, RunSummary } from '../workspace.js'
import { stateClass, stateLabel, when } from './data.js'
import { plain } from './FindingsFeed.js'

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path
const shortTag = (tag: string | null | undefined) => tag?.split('/').pop() ?? null

type CheckScore = { reached?: number; of?: number; stage?: string | null; value?: number | null; workloads?: { passed: number; total: number } | null }
type CheckLine = { at?: string | null; tag?: string | null; line?: string | null; solved?: boolean | null; verdict?: string | null; score?: CheckScore | null }
/** The check fields the host carries on a run summary (R2): its progress outcome's latest check, tag gate and score. */
type RunOutcome = { latestCheck?: CheckLine | null; gate?: CheckLine | null; score?: (CheckScore & { at?: string | null; tag?: string | null }) | null; solvedLabel?: string | null }

function outcomeOf(run: RunSummary): RunOutcome | null {
  const progress = run.progress as { outcome?: RunOutcome | null } | null | undefined
  return progress?.outcome ?? (run.outcome as RunOutcome | null | undefined) ?? null
}

/** A run's newest check line: its progress outcome's latest check, else the newest line of its recorded play check. */
function lastCheck(run: RunSummary): { at: string | null; tag: string | null; line: string } | null {
  const latest = outcomeOf(run)?.latestCheck
  if (latest?.line) return { at: latest.at ?? null, tag: latest.tag ?? null, line: latest.line }
  const check = run.playCheck
  const line = check?.solved ?? [...(check?.lines ?? [])].reverse().find((item) => /SOLVED/.test(item)) ?? check?.lines.at(-1)
  return check && line ? { at: check.at, tag: null, line } : null
}

const scoreWords = (score: CheckScore) => [
  score.reached != null && score.of != null ? `stage ${score.reached} of ${score.of}${score.stage ? ` (${score.stage})` : ''}` : null,
  score.workloads ? `workloads ${score.workloads.passed}/${score.workloads.total}` : null,
].filter(Boolean).join(', ')

/** The best score any run's checks or tag gate reached, by the Lab's dense value (0 at the first stage, 1 for a pass). */
function bestScore(runs: RunSummary[]) {
  let best: { run: RunSummary; tag: string | null; at: string | null; score: CheckScore } | null = null
  for (const run of runs) {
    const outcome = outcomeOf(run)
    for (const candidate of [{ ...outcome?.score, tag: outcome?.score?.tag, at: outcome?.score?.at }, { ...outcome?.gate?.score, tag: outcome?.gate?.tag, at: outcome?.gate?.at }, { ...outcome?.latestCheck?.score, tag: outcome?.latestCheck?.tag, at: outcome?.latestCheck?.at }]) {
      if (typeof candidate.value !== 'number') continue
      if (!best || candidate.value > (best.score.value ?? -1)) best = { run, tag: candidate.tag ?? null, at: candidate.at ?? null, score: candidate }
    }
  }
  return best
}

/**
 * The answer of a play no run has won (R2): its newest check line, the best score its checks reached, and each run's
 * last check line, so a reader sees where the play stands against its check, not one fixed sentence.
 */
function NoWinner({ play }: { play: PlayDocument }) {
  const checks = play.runs.map((run) => ({ run, check: lastCheck(run) })).filter((item): item is { run: RunSummary; check: NonNullable<ReturnType<typeof lastCheck>> } => item.check !== null)
  const newest = [...checks].sort((a, b) => String(b.check.at ?? '').localeCompare(String(a.check.at ?? '')))[0] ?? null
  const best = bestScore(play.runs)
  const label = newest ? outcomeOf(newest.run)?.solvedLabel : null
  return (
    <section className="play-answer is-none" data-play-answer="none" aria-label="Answer">
      <h3>Answer</h3>
      <p className="faint">No run of this play has won yet{checks.length ? '' : ': no run’s play check passed and no root submitted a winner'}.</p>
      {newest && (
        <p className="play-answer-text" data-newest-check={newest.run.id}>
          {label && <b>{label} · </b>}{newest.check.line}
          <span className="faint"> · {shortTag(newest.check.tag) ? <>{shortTag(newest.check.tag)} · </> : null}<a className="mono" href={`/run/${encodeURIComponent(newest.run.id)}`}>{shortRun(play.id, newest.run.id)}</a> · {when(newest.check.at)}</span>
        </p>
      )}
      {best && scoreWords(best.score) && (
        <p className="play-answer-run" data-best-score={best.run.id}>
          <span className="answer-label">Best score</span> {scoreWords(best.score)}
          <span className="faint"> · {shortTag(best.tag) ? `${shortTag(best.tag)} · ` : ''}{shortRun(play.id, best.run.id)}{best.at ? ` · ${when(best.at)}` : ''}</span>
        </p>
      )}
      {checks.length > 1 && (
        <ol className="play-check-runs" aria-label="Each run's last check line">
          {checks.map(({ run, check }) => (
            <li key={run.id}><a className="mono" href={`/run/${encodeURIComponent(run.id)}`}>{shortRun(play.id, run.id)}</a> <span className="clamp-1" title={check.line}>{check.line}</span></li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * What a play's Results lead with: its answer. The best run (the newest that won: its play check passed, or its root
 * submitted), what it found (the check's SOLVED line, else that run's first stated finding), the check's verdict with its
 * evidence lines, and links to the run's deliverables and its receipt. A play no run has won says so in one line.
 */
export function PlayAnswer({ play }: { play: PlayDocument }) {
  const best = play.best ? (play.runs.find((run) => run.id === play.best) ?? null) : null
  if (!best) return <NoWinner play={play} />
  const check = best.playCheck ?? null
  const finding = play.findings?.find((item) => item.runId === best.id && plain(item.text)) ?? null
  const answer = check?.solved ?? (finding ? plain(finding.text) : null)
  const settle = check?.settle ?? null
  const runHref = `/run/${encodeURIComponent(best.id)}`
  return (
    <section className="play-answer" data-play-answer={best.id} aria-label="Answer">
      <h3>Answer</h3>
      {answer && <p className="play-answer-text">{answer}</p>}
      <p className="play-answer-run">
        <span className={`state-pill ${stateClass(best.state)}`}>{stateLabel(best.state)}</span>
        <a className="mono" href={runHref}>{shortRun(play.id, best.id)}</a>
        {check ? (
          <span>
            play check passed {when(check.at)}
            {settle?.kind && settle.kind !== 'winner' && (
              <span className="faint"> · Runtime settled {settle.kind.replaceAll('-', ' ')}{settle.reason ? ` (${settle.reason.replaceAll('-', ' ')})` : ''}</span>
            )}
          </span>
        ) : (
          best.reason && <span className="faint">{best.reason.replaceAll('-', ' ')}</span>
        )}
      </p>
      {check && check.lines.length > 0 && (
        <pre className="play-check-lines" aria-label={`The play check's output, from ${check.source}`}>{check.lines.join('\n')}</pre>
      )}
      <p className="play-answer-links">
        {(best.deliverables ?? []).map((item) => (
          <a key={item.path} href={item.href} title={item.path}>
            Deliverable: {item.id ?? fileName(item.path)}{item.present === false ? ' (missing)' : ''}
          </a>
        ))}
        {best.receipt && (
          <a href={best.receipt.href}>
            Receipt {best.receipt.tag}{best.receipt.status ? ` · ${best.receipt.status}` : ''}
          </a>
        )}
        <a href={`${runHref}?section=findings`}>What the run found</a>
      </p>
    </section>
  )
}
