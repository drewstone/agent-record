import type { Play } from './workspace/answers.js'
import { RunPage } from './workspace/RunPage.js';
import { useSearch, WorkspaceTabs as Tabs } from './workspace/navigation.js';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DimensionsDocument } from './assessment.js';

import { FindingsFeed } from './workspace/FindingsFeed.js';
import { PlayAnswer } from './workspace/PlayAnswer.js';

import { ExplorePage } from './workspace/Explore.js';
import { PlayHeader } from './workspace/PlayHead.js';
import { PlayAgainstBar, PlayClimb } from './workspace/PlayClimb.js';
import { PlayLedger } from './workspace/PlayLedger.js';
import { PlayTeams } from './workspace/PlayTeams.js';
import { PlayFindings } from './workspace/PlayFindings.js';
import { PlayReleases } from './workspace/PlayReleases.js';
import { inlinedPlayHead, type PlayHead, shortTag, targetWords, verdictWord } from './workspace/play-standing.js';
import { OverviewPage } from './workspace/Overview.js';
import { TheatrePage } from './workspace/Theatre.js';

import { ResearchReport } from './ResearchReport.js';
import { playReportToResearchReport, type PlayReportDocument } from './play-report.js';
import type { PlayDocument, PlayInput, PlaysDocument, ProfileGraphDocument, RunDocument } from './workspace-model.js';

import { AssessmentMatrix, dimensionMap } from './workspace/Assessments.js';
import { duration, endingStatus, go, money, newerStarted, runStatus, StandingText, StatusPill, statusOf, useDocument, when } from './workspace/data.js';

import { InputView } from './workspace/InputView.js';

import { ReliabilityPanel } from './workspace/Reliability.js';
import { Searches } from './workspace/SearchView.js';
import { HIDDEN_LABEL, HIDDEN_ORDER, splitHidden, splitRuns } from './workspace/plays-filter.js';
import type { HiddenReason } from './workspace/plays-filter.js';
import { findProfile, profileGraph, runOfProfile } from './workspace/profile-graph.js';
import { versionsOf } from './workspace/profile-compare.js';

import { outcomeOfCheck, RunReceiptView } from './workspace/RunOverview.js';
import type { RunReceipt } from './workspace/run-receipt.js';

import { Inspector, VersionCanvas } from './workspace/VersionCanvas.js';
import { ProfileCanvas } from './workspace/ProfileCanvas.js';

import type { Selection } from './workspace/VersionCanvas.js';
import { apiEquivalent, knownSubscription } from './workspace/Spend.js';

export interface WorkspaceProps {
  /** Same-origin API root, for example `/api/discovery`. */
  api: string
  /** `report` is the play report at `/play/<id>/report`; `id` is the play. */
  mode: 'plays' | 'play' | 'report' | 'run' | 'receipt' | 'overview' | 'theatre' | 'explore'
  id: string
  theme?: 'light' | 'dark' | 'auto'
}

/** Play and run pages of a run workspace. Reads only the same-origin API; navigation stays in the host tab. */
export function Workspace({ api, mode, id, theme = 'auto' }: WorkspaceProps) {
  return (
    <div className="agent-record ar-ws" data-theme={theme}>
      {mode === 'receipt' ? <ReceiptPage api={api} id={id} /> : mode === 'explore' ? <ExplorePage api={api} /> : mode === 'overview' ? <OverviewPage api={api} /> : mode === 'theatre' ? <TheatrePage api={api} id={id} /> : mode === 'plays' ? <PlaysPage api={api} /> : mode === 'play' ? <PlayPage api={api} id={id} /> : mode === 'report' ? <PlayReportPage api={api} id={id} theme={theme} /> : <RunPage api={api} id={id} />}
    </div>
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
type PlaySort = 'latest' | 'spend' | 'runs' | 'name'

function PlaysPage({ api }: { api: string }) {
  const [params, update] = useSearch()
  const plays = useDocument<PlaysDocument>(`${api}/plays`)
  const query = params.get('q') ?? ''
  const program = params.get('program') ?? ''
  const sort = (['latest', 'spend', 'runs', 'name'] as const).find((value) => value === params.get('sort')) ?? 'latest'
  const showHidden = params.get('show') === 'all'
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
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
  const sharedFilters = <div className="message-filters plays-filters" aria-label="Research filters">
    <input type="search" aria-label="Search research" placeholder="Search research" value={draft}
      onChange={(event) => { setDraft(event.target.value); update({ q: event.target.value || undefined }, true) }} />
    <select aria-label="Program" value={program} onChange={(event) => update({ program: event.target.value || undefined })}>
      <option value="">All programs</option>
      {programs.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
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
        {homeTabs}{sharedFilters}
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
    const cash = (usd: number | null | undefined) => (usd === null || usd === undefined ? '—' : money(usd))
    const unrecorded = shown.filter((run) => [run.subscriptionUsd, run.apiUsd, run.sandboxUsd].every((usd) => usd === null || usd === undefined)).length
    return <div className="ws-page ws-plays" data-plays-home="runs">
      {homeTabs}{sharedFilters}
      <p className="faint">{shown.length} catalog runs: started in the last 30 days or running now. One row per root run; versions are on the run page.{unrecorded ? ` No spend reading for ${unrecorded} of them (subscription, API and sandbox; no per-run meter).` : ''}</p>
      <div className="table-scroll"><table className="data-table runs-table" data-run-ledger>
        <thead><tr><th>Run</th><th>State</th><th>Started</th><th>Last activity</th><th>Outcome / stop cause</th>
          <th className="num">Subscription at API prices</th><th className="num">Billed API</th><th className="num">Billed sandbox</th></tr></thead>
        <tbody>{shown.map((run) => <tr key={run.id}>
          <td><a href={`/run/${encodeURIComponent(run.id)}`}>{run.play}</a><small className="faint mono"> {run.id}</small></td>
          <td><StatusPill status={runStatus(run, newerStarted(run, all))} /></td>
          <td>{when(run.startedAt)}</td><td>{when(run.activeAt)}</td><td>{run.stopCause || run.reason || '—'}</td>
          <td className="num">{cash(run.subscriptionUsd)}</td><td className="num">{cash(run.apiUsd)}</td><td className="num">{cash(run.sandboxUsd)}</td>
        </tr>)}</tbody>
      </table></div>
      {!shown.length && <p className="chat-empty">No runs match.</p>}
    </div>
  }
  return (
    <Status loading={plays.loading} error={plays.error && `Plays are unavailable: ${plays.error}`}>
      <div className="ws-page ws-plays" data-plays>
        {homeTabs}{sharedFilters}
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
                  <th>Where it stands</th>
                  <th>Best under the current check</th>
                  <th>Last run</th>
                  <th className="num">Runs</th>
                  <th className="num" title="Every token at list price, whoever paid; how many started runs were priced">API-equivalent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((play) => {
                  const open = () => go(`/play/${encodeURIComponent(play.id)}`)
                  const runs = !showHidden && play.counts ? play.counts.shown : play.runCount
                  const standing = play.standing ?? null
                  const best = (standing?.best ?? null) as { tag?: string | null; run?: string | null; checker?: string | null; reached?: number | null; of?: number | null; workloads?: { passed?: number | null; total?: number | null } | null; verdict?: string | null } | null
                  const last = standing?.lastEnding ?? null
                  const cost = standing?.cost ?? null
                  const lastId = last?.runId ?? play.latestRun?.id ?? null
                  return (
                    <tr key={play.id} data-play={play.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
                      <td>
                        <a href={`/play/${encodeURIComponent(play.id)}`} onClick={(event) => event.preventDefault()}>{play.title}</a>
                        {play.title !== play.id && <small className="faint mono"> {play.id}</small>}
                        {play.program && <small className="faint"> · {play.program}</small>}
                      </td>
                      <td className="plays-standing">
                        {standing?.sentence ? (
                          <span className="clamp-2" title={standing.sentence}><StandingText text={standing.sentence} /></span>
                        ) : (
                          <StatusPill status={statusOf({ axis: 'run', state: play.state })} />
                        )}
                      </td>
                      <td>
                        {best?.tag || best?.run ? (
                          <span className="mono" title={[best.checker ? `under ${best.checker}` : null, best.verdict ? verdictWord(best.verdict) : null].filter(Boolean).join(' · ') || undefined}>
                            {shortTag(best.tag) ?? 'workspace'}
                            {best.run ? <span className="faint"> ({best.run})</span> : null}
                            {best.reached && best.of ? ` · stage ${best.reached}/${best.of}` : ''}
                            {best.workloads?.total ? ` · ${best.workloads.passed ?? '?'}/${best.workloads.total}` : ''}
                            {best.checker ? <span className="faint"> {best.checker}</span> : null}
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        {lastId ? (
                          <a
                            className="mono"
                            href={`/run/${encodeURIComponent(lastId)}`}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              go(`/run/${encodeURIComponent(lastId)}`)
                            }}
                          >
                            {last?.run ?? shortRun(play.id, lastId)}
                          </a>
                        ) : '—'}
                        {last?.word ? <> <StatusPill status={endingStatus(last.word)} className="ending-word" /></> : null}
                        <small className="faint"> {when(last?.at ?? play.latestRun?.startedAt)}</small>
                      </td>
                      <td className="num" title={runs !== play.runCount ? `${play.runCount} in all; ${play.runCount - runs} behind the filter` : undefined}>
                        {runs}{runs !== play.runCount && <small className="faint"> of {play.runCount}</small>}
                      </td>
                      <td className="num" title={cost?.priced !== null && cost?.priced !== undefined ? `${cost.priced} of ${cost.started ?? '?'} started runs priced${cost.provenance ? ` (${cost.provenance})` : ''}` : undefined}>
                        {cost?.apiEquivalentUsd !== null && cost?.apiEquivalentUsd !== undefined && cost.priced ? (
                          <>
                            {money(cost.apiEquivalentUsd)}
                            {cost.priced !== cost.started ? <small className="faint"> {cost.priced}/{cost.started}</small> : null}
                          </>
                        ) : (
                          <span className="faint" title="API-equivalent not priced">—</span>
                        )}
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
          <PlayHeader play={doc} report={report.data} compact={tab !== 'standing'} fallback={<PlayStanding play={doc} />} />
          <Tabs
            label="Play"
            value={tab}
            onChange={(next) => update({ tab: next === 'standing' ? undefined : next, judged: undefined })}
            tabs={[
              ['standing', 'Standing'],
              ['releases', releaseCount ? `Releases ${releaseCount}${withheld ? ` · ${withheld} not published` : ''}` : 'Releases'],
              ['runs', `Runs ${runCount}`],
              ['findings', findingCount ? `Findings ${findingCount}` : 'Findings'],
              ['setup', 'Setup'],
            ] as const}
          />
          <div className="ws-content" role="tabpanel">
            {tab === 'standing' && (
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
 * The play report: the served `agent-workspace.play-report.v1` document read through `ResearchReport`, with the play
 * page's bar panels as its how-good figure. The bar panels need the play document; the report reads without it.
 */
function PlayReportPage({ api, id, theme }: { api: string; id: string; theme: 'light' | 'dark' | 'auto' }) {
  const doc = useDocument<PlayReportDocument>(`${api}/plays/${encodeURIComponent(id)}/report`)
  const play = useDocument<Play>(`${api}/plays/${encodeURIComponent(id)}`)
  const report = useMemo(() => {
    if (!doc.data) return { data: null, error: null }
    try {
      return { data: playReportToResearchReport(doc.data), error: null }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [doc.data])
  return (
    <Status loading={doc.loading} error={doc.error ? `This play report is unavailable: ${doc.error}` : report.error ? `This play report does not read: ${report.error}` : undefined}>
      {report.data && <ResearchReport report={report.data} theme={theme} figures={play.data ? { 'how-good': <PlayAgainstBar play={play.data} /> } : undefined} />}
    </Status>
  )
}

/** The play's bar as declared (`bar.json`): each metric's target, stretch and direction, the source and both conditions. */
function PlayBarTable({ play }: { play: Play }) {
  const bar = play.bar ?? null
  if (!bar) return null
  return (
    <section className="ws-section play-bar-table" data-section="bar">
      <h3>Bar</h3>
      <p className="faint">
        {bar.source}
        {bar.path && <> · <code>{bar.path}</code></>}
      </p>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Target</th>
            <th>Stretch</th>
            <th>Better</th>
            <th>Scale</th>
          </tr>
        </thead>
        <tbody>
          {bar.metrics.map((metric) => (
            <tr key={metric.id}>
              <td>
                {metric.label}
                {metric.precondition && <span className="chip">precondition</span>}
              </td>
              <td>{targetWords(metric) ?? '—'}</td>
              <td>{metric.stretch ? `${metric.stretch.min ?? ''}${metric.stretch.max ? `–${metric.stretch.max}` : ''} ${metric.stretch.label ?? ''}`.trim() : '—'}</td>
              <td>{metric.direction === 'up' ? 'higher' : metric.direction === 'down' ? 'lower' : '—'}</td>
              <td>{metric.scale ?? 'linear'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {(bar.condition || bar.checkCondition) && (
        <p className="faint">
          {bar.condition && <>The bar: {bar.condition}. </>}
          {bar.checkCondition && <>The check measures: {bar.checkCondition}.</>}
        </p>
      )}
    </section>
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
                  {run.purpose ? <div className="run-purpose-text">{run.purpose}</div> : <span className="faint">not stated</span>}
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
