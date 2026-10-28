import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PageHeader, SegmentedControl } from '@tangle-network/ui/primitives'
import { Icon, Picker } from './workspace/run/ui.js'
import type { AssessmentsDocument, DimensionsDocument } from './assessment.js'
import type { RecordGap } from './record.js'
import { RunFindings } from './workspace/Findings.js'
import { WorkGraph } from './workspace/WorkGraph.js'
import { FindingsFeed, REVIEWS } from './workspace/FindingsFeed.js'
import { PlayBarTable } from './workspace/PlayBarTable.js'
import { PlayJourney } from './workspace/PlayJourney.js'
import { ExplorePage } from './workspace/Explore.js'
import { PlayHeader } from './workspace/PlayHead.js'
import { ApiCost, PlayLedger } from './workspace/PlayLedger.js'
import { PlayFindings } from './workspace/PlayFindings.js'
import { PlayReleases } from './workspace/PlayReleases.js'
import { PlaysTable } from './workspace/PlaysTable.js'
import { inlinedPlayHead, type PlayHead } from './workspace/play-standing.js'
import { TheatrePage } from './workspace/Theatre.js'
import { RunVersions } from './workspace/VersionGraph.js'
import type { PlayDocument, PlayInput, PlaysDocument, ProfileGraphDocument, RunDocument } from './workspace-model.js'
type Play = PlayDocument & PlayHead
import type { RecordIndex } from './viewer/model.js'
import { AssessmentMatrix, dimensionMap, RunAssessments } from './workspace/Assessments.js'
import { duration, go, money, newerStarted, runStatus, StatusPill, useDocument, when } from './workspace/data.js'
import { FinalOutputPanel } from './workspace/FinalOutput.js'
import { InputView } from './workspace/InputView.js'
import { ReliabilityPanel } from './workspace/Reliability.js'
import { Searches } from './workspace/SearchView.js'
import { HIDDEN_LABEL, HIDDEN_ORDER, splitHidden, splitRuns } from './workspace/plays-filter.js'
import type { HiddenReason } from './workspace/plays-filter.js'
import { findProfile, profileGraph, runOfProfile } from './workspace/profile-graph.js'
import { versionsOf } from './workspace/profile-compare.js'
import { outcomeOfCheck, RunOverview, RunReceiptView } from './workspace/RunOverview.js'
import type { RunReceipt } from './workspace/run-receipt.js'
import { RunHow } from './workspace/RunHow.js'
import { Coverage } from './workspace/Coverage.js'
import { useRecordPart } from './workspace/record-part.js'
import { artifactNavigation, useSearch } from './workspace/navigation.js'
import { goalText } from './workspace/plain-words.js'
import { isLazyMode, type LazyMode, LazyOutputsView, LazyPage, LazyRunPage } from './workspace/lazy-pages.js'
import { AsOfStamp } from './workspace/AnswerStrip.js'
import { AGENT_PART_SECTIONS, type RunSection, sectionOf } from './workspace/RunTabs.js'
import type { NodeStats } from './workspace/RunTable.js'
import { Inspector, type Selection, VersionCanvas } from './workspace/VersionCanvas.js'
import { ProfileCanvas } from './workspace/ProfileCanvas.js'
import { ProvenanceCanvas } from './workspace/ProvenanceCanvas.js'
import { apiEquivalent, knownSubscription, spendGapLabel } from './workspace/Spend.js'

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
    <div className="agent-record ar-ws" data-theme={theme === 'auto' ? undefined : theme}>
      {mode === 'receipt' ? <ReceiptPage api={api} id={id} /> : mode === 'explore' ? <ExplorePage api={api} /> : isLazyMode(mode) ? <Suspense fallback={null}><LazyPage mode={mode} api={api} /></Suspense> : mode === 'theatre' ? <TheatrePage api={api} id={id} /> : mode === 'plays' ? <PlaysPage api={api} /> : mode === 'play' ? <PlayPage api={api} id={id} /> : <Suspense fallback={null}><LazyRunPage api={api} id={id} legacy={() => <LegacyRunSection api={api} id={id} />} /></Suspense>}
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
/** What the default filter holds back, as one toggle in the filter bar (a loose "190 of 480 hidden ☐ Show them" line read as
 * stray text, judges 10-27); its reasons are the toggle's tooltip. */
function HiddenToggle({ counts, noun, showHidden, onChange }: { counts: Record<HiddenReason, number>; noun: string; showHidden: boolean; onChange: (all: boolean) => void }) {
  const hidden = HIDDEN_ORDER.reduce((sum, reason) => sum + counts[reason], 0)
  if (!hidden) return null
  return (
    <button type="button" className="rp-btn framed hidden-filter" aria-pressed={showHidden} data-show-hidden data-hidden-summary onClick={() => onChange(!showHidden)}
      title={HIDDEN_ORDER.filter((reason) => counts[reason] > 0).map((reason) => `${counts[reason]} ${reason === 'failed' && noun === 'plays' ? 'retired plays never ran clean' : HIDDEN_LABEL[reason]}`).join(' · ')}>
      {showHidden ? `Hide ${hidden} retired` : `Show ${hidden} hidden`}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------------------
// /plays: every play this host has a run of
// ---------------------------------------------------------------------------------------------------------
const PLAYS_PAGE = 50
/** Plays with any run still running (Today counts the same): an older run can be live while the newest has stopped. */
const runningPlays = (doc: PlaysDocument) => new Set([...(doc.runs ?? []).filter((run) => run.state === 'running').map((run) => run.play), ...doc.plays.filter((play) => play.latestRun?.state === 'running').map((play) => play.id)]).size
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
    // Each order reads the column it sorts.
    const spent = (play: PlaysDocument['plays'][number]) => play.standing?.cost?.apiEquivalentUsd ?? -1
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
            ? spent(b) - spent(a)
            : sort === 'runs'
              ? b.runCount - a.runCount
              : String(b.latestRun?.startedAt ?? '').localeCompare(String(a.latestRun?.startedAt ?? '')),
      )
    return { rows, hidden: { plays: hidden, counts, total: matching.length } }
  }, [plays.data, query, program, sort, showHidden])
  // Each play's newest running run, so a play running an older run never reads as its newest, stopped one.
  const live = useMemo(() => new Map((plays.data?.runs ?? []).filter((run) => run.state === 'running').sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? ''))).map((run) => [run.play, run.id])), [plays.data])
  const home = (['plays', 'findings', 'runs'] as const).find((value) => value === params.get('view')) ?? 'plays'
  const ORDERS = [['latest', 'Latest run first'], ['spend', 'Most API-equivalent first'], ['runs', 'Most runs first'], ['name', 'By name']] as const
  const order = home !== 'plays' ? null : (
    <Picker label="Order" value={sort} options={ORDERS.map(([id, label]) => ({ id, label }))} width={260} placeholder="Order plays"
      onChange={(value) => update({ sort: !value || value === 'latest' ? undefined : value })}>
      {ORDERS.find(([id]) => id === sort)?.[1] ?? 'Latest run first'}
    </Picker>
  )
  const sharedFilters = <div className="message-filters plays-filters" aria-label="Research filters"><label className="rp-field"><Icon name="search" /><input type="search" aria-label="Search research" placeholder="Search research" value={draft}
      onChange={(event) => { setDraft(event.target.value); update({ q: event.target.value || undefined }, true) }} /></label>
    <Picker label="Program" value={program || null} all={{ label: 'All programs' }} options={programs.map((item) => ({ id: item, label: item }))} width={260} placeholder="Search programs"
      onChange={(value) => update({ program: value ?? undefined })}>
      {program || 'All programs'}
    </Picker>
    {order}
    {home === 'plays' && <HiddenToggle counts={hidden.counts} noun="plays" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} />}
  </div>
  const frontiers = !plays.data?.frontiers?.length ? null : <details className="research-frontiers" aria-label="Frontier statements">
    <summary className="faint">Frontier statements ({plays.data.frontiers.length}, as of {plays.data.frontiers.map((item) => item.asOf).filter(Boolean).sort().at(-1) ?? 'an unrecorded date'})</summary>
    <div className="research-frontier-list">{(plays.data?.frontiers ?? []).map((item) =>
      <a key={item.id} href={`/plays?view=plays&q=${encodeURIComponent(item.id)}`} className="research-frontier">
        <strong>{item.id.replaceAll('-', ' ')}</strong><span>{item.statement || 'No statement recorded'}</span>
        <small>{item.asOf || 'date unknown'} · {item.banked} banked · {item.next} next</small>
      </a>)}</div>
  </details>
  const playsHeader = (
    <PageHeader className="rp-head" title="Plays"
      actions={plays.data ? <ul className="rp-stats"><li><b>{plays.data.plays.length}</b> plays</li><li><b>{runningPlays(plays.data)}</b> running</li></ul> : undefined} />
  )
  const homeTabs = (
    <SegmentedControl aria-label="Research views" className="ws-views" value={home} onValueChange={(value) => update({ view: value === 'plays' ? undefined : value })}
      options={[{ value: 'plays', label: 'Plays' }, { value: 'findings', label: 'Findings' }, { value: 'runs', label: 'Runs' }]} />
  )
  if (home === 'findings')
    return (
      <div className="ws-page ws-plays" data-plays-home="findings">
        {playsHeader}
        <div className="plays-bar">{homeTabs}{sharedFilters}</div>
        <FindingsFeed api={api} query={query} program={program} review={REVIEWS.find(([id]) => id === params.get('review'))?.[0] ?? null} onReview={(review) => update({ review: review ?? undefined })} />
        {frontiers}
      </div>
    )
  if (home === 'runs') {
    const cutoff = Date.now() - 30 * 86400_000
    const all = plays.data?.runs ?? []
    const shown = all.filter((run) => (run.state === 'running' || (run.startedAt && Date.parse(run.startedAt) >= cutoff))
      && (!program || run.program === program) && (!query || `${run.id} ${run.play} ${run.reason ?? ''} ${run.stopCause ?? ''}`.toLowerCase().includes(query.toLowerCase())))
    const clock = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '—')
    return <div className="ws-page ws-plays" data-plays-home="runs">
        {playsHeader}
      <div className="plays-bar">{homeTabs}{sharedFilters}</div>
      {/* One answer region (journey Q6): which runs ran clean, what still kills them, and every run. */}<div className="runs-answer"><ReliabilityPanel api={api} />
      <div className="table-scroll"><table className="data-table runs-table" data-run-ledger>
        <caption className="faint">{shown.length} runs, last 30 days</caption>
        <thead><tr><th>Run</th><th>State</th><th>Started</th><th>Last activity</th><th>Outcome</th><th className="num" title="Every token at list price, whoever paid: the run page's figure">API-equivalent</th></tr></thead>
        <tbody>{shown.slice(0, shownRows).map((run) => <tr key={run.id}>
          <td><a href={`/run/${encodeURIComponent(run.id)}`}>{run.play}</a><small className="faint mono" title={run.id}> {/\d{6}(\d\d[a-z])$/.exec(run.id)?.[1] ?? run.id}</small></td>
          <td><StatusPill status={runStatus(run, newerStarted(run, all))} /></td>
          <td className="nowrap">{clock(run.startedAt)}</td><td className="nowrap">{clock(run.activeAt)}</td><td>{run.stopCause || run.reason || '—'}</td><td className="num"><ApiCost usd={run.apiEquivalentUsd} provenance={run.apiEquivalentProvenance} /></td>
        </tr>)}</tbody>
      </table></div></div>
      {!shown.length && <p className="chat-empty">No runs match.</p>}{shown.length > shownRows && <button type="button" className="plays-more" onClick={() => setShownRows(shown.length)}>Show all {shown.length} runs</button>}
    </div>
  }
  return (
    <Status loading={plays.loading} error={plays.error && `Plays are unavailable: ${plays.error}`}>
      <div className="ws-page ws-plays" data-plays>
        {playsHeader}
        <div className="plays-bar">{homeTabs}{sharedFilters}</div>
        <section className="ws-section">
          <div className="table-scroll">
            <PlaysTable rows={rows.slice(0, shownRows)} sort={sort} onSort={(next) => update({ sort: next ?? undefined })} live={live} />
          </div>
          {rows.length > shownRows && (
            <div className="plays-page"><span>Showing {shownRows} of {rows.length} plays</span><button type="button" className="rp-btn sm framed" onClick={() => setShownRows(rows.length)}>Show all</button></div>
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
  const releaseCount = doc?.standing?.releases?.published ?? doc?.releases?.length ?? null
  const findingCount = doc?.findings?.length ?? 0
  const runCount = doc?.ledger?.runsTotal ?? doc?.runs.length ?? 0
  if (!doc && inlined && play.loading)
    return <PlayHeader play={{ ...(inlined as Play), id, title: id, runs: [] } as Play} />
  return (
    <Status loading={play.loading} error={play.error && `This play is unavailable: ${play.error}`}>
      {doc && (
        <div className="ws-page ws-play" data-play={doc.id}>
          <PlayHeader play={doc} linked={tab !== 'standing'} />
          <Tabs
            label="Play"
            value={tab}
            onChange={(next) => update({ tab: next === 'standing' ? undefined : next, judged: undefined })}
            tabs={[
              ['standing', 'Standing'],
              ['releases', releaseCount ? `Releases ${releaseCount}` : 'Releases'],
              ['runs', `Runs ${runCount}`],
              ['findings', findingCount ? `Findings ${doc?.runs.some((run) => run.findings === null) ? '≥' : ''}${findingCount}` : 'Findings'],
              ['setup', 'Setup'],
            ] as const}
          />
          <div className="ws-content" role="tabpanel">
            {tab === 'standing' && <PlayJourney play={doc} />}
            {tab === 'releases' && <PlayReleases play={doc} />}
            {tab === 'findings' && (doc.findings?.length ? <PlayFindings play={doc} /> : <p className="ws-status">No result or claim has been written by this play&rsquo;s runs yet.</p>)}
            {tab === 'runs' && (
              <>
                {doc.ledger ? (
                  <PlayLedger play={doc} full onOpen={open} action={!judged && (
                    // The judged view is a control of the ledger, in its header, not a link floating under the tab.
                    <button type="button" className="link-button play-judged-link" onClick={() => update({ judged: '1' })}>Judged dimensions</button>
                  )} />
                ) : (
                  <>
                    <div className="hidden-row"><HiddenToggle counts={split.counts} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} /></div>
                    <section className="ws-section">
                      <RunsTable play={view!} latestDigest={latestDigest} headlines={headlines} headline={dimensions.data ? new Set(dimensions.data.dimensions.filter((item) => item.headline).map((item) => item.id)) : null} onOpen={open} />
                    </section>
                  </>
                )}
                {judged && (
                  <section className="ws-section" data-section="judged">
                    <h3>Judged dimensions</h3>
                    <Status loading={extra.loading} error={extra.error}>
                      {assessments.length ? <AssessmentMatrix play={{ ...view!, assessments }} dimensions={dimensions.data} onOpen={open} /> : <p className="faint">No judged dimension resolves for this play&rsquo;s runs.</p>}
                    </Status>
                  </section>
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
                <section className="ws-section play-input" data-section="input">
                  <div className="input-run-picker">
                    <Picker label="Run" value={selectedRun ?? doc.input?.runId ?? null} width={320} placeholder={`Search ${doc.runs.length} runs`}
                      options={doc.runs.map((run) => ({ id: run.id, label: shortRun(doc.id, run.id), meta: `${when(run.startedAt)}${run.inputDigest && latestDigest && run.inputDigest !== latestDigest ? ' · different input' : ''}` }))}
                      onChange={(value) => update({ run: !value || value === doc.input?.runId ? undefined : value })}>
                      {shortRun(doc.id, selectedRun ?? doc.input?.runId ?? '')}
                    </Picker>
                  </div>
                  <Status loading={runDoc.loading} error={runDoc.error}>
                    <InputView compact input={input} api={api} changed={!!input && !!latestDigest && input.digest !== latestDigest} more={<>
                        <section className="input-block" data-section="versions">
                          <h4>Profile versions</h4>
                          <div className="hidden-row"><HiddenToggle counts={split.counts} noun="runs" showHidden={showHidden} onChange={(all) => update({ show: all ? 'all' : undefined })} /></div>
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
                          <section className="input-block" data-section="profiles">
                            <h4>Profiles</h4>
                            <ProfileCanvas api={api} doc={graph} scope={playScope} selected={params.get('profile')} onSelect={(short) => update({ profile: short ?? undefined })} />
                          </section>
                        )}
                    </>} />
                  </Status>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </Status>
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

/** The selected agent's own views; the run's spend, assessments, input and coverage are sections of the run page. */

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
 * A run section from before the tabs (findings, graph, versions, profiles, readout, input, assessments, capture): drawn under
 * the run page's header and tab bar when a link names it with `?section=`. The tabs hold everything else.
 */
function LegacyRunSection({ api, id }: { api: string; id: string }) {
  const [params, update] = useSearch()
  const [poll, setPoll] = useState<number | undefined>(undefined)
  const runUrl = `${api}/runs/${encodeURIComponent(id)}`
  // A saved grade changes the run's document; asking under a new query fetches it again (the host ignores the query).
  const [revision, setRevision] = useState(0)
  // The finding open in the run's findings; the agent rail and the graph open one there too.
  const [finding, setFinding] = useState<string | null>(null)
  const [capturedStreams, setCapturedStreams] = useState<ReadonlySet<string>>(() => new Set())
  const openedLiveStream = useRef<string | null>(null)
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
  // How it ran reads the run document and the nodes part's per-agent stats; it needs no agent's record part.
  const how = <RunHow doc={doc} runUrl={runUrl} agents={index ? index.actors.filter((item) => item.kind !== 'finding') : []} stats={nodes.stats} onAgent={(node) => `?section=agents&node=${encodeURIComponent(node)}`} dimensions={catalogue} />
  const versionsPanel = (
    <RunVersions
      runUrl={runUrl}
      poll={doc.live.polling ? 15_000 : undefined}
      selected={params.get('commit')}
      onSelect={(commit) => update({ section: section ?? undefined, commit })}
      onClose={() => update({ commit: undefined })}
      onOpenAgent={(node) => update({ section: 'agents', node, commit: undefined, view: undefined, drawer: undefined, event: undefined, t: undefined, file: undefined })}
      delivered={doc.finalOutput?.files} onOpenFile={(file) => update({ section: 'outputs', file, commit: undefined, details: undefined })}
    />
  )
  if (section === null) return null
  return (
    <div className="ws-page ws-run" data-run={summary.id} data-section={section}>
      {section === 'findings' &&
        (doc.findings?.total ? (
          <RunFindings doc={doc} runUrl={runUrl} open={finding} onOpen={setFinding} />
        ) : (
          <p className="ws-status run-panel">No knowledge pages were recorded for this run. Its agents are under Agents.</p>
        ))}
      {section === 'graph' && (
        <>
          <SegmentedControl aria-label="Graph view" className="graph-modes" value={params.get('graph') === 'provenance' ? 'provenance' : 'work'}
            onValueChange={(value) => update({ section: 'graph', graph: value === 'work' ? undefined : value })}
            options={[{ value: 'work', label: 'Work' }, { value: 'provenance', label: 'Provenance' }]} />
          {params.get('graph') === 'provenance' ? (
            <section className="run-panel run-profiles" aria-label="Provenance">
              <ProvenanceCanvas doc={doc} runUrl={runUrl} onOpenPage={openFinding} />
            </section>
          ) : (
            <WorkGraph doc={doc} runUrl={runUrl} onOpen={openFinding} />
          )}
        </>
      )}
      {section === 'versions' && versionsPanel}
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
      {section === 'spend' && <section className="run-panel" aria-label="Time and cost">{how}</section>}
      {index && (section === 'assessments' || section === 'coverage') && actor && (
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
  section: 'assessments' | 'coverage'
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
  // A cited event of another agent is in that agent's part: open the agent it names (event ids start with the node id).
  const cite = (eventId: string) => {
    const event = index.byEvent.get(eventId)
    const owner = event ? index.canonical(event.node) : index.canonical(eventId.split('#')[0] ?? '')
    if (!index.nodes.has(owner)) return
    update({ section: 'agents', node: owner, event: eventId, tab: undefined, t: undefined })
  }
  if (section === 'assessments')
    return <RunAssessments doc={assessments} dimensions={dimensions} index={index} node={actor} focus={params.get('dim')} onFocus={(dimension) => update({ dim: dimension }, true)} onCite={cite} />
  return <Coverage index={index} doc={doc} gaps={gaps} stats={stats} onSelect={onSelectAgent} />
}

/** The run overview in print mode over the run document (its check facts too); a tagged release's receipt is the receipt alone. */
function ReceiptPage({ api, id }: { api: string; id: string }) {
  const [runId, tag] = id.split('@')
  const url = `${api}/runs/${encodeURIComponent(runId!)}/receipt${tag ? `/${encodeURIComponent(tag)}` : ''}/receipt.json`
  const doc = useDocument<RunReceipt>(url)
  // The print view states the outcome too (B5): the run's progress outcome when the run document has one, else the
  // verdict the receipt's own check recorded.
  const run = useDocument<RunDocument>(`${api}/runs/${encodeURIComponent(runId!)}`)
  if (!doc.data) return <p role="status">{doc.error ?? 'Loading receipt…'}</p>
  return <div className="agent-record ar-ws" data-theme="light">{run.data && !tag ? <RunOverview api={api} doc={{ ...run.data, receipt: doc.data }} print /> : <RunReceiptView api={api} receipt={doc.data} print outcome={run.data?.progress?.outcome ?? outcomeOfCheck(doc.data)} />}</div>
}
