import { useEffect, useMemo, useState } from 'react'
import { versionGraphDocumentSchema } from '../workspace-model.js'
import type { VersionCommit, VersionGraphDocument, VersionTag } from '../workspace-model.js'
import { CollapsibleValue, ValueControls, ValueScope } from './CollapsibleValue.js'
import { money, useDocument, when } from './data.js'
import { flagLabel, layoutVersionGraph, pagesVersion, PICKED, runGraphModel, scoreLine } from './version-graph.js'
import { RunRoles } from './RoleScorecards.js'
import { Lines, VersionGraph as SharedVersionGraph } from '@tangle-network/charts/react'
import type { RunWorkspaceDocument } from './RunWorkspace.js'
import type { GraphModel } from './version-graph.js'
import { Picker } from './run/ui.js'

/** Discovery owns the lane filter and inspector; Charts owns the version drawing. */
export function VersionGraph({ model, selected, onSelect, label }: { model: GraphModel; selected: string | null; onSelect: (id: string) => void; label: string }) {
  const [lane, setLane] = useState<string | null>(null)
  const [hideMerges, setHideMerges] = useState(false)
  const hasMerges = model.nodes.some(node => node.kind === 'integrate')
  const allLanes = useMemo(() => layoutVersionGraph(model).lanes, [model])
  const colorOf = new Map(allLanes.map((item, i) => [item.id, i % 8]))
  return <div className="version-graph tgc-version-graph">
      <div className="vg-toolbar" role="group" aria-label={`${label}: lanes`}>
        {/* Many lanes read as one control, not a row of chips (REVIEW-8: 17 chips were chrome words on Built). */}
        {allLanes.length > 5 ? (
          <Picker label="Lane" value={lane} all={{ label: `All ${allLanes.length} lanes` }} options={allLanes.map((item) => ({ id: item.id, label: item.label }))} width={280} placeholder="Search lanes" onChange={setLane}>
            {lane ? allLanes.find((item) => item.id === lane)?.label ?? lane : `All ${allLanes.length} lanes`}
          </Picker>
        ) : (
          <>
            {/* Showing every lane already, the chip is a state, not a control (REVIEW-8 sweep: a dead click). */}
            <button type="button" className={`vg-lane-chip ${lane === null ? 'on' : ''}`} aria-pressed={lane === null} disabled={lane === null} onClick={() => setLane(null)}>
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
          </>
        )}
        {hasMerges && (
          <label className="vg-toggle">
            <input type="checkbox" checked={hideMerges} onChange={(event) => setHideMerges(event.target.checked)} /> hide merges
          </label>
        )}
      </div>
      <SharedVersionGraph model={model} label={label} selected={selected} onSelect={onSelect} shown={node => (lane === null || node.lane === lane) && !(hideMerges && node.kind === 'integrate')} />
    </div>
}

// ------------------------------------------------------------------------------------------------- the run page

const short = (sha: string) => sha.slice(0, 10)

/** The run's Versions section: its releases and their scores, the graph of every version, and the selected one. */
/** The run's delivered files, each opening in Outputs. */
function Delivered({ files, onOpenFile }: { files: readonly { path: string }[]; onOpenFile?: (path: string) => void }) {
  return files.length > 0 ? <p className="built-delivered">{files.map((file) => <button key={file.path} type="button" className="link-button mono" onClick={() => onOpenFile?.(file.path)}>{file.path}</button>)}</p> : null
}

/** Now's Built panel: what the run delivered, with its releases and page history one link away (audit D12: it led with repository-sync history and repeated the steps chart). */
export function BuiltSummary({ delivered = [], onOpenFile, historyHref }: { delivered?: readonly { path: string }[]; onOpenFile?: (path: string) => void; historyHref: string }) {
  return <div className="run-built no-inspector"><Delivered files={delivered} onOpenFile={onOpenFile} /><p className="faint">{delivered.length ? '' : 'No deliverable recorded. '}<a href={historyHref}>Releases and page history</a></p></div>
}

export function RunVersions({
  runUrl,
  poll,
  selected,
  onSelect,
  onClose,
  onOpenAgent,
  delivered = [],
  onOpenFile,
}: {
  runUrl: string
  poll?: number
  selected: string | null
  onSelect: (commit: string) => void
  onClose: () => void
  onOpenAgent: (node: string) => void
  delivered?: readonly { path: string }[]
  onOpenFile?: (path: string) => void
}) {
  const fetched = useDocument<unknown>(`${runUrl}/versions`, poll, true)
  // Polled like /versions while the run is live, so new releases reach the chart (Codex review on #190).
  const workspace = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, poll, true)
  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected, onClose])
  const parsed = useMemo(() => {
    if (fetched.data === undefined) return null
    const result = versionGraphDocumentSchema.safeParse(fetched.data)
    return result.success ? { doc: result.data, error: null } : { doc: null, error: result.error.issues[0]?.message ?? 'invalid version graph' }
  }, [fetched.data])
  const model = useMemo(() => (parsed?.doc?.available ? runGraphModel(parsed.doc, when) : null), [parsed])
  // What the run delivered leads Built (root 02:33Z: a stale role table of zeros came first while an artifact existed).
  const releases = <><Delivered files={delivered} onOpenFile={onOpenFile} /><CodeReleases releases={workspace.data?.releases ?? []} /></>
  // Code releases and page versions are independent records: a run without deliverables.git still shows its releases.
  const missing = !parsed ? (
    <p className="ws-status run-panel" role={fetched.error ? 'alert' : 'status'}>
      {fetched.error ? `No version graph for this run: ${fetched.error}. Runs pressed before discovery-lab#1411 keep no deliverables.git.` : 'Loading the version graph…'}
    </p>
  ) : parsed.error || !parsed.doc ? <p className="ws-status run-panel" role="alert">The version graph is unreadable: {parsed.error}</p>
    : !parsed.doc.available || !model ? <p className="ws-status run-panel">{parsed.doc.reason ?? 'This run keeps no version graph.'}</p> : null
  if (missing || !parsed?.doc || !model) return <div className="run-built no-inspector" data-section="versions">{releases}{missing}</div>
  const doc = parsed.doc
  // The inspector opens on a chosen version only: the graph is the page, the inspector its detail (REVIEW-8 Built 65).
  const commit = doc.commits.find((item) => item.id === selected) ?? null
  return (
    <div className={`run-built${commit ? '' : ' no-inspector'}`} data-section="versions">
      {releases}
      <div className="lineage-layout run-versions">
        <section className="lineage-pane" aria-label="Version graph">
          <p className="faint lineage-key">{doc.commits.length} page versions on {doc.lanes.length} lanes{doc.builtAt ? ` · read ${when(doc.builtAt)}` : ''}</p>
          <div><VersionGraph model={model} selected={commit?.id ?? null} onSelect={onSelect} label="Run versions" /></div>
          <Releases doc={doc} selected={commit?.id ?? null} onSelect={onSelect} />
          {doc.roles && <details className="built-roles"><summary>Role scorecard</summary><RunRoles roles={doc.roles} /></details>}
        </section>
        {commit && (
          <aside className="inspector-pane" aria-label="Inspector">
            <button type="button" className="inspector-close link-button" aria-label="Close the inspector" onClick={onClose}>Close</button>
            <ValueScope>
              <CommitInspector doc={doc} commit={commit} onSelect={onSelect} onOpenAgent={onOpenAgent} />
            </ValueScope>
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * What the run built, release by release: the steps of the play's check each code release passed, over the run's time
 * (workspace `releases`, the same rows the run's header counts). The page versions below are its knowledge pages.
 */
function CodeReleases({ releases }: { releases: RunWorkspaceDocument['releases'] }) {
  const scored = releases.filter((r) => r.at && r.passed != null && r.total).map((r) => ({ at: Date.parse(r.at!), r }))
  if (scored.length < 2) return null
  const total = Math.max(...scored.map(({ r }) => r.total!))
  // The axis says when; each dot names its release and steps in the readout (22a: a nearest-release axis read "rc1 · 03:33").
  const name = (t: number) => {
    const item = scored.find((entry) => entry.at === t)
    return item ? `${item.r.release} · ${item.r.passed} of ${item.r.total} steps` : 'steps passed'
  }
  return (
    <section className="built-releases" aria-label="Steps passed by each release">
      <h3>Steps passed by each release</h3>
      <Lines rows={5} axis={(t) => new Date(t).toISOString().slice(11, 16)} format={(v) => `${v} of ${total}`} series={[{ name: 'steps passed', color: 'var(--ar-accent, #8e59ff)', dots: true, label: name, points: scored.map(({ at, r }) => [at, r.passed!]) }]} />
    </section>
  )
}

/** Every release tag in order with its score, the rule's pick and the flags. */
function Releases({ doc, selected, onSelect }: { doc: VersionGraphDocument; selected: string | null; onSelect: (commit: string) => void }) {
  if (doc.tags.length === 0) return <p className="faint vg-releases-empty">No page version is tagged yet.</p>
  return (
    <details className="vg-releases" aria-label="Page versions">
      <summary>Page versions · {doc.tags.length}</summary>
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
                <b className="mono" title={tag.name}>{pagesVersion(tag.name)}</b>
                {tag.best && <span className="vg-chip tone-neutral">{PICKED}</span>}
                {tag.score && !tag.score.complete && <span className="vg-chip tone-muted">incomplete</span>}
              </td>
              <td className="mono">{tag.score ? `${tag.score.vector.exact[0]}/${tag.score.vector.exact[1]}` : '—'}</td>
              <td className="mono">{tag.score ? `${tag.score.vector.heldOut[0]}/${tag.score.vector.heldOut[1]}` : '—'}</td>
              <td className="mono">{tag.score ? (tag.score.vector.blockers ?? 'unknown') : '—'}</td>
              <td className="mono">{tag.score ? (tag.score.vector.judge === null ? 'none' : Math.round(tag.score.vector.judge * 10) / 10) : '—'}</td>
              <td>
                {tag.flags.length === 0 ? <span className="faint">none</span> : tag.flags.map((flag, i) => (
                  <span key={i} className="vg-chip tone-neutral">{flagLabel(flag)}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {doc.rule && <p className="faint">The deliverable is the best tag by {doc.rule}.</p>}
    </details>
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
      <ValueControls />
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
              <dt>Worker usage so far</dt>
              <dd>{money(commit.spendUsd)} at API prices, not billed</dd>
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
            {commit.profileDigest && <> with profile <code><CollapsibleValue value={commit.profileDigest} limit={19} /></code></>}{' '}
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
        <span title={tag.name}>{pagesVersion(tag.name)}</span>
        {tag.best && <span className="vg-chip tone-neutral">{PICKED}</span>}
      </h3>
      {tag.best && <p className="faint">The registered rule picks this tag as the run's deliverable.</p>}
      <p>{scoreLine(tag)}</p>
      {tag.flags.map((flag, i) => (
        <p key={i} className="vg-flag">{flagLabel(flag)}</p>
      ))}
      {tag.score && (
        <ul className="vg-checks">
          {tag.score.results.map((result) => (
            <li key={result.id} data-check={result.id}>
              {/* Bookkeeping checks: ✓ and ✕ glyphs in neutral ink, never a status hue. */}
              <span className="vg-verdict">{result.error ? '◌ error' : result.pass ? '✓ pass' : '✕ fail'}</span>{' '}
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
