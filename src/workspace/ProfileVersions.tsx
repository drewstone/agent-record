import { useMemo } from 'react'
import type { ProfileDiff, ProfileDiffField, ProfileGraphDocument, ProfileNode, ProfileParent, ProfileRun } from '../workspace.js'
import { stateClass, stateLabel, when } from './data.js'
import type { Comparison } from './profile-compare.js'
import { primaryDiff, primaryParent, profileLabel } from './profile-graph.js'

const RELATION_LABEL: Record<ProfileParent['relation'], string> = { authored: 'authored', revision: 'revision', treatment: 'treatment' }
const shortDigest = (digest: string) => digest.replace(/^sha256:/, '').slice(0, 12)
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

/** One profile in full: where it came from, the runs that used it with their scores, what changed, and its content. */
export function ProfileDetail({ doc, node, onSelect, heading = true }: { doc: ProfileGraphDocument; node: ProfileNode; onSelect: (short: string | null) => void; heading?: boolean }) {
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
      {heading && (
        <header className="profile-detail-head">
          <h3>{node.name ?? node.label ?? node.short}</h3>
          <span className="chip">{node.kind === 'root' ? 'registered' : 'authored at runtime'}</span>
          <code className="faint" title={node.digest}>{node.short}</code>
          <button type="button" className="ui-button profile-close" onClick={() => onSelect(null)}>Close</button>
        </header>
      )}
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

/** A comparison made in the viewer, drawn like a recorded diff. */
export function ComparisonView({ comparison }: { comparison: Comparison }) {
  if (comparison.identical) return <p className="faint">Identical content.</p>
  return (
    <div className="profile-diff" data-comparison={`${shortDigest(comparison.from.digest)}..${shortDigest(comparison.to.digest)}`}>
      {comparison.fields.map((field, i) => <DiffFieldView key={`${field.field}:${i}`} field={field} />)}
    </div>
  )
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

export function DiffLines({ lines }: { lines: { op: ' ' | '+' | '-' | '@'; text: string }[] }) {
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
