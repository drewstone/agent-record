import { useMemo, useState } from 'react'
import type { PlayDocument, ProfileGraphDocument, ProfileNode, RunDocument } from '../workspace.js'
import { duration, money, stateClass, stateLabel, useDocument, when } from './data.js'
import { authoredTree, changeSummary, compareProfiles, judgeShort, judgesOf, sameNamed } from './profile-compare.js'
import type { Comparison, Version } from './profile-compare.js'
import { OutputChanges } from './Outputs.js'
import { GradeControl, ScoresTable } from './Scores.js'
import { headlineScore, scoreRows } from './scores.js'
import { ComparisonView, ProfileDetail } from './ProfileVersions.js'
import { runOfProfile } from './profile-graph.js'
import type { GraphModel, GraphNode, GraphTone } from './version-graph.js'
import { VersionGraph } from './VersionGraph.js'

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

export type Selection = { kind: 'version'; runId: string } | { kind: 'profile'; runId: string; digest: string }

/** The node id a play's version or a written profile is drawn under, and back. */
const versionNodeId = (runId: string) => `run:${runId}`
const profileNodeId = (digest: string) => `profile:${digest}`

const stateTone = (state: string | null | undefined): GraphTone => {
  const css = stateClass(state)
  return css === 'state-ok' ? 'ok' : css === 'state-fail' ? 'fail' : css === 'state-run' ? 'run' : css === 'state-warn' ? 'warn' : 'muted'
}

/**
 * A play's versions as the model: each run's registered profile on the `versions` lane, its parent the version before it;
 * what the versions supersede or continue outside the play as ghosts; and the profiles the selected version's agents wrote,
 * one lane per spawn depth, each under the profile that wrote it.
 */
function playGraphModel(play: PlayDocument, graph: ProfileGraphDocument | null, versions: readonly Version[], selectedRun: string | null): GraphModel {
  const shown = [...versions].reverse()
  const runIds = new Set(play.runs.map((run) => run.id))
  const ghosts = new Map<string, { kind: string; state: string }>()
  const ghostParents = new Map<string, string[]>()
  for (const edge of play.lineage.edges) {
    if (runIds.has(edge.to) || !shown.some((version) => version.run.id === edge.from)) continue
    const node = play.lineage.nodes.find((item) => item.runId === edge.to)
    if (!ghosts.has(edge.to)) ghosts.set(edge.to, { kind: edge.kind, state: node?.state ?? 'unknown' })
    ghostParents.set(edge.from, [...(ghostParents.get(edge.from) ?? []), `ghost:${edge.to}`])
  }
  const authored = selectedRun ? authoredTree(graph, selectedRun) : []
  const root = selectedRun ? (graph?.nodes ?? []).find((node) => node.kind === 'root' && node.createdIn === selectedRun) : undefined
  const depthLanes = [...new Set(authored.map((entry) => entry.depth))].sort((a, b) => a - b)
  const nodes: GraphNode[] = []
  for (const version of shown) {
    if (version.run.id === selectedRun) {
      for (const entry of [...authored].reverse()) {
        const outcome = entry.node.runs.find((item) => item.runId === selectedRun)?.outcome ?? null
        nodes.push({
          id: profileNodeId(entry.node.digest),
          parents: [entry.parent && entry.parent !== root?.digest ? profileNodeId(entry.parent) : versionNodeId(selectedRun)],
          lane: `authored-${entry.depth}`,
          at: entry.node.createdAt,
          title: entry.node.name ?? entry.node.label ?? entry.node.short,
          detail: `${outcome ? stateLabel(outcome) : 'outcome not recorded'} · ${entry.node.model.id ?? 'model unknown'}`,
          kind: 'authored',
          chips: [{ label: entry.node.short, tone: 'muted' }],
        })
      }
    }
    const scores = judgesOf(version.root, version.run.id)
    const contract = graph?.nodes.flatMap((node) => node.runs).find((run) => run.runId === version.run.id && run.contract?.version === 'research-contract-v2')?.contract
    nodes.push({
      id: versionNodeId(version.run.id),
      parents: [...(version.previous ? [versionNodeId(version.previous.run.id)] : []), ...(ghostParents.get(version.run.id) ?? [])],
      lane: 'versions',
      at: version.run.startedAt ?? null,
      title: shortRun(play.id, version.run.id),
      detail: version.run.purpose ?? version.root?.description ?? (version.root ? version.root.name : 'no registered profile on this host'),
      kind: 'version',
      chips: [
        { label: stateLabel(version.run.state), tone: stateTone(version.run.state) },
        { label: scores ? judgeShort(scores.judges) : 'no readout', tone: 'muted' },
        ...(contract ? [{ label: `research contract v2 · ${contract.commit.slice(0, 8)}`, tone: 'muted' as const,
          title: contract.components.map((component) => `${component.id} ${component.commit.slice(0, 8)} · ${component.message}`).join('\n') }] : []),
        { label: version.root ? `Δ ${changeSummary(version.comparison)}` : 'profile not indexed', tone: 'accent' },
      ],
    })
  }
  for (const [id, ghost] of ghosts) {
    nodes.push({
      id: `ghost:${id}`,
      parents: [],
      lane: 'outside',
      at: null,
      title: shortRun(play.id, id),
      detail: `${ghost.kind === 'supersedes' ? 'superseded by these versions' : ghost.kind === 'continues' ? 'continued by these versions' : ghost.kind}${ghost.state === 'unknown' ? ' · not on this host' : ` · ${stateLabel(ghost.state)}`}`,
      kind: 'ghost',
    })
  }
  return {
    lanes: [
      { id: 'versions', label: 'registered versions' },
      ...depthLanes.map((depth) => ({ id: `authored-${depth}`, label: depth === 0 ? 'written by the root' : `written at depth ${depth + 1}` })),
      { id: 'outside', label: 'outside this play' },
    ],
    nodes,
  }
}

/**
 * The play's versions, drawn by the same graph as a run's deliverables: each run's registered profile on one lane with
 * its state, judges and what changed from the version before it; what the versions supersede outside the play; and the
 * profiles the selected version's agents wrote, one lane per spawn depth. Selecting a node shows it in the inspector.
 */
export function VersionCanvas({
  play,
  graph,
  versions,
  selection,
  onSelect,
}: {
  play: PlayDocument
  graph: ProfileGraphDocument | null
  versions: Version[]
  selection: Selection | null
  onSelect: (selection: Selection) => void
}) {
  const selectedRun = selection?.runId ?? versions.at(-1)?.run.id ?? null
  const model = useMemo(() => playGraphModel(play, graph, versions, selectedRun), [play, graph, versions, selectedRun])
  const selected = selection?.kind === 'profile' ? profileNodeId(selection.digest) : selectedRun ? versionNodeId(selectedRun) : null
  const authoredCount = model.nodes.filter((node) => node.kind === 'authored').length
  return (
    <div className="version-canvas" data-version-canvas={play.id}>
      <VersionGraph
        model={model}
        selected={selected}
        label="Play versions"
        onSelect={(id) => {
          if (id.startsWith('run:')) onSelect({ kind: 'version', runId: id.slice(4) })
          else if (id.startsWith('profile:') && selectedRun) onSelect({ kind: 'profile', runId: selectedRun, digest: id.slice(8) })
        }}
      />
      {selectedRun && authoredCount === 0 && (
        <p className="faint">
          {!graph
            ? 'Profile versions are not indexed for this play.'
            : graph.nodes.some((node) => node.kind === 'proposed' && node.createdIn === selectedRun)
              ? `${graph.nodes.filter((node) => node.kind === 'proposed' && node.createdIn === selectedRun).length} versions an optimizer search proposed: see the search below.`
              : 'No profile written at runtime is indexed for this version.'}
        </p>
      )}
    </div>
  )
}

/** What the inspector shows for the selected version or authored profile. */
export function Inspector({
  api,
  play,
  graph,
  versions,
  selection,
  onSelect,
}: {
  api: string
  play: PlayDocument
  graph: ProfileGraphDocument | null
  versions: Version[]
  selection: Selection | null
  onSelect: (selection: Selection) => void
}) {
  const newest = versions.at(-1)
  const runId = selection?.runId ?? newest?.run.id
  const version = versions.find((item) => item.run.id === runId)
  if (!version) return <p className="faint">No version to show.</p>
  if (selection?.kind === 'profile') {
    const node = graph?.nodes.find((item) => item.digest === selection.digest)
    if (!node || !graph) return <p className="faint">This profile is not in the index.</p>
    const previousRun = version.previous?.run.id ?? null
    const counterpart = sameNamed(graph, node, previousRun)
    const comparison = counterpart ? compareProfiles(counterpart, node) : null
    return (
      <div className="inspector" data-inspector={node.short}>
        <header className="inspector-head">
          <h2>{node.name ?? node.label ?? node.short}</h2>
          <span className="chip">{node.kind === 'proposal' ? 'proposed version' : 'written at runtime'}</span>
          <code className="faint">{node.short}</code>
        </header>
        <section>
          <h3>{counterpart ? `Compared with ${counterpart.name} in ${shortRun(play.id, previousRun!)}` : 'Earlier version'}</h3>
          {comparison ? (
            <>
              <p className="faint">A comparison of the two profiles' content; the Lab records no edge between them.</p>
              <ComparisonView comparison={comparison} />
            </>
          ) : (
            <p className="faint">
              {previousRun ? `No profile named ${node.name ?? 'like this'} was written in ${shortRun(play.id, previousRun)}.` : 'No earlier version of this play.'}
            </p>
          )}
        </section>
        <ProfileDetail doc={graph} node={node} heading={false} onSelect={(short) => {
          const other = short ? graph.nodes.find((item) => item.short === short || item.digest.slice(7).startsWith(short)) : null
          const otherRun = other ? runOfProfile(graph, other) : null
          if (other && otherRun) onSelect(other.kind === 'root' ? { kind: 'version', runId: otherRun } : { kind: 'profile', runId: otherRun, digest: other.digest })
        }} />
      </div>
    )
  }
  return <VersionInspector api={api} play={play} version={version} />
}

function VersionInspector({ api, play, version }: { api: string; play: PlayDocument; version: Version }) {
  const run = version.run
  const scores = judgesOf(version.root, run.id)
  const [revision, setRevision] = useState(0)
  const runUrl = `${api}/runs/${encodeURIComponent(run.id)}`
  const doc = useDocument<RunDocument>(revision ? `${runUrl}?revision=${revision}` : runUrl, undefined, true)
  const final = doc.data?.run.id === run.id ? doc.data.finalOutput : null
  const headline = final ? headlineScore(scoreRows(final.readout, final.panel, final.grades?.latest, { kind: 'run', id: run.id })) : null
  return (
    <div className="inspector" data-inspector={run.id}>
      <header className="inspector-head">
        <h2 className="mono">{shortRun(play.id, run.id)}</h2>
        <span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>
        {run.reason && <span className="faint">{run.reason.replaceAll('-', ' ')}</span>}
      </header>
      {run.purpose && <p>{run.purpose}</p>}
      <p className="faint">
        Started {when(run.startedAt)} · {duration(run.durationMs)} · {run.nodes ?? 'unknown'} agents
        {' · '}subscription use {money(run.spend.subscriptionUsd)} at API prices, not billed{!run.spend.subscriptionKnown && run.spend.subscriptionUsd !== null ? ' (partial)' : ''}
        {' · '}model API {money(run.spend.apiUsd)} billed · sandbox compute {money(run.spend.sandboxUsd)} billed
      </p>
      <a className="inspector-link" href={runHref(run.id)}>Open the run page</a>
      <section>
        <h3>{version.previous ? `What changed from ${shortRun(play.id, version.previous.run.id)}` : 'What changed'}</h3>
        {version.comparison ? (
          <>
            <p className="faint">Compared with the version before it in this play; the Lab records no edge between registered profiles.</p>
            <ComparisonView comparison={version.comparison} />
          </>
        ) : (
          <p className="faint">{version.root ? 'The first version of this play on this host: nothing to compare.' : 'No registered profile is indexed for this run.'}</p>
        )}
      </section>
      <section data-inspector-outputs>
        <h3>{version.previous ? `What the output changed from ${shortRun(play.id, version.previous.run.id)}` : 'What the output changed'}</h3>
        {version.previous ? (
          <OutputChanges
            api={api}
            beforeRunId={version.previous.run.id}
            after={doc.data?.run.id === run.id ? doc.data : null}
            beforeLabel={shortRun(play.id, version.previous.run.id)}
            afterLabel={shortRun(play.id, run.id)}
          />
        ) : (
          <p className="faint">The first version of this play on this host: nothing to compare.</p>
        )}
      </section>
      <section data-inspector-scores>
        <h3>Scores, 0–100 vs world class</h3>
        {final ? (
          <>
            <ScoresTable readout={final.readout} panel={final.panel} grades={final.grades?.latest} target={{ kind: 'run', id: run.id }} />
            <AbsoluteScale score={headline?.score ?? null} />
            {headline?.source === 'personas' && <p className="faint">The mark is the AI personas' median ({headline.n}); advisory, not calibrated.</p>}
            <GradeControl
              api={api}
              runId={run.id}
              target={{ kind: 'run', id: run.id }}
              label={`Your grade of ${shortRun(play.id, run.id)}`}
              current={final.grades?.latest.filter((grade) => grade.target.kind === 'run').at(-1) ?? null}
              onSaved={() => setRevision((value) => value + 1)}
            />
          </>
        ) : (
          <p className="faint">{doc.error ? `The run's scores are unavailable: ${doc.error}` : 'Loading the run’s scores…'}</p>
        )}
      </section>
      {scores && scores.verdicts.length > 0 && (
        <section>
          <h3>Hypotheses</h3>
          <ul className="verdict-list">
            {scores.verdicts.map((verdict) => (
              <li key={verdict.id}>
                <code>{verdict.id}</code> <span className={`verdict verdict-${verdict.verdict}`}>{verdict.verdict.replaceAll('-', ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The absolute 0–100 world-class axis. No judge is calibrated to it yet, so it draws the axis and says so. */
export function AbsoluteScale({ score }: { score?: number | null }) {
  return (
    <div className="absolute-scale" data-absolute-scale>
      <div className="scale-track">
        <span className="scale-band" title="World class: anchored to real world-class exemplars" />
        {typeof score === 'number' && <span className="scale-mark" style={{ left: `${Math.max(0, Math.min(100, score))}%` }} />}
      </div>
      <div className="scale-ticks">
        <span>0</span>
        <span>50</span>
        <span>world class</span>
        <span>100</span>
      </div>
      <p className="faint">{typeof score === 'number' ? `Median of the judges: ${score} of 100.` : 'No absolute 0–100 score yet.'}</p>
    </div>
  )
}

export type { Comparison, ProfileNode }
