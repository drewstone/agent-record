import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssessmentsDocument, DimensionsDocument } from './assessment.js'
import type { RecordEvent, RecordGap } from './record.js'
import { AgentFindings, RunFindings } from './workspace/Findings.js'
import { WorkGraph } from './workspace/WorkGraph.js'
import { FeedCards, FindingsFeed } from './workspace/FindingsFeed.js'
import { PlayCharts } from './workspace/PlayCharts.js'
import { OverviewPage } from './workspace/Overview.js'
import { RunVersions } from './workspace/VersionGraph.js'
import type { PlayDocument, PlayInput, PlaysDocument, ProfileGraphDocument, RunDocument, RunSummary } from './workspace.js'
import { Conversation } from './viewer/Conversation.js'
import { withPrompts } from './viewer/prompts.js'
import type { EventFlag } from './viewer/Conversation.js'
import { categoryClass, Timeline, UsageChart } from './viewer/Charts.js'
import type { Axis, Metric, PlotTooltip, ShowTooltip } from './viewer/Charts.js'
import { agentState, indexRecord, interval, measuredUsage, ms, roleOf, textOf, utcTime } from './viewer/model.js'
import type { RecordIndex } from './viewer/model.js'
import { advancePlayback } from './viewer/playback.js'
import { StructuredContent, VerbatimContent } from './viewer/StructuredContent.js'
import { AssessmentMatrix, dimensionMap, flagsFrom, RunAssessments } from './workspace/Assessments.js'
import { duration, go, money, readRecord, stateClass, stateLabel, useDocument, when, writeSearch } from './workspace/data.js'
import { FinalOutputPanel } from './workspace/FinalOutput.js'
import { InputView } from './workspace/InputView.js'
import { OutputsView } from './workspace/Outputs.js'
import { ReliabilityPanel } from './workspace/Reliability.js'
import { Searches } from './workspace/SearchView.js'
import { HIDDEN_LABEL, HIDDEN_ORDER, splitHidden, splitRuns } from './workspace/plays-filter.js'
import type { HiddenReason } from './workspace/plays-filter.js'
import { findProfile, profileGraph, runOfProfile } from './workspace/profile-graph.js'
import { versionsOf } from './workspace/profile-compare.js'
import { AgentTable, AnswerStrip } from './workspace/RunTable.js'
import { RunProgressView } from './workspace/RunProgress.js'
import type { NodeStats } from './workspace/RunTable.js'
import { Inspector, VersionCanvas } from './workspace/VersionCanvas.js'
import { ProfileCanvas } from './workspace/ProfileCanvas.js'
import type { Selection } from './workspace/VersionCanvas.js'
import { BreakdownTable, byModel, NodeSpendPanel, SeatWeeksPanel, SpendBars, SpendSummary, spendGapLabel } from './workspace/Spend.js'

export interface WorkspaceProps {
  /** Same-origin API root, for example `/api/discovery`. */
  api: string
  mode: 'plays' | 'play' | 'run' | 'overview'
  id: string
  theme?: 'light' | 'dark' | 'auto'
}

/** Play and run pages of a run workspace. Reads only the same-origin API; navigation stays in the host tab. */
export function Workspace({ api, mode, id, theme = 'auto' }: WorkspaceProps) {
  return (
    <div className="agent-record ar-ws" data-theme={theme}>
      {mode === 'overview' ? <OverviewPage api={api} /> : mode === 'plays' ? <PlaysPage api={api} /> : mode === 'play' ? <PlayPage api={api} id={id} /> : <RunPage api={api} id={id} />}
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

/**
 * What the default filter holds back, said where it is seen first: failed runs are a health signal, not noise, so the
 * failed count leads in the failure colour. `noun` names what is counted (plays or runs).
 */
function HiddenSummary({ counts, total, noun, showHidden, onChange }: { counts: Record<HiddenReason, number>; total: number; noun: string; showHidden: boolean; onChange: (all: boolean) => void }) {
  const hidden = HIDDEN_ORDER.reduce((sum, reason) => sum + counts[reason], 0)
  if (!hidden) return null
  return (
    <div className="hidden-summary" data-hidden-summary>
      <span>
        <b>{hidden}</b> of {total} {noun} {showHidden ? 'shown that the default view hides' : 'hidden'}:{' '}
        {HIDDEN_ORDER.filter((reason) => counts[reason] > 0).map((reason, i) => (
          <span key={reason} className={reason === 'failed' ? 'hidden-failed' : undefined}>
            {i > 0 && ' · '}
            {counts[reason]} {reason === 'failed' && noun === 'plays' ? 'whose runs all failed' : HIDDEN_LABEL[reason]}
          </span>
        ))}
      </span>
      <label className="toggle hidden-filter">
        <input type="checkbox" checked={showHidden} onChange={(event) => onChange(event.target.checked)} data-show-hidden />
        Show them
      </label>
    </div>
  )
}

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
  const showHidden = params.get('show') === 'all'
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  const programs = useMemo(() => [...new Set((plays.data?.plays ?? []).map((play) => play.program ?? '').filter(Boolean))].sort(), [plays.data])
  const keys = useMemo(() => new Map((dimensions.data?.dimensions ?? []).map((dimension) => [dimension.id, dimension.key])), [dimensions.data])
  const { rows, hidden } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const spent = (spend: PlaysDocument['plays'][number]['spend']) => (spend.apiUsd ?? 0) + (spend.sandboxUsd ?? 0)
    const matching = (plays.data?.plays ?? []).filter(
      (play) => (!program || play.program === program) && (!needle || `${play.id} ${play.title} ${play.program ?? ''} ${play.line ?? ''}`.toLowerCase().includes(needle)),
    )
    // Plays whose every run is a test, a failure or archived stay out of view until asked for, and are counted by reason.
    const { shown, counts, hidden } = splitHidden(matching, showHidden)
    const rows = shown
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title)
          : sort === 'spend'
            ? spent(b.spend) - spent(a.spend)
            : sort === 'runs'
              ? b.runCount - a.runCount
              : String(b.latestRun?.startedAt ?? '').localeCompare(String(a.latestRun?.startedAt ?? '')),
      )
    return { rows, hidden: { plays: hidden, counts, total: matching.length } }
  }, [plays.data, query, program, sort, showHidden])
  const home = (['plays', 'findings', 'runs'] as const).find((value) => value === params.get('view')) ?? 'plays'
  const sharedFilters = <div className="message-filters plays-filters" aria-label="Research filters">
    <input type="search" aria-label="Search research" placeholder="Search research" value={draft}
      onChange={(event) => { setDraft(event.target.value); update({ q: event.target.value || undefined }, true) }} />
    <select aria-label="Program" value={program} onChange={(event) => update({ program: event.target.value || undefined })}>
      <option value="">All programs</option>
      {programs.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  </div>
  const frontiers = <section className="research-frontiers" aria-label="Best known frontiers">
    <h2 className="kicker tone-finding">Best known</h2>
    <div className="research-frontier-list">{(plays.data?.frontiers ?? []).map((item) =>
      <a key={item.id} href={`/plays?view=plays&q=${encodeURIComponent(item.id)}`} className="research-frontier">
        <strong>{item.id.replaceAll('-', ' ')}</strong><span>{item.statement || 'No statement recorded'}</span>
        <small>{item.asOf || 'date unknown'} · {item.banked} banked · {item.next} next</small>
      </a>)}</div>
    {!plays.data?.frontiers?.length && <p className="faint">No frontier statement recorded.</p>}
  </section>
  const homeTabs = (
    <nav className="run-tabs" aria-label="Research views">
      {([['plays', 'Plays'], ['findings', 'Findings'], ['runs', 'Runs']] as const).map(([value, label]) => (
        <button key={value} type="button" className={`run-tab ${home === value ? 'on' : ''}`} aria-current={home === value ? 'page' : undefined} data-home-tab={value}
          onClick={() => update({ view: value === 'plays' ? undefined : value })}>
          {label}
        </button>
      ))}
    </nav>
  )
  if (home === 'findings')
    return (
      <div className="ws-page ws-plays" data-plays-home="findings">
        {frontiers}{homeTabs}{sharedFilters}
        <FindingsFeed api={api} query={query} program={program} />
      </div>
    )
  if (home === 'runs') {
    const cutoff = Date.now() - 30 * 86400_000
    const all = plays.data?.runs ?? []
    const shown = all.filter((run) => (run.state === 'running' || (run.startedAt && Date.parse(run.startedAt) >= cutoff))
      && (!program || run.program === program) && (!query || `${run.id} ${run.play} ${run.reason ?? ''} ${run.stopCause ?? ''}`.toLowerCase().includes(query.toLowerCase())))
    return <div className="ws-page ws-plays" data-plays-home="runs">
      {frontiers}{homeTabs}{sharedFilters}
      <p className="faint">{shown.length} catalog runs: started in the last 30 days or running now. One row per root run; versions are on the run page.</p>
      <div className="table-scroll"><table className="data-table runs-table" data-run-ledger>
        <thead><tr><th>Run</th><th>State</th><th>Started</th><th>Last activity</th><th>Outcome / stop cause</th>
          <th className="num">Subscription at API prices</th><th className="num">Billed API</th><th className="num">Billed sandbox</th></tr></thead>
        <tbody>{shown.map((run) => <tr key={run.id}>
          <td><a href={`/run/${encodeURIComponent(run.id)}`}>{run.play}</a><small className="faint mono"> {run.id}</small></td>
          <td><span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span></td>
          <td>{when(run.startedAt)}</td><td>{when(run.activeAt)}</td><td>{run.stopCause || run.reason || '—'}</td>
          <td className="num">{money(run.subscriptionUsd)}</td><td className="num">{money(run.apiUsd)}</td><td className="num">{money(run.sandboxUsd)}</td>
        </tr>)}</tbody>
      </table></div>
      {!shown.length && <p className="chat-empty">No runs match.</p>}
    </div>
  }
  return (
    <Status loading={plays.loading} error={plays.error && `Plays are unavailable: ${plays.error}`}>
      <div className="ws-page ws-plays" data-plays>
        {frontiers}{homeTabs}{sharedFilters}
        <header className="ws-head">
          <div className="ws-title-row">
            <h1>Plays</h1>
          </div>
          <div className="message-filters plays-filters">
            <select aria-label="Order" value={sort} onChange={(event) => update({ sort: event.target.value === 'latest' ? undefined : event.target.value })}>
              <option value="latest">Latest run first</option>
              <option value="spend">Most spend first</option>
              <option value="runs">Most runs first</option>
              <option value="name">By name</option>
            </select>
          </div>
          <HiddenSummary counts={hidden.counts} total={hidden.total} noun="plays" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
        </header>
        <ReliabilityPanel api={api} />
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
                  <th className="num" title="Subscription model use at API prices; not billed">Subscription use</th>
                  <th className="num" title="Model API charges billed through Router">Model API</th>
                  <th className="num" title="Billed sandbox compute">Sandbox compute</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((play) => {
                  const open = () => go(`/play/${encodeURIComponent(play.id)}`)
                  const flags = Object.entries(play.headline).filter(([, value]) => value.polarity === 'bad')
                  const runs = !showHidden && play.counts ? play.counts.shown : play.runCount
                  return (
                    <tr key={play.id} data-play={play.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
                      <td>
                        <a href={`/play/${encodeURIComponent(play.id)}`} onClick={(event) => event.preventDefault()}>{play.title}</a>
                        {play.title !== play.id && <small className="faint mono"> {play.id}</small>}
                      </td>
                      <td className="mono">
                        {play.program ?? <span className="faint">{play.noProgram ? 'no program' : play.playBasis}</span>}
                      </td>
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
                      <td className="num" title={runs !== play.runCount ? `${play.runCount} in all; ${play.runCount - runs} behind the filter` : undefined}>
                        {runs}{runs !== play.runCount && <small className="faint"> of {play.runCount}</small>}
                      </td>
                      <td className={`num ${play.spend.subscriptionUsd === null ? 'unknown' : ''}`}>
                        {money(play.spend.subscriptionUsd)}{!play.spend.subscriptionKnown && play.spend.subscriptionUsd !== null ? '+' : ''}
                      </td>
                      <td className={`num ${play.spend.apiUsd === null ? 'unknown' : ''}`}>{money(play.spend.apiUsd)}</td>
                      <td className={`num ${play.spend.sandboxUsd === null ? 'unknown' : ''}`}>
                        {money(play.spend.sandboxUsd)}
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
          {!rows.length && <p className="chat-empty">No {hidden.plays && !showHidden ? 'shown ' : ''}play matches.</p>}
        </section>
      </div>
    </Status>
  )
}

// ---------------------------------------------------------------------------------------------------------
// /play/<id>
// ---------------------------------------------------------------------------------------------------------
/** The play's tabs: what it found first (charts across its runs, then its results and claims), then its runs and versions. */
type PlayTab = 'results' | 'runs' | 'versions' | 'profiles' | 'input' | 'spend' | 'assessments'

function PlayPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const play = useDocument<PlayDocument>(`${api}/plays/${encodeURIComponent(id)}`)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const tab = (['results', 'runs', 'versions', 'profiles', 'input', 'spend', 'assessments'] as const).find((value) => value === params.get('tab')) ?? 'results'
  const profiles = useDocument<ProfileGraphDocument>(`${api}/plays/${encodeURIComponent(id)}/profiles`)
  const graph = profiles.data ?? null
  const selectedRun = params.get('run')
  const showHidden = params.get('show') === 'all'
  const doc = play.data
  // Failed runs are a health signal: the play keeps them in view, and holds back only tests and archived runs.
  const split = useMemo(() => splitRuns(doc?.runs ?? [], showHidden, ['failed']), [doc, showHidden])
  // What the runs tab draws: every run, or only those the default filter shows (with their lineage and gaps).
  const view = useMemo(() => {
    if (!doc || showHidden || !split.hidden) return doc
    const hidden = new Set(doc.runs.filter((run) => run.hidden).map((run) => run.id))
    return {
      ...doc,
      runs: split.shown,
      lineage: {
        nodes: doc.lineage.nodes.filter((node) => !hidden.has(node.runId)),
        edges: doc.lineage.edges.filter((edge) => !hidden.has(edge.from) && !hidden.has(edge.to)),
      },
      gaps: doc.gaps.filter((gap) => !gap.runId || !hidden.has(gap.runId)),
    }
  }, [doc, showHidden, split])
  // Every run as a version, compared with the one before it; the canvas draws those the filter shows.
  const versions = useMemo(() => (doc ? versionsOf(doc, graph) : []), [doc, graph])
  const shownVersions = useMemo(() => {
    const shownIds = new Set((view?.runs ?? []).map((run) => run.id))
    return versions.filter((version) => shownIds.has(version.run.id))
  }, [versions, view])
  const selection = useMemo((): Selection | null => {
    const short = params.get('profile')
    const node = short && graph ? findProfile(profileGraph(graph), short) : null
    const nodeRun = node && graph ? runOfProfile(graph, node) : null
    if (node && nodeRun) return node.kind === 'root' ? { kind: 'version', runId: nodeRun } : { kind: 'profile', runId: nodeRun, digest: node.digest }
    const runId = params.get('v')
    return runId && versions.some((version) => version.run.id === runId) ? { kind: 'version', runId } : null
  }, [params, graph, versions])
  const select = (next: Selection) =>
    update(next.kind === 'version' ? { v: next.runId, profile: undefined } : { v: next.runId, profile: graph?.nodes.find((node) => node.digest === next.digest)?.short })
  const latestDigest = doc?.input?.digest ?? null
  // The profiles canvas draws every run of the play, the ones the default filter hides included: lineage needs them.
  const playScope = useMemo(() => ({ kind: 'play' as const, play: id, runs: (doc?.runs ?? []).map((run) => run.id) }), [id, doc])
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
            </div>
            <PlayStanding play={doc} />
            {(doc.frontier?.statement || doc.charter) && <p className="ws-charter">{doc.frontier?.statement ?? doc.charter}</p>}
            <div className="ws-facts">
              {doc.program && <span><b>Program</b> {doc.program}</span>}
              {doc.line && <span><b>Line</b> {doc.line}</span>}
              {doc.frontier?.target && <span><b>Target</b> {doc.frontier.target}</span>}
              {doc.frontier?.asOf && <span><b>Frontier as of</b> {doc.frontier.asOf}</span>}
            </div>
            <SpendSummary spend={doc.spend} />
          </header>
          <Tabs
            label="Play"
            value={tab}
            onChange={(next) => update({ tab: next === 'results' ? undefined : next })}
            tabs={[['results', 'Results'], ['runs', 'Runs'], ['versions', 'Versions'], ['profiles', 'Profiles'], ['input', 'Input'], ['spend', 'Spend'], ['assessments', 'Assessments']] as const}
          />
          <div className="ws-content" role="tabpanel">
            {tab === 'results' && (
              <div className="ws-section play-results" data-section="results">
                <PlayCharts play={doc} />
                <h3>What this play found</h3>
                {doc.findings?.length ? (
                  <FeedCards items={doc.findings} />
                ) : (
                  <p className="ws-status">No result or claim has been derived from this play&rsquo;s runs yet. Each run&rsquo;s pages are under its Findings.</p>
                )}
              </div>
            )}
            {tab === 'versions' && (
              <>
                <HiddenSummary counts={split.counts} total={doc.runs.length} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
                <div className="lineage-layout" data-section="versions">
                  <section className="lineage-pane" aria-label="Version graph">
                    <p className="faint lineage-key">
                      Newest first, in the same graph as a run's versions: each run's registered profile with its state, its judges and what changed from the
                      version before it, what the versions supersede outside this play, and the profiles the selected version's agents wrote, one lane per
                      spawn depth. A run's own pages and profiles, version by version, are on its run page under Versions.
                    </p>
                    {profiles.loading && !graph ? <p className="ws-status" role="status">Loading profile versions…</p> : null}
                    <VersionCanvas play={doc} graph={graph} versions={shownVersions} selection={selection} onSelect={select} />
                  </section>
                  <aside className="inspector-pane" aria-label="Inspector">
                    <Inspector api={api} play={doc} graph={graph} versions={versions} selection={selection ?? (shownVersions.at(-1) ? { kind: 'version', runId: shownVersions.at(-1)!.run.id } : null)} onSelect={select} />
                  </aside>
                </div>
                <Searches graph={graph} runId={selection?.runId ?? shownVersions.at(-1)?.run.id ?? null} />
              </>
            )}
            {tab === 'profiles' && (
              <section className="ws-section" data-section="profiles" aria-label="Profiles">
                {graph ? (
                  <ProfileCanvas
                    api={api}
                    doc={graph}
                    scope={playScope}
                    selected={params.get('profile')}
                    onSelect={(short) => update({ profile: short ?? undefined })}
                  />
                ) : (
                  <p className="ws-status" role={profiles.error ? 'alert' : 'status'}>{profiles.error ? `Profile versions are unavailable: ${profiles.error}` : 'Loading profile versions…'}</p>
                )}
              </section>
            )}
            {tab === 'runs' && (
              <>
                <HiddenSummary counts={split.counts} total={doc.runs.length} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
                <section className="ws-section">
                  <RunsTable play={view!} latestDigest={latestDigest} headlines={headlines} headline={dimensions.data ? new Set(dimensions.data.dimensions.filter((item) => item.headline).map((item) => item.id)) : null} onOpen={open} />
                </section>
                {view!.gaps.length > 0 && (
                  <section className="ws-section gaps">
                    <h3>Missing evidence</h3>
                    <ul className="gap-list">
                      {view!.gaps.map((gap, i) => (
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
                <AssessmentMatrix play={view!} dimensions={dimensions.data} onOpen={open} />
              </section>
            )}
          </div>
        </div>
      )}
    </Status>
  )
}

/** One adverse label per headline dimension. */
/**
 * The play's standing as two facts: its best result (the newest run that won) and its latest run with how it is going.
 * A failed latest run never hides an earlier winner, and no winner yet is said plainly.
 */
function PlayStanding({ play }: { play: PlayDocument }) {
  const latest = play.runs[0] ?? null
  const best = play.best ? (play.runs.find((run) => run.id === play.best) ?? null) : null
  const results = play.runs.reduce((sum, run) => sum + (run.findings?.results ?? 0), 0)
  const claims = play.runs.reduce((sum, run) => sum + (run.findings?.claims ?? 0), 0)
  return (
    <div className="play-standing" data-play-standing>
      <a className="play-fact" href={best ? `/run/${encodeURIComponent(best.id)}` : '?tab=runs'} data-best={best?.id ?? 'none'}>
        <span className="answer-label">Best result</span>
        {best ? (
          <>
            <span className="answer-value state-ok">winner</span>
            <span className="mono">{shortRun(play.id, best.id)}</span>
            <span className="faint">{when(best.settledAt ?? best.startedAt)}</span>
          </>
        ) : (
          <span className="answer-value">no winner yet</span>
        )}
        {results + claims > 0 && <span className="faint">· {results} results, {claims} claims across its runs</span>}
      </a>
      {latest && (
        <a className="play-fact" href={`/run/${encodeURIComponent(latest.id)}`} data-latest={latest.id}>
          <span className="answer-label">Latest run</span>
          <span className={`state-pill ${stateClass(latest.state)}`}>{stateLabel(latest.state)}</span>
          <span className="mono">{shortRun(play.id, latest.id)}</span>
          <span className="faint">{when(latest.startedAt)}</span>
        </a>
      )}
    </div>
  )
}

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
  // The column shows when any run's record states what it is for (the catalog reads it from the run input).
  const purposes = play.runs.some((run) => run.purpose)
  return (
    <div className="table-scroll">
      <table className="data-table runs-table" data-runs>
        <thead>
          <tr>
            <th>Run</th>
            {purposes && <th>Purpose</th>}
            <th>State</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Agents</th>
            <th className="num" title="Subscription model use at API prices; not billed">Subscription use</th>
            <th className="num" title="Model API charges billed through Router">Model API</th>
            <th className="num" title="Billed sandbox compute">Sandbox compute</th>
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
              {purposes && (
                <td className="run-purpose" data-purpose-basis={run.purposeBasis ?? undefined} title={run.purpose ? `${run.purpose}\n\nFrom the run record's ${run.purposeBasis ?? 'input'}` : 'The run record states no purpose'}>
                  {run.purpose ? <div className="run-purpose-text">{run.purpose}</div> : <span className="faint">not stated</span>}
                </td>
              )}
              <td><span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>{run.reason && <small className="faint"> {run.reason}</small>}</td>
              <td>{when(run.startedAt)}</td>
              <td>{duration(run.durationMs)}</td>
              <td>{run.nodes ?? '—'}{run.depth !== null && run.nodes ? <small className="faint"> depth {run.depth}</small> : null}</td>
              <td className={`num ${run.spend.subscriptionUsd === null ? 'unknown' : ''}`}>
                {money(run.spend.subscriptionUsd)}{!run.spend.subscriptionKnown && run.spend.subscriptionUsd !== null ? '+' : ''}
              </td>
              <td className={`num ${run.spend.apiUsd === null ? 'unknown' : ''}`}>{money(run.spend.apiUsd)}</td>
              <td className={`num ${run.spend.sandboxUsd === null ? 'unknown' : ''}`}>{money(run.spend.sandboxUsd)}</td>
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
        rows={play.runs.map((run) => ({ label: shortRun(play.id, run.id), subscription: run.spend.subscriptionUsd, api: run.spend.apiUsd,
          sandbox: run.spend.sandboxUsd, subscriptionKnown: run.spend.subscriptionKnown, href: run.id }))}
        onOpen={(row) => row.href && onOpen(row.href)}
      />
      {byModel(play.spend).length > 0 && (
        <>
          <h3>By model</h3>
          <p className="faint">The Router bill cannot be split by model.</p>
          <SpendBars rows={byModel(play.spend)} />
        </>
      )}
      <SeatWeeksPanel spend={play.spend} />
      <p className="faint">Activity and waste price recorded model usage at API rates; they do not allocate charges.</p>
      <div className="breakdown-grid">
        <BreakdownTable title="By activity" rows={(play.spend.byCategory ?? []).map((row) => ({ ...row, label: row.category }))} />
        <BreakdownTable title="Waste" rows={(play.spend.waste ?? []).map((row) => ({ ...row, label: wasteLabel(row.dimension, catalogue) }))} />
      </div>
      {play.spend.gaps.length > 0 && (
        <>
          <h3>Unknown spend</h3>
          <ul className="gap-list">
            {play.spend.gaps.map((gap, i) => <li key={i}><code title={gap.code}>{spendGapLabel(gap.code)}</code> {gap.runId && <span className="mono">{shortRun(play.id, gap.runId)}</span>} {gap.detail}</li>)}
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
/** The selected agent's own views; the run's spend, assessments, input and coverage are sections of the run page. */
type AgentTab = 'messages' | 'timeline' | 'usage'
const AGENT_TABS = [
  ['messages', 'Messages'],
  ['timeline', 'Timeline'],
  ['usage', 'Usage'],
] as const

/** A record part (agent-record.v1) read for drawing; `nodeStats` only on the `nodes` part. */
function useRecordPart(url: string | null) {
  const doc = useDocument<unknown>(url, undefined, true)
  const parsed = useMemo(() => {
    if (!doc.data) return { record: null, index: null, stats: {} as Record<string, NodeStats>, error: undefined as string | undefined }
    try {
      const record = withPrompts(readRecord(doc.data))
      const stats = ((doc.data as { nodeStats?: Record<string, NodeStats> }).nodeStats ?? {}) as Record<string, NodeStats>
      return { record, index: indexRecord(record), stats, error: undefined }
    } catch (error) {
      return { record: null, index: null, stats: {} as Record<string, NodeStats>, error: error instanceof Error ? error.message : 'Invalid record' }
    }
  }, [doc.data])
  return { ...parsed, loading: doc.loading, fetchError: doc.error, pending: !!url && doc.data === undefined && !doc.error }
}

/** The run's profiles on the lineage canvas, read from its play's profile index (which carries every ancestor, in any play). */
function RunProfiles({ api, runId, play, selected, onSelect }: { api: string; runId: string; play: string; selected: string | null; onSelect: (short: string | null) => void }) {
  const profiles = useDocument<ProfileGraphDocument>(`${api}/plays/${encodeURIComponent(play)}/profiles`)
  const scope = useMemo(() => ({ kind: 'run' as const, runId, play }), [runId, play])
  if (!profiles.data)
    return (
      <p className="ws-status run-panel" role={profiles.error ? 'alert' : 'status'}>
        {profiles.error ? `This run's profiles are unavailable: ${profiles.error}` : 'Loading profile versions…'}
      </p>
    )
  return (
    <section className="run-panel run-profiles" aria-label="Profiles" data-section="profiles">
      <ProfileCanvas api={api} doc={profiles.data} scope={scope} selected={selected} onSelect={onSelect} />
    </section>
  )
}

/**
 * The run page's sections, in one tab bar under the header: what the run found first, then how it progressed, its
 * agents and the rest. The first six are tabs; the others sit behind More, which names the one open.
 */
type RunSection = 'findings' | 'progress' | 'agents' | 'graph' | 'versions' | 'profiles' | 'readout' | 'outputs' | 'spend' | 'assessments' | 'input' | 'coverage'
const RUN_SECTIONS: readonly (readonly [RunSection, string])[] = [
  ['findings', 'Findings'],
  ['progress', 'Progress'],
  ['agents', 'Agents'],
  ['spend', 'Spend'],
  ['readout', 'Readout'],
  ['outputs', 'Outputs'],
  ['graph', 'Graph'],
  ['versions', 'Versions'],
  ['profiles', 'Profiles'],
  ['assessments', 'Assessments'],
  ['input', 'Input'],
  ['coverage', 'Coverage'],
]
const RUN_TABS = 6
/** Sections that draw from the selected agent's record part (every node, that agent's events). */
const AGENT_PART_SECTIONS = new Set<RunSection>(['agents', 'spend', 'assessments', 'coverage'])

/** The section a URL asks for; links from before the sections existed (`view`, `tab`, `node`) still land right. */
function sectionOf(params: URLSearchParams, hasFindings: boolean): RunSection {
  const asked = params.get('section')
  const known = RUN_SECTIONS.find(([value]) => value === asked)?.[0]
  if (known) return known
  const view = params.get('view')
  if (view === 'readout' || view === 'outputs') return view
  const tab = params.get('tab')
  if (tab === 'spend' || tab === 'assessments' || tab === 'input' || tab === 'coverage') return tab
  if (params.get('node') || params.get('event') || tab) return 'agents'
  return hasFindings ? 'findings' : 'agents'
}

/**
 * The run page: a header, the run's answer in one strip, and one tab bar. Findings (what the agents wrote) open first;
 * Agents is a rail of the run's agents beside the selected agent's conversation; the other sections are the run's
 * graph, readout, outputs, spend, assessments, input and coverage, each full width. The page draws from the record's
 * node list; an agent's events load only when a section needs them, so a run with a 5 MB record opens as fast as a
 * small one.
 */
function RunPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const [poll, setPoll] = useState<number | undefined>(undefined)
  const runUrl = `${api}/runs/${encodeURIComponent(id)}`
  // A saved grade changes the run's document; asking under a new query fetches it again (the host ignores the query).
  const [revision, setRevision] = useState(0)
  // The finding open in the run's findings; the agent rail and the graph open one there too.
  const [finding, setFinding] = useState<string | null>(null)
  const run = useDocument<RunDocument>(revision ? `${runUrl}?revision=${revision}` : runUrl, poll, true)
  // A live run's record digest changes every few seconds; a new digest refetches the parts, so this sets the delay.
  useEffect(() => setPoll(run.data?.live.polling ? 3_000 : undefined), [run.data?.live.polling])
  const digest = run.data?.run.record.digest ?? null
  const recordReady = run.data?.run.record.status === 'ready' || !!digest
  const version = digest ? `&digest=${digest}` : ''
  const nodes = useRecordPart(recordReady ? `${runUrl}/record?part=nodes${version}` : null)
  const assessments = useDocument<AssessmentsDocument>(`${runUrl}/assessments${digest ? `?digest=${digest}` : ''}`, undefined, true)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const catalogue = useMemo(() => dimensionMap(dimensions.data), [dimensions.data])
  const section = sectionOf(params, !!run.data?.findings?.total)
  const requested = params.get('node')
  const index = nodes.index
  const root = index ? (index.actors.find((node) => node.parent === null && node.kind === 'agent')?.id ?? index.actors[0]?.id ?? null) : null
  const actor = index && requested && index.nodes.has(index.canonical(requested)) ? index.canonical(requested) : root
  const agent = useRecordPart(AGENT_PART_SECTIONS.has(section) && actor ? `${runUrl}/record?node=${encodeURIComponent(actor)}${version}` : null)
  const summary = run.data?.run
  if (run.error && !run.data) return <p className="ws-status" role="alert">This run is unavailable: {run.error}</p>
  if (!summary) return <p className="ws-status" role="status">Loading…</p>
  const doc = run.data!
  // One URL key per section: the section, plus what that section shows (the agent, its tab, the file).
  const open = (next: RunSection, patch: Record<string, string | undefined> = {}) => update({ section: next, view: undefined, drawer: undefined, ...patch })
  const openFinding = (sha: string) => {
    setFinding(sha)
    open('findings')
  }
  const selectAgent = (node: string) => update({ section: 'agents', node, view: undefined, drawer: undefined, event: undefined, t: undefined, file: undefined })
  const grading = { api, runId: summary.id, onSaved: () => setRevision((value) => value + 1) }
  const loadingAgent = (
    <p className="ws-status" role={agent.fetchError || agent.error ? 'alert' : 'status'}>
      {agent.fetchError || agent.error
        ? `This agent's record is unavailable: ${agent.fetchError ?? agent.error}`
        : `Loading ${(actor && index?.nodes.get(actor)?.label) ?? 'the agent'}'s record…`}
    </p>
  )
  const counts: Partial<Record<RunSection, number>> = {
    findings: doc.findings?.items.filter((item) => item.kind === 'result' || item.kind === 'claim').length,
    agents: index?.actors.filter((node) => node.kind !== 'finding').length,
    outputs: doc.finalOutput?.files.length,
  }
  return (
    <div className="ws-page ws-run" data-run={summary.id} data-section={section}>
      <RunHeader doc={doc} />
      <AnswerStrip doc={doc} onOpen={() => open('readout')} onOutputs={() => open('outputs')} onFindings={() => open('findings')} onProgress={() => open('progress')} />
      <RunTabs section={section} counts={counts} onOpen={open} />
      {section === 'progress' && <RunProgressView doc={doc} />}
      {section === 'findings' &&
        (doc.findings?.total ? (
          <RunFindings doc={doc} runUrl={runUrl} open={finding} onOpen={setFinding} />
        ) : (
          <p className="ws-status run-panel">No knowledge pages were recorded for this run. Its agents are under Agents.</p>
        ))}
      {section === 'graph' && <WorkGraph doc={doc} runUrl={runUrl} onOpen={openFinding} />}
      {section === 'versions' && (
        <RunVersions
          runUrl={runUrl}
          poll={doc.live.polling ? 15_000 : undefined}
          selected={params.get('commit')}
          onSelect={(commit) => update({ section: 'versions', commit })}
          onOpenAgent={(node) => update({ section: 'agents', node, commit: undefined, view: undefined, drawer: undefined, event: undefined, t: undefined, file: undefined })}
        />
      )}
      {section === 'profiles' && (
        <RunProfiles
          api={api}
          runId={summary.id}
          play={summary.play}
          selected={params.get('profile')}
          onSelect={(short) => update({ section: 'profiles', profile: short ?? undefined })}
        />
      )}
      {section === 'readout' && (
        <section className="run-panel" aria-label="Readout" data-drawer="readout">
          <FinalOutputPanel output={doc.finalOutput} grading={grading} />
        </section>
      )}
      {section === 'outputs' && (
        <section className="run-panel" aria-label="Outputs" data-drawer="outputs">
          <OutputsView doc={doc} grading={grading} selected={params.get('file')} onSelect={(file) => update({ section: 'outputs', file: file ?? undefined })} onClose={() => open('findings')} />
        </section>
      )}
      {section === 'input' && (
        <section className="run-panel" aria-label="Input">
          <InputView input={doc.input} api={api} />
        </section>
      )}
      {index && section === 'agents' && actor && (
        <div className="agents-layout">
          <aside className="agent-rail" aria-label="Agents">
            <AgentTable
              index={index}
              stats={nodes.stats}
              doc={doc}
              assessments={assessments.data?.rows ?? []}
              dimensions={catalogue}
              selected={actor}
              onSelect={selectAgent}
            />
            <AgentFindings doc={doc} agent={actor} label={index.nodes.get(actor)?.label ?? actor} onOpen={openFinding} />
          </aside>
          <section className="agent-pane" aria-label="Selected agent" data-drawer="agent">
            {agent.index ? (
              <RunBody
                key={actor}
                api={api}
                doc={doc}
                index={agent.index}
                actor={actor}
                params={params}
                update={update}
                assessments={assessments.data}
                dimensions={dimensions.data}
              />
            ) : (
              loadingAgent
            )}
          </section>
        </div>
      )}
      {index && (section === 'spend' || section === 'assessments' || section === 'coverage') && actor && (
        <section className="run-panel" aria-label={section}>
          {agent.index ? (
            <RunPanels
              section={section}
              doc={doc}
              index={agent.index}
              actor={actor}
              params={params}
              update={update}
              assessments={assessments.data}
              dimensions={dimensions.data}
              gaps={nodes.record?.coverage.gaps ?? []}
              onSelectAgent={selectAgent}
            />
          ) : (
            loadingAgent
          )}
        </section>
      )}
      {!index && AGENT_PART_SECTIONS.has(section) && (
        <div className="ws-section">
          {/* The record's request starts after the run document names it ready: until it answers, it is loading, not missing. */}
          {nodes.loading || (recordReady && nodes.pending) ? (
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
                {nodes.error ? ` ${nodes.error}` : ''}
                {nodes.fetchError && !summary.record.reason ? ` ${nodes.fetchError}` : ''}
              </p>
              <RunExtras api={api} doc={doc} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The run's section tabs: the first RUN_TABS as tabs, the rest in a More menu that names the section open in it. */
function RunTabs({ section, counts, onOpen }: { section: RunSection; counts: Partial<Record<RunSection, number>>; onOpen: (section: RunSection) => void }) {
  const more = useRef<HTMLDetailsElement>(null)
  const tab = ([value, label]: readonly [RunSection, string], inMenu = false) => (
    <button
      key={value}
      type="button"
      className={`run-tab ${section === value ? 'on' : ''}`}
      aria-current={section === value ? 'page' : undefined}
      data-section-tab={value}
      role={inMenu ? 'menuitem' : undefined}
      onClick={() => {
        if (more.current) more.current.open = false
        onOpen(value)
      }}
    >
      {label}
      {counts[value] ? <span className="run-tab-count">{counts[value]}</span> : null}
    </button>
  )
  const hidden = RUN_SECTIONS.slice(RUN_TABS)
  const current = hidden.find(([value]) => value === section)
  return (
    <nav className="run-tabs" aria-label="Run sections">
      {RUN_SECTIONS.slice(0, RUN_TABS).map((entry) => tab(entry))}
      <details className="run-tab-more" ref={more}>
        <summary className={`run-tab ${current ? 'on' : ''}`} data-section-tab="more">{current ? `More: ${current[1]}` : 'More'}</summary>
        <div className="run-tab-menu" role="menu">{hidden.map((entry) => tab(entry, true))}</div>
      </details>
    </nav>
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
        {run.reason && run.reason !== run.state && <span className="faint">{run.reason.replaceAll('-', ' ')}</span>}
      </div>
      {run.purpose && <p className="ws-charter run-purpose-line">{run.purpose}</p>}
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
          <thead><tr><th>Sandbox</th><th className="num">Compute billed</th><th className="num">Cost basis</th><th className="num">Hours</th></tr></thead>
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
        <ul className="gap-list">{doc.spend.gaps.map((gap, i) => <li key={i}><code title={gap.code}>{spendGapLabel(gap.code)}</code> {gap.detail}</li>)}</ul>
      )}
      {doc.input && <InputView input={doc.input} api={api} />}
    </>
  )
}

/** The selected agent beside the agent rail: its record part (every node, this agent's events), replay and views. */
function RunBody({
  api,
  doc,
  index,
  actor,
  params,
  update,
  assessments,
  dimensions,
}: {
  api: string
  doc: RunDocument
  index: RecordIndex
  actor: string
  params: URLSearchParams
  update: (patch: Record<string, string | undefined | null>, replace?: boolean) => void
  assessments: AssessmentsDocument | undefined
  dimensions: DimensionsDocument | undefined
}) {
  const runId = doc.run.id
  const tab = (AGENT_TABS.map(([value]) => value) as AgentTab[]).find((value) => value === params.get('tab')) ?? 'messages'
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
  const measured = useMemo(() => measuredUsage(index, actor), [index, actor])
  const empty = !(index.byActor.get(actor) ?? []).length
  return (
    <div className="agent-drawer" onScrollCapture={hideTooltip}>
      <section className="ws-panel" aria-label="Agent record">
        <div className="agent-head">
          <div className="agent-identity">
            <span className={`agent-avatar ${node?.status === 'done' && measured ? 'state-ok' : node?.status === 'down' ? 'state-fail' : ''}`} aria-hidden="true">
              {role.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h2 data-agent-title>{node?.label ?? actor}</h2>
              <p className="agent-meta">
                {[role, model, node?.harness as string | undefined, agentState(node, measured)].filter(Boolean).join(' · ')}
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
            Full time
          </button>
        </div>
        <Tabs label="Agent record" value={tab} onChange={(next) => select({ tab: next === 'messages' ? undefined : next })} tabs={AGENT_TABS} />
        <div className="ws-panel-body" role="tabpanel">
          {tab === 'messages' && empty && <EmptyAgent index={index} actor={actor} onSelect={selectNode} />}
          {tab === 'messages' && !empty && (
            <>
              <div className="message-filters">
                <select aria-label="Activity type" value={category} onChange={(event) => setCategory(event.target.value)} data-category>
                  <option value="all">All activity</option>
                  <option value="prompts">Prompts and steering</option>
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
                onFlag={(flag: EventFlag) => select({ section: 'assessments', tab: undefined, dim: flag.dimension })}
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

/** The run's spend, assessments and coverage, full width under the tab bar; they read the selected agent's record part. */
function RunPanels({
  section,
  doc,
  index,
  actor,
  params,
  update,
  assessments,
  dimensions,
  gaps,
  onSelectAgent,
}: {
  section: 'spend' | 'assessments' | 'coverage'
  doc: RunDocument
  index: RecordIndex
  actor: string
  params: URLSearchParams
  update: (patch: Record<string, string | undefined | null>, replace?: boolean) => void
  assessments: AssessmentsDocument | undefined
  dimensions: DimensionsDocument | undefined
  gaps: RecordGap[]
  onSelectAgent: (id: string) => void
}) {
  const catalogue = useMemo(() => dimensionMap(dimensions), [dimensions])
  const listFromRecord = useMemo(() => {
    let total: number | null = null
    for (const event of index.byActor.get(actor) ?? [])
      if (typeof event.detail.costListUsd === 'number') total = (total ?? 0) + event.detail.costListUsd
    return total
  }, [index, actor])
  // A cited event of another agent is in that agent's part: open the agent it names (event ids start with the node id).
  const cite = (eventId: string) => {
    const event = index.byEvent.get(eventId)
    const owner = event ? index.canonical(event.node) : index.canonical(eventId.split('#')[0] ?? '')
    if (!index.nodes.has(owner)) return
    update({ section: 'agents', node: owner, event: eventId, tab: undefined, t: undefined })
  }
  if (section === 'assessments')
    return <RunAssessments doc={assessments} dimensions={dimensions} index={index} node={actor} focus={params.get('dim')} onFocus={(dimension) => update({ dim: dimension }, true)} onCite={cite} />
  if (section === 'coverage') return <Coverage index={index} doc={doc} gaps={gaps} onSelect={onSelectAgent} />
  return (
    <div className="spend-tab">
      <h3>Agents in this run</h3>
      <SpendBars
        rows={index.actors
          .filter((item) => item.kind !== 'finding')
          .map((item) => {
            const spend = doc.spend.nodes[item.id]
            return { label: item.label, subscription: spend?.subscriptionUsd ?? null, api: spend?.apiUsd ?? null,
              sandbox: spend?.sandboxUsd ?? null, subscriptionKnown: spend?.subscriptionKnown, href: item.id }
          })}
        onOpen={(row) => row.href && onSelectAgent(row.href)}
      />
      {byModel(doc.spend).length > 0 && (
        <>
          <h3>By model</h3>
          <p className="faint">The Router bill cannot be split by model.</p>
          <SpendBars rows={byModel(doc.spend)} />
        </>
      )}
      <SeatWeeksPanel spend={doc.spend} />
      <p className="faint">Activity and waste price recorded model usage at API rates; they do not allocate charges.</p>
      <div className="breakdown-grid">
        <BreakdownTable title="By activity" rows={(doc.spend.byCategory ?? []).map((row) => ({ ...row, label: row.category }))} />
        <BreakdownTable title="Waste" rows={(doc.spend.waste ?? []).map((row) => ({ ...row, label: wasteLabel(row.dimension, catalogue) }))} />
      </div>
      <h3>Selected agent: {index.nodes.get(actor)?.label ?? actor}</h3>
      <NodeSpendPanel spend={doc.spend.nodes[actor]} listFromRecord={listFromRecord} />
    </div>
  )
}

/** An agent with no recorded event: say what is missing instead of an empty pane, and lead to its agents. */
function EmptyAgent({ index, actor, onSelect }: { index: RecordIndex; actor: string; onSelect: (id: string) => void }) {
  const node = index.nodes.get(actor)
  const capture = node?.capture as { channel?: string; status?: string; reason?: string | null } | undefined
  const children = index.actors.filter((item) => item.kind !== 'finding' && item.parent && index.canonical(item.parent) === actor)
  return (
    <div className="agent-empty" data-agent-empty={actor}>
      <h3>Nothing was recorded for {node?.label ?? actor}</h3>
      <p>
        {index.events.length ? 'The record holds no event from this agent' : 'This run’s record holds no events at all'}, and no usage.{' '}
        Capture: {capture?.status ?? 'unknown'}
        {capture?.channel ? ` (${capture.channel})` : ''}
        {capture?.reason ? `; ${capture.reason}` : ''}. An empty record is not evidence that the agent did no work.
      </p>
      {children.length > 0 && (
        <p className="agent-empty-children">
          <span className="faint">Its agents:</span>{' '}
          {children.map((child) => (
            <button key={child.id} type="button" className="link-button" onClick={() => onSelect(child.id)}>
              {child.label}
            </button>
          ))}
        </p>
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
                <td>{agentState(node, measuredUsage(index, node.id))}</td>
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
