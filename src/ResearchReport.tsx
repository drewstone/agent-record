import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { OUTCOME_ORDER } from '@tangle-network/charts'
import { KnowledgeBrowser, resolveDocument, type DocumentSelection } from './viewer/KnowledgeBrowser.js'
import { AgentRecord } from './AgentRecord.js'
import { parseReportOptions } from './report-options.js'
import type { RecordSelection } from './record.js'
import { reportToLatex } from './report.js'
import type { EvidenceReference, QuestionCoverage, ResearchMetric, ResearchPlay, ResearchReportData, ResearchDocument, ResearchRule, ResearchRun, ResearchTable, ResearchUnknown } from './report.js'
import { OutcomeBar, OutcomeLegend } from './workspace/PlayLedger.js'
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
  /** Figures the host draws for a play section, keyed by section id (the play page's bar panels for `how-good`). */
  figures?: Record<string, ReactNode>
  className?: string
}
const DocumentContext = createContext<{ documents: ResearchDocument[]; open: (selection: DocumentSelection) => void }>({ documents: [], open: () => {} })

export function ResearchReport({ report, theme = 'auto', defaultPlayId, onPlayChange, defaultView,
  onViewChange, defaultActivitySelection, onActivityChange, defaultDocumentSelection, onDocumentChange, sourceSearchEndpoint, figures, className = '' }: ResearchReportProps) {
  sourceSearchEndpoint = parseReportOptions({ sourceSearchEndpoint }).sourceSearchEndpoint
  const [selected, setSelected] = useState(defaultDocumentSelection?.playId ?? defaultPlayId ?? report.plays[0]?.id)
  const [query, setQuery] = useState('')
  const download = useDownload()
  const plays = report.plays.filter(play => [play.title, play.id].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const play = report.plays.find(item => item.id === selected) ?? report.plays[0]
  function choose(id: string) { setSelected(id); onPlayChange?.(id) }
  return <article className={'agent-record research-report research-workspace ' + className} data-theme={theme}>
    <aside className="research-rail">
      <h1>{report.title}</h1>
      <label className="ui-field"><span className="ui-label">Find a play</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name…" /></label>
      <nav className="research-play-list" aria-label="Research plays">{plays.map(item => <button key={item.id} aria-current={item.id === play?.id ? 'page' : undefined} onClick={() => choose(item.id)}>
        <span>{item.title}</span><small>{item.claims.length} results · {item.documents.length} sources</small>
      </button>)}{!plays.length && <p className="small">No matching play.</p>}</nav>
      <details className="research-info"><summary>Report summary and exports</summary>
        <p className="small">{report.summary}</p>
        <p className="small">Authored {utcTime(report.generatedAt, true)}</p>
        {report.freshness && <p className="small">{report.freshness.message}</p>}
        <p className="small">Assessed by {report.assessmentBy ?? 'the report author'}; assessment labels are judgments, not independent verification.</p>
        {report.limitations.length > 0 && <ul>{report.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {report.questionCoverage.length > 0 && <Questions questions={report.questionCoverage} inspect={() => {}} printOnly={false} />}
        <div className="research-exports"><button className="ui-button" onClick={() => download(reportToLatex(report), report.id + '.tex', 'application/x-tex')}>Export LaTeX</button>
          <button className="ui-button" onClick={() => download(JSON.stringify(report, null, 2), report.id + '.json', 'application/json')}>Download data</button>
          <button className="ui-button" onClick={() => window.print()}>Print results</button></div>
      </details>
    </aside>
    {play ? <PlayReport key={play.id} play={play} report={report} theme={theme} initialView={defaultView} initialActivity={defaultActivitySelection} onActivityChange={onActivityChange}
      initialDocument={defaultDocumentSelection?.playId === play.id ? defaultDocumentSelection : undefined}
      onDocumentChange={onDocumentChange} onViewChange={onViewChange} sourceSearchEndpoint={sourceSearchEndpoint} figures={figures} />
      : <p className="chat-empty">No plays were included.</p>}
    <div className="rr-print">{report.plays.map(item => <PlayReport key={item.id} play={item} report={report} theme={theme} printOnly />)}</div>
  </article>
}

function PlayReport({ play, report, theme, printOnly = false, initialDocument, initialView, initialActivity, onActivityChange, onDocumentChange, onViewChange, sourceSearchEndpoint, figures }: {
  play: ResearchPlay; report: ResearchReportData; theme: 'light' | 'dark' | 'auto'; printOnly?: boolean;
  initialDocument?: ResearchDocumentSelection; initialView?: ResearchView; initialActivity?: RecordSelection;
  onActivityChange?: (playId: string, selection: RecordSelection) => void;
  onDocumentChange?: (selection: ResearchDocumentSelection) => void; onViewChange?: (view: ResearchView) => void;
  sourceSearchEndpoint?: string; figures?: Record<string, ReactNode>;
}) {
  const [view, setView] = useState<ResearchView>(initialDocument ? 'sources' : initialView ?? 'results')
  const [selection, setSelection] = useState<RecordSelection | undefined>(initialActivity)
  const [documentSelection, setDocumentSelection] = useState<DocumentSelection | undefined>(initialDocument)
  const uid = useId()
  const download = useDownload()
  // The print copy repeats every play; only the live copy carries the section anchors (`/play/<id>/report#runs`).
  const anchor = (id: string) => (printOnly ? undefined : id)
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
        <p className="small">{play.updatedAt ? `Updated ${utcTime(play.updatedAt, true)}` : 'Update time unknown'} · {play.status ?? 'State unknown'}{play.href && <> · <a href={play.href}>Play page</a></>}</p></div>
        {!printOnly && <button className="ui-button" onClick={() => download(reportToLatex(report, play.id), play.id + '.tex', 'application/x-tex')}>Export</button>}
      </header>
      {!printOnly && <nav className="research-sections" aria-label="Play sections">{(['results', 'activity', 'sources'] as const).map(section => <button key={section} aria-current={view === section ? 'page' : undefined} onClick={() => show(section)}>
        {section[0]!.toUpperCase() + section.slice(1)}{section === 'sources' ? ` · ${play.documents.length}` : ''}
      </button>)}</nav>}
      {(printOnly || view === 'results') && <div className="research-results">
        {play.verdict ? <section className="rr-section rr-lead-verdict" id={anchor('verdict')} data-section="verdict" aria-label="Verdict">
          <h3>Verdict</h3>
          {play.verdict.status && <p className="rr-assessment" data-assessment={play.verdict.status}>{play.verdict.status.replace(/-/g, ' ')}</p>}
          <p className="research-summary">{play.verdict.sentence}</p>
          <Sources sources={play.verdict.evidence} inspect={inspect} printOnly={printOnly} inline />
        </section> : <p className="research-summary">{play.summary}</p>}
        <div className="research-result-list">{play.claims.map(claim => <article className="research-result" key={claim.id}>
          <p className="rr-assessment" data-assessment={claim.status}>{claim.status[0]!.toUpperCase() + claim.status.slice(1)}</p>
          <h3>{typeof claim.title === 'string' ? claim.title : claim.statement}</h3>
          {typeof claim.title === 'string' && <p>{claim.statement}</p>}
          {claim.method && <p className="small">{claim.method}</p>}
          {claim.limitations.length > 0 && <ul className="rr-limitations">{claim.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
          {claim.evidence.length > 0 ? <Sources sources={claim.evidence} inspect={inspect} printOnly={printOnly} /> : <p className="small">Supporting sources not supplied.</p>}
        </article>)}</div>
        {!play.claims.length && !play.questionCoverage.length && <p className="chat-empty">No assessed results supplied.</p>}
        {/* With no assessed claims the questions are the report's answers, so they open. */}
        {play.questionCoverage.length > 0 && <Questions questions={play.questionCoverage} inspect={inspect} printOnly={printOnly} open={!play.claims.length} id={anchor('questions')} />}
        {play.sections?.map(section => <section key={section.id} className="rr-section" id={anchor(section.id)} data-section={section.id} aria-label={section.title}>
          <h3>{section.title}</h3>
          {section.summary && <p>{section.summary}</p>}
          {!printOnly && figures?.[section.id]}
          {play.metrics.some(metric => metric.section === section.id) && <dl className="rr-metrics rr-fact-grid">{play.metrics.filter(metric => metric.section === section.id).map(metric => <Fact key={metric.id} metric={metric} inspect={inspect} printOnly={printOnly} />)}</dl>}
          {play.tables?.filter(table => table.section === section.id).map(table => <Table key={table.id} table={table} inspect={inspect} printOnly={printOnly} />)}
        </section>)}
        {play.runs && play.runs.length > 0 && <Runs runs={play.runs} inspect={inspect} printOnly={printOnly} id={anchor('runs')} />}
        {play.rules && <Rules rules={play.rules} inspect={inspect} printOnly={printOnly} id={anchor('anomalies')} />}
        {play.unknowns && <Unknowns unknowns={play.unknowns} id={anchor('unknowns')} />}
        {play.observations.length > 0 && <details className="research-observations" open={printOnly || undefined}><summary>Checks and next steps</summary>{play.observations.map(item => <article key={item.id}>
          <h3>{item.title}</h3><p>{item.body}</p>{item.evidence.length > 0 && <Sources sources={item.evidence} inspect={inspect} printOnly={printOnly} />}
        </article>)}</details>}
        <details className="research-measurements" open={printOnly || undefined}><summary>Measurements and coverage</summary>
          {play.metrics.some(metric => !metric.section) && <dl className="rr-metrics" aria-label="Recorded measurements">{play.metrics.filter(metric => !metric.section).map(metric => <Fact key={metric.id} metric={metric} inspect={inspect} printOnly={printOnly} />)}</dl>}
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
  open = false,
  id,
}: {
  questions: QuestionCoverage[]
  inspect: (eventId: string) => void
  printOnly: boolean
  open?: boolean
  id?: string
}) {
  return (
    <details className="rr-questions" id={id} open={printOnly || open || undefined}>
      <summary>Questions and answers</summary>
      <dl>
        {questions.map((item) => (
          <div key={item.id} className="rr-question">
            <dt>
              {item.question}
            </dt>
            <dd className="rr-meta">{item.status.replace(/_/g, ' ')}</dd>
            {item.answer ? <dd>{item.answer}</dd> : item.status !== 'observed' && <dd className="rr-unknown">Unknown</dd>}
            {item.why && <dd className="rr-meta">{item.status === 'observed' ? 'Not known: ' : 'Why: '}{item.why}</dd>}
            {item.record && <dd className="rr-meta">Would be answered by: {item.record}</dd>}
            {item.evidence.length > 0 && (
              <dd>
                <Sources
                  sources={item.evidence}
                  inspect={inspect}
                  printOnly={printOnly}
                  inline
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
  inline = false,
}: {
  sources: EvidenceReference[]
  inspect: (eventId: string) => void
  printOnly: boolean
  /** One line per source, shown, for facts; a source with an excerpt or recorded event keeps the full list. */
  inline?: boolean
}) {
  const documents = useContext(DocumentContext)
  if (inline && sources.every((source) => !source.excerpt && !source.eventId))
    return (
      <ul className="rr-source-line">
        {sources.map((source, i) => (
          <li key={i}>
            <span>Source </span>
            {source.label && <strong>{source.label} </strong>}
            {source.url && <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}
            {source.path && <code>{source.path}{source.line ? ':' + source.line : ''}</code>}
            {source.asOf ? <span> · as of {utcTime(source.asOf, true)}</span> : <span> · as-of time not recorded</span>}
          </li>
        ))}
      </ul>
    )
  return (
    <details className="rr-sources" open={printOnly || undefined}>
      <summary>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
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
            {source.asOf && <small>As of {utcTime(source.asOf, true)}</small>}
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

/** One fact: its value with unit, or Unknown with why and the record that would answer it, then its source. */
function Fact({ metric, inspect, printOnly }: { metric: ResearchMetric; inspect: (eventId: string) => void; printOnly: boolean }) {
  const mark = metric.comparable === false ? 'not comparable' : metric.comparable === true ? 'comparable' : null
  const note = mark && metric.note ? metric.note.replace(/^not comparable:\s*/i, '') : metric.note
  return (
    <div data-fact={metric.id} data-unknown={metric.value === null || undefined}>
      <dt>{metric.label}</dt>
      <dd className={metric.value === null ? 'rr-unknown' : undefined}>{metric.value ?? 'Unknown'}{metric.value !== null && metric.unit ? ` ${metric.unit}` : ''}</dd>
      {mark && <small className="rr-comparable" data-comparable={String(metric.comparable)}>{mark}</small>}
      {note && <small>{note}</small>}
      {metric.coverage && <small>{metric.coverage}</small>}
      {metric.value === null && metric.why && <small>Why: {metric.why}</small>}
      {metric.value === null && metric.record && <small>Would be answered by: {metric.record}</small>}
      {metric.source && <Sources sources={[metric.source]} inspect={inspect} printOnly={printOnly} inline />}
    </div>
  )
}

function Table({ table, inspect, printOnly }: { table: ResearchTable; inspect: (eventId: string) => void; printOnly: boolean }) {
  const marked = table.rows.some(row => row.some(cell => cell.comparable === false))
  return (
    <figure className="rr-data-table" data-table={table.id}>
      <figcaption>{table.title}{marked && <span className="small"> · * not comparable with the bar</span>}</figcaption>
      <div className="rr-table-scroll">
        <table>
          <thead><tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={cell.text === null ? 'rr-unknown' : undefined} title={cell.note}>
            {cell.text === null ? 'unknown' : cell.href ? <a href={cell.href}>{cell.text}</a> : cell.text}
            {cell.comparable === false && <span className="rr-comparable" data-comparable="false">*</span>}
            {cell.note && <small>{cell.note}</small>}
          </td>)}</tr>)}</tbody>
        </table>
      </div>
      {table.source && <Sources sources={[table.source]} inspect={inspect} printOnly={printOnly} inline />}
    </figure>
  )
}

/** Each run: its ending, agent-hours stacked by attempt outcome on one shared axis (the play ledger's bar), and its page. */
function Runs({ runs, inspect, printOnly, id }: { runs: ResearchRun[]; inspect: (eventId: string) => void; printOnly: boolean; id?: string }) {
  const total = (run: ResearchRun) => Object.values(run.hoursByOutcome ?? {}).reduce((sum, value) => sum + value, 0)
  const max = Math.max(1, ...runs.map(total))
  const present = OUTCOME_ORDER.filter(outcome => runs.some(run => (run.hoursByOutcome?.[outcome] ?? 0) > 0))
  return (
    <section className="rr-section" id={id} data-section="runs" aria-label="Runs">
      <h3>Runs</h3>
      {present.length > 0 && <OutcomeLegend outcomes={present} />}
      <ol className="rr-runs">{runs.map(run => <li key={run.id} className="rr-run" data-run={run.id}>
        <p className="rr-run-head">
          {run.href ? <a href={run.href}>{run.label}</a> : <strong>{run.label}</strong>}
          <span>{run.ending ?? 'ending unknown'}</span>
          {run.best && <span>best {run.best}</span>}
          <span>{run.cost ?? 'cost unknown'}</span>
          <span>{run.wallHours === null ? 'wall time unknown' : `${run.wallHours} h wall`}</span>
        </p>
        {run.hoursByOutcome && total(run) > 0
          ? <OutcomeBar row={{ hoursByOutcome: run.hoursByOutcome, triesByOutcome: run.triesByOutcome ?? null }} max={max} />
          : <dl className="rr-metrics rr-fact-grid"><Fact metric={run.agentHours} inspect={inspect} printOnly={printOnly} /></dl>}
        {run.hoursByOutcome && total(run) > 0 && run.agentHours.source && <Sources sources={[run.agentHours.source]} inspect={inspect} printOnly={printOnly} inline />}
        {run.reason && <p className="small">{run.reason}</p>}
      </li>)}</ol>
    </section>
  )
}

const RULE_STATE: Record<string, string> = { fired: 'fired', quiet: 'quiet', 'could-not-evaluate': 'could not evaluate' }

/** What looks wrong: every rule with its state, and each instance it fired on with the sentence and source that say why. */
function Rules({ rules, inspect, printOnly, id }: { rules: ResearchRule[]; inspect: (eventId: string) => void; printOnly: boolean; id?: string }) {
  const fired = rules.reduce((sum, rule) => sum + rule.instances.length, 0)
  return (
    <section className="rr-section" id={id} data-section="anomalies" aria-label="Anomalies">
      <h3>Anomalies</h3>
      <p>{fired} {fired === 1 ? 'anomaly' : 'anomalies'} from {rules.filter(rule => rule.instances.length).length} of {rules.length} rules.</p>
      {!rules.length && <p className="chat-empty">No rule was evaluated.</p>}
      <ol className="rr-rules">{rules.map(rule => <li key={rule.id} className="rr-rule" data-rule={rule.id} data-state={rule.state}>
        <p className="rr-rule-head"><span className="rr-assessment" data-rule-state={RULE_STATE[rule.state] ? rule.state : 'unrecognised'}>{RULE_STATE[rule.state] ?? `unrecognised state: ${rule.state}`}</span> <strong>{rule.question}</strong></p>
        <p className="rr-meta"><code>{rule.id}</code>{rule.threshold && <> · threshold {rule.threshold}</>} · {rule.instances.length} fired</p>
        {rule.instances.length > 0 && <ul>{rule.instances.map((instance, i) => <li key={i}>
          <p>{instance.sentence}{instance.value && <span className="rr-meta"> ({instance.value})</span>}</p>
          {instance.evidence.length ? <Sources sources={instance.evidence} inspect={inspect} printOnly={printOnly} inline /> : <p className="rr-meta">Source not recorded.</p>}
        </li>)}</ul>}
      </li>)}</ol>
    </section>
  )
}

function Unknowns({ unknowns, id }: { unknowns: ResearchUnknown[]; id?: string }) {
  return (
    <section className="rr-section" id={id} data-section="unknowns" aria-label="Unknowns">
      <h3>Unknowns</h3>
      {!unknowns.length ? <p>The report lists no unknown field.</p> : <ul className="rr-unknowns">{unknowns.map((item, i) => <li key={i} data-unknown-field={item.field}>
        <code>{item.field}</code> <span className="rr-unknown">unknown</span>
        <p className="rr-meta">Why: {item.why}</p>
        <p className="rr-meta">Would be answered by: {item.record}</p>
      </li>)}</ul>}
    </section>
  )
}
