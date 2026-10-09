import { useState } from 'react'
import type { FinalOutput, OutputFile, Readout, TraceReview, TraceReviewQuestion } from '../workspace.js'
import {
  byteSize,
  deliveryLabel,
  externalHref,
  judgeBasis,
  questionLabel,
  reviewPhaseLabel,
  reviewScoreTone,
  sameOriginHref,
  scoreLabel,
  verdictView,
} from './final-output.js'
import { money, when } from './data.js'
import { ChartGallery, GradeControl, ScoresTable } from './Scores.js'

function FileRow({ file, label }: { file: OutputFile; label?: string }) {
  const href = typeof window === 'undefined' ? null : sameOriginHref(file.href, window.location.href)
  return (
    <li className="final-file" data-final-file={file.path}>
      {href ? (
        <a className="mono final-path" href={href} target="_blank" rel="noopener">
          {file.path}
        </a>
      ) : (
        <span className="mono final-path">{file.path}</span>
      )}
      <span className="final-size">{byteSize(file.bytes)}</span>
      {label && <span className="final-label">{label}</span>}
      {!href && <span className="final-size">no link</span>}
    </li>
  )
}

/** Long evidence and judge reasons show three lines until the reader asks for the rest. */
const CLAMP_CHARS = 240

function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= CLAMP_CHARS) return <>{text}</>
  return (
    <>
      <span className={open ? undefined : 'final-clamped'}>{text}</span>{' '}
      <button type="button" className="final-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'less' : 'more'}
      </button>
    </>
  )
}

/** A long list stays one line until opened, so the readout above it stays in view. */
const FILES_SHOWN = 8

function DeliveredFiles({ files }: { files: OutputFile[] }) {
  if (files.length === 0) return <p className="faint final-none">No delivered file is recorded.</p>
  const list = <ul className="final-files">{files.map((file) => <FileRow key={file.path} file={file} />)}</ul>
  if (files.length <= FILES_SHOWN) return list
  return (
    <details className="final-files-all">
      <summary>{files.length} files under the declared path</summary>
      {list}
    </details>
  )
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  )
}

const READOUT_LINKS = [
  ['report', 'Report'],
  ['dossier', 'Dossier'],
] as const

/** The readout the Lab writes after the run settles: summary, deliverables, verdicts, judges, cost and its links. */
function ReadoutSection({ readout, output, grading }: { readout: Readout; output: FinalOutput; grading?: Grading }) {
  if (readout.status === 'pending') {
    return (
      <div className="final-readout" data-readout="pending">
        <h3>Readout pending</h3>
        <p className="faint">The readout is written after the run settles; none has finished for this run yet.</p>
      </div>
    )
  }
  const tone = readout.status === 'complete' ? 'state-ok' : readout.status === 'failed' ? 'state-fail' : 'state-warn'
  const gist = externalHref(readout.links.gist)
  const shownGist = gist && !READOUT_LINKS.some(([key]) => externalHref(readout.links[key]) === gist) ? gist : null
  return (
    <div className="final-readout" data-readout={readout.status}>
      <div className="final-readout-head">
        <h3>Readout</h3>
        <span className={`state-pill ${tone}`}>{readout.status}</span>
        {readout.settle && (
          <span className="faint">
            settled {readout.settle.kind.replaceAll('-', ' ')}
            {readout.settle.reason ? `, ${readout.settle.reason.replaceAll('-', ' ')}` : ''}
          </span>
        )}
        {readout.generatedAt && <span className="faint final-checked">written {when(readout.generatedAt)}</span>}
      </div>
      {readout.error && <p className="final-error" role="note">{readout.error}</p>}
      {readout.summary && <p className="final-summary">{readout.summary}</p>}
      <ChartGallery charts={readout.charts} />
      <p className="final-links">
        {READOUT_LINKS.map(([key, label]) => {
          const href = externalHref(readout.links[key])
          return href ? <ExternalLink key={key} href={href}>{label}</ExternalLink> : <span key={key} className="faint">{label} not published</span>
        })}
        {shownGist && <ExternalLink href={shownGist}>Gist</ExternalLink>}
        <span className="final-cost">
          readout cost <b>{money(readout.cost.readoutUsd)}</b> · run cost <b>{money(readout.cost.runUsd)}</b>
        </span>
      </p>

      <h4>Deliverables</h4>
      {readout.deliverables.length === 0 ? (
        <p className="faint final-none">The run declared no deliverables.</p>
      ) : (
        <ul className="final-files" data-readout-deliverables>
          {readout.deliverables.map((item) => {
            const href = externalHref(item.url)
            return (
              <li className="final-file final-deliverable" key={item.id} data-deliverable={item.id}>
                <span className={`state-pill ${item.present === true ? 'state-ok' : item.present === false ? 'state-fail' : 'state-unknown'}`}>
                  {item.present === true ? 'present' : item.present === false ? 'missing' : 'unknown'}
                </span>
                {href ? <ExternalLink href={href}>{item.id}</ExternalLink> : <b>{item.id}</b>}
                {item.kind && <span className="final-label">{item.kind}</span>}
                {item.path && <span className="mono final-path">{item.path}</span>}
                <span className="final-size">{byteSize(item.bytes)}</span>
                {item.bar && <span className="final-bar faint">Bar: {item.bar}</span>}
              </li>
            )
          })}
        </ul>
      )}

      <h4>Hypotheses</h4>
      {readout.verdicts.length === 0 ? (
        <p className="faint final-none">No hypothesis verdicts were recorded.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table final-table" data-readout-verdicts>
            <thead>
              <tr><th>Hypothesis and evidence</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {readout.verdicts.map((item) => {
                const view = verdictView(item.verdict)
                return (
                  <tr key={item.id} data-verdict={item.id}>
                    <td>
                      <b className="mono">{item.id}</b> {item.statement}
                      {item.evidence && <div className="final-evidence faint"><Clamped text={item.evidence} /></div>}
                    </td>
                    <td className="final-nowrap"><span className={`state-pill ${view.tone}`}>{view.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4>Scores, 0–100 vs world class</h4>
      <ScoresTable readout={readout} panel={output.panel} grades={output.grades?.latest} target={grading ? { kind: 'run', id: grading.runId } : { kind: 'run', id: '' }} />
      {grading && (
        <GradeControl
          api={grading.api}
          runId={grading.runId}
          target={{ kind: 'run', id: grading.runId }}
          label="Your grade of this run"
          current={output.grades?.latest.filter((grade) => grade.target.kind === 'run').at(-1) ?? null}
          onSaved={grading.onSaved}
        />
      )}
      <h4>AI judges' reasons</h4>
      {readout.judges.length === 0 ? (
        <p className="faint final-none">No judge scored this run.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table final-table" data-readout-judges>
            <thead>
              <tr><th>Category and reasons</th><th className="num">Score</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {readout.judges.map((item) => (
                <tr key={item.category} data-judge={item.category}>
                  <td>
                    <b>{item.category}</b>
                    {item.summary && <div className="final-evidence faint"><Clamped text={item.summary} /></div>}
                  </td>
                  <td className={`num${item.score === null ? ' unknown' : ''}`}>{scoreLabel(item.score, item.max)}</td>
                  <td className="final-nowrap">
                    <span className={`state-pill ${item.calibrated === true ? 'state-ok' : 'state-unknown'}`}>{judgeBasis(item.calibrated)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** A question's quotes from the agents and its suggestions, folded until the reader opens them. */
function QuestionDetail({ item }: { item: TraceReviewQuestion }) {
  const { quotes, suggestions, citations } = item
  if (quotes.length === 0 && suggestions.length === 0) return null
  const parts = [quotes.length > 0 && plural(quotes.length, 'quote'), suggestions.length > 0 && plural(suggestions.length, 'suggestion')].filter(Boolean)
  return (
    <details className="review-detail">
      <summary>{parts.join(' and ')}</summary>
      {quotes.length > 0 && (
        <ul className="review-quotes">
          {quotes.map((quote, index) => (
            <li key={index}>
              <span className="faint">{quote.agent ?? 'An agent'} wrote:</span> <q>{quote.quote}</q>
              {quote.citation && <span className="mono faint review-citation">{quote.citation}</span>}
            </li>
          ))}
        </ul>
      )}
      {citations.total !== null && citations.total > 0 && (
        <p className="faint review-note">
          {citations.resolved ?? 'unknown'} of {plural(citations.total, 'citation')} found in the sessions.
        </p>
      )}
      {suggestions.length > 0 && (
        <>
          <p className="review-note">Suggestions</p>
          <ol className="review-suggestions">
            {suggestions.map((text, index) => <li key={index}>{text}</li>)}
          </ol>
        </>
      )}
    </details>
  )
}

/** The run's latest trace review: a model read the agents' sessions and answered each question with a 0–100 score
 * (higher is better), a verdict, quotes and suggestions. Advisory, like the persona panel. */
export function TraceReviewSection({ review }: { review: TraceReview }) {
  const { sessions } = review
  return (
    <div className="final-readout final-review" data-trace-review={review.final ? 'final' : 'live'}>
      <div className="final-readout-head">
        <h3>Trace review</h3>
        <span className={`state-pill ${review.final ? 'state-ok' : 'state-warn'}`}>{review.final ? 'final' : 'live'}</span>
        <span className="faint">{reviewPhaseLabel(review, when(review.generatedAt))}</span>
      </div>
      <p className="final-summary">
        <b>The requester's goal:</b> {review.goal ?? <span className="faint">not registered for this run</span>}
      </p>
      <p className="final-links faint" data-review-sessions>
        <span>
          Read {sessions.read === null ? 'an unknown number of' : sessions.read} agent session{sessions.read === 1 ? '' : 's'}
          {sessions.nodes !== null ? ` from ${plural(sessions.nodes, 'agent')}` : ''}
          {sessions.unreadableCount > 0 ? `; ${sessions.unreadableCount} could not be read` : '; none was unreadable'}.
        </span>
        {review.model && <span>Reviewed by {review.model}</span>}
        {review.cost.usd !== null && (
          <span className="final-cost">
            review cost <b>{money(review.cost.usd)}</b>
          </span>
        )}
      </p>
      {sessions.unreadable.length > 0 && (
        <details className="final-files-all">
          <summary>Sessions the review could not read</summary>
          <ul className="review-quotes">
            {sessions.unreadable.map((item, index) => (
              <li key={index}>
                <span className="mono">{item.node ?? 'unknown agent'}</span>: {item.reason ?? 'no reason given'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {review.questions.length === 0 ? (
        <p className="faint final-none">The review answered no questions.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table final-table" data-trace-review-questions>
            <thead>
              <tr><th>Question</th><th className="num">Score</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {review.questions.map((item, index) => (
                <tr key={`${index}:${item.id}`} data-review-question={item.id}>
                  <td>
                    <b>{questionLabel(item.id)}</b>
                    {item.question && <div className="final-evidence faint"><Clamped text={item.question} /></div>}
                  </td>
                  <td className="num final-nowrap">
                    {item.status === 'failed' ? (
                      <span className="state-pill state-fail">failed</span>
                    ) : item.score === null ? (
                      <span className="faint">no score</span>
                    ) : (
                      <span className={`state-pill ${reviewScoreTone(item.score)}`}>{Math.round(item.score)}/100</span>
                    )}
                  </td>
                  <td>
                    {item.status === 'failed' ? (
                      <span className="final-error">The question was not answered: {item.failure ?? 'no reason recorded'}</span>
                    ) : item.verdict ? (
                      <Clamped text={item.verdict} />
                    ) : (
                      <span className="faint">No verdict.</span>
                    )}
                    <QuestionDetail item={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint final-none">Scores are 0–100, higher is better, from a model reading the sessions; advisory, not acceptance.</p>
    </div>
  )
}

/** What the run was asked to deliver and whether it did. Older run documents carry no field, and show nothing. */
/** Where a writer's grade goes, and what to do once it is saved. */
export interface Grading {
  api: string
  runId: string
  onSaved?: () => void
}

export function FinalOutputPanel({ output, grading }: { output: FinalOutput | null | undefined; grading?: Grading }) {
  if (!output) return null
  const declared = output.declared
  const tone = output.status === 'delivered' ? 'state-ok' : output.status === 'not-delivered' ? 'state-fail' : 'state-unknown'
  return (
    <section className="ws-final" aria-label="Final output" data-final-output={output.status}>
      <header className="ws-final-head">
        <h2>Final output</h2>
        {declared && <span className={`state-pill ${tone}`} data-final-status>{deliveryLabel(output.status)}</span>}
        {output.checkedAt && <span className="faint final-checked">checked {when(output.checkedAt)}</span>}
      </header>
      {output.readout && <ReadoutSection readout={output.readout} output={output} grading={grading} />}
      {output.traceReview && <TraceReviewSection review={output.traceReview} />}
      {declared ? (
        <>
          <p className="final-declared">
            {declared.path && <span className="mono final-path">{declared.path}</span>}
            {declared.description && <span className="final-description">{declared.description}</span>}
            {!declared.path && !declared.description && <span className="faint">Declared in {declared.field}, without a path or description.</span>}
            <span className="faint final-source">declared by the {declared.source === 'deliverable-check' ? 'deliverable check' : 'run input'} ({declared.field})</span>
          </p>
          <DeliveredFiles files={output.files} />
        </>
      ) : (
        <>
          <p className="final-declared faint">No final output declared</p>
          {output.rootOutput && (
            <ul className="final-files"><FileRow file={output.rootOutput} label="root agent's last output" /></ul>
          )}
        </>
      )}
    </section>
  )
}
