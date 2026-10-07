import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { PlayDocument, ProfileGraphDocument, RunSummary } from '../workspace.js'
import { money, stateClass, stateLabel } from './data.js'
import { canvasModel, COL_W, lineageOf, neighbour, NODE_H, NODE_W, originChain, originText, originVerb, profileRunCost, runPlays } from './profile-canvas.js'
import type { CanvasEdge, CanvasModel, CanvasNode, CanvasScope } from './profile-canvas.js'
import { findProfile, profileGraph, profileState } from './profile-graph.js'
import { ProfileDetail } from './ProfileVersions.js'

const PAD = 48
const MIN_K = 0.12
const MAX_K = 2
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`
const playHref = (play: string) => `/play/${encodeURIComponent(play)}`
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
const KIND_LABEL: Record<string, string> = { root: 'registered', spawned: 'runtime', proposed: 'optimizer', proposal: 'proposed' }
const RELATION_TEXT: Record<string, string> = { authored: 'written by', replaced: 'restart of', revision: 'revision of', treatment: 'treatment of' }

type View = { x: number; y: number; k: number }

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
  const shownId = selectedNode ? (model.byId.has(selectedNode.digest) ? selectedNode.digest : null) : null
  const [inspected, setInspected] = useState<string | null>(null)
  const inspectorId = shownId ?? (inspected && model.byId.has(inspected) ? inspected : null)

  const expand = (parent: string) => setExpanded((current) => new Set([...current, parent]))
  const choose = (id: string) => {
    const node = model.byId.get(id)
    if (!node) return
    if (node.cluster) {
      expand(node.cluster.parent)
      setInspected(id)
      return
    }
    setInspected(null)
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
  const viewport = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const [hover, setHover] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const keyboard = useRef(false)
  const worldW = model.width + PAD * 2
  const worldH = model.height + PAD * 2

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitView = useCallback((): View | null => {
    if (!size) return null
    const k = clampK(Math.min((size.w - 32) / worldW, (size.h - 32) / worldH, 1))
    return { k, x: (size.w - worldW * k) / 2, y: Math.max(8, (size.h - worldH * k) / 2) }
  }, [size, worldW, worldH])
  const centred = useCallback(
    (id: string, k: number): View | null => {
      const node = model.byId.get(id)
      if (!node || !size) return null
      const cx = PAD + node.x + NODE_W / 2
      const cy = PAD + node.y + NODE_H / 2
      return { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k }
    },
    [model, size],
  )

  // The opening view: the whole canvas when it reads at half size or more, else the focus at a readable size.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !size) return
    opened.current = true
    const fit = fitView()
    const start = selectedId ?? model.focus
    const node = start ? model.byId.get(start) : undefined
    if (fit && (fit.k >= 0.55 || !node)) return setView(fit)
    // Too wide to read whole: open at a readable size with the focus's parent column at the left edge.
    const k = 0.85
    const left = PAD + Math.max(0, node!.x - (node!.parent ? COL_W : 0))
    setView({ k, x: 24 - left * k, y: size.h / 2 - (PAD + node!.y + NODE_H / 2) * k })
  }, [size, fitView, centred, model.focus, selectedId])

  // A selection made outside the canvas (a link in the inspector, the URL) is brought into view.
  useEffect(() => {
    if (!selectedId || !size) return
    const node = model.byId.get(selectedId)
    const current = viewRef.current
    if (!node || !current) return
    const left = current.x + (PAD + node.x) * current.k
    const top = current.y + (PAD + node.y) * current.k
    if (left < 0 || top < 0 || left + NODE_W * current.k > size.w || top + NODE_H * current.k > size.h) setView(centred(selectedId, Math.max(current.k, 0.6)))
  }, [selectedId, model, size, centred])

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((current) => {
      if (!current) return current
      const k = clampK(current.k * factor)
      return { k, x: px - (px - current.x) * (k / current.k), y: py - (py - current.y) * (k / current.k) }
    })
  const zoomCentre = (factor: number) => size && zoomAt(size.w / 2, size.h / 2, factor)

  // Wheel: a pinch (ctrl) or a mouse wheel zooms at the pointer; a two-finger trackpad scroll pans.
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 40)
      if (event.ctrlKey || event.metaKey || mouseWheel) {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey && !mouseWheel ? 0.01 : 0.0015) * (event.deltaMode === 1 ? 16 : 1))
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor)
      } else setView((current) => (current ? { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY } : current))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // Drag pans, two pointers pinch; a press that moves less than a few pixels stays a click on the node under it.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ from: View; x: number; y: number; dist: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const startGesture = () => {
    const points = [...pointers.current.values()]
    const current = viewRef.current
    if (!current || !points.length) return (gesture.current = null)
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    const dist = points.length > 1 ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0
    gesture.current = { from: current, x, y, dist, moved: gesture.current?.moved ?? false }
  }
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    dragged.current = false
    startGesture()
  }
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (!g) return
    const points = [...pointers.current.values()]
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    if (!g.moved && Math.hypot(x - g.x, y - g.y) < 5 && points.length < 2) return
    if (!g.moved) {
      g.moved = true
      viewport.current?.setPointerCapture(event.pointerId)
    }
    dragged.current = true
    const rect = viewport.current!.getBoundingClientRect()
    if (points.length > 1 && g.dist > 0) {
      const dist = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
      const k = clampK(g.from.k * (dist / g.dist))
      const px = g.x - rect.left
      const py = g.y - rect.top
      setView({ k, x: px - (px - g.from.x) * (k / g.from.k) + (x - g.x), y: py - (py - g.from.y) * (k / g.from.k) + (y - g.y) })
    } else setView({ ...g.from, x: g.from.x + (x - g.x), y: g.from.y + (y - g.y) })
  }
  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size) startGesture()
    else gesture.current = null
  }

  const current = active && model.byId.has(active) ? active : selectedId && model.byId.has(selectedId) ? selectedId : model.focus
  useEffect(() => {
    if (!keyboard.current || !current) return
    keyboard.current = false
    buttons.current.get(current)?.focus({ preventScroll: true })
  }, [current])
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const key = event.key
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      const next = current ? neighbour(model, current, key) : model.focus
      if (!next) return
      keyboard.current = true
      setActive(next)
      setHover(next)
      const node = model.byId.get(next)!
      const v = viewRef.current
      if (v && size) {
        const left = v.x + (PAD + node.x) * v.k
        const top = v.y + (PAD + node.y) * v.k
        if (left < 16 || top < 16 || left + NODE_W * v.k > size.w - 16 || top + NODE_H * v.k > size.h - 16) setView(centred(next, v.k))
      }
    } else if (key === '+' || key === '=') zoomCentre(1.25)
    else if (key === '-' || key === '_') zoomCentre(0.8)
    else if (key === '0') setView(fitView())
    else if (key === 'f' && current) setView(centred(current, Math.max(viewRef.current?.k ?? 0.85, 0.85)))
    else if (key === 'Escape') setHover(null)
    else return
  }

  const lit = useMemo(() => {
    const id = hover ?? selectedId
    return id && model.byId.has(id) ? lineageOf(model, id) : null
  }, [hover, selectedId, model])

  const k = view?.k ?? 1
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
        <div className="pc-controls" role="group" aria-label="Canvas view">
          {(model.counts.clustered > 0 || allOpen) && (
            <button type="button" className="ui-button" onClick={onToggleAll} aria-pressed={allOpen}>
              {allOpen ? 'Collapse runtime profiles' : `Expand all (${model.counts.clustered})`}
            </button>
          )}
          <button type="button" className="ui-button" onClick={() => zoomCentre(0.8)} aria-label="Zoom out">−</button>
          <span className="pc-zoom mono" aria-live="polite">{Math.round(k * 100)}%</span>
          <button type="button" className="ui-button" onClick={() => zoomCentre(1.25)} aria-label="Zoom in">+</button>
          <button type="button" className="ui-button" onClick={() => setView(fitView())}>Fit</button>
          {selectedId && <button type="button" className="ui-button" onClick={() => setView(centred(selectedId, Math.max(k, 0.85)))}>Selected</button>}
        </div>
      </div>
      <div
        ref={viewport}
        className="pc-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        data-zoom={k.toFixed(2)}
      >
        <div
          className="pc-world"
          style={{ width: worldW, height: worldH, transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.k})` : undefined, visibility: view ? 'visible' : 'hidden' }}
        >
          <svg className="pc-edges" width={worldW} height={worldH} aria-hidden="true">
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
                  {label}
                </span>
              )
            })}
          {model.nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              on={node.id === selectedId}
              active={node.id === current}
              dim={!!lit && !lit.has(node.id)}
              hot={!!lit && lit.has(node.id) && node.id !== (hover ?? selectedId)}
              register={(element) => (element ? buttons.current.set(node.id, element) : buttons.current.delete(node.id))}
              onHover={setHover}
              onChoose={(id) => {
                if (dragged.current) return
                setActive(id)
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
  const name = profile.name ?? profile.label ?? profile.short
  return (
    <button
      {...common}
      className={`${classes} kind-${profile.kind}`}
      data-profile-node={profile.short}
      aria-pressed={on}
      aria-label={`${name}, ${KIND_LABEL[profile.kind] ?? profile.kind} profile ${profile.short}${node.foreign && node.play ? `, from play ${node.play}` : ''}`}
      title={profile.description ?? undefined}
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
        {` · ${profile.runs.length} ${profile.runs.length === 1 ? 'run' : 'runs'}`}
        {node.elsewhere.plays.length > 0 ? ` · ${node.elsewhere.plays.length} other ${node.elsewhere.plays.length === 1 ? 'play' : 'plays'}` : ''}
      </span>
    </button>
  )
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

/** A lineage edge's label: its relation, whether it crosses plays, and the run that made it when that says something new. */
function edgeLabel(model: CanvasModel, edge: CanvasEdge, lit: Set<string> | null, shortRun: (runId: string) => string): string | null {
  const to = model.byId.get(edge.to)
  const hot = !!lit && lit.has(edge.from) && lit.has(edge.to)
  const origin = originText(edge, shortRun)
  const telling = !!edge.origin && (hot || !to?.inScope || edge.originKind === 'proposed' || edge.crossPlay)
  const relation = edge.relation === 'replaced' ? 'restart' : edge.relation
  return [relation, edge.crossPlay ? 'across plays' : null, telling ? origin : null].filter(Boolean).join(' · ')
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
        playCache.set(url, fetch(url, { credentials: 'same-origin' }).then((response) => (response.ok ? (response.json() as Promise<PlayDocument>) : null)).catch(() => null))
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
  if (at.cluster) {
    const cluster = at.cluster
    const parent = model.byId.get(cluster.parent)
    return (
      <div className="inspector" data-inspector-cluster={cluster.members.length}>
        <header className="inspector-head">
          <h2>{cluster.members.length} profiles written at runtime</h2>
        </header>
        <p className="faint">Written by agents running {parent?.node ? (parent.node.name ?? parent.node.short) : 'their parent'}; expanded on the canvas.</p>
        <ul className="pc-members">
          {cluster.members.map((member) => (
            <li key={member.digest}>
              <button type="button" className="link-button" onClick={() => onSelectShort(member.short)}>{member.name ?? member.label ?? member.short}</button>{' '}
              <code className="faint">{member.short}</code> <span className="faint">{member.model.id ?? ''}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
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
          </span>
        )}
        {run ? (
          <span className={own ? 'faint' : undefined}>
            run: model API {money(run.spend.apiUsd)} · sandbox {money(run.spend.sandboxUsd)} billed · subscription {money(run.spend.subscriptionUsd)} at API prices
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
          {chain.map(({ node: step, edge }, i) => {
            const profile = step.node
            const label = profile ? (profile.name ?? profile.label ?? profile.short) : 'runtime profiles'
            return (
              <li key={step.id} className={step.foreign ? 'foreign' : undefined}>
                {i === 0 ? <b>{label}</b> : <button type="button" className="link-button" onClick={() => onChoose(step.id)}>{label}</button>}{' '}
                {profile && <code className="faint">{profile.short}</code>}
                {step.foreign && step.play && <> <a className="chip mono pc-foreign-chip" href={playHref(step.play)}>{step.play}</a></>}
                {edge && (
                  <div className="faint pc-chain-edge">
                    {RELATION_TEXT[edge.relation] ?? edge.relation}
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
