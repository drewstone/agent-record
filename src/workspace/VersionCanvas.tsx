import { useMemo } from 'react'
import type { PlayDocument, ProfileGraphDocument, ProfileNode } from '../workspace.js'
import { duration, money, stateClass, stateLabel, when } from './data.js'
import { authoredTree, changeSummary, compareProfiles, judgeShort, judgesOf, sameNamed } from './profile-compare.js'
import type { Comparison, Judge, Version } from './profile-compare.js'
import { ComparisonView, ProfileDetail } from './ProfileVersions.js'

const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

// Geometry of the canvas, in CSS pixels at the workspace's type scale.
const PAD = 24
const PRED_W = 200
const VER_X = PAD + PRED_W + 40
const VER_W = 300
const VER_H = 150
const VER_GAP = 16
const AUTH_X = VER_X + VER_W + 48
const AUTH_W = 250
const AUTH_H = 70
const AUTH_GAP = 10
const AUTH_STEP = AUTH_W + 40

export type Selection = { kind: 'version'; runId: string } | { kind: 'profile'; runId: string; digest: string }

/** The judges as mini bars: height is the rubric score, a filled bar a calibrated judge, an outlined one advisory. */
function JudgeBars({ judges }: { judges: readonly Judge[] }) {
  return (
    <span className="judge-bars" aria-hidden="true">
      {judges.map((judge) => (
        <i
          key={judge.category}
          className={`${judge.calibrated ? 'calibrated' : 'advisory'} ${!judge.score ? 'zero' : ''}`}
          style={{ height: `${Math.max(3, ((judge.score ?? 0) / (judge.max || 4)) * 26)}px` }}
        />
      ))}
    </span>
  )
}

/**
 * The play's version graph, left to right: what it supersedes, each run as a registered version with its judges and
 * what changed from the version before it, then the profiles the selected version's agents wrote. Selecting a node
 * shows it in the inspector beside the graph.
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
  // Newest first, top to bottom.
  const shown = useMemo(() => [...versions].reverse(), [versions])
  const selectedRun = selection?.runId ?? shown[0]?.run.id ?? null
  const authored = useMemo(() => (selectedRun ? authoredTree(graph, selectedRun) : []), [graph, selectedRun])
  const runIds = new Set(play.runs.map((run) => run.id))
  // What the versions continue or supersede outside this play: drawn as ghosts on the left.
  const predecessors = useMemo(() => {
    const out = new Map<string, { id: string; kind: string; state: string }>()
    for (const edge of play.lineage.edges)
      if (!runIds.has(edge.to) && shown.some((version) => version.run.id === edge.from)) {
        const node = play.lineage.nodes.find((item) => item.runId === edge.to)
        if (!out.has(edge.to)) out.set(edge.to, { id: edge.to, kind: edge.kind, state: node?.state ?? 'unknown' })
      }
    return [...out.values()]
  }, [play, shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const versionY = new Map(shown.map((version, i) => [version.run.id, PAD + i * (VER_H + VER_GAP)]))
  const versionsBottom = PAD + shown.length * (VER_H + VER_GAP)
  const predY = (i: number) => {
    const mid = shown.length ? (PAD + versionsBottom - VER_GAP) / 2 : PAD + 60
    return Math.max(PAD, mid - (predecessors.length * 130) / 2 + i * 130)
  }
  const authoredY = authored.map((_, i) => PAD + i * (AUTH_H + AUTH_GAP))
  const maxDepth = Math.max(-1, ...authored.map((entry) => entry.depth))
  const width = AUTH_X + (maxDepth + 1) * AUTH_STEP + PAD
  const height = Math.max(versionsBottom, PAD + authored.length * (AUTH_H + AUTH_GAP), predecessors.length * 130 + PAD) + PAD
  const elbow = (x1: number, y1: number, x2: number, y2: number) => {
    const xm = Math.round(x1 + (x2 - x1) / 2)
    return `M${x1},${y1} H${xm} V${y2} H${x2}`
  }
  const position = new Map(authored.map((entry, i) => [entry.node.digest, { x: AUTH_X + entry.depth * AUTH_STEP, y: authoredY[i]! }]))
  const selectedY = selectedRun ? versionY.get(selectedRun) : undefined

  return (
    <div className="version-canvas" data-version-canvas={play.id}>
      <div className="version-host" style={{ width, height }}>
        <svg className="version-lines" width={width} height={height} aria-hidden="true">
          {predecessors.map((pred, i) =>
            shown.map((version) => (
              <path key={`${pred.id}>${version.run.id}`} d={elbow(PAD + PRED_W, predY(i) + 55, VER_X, versionY.get(version.run.id)! + VER_H / 2)} />
            )),
          )}
          {selectedY !== undefined &&
            authored.map((entry) => {
              const at = position.get(entry.node.digest)!
              const from = entry.parent ? position.get(entry.parent) : undefined
              const x1 = from ? from.x + AUTH_W : VER_X + VER_W
              const y1 = from ? from.y + AUTH_H / 2 : selectedY + VER_H / 2
              return <path key={entry.node.digest} className={selection?.kind === 'profile' && selection.digest === entry.node.digest ? 'hot' : ''} d={elbow(x1, y1, at.x, at.y + AUTH_H / 2)} />
            })}
        </svg>
        {predecessors.map((pred, i) => (
          <div key={pred.id} className="canvas-node ghost" style={{ left: PAD, top: predY(i), width: PRED_W }}>
            <span className="b clip mono">{shortRun(play.id, pred.id)}</span>
            <span className="node-sub">
              {pred.kind === 'supersedes' ? 'superseded by these versions' : pred.kind === 'continues' ? 'continued by these versions' : pred.kind}
              {pred.state === 'unknown' ? ' · not on this host' : ` · ${stateLabel(pred.state)}`}
            </span>
          </div>
        ))}
        {shown.map((version) => {
          const scores = judgesOf(version.root, version.run.id)
          const on = selection?.kind === 'version' ? selection.runId === version.run.id : !selection && version.run.id === selectedRun
          const top = versionY.get(version.run.id)!
          return (
            <button
              key={version.run.id}
              type="button"
              className={`canvas-node version ${on ? 'on' : ''} ${selectedRun === version.run.id ? 'open' : ''}`}
              style={{ left: VER_X, top, width: VER_W, height: VER_H }}
              aria-pressed={on}
              data-version={version.run.id}
              onClick={() => onSelect({ kind: 'version', runId: version.run.id })}
            >
              <span className="node-title">
                <b className="mono">{shortRun(play.id, version.run.id)}</b>
                <span className={`state-pill ${stateClass(version.run.state)}`}>{stateLabel(version.run.state)}</span>
              </span>
              <span className="node-sub clip" title={version.run.purpose ?? version.root?.description ?? undefined}>
                {version.run.purpose ?? version.root?.description ?? (version.root ? version.root.name : 'no registered profile on this host')}
              </span>
              <span className="judge-line" title={scores?.judges.map((j) => `${j.category} ${j.score ?? '—'}/${j.max}${j.calibrated ? '' : ' advisory'}`).join(' · ')}>
                {scores?.judges.length ? <JudgeBars judges={scores.judges} /> : null}
                <span className="node-sub clip">{scores ? judgeShort(scores.judges) : 'no readout'}</span>
              </span>
              <span className="node-sub delta clip">
                {version.root ? `Δ ${changeSummary(version.comparison)}${version.previous ? ` vs ${shortRun(play.id, version.previous.run.id)}` : ''}` : 'profile not indexed'}
              </span>
            </button>
          )
        })}
        {authored.map((entry) => {
          const at = position.get(entry.node.digest)!
          const run = entry.node.runs.find((item) => item.runId === selectedRun)
          const outcome = run?.outcome ?? null
          const on = selection?.kind === 'profile' && selection.digest === entry.node.digest
          return (
            <button
              key={entry.node.digest}
              type="button"
              className={`canvas-node authored ${on ? 'on' : ''}`}
              style={{ left: at.x, top: at.y, width: AUTH_W, height: AUTH_H }}
              aria-pressed={on}
              data-profile={entry.node.short}
              onClick={() => onSelect({ kind: 'profile', runId: selectedRun!, digest: entry.node.digest })}
            >
              <span className="node-title">
                <i className={`dot ${stateClass(outcome)}`} aria-hidden="true" />
                <b className="clip">{entry.node.name ?? entry.node.label ?? entry.node.short}</b>
              </span>
              <span className="node-sub clip">
                {outcome ? stateLabel(outcome) : 'outcome not recorded'} · {entry.node.model.id ?? 'model unknown'}
              </span>
            </button>
          )
        })}
        {selectedRun && !authored.length && (
          <div className="canvas-node ghost" style={{ left: AUTH_X, top: PAD, width: AUTH_W + 60 }}>
            <span className="faint">{graph ? 'No profile written at runtime is indexed for this version.' : 'Profile versions are not indexed for this play.'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** What the inspector shows for the selected version or authored profile. */
export function Inspector({
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
          <span className="chip">written at runtime</span>
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
          if (other?.createdIn) onSelect(other.kind === 'root' ? { kind: 'version', runId: other.createdIn } : { kind: 'profile', runId: other.createdIn, digest: other.digest })
        }} />
      </div>
    )
  }
  return <VersionInspector play={play} version={version} />
}

function VersionInspector({ play, version }: { play: PlayDocument; version: Version }) {
  const run = version.run
  const scores = judgesOf(version.root, run.id)
  return (
    <div className="inspector" data-inspector={run.id}>
      <header className="inspector-head">
        <h2 className="mono">{shortRun(play.id, run.id)}</h2>
        <span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>
        {run.reason && <span className="faint">{run.reason.replaceAll('-', ' ')}</span>}
      </header>
      {run.purpose && <p>{run.purpose}</p>}
      <p className="faint">
        Started {when(run.startedAt)} · {duration(run.durationMs)} · {run.nodes ?? 'unknown'} agents · paid {money(run.spend.paidUsd)}
        {run.spend.paidKnown ? '' : '+'} · list price {money(run.spend.listUsd)}
        {run.spend.listKnown === false ? '+' : ''}
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
      <section>
        <h3>Judges</h3>
        {scores?.judges.length ? (
          <>
            <div className="judge-rows">
              {scores.judges.map((judge) => (
                <div key={judge.category} className="judge-row">
                  <span>{judge.category}</span>
                  <span className="pips" aria-hidden="true">
                    {Array.from({ length: judge.max }, (_, i) => <i key={i} className={judge.score !== null && i < judge.score ? (judge.calibrated ? 'on' : 'on advisory') : ''} />)}
                  </span>
                  <b>{judge.score ?? '—'} of {judge.max}</b>
                  <span className="faint">{judge.calibrated ? 'calibrated' : 'advisory'}</span>
                </div>
              ))}
            </div>
            <AbsoluteScale />
          </>
        ) : (
          <p className="faint">No readout judged this run.</p>
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
      <p className="faint">{typeof score === 'number' ? `Absolute score ${score} of 100.` : 'Absolute 0–100 score: not calibrated yet. The bars above are a 1–4 rubric.'}</p>
    </div>
  )
}

export type { Comparison, ProfileNode }
