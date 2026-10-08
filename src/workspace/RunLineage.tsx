import { useCallback, useMemo, useState } from 'react'
import type { Fork, PlayDocument, Release } from '../workspace.js'
import { go, money, readRecord, stateClass, stateLabel, useDocument, when } from './data.js'
import { RecordWorkGraph } from './WorkGraph.js'
import { CanvasControls } from './ProfileCanvas.js'
import { deliverableTimeline, L_NODE_H, L_NODE_W, lineageLit, lineageModel, lineageNeighbour } from './run-lineage.js'
import type { LineageEdge, LineageModel, LineageNode } from './run-lineage.js'
import { useCanvasView } from './useCanvasView.js'
import type { Box } from './useCanvasView.js'

const PAD = 56
const shortRun = (play: string, run: string) => (run.startsWith(`${play}-`) ? run.slice(play.length + 1) : run)
const hours = (value: number | undefined) => (value ? `${value.toFixed(value >= 10 ? 0 : 1)} h lost` : 'no hours lost')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The play's runs as one story: a lineage canvas on the shared engine (one card per run with how it ended, its agents,
 * findings, the three cost kinds and the agent-hours lost; one edge per fork, supersedes or continuation), the selected
 * run's fork (why, what moved, what it carried, what changed) and releases beside it, and the deliverable timeline below.
 */
export function RunLineage({ api, play, selected, onSelect: setSelected }: { api: string; play: PlayDocument; selected: string | null; onSelect: (id: string | null) => void }) {
  const model = useMemo(() => lineageModel(play), [play])
  const node = selected ? (model.byId.get(selected) ?? null) : null
  if (model.nodes.length < 2) return <p className="ws-status">This play has one run, so it has no lineage yet.</p>
  return (
    <div className="lineage-story" data-lineage={model.nodes.length}>
      <div className="pc-layout ln-layout">
        <LineagePane play={play} model={model} selectedId={node?.id ?? null} onChoose={setSelected} />
        <aside className="pc-inspector" aria-label="Selected run">
          {node ? <RunStory play={play} model={model} node={node} onChoose={setSelected} /> : <LineageIntro play={play} model={model} />}
        </aside>
      </div>
      <DeliverableTimeline play={play} selectedRun={node?.id ?? null} onChoose={setSelected} />
      <PlayRecord api={api} play={play} />
    </div>
  )
}

function LineagePane({ play, model, selectedId, onChoose }: { play: PlayDocument; model: LineageModel; selectedId: string | null; onChoose: (id: string) => void }) {
  const box = useCallback((id: string): Box | null => {
    const node = model.byId.get(id)
    return node ? { x: PAD + node.x, y: PAD + node.y, w: L_NODE_W, h: L_NODE_H } : null
  }, [model])
  const width = model.width + PAD * 2
  const height = model.height + PAD * 2
  const canvas = useCanvasView({
    width,
    height,
    box,
    focus: model.focus,
    selectedId,
    neighbour: (id, key) => lineageNeighbour(model, id, key),
    // Too wide to read whole (a phone, a long chain): open at a readable size on the newest run.
    open: (_size, fit) => {
      const at = model.focus ? box(model.focus) : null
      if (fit.k >= 0.55 || !at) return null
      const k = 0.75
      return { k, x: 16 - (at.x - L_NODE_W * 1.6) * k, y: 16 - (at.y - 40) * k }
    },
  })
  const lit = useMemo(() => {
    const id = canvas.hover ?? selectedId
    return id && model.byId.has(id) ? lineageLit(model, id) : null
  }, [canvas.hover, selectedId, model])
  return (
    <section className="pc-pane" aria-label="Run lineage">
      <div className="pc-toolbar">
        <p className="pc-summary">
          <b>{model.counts.runs}</b> runs · <b>{model.counts.forks}</b> {model.counts.forks === 1 ? 'fork' : 'forks'} · <b>{model.counts.releases}</b>{' '}
          {model.counts.releases === 1 ? 'release' : 'releases'}
          {model.counts.lines > 1 && <> · <b>{model.counts.lines}</b> lines</>}
        </p>
        <CanvasControls canvas={canvas} selectedId={selectedId} />
      </div>
      <div {...canvas.viewportProps} className="pc-viewport" data-zoom={canvas.k.toFixed(2)}>
        <div className="pc-world" style={canvas.worldStyle}>
          <svg className="pc-edges" width={width} height={height} aria-hidden="true">
            {model.edges.map((edge) => (
              <path key={edge.id} d={edgePath(model, edge)} className={edgeClass(edge, lit, selectedId)} />
            ))}
          </svg>
          {model.edges.map((edge) => {
            const from = model.byId.get(edge.from)!
            const to = model.byId.get(edge.to)!
            const dim = lit && !(lit.has(edge.from) && lit.has(edge.to))
            // Above the edge's middle, in the gap between the cards it joins.
            return (
              <span
                key={`label:${edge.id}`}
                aria-hidden="true"
                title={edge.label}
                className={`pc-edge-label ln-edge-label ln-${edge.kind}${dim ? ' dim' : ''}`}
                style={{ left: PAD + (from.x + L_NODE_W + to.x) / 2, top: PAD + (from.y + to.y) / 2 + L_NODE_H / 2 - 22 }}
              >
                {edge.kind === 'fork' ? 'fork' : edge.kind}
                {edge.kind === 'fork' && edge.label !== 'fork' && <small>{edge.label.replace(/^fork · /, '')}</small>}
              </span>
            )
          })}
          {model.nodes.map((node) => (
            <button
              key={node.id}
              ref={canvas.register(node.id)}
              type="button"
              tabIndex={node.id === canvas.current ? 0 : -1}
              className={['pc-node', 'ln-node', !node.run && 'ancestor', node.id === selectedId && 'on', lit && !lit.has(node.id) && 'dim', lit && lit.has(node.id) && node.id !== (canvas.hover ?? selectedId) && 'hot']
                .filter(Boolean)
                .join(' ')}
              style={{ left: PAD + node.x, top: PAD + node.y, width: L_NODE_W, height: L_NODE_H }}
              aria-pressed={node.id === selectedId}
              aria-label={`${shortRun(play.id, node.id)}: ${stateLabel(node.state)}${node.fork ? `, forked from ${shortRun(play.id, node.fork.from)}` : ''}`}
              data-lineage-node={node.id}
              onPointerEnter={() => canvas.setHover(node.id)}
              onPointerLeave={() => canvas.setHover(null)}
              onFocus={() => canvas.setHover(node.id)}
              onBlur={() => canvas.setHover(null)}
              onClick={() => {
                if (canvas.wasDragged()) return
                canvas.setActive(node.id)
                onChoose(node.id)
              }}
            >
              <RunCard play={play} node={node} />
            </button>
          ))}
        </div>
      </div>
      <p className="pc-help faint">Drag to pan · scroll or pinch to zoom · arrow keys follow the line, Enter opens · 0 fits</p>
    </section>
  )
}

/** One run on the canvas: how it ended, when, its agents and findings, its three cost kinds and the hours it lost. */
function RunCard({ play, node }: { play: PlayDocument; node: LineageNode }) {
  const run = node.run
  if (!run)
    return (
      <>
        <span className="pc-title"><b className="mono">{shortRun(play.id, node.id)}</b></span>
        <span className="pc-line faint">named by a later run; not on this host</span>
      </>
    )
  const found = run.findings ? `${run.findings.results} results · ${run.findings.claims} claims` : 'findings not derived yet'
  return (
    <>
      <span className="pc-title"><b className="mono">{shortRun(play.id, run.id)}</b></span>
      <span className="pc-line ln-state">
        <span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>
        <span className="faint">{when(run.startedAt).slice(0, 16)}{run.nodes ? ` · ${plural(run.nodes, 'agent')}` : ''}</span>
      </span>
      <span className="pc-line">{found}</span>
      <span className="pc-line mono ln-costs" title="Subscription use at API prices (not billed) · model API billed · sandbox compute billed">
        sub {money(run.spend.subscriptionUsd)} · API {money(run.spend.apiUsd)} · box {money(run.spend.sandboxUsd)}
      </span>
      <span className="pc-line faint">{hours(run.lostHours)}{node.releases.length ? ` · ${plural(node.releases.length, 'release')}` : ''}</span>
    </>
  )
}

function edgePath(model: LineageModel, edge: LineageEdge): string {
  const from = model.byId.get(edge.from)!
  const to = model.byId.get(edge.to)!
  const x1 = PAD + from.x + L_NODE_W
  const y1 = PAD + from.y + L_NODE_H / 2
  const x2 = PAD + to.x
  const y2 = PAD + to.y + L_NODE_H / 2
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function edgeClass(edge: LineageEdge, lit: Set<string> | null, selected: string | null): string {
  const hot = lit && lit.has(edge.from) && lit.has(edge.to)
  return ['pc-edge', `ln-edge-${edge.kind}`, edge.to === selected && 'into', hot && 'hot', lit && !hot && 'dim'].filter(Boolean).join(' ')
}

function LineageIntro({ play, model }: { play: PlayDocument; model: LineageModel }) {
  const forks = play.lineage.forks ?? []
  return (
    <div className="pc-intro">
      <h2>How the runs connect</h2>
      <p>
        {plural(model.counts.runs, 'run')}, oldest at the left. Each edge is a recorded link: a fork (its fork.json), a supersedes or a continuation (the
        run's registration). Select a run for what changed when it was made, what it carried and what it released.
      </p>
      {forks.length > 0 && (
        <ol className="ln-fork-list">
          {forks.map((fork) => (
            <li key={fork.to}>
              <b className="mono">{shortRun(play.id, fork.from)} → {shortRun(play.id, fork.to)}</b>
              {fork.why?.reason && <span className="faint"> {fork.why.reason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** The selected run: its outcome, how it was made (the fork that made it), what it released, and a link to it. */
function RunStory({ play, model, node, onChoose }: { play: PlayDocument; model: LineageModel; node: LineageNode; onChoose: (id: string) => void }) {
  const run = node.run
  const into = model.edges.filter((edge) => edge.to === node.id)
  const out = model.edges.filter((edge) => edge.from === node.id)
  return (
    <div className="pc-detail ln-detail" data-lineage-selected={node.id}>
      <h2 className="mono">{shortRun(play.id, node.id)}</h2>
      {run ? (
        <>
          <p>
            <span className={`state-pill ${stateClass(run.state)}`}>{stateLabel(run.state)}</span>
            {run.reason && run.reason !== run.state && <span className="faint"> {run.reason}</span>}
          </p>
          <p className="faint">
            Started {when(run.startedAt)}
            {run.settledAt ? ` · settled ${when(run.settledAt)}` : ''} · <a href={`/run/${encodeURIComponent(run.id)}`} onClick={(event) => { event.preventDefault(); go(`/run/${encodeURIComponent(run.id)}`) }}>Open the run</a>
          </p>
        </>
      ) : (
        <p className="faint">A later run names this one; this host holds no record of it.</p>
      )}
      {node.fork && <ForkDetail play={play} fork={node.fork} />}
      {!node.fork && into.length > 0 && (
        <p>
          {into.map((edge) => (
            <span key={edge.id}>
              {edge.kind === 'supersedes' ? 'Supersedes' : edge.kind === 'continues' ? 'Continues' : 'Retries'}{' '}
              <button type="button" className="link-button mono" onClick={() => onChoose(edge.from)}>{shortRun(play.id, edge.from)}</button>{' '}
            </span>
          ))}
        </p>
      )}
      {out.length > 0 && (
        <p className="faint">
          Continued by{' '}
          {out.map((edge, i) => (
            <span key={edge.id}>
              {i > 0 && ', '}
              <button type="button" className="link-button mono" onClick={() => onChoose(edge.to)}>{shortRun(play.id, edge.to)}</button> ({edge.kind})
            </span>
          ))}
        </p>
      )}
      {node.releases.length > 0 && (
        <>
          <h3>Releases it declared</h3>
          <ol className="ln-releases">
            {node.releases.map((release) => <ReleaseLine key={release.id} play={play} release={release} />)}
          </ol>
        </>
      )}
    </div>
  )
}

/** What a fork recorded: why, what moved in the root, what it carried, which profiles it revised and which files changed. */
function ForkDetail({ play, fork }: { play: PlayDocument; fork: Fork }) {
  const moved = fork.root.moved.filter((key) => key !== 'profile' && key !== 'version')
  return (
    <section className="ln-fork" aria-label="The fork that made this run">
      <h3>Forked from <span className="mono">{shortRun(play.id, fork.from)}</span>{fork.at ? <span className="faint"> · {when(fork.at)}</span> : null}</h3>
      {fork.why?.reason ? (
        <blockquote className="ln-why">
          {fork.why.reason}
          <cite className="faint"> {fork.why.source === 'record' ? 'the fork’s registration' : 'the source’s cancellation'}</cite>
        </blockquote>
      ) : (
        <p className="faint">No reason was recorded with this fork.</p>
      )}
      <dl className="ln-facts">
        <dt>Root</dt>
        <dd>
          {moved.length ? (
            moved.map((key) => (
              <span key={key} className="ln-move">
                {key} <span className="mono">{rootValue(fork.root.from, key)}</span> → <span className="mono">{rootValue(fork.root.to, key)}</span>
              </span>
            ))
          ) : (
            <span className="faint">same model, provider and harness</span>
          )}
        </dd>
        <dt>Carried</dt>
        <dd>
          {fork.knowledge.files !== null ? `${fork.knowledge.files.toLocaleString('en-US')} knowledge files` : 'a knowledge seed'}
          {fork.knowledge.seed && <span className="mono faint" title={fork.knowledge.seed}> {fork.knowledge.seed.slice(0, 19)}…</span>}
          {fork.inheritedTags.length > 0 && <> · releases {fork.inheritedTags.length > 4 ? `${fork.inheritedTags[0]}…${fork.inheritedTags.at(-1)}` : fork.inheritedTags.join(', ')}</>}
        </dd>
        {fork.files && (
          <>
            <dt>Changed</dt>
            <dd>
              {plural(fork.files.changed ?? 0, 'file')} at the fork commit
              {fork.files.insertions !== null && <span className="faint"> (+{fork.files.insertions} −{fork.files.deletions ?? 0})</span>}
            </dd>
          </>
        )}
      </dl>
      {fork.profiles.length > 0 && (
        <details className="ln-profiles">
          <summary>{plural(fork.profiles.length, 'profile change')}</summary>
          <ul>
            {fork.profiles.map((profile, i) => (
              <li key={profile.commit ?? i}>
                <b>{profile.role ?? profile.subject}</b> {profile.status && <span className="chip">{profile.status}</span>}
                {profile.reason && <div className="faint">{profile.reason}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {fork.files && fork.files.paths.length > 0 && (
        <details className="ln-paths">
          <summary>Files the fork commit changed</summary>
          <ul className="mono">
            {fork.files.paths.map((row, i) => <li key={i}><span className={`ln-status ln-${row.status}`}>{row.status?.[0]?.toUpperCase()}</span> {row.path}</li>)}
          </ul>
        </details>
      )}
    </section>
  )
}

const rootValue = (root: Fork['root']['from'], key: string) => {
  const value = root ? (root as Record<string, unknown>)[key] : null
  return typeof value === 'string' && value ? value : '—'
}

function ReleaseLine({ play, release }: { play: PlayDocument; release: Release }) {
  const score = release.score
  return (
    <li className="ln-release" data-release={release.id}>
      <b className="mono">{release.tag}</b> <span className="faint">{when(release.at)} · {release.agent ?? 'unknown agent'}</span>
      {release.previous && release.previous.run && release.previous.run !== release.run && <span className="faint"> · after {shortRun(play.id, release.previous.run)} {release.previous.tag}</span>}
      <div>
        {release.changes ? <>{plural(release.changes.changed ?? 0, 'file')} (+{release.changes.insertions ?? 0} −{release.changes.deletions ?? 0})</> : <span className="faint">first release</span>}
        {release.deliverables && release.deliverables.length > 0 && <> · {release.deliverables.join(', ')}</>}
        {score && (
          <span className="ln-score">
            {' '}· {score.exact ? `exact ${score.exact[0]}/${score.exact[1]}` : ''}
            {score.heldOut ? ` · held-out ${score.heldOut[0]}/${score.heldOut[1]}` : ''}
            {score.judge !== null ? ` · judge ${Math.round(score.judge)}` : ''}
          </span>
        )}
      </div>
    </li>
  )
}

/** Every release across the play's lines, one column each, against the deliverables they touched. */
function DeliverableTimeline({ play, selectedRun, onChoose }: { play: PlayDocument; selectedRun: string | null; onChoose: (id: string) => void }) {
  const timeline = useMemo(() => deliverableTimeline(play), [play])
  const [open, setOpen] = useState<string | null>(null)
  if (!timeline.releases.length) return null
  const release = open ? timeline.releases.find((item) => item.id === open) ?? null : null
  return (
    <section className="ws-section ln-timeline" aria-label="Deliverable timeline" data-releases={timeline.releases.length}>
      <h3>The deliverable across the chain</h3>
      <p className="faint">
        Each column is a release, oldest first, under the run whose repository declared it; a dot marks a declared deliverable the change since the release before
        it touched. Two lines that forked can each have the same tag.
      </p>
      <div className="table-scroll">
        <table className="data-table ln-matrix">
          <thead>
            <tr>
              <th scope="col">Deliverable</th>
              {timeline.releases.map((item) => (
                <th key={item.id} scope="col" className={item.run === selectedRun ? 'on' : undefined}>
                  <button type="button" className="link-button" onClick={() => { setOpen(item.id === open ? null : item.id); onChoose(item.run) }} title={`${item.run} · ${item.at}`}>
                    <b className="mono">{item.tag}</b>
                    <small className="faint mono">{shortRun(play.id, item.run)}</small>
                    {item.score?.judge != null && <small className="ln-judge">judge {Math.round(item.score.judge)}</small>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeline.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" title={row.path}>{row.id}</th>
                {row.cells.map((cell, i) => (
                  <td key={timeline.releases[i]!.id} className={`ln-cell ${cell === null ? 'unknown' : cell ? 'touched' : ''}`} aria-label={cell === null ? 'change unknown' : cell ? 'changed' : 'unchanged'}>
                    {cell === null ? '·' : cell ? '●' : ''}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="ln-totals">
              <th scope="row">files changed</th>
              {timeline.releases.map((item) => (
                <td key={item.id} className="num">{item.changes ? item.changes.changed : '—'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {release && (
        <div className="ln-release-detail">
          <ReleaseLine play={play} release={release} />
          {release.changes && release.changes.paths.length > 0 && (
            <ul className="mono ln-paths">
              {release.changes.paths.map((row, i) => <li key={i}><span className={`ln-status ln-${row.status}`}>{row.status?.[0]?.toUpperCase()}</span> {row.path}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The play's record (agent-record.v1): one node per run, one fork edge per fork receipt, each run's own record joined by
 * its digest. Read only when opened; a run's full record stays on its run page.
 */
function PlayRecord({ api, play }: { api: string; play: PlayDocument }) {
  const [open, setOpen] = useState(false)
  const url = `${api}/plays/${encodeURIComponent(play.id)}/record`
  const doc = useDocument<unknown>(open ? url : null)
  const parsed = useMemo((): { record: ReturnType<typeof readRecord> | null; error: string | null } => {
    if (!doc.data) return { record: null, error: null }
    try {
      return { record: readRecord(doc.data), error: null }
    } catch (error) {
      return { record: null, error: error instanceof Error ? error.message : 'not a record' }
    }
  }, [doc.data])
  const record = parsed.record
  const error = doc.error ?? parsed.error
  return (
    <section className="ws-section ln-record" aria-label="The play's record">
      <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
        <summary>The play&rsquo;s record: its runs joined through their fork receipts</summary>
        <p className="faint">
          One record for the whole play (agent-record.v1): a node per run, an edge per fork from its fork.json, and each run&rsquo;s own record joined by its digest.{' '}
          <a href={url} download={`${play.id}.record.json`}>Download it</a>
        </p>
        {open && (error ? <p className="ws-status" role="alert">The play&rsquo;s record is unavailable: {error}</p> : record ? <RecordWorkGraph record={record} /> : <p className="ws-status" role="status">Loading the play&rsquo;s record…</p>)}
      </details>
    </section>
  )
}
