import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssessmentsDocument, DimensionsDocument } from './assessment.js'
import type { RecordEvent, RecordGap } from './record.js'
import type { PlayDocument, PlayInput, PlaysDocument, RunDocument, RunSummary } from './workspace.js'
import { Conversation } from './viewer/Conversation.js'
import type { EventFlag } from './viewer/Conversation.js'
import { categoryClass, Timeline, UsageChart } from './viewer/Charts.js'
import type { Axis, Metric, PlotTooltip, ShowTooltip } from './viewer/Charts.js'
import { indexRecord, interval, ms, roleOf, textOf, utcTime } from './viewer/model.js'
import type { RecordIndex } from './viewer/model.js'
import { advancePlayback } from './viewer/playback.js'
import { StructuredContent, VerbatimContent } from './viewer/StructuredContent.js'
import { AssessmentMatrix, dimensionMap, flagsFrom, RunAssessments } from './workspace/Assessments.js'
import { duration, go, money, readRecord, stateClass, stateLabel, useDocument, when, writeSearch } from './workspace/data.js'
import { FinalOutputPanel } from './workspace/FinalOutput.js'
import { InputView } from './workspace/InputView.js'
import { LineageGraph, TopologyGraph } from './workspace/RunGraph.js'
import { BreakdownTable, byModel, NodeSpendPanel, SpendBars, SpendSummary } from './workspace/Spend.js'

export interface WorkspaceProps {
  /** Same-origin API root, for example `/api/discovery`. */
  api: string
  mode: 'plays' | 'play' | 'run'
  id: string
  theme?: 'light' | 'dark' | 'auto'
}

/** Play and run pages of a run workspace. Reads only the same-origin API; navigation stays in the host tab. */
export function Workspace({ api, mode, id, theme = 'auto' }: WorkspaceProps) {
  return (
    <div className="agent-record ar-ws" data-theme={theme}>
      {mode === 'plays' ? <PlaysPage api={api} /> : mode === 'play' ? <PlayPage api={api} id={id} /> : <RunPage api={api} id={id} />}
    </div>
  )
}

function useSearch() {
  const [search, setSearch] = useState(() => window.location.search)
  useEffect(() => {
    const changed = () => setSearch(window.location.search)
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  const update = useCallback((patch: Record<string, string | undefined | null>, replace = false) => {
    writeSearch(patch, replace)
    setSearch(window.location.search)
  }, [])
  return [useMemo(() => new URLSearchParams(search), [search]), update] as const
}

function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly (readonly [T, string])[]; value: T; onChange: (tab: T) => void; label: string }) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  return (
    <div className="ui-tabs ws-tabs" role="tablist" aria-label={label}>
      {tabs.map(([tab, title], i) => (
        <button
          key={tab}
          ref={(element) => {
            if (element) refs.current.set(tab, element)
          }}
          type="button"
          role="tab"
          data-tab={tab}
          aria-selected={value === tab}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : undefined
            if (next) {
              event.preventDefault()
              onChange(next[0])
              refs.current.get(next[0])?.focus()
            }
          }}
        >
          {title}
        </button>
      ))}
    </div>
  )
}

function Status({ loading, error, children }: { loading: boolean; error?: string; children?: ReactNode }) {
  if (error) return <p className="ws-status" role="alert">{error}</p>
  if (loading) return <p className="ws-status" role="status">Loading…</p>
  return <>{children}</>
}

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)

// ---------------------------------------------------------------------------------------------------------
// /plays: every play this host has a run of
// ---------------------------------------------------------------------------------------------------------
type PlaySort = 'latest' | 'spend' | 'runs' | 'name'

function PlaysPage({ api }: { api: string }) {
  const [params, update] = useSearch()
  const plays = useDocument<PlaysDocument>(`${api}/plays`)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const query = params.get('q') ?? ''
  const program = params.get('program') ?? ''
  const sort = (['latest', 'spend', 'runs', 'name'] as const).find((value) => value === params.get('sort')) ?? 'latest'
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  const programs = useMemo(() => [...new Set((plays.data?.plays ?? []).map((play) => play.program ?? '').filter(Boolean))].sort(), [plays.data])
  const keys = useMemo(() => new Map((dimensions.data?.dimensions ?? []).map((dimension) => [dimension.id, dimension.key])), [dimensions.data])
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const spent = (spend: PlaysDocument['plays'][number]['spend']) => (spend.paidUsd ?? 0) + (spend.listUsd ?? 0)
    return (plays.data?.plays ?? [])
      .filter((play) => (!program || play.program === program) && (!needle || `${play.id} ${play.title} ${play.program ?? ''} ${play.line ?? ''}`.toLowerCase().includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title)
          : sort === 'spend'
            ? spent(b.spend) - spent(a.spend)
            : sort === 'runs'
              ? b.runCount - a.runCount
              : String(b.latestRun?.startedAt ?? '').localeCompare(String(a.latestRun?.startedAt ?? '')),
      )
  }, [plays.data, query, program, sort])
  return (
    <Status loading={plays.loading} error={plays.error && `Plays are unavailable: ${plays.error}`}>
      <div className="ws-page ws-plays" data-plays>
        <header className="ws-head">
          <div className="ws-title-row">
            <h1>Plays</h1>
          </div>
          <div className="message-filters plays-filters">
            <input
              type="search"
              aria-label="Find a play"
              placeholder="Find a play"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                update({ q: event.target.value || undefined }, true)
              }}
            />
            <select aria-label="Program" value={program} onChange={(event) => update({ program: event.target.value || undefined })}>
              <option value="">All programs</option>
              {programs.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select aria-label="Order" value={sort} onChange={(event) => update({ sort: event.target.value === 'latest' ? undefined : event.target.value })}>
              <option value="latest">Latest run first</option>
              <option value="spend">Most spend first</option>
              <option value="runs">Most runs first</option>
              <option value="name">By name</option>
            </select>
          </div>
        </header>
        <section className="ws-section">
          <div className="table-scroll">
            <table className="data-table runs-table plays-table" data-play-list>
              <thead>
                <tr>
                  <th>Play</th>
                  <th>Program</th>
                  <th>State</th>
                  <th>Latest run</th>
                  <th className="num">Runs</th>
                  <th className="num">Paid</th>
                  <th className="num">List price</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((play) => {
                  const open = () => go(`/play/${encodeURIComponent(play.id)}`)
                  const flags = Object.entries(play.headline).filter(([, value]) => value.polarity === 'bad')
                  return (
                    <tr key={play.id} data-play={play.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
                      <td>
                        <a href={`/play/${encodeURIComponent(play.id)}`} onClick={(event) => event.preventDefault()}>{play.title}</a>
                        {play.title !== play.id && <small className="faint mono"> {play.id}</small>}
                      </td>
                      <td className="mono">{play.program ?? <span className="faint">{play.playBasis}</span>}</td>
                      <td><span className={`state-pill ${stateClass(play.state)}`}>{stateLabel(play.state)}</span></td>
                      <td>
                        {play.latestRun ? (
                          <a
                            className="mono"
                            href={`/run/${encodeURIComponent(play.latestRun.id)}`}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              go(`/run/${encodeURIComponent(play.latestRun!.id)}`)
                            }}
                          >
                            {shortRun(play.id, play.latestRun.id)}
                          </a>
                        ) : '—'}
                        <small className="faint"> {when(play.latestRun?.startedAt)}</small>
                      </td>
                      <td className="num">{play.runCount}</td>
                      <td className={`num ${play.spend.paidUsd === null ? 'unknown' : ''}`}>
                        {money(play.spend.paidUsd)}{!play.spend.paidKnown && play.spend.paidUsd !== null ? '+' : ''}
                      </td>
                      <td className={`num ${play.spend.listUsd === null ? 'unknown' : ''}`}>
                        {money(play.spend.listUsd)}{play.spend.listKnown === false && play.spend.listUsd !== null ? '+' : ''}
                      </td>
                      <td className="headline-cell">
                        {flags.map(([dimension, value]) => (
                          <span key={dimension} className="label-chip polarity-bad" title={`${dimension} ${keys.get(dimension)?.replaceAll('_', ' ') ?? ''}: ${value.label}`}>
                            {dimension} {value.label.replaceAll('_', ' ')}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="chat-empty">No play matches.</p>}
        </section>
      </div>
    </Status>
  )
}

// ---------------------------------------------------------------------------------------------------------
// /play/<id>
// ---------------------------------------------------------------------------------------------------------
type PlayTab = 'input' | 'runs' | 'spend' | 'assessments'

function PlayPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const play = useDocument<PlayDocument>(`${api}/plays/${encodeURIComponent(id)}`)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const tab = (['input', 'runs', 'spend', 'assessments'] as const).find((value) => value === params.get('tab')) ?? 'runs'
  const selectedRun = params.get('run')
  const doc = play.data
  const latestDigest = doc?.input?.digest ?? null
  const runDoc = useDocument<RunDocument>(tab === 'input' && selectedRun && selectedRun !== doc?.input?.runId ? `${api}/runs/${encodeURIComponent(selectedRun)}` : null)
  const input: PlayInput | null = selectedRun && selectedRun !== doc?.input?.runId ? (runDoc.data?.input ?? null) : (doc?.input ?? null)
  const open = (runId: string, dimension?: string) =>
    go(`/run/${encodeURIComponent(runId)}${dimension ? `?tab=assessments&dim=${encodeURIComponent(dimension)}` : ''}`)
  const headlines = useMemo(() => {
    const map = new Map<string, PlayDocument['assessments']>()
    for (const row of doc?.assessments ?? []) map.set(row.runId, [...(map.get(row.runId) ?? []), row])
    return map
  }, [doc])
  return (
    <Status loading={play.loading} error={play.error && `This play is unavailable: ${play.error}`}>
      {doc && (
        <div className="ws-page ws-play" data-play={doc.id}>
          <header className="ws-head">
            <div className="ws-title-row">
              <h1>{doc.title}</h1>
              {doc.runs[0] && <span className={`state-pill ${stateClass(doc.runs[0].state)}`}>{stateLabel(doc.runs[0].state)}</span>}
            </div>
            {(doc.frontier?.statement || doc.charter) && <p className="ws-charter">{doc.frontier?.statement ?? doc.charter}</p>}
            <div className="ws-facts">
              {doc.program && <span><b>Program</b> {doc.program}</span>}
              {doc.line && <span><b>Line</b> {doc.line}</span>}
              {doc.frontier?.target && <span><b>Target</b> {doc.frontier.target}</span>}
              {doc.frontier?.asOf && <span><b>Frontier as of</b> {doc.frontier.asOf}</span>}
              {doc.runs[0] && (
                <span>
                  <b>Latest run</b>{' '}
                  <a href={`/run/${encodeURIComponent(doc.runs[0].id)}`} className="mono">{shortRun(doc.id, doc.runs[0].id)}</a> · {when(doc.runs[0].startedAt)}
                </span>
              )}
            </div>
            <SpendSummary spend={doc.spend} />
          </header>
          <Tabs
            label="Play"
            value={tab}
            onChange={(next) => update({ tab: next === 'runs' ? undefined : next })}
            tabs={[['runs', 'Runs'], ['input', 'Input'], ['spend', 'Spend'], ['assessments', 'Assessments']] as const}
          />
          <div className="ws-content" role="tabpanel">
            {tab === 'runs' && (
              <>
                <section className="ws-section">
                  <LineageGraph play={doc} onOpen={(runId) => open(runId)} />
                </section>
                <section className="ws-section">
                  <RunsTable play={doc} latestDigest={latestDigest} headlines={headlines} headline={dimensions.data ? new Set(dimensions.data.dimensions.filter((item) => item.headline).map((item) => item.id)) : null} onOpen={open} />
                </section>
                {doc.gaps.length > 0 && (
                  <section className="ws-section gaps">
                    <h3>Missing evidence</h3>
                    <ul className="gap-list">
                      {doc.gaps.map((gap, i) => (
                        <li key={i}>
                          <code>{gap.code}</code> {gap.runId && <span className="mono">{shortRun(doc.id, gap.runId)}</span>} {gap.detail}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {tab === 'input' && (
              <section className="ws-section">
                <div className="input-run-picker">
                  <label className="ui-field">
                    <span className="ui-label">Run</span>
                    <select value={selectedRun ?? doc.input?.runId ?? ''} onChange={(event) => update({ run: event.target.value === doc.input?.runId ? undefined : event.target.value })}>
                      {doc.runs.map((run) => (
                        <option key={run.id} value={run.id}>
                          {shortRun(doc.id, run.id)} · {when(run.startedAt)}{run.inputDigest && latestDigest && run.inputDigest !== latestDigest ? ' · different input' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Status loading={runDoc.loading} error={runDoc.error}>
                  <InputView input={input} api={api} changed={!!input && !!latestDigest && input.digest !== latestDigest} />
                </Status>
              </section>
            )}
            {tab === 'spend' && <PlaySpend play={doc} onOpen={open} catalogue={dimensionMap(dimensions.data)} />}
            {tab === 'assessments' && (
              <section className="ws-section">
                <AssessmentMatrix play={doc} dimensions={dimensions.data} onOpen={open} />
              </section>
            )}
          </div>
        </div>
      )}
    </Status>
  )
}

/** One adverse label per headline dimension. */
function adverse(rows: PlayDocument['assessments'], headline: Set<string> | null) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const uncalibrated = row.method === 'systemone' && row.calibrated !== true
    if (row.status !== 'decided' || uncalibrated || row.polarity !== 'bad' || seen.has(row.dimension) || (headline && !headline.has(row.dimension))) return false
    seen.add(row.dimension)
    return true
  })
}

function RunsTable({
  play,
  latestDigest,
  headlines,
  headline,
  onOpen,
}: {
  play: PlayDocument
  latestDigest: string | null
  headlines: Map<string, PlayDocument['assessments']>
  headline: Set<string> | null
  onOpen: (runId: string) => void
}) {
  return (
    <div className="table-scroll">
      <table className="data-table runs-table" data-runs>
        <thead>
          <tr>
            <th>Run</th>
            <th>State</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Agents</th>
            <th className="num">Paid</th>
            <th className="num">List price</th>
            <th>Conversation</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {play.runs.map((run) => (
            <tr
              key={run.id}
              data-run={run.id}
              className="clickable"
              tabIndex={0}
              onClick={() => onOpen(run.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpen(run.id)
              }}
            >
              <td className="mono">
                <a href={`/run/${encodeURIComponent(run.id)}`} onClick={(event) => event.preventDefault()}>{shortRun(play.id, run.id)}</a>
                {run.versions && run.versions.count > 1 && <span className="chip">v{run.versions.count}</span>}
                {run.inputDigest && latestDigest && run.inputDigest !== latestDigest && <span className="chip" title="Input differs from the latest run">input differs</span>}
              </td>
              <td><span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>{run.reason && <small className="faint"> {run.reason}</small>}</td>
              <td>{when(run.startedAt)}</td>
              <td>{duration(run.durationMs)}</td>
              <td>{run.nodes ?? '—'}{run.depth !== null && run.nodes ? <small className="faint"> depth {run.depth}</small> : null}</td>
              <td className={`num ${run.spend.paidUsd === null ? 'unknown' : ''}`} title={!run.spend.paidKnown && run.spend.paidUsd !== null ? 'Paid is not fully known' : undefined}>
                {money(run.spend.paidUsd)}{!run.spend.paidKnown && run.spend.paidUsd !== null ? '+' : ''}
              </td>
              <td className={`num ${run.spend.listUsd === null ? 'unknown' : ''}`} title={run.spend.listKnown === false ? 'Usage of some agents is unknown' : undefined}>
                {money(run.spend.listUsd)}{run.spend.listKnown === false && run.spend.listUsd !== null ? '+' : ''}
              </td>
              <td>
                {run.record.capture ? (
                  <CaptureBar capture={run.record.capture} />
                ) : (
                  <span className={`faint ${stateClass(run.record.status)}`}>{run.record.status}</span>
                )}
              </td>
              <td className="headline-cell">
                {adverse(headlines.get(run.id) ?? [], headline).map((row) => (
                  <span key={row.dimension} className="label-chip polarity-bad" title={`${row.dimension}: ${row.label}`}>
                    {row.dimension} {row.label.replaceAll('_', ' ')}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CaptureBar({ capture }: { capture: { complete: number; lossy: number; absent: number } }) {
  const total = Math.max(1, capture.complete + capture.lossy + capture.absent)
  return (
    <span className="capture-bar" title={`complete ${capture.complete} · lossy ${capture.lossy} · absent ${capture.absent}`}>
      <i className="complete" style={{ width: `${(capture.complete / total) * 100}%` }} />
      <i className="lossy" style={{ width: `${(capture.lossy / total) * 100}%` }} />
      <i className="absent" style={{ width: `${(capture.absent / total) * 100}%` }} />
    </span>
  )
}

/** A waste dimension by its id and name: E3 polling. */
const wasteLabel = (dimension: string, catalogue: ReturnType<typeof dimensionMap>) =>
  `${dimension} ${catalogue.get(dimension)?.key.replaceAll('_', ' ') ?? ''}`.trim()

function PlaySpend({ play, onOpen, catalogue }: { play: PlayDocument; onOpen: (runId: string) => void; catalogue: ReturnType<typeof dimensionMap> }) {
  return (
    <div className="ws-section spend-view">
      <SpendSummary spend={play.spend} />
      <h3>By run</h3>
      <SpendBars
        rows={play.runs.map((run) => ({ label: shortRun(play.id, run.id), paid: run.spend.paidUsd, list: run.spend.listUsd, paidKnown: run.spend.paidKnown, listKnown: run.spend.listKnown, href: run.id }))}
        onOpen={(row) => row.href && onOpen(row.href)}
      />
      {byModel(play.spend).length > 0 && (
        <>
          <h3>By model</h3>
          <SpendBars rows={byModel(play.spend)} />
        </>
      )}
      <div className="breakdown-grid">
        <BreakdownTable title="By activity" rows={(play.spend.byCategory ?? []).map((row) => ({ ...row, label: row.category }))} />
        <BreakdownTable title="Waste" rows={(play.spend.waste ?? []).map((row) => ({ ...row, label: wasteLabel(row.dimension, catalogue) }))} />
      </div>
      {play.spend.gaps.length > 0 && (
        <>
          <h3>Unknown spend</h3>
          <ul className="gap-list">
            {play.spend.gaps.map((gap, i) => <li key={i}><code>{gap.code}</code> {gap.runId && <span className="mono">{shortRun(play.id, gap.runId)}</span>} {gap.detail}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------
// /run/<id>
// ---------------------------------------------------------------------------------------------------------
const SPEEDS = [1, 4, 16, 64, 256, 1024, 4096]
type RunTab = 'messages' | 'timeline' | 'usage' | 'spend' | 'assessments' | 'input' | 'coverage'
const RUN_TABS = [
  ['messages', 'Messages'],
  ['timeline', 'Timeline'],
  ['usage', 'Usage'],
  ['spend', 'Spend'],
  ['assessments', 'Assessments'],
  ['input', 'Input'],
  ['coverage', 'Coverage'],
] as const

function RunPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const [poll, setPoll] = useState<number | undefined>(undefined)
  const runUrl = `${api}/runs/${encodeURIComponent(id)}`
  const run = useDocument<RunDocument>(runUrl, poll)
  // A live run's record digest changes every few seconds; a new digest refetches the record, so this sets the delay.
  useEffect(() => setPoll(run.data?.live.polling ? 3_000 : undefined), [run.data?.live.polling])
  const digest = run.data?.run.record.digest ?? null
  const recordReady = run.data?.run.record.status === 'ready' || !!digest
  // A run being written gets a new record digest every few seconds: the page keeps the last record until the next one lands.
  const recordDoc = useDocument<unknown>(recordReady ? `${runUrl}/record${digest ? `?digest=${digest}` : ''}` : null, undefined, true)
  const assessments = useDocument<AssessmentsDocument>(`${runUrl}/assessments${digest ? `?digest=${digest}` : ''}`, undefined, true)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const parsed = useMemo(() => {
    if (!recordDoc.data) return { record: null, error: undefined as string | undefined }
    try {
      return { record: readRecord(recordDoc.data), error: undefined }
    } catch (error) {
      return { record: null, error: error instanceof Error ? error.message : 'Invalid record' }
    }
  }, [recordDoc.data])
  const index = useMemo(() => (parsed.record ? indexRecord(parsed.record) : null), [parsed.record])
  const summary = run.data?.run
  if (run.error && !run.data) return <p className="ws-status" role="alert">This run is unavailable: {run.error}</p>
  if (!summary) return <p className="ws-status" role="status">Loading…</p>
  return (
    <div className="ws-page ws-run" data-run={summary.id}>
      <FinalOutputPanel output={run.data!.finalOutput} />
      <RunHeader doc={run.data!} />
      {index ? (
        <RunBody
          api={api}
          doc={run.data!}
          index={index}
          params={params}
          update={update}
          assessments={assessments.data}
          dimensions={dimensions.data}
          gaps={parsed.record?.coverage.gaps ?? []}
        />
      ) : (
        <div className="ws-section">
          {recordDoc.loading ? (
            <p className="ws-status" role="status">Loading the record…</p>
          ) : (
            <div className="record-missing" data-record-status={summary.record.status}>
              <h3>No conversation record</h3>
              <p>
                {summary.record.status === 'missing'
                  ? 'No run directory or archive holds this run.'
                  : summary.record.status === 'building'
                    ? 'The record is being built.'
                    : summary.record.status === 'archived'
                      ? 'The run is archived and not yet converted.'
                      : 'The record could not be built.'}
                {summary.record.reason ? ` ${summary.record.reason}` : ''}
                {parsed.error ? ` ${parsed.error}` : ''}
                {recordDoc.error && !summary.record.reason ? ` ${recordDoc.error}` : ''}
              </p>
              <RunExtras api={api} doc={run.data!} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RunHeader({ doc }: { doc: RunDocument }) {
  const run = doc.run
  return (
    <header className="ws-head">
      <div className="ws-title-row">
        <h1 className="mono">
          <a className="crumb" href={`/play/${encodeURIComponent(run.play)}`}>{run.play}</a>
          <span className="crumb-sep" aria-hidden="true"> / </span>
          {shortRun(run.play, run.id)}
        </h1>
        {run.kind !== 'run' && <span className="chip">{run.kind}</span>}
        <span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>
        {run.reason && <span className="faint">{run.reason}</span>}
      </div>
      <div className="ws-facts">
        <span><b>Started</b> {when(run.startedAt)}</span>
        <span><b>Settled</b> {when(run.settledAt)}</span>
        <span><b>Duration</b> {duration(run.durationMs)}</span>
        {run.nodes !== null && <span><b>Agents</b> {run.nodes}{run.depth !== null ? ` to depth ${run.depth}` : ''}</span>}
        {run.models.length > 0 && <span><b>Models</b> <span className="mono">{run.models.join(', ')}</span></span>}
        {run.harnesses.length > 0 && <span><b>Harness</b> {run.harnesses.join(', ')}</span>}
        {run.record.capture && (
          <span title="Conversation capture per agent: complete, lossy, absent">
            <b>Capture</b> <CaptureBar capture={run.record.capture} />
          </span>
        )}
        {doc.live.mirrorAt && <span className="live"><b>Mirror</b> {when(doc.live.mirrorAt)}{doc.live.polling ? ' · updating' : ''}</span>}
        {run.predecessor && <span><b>Continues</b> <a className="mono" href={`/run/${encodeURIComponent(run.predecessor)}`}>{shortRun(run.play, run.predecessor)}</a></span>}
        {run.supersedes && <span><b>Supersedes</b> <a className="mono" href={`/run/${encodeURIComponent(run.supersedes)}`}>{shortRun(run.play, run.supersedes)}</a></span>}
      </div>
      <SpendSummary spend={doc.spend} />
    </header>
  )
}

/** Spend, input and gaps for a run without a record. */
function RunExtras({ api, doc }: { api: string; doc: RunDocument }) {
  return (
    <>
      {doc.run.keys.length > 0 && (
        <table className="data-table">
          <thead><tr><th>Run key</th><th className="num">Spent</th><th className="num">Cap</th></tr></thead>
          <tbody>
            {doc.run.keys.map((key) => (
              <tr key={key.id}>
                <td className="mono">{key.id} <small className="faint">{key.name}</small></td>
                <td className="num">{money(key.spentUsd)}</td>
                <td className="num">{money(key.capUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.values(doc.spend.nodes).some((spend) => spend.sandboxes.length > 0) && (
        <table className="data-table">
          <thead><tr><th>Sandbox</th><th className="num">Paid</th><th className="num">Cost basis</th><th className="num">Hours</th></tr></thead>
          <tbody>
            {Object.entries(doc.spend.nodes).flatMap(([node, spend]) => spend.sandboxes.map((box) => (
              <tr key={`${node}:${box.id}`}>
                <td className="mono">{box.id}</td>
                <td className="num">{money(box.usd)}</td>
                <td className="num">{money(box.costBasisUsd)}</td>
                <td className="num">{box.hours === null ? 'unknown' : box.hours.toFixed(2)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
      {doc.spend.gaps.length > 0 && (
        <ul className="gap-list">{doc.spend.gaps.map((gap, i) => <li key={i}><code>{gap.code}</code> {gap.detail}</li>)}</ul>
      )}
      {doc.input && <InputView input={doc.input} api={api} />}
    </>
  )
}

function RunBody({
  api,
  doc,
  index,
  params,
  update,
  assessments,
  dimensions,
  gaps,
}: {
  api: string
  doc: RunDocument
  index: RecordIndex
  params: URLSearchParams
  update: (patch: Record<string, string | undefined | null>, replace?: boolean) => void
  assessments: AssessmentsDocument | undefined
  dimensions: DimensionsDocument | undefined
  gaps: RecordGap[]
}) {
  const runId = doc.run.id
  const tab = (RUN_TABS.map(([value]) => value) as RunTab[]).find((value) => value === params.get('tab')) ?? 'messages'
  const requestedEvent = params.get('event') ? index.byEvent.get(params.get('event')!) : undefined
  const requestedNode = params.get('node')
  const actor = requestedEvent
    ? index.canonical(requestedEvent.node)
    : requestedNode && index.nodes.has(index.canonical(requestedNode))
      ? index.canonical(requestedNode)
      : (index.actors.find((node) => node.parent === null && node.kind === 'agent')?.id ?? index.actors[0]?.id ?? '')
  const node = index.nodes.get(actor)
  const at = params.get('t')
  const cutoff = at && Number.isFinite(ms(at)) ? Math.max(index.start, Math.min(index.end, ms(at))) : index.end
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  // Real multiples of recorded time; the default plays the whole run in about two minutes.
  const [speed, setSpeed] = useState(() => String(SPEEDS.find((value) => (index.end - index.start) / value <= 120_000) ?? SPEEDS.at(-1)))
  const [zoom, setZoom] = useState(1)
  const [metric, setMetric] = useState<Metric>('cumulative')
  const [axis, setAxis] = useState<Axis>('time')
  const [tooltip, setTooltip] = useState<PlotTooltip | null>(null)
  const [detail, setDetail] = useState<{ event: RecordEvent; sha?: string } | null>(null)
  const nodeCapture = node?.capture as { channel?: string; status?: string; reason?: string | null } | undefined
  const conversationless = !(index.byActor.get(actor) ?? []).some((event) => event.category !== 'lifecycle' && event.detail.lifecycle === undefined)
  const [lifecycleChoice, setLifecycle] = useState<boolean | null>(null)
  const lifecycle = lifecycleChoice ?? conversationless
  // A call without a result is pending while the run is being mirrored and this agent has not settled.
  const live = !!doc.live.polling && (!node?.status || /^(running|pending|active|live|started|spawned|paused|waiting)$/i.test(node.status))
  const catalogue = useMemo(() => dimensionMap(dimensions), [dimensions])
  const flags = useMemo(() => flagsFrom(assessments?.rows ?? [], catalogue), [assessments, catalogue])
  const latest = useRef({ cutoff, index, update })
  latest.current = { cutoff, index, update }

  const select = (patch: Record<string, string | undefined | null>, replace = false) => update(patch, replace)
  const selectNode = (id: string) => {
    setPlaying(false)
    select({ node: id, event: undefined })
  }
  const inspect = (event: RecordEvent, source = false) => {
    setPlaying(false)
    setTooltip(null)
    if (source) setDetail({ event })
    select({ node: index.canonical(event.node), event: event.id, ...(ms(event.at) > cutoff ? { t: undefined } : {}) })
  }
  const cite = (eventId: string) => {
    const event = index.byEvent.get(eventId)
    if (!event) return
    setPlaying(false)
    select({ node: index.canonical(event.node), event: eventId, tab: undefined, t: undefined })
  }
  const loadSource = useCallback(
    async (sha: string) => {
      const response = await fetch(`${api}/runs/${encodeURIComponent(runId)}/source/${sha}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(response.status === 409 ? 'The source no longer matches its recorded hash.' : `Source unavailable (HTTP ${response.status})`)
      return response.text()
    },
    [api, runId],
  )
  const showTooltip: ShowTooltip = (target, title, lines) => {
    const box = target.currentTarget.getBoundingClientRect()
    const x = Math.max(8, Math.min(box.left + box.width / 2, window.innerWidth - 361))
    const y = box.top > window.innerHeight / 2 ? Math.max(8, box.top - 12) : box.bottom + 10
    setTooltip({ title, lines, x, y })
  }
  const hideTooltip = () => setTooltip(null)
  const visible = useMemo(
    () => index.events.filter((event) => category === 'all' || event.category === category),
    [index, category],
  )
  const navigate = (direction: number) => {
    const lane = (index.byActor.get(actor) ?? []).filter((event) => ms(event.at) <= cutoff)
    if (!lane.length) return
    const position = lane.findIndex((event) => event.id === params.get('event'))
    const next = lane[position < 0 ? (direction > 0 ? 0 : lane.length - 1) : (position + direction + lane.length) % lane.length]!
    inspect(next)
  }

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const current = latest.current
      const now = performance.now()
      const next = advancePlayback({
        cutoff: current.cutoff,
        start: current.index.start,
        end: current.index.end,
        elapsedMs: now - previous,
        speed: Number(speed),
        mode: 'rate',
        eventTimes: [],
      })
      previous = now
      current.update({ t: next >= current.index.end ? undefined : new Date(next).toISOString() }, true)
      if (next >= current.index.end) setPlaying(false)
    }, 150)
    const stop = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [playing, speed])

  const categories = useMemo(() => [...new Set(index.events.map((event) => event.category))].sort(), [index])
  const listFromRecord = useMemo(() => {
    let total: number | null = null
    for (const event of index.byActor.get(actor) ?? [])
      if (typeof event.detail.costListUsd === 'number') total = (total ?? 0) + event.detail.costListUsd
    return total
  }, [index, actor])
  const position = index.end > index.start ? ((cutoff - index.start) / (index.end - index.start)) * 1000 : 1000
  const role = roleOf(node)
  const model = node?.servedModel ? `${node.servedModel}` : node?.model ? `${node.model} (declared)` : null
  return (
    <div className="ws-body" onScrollCapture={hideTooltip}>
      <section className="ws-topology" aria-label="Agents">
        <TopologyGraph index={index} cutoff={cutoff} selected={actor} onSelect={selectNode} nodeSpend={doc.spend.nodes} />
        <div className="replay" data-replay>
          <button
            type="button"
            className="ui-button"
            data-play
            disabled={index.end <= index.start}
            onClick={() => {
              if (!playing && cutoff >= index.end) select({ t: new Date(index.start).toISOString() }, true)
              setPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <select aria-label="Replay speed, as a multiple of recorded time" title="Multiple of recorded time" value={speed} onChange={(event) => setSpeed(event.target.value)} data-speed>
            {SPEEDS.map((value) => <option key={value} value={String(value)}>{value}×</option>)}
          </select>
          <input
            type="range"
            min={0}
            max={1000}
            value={position}
            aria-label="Recorded time"
            aria-valuetext={utcTime(new Date(cutoff).toISOString(), true)}
            data-cursor
            onChange={(event) => {
              setPlaying(false)
              const value = index.start + ((index.end - index.start) * Number(event.target.value)) / 1000
              select({ t: Number(event.target.value) >= 1000 ? undefined : new Date(value).toISOString() }, true)
            }}
          />
          <output data-clock>
            {interval(cutoff - index.start)} <small>{utcTime(new Date(cutoff).toISOString())}</small>
          </output>
          <button type="button" className="ui-button" data-full disabled={cutoff >= index.end} onClick={() => { setPlaying(false); select({ t: undefined }, true) }}>
            Full run
          </button>
        </div>
      </section>
      <section className="ws-panel" aria-label="Agent record">
        <div className="agent-head">
          <div className="agent-identity">
            <span className={`agent-avatar ${node?.status === 'done' ? 'state-ok' : node?.status === 'down' ? 'state-fail' : ''}`} aria-hidden="true">
              {role.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h2 data-agent-title>{node?.label ?? actor}</h2>
              <p className="agent-meta">
                {[role, model, node?.harness as string | undefined, node?.status ?? 'no terminal state'].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="agent-capture" data-capture={nodeCapture?.status}>
            <span className={`capture-chip capture-${nodeCapture?.status ?? 'unknown'}`}>
              {nodeCapture?.status === 'complete' ? 'Complete conversation' : nodeCapture?.status === 'lossy' ? 'Partial conversation' : nodeCapture?.status === 'absent' ? 'No conversation' : 'Capture unknown'}
            </span>
            <span className="faint mono">{nodeCapture?.channel}{nodeCapture?.reason ? ` · ${nodeCapture.reason}` : ''}</span>
          </div>
        </div>
        {node?.assignment && (
          <details className="agent-assignment">
            <summary>Assignment</summary>
            <StructuredContent text={node.assignment} />
          </details>
        )}
        <Tabs label="Run record" value={tab} onChange={(next) => select({ tab: next === 'messages' ? undefined : next })} tabs={RUN_TABS} />
        <div className="ws-panel-body" role="tabpanel">
          {tab === 'messages' && (
            <>
              <div className="message-filters">
                <select aria-label="Activity type" value={category} onChange={(event) => setCategory(event.target.value)} data-category>
                  <option value="all">All activity</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <input type="search" aria-label="Search this agent" placeholder="Search this agent" value={query} onChange={(event) => setQuery(event.target.value)} />
                <label className="toggle">
                  <input type="checkbox" checked={lifecycle} onChange={(event) => setLifecycle(event.target.checked)} data-lifecycle />
                  Lifecycle
                </label>
              </div>
              <Conversation
                index={index}
                actor={actor}
                cutoff={cutoff}
                query={query.trim().toLowerCase()}
                category={category}
                selected={params.get('event') ?? undefined}
                inspect={inspect}
                openSource={(sha, event) => {
                  setPlaying(false)
                  setDetail({ event, sha })
                }}
                flags={flags}
                lifecycle={lifecycle}
                live={live}
                onFlag={(flag: EventFlag) => select({ tab: 'assessments', dim: flag.dimension })}
              />
            </>
          )}
          {tab === 'timeline' && (
            <div className="timeline-tab">
              <div className="message-filters">
                <select aria-label="Activity type" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="all">All activity</option>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <label className="toggle">Zoom <input type="range" min={1} max={8} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              </div>
              <Timeline
                index={index}
                events={visible}
                cutoff={cutoff}
                selected={params.get('event') ?? undefined}
                zoom={zoom}
                inspect={inspect}
                navigate={navigate}
                showTooltip={showTooltip}
                hideTooltip={hideTooltip}
                marks={flags}
              />
              <div className="legend">
                {categories.map((item) => <span key={item}><i className={`category-${categoryClass(item)}`} />{item}</span>)}
              </div>
            </div>
          )}
          {tab === 'usage' && (
            <div className="usage-tab">
              <div className="message-filters">
                <select aria-label="Measure" value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>
                  <option value="cumulative">Cumulative tokens</option>
                  <option value="response">Tokens per response</option>
                  <option value="tool-time">Tool return time</option>
                </select>
                <select aria-label="Horizontal axis" value={axis} onChange={(event) => setAxis(event.target.value as Axis)}>
                  <option value="time">Elapsed time</option>
                  <option value="order">Recorded order</option>
                </select>
              </div>
              <UsageChart index={index} cutoff={cutoff} actor={actor} metric={metric} axis={axis} inspect={inspect} navigate={navigate} showTooltip={showTooltip} hideTooltip={hideTooltip} />
              {listFromRecord !== null && <p className="small">Recorded usage prices at {money(listFromRecord)} list, not billed.</p>}
            </div>
          )}
          {tab === 'spend' && (
            <div className="spend-tab">
              <NodeSpendPanel spend={doc.spend.nodes[actor]} listFromRecord={listFromRecord} />
              <h3>Agents in this run</h3>
              <SpendBars
                rows={index.actors
                  .filter((item) => item.kind !== 'finding')
                  .map((item) => {
                    const spend = doc.spend.nodes[item.id]
                    return { label: item.label, paid: spend?.paidUsd ?? null, list: spend?.listUsd ?? null, paidKnown: spend?.paidKnown, listKnown: spend?.listKnown, href: item.id }
                  })}
                onOpen={(row) => row.href && selectNode(row.href)}
              />
              {byModel(doc.spend).length > 0 && (
                <>
                  <h3>By model</h3>
                  <SpendBars rows={byModel(doc.spend)} />
                </>
              )}
              <div className="breakdown-grid">
                <BreakdownTable title="By activity" rows={(doc.spend.byCategory ?? []).map((row) => ({ ...row, label: row.category }))} />
                <BreakdownTable title="Waste" rows={(doc.spend.waste ?? []).map((row) => ({ ...row, label: wasteLabel(row.dimension, catalogue) }))} />
              </div>
            </div>
          )}
          {tab === 'assessments' && (
            <RunAssessments doc={assessments} dimensions={dimensions} index={index} node={actor} focus={params.get('dim')} onFocus={(dimension) => select({ dim: dimension }, true)} onCite={cite} />
          )}
          {tab === 'input' && <InputView input={doc.input} api={api} />}
          {tab === 'coverage' && <Coverage index={index} doc={doc} gaps={gaps} onSelect={selectNode} />}
        </div>
      </section>
      {detail && (
        <EventDetail
          key={`${detail.event.id}:${detail.sha ?? ''}`}
          event={detail.event}
          full={detail.sha}
          index={index}
          onClose={() => setDetail(null)}
          load={loadSource}
        />
      )}
      {tooltip && (
        <div className="ui-plot-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y, transform: tooltip.y > window.innerHeight / 2 ? 'translateY(-100%)' : undefined }}>
          <strong>{tooltip.title}</strong>
          {tooltip.lines.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}
    </div>
  )
}

function Coverage({ index, doc, gaps: recordGaps, onSelect }: { index: RecordIndex; doc: RunDocument; gaps: RecordGap[]; onSelect: (id: string) => void }) {
  const gaps = [...recordGaps, ...doc.spend.gaps]
  return (
    <div className="coverage-tab" data-coverage>
      <table className="data-table">
        <thead>
          <tr><th>Agent</th><th>Channel</th><th>Capture</th><th>Reason</th><th>Status</th></tr>
        </thead>
        <tbody>
          {index.actors.filter((node) => node.kind !== 'finding').map((node) => {
            const capture = node.capture
            return (
              <tr key={node.id} className="clickable" onClick={() => onSelect(node.id)}>
                <td className="mono">{node.label}</td>
                <td className="mono">{capture?.channel ?? '—'}</td>
                <td><span className={`capture-chip capture-${capture?.status ?? 'unknown'}`}>{capture?.status ?? 'unknown'}</span></td>
                <td className="mono faint">{capture?.reason ?? ''}</td>
                <td>{node.status ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {gaps.length > 0 && (
        <>
          <h3>Missing evidence</h3>
          <ul className="gap-list">
            {gaps.map((gap, i) => (
              <li key={i}>
                <code>{gap.code}</code> {gap.nodeId && <span className="mono">{index.nodes.get(gap.nodeId)?.label ?? gap.nodeId}</span>} {gap.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function EventDetail({
  event,
  full,
  index,
  onClose,
  load,
}: {
  event: RecordEvent
  /** Source hash of a clipped body to show in full. */
  full?: string
  index: RecordIndex
  onClose: () => void
  load: (sha: string) => Promise<string>
}) {
  const [raw, setRaw] = useState<{ text?: string; error?: string }>({})
  const [whole, setWhole] = useState<{ text?: string; error?: string }>({})
  const source = event.source as { path?: string; sha256?: string; line?: number; pointer?: string } | null | undefined
  useEffect(() => {
    if (!full) return
    load(full)
      .then((text) => setWhole({ text }))
      .catch((error: unknown) => setWhole({ error: error instanceof Error ? error.message : 'Unavailable' }))
  }, [full, load])
  const loadLine = (sha: string, line?: number) => load(`${sha}${line ? `?line=${line}` : ''}`)
  useEffect(() => {
    const close = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <aside className="event-detail" role="dialog" aria-label="Event details" data-event-detail={event.id}>
      <header>
        <div>
          <h3>{event.label}</h3>
          <p className="faint mono">
            {utcTime(event.at, true)} · {index.nodes.get(index.canonical(event.node))?.label ?? event.node} · {event.category}
          </p>
        </div>
        <button type="button" className="ui-button" onClick={onClose}>Close</button>
      </header>
      <p className="mono faint event-id">{event.id}</p>
      {full ? (
        <section className="event-full" data-full-output={whole.text !== undefined ? full : undefined}>
          <h4>Full output</h4>
          <p className="mono faint">sha256 {full}</p>
          {whole.error && <p role="alert">{whole.error}</p>}
          {whole.text === undefined && !whole.error && <p className="faint">Loading…</p>}
          {whole.text !== undefined && <VerbatimContent text={whole.text} rawLabel="Original bytes" />}
        </section>
      ) : (
        textOf(event) && (event.detail.toolCallId !== undefined || event.category === 'lifecycle' ? <VerbatimContent text={textOf(event)} /> : <StructuredContent text={textOf(event)} />)
      )}
      <details className="raw-data" open={!full}>
        <summary>Recorded detail</summary>
        <pre>{JSON.stringify(event.detail, null, 2)}</pre>
      </details>
      {source?.path && (
        <section className="event-source">
          <h4>Source</h4>
          <p className="mono">
            {source.path}
            {source.line ? `:${source.line}` : ''}
            {source.pointer ? `#${source.pointer}` : ''}
          </p>
          {source.sha256 && <p className="mono faint">sha256 {source.sha256}</p>}
          {source.sha256 && source.line && raw.text === undefined && (
            <button
              type="button"
              className="ui-button"
              onClick={() =>
                loadLine(source.sha256!, source.line)
                  .then((text) => setRaw({ text }))
                  .catch((error: unknown) => setRaw({ error: error instanceof Error ? error.message : 'Unavailable' }))
              }
            >
              Original line
            </button>
          )}
          {raw.error && <p role="alert">{raw.error}</p>}
          {raw.text !== undefined && <VerbatimContent text={raw.text} rawLabel="Original bytes" />}
        </section>
      )}
    </aside>
  )
}

