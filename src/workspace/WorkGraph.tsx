import { useCallback, useMemo, useState } from 'react'
import type { RunRecord } from '../record.js'
import type { RunDocument } from '../workspace.js'
import { PageReader } from './Findings.js'
import { CanvasControls } from './ProfileCanvas.js'
import { useCanvasView } from './useCanvasView.js'
import type { ArrowKey } from './useCanvasView.js'
import { LANE_H, NODE_H, NODE_W, PER_LANE, runWorkGraphModel, recordWorkGraphModel } from './work-graph-model.js'
import type { GraphNode, WorkGraphModel } from './work-graph-model.js'

/**
 * The run's work graph: each agent's results, claims and checks on its own lane in the order it wrote them, the papers
 * they cite on a lane above, and an edge wherever one page names another (findings.links) or a page cites a paper
 * (citations[].citedBy). Selecting a page lights its neighbours and opens it beside the graph.
 */
export function WorkGraph({ doc, runUrl, onOpen }: { doc: RunDocument; runUrl: string; onOpen: (sha: string) => void }) {
  const graph = useMemo(() => doc.findings ? runWorkGraphModel(doc.findings) : null, [doc.findings])
  if (!graph || !graph.nodes.length)
    return <p className="ws-status run-panel">No results, claims or checks were written, so there is no graph to draw.</p>
  return <WorkGraphCanvas graph={graph} runUrl={runUrl} onOpen={onOpen} />
}

/** Draw a combined multi-harness record with the same interaction engine as the live run graph. */
export function RecordWorkGraph({ record }: { record: RunRecord }) {
  const graph = useMemo(() => recordWorkGraphModel(record), [record])
  return <div className="agent-record ar-ws"><WorkGraphCanvas graph={graph} /></div>
}

function WorkGraphCanvas({ graph, runUrl, onOpen }: { graph: WorkGraphModel; runUrl?: string; onOpen?: (sha: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedId = selected && graph.byId.has(selected) ? selected : null
  const box = useCallback((id: string) => {
    const node = graph.byId.get(id)
    return node ? { x: node.x, y: node.y, w: NODE_W, h: NODE_H } : null
  }, [graph])
  const neighbour = useCallback((id: string, key: ArrowKey) => {
    const from = graph.byId.get(id)
    if (!from) return null
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
    return graph.nodes
      .filter((node) => node.id !== id && (horizontal ? (node.x - from.x) * sign > 0 : (node.y - from.y) * sign > 0))
      .sort((a, b) => {
        // Stay on the same lane or column when possible, then take the nearest card in that direction.
        const score = (node: GraphNode) => horizontal
          ? Math.abs(node.y - from.y) * 4 + Math.abs(node.x - from.x)
          : Math.abs(node.x - from.x) * 4 + Math.abs(node.y - from.y)
        return score(a) - score(b) || a.id.localeCompare(b.id)
      })[0]?.id ?? null
  }, [graph])
  const first = graph.nodes[0]
  const canvas = useCanvasView({
    width: graph.width,
    height: graph.height,
    box,
    focus: first?.id ?? null,
    selectedId,
    neighbour,
    open: (size, fit) => {
      if (fit.k >= 0.65 || !first) return null
      const k = 0.85
      return { k, x: 24 - first.x * k, y: Math.min(32, size.h / 3) - first.y * k }
    },
  })
  const focus = canvas.hover ?? selectedId
  const near = new Set<string>(focus ? [focus] : [])
  if (focus) for (const edge of graph.edges) if (edge.from === focus || edge.to === focus) near.add(edge.from === focus ? edge.to : edge.from)
  const chosen = selectedId ? graph.byId.get(selectedId) : null
  const path = (from: GraphNode, to: GraphNode) => {
    const sameLane = from.y === to.y
    if (sameLane) {
      // Along a lane: an arc above the cards, so it never runs through the cards between.
      const x1 = from.x + NODE_W / 2
      const x2 = to.x + NODE_W / 2
      const lift = Math.min(46, 14 + Math.abs(x2 - x1) / 12)
      return `M ${x1} ${from.y} C ${x1} ${from.y - lift}, ${x2} ${to.y - lift}, ${x2} ${to.y}`
    }
    const down = to.y > from.y
    const x1 = from.x + NODE_W / 2
    const y1 = down ? from.y + NODE_H : from.y
    const x2 = to.x + NODE_W / 2
    const y2 = down ? to.y : to.y + NODE_H
    const bend = (y2 - y1) / 2
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
  }
  return (
    <section className="work-graph" aria-label={graph.title} data-work-graph={graph.nodes.length} data-graph-kind={runUrl ? 'run' : 'record'}>
      <div className="graph-main">
        <div className="graph-head">
          <h2 className="kicker tone-finding">{graph.title}</h2>
          <span className="faint">
            {graph.summary}
          </span>
          <CanvasControls canvas={canvas} selectedId={selectedId} />
        </div>
        <div {...canvas.viewportProps} className="graph-viewport pc-viewport" data-zoom={canvas.k.toFixed(2)}>
          <div className="graph-canvas pc-world" style={canvas.worldStyle}>
            {graph.sourcesLane && <div className="graph-lane sources" style={{ top: 4, height: LANE_H - 8 }} />}
            {graph.laneLabels.map((lane, i) => (
              <div key={lane.label + i} className="graph-lane" style={{ top: lane.y - 17, height: LANE_H - 8 }} />
            ))}
            <svg className="graph-edges" width={graph.width} height={graph.height} aria-hidden="true">
              {graph.edges.map((edge, i) => {
                const from = graph.byId.get(edge.from)!
                const to = graph.byId.get(edge.to)!
                const lit = !focus || edge.from === focus || edge.to === focus
                return <path key={i} data-graph-edge-kind={edge.kind} d={path(from, to)} className={`edge edge-${edge.kind} ${lit ? 'lit' : 'dim'}`} />
              })}
            </svg>
            {graph.sourcesLane && <span className="graph-lane-label" style={{ top: 30 }}>Sources</span>}
            {graph.columnLabels.map((column) => <span key={column.label} className="graph-column-label" style={{ left: column.x }}>{column.label}</span>)}
            {graph.laneLabels.map((lane, i) => (
              <span key={`l${i}`} className="graph-lane-label" style={{ top: lane.y + 8 }}>{lane.label}</span>
            ))}
            {graph.nodes.map((node) => (
              <button
                key={node.id}
                ref={(element) => { canvas.register(node.id)(element) }}
                type="button"
                data-graph-node-kind={node.kind}
                data-graph-node-id={node.id}
                className={`graph-node kind-${node.kind} ${selectedId === node.id ? 'on' : ''} ${focus && !near.has(node.id) ? 'dim' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                title={node.title}
                tabIndex={canvas.current === node.id ? 0 : -1}
                aria-pressed={selectedId === node.id}
                onClick={() => {
                  if (canvas.wasDragged()) return
                  canvas.setActive(node.id)
                  setSelected(selected === node.id ? null : node.id)
                }}
                onPointerEnter={() => canvas.setHover(node.id)}
                onPointerLeave={() => canvas.setHover(null)}
                onFocus={() => canvas.setHover(node.id)}
                onBlur={() => canvas.setHover(null)}
              >
                <span className="graph-node-title">{node.title}</span>
                <span className="graph-node-sub">{node.sub}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="pc-help faint">Drag to pan · scroll or pinch to zoom · arrow keys move between cards, Enter selects · 0 fits</p>
        {Object.keys(graph.hidden).length > 0 && (
          <p className="faint card-note">
            Each lane shows its first {PER_LANE} results, claims and checks; {Object.values(graph.hidden).reduce((a, b) => a + b, 0)} more are listed under Findings.
          </p>
        )}
        <div className="graph-legend">
          {graph.legend.map((entry) => <span key={entry.kind}><i className={`edge-swatch edge-${entry.kind}`} />{entry.label}</span>)}
        </div>
      </div>
      <aside className="graph-side finding-card" aria-label="Selected card">
        {chosen ? (
          chosen.item ? (
            <>
              <h3 className="kicker tone-finding">{chosen.kind}</h3>
              <div className="graph-side-title">{chosen.title}</div>
              <div className="faint">{chosen.sub}</div>
              <p className="finding-summary">{chosen.item.answer ?? chosen.item.summary}</p>
              <div className="graph-side-links faint">
                {graph.edges.filter((edge) => edge.from === chosen.id).length} names out ·{' '}
                {graph.edges.filter((edge) => edge.to === chosen.id).length} named by
              </div>
              <div className="finding-actions">
                {onOpen && <button type="button" className="ui-button" onClick={() => onOpen(chosen.id)}>Open in findings</button>}
              </div>
              {runUrl && <PageReader href={`${runUrl}/page/${chosen.id}`} />}
            </>
          ) : (
            <>
              <h3 className="kicker tone-info">{chosen.kind}</h3>
              <div className="graph-side-title">{chosen.title}</div>
              <div className="faint">{chosen.sub}</div>
              {chosen.summary && <p className="finding-summary">{chosen.summary}</p>}
              <div className="faint">{graph.edges.filter((edge) => edge.from === chosen.id).length} links out · {graph.edges.filter((edge) => edge.to === chosen.id).length} links in</div>
              {chosen.href && (
                <a href={chosen.href} target="_blank" rel="noopener noreferrer">Open source ↗</a>
              )}
            </>
          )
        ) : (
          <p className="faint">Select a card to see its recorded relationships and details.</p>
        )}
      </aside>
    </section>
  )
}
