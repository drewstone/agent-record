import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { AsOfStamp } from './AnswerStrip.js'
import { StatusPill, useDocument } from './data.js'
import { shortRun } from './play-standing.js'
import { CodePane, type RunWorkspaceDocument, type WorkspaceRelease } from './RunWorkspace.js'
import { viewAsOf, viewChip } from './view.js'
import { goalText, plainSummary, sinceLabel } from './plain-words.js'
import { RefDiff } from './ref-file.js'
import { RunFilesPane } from './RunFilesPane.js'

/**
 * The run page (journey spec Q5/Q6, the lead's 21:05Z pick): how close the best release is and what stops it (the step
 * ladder, one sentence, the action that clears the blocker), then what the agents did across the run's hours (one lane
 * per agent, coloured by outcome, releases on top, the plateau shaded and the span that produced the best release
 * outlined), then, for the lane picked, its summary, what it changed (code first) and its transcript.
 */
type Node = RunWorkspaceDocument['nodes'][number] & { start?: string | null; end?: string | null }
type Release = WorkspaceRelease & { by?: Record<string, number>; files?: Record<string, string[]> }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const hours = (a: number, b: number) => (b - a) / 3_600_000
const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const relTone = (r: Release) => (r.passed != null && r.total ? (r.passed === r.total ? 'pass' : r.passed / r.total >= 0.8 ? 'near' : 'fail') : 'none')
/** Run artefacts, not code: logs, bench outputs, proofs, generated JSON; folded under the code a reader came for. */
const ARTEFACT = /(\.(log|bin|out|csv|jsonl|json|txt)$|(^|\/)(logs?|run|runs|results?|benches|outputs?)\/|(^|\/)\.[^/]+$|_done$|launched$)/
/** An agent whose last words report a crash, or whose status is failed (v6-battery: "CRASH_timeout_2700s"). */
const crashed = (n: Node) => n.status === 'failed' || /\bCRASH|\bOOM\b|panicked|SIGKILL/.test(n.turn ?? '')

function useJourney(api: string, doc: RunDocument) {
  const runUrl = `${api}/runs/${encodeURIComponent(doc.run.id)}`
  const ws = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, doc.execution?.alive ? 15_000 : undefined, true)
  const model = useMemo(() => {
    const data = ws.data
    if (!data) return null
    const nodes = data.nodes as Node[]
    // A release checked but never tagged still counts (its check time stands in): dropping it printed "No release was
    // checked" over a release that passed (root 10478 23:12Z, test-disposable-smoke rc2).
    const releases = (data.releases as Release[]).map((r) => ({ ...r, taggedAt: r.taggedAt ?? r.at ?? null })).filter((r) => r.taggedAt)
    const t0 = Math.min(...nodes.map((n) => ms(n.start)).filter(Number.isFinite))
    const t1 = Math.max(...nodes.map((n) => ms(n.end ?? n.lastAt)).filter(Number.isFinite), ...releases.map((r) => ms(r.taggedAt)))
    const best = releases.find((r) => r.release === data.best) ?? releases.at(-1) ?? null
    const commits = new Map<string, number>()
    for (const r of releases) for (const [id, n] of Object.entries(r.by ?? {})) commits.set(id, (commits.get(id) ?? 0) + n)
    const root = nodes.find((n) => n.role === 'root' || n.role === 'lead')?.id ?? doc.run.id
    const plateau = best ? releases.find((r) => r.passed === best.passed) ?? best : null
    const open = best?.steps?.find((s) => s.state !== 'pass') ?? null
    const same = releases.length > 1 && releases.every((r) => r.passed === releases[0]!.passed && r.total === releases[0]!.total)
    const attributed = releases.some((r) => Object.keys(r.by ?? {}).length > 0)
    return { data, nodes, releases, t0, t1, best, commits, root, plateau, open, same, attributed }
  }, [ws.data, doc.run.id])
  return { runUrl, model, error: ws.error }
}
type Model = NonNullable<ReturnType<typeof useJourney>['model']>

type Blocker = { why?: string | null; action?: string | null; owner?: string | null; text?: string; since?: string | null; kind?: string; dispute?: string | null }

/**
 * Who acts on the blocker (the lead, 21:45Z): Drew's own decision is a control, a check dispute's two rulings as the
 * exact `disco steer --ruling` commands to run; anyone else's is "nothing for you", with since when they hold it.
 */
/** Drew's ruling on a check dispute: the Discovery host is read-only, so each button copies the exact command that rules. */
export function RulingButtons({ runId, dispute }: { runId: string; dispute: string }) {
  const [copied, setCopied] = useState<string | null>(null)
  const command = (verdict: 'upheld' | 'rejected') => `disco steer ${runId} "Drew's ruling" --ruling ${dispute} --verdict ${verdict}`
  const copy = (verdict: 'upheld' | 'rejected') => void navigator.clipboard?.writeText(command(verdict)).then(() => setCopied(verdict))
  return (
    <span className="rj-decide">
      <button type="button" onClick={() => copy('upheld')} title={command('upheld')}>{copied === 'upheld' ? 'Copied' : 'Uphold the agents'}</button>
      <button type="button" onClick={() => copy('rejected')} title={command('rejected')}>{copied === 'rejected' ? 'Copied' : 'The check stands'}</button>
    </span>
  )
}


function NextStep({ runId, blocker, paused }: { runId: string; blocker: Blocker; paused: boolean }) {
  const since = sinceLabel(blocker.since)
  // While research is paused only Drew lifts it: point at Today's decision, never "nothing for you" beside it.
  const pause = paused && <p className="rj-next"><b>Research is paused; lifting it is your decision</b> <a href="/today">→ Today</a></p>
  if (blocker.owner === 'Drew' && blocker.kind === 'check-dispute' && blocker.dispute) {
    return (
      <p className="rj-next"><b>Your decision:</b> {blocker.action} <RulingButtons runId={runId} dispute={blocker.dispute} /></p>
    )
  }
  const why = blocker.why ? `${blocker.why}; ` : ''
  return (
    <>
      {pause}
      <p className="rj-next">{!paused && <b>Nothing for you. </b>}<span className="rj-muted">{why}{blocker.owner ?? 'Its owner'} is on it{since ? ` since ${since}` : ''}: {blocker.action?.charAt(0).toLowerCase()}{blocker.action?.slice(1)}.</span></p>
    </>
  )
}

/** Q3 on the run: the best release's steps as the hero, how long it has been stuck, and the action that clears it. */
function Ladder({ doc, m }: { doc: RunDocument; m: Model }) {
  const stuck = m.plateau ? hours(ms(m.plateau.taggedAt), m.t1) : null
  const blocker = doc.view?.blocker as (Blocker | null | undefined)
  return (
    <section className="rj-hero" aria-label="How close the best release is">
      {m.best?.steps && (
        <ol className="rj-ladder">
          {m.best.steps.map((s, i) => (
            <li key={i} className={`rj-step rj-step-${s.state}`}><span className="rj-step-n">{i + 1}</span><span>{s.label}</span></li>
          ))}
        </ol>
      )}
      <p className="rj-stuck">
        {m.best ? <><b>{m.best.release}</b> · {m.open ? `stuck at the ${m.open.label}${stuck !== null ? ` ${stuck.toFixed(0)} h, since ${m.plateau!.release}` : ''}` : 'every step passes'}</> : 'No release was checked.'}
        {m.best && doc.view?.status.key === 'solved-earlier' && <span className="rj-muted"> under earlier check {m.best.checker ?? ''}; not run under the current one.</span>}
      </p>
      {blocker?.action && <NextStep runId={doc.run.id} blocker={blocker} paused={Boolean(doc.view?.paused)} />}
      <p className="rj-releases">
        {m.same
          ? `${m.releases[0]!.release}–${m.releases.at(-1)!.release}: all ${m.releases[0]!.passed}/${m.releases[0]!.total}${stuck !== null && m.plateau === m.releases[0] ? `, no step gained in ${stuck.toFixed(0)} h` : ''}`
          : m.releases.map((r) => <span key={r.release} className={`rj-mini rj-${relTone(r)}`} title={r.sentence ?? undefined}>{r.release} {r.passed}/{r.total}</span>)}
      </p>
    </section>
  )
}

/** Q5: one lane per agent across the run's hours; green shipped, red crashed, grey idle; releases and the plateau on top. */
function Lanes({ m, phone, picked, onPick }: { m: Model; phone: boolean; picked: string | null; onPick: (id: string) => void }) {
  const lanes = [...m.nodes].sort((a, b) => (a.id === m.root ? -1 : b.id === m.root ? 1 : ms(a.start) - ms(b.start)))
  const W = phone ? 358 : 1420, L = phone ? 0 : 170, laneH = phone ? 30 : 30, top = 58
  const H = top + lanes.length * laneH + 30
  const x = (t: number) => L + ((t - m.t0) / (m.t1 - m.t0)) * (W - L - 14)
  const bestBy = new Set(Object.keys(m.best?.by ?? {}))
  const prevBest = m.best ? m.releases[m.releases.indexOf(m.best) - 1] : undefined
  const ticks = Array.from({ length: phone ? 3 : 7 }, (_, i) => m.t0 + ((m.t1 - m.t0) * i) / (phone ? 2 : 6))
  const kind = (n: Node) => (crashed(n) ? 'crash' : n.id === m.root ? 'lead' : m.commits.has(n.id) ? 'shipped' : 'idle')
  return (
    <svg className="rj-lanes" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Agents across the run's hours, releases on top">
      {m.plateau && m.open && (
        <g className="rj-plateau">
          <rect x={x(ms(m.plateau.taggedAt))} y={top - 34} width={x(m.t1) - x(ms(m.plateau.taggedAt))} height={22} rx={4} />
          <text x={x(ms(m.plateau.taggedAt)) + 6} y={top - 19}>no step gained since {m.plateau.release}</text>
        </g>
      )}
      {m.releases.map((r) => {
        const rx = x(ms(r.taggedAt))
        return (
          <g key={r.release} className={`rj-rel rj-${relTone(r)}${r === m.best ? ' rj-best' : ''}`}>
            <line x1={rx} x2={rx} y1={top - 6} y2={H - 26} />
            <path d={`M${rx} ${top - 9} l5 6 l-5 6 l-5 -6z`} />
            {r === m.best && <text x={rx} y={top - 40} textAnchor="end">{r.release} best</text>}
          </g>
        )
      })}
      {m.best && prevBest && bestBy.size > 0 && (() => {
        const rows = lanes.map((n, i) => (bestBy.has(n.id) ? i : -1)).filter((i) => i >= 0)
        return <rect className="rj-produced" x={x(ms(prevBest.taggedAt))} y={top + Math.min(...rows) * laneH + 2} width={x(ms(m.best.taggedAt)) - x(ms(prevBest.taggedAt))} height={(Math.max(...rows) - Math.min(...rows) + 1) * laneH - 4} rx={6} />
      })()}
      {lanes.map((n, i) => {
        const y = top + i * laneH
        const a = x(ms(n.start)), b = x(ms(n.end ?? n.lastAt))
        const label = `${n.id === m.root ? 'lead' : n.role ?? n.label}${m.commits.get(n.id) ? ` · ${m.commits.get(n.id)}` : ''}`
        return (
          <g key={n.id} className={`rj-lane rj-${kind(n)}${picked === n.id ? ' rj-on' : ''}`} onClick={() => onPick(n.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(n.id)} role="button" tabIndex={0} aria-pressed={picked === n.id}>
            <rect className="rj-hit" x={0} y={y} width={W} height={laneH} />
            {!phone && <text className="rj-lane-label" x={L - 12} y={y + laneH / 2 + 4} textAnchor="end">{label}</text>}
            <rect className="rj-bar" x={a} y={y + (phone ? 13 : 7)} width={Math.max(4, b - a)} height={phone ? 11 : 16} rx={4}>
              <title>{crashed(n) ? 'Its last words report a crash' : n.id === m.root ? 'The lead' : m.commits.has(n.id) ? `Its work is in ${m.releases.filter((r) => r.by?.[n.id]).map((r) => r.release).join(', ')}` : 'None of its work landed in a release'}</title>
            </rect>
            {phone && <text className="rj-lane-label" x={Math.min(a, W - 90)} y={y + 10}>{label}</text>}
            {m.releases.filter((r) => r.by?.[n.id]).map((r) => <circle key={r.release} cx={x(ms(r.taggedAt))} cy={y + (phone ? 18 : 15)} r={3.5} />)}
          </g>
        )
      })}
      {ticks.map((t, i) => <text key={t} className="rj-axis" x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{day(t)} {clock(t)}</text>)}
    </svg>
  )
}

/** A plain line, with the agent's own words behind "full" when the line shortened them. */
function Full({ short, raw }: { short: string; raw: string }) {
  if (short === raw.trim()) return <>{short}</>
  return <span className="rj-full">{short} <details><summary>full</summary><p>{raw}</p></details></span>
}

/** Q6: the picked agent's summary, what it changed (code first, artefacts folded), then its transcript. */
/** The agent as recorded: role, harness and model; a value the record lacks is left out, never guessed. */
const who = (node: Node) => [node.role ?? node.label, node.harness, node.model?.split('/').pop()].filter(Boolean).join(' · ')

/**
 * The agent's place in the run: the agent that spawned it (the workspace's spawn edge), or, for the root, the play press
 * that submitted the run (run-input.json). A spawn is a relationship, not proof of who sent a message: each message's own
 * sender shows on it in the conversation (promptSenderNodeId or coordination.fromNode, else "Sender not captured").
 */
function spawnedBy(m: Model, node: Node) {
  const edge = m.data.edges.find((e) => e.kind === 'spawn' && e.to === node.id)
  const parent = edge ? m.nodes.find((n) => n.id === edge.from) : null
  if (parent) return `${parent.role ?? parent.label} (${parent.label})`
  return node.id === m.root ? 'the play press (the run was submitted from run-input.json)' : 'not recorded'
}

/**
 * Who asked whom what, on the landing (root 10478, 23:10Z): the run's recorded input is submission provenance: the
 * prompt the root was given and the goal it carries, with the file and hash it came from; a value the input lacks is said to be missing, never filled.
 */
function Trigger({ doc, m }: { doc: RunDocument; m: Model }) {
  const input = doc.input
  const root = m.nodes.find((n) => n.id === m.root) ?? m.nodes[0]
  if (!input) return <p className="rj-trigger rj-muted">What started this run was not recorded.</p>
  const source = input.source?.path?.split('/').pop()
  return (
    <div className="rj-trigger" title={source ? `submitted by the play press from ${source}${input.source?.sha256 ? ` (sha256 ${input.source.sha256})` : ''}` : undefined}>
      <p>{root ? (input.instruction ? <Full short={who(root)} raw={input.instruction} /> : who(root)) : 'root agent'}</p>
      {input.objective && <p><Full short={plainSummary(goalText(input.objective), 24)} raw={goalText(input.objective)} /></p>}
    </div>
  )
}

function Drill({ runUrl, m, node, transcript, onPick }: { runUrl: string; m: Model; node: Node; transcript: (node: string, select: (node: string) => void) => ReactNode; onPick: (id: string) => void }) {
  const landed = m.releases.filter((r) => r.files?.[node.id]?.length)
  const changes = new Map<string, Release>()
  for (const r of landed) for (const path of r.files![node.id]!) changes.set(path, r)
  const paths = [...changes.keys()]
  const code = paths.filter((p) => !ARTEFACT.test(p))
  const artefacts = paths.filter((p) => ARTEFACT.test(p))
  const [file, setFile] = useState<string | null>(null)
  useEffect(() => setFile(null), [node.id])
  const release = file ? changes.get(file)! : null
  const prev = release ? m.releases[m.releases.indexOf(release) - 1]?.release ?? null : null
  const role = node.id === m.root ? 'lead' : node.role ?? node.label
  return (
    <section className="rj-drill" aria-label={`${role}: what it did`}>
      <h2>{role}</h2>
      <dl className="rj-summary">
        <dt>Who</dt><dd>{who(node)}</dd>
        <dt>Spawned by</dt><dd>{spawnedBy(m, node)}</dd>
        <dt>Task</dt><dd>{node.assignment ? <Full short={plainSummary(node.assignment)} raw={node.assignment} /> : 'not recorded'}</dd>
        <dt>Result</dt><dd>{crashed(node) ? 'Crashed. ' : ''}{node.turn ? <Full short={plainSummary(node.turn)} raw={node.turn} /> : 'no last words recorded'}</dd>
        <dt>Changed</dt><dd>{paths.length ? `${code.length} code ${code.length === 1 ? 'file' : 'files'}${artefacts.length ? `, ${artefacts.length} logs and outputs` : ''}, in ${landed.map((r) => r.release).join(', ')}` : 'nothing that landed in a release'}</dd>
      </dl>
      {paths.length > 0 && (
        <div className="rj-changes">
          <h3>What changed</h3>
          <ul>{code.map((p) => <li key={p}><button type="button" aria-pressed={file === p} onClick={() => setFile(file === p ? null : p)} className="mono">{p}</button><span className="rj-muted"> {changes.get(p)!.release}</span></li>)}</ul>
          {artefacts.length > 0 && <details><summary>{artefacts.length} logs and outputs</summary><ul>{artefacts.map((p) => <li key={p}><button type="button" onClick={() => setFile(p)} className="mono">{p}</button></li>)}</ul></details>}
          {file && release && <RefDiff key={`${release.release}:${file}`} runUrl={runUrl} base={prev} head={release.release} path={file} />}
        </div>
      )}
      <details className="rj-transcript">
        <summary>Transcript</summary>
        {transcript(node.id, onPick)}
      </details>
    </section>
  )
}

export function RunJourney({ api, doc, transcript, phone }: { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode; phone: boolean }) {
  const { runUrl, model: m, error } = useJourney(api, doc)
  const [chosen, setPicked] = useState<string | null>(null)
  // A one-agent run opens on its only agent: nobody should have to select it to learn what it did.
  const picked = chosen ?? (m?.nodes.length === 1 ? m.nodes[0]!.id : null)
  const view = doc.view
  const single = m?.nodes.length === 1
  // The work: one files pane for the best release's code or the retained artifacts (the answer opens first).
  const work = m && (
    <section className="rj-work" aria-label="The work">
      <RunFilesPane api={api} doc={doc}
        codeUnavailable={!m.data.code.available ? (m.data.code.reason ?? 'not available on this host') : !m.best ? 'no release was checked, so there is no release code to show' : null}
        code={m.best && <CodePane runUrl={runUrl} refName={m.best.release} previous={m.releases[m.releases.indexOf(m.best) - 1]?.release ?? null} label={`Release ${m.best.release}`} />} />
    </section>
  )
  const node = m?.nodes.find((n) => n.id === picked) ?? null
  const receipt = doc.receipt
  return (
    <section className="rj" data-run-journey>
      <header className="rj-head">
        <a className="rj-crumb" href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a>
        <div className="rj-title">
          <h1>Run {shortRun(doc.run.play, doc.run.id)}</h1>
          {view && <StatusPill status={viewChip(view.status)} />}
          {view && <AsOfStamp asOf={viewAsOf(view)} />}
        </div>
        {m && <p className="rj-sentence">{view?.status.label ?? 'Ended'} after {hours(m.t0, m.t1).toFixed(1)} h{m.best ? `; best ${m.best.release} passes ${m.best.passed} of ${m.best.total} steps` : ''}.</p>}
        {m && <Trigger doc={doc} m={m} />}
      </header>
      {!m ? <p className="rw-empty">{error ? `The run's agents are unavailable: ${error}` : 'Reading the run…'}</p> : (
        <>
          <Ladder doc={doc} m={m} />
          {single ? (
            // One agent: its identity in a line, and the work itself gets the room a one-lane timeline would waste.
            <p className="rj-one">{who(m.nodes[0]!)} · {m.nodes[0]!.status}</p>
          ) : (
            <section aria-label="What the agents did">
              <h2 className="rj-label">{m.nodes.length} agents{m.attributed ? ` · ${[...m.commits.keys()].filter((id) => id !== m.root).length} shipped work` : ''}</h2>
              <Lanes m={m} phone={phone} picked={picked} onPick={setPicked} />
            </section>
          )}
          {single && work}
          {node && <Drill runUrl={runUrl} m={m} node={node} transcript={transcript} onPick={setPicked} />}
          {!single && work}
          {receipt && <footer className="rj-foot"><a href={`/run/${encodeURIComponent(doc.run.id)}/receipt/`}>Published receipt{/^rc\d+$/.test(receipt.tag) ? ` (${receipt.tag})` : ''}</a></footer>}
        </>
      )}
    </section>
  )
}
