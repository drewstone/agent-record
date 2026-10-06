import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileDiff, ProfileDiffField, ProfileGraphDocument, ProfileNode, ProfileParent, ProfileRun } from '../workspace.js'
import { stateClass, stateLabel, useDocument, when } from './data.js'
import {
  authorsAbove,
  deltaSummary,
  diffKey,
  findProfile,
  layoutProfiles,
  primaryDiff,
  primaryParent,
  profileGraph,
  profileLabel,
  profileState,
  visibleProfiles,
} from './profile-graph.js'

const RELATION_LABEL: Record<ProfileParent['relation'], string> = { authored: 'authored', revision: 'revision', treatment: 'treatment' }
const shortDigest = (digest: string) => digest.replace(/^sha256:/, '').slice(0, 12)
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

/**
 * The play's profile versions: one node per exact AgentProfile, under the profile it came from. Selecting a node shows
 * where it came from, the runs that used it with their scores, and what changed against its parent.
 */
export function ProfileVersions({
  api,
  play,
  selected,
  onSelect,
}: {
  api: string
  play: string
  selected: string | null
  onSelect: (short: string | null) => void
}) {
  const doc = useDocument<ProfileGraphDocument>(`${api}/plays/${encodeURIComponent(play)}/profiles`)
  if (doc.status === 404 || (!doc.data && doc.error))
    return (
      <p className="profile-missing faint" data-profile-versions="missing">
        {doc.status === 404 ? 'No profile versions are indexed for this play yet.' : `Profile versions are unavailable: ${doc.error}`}
      </p>
    )
  if (!doc.data) return <p className="ws-status" role="status">Loading profile versions…</p>
  return <ProfileGraphView doc={doc.data} selected={selected} onSelect={onSelect} />
}

function ProfileGraphView({ doc, selected, onSelect }: { doc: ProfileGraphDocument; selected: string | null; onSelect: (short: string | null) => void }) {
  const graph = useMemo(() => profileGraph(doc), [doc])
  const chosen = findProfile(graph, selected)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  // A selected profile behind a closed author opens that author, so a shared link shows its node.
  const expanded = useMemo(() => new Set([...opened, ...(chosen ? authorsAbove(graph, chosen.digest) : [])]), [opened, chosen, graph])
  const shown = useMemo(() => visibleProfiles(graph, expanded), [graph, expanded])
  const layout = useMemo(() => layoutProfiles(graph, shown, expanded, doc.play), [graph, shown, expanded, doc.play])
  const toggle = (digest: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (expanded.has(digest)) {
        next.delete(digest)
        // Closing an author also closes what it opened only because the selection sat beneath it.
        if (chosen && authorsAbove(graph, chosen.digest).includes(digest)) onSelect(null)
      } else next.add(digest)
      return next
    })
  // Bring the selected profile, or else the newest registered one, into view: the lineage is wider than a phone.
  const canvas = useRef<HTMLDivElement>(null)
  const focus = chosen ?? [...doc.nodes].filter((node) => node.kind === 'root' && layout.placed.has(node.digest)).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.createdIn ?? '').localeCompare(String(b.createdIn ?? ''))).at(-1)
  const focusAt = focus ? layout.placed.get(focus.digest) : undefined
  useEffect(() => {
    const element = canvas.current
    if (!element || !focusAt) return
    if (focusAt.x + focusAt.width + 40 > element.clientWidth) element.scrollLeft = Math.max(0, focusAt.x + focusAt.width / 2 - element.clientWidth / 2)
    if (focusAt.y + 40 > element.clientHeight) element.scrollTop = Math.max(0, focusAt.y - element.clientHeight / 2)
  }, [focusAt?.x, focusAt?.y]) // eslint-disable-line react-hooks/exhaustive-deps
  // A selection must visibly change the screen: its detail sits beside the graph on a wide screen and is brought into
  // view on a narrow one (below the graph it was off-screen, so a click looked like it did nothing).
  const root = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Beside the graph, the section is brought to the top so the graph and the whole detail show together; stacked
    // under the graph (narrow screens), the detail itself is.
    if (chosen) (window.matchMedia('(max-width: 1100px)').matches ? detail.current : root.current)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [chosen?.digest]) // eslint-disable-line react-hooks/exhaustive-deps
  const roots = doc.nodes.filter((node) => node.kind === 'root').length
  const spawned = doc.nodes.length - roots
  const inferred = doc.nodes.reduce((sum, node) => sum + node.parents.filter((parent) => parent.basis === 'inferred').length, 0)
  const edges = [...layout.placed.values()].flatMap((entry) =>
    entry.node.parents
      .filter((parent) => layout.placed.has(parent.digest))
      .map((parent) => ({ parent, child: entry, from: layout.placed.get(parent.digest)!, primary: graph.parentOf.get(entry.node.digest)?.digest === parent.digest })),
  )
  return (
    <div className={`profile-versions ${chosen ? 'has-detail' : ''}`} data-profile-versions={doc.play} ref={root}>
      <div className="profile-graph-pane">
      <p className="profile-intro faint">
        {roots} registered {roots === 1 ? 'profile' : 'profiles'} and {spawned} written by agents at runtime. Each node is one exact profile; a line runs
        from the profile it came from. {inferred > 0 && <>Dashed lines were inferred afterwards from the records that prove them.</>}
      </p>
      <div className="graph-canvas profile-canvas" ref={canvas}>
        <svg width={layout.width} height={layout.height} role="group" aria-label="Profile versions. Select a profile to see its runs and what changed from its parent.">
          <defs>
            <marker id="profile-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="profile-arrow" />
            </marker>
          </defs>
          {edges.map(({ parent, child, from, primary }) => {
            const key = `${parent.digest}>${child.node.digest}`
            const classes = `profile-edge relation-${parent.relation} basis-${parent.basis} ${primary ? 'primary' : 'secondary'}`
            if (!primary) {
              // Only the selected profile's other parents are drawn; every one is listed in its detail.
              if (chosen?.digest !== child.node.digest && chosen?.digest !== parent.digest) return null
              // A second parent: a quiet dot-to-dot line, so the tree stays readable.
              const mid = (from.x + child.x) / 2
              return (
                <g key={key} className={classes}>
                  <title>{`${RELATION_LABEL[parent.relation]} of ${profileLabel(from.node, doc.play)} (${parent.basis}, not the primary parent)`}</title>
                  <path d={`M${from.x},${from.y} C${mid},${from.y} ${mid},${child.y} ${child.x - child.r - 3},${child.y}`} />
                </g>
              )
            }
            const x1 = from.x + from.r + 8 + from.width + 6
            const x2 = child.x - child.r - 3
            const mid = (x1 + x2) / 2
            const diff = doc.diffs[diffKey(parent.digest, child.node.digest)]
            const summary = deltaSummary(diff)
            const version = parent.relation !== 'authored'
            return (
              <g key={key} className={classes}>
                <path d={`M${x1},${from.y} C${mid},${from.y} ${mid},${child.y} ${x2},${child.y}`} markerEnd={version ? 'url(#profile-arrow)' : undefined} />
                {version && (
                  <text x={x2 - 6} y={child.y - 26} textAnchor="end" className="edge-label">
                    {RELATION_LABEL[parent.relation]}
                    {parent.basis === 'inferred' ? ' · inferred' : ''}
                  </text>
                )}
                {version && (
                  <text x={x2 - 6} y={child.y - 8} textAnchor="end" className={`edge-delta ${summary ? 'known' : 'unknown'}`}>
                    {summary ? `Δ ▲${summary.up} ▼${summary.down} =${summary.same}` : 'Δ unknown'}
                  </text>
                )}
              </g>
            )
          })}
          {[...layout.placed.values()].map((entry) => {
            const { node } = entry
            const state = profileState(node)
            const isSelected = chosen?.digest === node.digest
            const select = () => onSelect(isSelected ? null : entry.node.short)
            return (
              <g
                key={node.digest}
                className={`profile-node kind-${node.kind} ${stateClass(state)} ${state === 'registered' ? 'registered' : ''} ${isSelected ? 'selected' : ''}`}
                transform={`translate(${entry.x},${entry.y})`}
                data-profile={node.short}
              >
                <title>
                  {[node.name, node.digest, node.author.kind === 'operator' ? 'registered by an operator' : node.author.kind === 'proposer' ? `proposed by ${node.author.name}` : `written at runtime by ${node.author.nodeId}`, stateLabel(state)]
                    .filter(Boolean)
                    .join('\n')}
                </title>
                <g
                  className="profile-hit"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${profileLabel(node, doc.play)}, ${node.kind === 'root' ? 'registered profile' : 'authored profile'}, ${stateLabel(state)}`}
                  onClick={select}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      select()
                    }
                  }}
                >
                  <rect className="profile-hit-area" x={-entry.r - 4} y={-entry.r - 8} width={entry.r * 2 + 16 + entry.width} height={entry.r * 2 + 34} rx={6} />
                  {isSelected && <circle className="node-halo" r={entry.r + 5} />}
                  <circle className="profile-dot" r={entry.r} />
                  <text x={entry.r + 8} y={5} className="profile-label">{entry.label}</text>
                  <text x={entry.r + 8} y={25} className="profile-sub">{entry.sub}</text>
                </g>
                {entry.toggle && (
                  <text
                    x={entry.r + 8}
                    y={46}
                    className="profile-toggle"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded.has(node.digest)}
                    aria-label={`${expanded.has(node.digest) ? 'Hide' : 'Show'} the ${graph.authored.get(node.digest)} profiles this one authored`}
                    onClick={() => toggle(node.digest)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggle(node.digest)
                      }
                    }}
                  >
                    {entry.toggle}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="graph-legend">
        <span className="legend-line relation-revision">revision</span>
        <span className="legend-line relation-treatment">treatment</span>
        <span className="legend-line relation-authored">authored at runtime</span>
        <span className="legend-line basis-inferred">inferred</span>
        <span><i className="dot state-ok" />done</span>
        <span><i className="dot state-warn" />no winner</span>
        <span><i className="dot state-fail" />failed</span>
        <span className="state-unknown"><i className="dot" />state unknown</span>
        <span><i className="dot gap" />registered, not run</span>
        <span className="legend-note">Δ calibrated judge categories up, down, unchanged</span>
      </div>
      {!chosen && <p className="profile-hint faint">Select a profile to see its runs, its scores and what changed from its parent.</p>}
      </div>
      {chosen && (
        <div className="profile-detail-pane" ref={detail}>
          <ProfileDetail doc={doc} node={chosen} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}

function ProfileDetail({ doc, node, onSelect }: { doc: ProfileGraphDocument; node: ProfileNode; onSelect: (short: string | null) => void }) {
  const byDigest = useMemo(() => new Map(doc.nodes.map((item) => [item.digest, item])), [doc])
  const parent = primaryParent(node)
  const diff = primaryDiff(doc, node)
  const authorDigest = node.author.kind === 'node' ? node.author.profileDigest : null
  const name = (digest: string) => {
    const other = byDigest.get(digest)
    return other ? profileLabel(other, doc.play) : shortDigest(digest)
  }
  return (
    <section className="profile-detail" data-profile-detail={node.short} aria-label={`Profile ${node.name ?? node.short}`}>
      <header className="profile-detail-head">
        <h3>{node.name ?? node.label ?? node.short}</h3>
        <span className="chip">{node.kind === 'root' ? 'registered' : 'authored at runtime'}</span>
        <code className="faint" title={node.digest}>{node.short}</code>
        <button type="button" className="ui-button profile-close" onClick={() => onSelect(null)}>Close</button>
      </header>
      {node.description && <p className="profile-description">{node.description}</p>}
      <div className="ws-facts">
        <span><b>Model</b> <span className="mono">{[node.model.id ?? 'unknown', node.model.provider, node.model.reasoningEffort].filter(Boolean).join(' · ')}</span></span>
        <span><b>Harness</b> {node.harness ?? 'unknown'}</span>
        <span><b>Tools</b> {node.tools.length}</span>
        <span><b>Instructions</b> {node.instructions.length}</span>
        {node.files.length > 0 && <span><b>Files</b> {node.files.length}</span>}
        {node.skills.length > 0 && <span><b>Skills</b> {node.skills.map((skill) => skill.name).join(', ')}</span>}
        {node.version && <span><b>Version</b> {node.version}</span>}
        <span>
          <b>Author</b>{' '}
          {node.author.kind === 'operator' ? (
            <>operator{node.author.registration && <> · <span className="mono">{node.author.registration}</span></>}</>
          ) : node.author.kind === 'proposer' ? (
            <>version-chain proposer <span className="mono">{node.author.name}</span>{node.author.source && <> · <span className="mono faint">{node.author.source}</span></>}</>
          ) : (
            <>
              <span className="mono">{node.author.nodeId}</span>
              {authorDigest && byDigest.has(authorDigest) && (
                <> · <button type="button" className="link-button mono" onClick={() => onSelect(shortDigest(authorDigest))}>{name(authorDigest)}</button></>
              )}
            </>
          )}
        </span>
        <span><b>Created in</b> {node.createdIn ? <a className="mono" href={runHref(node.createdIn)}>{node.createdIn}</a> : 'unknown'}</span>
        <span><b>Created</b> {when(node.createdAt)}</span>
        {node.budget && <span><b>Budget</b> <span className="mono">{budgetText(node.budget)}</span></span>}
      </div>

      <h4>Runs</h4>
      {node.runs.length ? <ProfileRuns runs={node.runs} /> : <p className="profile-empty faint">Registered, not run yet.</p>}

      <h4>Parents</h4>
      {node.parents.length ? (
        <ul className="profile-parents">
          {node.parents.map((edge) => (
            <li key={`${edge.digest}:${edge.relation}`}>
              <span className={`edge-chip relation-${edge.relation}`}>{RELATION_LABEL[edge.relation]}</span>
              <span className={`edge-chip basis-${edge.basis}`}>{edge.basis}</span>
              {edge.primary && <span className="chip">primary</span>}{' '}
              {byDigest.has(edge.digest) ? (
                <button type="button" className="link-button mono" onClick={() => onSelect(shortDigest(edge.digest))}>{name(edge.digest)}</button>
              ) : (
                <code title={edge.digest}>{shortDigest(edge.digest)}</code>
              )}
              {edge.evidence.length > 0 && (
                <ul className="profile-evidence">
                  {edge.evidence.map((item, i) => (
                    <li key={i}><code>{item.source}</code> {item.note}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="profile-empty faint">No parent is recorded or proven by the records.</p>
      )}

      <h4>{parent && parent.relation !== 'authored' ? `What changed from ${name(parent.digest)}` : 'Earlier version'}</h4>
      {diff ? (
        <ProfileDiffView diff={diff} />
      ) : parent?.relation === 'authored' ? (
        <p className="profile-empty faint">
          Written at runtime by an agent running {name(parent.digest)}; no earlier version of this profile is recorded, so there is nothing to compare. Its prompt is below.
        </p>
      ) : (
        <p className="profile-empty faint">{parent ? 'No diff is indexed for this edge.' : 'A first version: nothing to compare.'}</p>
      )}

      <details className="profile-content">
        <summary>Prompt, tools and files of this profile</summary>
        {node.systemPrompt && (
          <>
            <h5>System prompt</h5>
            <pre className="activity-code">{node.systemPrompt}</pre>
          </>
        )}
        <h5>Instructions</h5>
        {node.instructions.length ? (
          <ol className="profile-instructions">{node.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol>
        ) : (
          <p className="profile-empty faint">None.</p>
        )}
        <h5>Tools</h5>
        <div className="chips">{node.tools.map((tool) => <span key={tool} className="chip mono">{tool}</span>)}</div>
        {node.files.length > 0 && (
          <>
            <h5>Files</h5>
            <ul className="profile-files">
              {node.files.map((file) => <li key={file.path}><code>{file.path}</code> <span className="faint">{bytes(file.bytes)} · {file.sha256.replace(/^sha256:/, '').slice(0, 12)}</span></li>)}
            </ul>
          </>
        )}
      </details>
    </section>
  )
}

function ProfileRuns({ runs }: { runs: ProfileRun[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table profile-runs">
        <thead>
          <tr>
            <th>Run</th>
            <th>Agent outcome</th>
            <th>Run state</th>
            <th title="The readout scores the whole run, so every profile in a run shows that run's score">Run score</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId} data-profile-run={run.runId}>
              <td className="mono">
                <a href={runHref(run.runId)}>{run.runId}</a>
                {run.nodeIds.length > 1 && <span className="chip">{run.nodeIds.length} agents</span>}
              </td>
              <td><span className={`state-pill ${stateClass(run.outcome)}`}>{run.outcome ? stateLabel(run.outcome) : 'unknown'}</span></td>
              <td>
                <span className={`state-pill ${stateClass(run.run.state)}`}>{stateLabel(run.run.state)}</span>
                {run.run.reason && <small className="faint"> {run.run.reason}</small>}
              </td>
              <td className="profile-score"><Score score={run.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Score({ score }: { score: ProfileRun['score'] }) {
  if (score.status === 'unknown') return <span className="faint">unknown · {score.reason}</span>
  if (score.source === 'version-judge')
    return (
      <span title={`judge ${score.judgeDigest ?? 'unknown'} · ${score.ledger}`}>
        version judge <b className="mono">{score.score ?? 'unknown'}</b>
      </span>
    )
  return (
    <span className="score-judges" title={`readout ${score.path}${score.generatedAt ? ` · ${score.generatedAt}` : ''}`}>
      {score.judges.map((judge) => (
        <span key={judge.category} className={`score-chip ${judge.calibrated ? 'calibrated' : 'advisory'}`} title={judge.calibrated ? 'calibrated judge' : 'advisory: this judge has not beaten the always-reject baseline'}>
          {judge.category} <b>{judge.score ?? '—'}</b>/{judge.max}
        </span>
      ))}
      {score.verdicts.length > 0 && (
        <span className="faint"> · {score.verdicts.map((verdict) => `${verdict.id} ${verdict.verdict.replaceAll('-', ' ')}`).join(', ')}</span>
      )}
    </span>
  )
}

const FIELD_LABEL: Record<string, string> = {
  systemPrompt: 'System prompt',
  instructions: 'Instructions',
  tools: 'Tools',
  files: 'Files',
  skills: 'Skills',
  model: 'Model',
  harness: 'Harness',
  budget: 'Budget',
  name: 'Name',
  description: 'Description',
  version: 'Version',
}

function ProfileDiffView({ diff }: { diff: ProfileDiff }) {
  return (
    <div className="profile-diff" data-profile-diff={`${shortDigest(diff.from)}..${shortDigest(diff.to)}`}>
      <p className="faint profile-diff-meta">
        {RELATION_LABEL[diff.relation]} · {diff.basis}
        {diff.identical ? ' · identical' : ` · ${diff.fields.length} ${diff.fields.length === 1 ? 'field' : 'fields'} changed`}
      </p>
      {diff.fields.map((field, i) => <DiffFieldView key={`${field.field}:${i}`} field={field} />)}
      <ScoreDelta delta={diff.scoreDelta} />
    </div>
  )
}

function DiffFieldView({ field }: { field: ProfileDiffField }) {
  const title = FIELD_LABEL[field.field] ?? field.field
  if (field.kind === 'value')
    return (
      <div className="diff-field diff-value">
        <span className="diff-name">{title}</span>
        <del>{field.from ?? 'absent'}</del>
        <span aria-hidden="true" className="faint">→</span>
        <ins>{field.to ?? 'absent'}</ins>
      </div>
    )
  if (field.kind === 'set')
    return (
      <div className="diff-field diff-set">
        <span className="diff-name">{title}</span>
        {field.added.map((item) => <ins key={`+${item}`} className="chip">+ {item}</ins>)}
        {field.removed.map((item) => <del key={`-${item}`} className="chip">− {item}</del>)}
        <span className="faint">{field.kept} unchanged</span>
      </div>
    )
  if (field.kind === 'text')
    return (
      <div className="diff-field diff-text">
        <span className="diff-name">
          {title} <span className="faint">+{field.added} −{field.removed}</span>
        </span>
        <DiffLines lines={field.lines} />
      </div>
    )
  return (
    <div className="diff-field diff-files">
      <span className="diff-name">{title}</span>
      <ul>
        {field.added.map((file) => <li key={`+${file.path}`}><ins>+ {file.path}</ins> <span className="faint">{bytes(file.bytes)}</span></li>)}
        {field.removed.map((file) => <li key={`-${file.path}`}><del>− {file.path}</del> <span className="faint">{bytes(file.bytes)}</span></li>)}
        {field.changed.map((file) => (
          <li key={`~${file.path}`}>
            <details>
              <summary>
                <span className="mono">~ {file.path}</span> <span className="faint">+{file.added} −{file.removed}</span>
              </summary>
              <DiffLines lines={file.lines} />
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DiffLines({ lines }: { lines: { op: ' ' | '+' | '-' | '@'; text: string }[] }) {
  return (
    <pre className="diff-lines">
      {lines.map((line, i) => (
        <span key={i} className={line.op === '+' ? 'add' : line.op === '-' ? 'del' : line.op === '@' ? 'hunk' : 'ctx'}>
          {line.op === '@' ? `… ${line.text}`.trimEnd() : `${line.op} ${line.text}`}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

function ScoreDelta({ delta }: { delta: ProfileDiff['scoreDelta'] }) {
  if (delta.status === 'unknown')
    return (
      <p className="diff-field score-delta faint">
        <span className="diff-name">Score change</span> unknown · {delta.reason}
      </p>
    )
  return (
    <div className="diff-field score-delta">
      <span className="diff-name">Score change</span>
      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Parent</th>
            <th className="num">This</th>
            <th className="num">Change</th>
            <th>Judge</th>
          </tr>
        </thead>
        <tbody>
          {delta.categories.map((row) => (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td className="num">{row.from ?? 'unknown'}</td>
              <td className="num">{row.to ?? 'unknown'}</td>
              <td className={`num ${row.delta === null ? 'unknown' : row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}`}>
                {row.delta === null ? 'unknown' : `${row.delta > 0 ? '+' : ''}${row.delta}`}
              </td>
              <td className={row.calibrated ? '' : 'faint'}>{row.calibrated ? 'calibrated' : 'advisory'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="faint">{delta.note}</p>
    </div>
  )
}

function budgetText(budget: Record<string, number>) {
  return Object.entries(budget)
    .map(([key, value]) =>
      key === 'deadlineMs' ? `deadline ${(value / 3_600_000).toFixed(value % 3_600_000 ? 1 : 0)} h` : `${key.replace(/^max/, '').toLowerCase()} ${new Intl.NumberFormat('en-US').format(value)}`,
    )
    .join(' · ')
}

function bytes(value: number) {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
}
