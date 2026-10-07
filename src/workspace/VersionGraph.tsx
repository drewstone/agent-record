import { useEffect, useMemo, useRef, useState } from 'react'
import { versionGraphDocumentSchema } from '../workspace.js'
import type { VersionCommit, VersionGraphDocument, VersionTag } from '../workspace.js'
import { money, useDocument, when } from './data.js'
import { flagLabel, layoutVersionGraph, runGraphModel, scoreLine } from './version-graph.js'
import type { GraphModel, GraphNode } from './version-graph.js'

// Geometry, in CSS pixels at the workspace's type scale; a phone gets narrower lanes so the text keeps its room.
const WIDE = { column: 16, gutter: 14 }
const NARROW = { column: 5, gutter: 4 }
const LINE = 30
const TALL = 54
const BEND = 22
const COLORS = 8

const tall = (node: GraphNode) => (node.chips ?? []).some((chip) => chip.tone && chip.tone !== 'muted')

function useNarrow(): boolean {
  const query = '(max-width: 700px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const changed = () => setNarrow(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  return narrow
}

/** Bring a row into its scrolling pane's view, vertically only: the lanes at the left must stay in sight. */
function revealVertically(element: HTMLElement) {
  let pane: HTMLElement | null = element.parentElement
  while (pane && !(pane.scrollHeight > pane.clientHeight && /auto|scroll/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement
  if (!pane) return
  const row = element.getBoundingClientRect()
  const box = pane.getBoundingClientRect()
  if (row.top < box.top) pane.scrollTop -= box.top - row.top + 8
  else if (row.bottom > box.bottom) pane.scrollTop += row.bottom - box.bottom + 8
}

/**
 * Lanes of versions, newest at the top: one column per lane, a dot per version, a line to each parent (a merge draws two),
 * and the chips each page puts on a version (a release tag with its score and flags, a run's state and judges). Lanes can
 * be narrowed to one, and merge commits hidden; a hidden version passes its parents on, so lines stay connected.
 */
export function VersionGraph({
  model,
  selected,
  onSelect,
  label,
}: {
  model: GraphModel
  selected: string | null
  onSelect: (id: string) => void
  label: string
}) {
  const [lane, setLane] = useState<string | null>(null)
  const [hideMerges, setHideMerges] = useState(false)
  const hasMerges = model.nodes.some((node) => node.kind === 'integrate')
  const laid = useMemo(
    () => layoutVersionGraph(model, (node) => (lane === null || node.lane === lane) && !(hideMerges && node.kind === 'integrate')),
    [model, lane, hideMerges],
  )
  const tops = useMemo(() => {
    const out: number[] = []
    let y = 0
    for (const row of laid.rows) {
      out.push(y)
      y += tall(row.node) ? TALL : LINE
    }
    out.push(y)
    return out
  }, [laid])
  const height = tops.at(-1) ?? 0
  const { column: COLUMN, gutter: GUTTER } = useNarrow() ? NARROW : WIDE
  const width = GUTTER + laid.lanes.length * COLUMN
  const x = (column: number) => GUTTER / 2 + column * COLUMN + COLUMN / 2
  const y = (row: number) => tops[row]! + LINE / 2
  const path = (fromRow: number, fromColumn: number, toRow: number, toColumn: number) => {
    const [x1, y1, x2, y2] = [x(fromColumn), y(fromRow), x(toColumn), y(toRow)]
    if (x1 === x2) return `M${x1},${y1} V${y2}`
    const bend = Math.min(BEND, y2 - y1)
    return `M${x1},${y1} C${x1},${y1 + bend * 0.7} ${x2},${y1 + bend * 0.3} ${x2},${y1 + bend} V${y2}`
  }
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (selectedRef.current) revealVertically(selectedRef.current)
  }, [selected])
  const allLanes = useMemo(() => layoutVersionGraph(model).lanes, [model])
  const colorOf = new Map(allLanes.map((item, i) => [item.id, i % COLORS]))

  return (
    <div className="version-graph" data-version-graph={label}>
      <div className="vg-toolbar" role="group" aria-label={`${label}: lanes`}>
        <button type="button" className={`vg-lane-chip ${lane === null ? 'on' : ''}`} aria-pressed={lane === null} onClick={() => setLane(null)}>
          all lanes
        </button>
        {allLanes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`vg-lane-chip ${lane === item.id ? 'on' : ''}`}
            aria-pressed={lane === item.id}
            data-lane={item.id}
            title={item.detail ?? undefined}
            onClick={() => setLane(lane === item.id ? null : item.id)}
          >
            <i className={`vg-swatch vg-c${colorOf.get(item.id)}`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
        {hasMerges && (
          <label className="vg-toggle">
            <input type="checkbox" checked={hideMerges} onChange={(event) => setHideMerges(event.target.checked)} /> hide merges
          </label>
        )}
      </div>
      {laid.rows.length === 0 ? (
        <p className="faint">Nothing to show with these filters.</p>
      ) : (
        <div className="vg-scroll">
        <div className="vg-host" style={{ height }}>
          <svg className="vg-lines" width={width} height={height} aria-hidden="true">
            {laid.edges.map((edge) => (
              <path
                key={`${edge.from}>${edge.to}`}
                className={`vg-c${colorOf.get(laid.lanes[edge.toColumn]!.id)} ${selected === edge.from || selected === edge.to ? 'hot' : ''}`}
                d={path(edge.fromRow, edge.fromColumn, edge.toRow, edge.toColumn)}
              />
            ))}
            {laid.rows.map((row) => (
              <circle
                key={row.node.id}
                className={`vg-dot vg-c${colorOf.get(row.node.lane)} kind-${row.node.kind} ${selected === row.node.id ? 'on' : ''}`}
                cx={x(row.column)}
                cy={y(row.row)}
                r={row.node.kind === 'integrate' ? 3 : 5}
              />
            ))}
          </svg>
          <ol className="vg-rows" aria-label={label} style={{ paddingLeft: width }}>
            {laid.rows.map((row) => {
              const node = row.node
              const on = selected === node.id
              const loud = (node.chips ?? []).filter((chip) => chip.tone && chip.tone !== 'muted')
              const quiet = (node.chips ?? []).filter((chip) => !chip.tone || chip.tone === 'muted')
              return (
                <li key={node.id} style={{ height: tops[row.row + 1]! - tops[row.row]! }}>
                  <button
                    ref={on ? selectedRef : undefined}
                    type="button"
                    className={`vg-row kind-${node.kind} ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    disabled={node.kind === 'ghost'}
                    data-node={node.id}
                    onClick={() => onSelect(node.id)}
                  >
                    <span className="vg-line">
                      <b className="vg-title clip" title={node.title}>{node.title}</b>
                      {node.detail && <span className="vg-detail clip">{node.detail}</span>}
                      {quiet.map((chip, i) => (
                        <span key={i} className="vg-chip tone-muted" title={chip.title}>{chip.label}</span>
                      ))}
                    </span>
                    {loud.length > 0 && (
                      <span className="vg-line vg-tags">
                        {loud.map((chip, i) => (
                          <span key={i} className={`vg-chip tone-${chip.tone}`} title={chip.title}>{chip.label}</span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------- the run page

const short = (sha: string) => sha.slice(0, 10)

/** The run's Versions section: its releases and their scores, the graph of every version, and the selected one. */
export function RunVersions({
  runUrl,
  poll,
  selected,
  onSelect,
  onOpenAgent,
}: {
  runUrl: string
  poll?: number
  selected: string | null
  onSelect: (commit: string) => void
  onOpenAgent: (node: string) => void
}) {
  const fetched = useDocument<unknown>(`${runUrl}/versions`, poll, true)
  const parsed = useMemo(() => {
    if (fetched.data === undefined) return null
    const result = versionGraphDocumentSchema.safeParse(fetched.data)
    return result.success ? { doc: result.data, error: null } : { doc: null, error: result.error.issues[0]?.message ?? 'invalid version graph' }
  }, [fetched.data])
  const model = useMemo(() => (parsed?.doc?.available ? runGraphModel(parsed.doc, when) : null), [parsed])
  if (!parsed) {
    return (
      <p className="ws-status run-panel" role={fetched.error ? 'alert' : 'status'}>
        {fetched.error ? `No version graph for this run: ${fetched.error}. Runs pressed before discovery-lab#1411 keep no deliverables.git.` : 'Loading the version graph…'}
      </p>
    )
  }
  if (parsed.error || !parsed.doc) return <p className="ws-status run-panel" role="alert">The version graph is unreadable: {parsed.error}</p>
  const doc = parsed.doc
  if (!doc.available || !model) return <p className="ws-status run-panel">{doc.reason ?? 'This run keeps no version graph.'}</p>
  const commit = doc.commits.find((item) => item.id === selected) ?? doc.commits.find((item) => item.id === doc.tags.find((tag) => tag.best)?.commit) ?? doc.commits[0] ?? null
  return (
    <div className="lineage-layout run-versions" data-section="versions">
      <section className="lineage-pane" aria-label="Version graph">
        <Releases doc={doc} selected={commit?.id ?? null} onSelect={onSelect} />
        <p className="faint lineage-key">
          Every version this run's agents wrote, newest first: <b>main</b> is the shared store as it was, each other lane one worker's own line
          (its pages and the profiles it spawned), merged into main write by write. {doc.commits.length} commits on {doc.lanes.length} lanes
          {doc.builtAt ? `, read ${when(doc.builtAt)}` : ''}.
        </p>
        <VersionGraph model={model} selected={commit?.id ?? null} onSelect={onSelect} label="Run versions" />
      </section>
      <aside className="inspector-pane" aria-label="Inspector">
        {commit ? <CommitInspector doc={doc} commit={commit} onSelect={onSelect} onOpenAgent={onOpenAgent} /> : <p className="faint">No version to show.</p>}
      </aside>
    </div>
  )
}

/** Every release tag in order with its score, the rule's pick and the flags. */
function Releases({ doc, selected, onSelect }: { doc: VersionGraphDocument; selected: string | null; onSelect: (commit: string) => void }) {
  if (doc.tags.length === 0) return <p className="faint vg-releases-empty">No release candidate is tagged yet.</p>
  return (
    <section className="vg-releases" aria-label="Release candidates">
      <h3>Release candidates</h3>
      <div className="vg-table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Exact</th>
            <th scope="col">Held-out</th>
            <th scope="col">Open blockers</th>
            <th scope="col">Judge</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {doc.tags.map((tag) => (
            <tr
              key={tag.name}
              className={`clickable ${selected === tag.commit ? 'selected' : ''}`}
              tabIndex={0}
              data-tag={tag.name}
              onClick={() => onSelect(tag.commit)}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect(tag.commit)}
            >
              <td>
                <b className="mono">{tag.name}</b>
                {tag.best && <span className="vg-chip tone-ok">★ deliverable</span>}
                {tag.score && !tag.score.complete && <span className="vg-chip tone-muted">incomplete</span>}
              </td>
              <td className="mono">{tag.score ? `${tag.score.vector.exact[0]}/${tag.score.vector.exact[1]}` : '—'}</td>
              <td className="mono">{tag.score ? `${tag.score.vector.heldOut[0]}/${tag.score.vector.heldOut[1]}` : '—'}</td>
              <td className="mono">{tag.score ? (tag.score.vector.blockers ?? 'unknown') : '—'}</td>
              <td className="mono">{tag.score ? (tag.score.vector.judge === null ? 'none' : Math.round(tag.score.vector.judge * 10) / 10) : '—'}</td>
              <td>
                {tag.flags.length === 0 ? <span className="faint">none</span> : tag.flags.map((flag, i) => (
                  <span key={i} className={`vg-chip tone-${flag.kind === 'regression' ? 'warn' : 'fail'}`}>{flagLabel(flag)}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {doc.rule && <p className="faint">The deliverable is the best tag by {doc.rule}.</p>}
    </section>
  )
}

function CommitInspector({
  doc,
  commit,
  onSelect,
  onOpenAgent,
}: {
  doc: VersionGraphDocument
  commit: VersionCommit
  onSelect: (commit: string) => void
  onOpenAgent: (node: string) => void
}) {
  const lane = doc.lanes.find((item) => item.id === commit.lane)
  const tags = doc.tags.filter((tag) => tag.commit === commit.id)
  const children = doc.commits.filter((item) => item.parents.includes(commit.id))
  return (
    <div className="inspector" data-inspector={commit.id}>
      <header className="inspector-head">
        <h2 className="vg-inspector-title">{commit.subject}</h2>
        <span className="chip">{commit.kind === 'integrate' ? 'merge' : commit.kind}</span>
        <code className="faint">{short(commit.id)}</code>
      </header>
      {tags.map((tag) => <TagDetail key={tag.name} tag={tag} />)}
      <section>
        <h3>Who and when</h3>
        <dl className="vg-facts">
          <dt>Lane</dt>
          <dd>{lane?.label ?? commit.lane}</dd>
          <dt>Worker</dt>
          <dd>
            {commit.author.label} {commit.author.id && <code className="faint">{commit.author.id}</code>}
          </dd>
          {commit.director && (
            <>
              <dt>Director</dt>
              <dd><code>{commit.director}</code></dd>
            </>
          )}
          {commit.model && (
            <>
              <dt>Model</dt>
              <dd>{commit.model}</dd>
            </>
          )}
          <dt>When</dt>
          <dd>{when(commit.at)}</dd>
          {commit.spendUsd !== null && (
            <>
              <dt>Worker spend so far</dt>
              <dd>{money(commit.spendUsd)} (list price)</dd>
            </>
          )}
        </dl>
      </section>
      <section data-inspector-trace>
        <h3>Trace</h3>
        {commit.trace?.node ? (
          <>
            <button type="button" className="inspector-link link-button" data-open-agent={commit.trace.node} onClick={() => onOpenAgent(commit.trace!.node!)}>
              Open {commit.author.label}'s conversation
            </button>
            <p className="faint">
              Trace <code>{commit.trace.trace ?? 'not recorded'}</code> · Sandbox session <code>{commit.trace.session ?? 'not recorded'}</code>
            </p>
          </>
        ) : (
          <p className="faint">The store wrote this version; no agent's trace is attached.</p>
        )}
        {commit.spawned && (
          <p className="faint">
            Spawned <code>{commit.spawned}</code>
            {commit.profileDigest && <> with profile <code>{commit.profileDigest.slice(0, 19)}</code></>}{' '}
            <button type="button" className="link-button" onClick={() => onOpenAgent(commit.spawned!)}>open its conversation</button>
          </p>
        )}
      </section>
      {commit.files.length > 0 && (
        <section>
          <h3>Files</h3>
          <ul className="vg-files">
            {commit.files.map((file) => (
              <li key={file.path}>
                <span className={`vg-status st-${file.status}`}>{file.status === 'A' ? 'added' : file.status === 'D' ? 'deleted' : 'changed'}</span>{' '}
                <code>{file.path}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Graph</h3>
        <p className="faint">
          Parents:{' '}
          {commit.parents.length === 0
            ? 'none (the first version)'
            : commit.parents.map((parent) => (
                <button key={parent} type="button" className="link-button mono" onClick={() => onSelect(parent)}>{short(parent)}</button>
              ))}
          {children.length > 0 && (
            <>
              {' · '}Children:{' '}
              {children.map((child) => (
                <button key={child.id} type="button" className="link-button mono" onClick={() => onSelect(child.id)}>{short(child.id)}</button>
              ))}
            </>
          )}
        </p>
      </section>
      {commit.body && (
        <section>
          <h3>Message</h3>
          <pre className="vg-message">{commit.body}</pre>
        </section>
      )}
    </div>
  )
}

function TagDetail({ tag }: { tag: VersionTag }) {
  return (
    <section className="vg-tag-detail" data-tag-detail={tag.name}>
      <h3>
        Release candidate {tag.name}
        {tag.best && <span className="vg-chip tone-ok">★ deliverable</span>}
      </h3>
      {tag.best && <p className="faint">The registered rule picks this tag as the run's deliverable.</p>}
      <p>{scoreLine(tag)}</p>
      {tag.flags.map((flag, i) => (
        <p key={i} className={`vg-flag tone-${flag.kind === 'regression' ? 'warn' : 'fail'}`}>{flagLabel(flag)}</p>
      ))}
      {tag.score && (
        <ul className="vg-checks">
          {tag.score.results.map((result) => (
            <li key={result.id} data-check={result.id}>
              <span className={`vg-verdict ${result.error ? 'state-warn' : result.pass ? 'state-ok' : 'state-fail'}`}>{result.error ? 'error' : result.pass ? 'pass' : 'fail'}</span>{' '}
              <code>{result.id}</code> <span className="faint">{result.tier}</span>
              <span className="vg-evidence">{result.error ?? result.evidence ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="faint">
        {tag.by ? `Declared by ${tag.by}` : 'Declared'}
        {tag.at ? ` at ${when(tag.at)}` : ''} · {tag.attempts} scoring attempt{tag.attempts === 1 ? '' : 's'}
        {tag.score?.scoredAt ? `, latest ${when(tag.score.scoredAt)}` : ''}
        {tag.score?.set?.source ? ` · evaluators ${tag.score.set.source}` : ''}
      </p>
      {tag.message && (
        <details>
          <summary>Tag message</summary>
          <pre className="vg-message">{tag.message}</pre>
        </details>
      )}
    </section>
  )
}
