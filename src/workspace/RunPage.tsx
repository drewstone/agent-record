import type { Play } from './answers.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssessmentsDocument, DimensionsDocument } from '../assessment.js';
import type { RecordEvent, RecordGap } from '../record.js';
import { AgentFindings, RunFindings } from './Findings.js';
import { WorkGraph } from './WorkGraph.js';

import { BeadString } from './BeadString.js';

import { type PlayHead } from './play-standing.js';

import { RunVersions } from './VersionGraph.js';

import type { PlayDocument, ProfileGraphDocument, RunDocument } from '../workspace-model.js';
import { Conversation } from '../viewer/Conversation.js';
import { withPrompts } from '../viewer/prompts.js';
import type { EventFlag } from '../viewer/Conversation.js';
import { categoryClass, Timeline, UsageChart } from '../viewer/Charts.js';
import type { Axis, Metric, PlotTooltip, ShowTooltip } from '../viewer/Charts.js';
import { agentState, indexRecord, interval, measuredUsage, ms, roleOf, utcTime } from '../viewer/model.js';
import type { RecordIndex } from '../viewer/model.js';
import { advancePlayback } from '../viewer/playback.js';
import { EventDetail } from './EventDetail.js';
import { dimensionMap, flagsFrom, RunAssessments } from './Assessments.js';
import { dataStatus, money, readRecord, statusOf, useDocument } from './data.js';
import { FinalOutputPanel } from './FinalOutput.js';
import { InputView } from './InputView.js';
import { OutputsView } from './Outputs.js';
import type { ArtifactNavigation } from './RunArtifacts.js'

import { AgentTable } from './RunTable.js';

import { RunOverview } from './RunOverview.js';
import { LiveTranscript } from './LiveTranscript.js';
import { RunStatusLine, RunWhy } from './RunFold.js';
import { RunHome } from './RunHome.js';
import { RunDesignPreview, runDesignVariant } from './RunDesignPreview.js'
import { newestAgent } from './run-answers.js';
import { AGENT_PART_SECTIONS, RunTabBar, type RunSection, sectionOf } from './RunTabs.js';
import type { NodeStats } from './RunTable.js';

import { ProfileCanvas } from './ProfileCanvas.js';
import { ProvenanceCanvas } from './ProvenanceCanvas.js';

import { agentSpendRows, BreakdownTable, byModel, NodeSpendPanel, SeatWeeksPanel, SpendBars, spendGapLabel } from './Spend.js';
import { useSearch, WorkspaceTabs as Tabs } from './navigation.js';

/** A waste dimension by its id and name: E3 polling. */
const wasteLabel = (dimension: string, catalogue: ReturnType<typeof dimensionMap>) =>
  `${dimension} ${catalogue.get(dimension)?.key.replaceAll('_', ' ') ?? ''}`.trim()

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
 * The run page: a header, the run's answer in one strip, and one tab bar. Findings (what the agents wrote) open first;
 * Agents is a rail of the run's agents beside the selected agent's conversation; the other sections are the run's
 * graph, readout, outputs, spend, assessments, input and coverage, each full width. The page draws from the record's
 * node list; an agent's events load only when a section needs them, so a run with a 5 MB record opens as fast as a
 * small one.
 */
export function RunPage({ api, id }: { api: string; id: string }) {
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
  const evidence = useRef<HTMLDetailsElement>(null)
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
  const variant = runDesignVariant(params.get('variant'))
  const artifactView = params.get('fileView')
  const artifactNavigation: ArtifactNavigation = {
    version: params.get('fileVersion'), compare: params.get('compareVersion'), identity: params.get('fileIdentity'),
    view: artifactView === 'diff' || artifactView === 'source' ? artifactView : 'preview',
    onVersion: (version: string | null) => update({ fileVersion: version, fileIdentity: undefined }),
    onCompare: (version: string | null) => update({ compareVersion: version }),
    onIdentity: (identity: string | null) => update({ fileIdentity: identity }),
    onView: (view: 'preview' | 'source' | 'diff') => update({ fileView: view }),
  }
  const selectFile = (file: string | null) => update({ file, fileIdentity: undefined })
  const tabs = <RunTabBar section={section} onOpen={(next) => (next ? open(next, { tab: undefined }) : update({ section: undefined, node: undefined, tab: undefined, event: undefined, t: undefined, commit: undefined, file: undefined, profile: undefined, view: undefined, drawer: undefined, graph: undefined }))} />
  if (section === null) {
    const receipt = <><RunWhy doc={doc} play={play.data} /><RunOverview api={api} doc={doc} play={play.data} nodes={index ? index.actors : null} stats={nodes.stats} open={(next, patch) => open(next as RunSection, patch)} /></>
    return <div className="ws-page ws-run" data-run={summary.id} data-section="overview">
      {variant ? <>
        <RunDesignPreview value={variant} onChange={(value) => update({ variant: value })} />
        {tabs}
        <RunHome api={api} doc={doc} selected={params.get('file')} onSelect={selectFile} onOpen={open} navigation={artifactNavigation} variant={variant} onInspect={() => { if (evidence.current) evidence.current.open = true }} />
        <details className="run-evidence" id="run-verification" ref={evidence}><summary>Check evidence, cleanup and execution history</summary>{receipt}</details>
      </> : <><RunStatusLine doc={doc} play={play.data} />{tabs}{receipt}</>}
    </div>
  }
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
          <OutputsView api={api} doc={doc} grading={grading} selected={params.get('file')} onSelect={selectFile} onClose={() => open('findings')} navigation={artifactNavigation} />
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
      <RunInspectionOverlays detail={detail} index={index} onClose={() => setDetail(null)} load={loadSource} tooltip={tooltip} />
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

function RunInspectionOverlays({ detail, index, onClose, load, tooltip }: {
  detail: { event: RecordEvent; sha?: string } | null
  index: RecordIndex
  onClose: () => void
  load: (sha: string) => Promise<string>
  tooltip: PlotTooltip | null
}) {
  return <>
    {detail && <EventDetail key={`${detail.event.id}:${detail.sha ?? ''}`} event={detail.event} full={detail.sha} index={index} onClose={onClose} load={load} />}
    {tooltip && <div className="ui-plot-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y, transform: tooltip.y > window.innerHeight / 2 ? 'translateY(-100%)' : undefined }}><strong>{tooltip.title}</strong>{tooltip.lines.map((line, i) => <p key={i}>{typeof line === 'string' ? line : line.value}</p>)}</div>}
  </>
}
