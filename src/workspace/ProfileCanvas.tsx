import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PlayDocument, ProfileGraphDocument, ProfileNode, RunSummary } from '../workspace.js'
import { money, stateClass, stateLabel } from './data.js'
import { canvasModel, COL_W, lineageOf, neighbour, NODE_H, NODE_W, originChain, originText, originVerb, profileRunCost, runPlays } from './profile-canvas.js'
import type { CanvasEdge, CanvasModel, CanvasNode, CanvasScope } from './profile-canvas.js'
import { findProfile, profileGraph, profileState } from './profile-graph.js'
import { ProfileDetail } from './ProfileVersions.js'
import { useCanvasView } from './useCanvasView.js'
import type { Box } from './useCanvasView.js'

const PAD = 48
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`
const playHref = (play: string) => `/play/${encodeURIComponent(play)}`
const KIND_LABEL: Record<string, string> = { root: 'registered', spawned: 'runtime', proposed: 'optimizer', proposal: 'proposed' }
const RELATION_TEXT: Record<string, string> = { authored: 'written at runtime by an agent running', replaced: 'restarted from', revision: 'revised from', treatment: 'the treatment arm of' }

/**
 * A pan-and-zoom canvas of the agent profiles a run (or a play) used, each traced back to the version it derives from
 * and the run whose evidence proposed it, across plays. Selecting a profile shows its rules, scorecards, the diff from
 * its parent and the runs that used it with their outcomes and costs.
 */
export function ProfileCanvas({
  api,
  doc,
  scope,
  selected,
  onSelect,
}: {
  api: string
  doc: ProfileGraphDocument
  scope: CanvasScope
  /** The selected profile's short or full digest. */
  selected: string | null
  onSelect: (short: string | null) => void
}) {
  const graph = useMemo(() => profileGraph(doc), [doc])
  const selectedNode = findProfile(graph, selected)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [allOpen, setAllOpen] = useState(false)
  const model = useMemo(() => {
    const open = allOpen ? new Set(doc.nodes.map((node) => node.digest)) : expanded
    return canvasModel(doc, scope, open, selectedNode?.digest ?? null)
  }, [doc, scope, expanded, allOpen, selectedNode?.digest])
  const playOf = useMemo(() => runPlays(doc), [doc])
  const scopePlay = scope.kind === 'run' ? (scope.play ?? playOf(scope.runId)) : scope.play
  const shortRun = useCallback((runId: string) => {
    const play = playOf(runId) ?? scopePlay
    return play && runId.startsWith(`${play}-`) && play === scopePlay ? runId.slice(play.length + 1) : runId
  }, [playOf, scopePlay])
  const inspectorId = selectedNode && model.byId.has(selectedNode.digest) ? selectedNode.digest : null

  const expand = (parent: string) => setExpanded((current) => new Set([...current, parent]))
  const choose = (id: string) => {
    const node = model.byId.get(id)
    if (!node) return
    if (node.cluster) return expand(node.cluster.parent)
    onSelect(node.node!.short)
  }
  if (!model.nodes.length)
    return <p className="ws-status run-panel">No profile of this {scope.kind} is indexed yet. Profiles are indexed from the run records after each run settles.</p>
  return (
    <div className="pc-layout" data-profile-canvas={scope.kind === 'run' ? scope.runId : scope.play}>
      <CanvasPane
        model={model}
        scope={scope}
        selectedId={inspectorId}
        shortRun={shortRun}
        allOpen={allOpen}
        onToggleAll={() => {
          setAllOpen((value) => !value)
          setExpanded(new Set())
        }}
        onChoose={choose}
      />
      <aside className="pc-inspector" aria-label="Selected profile">
        {inspectorId ? (
          <CanvasInspector api={api} doc={doc} model={model} id={inspectorId} scopePlay={scopePlay} shortRun={shortRun} onChoose={choose} onSelectShort={onSelect} />
        ) : (
          <CanvasIntro model={model} scope={scope} shortRun={shortRun} />
        )}
      </aside>
    </div>
  )
}

function CanvasIntro({ model, scope, shortRun }: { model: CanvasModel; scope: CanvasScope; shortRun: (runId: string) => string }) {
  return (
    <div className="pc-intro">
      <h2>{scope.kind === 'run' ? `Profiles of ${shortRun(scope.runId)}` : `Profiles of ${scope.play}`}</h2>
      <p>
        {model.counts.inScope} {model.counts.inScope === 1 ? 'profile' : 'profiles'} {scope.kind === 'run' ? 'this run used or proposed' : 'this play used or proposed'}
        {model.counts.ancestors ? `, and ${model.counts.ancestors} earlier ${model.counts.ancestors === 1 ? 'version' : 'versions'} they derive from` : ''}.
        {model.foreignPlays.length ? ` Some came from ${model.foreignPlays.length === 1 ? 'another play' : `${model.foreignPlays.length} other plays`}: ${model.foreignPlays.join(', ')}.` : ''}
      </p>
      <p className="faint">
        Each column is one step of lineage: a registered profile, the versions revised from it and the profiles its agents wrote at runtime. A dashed
        card is an earlier version outside this {scope.kind}; a labelled card came from another play. Select a profile for its rules, scorecards,
        what changed from its parent and the runs that used it.
      </p>
      <ul className="pc-key">
        <li><span className="pc-swatch rel-revision" /> revision: a later version, proposed or registered from a run's evidence</li>
        <li><span className="pc-swatch rel-treatment" /> treatment: the parent is its control arm</li>
        <li><span className="pc-swatch rel-replaced" /> restart: a worker restarted with a changed profile</li>
        <li><span className="pc-swatch rel-authored" /> written at runtime by an agent running the parent</li>
        <li><span className="pc-swatch cross" /> crosses into another play</li>
      </ul>
    </div>
  )
}

function CanvasPane({
  model,
  scope,
  selectedId,
  shortRun,
  allOpen,
  onToggleAll,
  onChoose,
}: {
  model: CanvasModel
  scope: CanvasScope
  selectedId: string | null
  shortRun: (runId: string) => string
  allOpen: boolean
  onToggleAll: () => void
  onChoose: (id: string) => void
}) {
  const box = useCallback((id: string): Box | null => {
    const node = model.byId.get(id)
    return node ? { x: PAD + node.x, y: PAD + node.y, w: NODE_W, h: NODE_H } : null
  }, [model])
  const canvas = useCanvasView({
    width: model.width + PAD * 2,
    height: model.height + PAD * 2,
    box,
    focus: model.focus,
    selectedId,
    neighbour: (id, key) => neighbour(model, id, key),
    // Too wide to read whole: open at a readable size with the focus's parent column at the left edge, in the upper part
    // of the viewport, which is what shows below the page header.
    open: (size, fit) => {
      const start = selectedId ?? model.focus
      const node = start ? model.byId.get(start) : undefined
      if (fit.k >= 0.55 || !node) return null
      const k = 0.85
      const left = PAD + Math.max(0, node.x - (node.parent ? COL_W : 0))
      return { k, x: 24 - left * k, y: Math.min(size.h / 2, 260) - (PAD + node.y + NODE_H / 2) * k }
    },
  })
  const { hover } = canvas
  const lit = useMemo(() => {
    const id = hover ?? selectedId
    return id && model.byId.has(id) ? lineageOf(model, id) : null
  }, [hover, selectedId, model])

  return (
    <section className="pc-pane" aria-label="Profile lineage canvas">
      <div className="pc-toolbar">
        <p className="pc-summary">
          <b>{model.counts.inScope}</b> {scope.kind === 'run' ? 'in this run' : 'in this play'}
          {model.counts.ancestors > 0 && <> · <b>{model.counts.ancestors}</b> earlier</>}
          {model.foreignPlays.length > 0 && (
            <>
              {' '}· from{' '}
              {model.foreignPlays.map((play, i) => (
                <span key={play}>
                  {i > 0 && ', '}
                  <a href={playHref(play)} className="mono">{play}</a>
                </span>
              ))}
            </>
          )}
        </p>
        <CanvasControls canvas={canvas} selectedId={selectedId}>
          {(model.counts.clustered > 0 || allOpen) && (
            <button type="button" className="ui-button" onClick={onToggleAll} aria-pressed={allOpen}>
              {allOpen ? 'Collapse runtime profiles' : `Expand all (${model.counts.clustered})`}
            </button>
          )}
        </CanvasControls>
      </div>
      <div {...canvas.viewportProps} className="pc-viewport" data-zoom={canvas.k.toFixed(2)}>
        <div className="pc-world" style={canvas.worldStyle}>
          <svg className="pc-edges" width={canvas.worldStyle.width} height={canvas.worldStyle.height} aria-hidden="true">
            {model.edges.map((edge) => (
              <path key={edge.id} d={edgePath(model, edge)} className={edgeClass(edge, lit)} />
            ))}
          </svg>
          {model.edges
            .filter((edge) => edge.relation !== 'authored')
            .map((edge) => {
              const label = edgeLabel(model, edge, lit, shortRun)
              if (!label) return null
              const from = model.byId.get(edge.from)!
              const to = model.byId.get(edge.to)!
              return (
                <span
                  key={`label:${edge.id}`}
                  className={`pc-edge-label rel-${edge.relation}${edge.crossPlay ? ' cross' : ''}${lit && !(lit.has(edge.from) && lit.has(edge.to)) ? ' dim' : ''}`}
                  style={{ left: PAD + (from.x + NODE_W + to.x) / 2, top: PAD + (from.y + to.y + NODE_H) / 2 }}
                >
                  {label.head}
                  {label.sub && <small title={label.sub}>{label.sub}</small>}
                </span>
              )
            })}
          {model.nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              on={node.id === selectedId}
              active={node.id === canvas.current}
              dim={!!lit && !lit.has(node.id)}
              hot={!!lit && lit.has(node.id) && node.id !== (hover ?? selectedId)}
              register={canvas.register(node.id)}
              onHover={canvas.setHover}
              onChoose={(id) => {
                if (canvas.wasDragged()) return
                const first = model.byId.get(id)?.cluster?.members[0]?.digest
                // An expanded cluster's card unmounts; its first profile takes the focus.
                if (first) canvas.moveFocus(first)
                else canvas.setActive(id)
                onChoose(id)
              }}
            />
          ))}
        </div>
      </div>
      <p className="pc-help faint">Drag to pan · scroll or pinch to zoom · arrow keys move along the lineage, Enter opens · 0 fits</p>
    </section>
  )
}

/** Zoom, fit and centre-on-selection buttons for a canvas, after any canvas-specific controls. */
export function CanvasControls({ canvas, selectedId, children }: { canvas: ReturnType<typeof useCanvasView>; selectedId: string | null; children?: ReactNode }) {
  return (
    <div className="pc-controls" role="group" aria-label="Canvas view">
      {children}
      <button type="button" className="ui-button" onClick={canvas.zoomOut} aria-label="Zoom out">−</button>
      <span className="pc-zoom mono">{Math.round(canvas.k * 100)}%</span>
      <button type="button" className="ui-button" onClick={canvas.zoomIn} aria-label="Zoom in">+</button>
      <button type="button" className="ui-button" onClick={canvas.fit}>Fit</button>
      {selectedId && <button type="button" className="ui-button" onClick={() => canvas.centre(selectedId)}>Selected</button>}
    </div>
  )
}

function NodeCard({
  node,
  on,
  active,
  dim,
  hot,
  register,
  onHover,
  onChoose,
}: {
  node: CanvasNode
  on: boolean
  active: boolean
  dim: boolean
  hot: boolean
  register: (element: HTMLButtonElement | null) => void
  onHover: (id: string | null) => void
  onChoose: (id: string) => void
}) {
  const style = { left: PAD + node.x, top: PAD + node.y, width: NODE_W, height: NODE_H }
  const classes = ['pc-node', node.inScope ? 'in' : 'ancestor', node.foreign && 'foreign', on && 'on', dim && 'dim', hot && 'hot'].filter(Boolean).join(' ')
  const common = {
    ref: register,
    type: 'button' as const,
    tabIndex: active ? 0 : -1,
    style,
    onPointerEnter: () => onHover(node.id),
    onPointerLeave: () => onHover(null),
    onFocus: () => onHover(node.id),
    onBlur: () => onHover(null),
    onClick: () => onChoose(node.id),
  }
  if (node.cluster) {
    const names = node.cluster.names
    return (
      <button {...common} className={`${classes} pc-cluster`} data-profile-cluster={node.cluster.members.length} aria-label={`Expand ${node.cluster.members.length} profiles written at runtime`}>
        <span className="pc-title">
          <b>{node.cluster.members.length} profiles written at runtime</b>
        </span>
        <span className="pc-line">{names.slice(0, 3).join(', ')}{names.length > 3 ? ` and ${names.length - 3} more` : ''}</span>
        <span className="pc-line faint">Select to expand</span>
      </button>
    )
  }
  const profile = node.node!
  const state = profileState(profile)
  const full = profile.name ?? profile.label ?? profile.short
  const contract = profile.runs.find((run) => run.contract?.version === 'research-contract-v2')?.contract
  // A registered profile is named after its run; the play is the page's, so the card shows the run's own part.
  const name = node.play && full.startsWith(`${node.play}-`) ? full.slice(node.play.length + 1) : full
  return (
    <button
      {...common}
      className={`${classes} kind-${profile.kind}`}
      data-profile-node={profile.short}
      aria-pressed={on}
      aria-label={`${full}, ${KIND_LABEL[profile.kind] ?? profile.kind} profile ${profile.short}${node.foreign && node.play ? `, from play ${node.play}` : ''}`}
      title={[full, profile.description, contract && `research-contract-v2 ${contract.commit}\n${contract.components.map((component) => `${component.id} ${component.commit.slice(0, 8)} · ${component.message}`).join('\n')}`].filter(Boolean).join('\n')}
    >
      {node.foreign && node.play && <span className="pc-play mono">{node.play}</span>}
      <span className="pc-title">
        <span className={`dot ${stateClass(state)}`} title={stateLabel(state)} />
        <b>{name}</b>
        <span className="pc-kind">{KIND_LABEL[profile.kind] ?? profile.kind}</span>
      </span>
      <span className="pc-line mono">{[profile.model.id ?? 'model unknown', profile.harness].filter(Boolean).join(' · ')}</span>
      <span className="pc-line mono faint">
        {profile.short}
        {profile.version ? ` · v${profile.version}` : ''}
        {contract ? ' · contract v2' : ''}
        {searchText(profile) ?? ` · ${profile.runs.length} ${profile.runs.length === 1 ? 'run' : 'runs'}`}
        {node.elsewhere.plays.length > 0 ? ` · ${node.elsewhere.plays.length} other ${node.elsewhere.plays.length === 1 ? 'play' : 'plays'}` : ''}
      </span>
    </button>
  )
}

/** An optimizer version's standing in its search: its mean on the selection split (else train) and its last decision. */
function searchText(profile: ProfileNode): string | null {
  const search = profile.searches?.at(-1)
  if (!search) return null
  const score = search.scores?.selection ?? search.scores?.train ?? null
  const decision = search.decisions?.at(-1)?.status
  const mean = score && typeof score.mean === 'number' ? `${search.scores?.selection ? 'sel' : 'train'} ${score.mean.toFixed(2)}` : null
  return [mean, decision].filter(Boolean).map((part) => ` · ${part}`).join('') || null
}

function edgePath(model: CanvasModel, edge: CanvasEdge): string {
  const from = model.byId.get(edge.from)!
  const to = model.byId.get(edge.to)!
  const x1 = PAD + from.x + NODE_W
  const y1 = PAD + from.y + NODE_H / 2
  const x2 = PAD + to.x
  const y2 = PAD + to.y + NODE_H / 2
  const dx = Math.max(48, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function edgeClass(edge: CanvasEdge, lit: Set<string> | null): string {
  const hot = lit && lit.has(edge.from) && lit.has(edge.to)
  return ['pc-edge', `rel-${edge.relation}`, edge.home ? 'home' : 'secondary', edge.crossPlay && 'cross', hot && 'hot', lit && !hot && 'dim'].filter(Boolean).join(' ')
}

/** A lineage edge's label: its relation (and whether it crosses plays) over the run that made it, when that says something new. */
function edgeLabel(model: CanvasModel, edge: CanvasEdge, lit: Set<string> | null, shortRun: (runId: string) => string): { head: string; sub: string | null } | null {
  const to = model.byId.get(edge.to)
  const hot = !!lit && lit.has(edge.from) && lit.has(edge.to)
  const telling = !!edge.origin && (hot || !to?.inScope || edge.originKind === 'proposed' || edge.crossPlay)
  // A fan of many like edges reads from its line style; a label on each would stack on the bundle.
  const fan = (model.byId.get(edge.from)?.children.length ?? 0) > 2
  if (fan && !hot && !telling && !edge.crossPlay) return null
  const relation = edge.relation === 'replaced' ? 'restart' : edge.relation
  return { head: edge.crossPlay ? `${relation} · across plays` : relation, sub: telling ? originText(edge, shortRun) : null }
}

/** The origin chain as rows: each step with the edge to the step below it, a run of restarts of one role folded into one row. */
function chainRows(chain: { node: CanvasNode; edge: CanvasEdge | null }[]) {
  const rows: { step: CanvasNode; count: number; edge: CanvasEdge | null; next: CanvasNode | null }[] = []
  const nameOf = (node: CanvasNode) => node.node?.name ?? node.node?.label ?? node.id
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!
    let count = 1
    let j = i
    while (chain[j]?.edge?.relation === 'replaced' && chain[j + 1] && chain[j + 1]!.edge?.relation === 'replaced' && nameOf(chain[j + 1]!.node) === nameOf(step.node)) j++, count++
    rows.push({ step: step.node, count, edge: chain[j]!.edge, next: chain[j + 1]?.node ?? null })
    i = j
  }
  return rows
}

/** Each run's summary (with its spend) from the play documents of the given plays; loaded once per page. */
const playCache = new Map<string, Promise<PlayDocument | null>>()
function useRunSummaries(api: string, plays: readonly string[]): ReadonlyMap<string, RunSummary> {
  const [runs, setRuns] = useState<ReadonlyMap<string, RunSummary>>(() => new Map())
  const key = plays.join('\n')
  useEffect(() => {
    let alive = true
    const loads = plays.map((play) => {
      const url = `${api}/plays/${encodeURIComponent(play)}`
      if (!playCache.has(url))
        playCache.set(
          url,
          fetch(url, { credentials: 'same-origin' })
            .then((response) => (response.ok ? (response.json() as Promise<PlayDocument>) : null))
            .catch(() => null)
            .then((doc) => {
              if (!doc) playCache.delete(url)
              return doc
            }),
        )
      return playCache.get(url)!
    })
    void Promise.all(loads).then((docs) => {
      if (!alive) return
      setRuns(new Map(docs.flatMap((doc) => (doc?.runs ?? []).map((run) => [run.id, run] as const))))
    })
    return () => {
      alive = false
    }
  }, [api, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return runs
}

function CanvasInspector({
  api,
  doc,
  model,
  id,
  scopePlay,
  shortRun,
  onChoose,
  onSelectShort,
}: {
  api: string
  doc: ProfileGraphDocument
  model: CanvasModel
  id: string
  scopePlay: string | null
  shortRun: (runId: string) => string
  onChoose: (id: string) => void
  onSelectShort: (short: string | null) => void
}) {
  const at = model.byId.get(id)!
  const playOf = useMemo(() => runPlays(doc), [doc])
  const runIds = at.node ? at.node.runs.map((run) => run.runId) : []
  // The plays whose run summaries give each run's spend: the scope's and those of the runs that used this profile.
  const plays = useMemo(
    () => [...new Set([scopePlay, ...runIds.map((runId) => playOf(runId))].filter((play): play is string => !!play))].slice(0, 6).sort(),
    [scopePlay, runIds.join('\n'), playOf], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const summaries = useRunSummaries(api, plays)
  const node = at.node!
  const chain = originChain(model, id)
  const first = chain.at(-1)!.node
  const runCost = (runId: string) => {
    const own = profileRunCost(node, runId)
    const run = summaries.get(runId)
    return (
      <span className="pc-cost">
        {own && (
          <span>
            {own.agents} {own.agents === 1 ? 'agent' : 'agents'}: {money(own.usd)} at API prices
            {own.unmetered ? <span className="faint"> · {own.unmetered} not metered, cost unknown</span> : null}
            {own.unsettled ? <span className="faint"> · {own.unsettled} with no settlement recorded</span> : null}
          </span>
        )}
        {run ? (
          <span className={own ? 'faint' : undefined}>
            run: model API {money(run.spend.apiUsd)} billed · sandbox compute {money(run.spend.sandboxUsd)} billed · subscription use {money(run.spend.subscriptionUsd)} at API prices, not billed
          </span>
        ) : (
          !own && <span className="faint">not recorded here</span>
        )}
      </span>
    )
  }
  return (
    <div className="inspector" data-inspector={node.short}>
      <header className="inspector-head">
        <h2>{node.name ?? node.label ?? node.short}</h2>
        <span className="chip">{KIND_LABEL[node.kind] ?? node.kind}</span>
        {at.play && (
          <a className={`chip mono ${at.foreign ? 'pc-foreign-chip' : ''}`} href={playHref(at.play)} title={at.foreign ? 'This profile came from another play' : 'Its play'}>
            {at.foreign ? `from play ${at.play}` : at.play}
          </a>
        )}
        <code className="faint" title={node.digest}>{node.short}</code>
      </header>
      <section data-origin-chain>
        <h3>Where it came from</h3>
        <ol className="pc-chain">
          {chainRows(chain).map(({ step, count, edge, next }, i) => {
            const profile = step.node
            const label = profile ? (profile.name ?? profile.label ?? profile.short) : 'runtime profiles'
            const nextLabel = next?.node ? (next.node.name ?? next.node.label ?? next.node.short) : null
            return (
              <li key={step.id} className={step.foreign ? 'foreign' : undefined}>
                {i === 0 ? <b>{label}</b> : <button type="button" className="link-button" onClick={() => onChoose(step.id)}>{label}</button>}{' '}
                {profile && <code className="faint">{profile.short}</code>}
                {step.foreign && step.play && <> <a className="chip mono pc-foreign-chip" href={playHref(step.play)}>{step.play}</a></>}
                {edge && (
                  <div className="faint pc-chain-edge">
                    {count > 1 ? `restarted ${count} times, first from` : (RELATION_TEXT[edge.relation] ?? edge.relation)} {nextLabel ?? 'the version below'}
                    {edge.origin && <> · {originVerb(edge)} <a className="mono" href={runHref(edge.origin)}>{shortRun(edge.origin)}</a></>}
                    {edge.basis === 'inferred' && ' · inferred from records'}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {first.node && (
          <p className="faint">
            First version: {first.node.author.kind === 'operator' ? 'registered by an operator' : first.node.author.kind === 'node' ? 'written at runtime by an agent' : first.node.author.kind === 'readout' ? 'proposed by a readout' : `proposed by ${first.node.author.kind}`}
            {first.node.createdIn && <> in <a className="mono" href={runHref(first.node.createdIn)}>{first.node.createdIn}</a></>}.
          </p>
        )}
      </section>
      {at.elsewhere.runs.length > 0 && (
        <section data-elsewhere>
          <h3>Also used elsewhere</h3>
          <p className="faint">
            This exact profile ran in {at.elsewhere.runs.length} other {at.elsewhere.runs.length === 1 ? 'run' : 'runs'}
            {at.elsewhere.plays.length ? `, ${at.elsewhere.plays.length === 1 ? 'in play' : 'across plays'} ${at.elsewhere.plays.join(', ')}` : ''}.
          </p>
          <ul className="pc-elsewhere">
            {at.elsewhere.runs.slice(0, 12).map((runId) => (
              <li key={runId}><a className="mono" href={runHref(runId)}>{runId}</a></li>
            ))}
            {at.elsewhere.runs.length > 12 && <li className="faint">and {at.elsewhere.runs.length - 12} more</li>}
          </ul>
        </section>
      )}
      <ProfileDetail
        doc={doc}
        node={node}
        heading={false}
        runCost={runCost}
        onSelect={(short) => onSelectShort(short)}
      />
    </div>
  )
}
