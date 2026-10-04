import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { KnowledgeBrowser, resolveDocument, type DocumentSelection } from './viewer/KnowledgeBrowser.js'
import { AgentRecord } from './AgentRecord.js'
import type { RecordSelection } from './record.js'
import { claimMatches, claimStatuses, reportToLatex } from './report.js'
import type {
  EvidenceReference,
  QuestionCoverage,
  ResearchPlay,
  ResearchReportData,
  ResearchDocument,
} from './report.js'
import { utcTime } from './viewer/model.js'
import { useDownload } from './viewer/useDownload.js'
import type { ResearchDocumentSelection } from './report-selection.js'

export interface ResearchReportProps {
  report: ResearchReportData
  theme?: 'light' | 'dark' | 'auto'
  defaultPlayId?: string
  onPlayChange?: (playId: string) => void
  defaultDocumentSelection?: ResearchDocumentSelection
  onDocumentChange?: (selection: ResearchDocumentSelection) => void
  className?: string
}

const DocumentContext = createContext<{ documents: ResearchDocument[]; open: (selection: DocumentSelection) => void }>({ documents: [], open: () => {} })

export function ResearchReport({
  report,
  theme = 'auto',
  defaultPlayId,
  onPlayChange,
  defaultDocumentSelection,
  onDocumentChange,
  className = '',
}: ResearchReportProps) {
  const [selected, setSelected] = useState(
    defaultDocumentSelection?.playId ?? defaultPlayId ?? report.plays[0]?.id,
  )
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const download = useDownload()
  const q = query.trim().toLowerCase()
  const searchText = useMemo(() => new Map(report.plays.map(play => [play.id,
    [play.title, play.id, play.summary,
      ...play.observations.flatMap(item => [item.title, item.body]),
      ...play.questionCoverage.flatMap(item => [item.question, item.answer ?? '']),
      ...play.documents.flatMap(item => [item.title, item.path, item.content])].join('\n').toLowerCase(),
  ])), [report])
  const matches = (play: ResearchPlay) => {
    const titleMatch = searchText.get(play.id)!.includes(q)
    return (
      (status === 'all' && titleMatch) ||
      play.claims.some((claim) =>
        claimMatches(claim, titleMatch ? '' : q, status),
      )
    )
  }
  const visible = report.plays.filter(matches)
  const play = visible.find((item) => item.id === selected) ?? visible[0]
  return (
    <article
      className={'agent-record research-report ' + className}
      data-theme={theme}
    >
      {report.freshness && (
        <aside
          className="rr-freshness"
          data-state={report.freshness.state}
          aria-label="Report freshness"
        >
          <strong>
            {report.freshness.state === 'error'
              ? 'Report refresh failed'
              : report.freshness.state === 'stale'
                ? 'Report may be stale'
                : 'Report snapshot'}
          </strong>
          <p>{report.freshness.message}</p>
          <p className="rr-meta">
            Checked {utcTime(report.freshness.checkedAt, true)}
            {report.freshness.lastSuccessfulAt
              ? ' · Last successful refresh ' +
                utcTime(report.freshness.lastSuccessfulAt, true)
              : ''}
          </p>
        </aside>
      )}
      <header className="rr-header">
        <p className="rr-date">
          {report.window?.label ?? 'Research report'} · Generated{' '}
          <time dateTime={report.generatedAt}>
            {utcTime(report.generatedAt, true)}
          </time>
        </p>
        <h1>{report.title}</h1>
        <p className="rr-lead">{report.summary}</p>
        {report.window && (
          <p className="rr-meta">
            Observation window: {utcTime(report.window.from, true)} →{' '}
            {utcTime(report.window.to, true)}
          </p>
        )}
        <p className="rr-meta">
          Assessments: {report.assessmentBy ?? 'supplied by report author'}.
          Evidence labels are author judgments; the viewer does not
          independently verify claims.
        </p>
        {report.limitations.length > 0 && (
          <>
            <details className="rr-coverage">
              <summary>
                Coverage and limitations ({report.limitations.length})
              </summary>
              <ul className="rr-limitations">
                {report.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
            <ul className="rr-limitations rr-print">
              {report.limitations.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </>
        )}
        {report.questionCoverage.length > 0 && (
          <Questions
            questions={report.questionCoverage}
            inspect={() => {}}
            printOnly={false}
          />
        )}
        <div className="rr-actions">
          <button
            className="ui-button"
            onClick={() =>
              download(
                reportToLatex(report),
                report.id + '.tex',
                'application/x-tex',
              )
            }
          >
            Export report LaTeX
          </button>
          <button
            className="ui-button"
            onClick={() =>
              download(
                JSON.stringify(report, null, 2),
                report.id + '.json',
                'application/json',
              )
            }
          >
            Download report data
          </button>
          <button className="ui-button" onClick={() => window.print()}>
            Print summary
          </button>
        </div>
      </header>
      <div className="rr-controls">
        <label className="ui-field">
          <span className="ui-label">Search research</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Question, result, source, or document…"
          />
        </label>
        <label className="ui-field">
          <span className="ui-label">Assessment</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All assessments</option>
            {claimStatuses.map((item) => (
              <option key={item} value={item}>
                {item[0]!.toUpperCase() + item.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <output className="rr-meta" aria-live="polite">
          {visible.length} of {report.plays.length} plays
        </output>
      </div>
      {play && (
        <label className="ui-field rr-mobile-play">
          <span className="ui-label">Play</span>
          <select
            value={play.id}
            onChange={(event) => {
              setSelected(event.target.value)
              onPlayChange?.(event.target.value)
            }}
          >
            {visible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {play ? (
        <div className="rr-layout">
          <nav className="rr-plays" aria-label="Research plays">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === play.id ? 'page' : undefined}
                onClick={() => {
                  setSelected(item.id)
                  onPlayChange?.(item.id)
                }}
              >
                <span>{item.title}</span>
                <small>
                  {item.status ?? 'State unknown'} · {item.claims.length}{' '}
                  {item.claims.length === 1 ? 'claim' : 'claims'}
                </small>
              </button>
            ))}
          </nav>
          <PlayReport
            key={play.id}
            play={play}
            report={report}
            theme={theme}
            query={
              [play.title, play.id, play.summary]
                .join(' ')
                .toLowerCase()
                .includes(q)
                ? ''
                : q
            }
            status={status}
            initialDocument={defaultDocumentSelection?.playId === play.id ? defaultDocumentSelection : undefined}
            onDocumentChange={onDocumentChange}
          />
        </div>
      ) : (
        <p className="chat-empty" role="status">
          {report.plays.length
            ? 'No plays match these filters. Clear the search or choose another assessment.'
            : 'No plays have been supplied.'}
        </p>
      )}
      <div className="rr-print">
        {report.plays.map((item) => (
          <PlayReport
            key={item.id}
            play={item}
            report={report}
            theme={theme}
            query=""
            status="all"
            printOnly
          />
        ))}
      </div>
    </article>
  )
}

function PlayReport({
  play,
  report,
  theme,
  query,
  status,
  printOnly = false,
  initialDocument,
  onDocumentChange,
}: {
  play: ResearchPlay
  report: ResearchReportData
  theme: 'light' | 'dark' | 'auto'
  query: string
  status: string
  printOnly?: boolean
  initialDocument?: ResearchDocumentSelection
  onDocumentChange?: (selection: ResearchDocumentSelection) => void
}) {
  const [selection, setSelection] = useState<RecordSelection>()
  const [documentSelection, setDocumentSelection] = useState<DocumentSelection | undefined>(initialDocument)
  const documents = useRef<HTMLDivElement>(null)
  const trace = useRef<HTMLDivElement>(null)
  const uid = useId()
  const download = useDownload()
  const claims = play.claims.filter((claim) =>
    claimMatches(claim, query, status),
  )
  function inspect(eventId: string) {
    const event = play.record?.events.find((item) => item.id === eventId)
    if (!event || !play.record) return
    setSelection({
      runId: play.record.runId,
      eventId,
      at: event.at,
      view: 'source',
    })
    trace.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    trace.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (initialDocument && !initialDocument.line && !printOnly) documents.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])
  function selectDocument(next: DocumentSelection) {
    setDocumentSelection(next)
    onDocumentChange?.({ playId: play.id, ...next })
  }
  function openDocument(next: DocumentSelection) {
    selectDocument(next)
    documents.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    documents.current?.focus({ preventScroll: true })
  }
  return (
    <DocumentContext.Provider value={{ documents: play.documents, open: openDocument }}>
    <section className="rr-play" aria-labelledby={uid}>
      <header>
        <div className="rr-play-heading">
          <h2 id={uid}>{play.title}</h2>
          {!printOnly && (
            <button
              className="ui-button"
              onClick={() =>
                download(
                  reportToLatex(report, play.id),
                  play.id + '.tex',
                  'application/x-tex',
                )
              }
            >
              Export play LaTeX
            </button>
          )}
        </div>
        <p className="rr-meta">
          {play.status ?? 'State unknown'} · Updated{' '}
          {play.updatedAt ? (
            <time dateTime={play.updatedAt}>
              {utcTime(play.updatedAt, true)}
            </time>
          ) : (
            'unknown'
          )}
        </p>
        <p className="rr-play-summary">{play.summary}</p>
        {play.metrics.length > 0 && <dl className="rr-metrics" aria-label="Recorded measurements">{play.metrics.map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd>{metric.value ?? 'Unknown'}{metric.value !== null && metric.unit ? ` ${metric.unit}` : ''}</dd>{metric.coverage && <small>{metric.coverage}</small>}{metric.source && <Sources sources={[metric.source]} inspect={inspect} printOnly={printOnly} />}</div>)}</dl>}
        {!printOnly && <nav className="rr-section-links" aria-label="Play sections"><a href={`#${uid}-questions`}>Questions and answers</a>{play.documents.length > 0 && <a href={`#${uid}-knowledge`}>Knowledge base · {play.documents.length} files</a>}<a href={`#${uid}-trace`}>Trace and topology</a></nav>}
        {play.limitations.length > 0 && (
          <ul className="rr-limitations">
            {play.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </header>
      <div className="rr-claims">
        {claims.map((claim) => (
          <article
            className="rr-claim"
            data-assessment={claim.status}
            key={claim.id}
          >
            <p className="rr-assessment">
              {claim.status[0]!.toUpperCase() + claim.status.slice(1)}
            </p>
            <h3>{claim.statement}</h3>
            {claim.method && (
              <p>
                <strong>Assessment basis.</strong> {claim.method}
              </p>
            )}
            {claim.limitations.length > 0 && (
              <ul className="rr-limitations">
                {claim.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            {claim.evidence.length ? (
              <Sources
                sources={claim.evidence}
                inspect={inspect}
                printOnly={printOnly}
              />
            ) : (
              <p className="rr-meta">No supporting evidence supplied.</p>
            )}
          </article>
        ))}
        {!claims.length && (
          <p className="chat-empty">
            {play.claims.length
              ? 'No claims in this play match these filters.'
              : 'No claim assessment has been supplied for this play.'}
          </p>
        )}
      </div>
      {play.sources.length > 0 && (
        <div className="rr-play-sources">
          <Sources
            sources={play.sources}
            inspect={inspect}
            printOnly={printOnly}
          />
        </div>
      )}
      {play.observations.length > 0 && (
        <section
          className="rr-observations"
          aria-label="Checks and observations"
        >
          {play.observations.map((item) => (
            <article className="rr-observation" key={item.id}>
              <p className="rr-meta">{item.kind.replace(/-/g, ' ')}</p>
              <h4>{item.title}</h4>
              <p>{item.body}</p>
              {item.evidence.length > 0 && (
                <Sources
                  sources={item.evidence}
                  inspect={inspect}
                  printOnly={printOnly}
                />
              )}
            </article>
          ))}
        </section>
      )}
      {play.questionCoverage.length > 0 && (
        <div id={`${uid}-questions`}>
        <Questions
          questions={play.questionCoverage}
          inspect={inspect}
          printOnly={printOnly}
        />
        </div>
      )}
      {!printOnly && play.documents.length > 0 && <div id={`${uid}-knowledge`} ref={documents} tabIndex={-1} className="rr-knowledge-section"><h3>Knowledge base</h3><p className="rr-meta">Read retained reports, research notes, and code. Search uses the text included in this snapshot; it does not generate new answers.</p><KnowledgeBrowser documents={play.documents} selection={documentSelection} onSelect={selectDocument} /></div>}
      {!printOnly && (
        <div
          id={`${uid}-trace`}
          className="rr-trace"
          ref={trace}
          tabIndex={-1}
          aria-label="Recorded evidence"
        >
          <h3>Recorded evidence</h3>
          {play.record ? (
            <>
              <p className="rr-meta">
                Replay shows supplied events. The assessment above is a later
                annotation and does not change with the cursor.
              </p>
              <AgentRecord
                records={[play.record]}
                theme={theme}
                selection={selection}
                onSelectionChange={setSelection}
              />
            </>
          ) : (
            <p className="rr-trace-missing">
              No event record was supplied for this play. Its topology,
              timeline, tool activity, and token usage are unavailable.
            </p>
          )}
        </div>
      )}
      {printOnly && (
        <p className="rr-meta">
          {play.record
            ? play.record.events.length +
              ' recorded events. Capture ' +
              (play.record.coverage.completeOriginalCapture
                ? 'marked complete by producer.'
                : 'incomplete or unknown.') +
              ' Cost: ' +
              play.record.coverage.cost
            : 'Event record unavailable. Topology, activity, and cost are unknown.'}
        </p>
      )}
    </section>
    </DocumentContext.Provider>
  )
}

function Questions({
  questions,
  inspect,
  printOnly,
}: {
  questions: QuestionCoverage[]
  inspect: (eventId: string) => void
  printOnly: boolean
}) {
  return (
    <details className="rr-questions" open={printOnly || undefined}>
      <summary>
        Question coverage ·{' '}
        {questions.filter((item) => item.status === 'observed').length} of{' '}
        {questions.length} observed
      </summary>
      <dl>
        {questions.map((item) => (
          <div key={item.id} className="rr-question">
            <dt>
              {item.id} · {item.question}
            </dt>
            <dd className="rr-meta">{item.status.replace(/_/g, ' ')}</dd>
            {item.answer && <dd>{item.answer}</dd>}
            {item.evidence.length > 0 && (
              <dd>
                <Sources
                  sources={item.evidence}
                  inspect={inspect}
                  printOnly={printOnly}
                />
              </dd>
            )}
          </div>
        ))}
      </dl>
    </details>
  )
}

function Sources({
  sources,
  inspect,
  printOnly,
}: {
  sources: EvidenceReference[]
  inspect: (eventId: string) => void
  printOnly: boolean
}) {
  const documents = useContext(DocumentContext)
  return (
    <details className="rr-sources" open={printOnly || undefined}>
      <summary>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'} ·
        inspect evidence
      </summary>
      <ol>
        {sources.map((source, i) => (
          <li key={i}>
            {source.label && <strong>{source.label}</strong>}
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.url}
              </a>
            )}
            {source.path && (
              <code>
                {source.path}
                {source.line ? ':' + source.line : ''}
              </code>
            )}
            {!printOnly && source.path && resolveDocument(documents.documents, source.path) && <button className="ui-button" type="button" onClick={() => documents.open({ path: resolveDocument(documents.documents, source.path!)!.path, line: source.line })}>Read retained document</button>}
            {source.sha256 && (
              <small>
                SHA-256 <code>{source.sha256}</code>
              </small>
            )}
            {source.excerpt && <blockquote>{source.excerpt}</blockquote>}
            {source.eventId &&
              (printOnly ? (
                <code>Event: {source.eventId}</code>
              ) : (
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => inspect(source.eventId!)}
                >
                  Open recorded event
                </button>
              ))}
          </li>
        ))}
      </ol>
    </details>
  )
}
