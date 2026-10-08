import { useCallback, useMemo, useState } from 'react'
import type { RunDocument, ScientificReview } from '../workspace.js'
import { CanvasControls } from './ProfileCanvas.js'
import { P_NODE_H, P_NODE_W, provenanceLit, provenanceModel, provenanceNeighbour, verdictTone, VERDICTS } from './provenance.js'
import type { ProvenanceEdge, ProvenanceModel, ProvenanceNode } from './provenance.js'
import { useCanvasView } from './useCanvasView.js'
import type { Box } from './useCanvasView.js'

const PAD = 56
const BAND_LABEL: Record<string, string> = { run: 'Discovery run', review: 'Outside review · not part of the run', publication: 'Publication' }

/**
 * The run's provenance on the shared canvas: its agents, the pages they wrote and the precise claims on them; the
 * reviewers outside the run joined to each claim by a verdict; and what publishes or packages the claims. Selecting a
 * node shows its reviews, references and citations beside the canvas.
 */
export function ProvenanceCanvas({ doc, onOpenPage }: { doc: RunDocument; onOpenPage: (sha: string) => void }) {
  const findings = doc.findings
  const model = useMemo(() => (findings ? provenanceModel(findings, doc.run.id) : null), [findings, doc.run.id])
  const [selected, setSelected] = useState<string | null>(null)
  if (!model || !findings) return <p className="ws-status run-panel">No knowledge pages were recorded for this run, so it has no claims to trace.</p>
  return (
    <div className="pc-layout pv-layout" data-provenance={doc.run.id}>
      <ProvenancePane model={model} selectedId={selected && model.byId.has(selected) ? selected : null} onChoose={setSelected} />
      <aside className="pc-inspector" aria-label="Selected node">
        {selected && model.byId.has(selected) ? (
          <ProvenanceInspector model={model} node={model.byId.get(selected)!} onChoose={setSelected} onOpenPage={onOpenPage} />
        ) : (
          <ProvenanceIntro model={model} />
        )}
      </aside>
    </div>
  )
}

function ProvenancePane({ model, selectedId, onChoose }: { model: ProvenanceModel; selectedId: string | null; onChoose: (id: string) => void }) {
  const box = useCallback((id: string): Box | null => {
    const node = model.byId.get(id)
    return node ? { x: PAD + node.x, y: PAD + 40 + node.y, w: P_NODE_W, h: P_NODE_H } : null
  }, [model])
  const width = model.width + PAD * 2
  const height = model.height + PAD * 2 + 40
  const canvas = useCanvasView({ width, height, box, focus: model.focus, selectedId, neighbour: (id, key) => provenanceNeighbour(model, id, key) })
  const lit = useMemo(() => {
    const id = canvas.hover ?? selectedId
    return id && model.byId.has(id) ? provenanceLit(model, id) : null
  }, [canvas.hover, selectedId, model])
  const { counts } = model
  return (
    <section className="pc-pane" aria-label="Provenance canvas">
      <div className="pc-toolbar">
        <p className="pc-summary">
          <b>{counts.claims}</b> claims · <b>{counts.reviewed}</b> with a verdict
          {counts.disagreements > 0 && <> · <b className="pv-disagree-text">{counts.disagreements}</b> where reviewers disagree</>} · <b>{counts.reviewers}</b>{' '}
          {counts.reviewers === 1 ? 'reviewer' : 'reviewers'} · <b>{counts.publications}</b> {counts.publications === 1 ? 'publication' : 'publications'}
        </p>
        <CanvasControls canvas={canvas} selectedId={selectedId} />
      </div>
      <div {...canvas.viewportProps} className="pc-viewport" data-zoom={canvas.k.toFixed(2)}>
        <div className="pc-world" style={canvas.worldStyle}>
          {model.bands.map((band) => (
            <div key={band.band} className={`pv-band pv-band-${band.band}`} style={{ left: PAD + band.x, top: 8, width: band.w, height: height - 16 }}>
              <span className="pv-band-label">{BAND_LABEL[band.band]}</span>
            </div>
          ))}
          <svg className="pc-edges" width={width} height={height} aria-hidden="true">
            {model.edges.map((edge) => (
              <path key={edge.id} d={edgePath(model, edge)} className={edgeClass(edge, lit)} />
            ))}
          </svg>
          {model.edges
            .filter((edge) => edge.kind === 'verdict')
            .map((edge) => {
              const from = model.byId.get(edge.from)!
              const to = model.byId.get(edge.to)!
              const dim = lit && !(lit.has(edge.from) && lit.has(edge.to))
              return (
                <span
                  key={`label:${edge.id}`}
                  className={`pv-verdict tone-${verdictTone(edge.label)}${dim ? ' dim' : ''}`}
                  style={{ left: PAD + from.x + P_NODE_W + 56, top: PAD + 40 + from.y + P_NODE_H / 2 + (to.y - from.y) * 0.18 }}
                >
                  {edge.label}
                </span>
              )
            })}
          {model.nodes.map((node) => (
            <button
              key={node.id}
              ref={canvas.register(node.id)}
              type="button"
              tabIndex={node.id === canvas.current ? 0 : -1}
              className={[
                'pc-node',
                'pv-node',
                `pv-${node.kind}`,
                node.disagree && 'pv-disagree',
                node.id === selectedId && 'on',
                lit && !lit.has(node.id) && 'dim',
                lit && lit.has(node.id) && node.id !== (canvas.hover ?? selectedId) && 'hot',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: PAD + node.x, top: PAD + 40 + node.y, width: P_NODE_W, height: P_NODE_H }}
              aria-pressed={node.id === selectedId}
              aria-label={`${node.kind} ${node.title}${node.disagree ? ', reviewers disagree' : ''}`}
              title={node.title}
              data-provenance-node={node.kind}
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
              <span className="pc-title">
                <span className={`pv-kind-mark pv-mark-${node.kind}`} aria-hidden="true" />
                <b>{node.title}</b>
              </span>
              <span className="pc-line mono faint">{node.sub}</span>
              {node.kind === 'claim' && <VerdictChips reviews={node.claim!.reviews} />}
            </button>
          ))}
        </div>
      </div>
      <p className="pc-help faint">Drag to pan · scroll or pinch to zoom · arrow keys follow the edges, Enter opens · 0 fits</p>
    </section>
  )
}

function VerdictChips({ reviews }: { reviews: readonly ScientificReview[] }) {
  const decided = reviews.filter((review) => review.status === 'decided' && review.label)
  if (!decided.length) return <span className="pc-line faint">no outside verdict</span>
  return (
    <span className="pv-chips">
      {decided.map((review, i) => (
        <span key={i} className={`pv-chip tone-${verdictTone(review.label)}`} title={review.reviewer?.identity ?? undefined}>
          {review.label}
        </span>
      ))}
    </span>
  )
}

function edgePath(model: ProvenanceModel, edge: ProvenanceEdge): string {
  const from = model.byId.get(edge.from)!
  const to = model.byId.get(edge.to)!
  const x1 = PAD + from.x + P_NODE_W
  const y1 = PAD + 40 + from.y + P_NODE_H / 2
  const x2 = PAD + to.x
  const y2 = PAD + 40 + to.y + P_NODE_H / 2
  // A spawn edge runs within the agent column: leave and re-enter it on the left.
  if (from.column === to.column) {
    const xl = PAD + from.x
    return `M ${xl} ${y1} C ${xl - 48} ${y1}, ${xl - 48} ${y2}, ${xl} ${y2}`
  }
  const dx = Math.max(48, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function edgeClass(edge: ProvenanceEdge, lit: Set<string> | null): string {
  const hot = lit && lit.has(edge.from) && lit.has(edge.to)
  return ['pc-edge', `pv-edge-${edge.kind}`, edge.kind === 'verdict' && `tone-${verdictTone(edge.label)}`, hot && 'hot', lit && !hot && 'dim'].filter(Boolean).join(' ')
}

function ProvenanceIntro({ model }: { model: ProvenanceModel }) {
  const { counts } = model
  return (
    <div className="pc-intro">
      <h2>Provenance</h2>
      <p>
        {counts.claims ? `${counts.claims} precise ${counts.claims === 1 ? 'claim' : 'claims'} from this run's pages` : 'No outside review names a claim of this run yet'}
        {counts.reviewers ? `, judged by ${counts.reviewers} ${counts.reviewers === 1 ? 'reviewer' : 'reviewers'} outside the run` : ''}
        {counts.publications ? `, cited by ${counts.publications} ${counts.publications === 1 ? 'publication' : 'publications'}` : ''}.
      </p>
      {counts.claims > 0 && (
        <p className="pv-label-counts">
          {VERDICTS.filter((label) => counts.labels[label]).map((label) => (
            <span key={label} className={`pv-chip tone-${verdictTone(label)}`}>
              {label} {counts.labels[label]}
            </span>
          ))}
        </p>
      )}
      <p className="faint">
        Left, the run: its agents, the pages they wrote and the precise claims on them. Middle, outside the run: each reviewer (a review lane, a judge
        model under its harness) joined to the exact claims it judged. Right, what cites them. Every join is a recorded identifier: a page by SHA-256,
        a claim by its id. A claim marked with a split border has reviewers that disagree. A review is an AI assessment, not outside acceptance.
      </p>
    </div>
  )
}

function ProvenanceInspector({ model, node, onChoose, onOpenPage }: { model: ProvenanceModel; node: ProvenanceNode; onChoose: (id: string) => void; onOpenPage: (sha: string) => void }) {
  const linked = (kind: 'from' | 'to') =>
    model.edges.filter((edge) => (kind === 'from' ? edge.to === node.id : edge.from === node.id)).map((edge) => ({ edge, node: model.byId.get(kind === 'from' ? edge.from : edge.to)! }))
  const NodeLink = ({ other }: { other: ProvenanceNode }) => (
    <button type="button" className="link-button" onClick={() => onChoose(other.id)}>
      {other.title.length > 90 ? `${other.title.slice(0, 88)}…` : other.title}
    </button>
  )
  return (
    <div className="inspector" data-provenance-inspector={node.kind}>
      <header className="inspector-head">
        <h2>{node.kind === 'claim' ? 'Claim' : node.title}</h2>
        <span className="chip">{node.kind}</span>
        {node.disagree && <span className="chip pv-disagree-text">reviewers disagree</span>}
      </header>
      {node.kind === 'claim' && node.claim && (
        <>
          <p>{node.claim.text}</p>
          <p className="faint mono">
            {node.claim.claimId} · page {node.claim.pageSha256.slice(0, 12)}{' '}
            <button type="button" className="link-button" onClick={() => onOpenPage(node.claim!.pageSha256)}>
              Open the page
            </button>
          </p>
          <section data-claim-reviews>
            <h3>Verdicts</h3>
            {node.claim.reviews.map((review, i) => (
              <ReviewView key={i} review={review} />
            ))}
          </section>
        </>
      )}
      {node.kind === 'reviewer' && node.reviewer && (
        <>
          <div className="ws-facts">
            {node.reviewer.kind && <span><b>Kind</b> {node.reviewer.kind}</span>}
            <span><b>Harness</b> {node.reviewer.harness ?? 'not recorded'}</span>
            <span><b>Model</b> <span className="mono">{node.reviewer.model ?? 'not recorded'}</span></span>
            <span><b>Identity</b> <span className="mono">{node.reviewer.key}</span></span>
          </div>
          <p className="faint">Outside the run: its verdicts never went back to the agents that wrote the pages.</p>
        </>
      )}
      {node.kind === 'page' && node.page && (
        <>
          <p className="faint mono">{node.page.path}</p>
          <p className="faint">
            {node.page.kind} · {node.page.agentLabel ?? node.page.agent} · {node.page.at ?? 'time unknown'}{' '}
            <button type="button" className="link-button" onClick={() => onOpenPage(node.page!.sha256)}>
              Open the page
            </button>
          </p>
        </>
      )}
      {node.kind === 'publication' && node.publication && (
        <div className="ws-facts">
          <span><b>Kind</b> {node.publication.kind.replaceAll('-', ' ')}</span>
          {node.publication.status && <span><b>Status</b> {node.publication.status}</span>}
          {node.publication.url && <span><b>Link</b> <a href={node.publication.url} target="_blank" rel="noreferrer">{node.publication.url}</a></span>}
          {node.publication.session && <span><b>Written by</b> {[node.publication.session.label, node.publication.session.harness, node.publication.session.model].filter(Boolean).join(' · ')}</span>}
        </div>
      )}
      {node.kind === 'agent' && node.agent && <p className="faint mono">{node.agent.id}</p>}
      {(['from', 'to'] as const).map((side) => {
        const list = linked(side)
        if (!list.length) return null
        return (
          <section key={side}>
            <h3>{side === 'from' ? 'From' : 'To'}</h3>
            <ul className="pc-members">
              {list.map(({ edge, node: other }) => (
                <li key={edge.id}>
                  <span className={`chip${edge.kind === 'verdict' ? ` tone-${verdictTone(edge.label)}` : ''}`}>{edge.kind === 'verdict' ? edge.label : edge.kind}</span> <NodeLink other={other} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ReviewView({ review }: { review: ScientificReview }) {
  const who = review.reviewer
  return (
    <div className="pv-review">
      <p>
        <span className={`pv-chip tone-${verdictTone(review.label)}`}>{review.status === 'decided' ? review.label : review.status}</span>{' '}
        <b>{who?.identity ?? 'unattributed'}</b>
        {who && (who.harness || who.model) && <span className="faint"> · {[who.harness, who.model].filter(Boolean).join(' · ')}</span>}
        {review.confidence != null && <span className="faint"> · confidence {String(review.confidence)}</span>}
      </p>
      {review.rationale && <p className="faint">{review.rationale}</p>}
      {review.rerun && <p className="faint">Re-run: {review.rerun.status}{review.rerun.description ? ` · ${review.rerun.description}` : ''}</p>}
      {review.priorArt?.references?.length ? (
        <ul className="pc-members">
          {review.priorArt.references.map((reference) => (
            <li key={reference.url}>
              <a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a>
              {reference.resolvesClaim && <span className="faint"> · {reference.resolvesClaim}</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
