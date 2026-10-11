import type { PlayDocument } from '../workspace.js'
import { stateClass, stateLabel, when } from './data.js'
import { plain } from './FindingsFeed.js'

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/**
 * What a play's Results lead with: its answer. The best run (the newest that won: its play check passed, or its root
 * submitted), what it found (the check's SOLVED line, else that run's first stated finding), the check's verdict with its
 * evidence lines, and links to the run's deliverables and its receipt. A play no run has won says so in one line.
 */
export function PlayAnswer({ play }: { play: PlayDocument }) {
  const best = play.best ? (play.runs.find((run) => run.id === play.best) ?? null) : null
  if (!best) {
    return (
      <section className="play-answer is-none" data-play-answer="none" aria-label="Answer">
        <h3>Answer</h3>
        <p className="faint">No run of this play has won yet: no run&rsquo;s play check passed and no root submitted a winner.</p>
      </section>
    )
  }
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
