import type { PlayDocument, RunCheck, RunSummary } from '../workspace.js'
import { stateClass, stateLabel, when } from './data.js'
import { plain } from './FindingsFeed.js'

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path
const shortTag = (tag: string | null | undefined) => tag?.split('/').pop() ?? null

type CheckRow = NonNullable<RunCheck['latest']>

/** A run's newest check line: the host's check summary (R2), else the newest line of its recorded play check. */
function lastCheck(run: RunSummary): { at: string | null; tag: string | null; verdict: string | null; line: string } | null {
  const latest = run.check?.latest
  if (latest?.line) return { at: latest.at ?? null, tag: latest.tag ?? null, verdict: latest.verdict ?? null, line: latest.line }
  const check = run.playCheck
  const line = check?.solved ?? [...(check?.lines ?? [])].reverse().find((item) => /SOLVED/.test(item)) ?? check?.lines.at(-1)
  return check && line ? { at: check.at, tag: null, verdict: null, line } : null
}

const scoreWords = (score: CheckRow['score']) => [
  score?.workloads?.passed != null && score.workloads.total ? `${score.workloads.passed}/${score.workloads.total} workloads` : null,
  score?.reached != null && score.of ? `stage ${score.reached} of ${score.of}${score.stage ? ` (${score.stage})` : ''}` : null,
].filter(Boolean).join(', ')

/** How good a check's result is, as the host ranks it: solved first, then the stage reached, then the workloads passed. */
const rank = (row: CheckRow) => [row.verdict === 'solved' ? 1 : 0, row.score?.reached ?? 0, row.score?.workloads?.passed ?? 0]
const better = (a: CheckRow, b: CheckRow) => {
  const [x, y] = [rank(a), rank(b)]
  const i = x.findIndex((value, j) => value !== y[j])
  return i >= 0 && x[i]! > y[i]!
}

/**
 * The answer of a play no run has won (R2): the newest check line of any run with its run's one-sentence check history,
 * the best score any run's checks reached, and each run's last check line, so a reader sees where the play stands
 * against its check, not one fixed sentence.
 */
function NoWinner({ play }: { play: PlayDocument }) {
  const checks = play.runs.map((run) => ({ run, check: lastCheck(run) })).filter((item): item is { run: RunSummary; check: NonNullable<ReturnType<typeof lastCheck>> } => item.check !== null)
  const newest = [...checks].sort((a, b) => String(b.check.at ?? '').localeCompare(String(a.check.at ?? '')))[0] ?? null
  let best: { run: RunSummary; row: CheckRow } | null = null
  for (const run of play.runs) if (run.check?.best && (!best || better(run.check.best, best.row))) best = { run, row: run.check.best }
  const headline = newest?.run.check?.headline ?? null
  return (
    <section className="play-answer is-none" data-play-answer="none" aria-label="Answer">
      <h3>Answer</h3>
      <p className="faint">No run of this play has won yet{checks.length ? '' : ': no run’s play check passed and no root submitted a winner'}.</p>
      {newest && (
        <p className="play-answer-text" data-newest-check={newest.run.id}>
          {headline ?? <>{shortTag(newest.check.tag) && <b>{shortTag(newest.check.tag)} </b>}{newest.check.line}</>}
          <span className="faint"> · <a className="mono" href={`/run/${encodeURIComponent(newest.run.id)}`}>{shortRun(play.id, newest.run.id)}</a> · {when(newest.check.at)}</span>
        </p>
      )}
      {best && scoreWords(best.row.score) && (
        <p className="play-answer-run" data-best-score={best.run.id}>
          <span className="answer-label">Best score</span> {scoreWords(best.row.score)}
          <span className="faint"> · {shortTag(best.row.tag) ? `${shortTag(best.row.tag)} · ` : ''}{best.row.verdict?.replace('-', ' ') ?? 'verdict unknown'}{best.row.checker ? ` under checker ${best.row.checker.slice(0, 8)}` : ''} · {shortRun(play.id, best.run.id)}{best.row.at ? ` · ${when(best.row.at)}` : ''}</span>
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
