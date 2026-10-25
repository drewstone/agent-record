import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssessmentsDocument, DimensionsDocument } from './assessment.js'
import type { RecordEvent, RecordGap } from './record.js'
import { AgentFindings, RunFindings } from './workspace/Findings.js'
import { WorkGraph } from './workspace/WorkGraph.js'
import { FindingsFeed } from './workspace/FindingsFeed.js'
import { PlayAnswer } from './workspace/PlayAnswer.js'
import { PlayBarTable } from './workspace/PlayBarTable.js'
import { PlayJourney, PlayJourneyStanding } from './workspace/PlayJourney.js'
import { BeadString } from './workspace/BeadString.js'
import { ExplorePage } from './workspace/Explore.js'
import { PlayHeader } from './workspace/PlayHead.js'
import { PlayAgainstBar, PlayClimb } from './workspace/PlayClimb.js'
import { PlayLedger } from './workspace/PlayLedger.js'
import { PlayTeams } from './workspace/PlayTeams.js'
import { PlayFindings } from './workspace/PlayFindings.js'
import { PlayReleases } from './workspace/PlayReleases.js'
import { PlaysTable } from './workspace/PlaysTable.js'
import { inlinedPlayHead, type PlayHead } from './workspace/play-standing.js'
import { TheatrePage } from './workspace/Theatre.js'
import { RunVersions } from './workspace/VersionGraph.js'
import type { PlayReportDocument } from './play-report.js'
import type { PlayDocument, PlayInput, PlaysDocument, ProfileGraphDocument, RunDocument } from './workspace-model.js'
type Play = PlayDocument & PlayHead
import { Conversation } from './viewer/Conversation.js'
import type { EventFlag } from './viewer/Conversation.js'
import { categoryClass, Timeline, UsageChart } from './viewer/Charts.js'
import type { Axis, Metric, PlotTooltip, ShowTooltip } from './viewer/Charts.js'
import { agentState, interval, measuredUsage, ms, roleOf, utcTime } from './viewer/model.js'
import type { RecordIndex } from './viewer/model.js'
import { advancePlayback } from './viewer/playback.js'
import { EventDetail } from './workspace/EventDetail.js'
import { AssessmentMatrix, dimensionMap, flagsFrom, RunAssessments } from './workspace/Assessments.js'
import { dataStatus, duration, go, money, newerStarted, runStatus, StatusPill, statusOf, useDocument, when } from './workspace/data.js'
import { FinalOutputPanel } from './workspace/FinalOutput.js'
import { InputView } from './workspace/InputView.js'
import { ReliabilityPanel } from './workspace/Reliability.js'
import { Searches } from './workspace/SearchView.js'
import { HIDDEN_LABEL, HIDDEN_ORDER, splitHidden, splitRuns } from './workspace/plays-filter.js'
import type { HiddenReason } from './workspace/plays-filter.js'
import { findProfile, profileGraph, runOfProfile } from './workspace/profile-graph.js'
import { versionsOf } from './workspace/profile-compare.js'
import { AgentTable } from './workspace/RunTable.js'
import { outcomeOfCheck, RunReceiptView } from './workspace/RunOverview.js'
import type { RunReceipt } from './workspace/run-receipt.js'
import { RunOverview } from './workspace/RunOverview.js'
import { LiveTranscript } from './workspace/LiveTranscript.js'
import { RunStatusLine, RunWhy } from './workspace/RunFold.js'
import { AgentConversation, useRecordPart } from './workspace/record-part.js'
import { readSource } from './workspace/source-reader.js'
import { artifactNavigation, useSearch } from './workspace/navigation.js'
import { goalText } from './workspace/plain-words.js'
import { isLazyMode, type LazyMode, LazyOutputsView, LazyPage, LazyRunWorkspace } from './workspace/lazy-pages.js'
import { newestAgent } from './workspace/run-answers.js'
import { AsOfStamp } from './workspace/AnswerStrip.js'
import { AGENT_PART_SECTIONS, RunTabBar, type RunSection, sectionOf } from './workspace/RunTabs.js'
import type { NodeStats } from './workspace/RunTable.js'
import { Inspector, type Selection, VersionCanvas } from './workspace/VersionCanvas.js'
import { ProfileCanvas } from './workspace/ProfileCanvas.js'
import { ProvenanceCanvas } from './workspace/ProvenanceCanvas.js'
import { agentSpendRows, apiEquivalent, BreakdownTable, byModel, knownSubscription, NodeSpendPanel, SeatWeeksPanel, SpendBars, spendGapLabel } from './workspace/Spend.js'

export interface WorkspaceProps {
  /** Same-origin API root, for example `/api/discovery`. */
  api: string
  mode: 'plays' | 'play' | 'run' | 'receipt' | 'theatre' | 'explore' | LazyMode
  id: string
  theme?: 'light' | 'dark' | 'auto'
}

/** Play and run pages of a run workspace. Reads only the same-origin API; navigation stays in the host tab. */
export function Workspace({ api, mode, id, theme = 'auto' }: WorkspaceProps) {
  return (
    <div className="agent-record ar-ws" data-theme={theme}>
      {mode === 'receipt' ? <ReceiptPage api={api} id={id} /> : mode === 'explore' ? <ExplorePage api={api} /> : isLazyMode(mode) ? <Suspense fallback={null}><LazyPage mode={mode} api={api} /></Suspense> : mode === 'theatre' ? <TheatrePage api={api} id={id} /> : mode === 'plays' ? <PlaysPage api={api} /> : mode === 'play' ? <PlayPage api={api} id={id} /> : <RunPage api={api} id={id} />}
    </div>
  )
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
          <span key={reason}>
            {i > 0 && ' · '}
            {counts[reason]} {reason === 'failed' && noun === 'plays' ? 'retired plays never ran clean' : HIDDEN_LABEL[reason]}
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
const PLAYS_PAGE = 50
function PlaysPage({ api }: { api: string }) {
  const [params, update] = useSearch()
  const plays = useDocument<PlaysDocument>(`${api}/plays`)
  const query = params.get('q') ?? ''
  const program = params.get('program') ?? ''
  const sort = (['latest', 'spend', 'runs', 'name'] as const).find((value) => value === params.get('sort')) ?? 'latest'
  const showHidden = params.get('show') === 'all'
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  // The first PLAYS_PAGE rows draw; the rest wait for "Show all", so the page stays a few screens tall (brief: <= 3).
  const [shownRows, setShownRows] = useState(PLAYS_PAGE)
  const programs = useMemo(() => [...new Set((plays.data?.plays ?? []).map((play) => play.program ?? '').filter(Boolean))].sort(), [plays.data])
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
  const order = home !== 'plays' ? null : (
    <select aria-label="Order" value={sort} onChange={(event) => update({ sort: event.target.value === 'latest' ? undefined : event.target.value })}>
      <option value="latest">Latest run first</option>
      <option value="spend">Most spend first</option>
      <option value="runs">Most runs first</option>
      <option value="name">By name</option>
    </select>
  )
  const sharedFilters = <div className="message-filters plays-filters" aria-label="Research filters"><input type="search" aria-label="Search research" placeholder="Search research" value={draft}
      onChange={(event) => { setDraft(event.target.value); update({ q: event.target.value || undefined }, true) }} />
    <select aria-label="Program" value={program} onChange={(event) => update({ program: event.target.value || undefined })}><option value="">All programs</option>
      {programs.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
    {order}
    {plays.data?.builtAt && <AsOfStamp asOf={{ at: plays.data.builtAt, meaning: 'when the host built this list of plays', source: 'the Discovery plays index' }} />}
  </div>
  const frontiers = !plays.data?.frontiers?.length ? null : <details className="research-frontiers" aria-label="Frontier statements">
    <summary className="faint">Frontier statements ({plays.data.frontiers.length}, as of {plays.data.frontiers.map((item) => item.asOf).filter(Boolean).sort().at(-1) ?? 'an unrecorded date'})</summary>
    <div className="research-frontier-list">{(plays.data?.frontiers ?? []).map((item) =>
      <a key={item.id} href={`/plays?view=plays&q=${encodeURIComponent(item.id)}`} className="research-frontier">
        <strong>{item.id.replaceAll('-', ' ')}</strong><span>{item.statement || 'No statement recorded'}</span>
        <small>{item.asOf || 'date unknown'} · {item.banked} banked · {item.next} next</small>
      </a>)}</div>
  </details>
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
        <div className="plays-bar">{homeTabs}{sharedFilters}</div>
        <FindingsFeed api={api} query={query} program={program} />
        {frontiers}
      </div>
    )
  if (home === 'runs') {
    const cutoff = Date.now() - 30 * 86400_000
    const all = plays.data?.runs ?? []
    const shown = all.filter((run) => (run.state === 'running' || (run.startedAt && Date.parse(run.startedAt) >= cutoff))
      && (!program || run.program === program) && (!query || `${run.id} ${run.play} ${run.reason ?? ''} ${run.stopCause ?? ''}`.toLowerCase().includes(query.toLowerCase())))
    // An unknown is one line (design-system section 2): a missing reading prints a dash, and the line counts them.
    const cash = (usd: number | null | undefined) => (usd === null || usd === undefined ? '—' : money(usd)), clock = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '—')
    const unrecorded = shown.filter((run) => [run.subscriptionUsd, run.apiUsd, run.sandboxUsd].every((usd) => usd === null || usd === undefined)).length
    return <div className="ws-page ws-plays" data-plays-home="runs">
      <div className="plays-bar">{homeTabs}{sharedFilters}</div>
      <ReliabilityPanel api={api} />
      <p className="faint">{shown.length} catalog runs: started in the last 30 days or running now. One row per root run; versions are on the run page.{unrecorded ? ` No spend reading for ${unrecorded} of them (subscription, API and sandbox; no per-run meter).` : ''}</p>
      <div className="table-scroll"><table className="data-table runs-table" data-run-ledger>
        <thead><tr><th>Run</th><th>State</th><th>Started</th><th>Last activity</th><th>Outcome / stop cause</th>
          <th className="num">Subscription at API prices</th><th className="num">Billed API</th><th className="num">Billed sandbox</th></tr></thead>
        <tbody>{shown.slice(0, shownRows).map((run) => <tr key={run.id}>
          <td><a href={`/run/${encodeURIComponent(run.id)}`}>{run.play}</a><small className="faint mono" title={run.id}> {/\d{6}(\d\d[a-z])$/.exec(run.id)?.[1] ?? run.id}</small></td>
          <td><StatusPill status={runStatus(run, newerStarted(run, all))} /></td>
          <td className="nowrap">{clock(run.startedAt)}</td><td className="nowrap">{clock(run.activeAt)}</td><td>{run.stopCause || run.reason || '—'}</td>
          <td className="num">{cash(run.subscriptionUsd)}</td><td className="num">{cash(run.apiUsd)}</td><td className="num">{cash(run.sandboxUsd)}</td>
        </tr>)}</tbody>
      </table></div>
      {!shown.length && <p className="chat-empty">No runs match.</p>}{shown.length > shownRows && <button type="button" className="plays-more" onClick={() => setShownRows(shown.length)}>Show all {shown.length} runs</button>}
    </div>
  }
  return (
    <Status loading={plays.loading} error={plays.error && `Plays are unavailable: ${plays.error}`}>
      <div className="ws-page ws-plays" data-plays>
        <div className="plays-bar">{homeTabs}{sharedFilters}</div>
        <HiddenSummary counts={hidden.counts} total={hidden.total} noun="plays" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
        <section className="ws-section">
          <div className="table-scroll">
            <PlaysTable rows={rows.slice(0, shownRows)} showHidden={showHidden} />
          </div>
          {rows.length > shownRows && (
            <button type="button" className="plays-more" onClick={() => setShownRows(rows.length)}>Show all {rows.length} plays</button>
          )}
          {!rows.length && <p className="chat-empty">No {hidden.plays && !showHidden ? 'shown ' : ''}play matches.</p>}
        </section>
      </div>
    </Status>
  )
}

// ---------------------------------------------------------------------------------------------------------
// /play/<id>
// ---------------------------------------------------------------------------------------------------------
/** The play's tabs: where it stands against its goal and bar first, then its releases, runs, findings and setup. */
type PlayTab = 'standing' | 'releases' | 'runs' | 'findings' | 'setup'
/** Old tab URLs land where their content went (section 2): the Story and Results on Standing, Spend on Runs, and so on. */
const PLAY_TAB_REDIRECTS: Record<string, { tab: PlayTab; patch?: Record<string, string> }> = {
  results: { tab: 'standing' },
  story: { tab: 'standing' },
  versions: { tab: 'releases' },
  spend: { tab: 'runs' },
  input: { tab: 'setup' },
  profiles: { tab: 'setup' },
  assessments: { tab: 'runs', patch: { judged: '1' } },
}

function PlayPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const play = useDocument<Play>(`${api}/plays/${encodeURIComponent(id)}`)
  // The report's `built` answers "Built" until the play serves `play_head.built`; fetched once.
  const report = useDocument<PlayReportDocument>(`${api}/plays/${encodeURIComponent(id)}/report`)
  // The head the host inlined in the shell paints the first screen before the play document arrives (B3).
  const inlined = useMemo(() => inlinedPlayHead(id), [id])
  const requested = params.get('tab') ?? 'standing'
  const redirect = PLAY_TAB_REDIRECTS[requested]
  useEffect(() => {
    if (redirect) update({ tab: redirect.tab === 'standing' ? undefined : redirect.tab, ...(redirect.patch ?? {}) }, true)
  }, [redirect, update])
  const tab: PlayTab = redirect?.tab ?? ((['standing', 'releases', 'runs', 'findings', 'setup'] as const).find((value) => value === requested) ?? 'standing')
  const judged = params.get('judged') === '1'
  const dimensions = useDocument<DimensionsDocument>(judged ? `${api}/dimensions` : null)
  // Assessments and the play's text and check script leave the default payload; their tabs ask for them.
  const extra = useDocument<Play>(tab === 'setup' ? `${api}/plays/${encodeURIComponent(id)}?include=setup` : judged ? `${api}/plays/${encodeURIComponent(id)}?include=assessments` : null)
  const profiles = useDocument<ProfileGraphDocument>(tab === 'setup' ? `${api}/plays/${encodeURIComponent(id)}/profiles` : null)
  const graph = profiles.data ?? null
  const selectedRun = params.get('run')
  const showHidden = params.get('show') === 'all'
  const doc = play.data
  const split = useMemo(() => splitRuns(doc?.runs ?? [], showHidden, ['failed']), [doc, showHidden])
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
  const playScope = useMemo(() => ({ kind: 'play' as const, play: id, runs: (doc?.runs ?? []).map((run) => run.id) }), [id, doc])
  const runDoc = useDocument<RunDocument>(tab === 'setup' && selectedRun && selectedRun !== doc?.input?.runId ? `${api}/runs/${encodeURIComponent(selectedRun)}` : null)
  const setupInput = extra.data?.input ?? doc?.input ?? null
  const input: PlayInput | null = selectedRun && selectedRun !== doc?.input?.runId ? (runDoc.data?.input ?? null) : setupInput
  const open = (runId: string, dimension?: string) =>
    go(`/run/${encodeURIComponent(runId)}${dimension ? `?tab=assessments&dim=${encodeURIComponent(dimension)}` : ''}`)
  const assessments = extra.data?.assessments ?? doc?.assessments ?? []
  const headlines = useMemo(() => {
    const map = new Map<string, PlayDocument['assessments']>()
    for (const row of assessments) map.set(row.runId, [...(map.get(row.runId) ?? []), row])
    return map
  }, [assessments])
  // The standing tab is the journey (lead pick 2026-10-24 22:20Z) wherever the host serves the play's view.
  const journey = tab === 'standing' && Boolean(doc?.view)
  const releaseCount = doc?.standing?.releases?.published ?? doc?.releases?.length ?? null
  const withheld = doc?.standing?.releases?.withheld ?? null
  const findingCount = doc?.findings?.length ?? 0
  const runCount = doc?.ledger?.runsTotal ?? doc?.runs.length ?? 0
  if (!doc && inlined && play.loading)
    return <PlayHeader play={{ ...(inlined as Play), id, title: id, runs: [] } as Play} />
  return (
    <Status loading={play.loading} error={play.error && `This play is unavailable: ${play.error}`}>
      {doc && (
        <div className="ws-page ws-play" data-play={doc.id}>
          {journey ? <PlayJourney play={doc} /> : <PlayHeader play={doc} report={report.data} compact={tab !== 'standing'} fallback={<PlayStanding play={doc} />} />}
          <Tabs
            label="Play"
            value={tab}
            onChange={(next) => update({ tab: next === 'standing' ? undefined : next, judged: undefined })}
            tabs={[
              ['standing', 'Standing'],
              ['releases', releaseCount ? `Releases ${releaseCount}${withheld ? ` · ${withheld} not published` : ''}` : 'Releases'],
              ['runs', `Runs ${runCount}`],
              ['findings', findingCount ? `Findings ${doc?.runs.some((run) => run.findings === null) ? '≥' : ''}${findingCount}` : 'Findings'],
              ['setup', 'Setup'],
            ] as const}
          />
          <div className="ws-content" role="tabpanel">
            {tab === 'standing' && journey && <PlayJourneyStanding play={doc} onOpen={open} onMore={() => update({ tab: 'findings' })} />}
            {tab === 'standing' && !journey && (
              <div className="play-standing-tab" data-section="standing">
                {!doc.standing && <PlayAnswer play={doc} />}
                <PlayClimb play={doc} />
                <PlayAgainstBar play={doc} />
                <PlayLedger play={doc} onOpen={open} />
                <PlayTeams api={api} play={doc} />
                <PlayFindings play={doc} limit={6} onMore={() => update({ tab: 'findings' })} />
              </div>
            )}
            {tab === 'releases' && <PlayReleases play={doc} />}
            {tab === 'findings' && (doc.findings?.length ? <PlayFindings play={doc} /> : <p className="ws-status">No result or claim has been written by this play&rsquo;s runs yet.</p>)}
            {tab === 'runs' && (
              <>
                {doc.ledger ? (
                  <PlayLedger play={doc} full onOpen={open} />
                ) : (
                  <>
                    <HiddenSummary counts={split.counts} total={doc.runs.length} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
                    <section className="ws-section">
                      <RunsTable play={view!} latestDigest={latestDigest} headlines={headlines} headline={dimensions.data ? new Set(dimensions.data.dimensions.filter((item) => item.headline).map((item) => item.id)) : null} onOpen={open} />
                    </section>
                  </>
                )}
                {judged ? (
                  <section className="ws-section" data-section="judged">
                    <h3>Judged dimensions</h3>
                    <Status loading={extra.loading} error={extra.error}>
                      {assessments.length ? <AssessmentMatrix play={{ ...view!, assessments }} dimensions={dimensions.data} onOpen={open} /> : <p className="faint">No judged dimension resolves for this play&rsquo;s runs.</p>}
                    </Status>
                  </section>
                ) : (
                  <p className="faint play-judged-link">
                    <button type="button" className="link-button" onClick={() => update({ judged: '1' })}>
                      Judged dimensions →
                    </button>
                  </p>
                )}
                {view!.gaps.length > 0 && (
                  <section className="ws-section gaps">
                    <h3>Missing evidence</h3>
                    <ul className="gap-list">
                      {gapCauses(view!.gaps).map((cause) => (
                        <li key={cause.code}>
                          <code>{cause.code}</code>{' '}
                          {cause.runs.length > 1 ? `${cause.runs.length} runs: ${cause.runs.map((run) => shortRun(doc.id, run)).join(', ')}` : <>{cause.runs[0] && <span className="mono">{shortRun(doc.id, cause.runs[0])} </span>}{cause.detail}</>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {tab === 'setup' && (
              <div className="play-setup" data-section="setup">
                <PlayBarTable play={doc} />
                <section className="ws-section">
                  <h3>Input</h3>
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
                <section className="ws-section" data-section="versions">
                  <h3>Profile versions</h3>
                  <HiddenSummary counts={split.counts} total={doc.runs.length} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />
                  <div className="lineage-layout">
                    <section className="lineage-pane" aria-label="Version graph">
                      {profiles.loading && !graph ? <p className="ws-status" role="status">Loading profile versions…</p> : null}
                      <VersionCanvas play={doc} graph={graph} versions={shownVersions} selection={selection} onSelect={select} />
                    </section>
                    <aside className="inspector-pane" aria-label="Inspector">
                      <Inspector api={api} play={doc} graph={graph} versions={versions} selection={selection ?? (shownVersions.at(-1) ? { kind: 'version', runId: shownVersions.at(-1)!.run.id } : null)} onSelect={select} />
                    </aside>
                  </div>
                  <Searches graph={graph} runId={selection?.runId ?? shownVersions.at(-1)?.run.id ?? null} />
                </section>
                {graph && (
                  <details className="ws-section" data-section="profiles">
                    <summary>
                      <b>Profiles</b> <span className="faint">every profile the play&rsquo;s runs registered or wrote</span>
                    </summary>
                    <ProfileCanvas api={api} doc={graph} scope={playScope} selected={params.get('profile')} onSelect={(short) => update({ profile: short ?? undefined })} />
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Status>
  )
}

/**
 * The play's standing as two facts: its best result (the newest run that won: its play check passed, or its root
 * submitted) and its latest run with how it is going.
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
            <StatusPill status={statusOf({ axis: 'run', state: 'winner' })} className="answer-value" />
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
          <StatusPill status={runStatus(latest, newerStarted(latest, play.runs))} />
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
  // A dollar column shows only when some run has a reading for it (X14); a zero beside unknown usage is no reading (R6).
  const costs = new Map(play.runs.map((run) => [run.id, { equivalent: apiEquivalent(run.spend), subscription: knownSubscription(run.spend) }]))
  const shown = {
    equivalent: play.runs.some((run) => costs.get(run.id)!.equivalent.usd !== null),
    subscription: play.runs.some((run) => costs.get(run.id)!.subscription !== null),
    api: play.runs.some((run) => run.spend.apiUsd !== null),
    sandbox: play.runs.some((run) => run.spend.sandboxUsd !== null),
  }
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
            {shown.equivalent && <th className="num" title="Every token at API list price, whoever paid; not a bill">API-equivalent</th>}
            {shown.subscription && <th className="num" title="Subscription model use at API prices; not billed">Subscription use</th>}
            {shown.api && <th className="num" title="Model API charges billed through Router">Model API</th>}
            {shown.sandbox && <th className="num" title="Billed sandbox compute">Sandbox compute</th>}
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
                  {run.purpose ? <div className="run-purpose-text">{goalText(run.purpose)}</div> : <span className="faint">not stated</span>}
                </td>
              )}
              <td className="run-state">
                <StatusPill status={runStatus(run, newerStarted(run, play.runs))} />
                {run.reason && run.reason !== run.state && <small className="faint clamp-1" title={run.reason}>{run.reason}</small>}
              </td>
              <td>{when(run.startedAt)}</td>
              <td>{duration(run.durationMs)}</td>
              <td>{run.nodes ?? '—'}{run.depth !== null && run.nodes ? <small className="faint"> depth {run.depth}</small> : null}</td>
              {shown.equivalent && (() => {
                const value = costs.get(run.id)!.equivalent
                return <td className={`num ${value.usd === null ? 'unknown' : ''}`}>{money(value.usd)}{value.partial ? '+' : ''}</td>
              })()}
              {shown.subscription && (() => {
                const value = costs.get(run.id)!.subscription
                return <td className={`num ${value === null ? 'unknown' : ''}`}>{money(value)}{!run.spend.subscriptionKnown && value !== null ? '+' : ''}</td>
              })()}
              {shown.api && <td className={`num ${run.spend.apiUsd === null ? 'unknown' : ''}`}>{money(run.spend.apiUsd)}</td>}
              {shown.sandbox && <td className={`num ${run.spend.sandboxUsd === null ? 'unknown' : ''}`}>{money(run.spend.sandboxUsd)}</td>}
              <td>
                {run.record.capture ? (
                  <CaptureBar capture={run.record.capture} />
                ) : (
                  <span className="faint">{run.record.status}</span>
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

/** Gaps grouped by cause (X13): one line per cause with the runs it covers, instead of one line per run and gap. */
function gapCauses(gaps: { code: string; runId?: string; detail: string }[]) {
  const causes = new Map<string, { code: string; runs: string[]; detail: string; count: number }>()
  for (const gap of gaps) {
    const cause = causes.get(gap.code) ?? { code: gap.code, runs: [], detail: gap.detail, count: 0 }
    cause.count += 1
    if (gap.runId && !cause.runs.includes(gap.runId)) cause.runs.push(gap.runId)
    causes.set(gap.code, cause)
  }
  return [...causes.values()]
}

const SPEEDS = [1, 4, 16, 64, 256, 1024, 4096]
/** The selected agent's own views; the run's spend, assessments, input and coverage are sections of the run page. */
type AgentTab = 'messages' | 'timeline' | 'usage'
const AGENT_TABS = [
  ['messages', 'Messages'],
  ['timeline', 'Timeline'],
  ['usage', 'Usage'],
] as const

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
 * The run page: a header, the run's answer in one strip, and one tab bar. Findings (what the agents wrote) open first;
 * Agents is a rail of the run's agents beside the selected agent's conversation; the other sections are the run's
 * graph, readout, outputs, spend, assessments, input and coverage, each full width. The page draws from the record's
 * node list; an agent's events load only when a section needs them, so a run with a 5 MB record opens as fast as a
 * small one.
 */
function RunPage({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  // `?agent=<name>` (the Lab fold's agent name: root, s3, s3:s0), the link the explorer and the Lab's computed-column
  // disagreements write, opens that agent's conversation: it becomes `section=agents&node=<run>:<name>` in place.
  const linkedAgent = params.get('agent')
  useEffect(() => {
    if (!linkedAgent) return
    update({ agent: undefined, section: 'agents', node: linkedAgent === 'root' ? id : `${id}:${linkedAgent}` }, true)
  }, [linkedAgent, id])
  const [poll, setPoll] = useState<number | undefined>(undefined)
  const runUrl = `${api}/runs/${encodeURIComponent(id)}`
  // A saved grade changes the run's document; asking under a new query fetches it again (the host ignores the query).
  const [revision, setRevision] = useState(0)
  // The finding open in the run's findings; the agent rail and the graph open one there too.
  const [finding, setFinding] = useState<string | null>(null)
  const [capturedStreams, setCapturedStreams] = useState<ReadonlySet<string>>(() => new Set())
  const openedLiveStream = useRef<string | null>(null)
  const run = useDocument<RunDocument>(revision ? `${runUrl}?revision=${revision}` : runUrl, poll, true)
  // The play supplies the run's best against the play's, its lineage and the run that continued it.
  const play = useDocument<Play>(run.data ? `${api}/plays/${encodeURIComponent(run.data.run.play)}` : null)
  // A live run's record digest changes every few seconds; a new digest refetches the parts, so this sets the delay.
  useEffect(() => setPoll(run.data?.live.polling ? 3_000 : undefined), [run.data?.live.polling])
  const digest = run.data?.run.record.digest ?? null
  const recordReady = run.data?.run.record.status === 'ready' || !!digest
  const version = digest ? `&digest=${digest}` : ''
  const nodes = useRecordPart(recordReady ? `${runUrl}/record?part=nodes${version}` : null)
  const assessments = useDocument<AssessmentsDocument>(`${runUrl}/assessments${digest ? `?digest=${digest}` : ''}`, undefined, true)
  const dimensions = useDocument<DimensionsDocument>(`${api}/dimensions`)
  const catalogue = useMemo(() => dimensionMap(dimensions.data), [dimensions.data])
  const section = sectionOf(params)
  const requested = params.get('node')
  const index = nodes.index
  const streamNode = requested ?? id
  const archivedCapture = recordReady && !run.data?.execution?.alive && ['archive', 'none'].includes(run.data?.run.location?.kind ?? '') && openedLiveStream.current !== streamNode
  // A settled run with a record opens its agents from the record: the agent rail with each agent's bead string, not the
  // root's last 200 stream events (18b's Conversations showed 18:34-18:55Z while its root streamed until 02:42Z). Only a
  // live run, or an agent the record does not hold, reads the stream.
  const settledRecord = !run.data?.execution?.alive && recordReady && (!index || index.nodes.has(index.canonical(streamNode)))
  const streamConversation = !!run.data?.execution && !settledRecord && !archivedCapture && !capturedStreams.has(streamNode) && !['timeline', 'usage'].includes(params.get('tab') ?? '')
  useEffect(() => {
    if (section === 'agents' && streamConversation && run.data?.execution?.alive) openedLiveStream.current = streamNode
    else if (section !== 'agents' || !streamConversation) openedLiveStream.current = null
  }, [section, streamConversation, streamNode, run.data?.execution?.alive])
  const root = index ? (index.actors.find((node) => node.parent === null && node.kind === 'agent')?.id ?? index.actors[0]?.id ?? null) : null
  const actor = index && requested && index.nodes.has(index.canonical(requested)) ? index.canonical(requested) : root
  const agent = useRecordPart(section && AGENT_PART_SECTIONS.has(section) && !(section === 'agents' && streamConversation) && actor ? `${runUrl}/record?node=${encodeURIComponent(actor)}${version}` : null)
  const summary = run.data?.run
  if (run.error && !run.data) return <p className="ws-status" role="alert">This run is unavailable: {run.error}</p>
  if (!summary) return <p className="ws-status" role="status">Loading…</p>
  const doc = run.data!
  // One URL key per section: the section, plus what that section shows (the agent, its tab, the file).
  const open = (next: RunSection, patch: Record<string, string | undefined> = {}) => update({ section: next, view: undefined, drawer: undefined, ...patch })
  const counts = overviewCounts(doc, index)
  const tabs = <RunTabBar section={section} counts={counts} onOpen={(next) => (next ? open(next, { tab: undefined }) : update({ section: undefined, node: undefined, tab: undefined, event: undefined, t: undefined, commit: undefined, file: undefined, profile: undefined, view: undefined, drawer: undefined, graph: undefined }))} />
  if (section === null)
    return (
      <div className="ws-page ws-run" data-run={summary.id} data-section="overview">
        <Suspense fallback={<p className="ws-status" role="status">Loading…</p>}>
          <LazyRunWorkspace
            api={api}
            doc={doc}
            transcript={(node, select) =>
              settledRecord && index ? (
                <AgentConversation key={node} runUrl={runUrl} version={version} index={index} actor={index.nodes.has(index.canonical(node)) ? index.canonical(node) : root ?? node} />
              ) : (
                <LiveTranscript runUrl={runUrl} runId={doc.run.id} alive={Boolean(doc.execution?.alive)} selected={node} onSelect={select} />
              )
            }
          />
          {tabs}
          <RunWhy doc={doc} play={play.data} />
          <RunOverview api={api} doc={run.data!} play={play.data} nodes={index ? index.actors : null} stats={nodes.stats} open={(next, patch) => open(next as RunSection, patch)} />
        </Suspense>
      </div>
    )
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
  return (
    <div className="ws-page ws-run" data-run={summary.id} data-section={section}>
      <RunStatusLine doc={doc} play={play.data} />
      {tabs}
      {section === 'findings' &&
        (doc.findings?.total ? (
          <RunFindings doc={doc} runUrl={runUrl} open={finding} onOpen={setFinding} />
        ) : (
          <p className="ws-status run-panel">No knowledge pages were recorded for this run. Its agents are under Agents.</p>
        ))}
      {section === 'graph' && (
        <>
          <div className="graph-modes" role="group" aria-label="Graph view">
            {(
              [
                ['work', 'Work'],
                ['provenance', 'Provenance'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`run-tab ${(params.get('graph') === 'provenance' ? 'provenance' : 'work') === value ? 'on' : ''}`}
                aria-pressed={(params.get('graph') === 'provenance' ? 'provenance' : 'work') === value}
                data-graph-mode={value}
                onClick={() => update({ section: 'graph', graph: value === 'work' ? undefined : value })}
              >
                {label}
              </button>
            ))}
          </div>
          {params.get('graph') === 'provenance' ? (
            <section className="run-panel run-profiles" aria-label="Provenance">
              <ProvenanceCanvas doc={doc} runUrl={runUrl} onOpenPage={openFinding} />
            </section>
          ) : (
            <WorkGraph doc={doc} runUrl={runUrl} onOpen={openFinding} />
          )}
        </>
      )}
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
          <FinalOutputPanel output={doc.finalOutput} grading={grading} run={doc.run} />
        </section>
      )}
      {section === 'outputs' && (
        <section className="run-panel" aria-label="Outputs" data-drawer="outputs">
          <Suspense fallback={null}><LazyOutputsView doc={doc} grading={grading} selected={params.get('file')} navigation={artifactNavigation(params, update)} onSelect={(file) => update({ section: 'outputs', file: file ?? undefined })} onClose={() => open('findings')} /></Suspense>
        </section>
      )}
      {section === 'input' && (
        <section className="run-panel" aria-label="Input">
          <InputView input={doc.input} api={api} />
        </section>
      )}
      {section === 'agents' && doc.execution && streamConversation && <LiveTranscript runUrl={runUrl} runId={summary.id} alive={doc.execution.alive} selected={requested ?? (doc.execution.alive ? newestAgent(doc) : null)} onSelect={selectAgent} onRecorded={recordReady ? () => open('agents', { tab: 'timeline' }) : undefined} onEmpty={!doc.execution.alive && recordReady && index?.nodes.has(index.canonical(streamNode)) ? () => setCapturedStreams((prior) => new Set([...prior, streamNode])) : undefined} />}
      {index && section === 'agents' && !streamConversation && actor && (
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
              stats={nodes.stats}
              onSelectAgent={selectAgent}
            />
          ) : (
            loadingAgent
          )}
        </section>
      )}
      {!index && AGENT_PART_SECTIONS.has(section) && !(section === 'agents' && streamConversation) && (
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

/** The counts the detail bar shows beside its views. */
function overviewCounts(doc: RunDocument, index: RecordIndex | null): Partial<Record<RunSection, number>> {
  return {
    findings: doc.findings?.items.filter((item) => item.kind === 'result' || item.kind === 'claim').length,
    agents: index?.actors.filter((node) => node.kind !== 'finding').length,
    outputs: doc.finalOutput?.files.length,
  }
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
  // This agent's lane in the run receipt's timeline (its attempts and spans), named by the node id after the run id.
  const lane = useMemo(() => {
    const lanes = doc.receipt?.timeline?.lanes ?? []
    const local = actor.startsWith(`${runId}:`) ? actor.slice(runId.length + 1) : actor === runId ? 'root' : actor
    return lanes.find((item) => item.id === local) ?? null
  }, [doc.receipt, actor, runId])
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
  const loadSource = useMemo(() => readSource(`${api}/runs/${encodeURIComponent(runId)}`), [api, runId])
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
  const agentStatus = statusOf({ axis: 'agent', status: node?.status, live: doc.live.polling })
  return (
    <div className="agent-drawer" onScrollCapture={hideTooltip}>
      <section className="ws-panel" aria-label="Agent record">
        <div className="agent-head">
          <div className="agent-identity">
            <span className="agent-avatar" data-status={dataStatus(agentStatus)} aria-hidden="true">
              {role.slice(0, 1).toUpperCase()}
              <i className="status-shape">{agentStatus.shape}</i>
            </span>
            <div>
              <h2 data-agent-title>{node?.label ?? actor}</h2>
              <p className="agent-meta">
                {[role, model, node?.harness as string | undefined, agentState(node, measured, doc.live.polling ? (doc.progress?.agents.find((agent) => agent.node === actor)?.status ?? 'running') : null)].filter(Boolean).join(' · ')}
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
        {lane && (
          <BeadString
            lane={lane}
            start={index.start}
            end={index.end}
            cutoff={cutoff}
            onSeek={(iso) => {
              setPlaying(false)
              select({ t: iso, tab: undefined }, true)
            }}
          />
        )}
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
          {tooltip.lines.map((line, i) => <p key={i}>{typeof line === 'string' ? line : line.value}</p>)}
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
  stats,
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
  stats: Record<string, NodeStats>
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
  if (section === 'coverage') return <Coverage index={index} doc={doc} gaps={gaps} stats={stats} onSelect={onSelectAgent} />
  return (
    <div className="spend-tab">
      <h3>Agents in this run</h3>
      <SpendBars
        rows={agentSpendRows(doc.spend.nodes, index.actors.filter((item) => item.kind !== 'finding'))}
        onOpen={(row) => row.href && onSelectAgent(row.href)}
        why="no per-agent meter"
      />
      {byModel(doc.spend).length > 0 && (
        <>
          <h3>By model</h3>
          <p className="faint">The Router bill cannot be split by model.</p>
          <SpendBars rows={byModel(doc.spend)} noun="models" />
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

const CAPTURE_WORD: Record<string, string> = { complete: 'Captured', lossy: 'Partly captured', absent: 'Not captured' }

/**
 * Each agent's capture and state. `index` holds only the selected agent's part, so whether an agent's usage was measured
 * comes from the nodes part's per-agent stats, as in the agents table; on magnetar-rust-20261018b the event scan alone
 * printed "no usage recorded" for the 14 workers whose 62.5M tokens the record holds.
 */
function Coverage({ index, doc, gaps: recordGaps, stats, onSelect }: { index: RecordIndex; doc: RunDocument; gaps: RecordGap[]; stats: Record<string, NodeStats>; onSelect: (id: string) => void }) {
  const gaps = [...recordGaps, ...doc.spend.gaps]
  const measured = (id: string) => measuredUsage(index, id) || (!!stats[id] && (stats[id]!.tokens !== null || stats[id]!.listUsd !== null))
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
                <td><span className={`capture-chip capture-${capture?.status ?? 'unknown'}`}>{CAPTURE_WORD[capture?.status ?? ''] ?? 'Capture unknown'}</span></td>
                <td className="mono faint">{capture?.reason ?? ''}</td>
                <td>{agentState(node, measured(node.id), doc.live.polling ? (doc.progress?.agents.find((agent) => agent.node === node.id)?.status ?? 'running') : null)}</td>
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

/** The receipt is the run overview in print mode, supplied by the same Lab document. */
function ReceiptPage({ api, id }: { api: string; id: string }) {
  const [runId, tag] = id.split('@')
  const url = `${api}/runs/${encodeURIComponent(runId!)}/receipt${tag ? `/${encodeURIComponent(tag)}` : ''}/receipt.json`
  const doc = useDocument<RunReceipt>(url)
  // The print view states the outcome too (B5): the run's progress outcome when the run document has one, else the
  // verdict the receipt's own check recorded.
  const run = useDocument<RunDocument>(`${api}/runs/${encodeURIComponent(runId!)}`)
  if (!doc.data) return <p role="status">{doc.error ?? 'Loading receipt…'}</p>
  return <div className="agent-record ar-ws" data-theme="light"><RunReceiptView api={api} receipt={doc.data} print outcome={run.data?.progress?.outcome ?? outcomeOfCheck(doc.data)} /></div>
}
