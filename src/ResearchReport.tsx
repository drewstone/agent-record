import { createContext, useContext, useId, useState } from 'react'
import { KnowledgeBrowser, resolveDocument, type DocumentSelection } from './viewer/KnowledgeBrowser.js'
import { AgentRecord } from './AgentRecord.js'
import { parseReportOptions } from './report-options.js'
import type { RecordSelection } from './record.js'
import { reportToLatex } from './report.js'
import type { EvidenceReference, QuestionCoverage, ResearchPlay, ResearchReportData, ResearchDocument } from './report.js'
import { utcTime } from './viewer/model.js'
import { useDownload } from './viewer/useDownload.js'
import type { ResearchDocumentSelection, ResearchView } from './report-selection.js'

export interface ResearchReportProps {
  report: ResearchReportData
  theme?: 'light' | 'dark' | 'auto'
  defaultPlayId?: string
  onPlayChange?: (playId: string) => void
  defaultActivitySelection?: RecordSelection
  onActivityChange?: (playId: string, selection: RecordSelection) => void
  defaultView?: ResearchView
  onViewChange?: (view: ResearchView) => void
  defaultDocumentSelection?: ResearchDocumentSelection
  onDocumentChange?: (selection: ResearchDocumentSelection) => void
  sourceSearchEndpoint?: string
  className?: string
}
const DocumentContext = createContext<{ documents: ResearchDocument[]; open: (selection: DocumentSelection) => void }>({ documents: [], open: () => {} })

export function ResearchReport({ report, theme = 'auto', defaultPlayId, onPlayChange, defaultView,
  onViewChange, defaultActivitySelection, onActivityChange, defaultDocumentSelection, onDocumentChange, sourceSearchEndpoint, className = '' }: ResearchReportProps) {
  sourceSearchEndpoint = parseReportOptions({ sourceSearchEndpoint }).sourceSearchEndpoint
  const [selected, setSelected] = useState(defaultDocumentSelection?.playId ?? defaultPlayId ?? report.plays[0]?.id)
  const [query, setQuery] = useState('')
  const download = useDownload()
  const plays = report.plays.filter(play => [play.title, play.id].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const play = report.plays.find(item => item.id === selected) ?? report.plays[0]
  function choose(id: string) { setSelected(id); onPlayChange?.(id) }
  return <article className={'agent-record research-report research-workspace ' + className} data-theme={theme}>
    <aside className="research-rail">
      <h1>Research</h1>
      <label className="ui-field"><span className="ui-label">Find a play</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name…" /></label>
      <nav className="research-play-list" aria-label="Research plays">{plays.map(item => <button key={item.id} aria-current={item.id === play?.id ? 'page' : undefined} onClick={() => choose(item.id)}>
        <span>{item.title}</span><small>{item.claims.length} results · {item.documents.length} sources</small>
      </button>)}{!plays.length && <p className="small">No matching play.</p>}</nav>
      <details className="research-info"><summary>About this snapshot</summary>
        <p>{report.title}</p><p className="small">{report.summary}</p>
        <p className="small">Authored {utcTime(report.generatedAt, true)}</p>
        {report.freshness && <p className="small">{report.freshness.message}</p>}
        <p className="small">Assessments: {report.assessmentBy ?? 'Report author'}. Source labels are supplied judgments.</p>
        {report.limitations.length > 0 && <ul>{report.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {report.questionCoverage.length > 0 && <Questions questions={report.questionCoverage} inspect={() => {}} printOnly={false} />}
        <div className="research-exports"><button className="ui-button" onClick={() => download(reportToLatex(report), report.id + '.tex', 'application/x-tex')}>Export LaTeX</button>
          <button className="ui-button" onClick={() => download(JSON.stringify(report, null, 2), report.id + '.json', 'application/json')}>Download data</button>
          <button className="ui-button" onClick={() => window.print()}>Print results</button></div>
      </details>
    </aside>
    {play ? <PlayReport key={play.id} play={play} report={report} theme={theme} initialView={defaultView} initialActivity={defaultActivitySelection} onActivityChange={onActivityChange}
      initialDocument={defaultDocumentSelection?.playId === play.id ? defaultDocumentSelection : undefined}
      onDocumentChange={onDocumentChange} onViewChange={onViewChange} sourceSearchEndpoint={sourceSearchEndpoint} />
      : <p className="chat-empty">No plays were included.</p>}
    <div className="rr-print">{report.plays.map(item => <PlayReport key={item.id} play={item} report={report} theme={theme} printOnly />)}</div>
  </article>
}

function PlayReport({ play, report, theme, printOnly = false, initialDocument, initialView, initialActivity, onActivityChange, onDocumentChange, onViewChange, sourceSearchEndpoint }: {
  play: ResearchPlay; report: ResearchReportData; theme: 'light' | 'dark' | 'auto'; printOnly?: boolean;
  initialDocument?: ResearchDocumentSelection; initialView?: ResearchView; initialActivity?: RecordSelection;
  onActivityChange?: (playId: string, selection: RecordSelection) => void;
  onDocumentChange?: (selection: ResearchDocumentSelection) => void; onViewChange?: (view: ResearchView) => void;
  sourceSearchEndpoint?: string;
}) {
  const [view, setView] = useState<ResearchView>(initialDocument ? 'sources' : initialView ?? 'results')
  const [selection, setSelection] = useState<RecordSelection | undefined>(initialActivity)
  const [documentSelection, setDocumentSelection] = useState<DocumentSelection | undefined>(initialDocument)
  const uid = useId()
  const download = useDownload()
  function show(next: ResearchView) { if (next === 'sources') setDocumentSelection(undefined); setView(next); onViewChange?.(next) }
  function inspect(eventId: string) {
    const event = play.record?.events.find(item => item.id === eventId)
    if (!event || !play.record) return
    setSelection({ runId: play.record.runId, eventId, view: 'source' })
    show('activity')
    onActivityChange?.(play.id, { runId: play.record.runId, eventId, view: 'source' })
  }
  function openDocument(next: DocumentSelection) {
    setDocumentSelection(next); setView('sources'); onDocumentChange?.({ playId: play.id, ...next })
  }
  return <DocumentContext.Provider value={{ documents: play.documents, open: openDocument }}>
    <section className="research-main" aria-labelledby={uid}>
      <header className="research-heading"><div><h2 id={uid}>{play.title}</h2>
        <p className="small">{play.updatedAt ? utcTime(play.updatedAt, true) : 'Update time unknown'} · {play.status ?? 'State unknown'}</p></div>
        {!printOnly && <button className="ui-button" onClick={() => download(reportToLatex(report, play.id), play.id + '.tex', 'application/x-tex')}>Export</button>}
      </header>
      {!printOnly && <nav className="research-sections" aria-label="Play sections">{(['results', 'activity', 'sources'] as const).map(section => <button key={section} aria-current={view === section ? 'page' : undefined} onClick={() => show(section)}>
        {section[0]!.toUpperCase() + section.slice(1)}{section === 'sources' ? ` · ${play.documents.length}` : ''}
      </button>)}</nav>}
      {(printOnly || view === 'results') && <div className="research-results">
        <p className="research-summary">{play.summary}</p>
        <div className="research-result-list">{play.claims.map(claim => <article className="research-result" key={claim.id}>
          <p className="rr-assessment" data-assessment={claim.status}>{claim.status[0]!.toUpperCase() + claim.status.slice(1)}</p>
          <h3>{typeof claim.title === 'string' ? claim.title : claim.statement}</h3>
          {typeof claim.title === 'string' && <p>{claim.statement}</p>}
          {claim.method && <p className="small">{claim.method}</p>}
          {claim.limitations.length > 0 && <ul className="rr-limitations">{claim.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
          {claim.evidence.length > 0 ? <Sources sources={claim.evidence} inspect={inspect} printOnly={printOnly} /> : <p className="small">Supporting sources not supplied.</p>}
        </article>)}</div>
        {!play.claims.length && <p className="chat-empty">No assessed results supplied.</p>}
        {play.questionCoverage.length > 0 && <Questions questions={play.questionCoverage} inspect={inspect} printOnly={printOnly} />}
        {play.observations.length > 0 && <details className="research-observations" open={printOnly || undefined}><summary>Checks and next steps</summary>{play.observations.map(item => <article key={item.id}>
          <h3>{item.title}</h3><p>{item.body}</p>{item.evidence.length > 0 && <Sources sources={item.evidence} inspect={inspect} printOnly={printOnly} />}
        </article>)}</details>}
        <details className="research-measurements" open={printOnly || undefined}><summary>Measurements and coverage</summary>
          {play.metrics.length > 0 && <dl className="rr-metrics" aria-label="Recorded measurements">{play.metrics.map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd>{metric.value ?? 'Unknown'}{metric.value !== null && metric.unit ? ` ${metric.unit}` : ''}</dd>{metric.coverage && <small>{metric.coverage}</small>}{metric.source && <Sources sources={[metric.source]} inspect={inspect} printOnly={printOnly} />}</div>)}</dl>}
          {play.limitations.length > 0 && <ul>{play.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
          {!play.record && <p>No event record was supplied for this play. Activity and topology are unavailable.</p>}
          {play.sources.length > 0 && <Sources sources={play.sources} inspect={inspect} printOnly={printOnly} />}
        </details>
      </div>}
      {!printOnly && view === 'sources' && <KnowledgeBrowser documents={play.documents} selection={documentSelection} onSelect={openDocument}
        onClear={() => { setDocumentSelection(undefined); show('sources') }} playId={play.id} sourceSearchEndpoint={sourceSearchEndpoint} />}
      {!printOnly && view === 'activity' && (play.record ? <AgentRecord records={[play.record]} theme={theme} selection={selection} onSelectionChange={next => { setSelection(next); onActivityChange?.(play.id, next) }} />
        : <p className="chat-empty">No event record was supplied for this play. Its activity and topology are unavailable.</p>)}
    </section>
  </DocumentContext.Provider>
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
      <summary>Questions and answers</summary>
      <dl>
        {questions.map((item) => (
          <div key={item.id} className="rr-question">
            <dt>
              {item.question}
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
