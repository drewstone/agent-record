import { useMemo, useState } from 'react'
import type { FindingItem, RunDocument } from '../workspace.js'
import { PageReader } from './Findings.js'

const SHOWN_KINDS = new Set(['result', 'claim', 'check'])
const PER_LANE = 14
const LABEL_W = 156
const COL_W = 236
const NODE_W = 204
const NODE_H = 62
const LANE_H = 104
const SOURCES_SHOWN = 10

interface GraphNode {
  id: string
  kind: string
  title: string
  sub: string
  x: number
  y: number
  item: FindingItem | null
  href?: string | null
}

const clock = (value: string | null | undefined) => (value ? `${value.slice(11, 16)} UTC` : 'time unknown')
const short = (label: string | null | undefined) => (label ? label.split(' · ')[0]! : 'agent')

/**
 * The run's work graph: each agent's results, claims and checks on its own lane in the order it wrote them, the papers
 * they cite on a lane above, and an edge wherever one page names another (findings.links) or a page cites a paper
 * (citations[].citedBy). Selecting a page lights its neighbours and opens it beside the graph.
 */
export function WorkGraph({ doc, runUrl, onOpen }: { doc: RunDocument; runUrl: string; onOpen: (sha: string) => void }) {
  const findings = doc.findings
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const graph = useMemo(() => {
    if (!findings) return null
    const lanes = [...new Set(findings.items.filter((item) => SHOWN_KINDS.has(item.kind)).map((item) => item.agent ?? 'unknown'))]
      // The root first: its id is the run id, which every child id extends.
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    const citations = (findings.sources.citations ?? []).slice(0, SOURCES_SHOWN)
    const nodes: GraphNode[] = []
    const top = citations.length ? 1 : 0
    citations.forEach((citation, col) =>
      nodes.push({
        id: `cite:${citation.kind}:${citation.id}`,
        kind: 'source',
        title: citation.kind === 'arxiv' ? `arXiv ${citation.id}` : citation.id,
        sub: `${citation.mentions} mention${citation.mentions === 1 ? '' : 's'}`,
        x: LABEL_W + col * COL_W,
        y: 21,
        item: null,
        href: citation.kind === 'arxiv' ? `https://arxiv.org/abs/${citation.id}` : citation.kind === 'iacr' ? `https://eprint.iacr.org/${citation.id}` : citation.kind === 'doi' ? `https://doi.org/${citation.id}` : null,
      }),
    )
    const hidden: Record<string, number> = {}
    const laneLabels: { label: string; y: number }[] = []
    lanes.forEach((agent, lane) => {
      const items = findings.items
        .filter((item) => (item.agent ?? 'unknown') === agent && SHOWN_KINDS.has(item.kind))
        .sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9'))
      const y = (lane + top) * LANE_H + 21
      laneLabels.push({ label: short(items[0]?.agentLabel ?? agent), y })
      if (items.length > PER_LANE) hidden[agent] = items.length - PER_LANE
      items.slice(0, PER_LANE).forEach((item, col) =>
        nodes.push({ id: item.sha256, kind: item.kind, title: item.title, sub: `${short(item.agentLabel)} · ${clock(item.at)}`, x: LABEL_W + col * COL_W, y, item }),
      )
    })
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const edges: { from: string; to: string; kind: string }[] = []
    for (const link of findings.links ?? []) if (byId.has(link.from) && byId.has(link.to)) edges.push({ from: link.from, to: link.to, kind: byId.get(link.to)!.kind })
    for (const citation of citations)
      for (const sha of (citation.citedBy as string[] | undefined) ?? [])
        if (byId.has(sha)) edges.push({ from: `cite:${citation.kind}:${citation.id}`, to: sha, kind: 'source' })
    const cols = Math.max(1, ...nodes.map((node) => Math.round((node.x - LABEL_W) / COL_W) + 1))
    return { nodes, edges, byId, laneLabels, sourcesLane: !!top, hidden, width: LABEL_W + cols * COL_W + 24, height: (lanes.length + top) * LANE_H + 8 }
  }, [findings])
  if (!findings || !graph || !graph.nodes.length)
    return <p className="ws-status run-panel">No results, claims or checks were written, so there is no graph to draw.</p>
  const focus = hovered ?? selected
  const near = new Set<string>(focus ? [focus] : [])
  if (focus) for (const edge of graph.edges) if (edge.from === focus || edge.to === focus) near.add(edge.from === focus ? edge.to : edge.from)
  const chosen = selected ? graph.byId.get(selected) : null
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
    <section className="work-graph" aria-label="Work graph" data-work-graph={graph.nodes.length}>
      <div className="graph-main">
        <div className="graph-head">
          <h2 className="kicker tone-finding">Work graph</h2>
          <span className="faint">
            {graph.nodes.filter((node) => node.item).length} pages · {graph.edges.length} links · edges are pages naming pages and pages citing papers
          </span>
        </div>
        <div className="graph-scroll">
          <div className="graph-canvas" style={{ width: graph.width, height: graph.height }}>
            {graph.sourcesLane && <div className="graph-lane sources" style={{ top: 4, height: LANE_H - 8 }} />}
            {graph.laneLabels.map((lane, i) => (
              <div key={lane.label + i} className="graph-lane" style={{ top: lane.y - 17, height: LANE_H - 8 }} />
            ))}
            <svg className="graph-edges" width={graph.width} height={graph.height} aria-hidden="true">
              {graph.edges.map((edge, i) => {
                const from = graph.byId.get(edge.from)!
                const to = graph.byId.get(edge.to)!
                const lit = !focus || edge.from === focus || edge.to === focus
                return <path key={i} d={path(from, to)} className={`edge edge-${edge.kind} ${lit ? 'lit' : 'dim'}`} />
              })}
            </svg>
            {graph.sourcesLane && <span className="graph-lane-label" style={{ top: 30 }}>Sources</span>}
            {graph.laneLabels.map((lane, i) => (
              <span key={`l${i}`} className="graph-lane-label" style={{ top: lane.y + 8 }}>{lane.label}</span>
            ))}
            {graph.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`graph-node kind-${node.kind} ${selected === node.id ? 'on' : ''} ${focus && !near.has(node.id) ? 'dim' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                title={node.title}
                onClick={() => setSelected(selected === node.id ? null : node.id)}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
              >
                <span className="graph-node-title">{node.title}</span>
                <span className="graph-node-sub">{node.sub}</span>
              </button>
            ))}
          </div>
        </div>
        {Object.keys(graph.hidden).length > 0 && (
          <p className="faint card-note">
            Each lane shows its first {PER_LANE} results, claims and checks; {Object.values(graph.hidden).reduce((a, b) => a + b, 0)} more are listed under Findings.
          </p>
        )}
        <div className="graph-legend">
          <span><i className="edge-swatch edge-claim" />names a result or claim</span>
          <span><i className="edge-swatch edge-check" />names a check</span>
          <span><i className="edge-swatch edge-source" />cites a paper</span>
        </div>
      </div>
      <aside className="graph-side finding-card" aria-label="Selected page">
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
                <button type="button" className="ui-button" onClick={() => onOpen(chosen.id)}>Open in findings</button>
              </div>
              <PageReader href={`${runUrl}/page/${chosen.id}`} />
            </>
          ) : (
            <>
              <h3 className="kicker tone-info">Source</h3>
              <div className="graph-side-title">{chosen.title}</div>
              <div className="faint">{chosen.sub}, cited by {graph.edges.filter((edge) => edge.from === chosen.id).length} pages shown</div>
              {chosen.href && (
                <a href={chosen.href} target="_blank" rel="noopener noreferrer">Open the paper ↗</a>
              )}
            </>
          )
        ) : (
          <p className="faint">Select a page or a paper to see what it names, what names it, and its text.</p>
        )}
      </aside>
    </section>
  )
}
