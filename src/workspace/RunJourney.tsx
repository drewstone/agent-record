import { type ReactNode, useMemo, useState } from 'react'
import type { FlowMarker, FlowSpan, FlowTrace } from '@tangle-network/charts'
import { FlowWaterfall } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { AsOfStamp, Tip } from './AnswerStrip.js'
import { duration, money, StatusPill, tokens, useDocument } from './data.js'
import { releaseName, shortRun } from './play-standing.js'
import { CodePane, type RunWorkspaceDocument, type WorkspaceRelease } from './RunWorkspace.js'
import { RunActivity } from './RunActivity.js'
import { viewAsOf, viewChip } from './view.js'
import { goalText, plainSummary, stepWord } from './plain-words.js'
import { RunFilesPane } from './RunFilesPane.js'
import { useSearch } from './navigation.js'

/**
 * The run page (journey spec Q5/Q6, the lead's 21:05Z pick): how close the best release is and what stops it (the step
 * ladder, one sentence, the action that clears the blocker), then what the agents did across the run's hours (the shared
 * agent timeline, releases as markers), then, for the agent picked, its summary, what it changed (code first) and its
 * transcript.
 */
/** An agent's usage as the host read it (tangle-tools agent_usage), with the source it names. */
type Usage = { billedUsd: number | null; listUsd: number | null; listComplete: boolean; calls: number | null; pricedCalls: number | null; tokens: number | null; at: string | null; source: string; matchedBy?: string | null; priceSource?: { repository?: string; commit?: string } | null; steps?: Step[] }
/** One stretch of an agent's time from its session store (epoch ms): a model call, a tool, or waiting between calls. */
type Step = { kind: 'model' | 'tool' | 'waiting'; startMs: number; endMs: number; failed: boolean }
/** Start, end (null while live) and status come from the run's spawn journal (tangle-tools run_journal). */
type Node = RunWorkspaceDocument['nodes'][number] & { start?: string | null; end?: string | null; usage?: Usage | null }
type Release = WorkspaceRelease & { by?: Record<string, number>; files?: Record<string, string[]>; tagged?: boolean }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const hours = (a: number, b: number) => (b - a) / 3_600_000
const relTone = (r: Release) => (r.passed != null && r.total ? (r.passed === r.total ? 'pass' : r.passed / r.total >= 0.8 ? 'near' : 'fail') : 'none')
/** A release's score, or that no check scored it (22a rc3 read "rc3 /": tagged, never checked). */
const score = (r: Release) => (r.passed != null && r.total ? `${r.passed}/${r.total}` : 'not checked')
/** Run artefacts, not code: logs, bench outputs, proofs, generated JSON; folded under the code a reader came for. */
const ARTEFACT = /(\.(log|bin|out|csv|jsonl|json|txt)$|(^|\/)(logs?|run|runs|results?|benches|outputs?)\/|(^|\/)\.[^/]+$|_done$|launched$)/
/** "4 m ago", "3 h ago" from now. */
const ago = (iso: string) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000); return m < 90 ? `${Math.round(m)} m ago` : `${Math.round(m / 60)} h ago` }
/**
 * Two numbers, always (lead 10:05Z): API-equivalent at list price and what the seat billed, with the tokens and how
 * complete the pricing is ("≥$4.12 list, 38 of 41 calls priced"). "—" only when the host has no source at all.
 */
function costText(u: Usage | null | undefined): { text: string; title: string } {
  if (!u) return { text: '—', title: 'No usage recorded' }
  const list = u.listUsd == null ? null : `${u.listComplete ? '≈' : '≥'}${money(u.listUsd)} list`
  const partial = !u.listComplete && u.calls ? `, ${u.pricedCalls ?? 0} of ${u.calls} calls priced` : ''
  const parts = [list && `${list}${partial}`, u.billedUsd != null && `${money(u.billedUsd)} billed`, u.tokens != null && `${tokens(u.tokens)} tokens`].filter(Boolean)
  const from = `${u.source}${u.matchedBy ? ` (matched by ${u.matchedBy})` : ''}`
  const price = u.priceSource?.repository ? `; list price from ${u.priceSource.repository} ${u.priceSource.commit?.slice(0, 8) ?? ''}` : ''
  return { text: parts.join(' · ') || '—', title: `Read from ${from}${u.at ? `, updated ${ago(u.at)}` : ''}${price}` }
}
/** Failed is the journal's `down` settle (Runtime's one failure word: crash, deadline, validation); never words in a last turn (lead 2026-10-25). */
const failed = (n: Node) => n.status === 'failed'

function useJourney(api: string, doc: RunDocument) {
  const runUrl = `${api}/runs/${encodeURIComponent(doc.run.id)}`
  const ws = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`, doc.execution?.alive ? 15_000 : undefined, true)
  const model = useMemo(() => {
    const data = ws.data
    if (!data) return null
    const nodes = data.nodes as Node[]
    // A release checked but never tagged still counts (its check time stands in): dropping it printed "No release was
    // checked" over a release that passed (root 10478 23:12Z, test-disposable-smoke rc2).
    const releases = (data.releases as Release[]).map((r) => ({ ...r, tagged: Boolean(r.taggedAt), taggedAt: r.taggedAt ?? r.at ?? null })).filter((r) => r.taggedAt)
    const t0 = Math.min(...nodes.map((n) => ms(n.start)).filter(Number.isFinite))
    const t1 = Math.max(...nodes.map((n) => ms(n.end ?? n.lastAt)).filter(Number.isFinite), ...releases.map((r) => ms(r.taggedAt)), data.live ? Date.now() : -Infinity)
    const best = releases.find((r) => r.release === data.best) ?? releases.at(-1) ?? null
    const commits = new Map<string, number>()
    // What each agent shipped is its commits in the run's deliverables; a host without them falls back to release attribution.
    if (nodes.some((n) => typeof n.shipped === 'number')) for (const n of nodes) commits.set(n.id, n.shipped ?? 0)
    else for (const r of releases) for (const [id, n] of Object.entries(r.by ?? {})) commits.set(id, (commits.get(id) ?? 0) + n)
    // The root is the agent nothing spawned, by the journal's edges, not by a role word.
    const root = nodes.find((n) => !data.edges.some((e) => e.kind === 'spawn' && e.to === n.id))?.id ?? doc.run.id
    const open = best?.steps?.find((s) => s.state !== 'pass') ?? null
    const same = releases.length > 1 && releases.every((r) => r.passed === releases[0]!.passed && r.total === releases[0]!.total)
    const attributed = releases.some((r) => Object.keys(r.by ?? {}).length > 0)
    return { data, nodes, releases, t0, t1, best, commits, root, open, same, attributed }
  }, [ws.data, doc.run.id])
  return { runUrl, model, error: ws.error }
}
type Model = NonNullable<ReturnType<typeof useJourney>['model']>

/** A disposable run's requested teardown, as the host's run_view reads it from RECEIPT.json `system.retention`. */
type Lifecycle = { state: string; sentence: string; source?: string | null; resources?: { id: string | null; removal: string | null; removedAt: string | null }[] }

/** The host's blocker (views.run_blocker): its producer's sentence, its typed cause and release, and who acts by role. */
type Blocker = { kind: string; sentence?: string; text: string; actor?: { role: string; label: string }; since?: string | null }
/** A decision the host lists for the run, with the exact command each option runs (views.need_choice). */
type Need = { actor?: { role: string; label: string }; options?: { label: string; command: string; consequence?: string }[] }

/** One option's command, copied: the Discovery host is read-only, so a decision is a command its owner runs. */
function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" title={command} onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true))}>{copied ? 'Copied' : label}</button>
}

/** What holds the run, as served: who acts (a role, never a name) and the producer's sentence, with the owner's options. */
function NextStep({ blocker, need, paused }: { blocker: Blocker; need: Need | undefined; paused: boolean }) {
  return (
    <>
      {paused && <p className="rj-next"><b>Research is paused; lifting it is the owner's decision</b> <a href="/today">→ Today</a></p>}
      <p className="rj-next"><b>{blocker.actor?.label ?? 'Held'}:</b> <span className="rj-muted">{blocker.sentence ?? blocker.text}</span>
        {need?.options?.length ? <span className="rj-decide">{need.options.map((o) => <CopyCommand key={o.label} {...o} />)}</span> : null}</p>
    </>
  )
}

/** Q3 on the run: the best release's steps as the hero, the step it stops at, and the action that clears it. */
function Ladder({ doc, m, onRelease }: { doc: RunDocument; m: Model; onRelease: (release: string) => void }) {
  const lifecycle = (doc.view as { lifecycle?: Lifecycle | null } | null | undefined)?.lifecycle ?? null
  const blocker = doc.view?.blocker as (Blocker | null | undefined)
  return (
    <section className="rj-hero" aria-label="How close the best release is">
      {/* One line, like the play page's strip (review 2 #10: six 100 px tiles above the timeline). */}
      {m.best?.steps && m.best.steps.length > 1 && (
        <ol className="pj-strip" aria-label={`Steps ${m.best.release} passed`}>
          {m.best.steps.map((s, i) => <li key={i} data-step={s.state} className={s === m.open ? 'is-open' : undefined}><Tip text={`Step ${i + 1} of ${m.best!.steps!.length}, ${s.label}: ${stepWord(s.state)} on ${m.best!.release}`}><i />{s.label}</Tip></li>)}
        </ol>
      )}
      <p className="rj-stuck">
        {/* What this run's best release reached, not how long the play has been stuck: that is the play page's one
            standing fact, and a per-run clock contradicted it (review 1 #2: 22a "54 h since rc1" on a 6.7 h run). */}
        {/* Said once each (root 2026-10-25): the status pill says which check, the header pill and the line below say the
            teardown; this line says only what the release reached. */}
        {/* While the goal's cleanup is unconfirmed the header leads with it, and the narrower check verdict sits here by its receipt (root 23:24Z). */}
        {lifecycle && lifecycle.state !== 'done' && doc.view && <><StatusPill status={viewChip(doc.view.status)} />{' '}</>}
        {m.best ? <><b>{releaseName(m.best.release, m.data.lineage)}</b>{doc.receipt && <> · <a href={`/run/${encodeURIComponent(doc.run.id)}/receipt/`}>receipt</a></>} · {m.open ? (m.open.state === 'fail' ? `failed the ${m.open.label}${m.best.checker ? ` under check ${m.best.checker}` : ''}` : `the ${m.open.label} has not run`) : doc.view?.status.key === 'solved-earlier' && m.best.checker ? `every step of check ${m.best.checker} passes` : 'every step passes'}</> : 'No release was checked.'}
      </p>
      {/* A settled run's blocker is history: only a live run, or one waiting on its owner, says who acts now (review 2 #3:
          21c's Oct 23 blocker contradicted the play's current one). */}
      {blocker && (doc.execution?.alive || blocker.actor?.role === 'owner') && <NextStep blocker={blocker} need={(doc.view?.needsYou as Need[] | undefined)?.[0]} paused={Boolean(doc.view?.paused)} />}
      {m.releases.length > 1 && <p className="rj-releases">
        {m.same
          ? `${m.releases[0]!.release}–${m.releases.at(-1)!.release}: all ${score(m.releases[0]!)}`
          // A release with no tag recorded has no name the code reader resolves (21c rc116 opened a 404 pane): a label, not a
          // button. Its tooltip says what was recorded; whether its commit's code was kept is not known (root review of #179).
          : m.releases.map((r) => r.tagged
            ? <button type="button" key={r.release} className={`rj-mini rj-${relTone(r)}`} title={[releaseName(r.release, m.data.lineage), r.sentence].filter(Boolean).join('\n')} onClick={() => onRelease(r.release)}>{r.release} {score(r)}</button>
            // One plain sentence (REVIEW-7 #5: the check's raw text leaked into it and contradicted the count).
            : <Tip key={r.release} className={`rj-mini rj-${relTone(r)}`} text={`${r.release}: ${score(r)}. No release tag recorded; recorded commit ${r.commit ?? 'none'}.`}>{r.release} {score(r)}</Tip>)}
      </p>}
    </section>
  )
}

/**
 * Q5: one row per agent across the run's hours in the shared agent timeline (charts FlowWaterfall, agents view), which
 * sizes from its container, truncates long names at the end with the full name in the tooltip, and zooms. Each release
 * is a marker on the trace clock; opening a row picks that agent for the drill-down below.
 */
function Lanes({ m, live, cost, picked, onPick }: { m: Model; live: boolean; cost: number | null; picked: string | null; onPick: (id: string | null) => void }) {
  // The lane's color and the legend (charts 0.18.0 FlowSpan.outcome; review 2 #2): shipped, nothing shipped, failed.
  // A live agent that has not shipped yet is Running, not "Nothing shipped" (review 4 #6: 7 live agents on 22a read as idle).
  const running = (n: Node) => live && !n.end && ['running', 'waiting'].includes(n.status)
  // Shipped is commits, whatever the settle (disco-ui-review 23:22Z: 7 of 21c's 9 failed agents committed); status 'failed' draws the failure.
  const tone = (n: Node): FlowSpan['outcome'] => (m.commits.get(n.id) ? { tone: 'ok', label: 'Shipped' } : failed(n) ? { tone: 'failed', label: 'Failed' } : running(n) ? { tone: 'warn', label: 'Running' } : n.id === m.root ? undefined : { tone: 'neutral', label: 'Nothing shipped' })
  const trace = useMemo((): FlowTrace => {
    const parent = new Map(m.data.edges.filter((e) => e.kind === 'spawn').map((e) => [e.to, e.from]))
    const ids = new Set(m.nodes.map((n) => n.id))
    const spans: FlowSpan[] = m.nodes.filter((n) => Number.isFinite(ms(n.start))).map((n) => {
      // A live agent's bar runs to now; its end is the journal's settle or cancel.
      const end = running(n) ? Date.now() : ms(n.end ?? n.lastAt)
      const from = parent.get(n.id)
      return {
        id: n.id, ...(from && ids.has(from) ? { parentId: from } : {}), kind: 'pipeline' as const,
        name: n.role ?? n.label,
        // The lane label is name plus short model, four words at most (REVIEW-8 gate 1, as the reference frames); what it
        // shipped is the outcome pill and the card's Releases and Commits cells.
        detail: n.model?.split('/').pop() ?? undefined,
        startMs: ms(n.start) - m.t0, endMs: Math.max(ms(n.start), Number.isFinite(end) ? end : ms(n.start)) - m.t0,
        status: running(n) ? 'running' as const : failed(n) ? 'failed' as const : 'done' as const,
        ...(tone(n) ? { outcome: tone(n) } : {}),
        // Its list-price cost so far; absent stays absent, never a zero. A restart is a notch on the bar (charts 0.20.0).
        ...(typeof n.usage?.listUsd === 'number' ? { costUsd: n.usage.listUsd } : {}),
        marks: (n.restarts ?? []).map((at) => ({ at: ms(at) - m.t0, kind: 'restart', label: `Restarted ${at.slice(11, 16)}Z` })),
        // The card's cells (charts 0.19.0 FlowSpan.facts): releases it shipped into and its commits.
        facts: [
          { label: 'Releases', value: m.releases.filter((r) => r.by?.[n.id]).map((r) => r.release).join(', ') || '—' },
          { label: 'Commits', value: String(m.commits.get(n.id) ?? 0) },
          ...(n.turns != null ? [{ label: 'Turns', value: String(n.turns) }] : []),
          ...(n.harness ? [{ label: 'Harness', value: n.harness }] : []),
          ...(n.usage?.billedUsd != null ? [{ label: 'Billed', value: money(n.usage.billedUsd) }] : []),
          ...(n.usage?.tokens != null ? [{ label: 'Tokens', value: tokens(n.usage.tokens) }] : []),
        ],
      }
    })
    const { tokens: measured } = runUsage(m)
    // Each agent's steps as its child spans, so its bar is drawn in thinking / tool / waiting / failed segments (review 4 #1).
    const steps: FlowSpan[] = m.nodes.flatMap((n) => (n.usage?.steps ?? []).map((step, i) => ({
      id: `${n.id}#${i}`, parentId: n.id, kind: step.kind, name: step.kind === 'model' ? 'thinking' : step.kind,
      startMs: step.startMs - m.t0, endMs: step.endMs - m.t0, status: step.failed ? 'failed' as const : 'done' as const,
    })))
    spans.push(...steps)
    // A stretch with no agent turn is a labelled band (tangle-tools run_journal pauses: 22a's 4 h 40 m after the GTR guard stop).
    // The band says how long; its reason waits on a charts tooltip field (three reasons added ~20 words across 22a's rows).
    const pauses = (m.data.pauses ?? []).map((p) => ({ startMs: ms(p.from) - m.t0, endMs: ms(p.to) - m.t0, label: `Paused ${duration(ms(p.to) - ms(p.from))}` }))
    // Tool calls are the record's per-agent counts; the cost is the stat row's alone (REVIEW-9: the card's ≈ beside the row's ≥).
    // The run's one cost (spend.apiEquivalentUsd) as the lower bound it is; tool calls only where the record counted them (charts 0.20.2).
    const counted = m.nodes.filter((n) => typeof n.toolCalls === 'number')
    return { spans, pauses, totalMs: m.t1 - m.t0, promptTokens: measured ?? 0, completionTokens: 0, ...(counted.length ? { toolCalls: counted.reduce((sum, n) => sum + n.toolCalls!, 0) } : {}), ...(cost != null ? { costUsd: cost, costBound: 'lower' as const } : {}) }
  }, [m, live, cost])
  // Releases that moved the score, the best and the newest: 17c tagged 205 releases, and a line for each buried the rows.
  const marked = useMemo(() => m.releases.filter((r, i) => r === m.best || i === m.releases.length - 1 || r.passed !== m.releases[i - 1]?.passed), [m])
  const markers = useMemo((): FlowMarker[] => marked.map((r) => ({
    at: ms(r.taggedAt) - m.t0,
    label: `${r.release} ${score(r)}${r === m.best ? ' best' : ''}`,
    tone: relTone(r) === 'pass' ? 'ok' as const : relTone(r) === 'fail' ? 'failed' as const : 'neutral' as const,
  })), [m, marked])
  // The header's stat row owns the run's numbers, so the chart's summary strip is off (sandbox-ui 03:12Z handoff).
  return <FlowWaterfall trace={trace} live={live} defaultView="agents" label="Trace" summary={false} markers={markers} selectedId={picked ?? undefined} onDeselect={() => onPick(null)} onSelect={(span) => { const id = span.kind === 'pipeline' ? span.id : span.parentId ?? span.id; if (id) onPick(id) }} />
}

/**
 * The release to diff against: the nearest earlier one with a tag. A release checked from a commit it never tagged
 * (21c rc116) is no git ref, and its name answered 404 (root 2026-10-25: "The code at rc116 is unavailable").
 */
function before(m: Model, release: { release: string }) {
  return m.releases.slice(0, m.releases.findIndex((r) => r.release === release.release)).reverse().find((r) => r.tagged)?.release ?? null
}

/**
 * The run's tokens and list cost: the host's whole-run usage (every store on its host, attributed or not), the figure /play
 * prints (REVIEW-5 #1); else summed over the agents with a usage source; null when none has one (never a zero).
 */
function runUsage(m: Model) {
  const whole = (m.data as { runUsage?: Usage | null }).runUsage
  if (whole) return { tokens: whole.tokens, listUsd: whole.listUsd, complete: whole.listComplete }
  const usage = m.nodes.map((n) => n.usage).filter((u): u is Usage => Boolean(u))
  const sum = (pick: (u: Usage) => number | null) => (usage.some((u) => pick(u) != null) ? usage.reduce((a, u) => a + (pick(u) ?? 0), 0) : null)
  return { tokens: sum((u) => u.tokens), listUsd: sum((u) => u.listUsd), complete: usage.length === m.nodes.length && usage.every((u) => u.listComplete) }
}

/** The run's numbers as one row of large numerals above the timeline (review 4 #4); agents, shipped and failed are the trace's legend. */
function Stats({ m, spend }: { m: Model; spend: { apiEquivalentUsd?: number | null; apiEquivalentProvenance?: string | null } | null | undefined }) {
  // The host's one figure (journals.api_equivalent), the one /play and /plays print; never a sum of this page's own (index 02:45Z).
  const listUsd = spend?.apiEquivalentUsd ?? null
  const how = spend?.apiEquivalentProvenance ?? ''
  const stats: [string, string, string?][] = [
    ['Duration', duration(m.t1 - m.t0)],
    ...(listUsd != null ? [['Cost', `${how.endsWith('at least') ? '≥' : '≈'}${money(listUsd)}`, `API-equivalent at list price, ${how || 'source not recorded'}`] as [string, string, string]] : []),
  ]
  return <dl className="rj-stats">{stats.map(([label, value, title]) => <div key={label} title={title}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

/** `what` names the text for a screen reader ("full goal"), so each "full" button says what it opens (root 2026-10-25). */
function Full({ short, raw, what }: { short: string; raw: string; what: string }) {
  // A button, not <details>: Chrome lays a <details> out as a block, which left "full" alone on its own line (review 3 #8).
  const [open, setOpen] = useState(false)
  if (short === raw.trim()) return <>{short}</>
  return (
    <span className="rj-full">
      {open ? <span className="rj-full-text">{raw}</span> : short} <button type="button" className="rj-full-toggle" aria-expanded={open} aria-label={`${open ? 'Show less of' : 'Show full'} ${what}`} onClick={() => setOpen(!open)}>{open ? 'less' : 'full'}</button>
    </span>
  )
}

/** The opening prompt as text, shown (root 02:33Z); a long one shows its first sentence with the rest one toggle away. */
function Prompt({ text }: { text: string }) {
  return <p className="rj-prompt"><b>Opening prompt</b> <Full what="opening prompt" short={firstSentence(text)} raw={text} /></p>
}

/** Q6: the picked agent's summary, what it changed (code first, artefacts folded), then its transcript. */
/** The agent as recorded: role, harness and model; a value the record lacks is left out, never guessed. */
const who = (node: Node) => [node.role ?? node.label, node.harness, node.model?.split('/').pop()].filter(Boolean).join(' · ')

/**
 * The agent's place in the run: the agent that spawned it (the workspace's spawn edge); null for the root. A spawn is a
 * relationship, not proof of who sent a message: each message's own sender shows on it in the conversation.
 */
function spawnedBy(m: Model, node: Node) {
  const edge = m.data.edges.find((e) => e.kind === 'spawn' && e.to === node.id)
  const parent = edge ? m.nodes.find((n) => n.id === edge.from) : null
  if (parent) return `${parent.role ?? parent.label} (${parent.label})`
  // The id path names the parent when the journal's edge is missing: run:s6 is the root's child (lead 2026-10-25 10:00Z).
  const prefix = node.id.includes(':') ? node.id.slice(0, node.id.lastIndexOf(':')) : null
  const byPath = prefix ? m.nodes.find((n) => n.id === prefix) : null
  if (byPath) return `${byPath.role ?? byPath.label} (${byPath.label})`
  return node.id === m.root ? null : 'not in the spawn journal'
}

/**
 * Who asked whom what, on the landing (root 10478, 23:10Z): the run's recorded input is submission provenance: the
 * prompt the root was given and the goal it carries, with the file and hash it came from; a value the input lacks is said to be missing, never filled.
 */
/** A text's first sentence, whole; a run-on longer than 40 words is cut to 30. */
const firstSentence = (text: string) => {
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text
  return first.split(/\s+/).length <= 40 ? first : plainSummary(first, 30)
}

function Trigger({ doc, m }: { doc: RunDocument; m: Model }) {
  const input = doc.input
  const root = m.nodes.find((n) => n.id === m.root) ?? m.nodes[0]
  if (!input) return null
  const ran = root && [root.harness, root.model].filter(Boolean).join(' · ')
  return (
    <div className="rj-trigger">
      {/* The goal's whole first sentence: a 14-word cut ended at "retain the…" and dropped the teardown this smoke is about
          (root 2026-10-25 15:44Z). */}
      {input.objective && <p><Full what="goal" short={firstSentence(goalText(input.objective))} raw={goalText(input.objective)} /></p>}
      {/* What ran it, as recorded; who started it is printed only once the run input records it (audit F6). */}
      {ran && <p className="rj-muted">Run on {ran}</p>}
      {input.instruction && <Prompt text={input.instruction} />}
    </div>
  )
}

function Drill({ m, node, transcript, onPick, onOpen }: { m: Model; node: Node; transcript: (node: string, select: (node: string) => void) => ReactNode; onPick: (id: string) => void; onOpen: (release: string, path: string) => void }) {
  const landed = m.releases.filter((r) => r.files?.[node.id]?.length)
  const changes = new Map<string, Release>()
  for (const r of landed) for (const path of r.files![node.id]!) changes.set(path, r)
  const paths = [...changes.keys()]
  const code = paths.filter((p) => !ARTEFACT.test(p))
  const artefacts = paths.filter((p) => ARTEFACT.test(p))
  const role = node.role ?? node.label
  const single = m.nodes.length === 1
  return (
    <section className="rj-drill" aria-label={`${role}: what it did`}>
      {!single && <h2>{role}</h2>}
      {!single && <dl className="rj-summary">
        <dt>Who</dt><dd>{who(node)}</dd>
        {spawnedBy(m, node) && <><dt>Spawned by</dt><dd>{spawnedBy(m, node)}</dd></>}
        <dt>Task</dt><dd>{node.assignment ? <Full what="task" short={plainSummary(node.assignment)} raw={node.assignment} /> : 'not recorded'}</dd>
        <dt>Result</dt><dd>{failed(node) ? 'Failed. ' : ''}{node.turn ? <Full what="result" short={plainSummary(node.turn)} raw={node.turn} /> : node.status === 'running' ? `Running${node.lastAt ? `, last output ${ago(node.lastAt)}` : ''}; no turn has finished yet` : 'its last turn wrote no text'}</dd>
        <dt>Cost</dt><dd title={costText(node.usage).title}>{costText(node.usage).text}</dd>
        {/* Its files open in the code frame below, not as a list here (Drew 2026-10-25: "neglected ... nonsense" at the page's foot). */}
        {m.attributed && <><dt>Changed</dt><dd>{paths.length ? <button type="button" className="rj-full-toggle" onClick={() => onOpen(changes.get(code[0] ?? paths[0]!)!.release, code[0] ?? paths[0]!)}>{`${code.length} code ${code.length === 1 ? 'file' : 'files'}${artefacts.length ? `, ${artefacts.length} logs and outputs` : ''}, in ${landed.map((r) => r.release).join(', ')}`}</button> : node.status === 'running' ? (node.hasCode ? 'work on its branch, not yet in a release' : 'nothing committed yet') : 'nothing that landed in a release'}</dd></>}
      </dl>}
      <details className="rj-transcript">
        <summary>Transcript</summary>
        {transcript(node.id, onPick)}
      </details>
    </section>
  )
}

export function RunJourney({ api, doc, transcript }: { api: string; doc: RunDocument; transcript: (node: string, select: (node: string) => void) => ReactNode }) {
  const { runUrl, model: m, error } = useJourney(api, doc)
  const [chosen, setPicked] = useState<string | null>(null)
  // A one-agent run opens on its only agent: nobody should have to select it to learn what it did.
  const picked = chosen ?? (m?.nodes.length === 1 ? m.nodes[0]!.id : null)
  const view = doc.view
  const lifecycle = (view as { lifecycle?: Lifecycle | null } | null | undefined)?.lifecycle ?? null
  const single = m?.nodes.length === 1
  // The release the code pane shows: the one a release chip picked (`codeRef`), else the best (review 1 #13).
  const [params, update] = useSearch()
  const shown = m ? (m.releases.find((r) => r.release === params.get('codeRef')) ?? m.best) : null
  const openRelease = (release: string) => {
    update({ codeRef: release, fileSource: 'code', codeFile: null, codeView: null })
    document.querySelector('.rj-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // The work: one files pane for the best release's code or the retained artifacts (the answer opens first).
  const work = m && (
    <section className="rj-work" aria-label="The work">
      <RunFilesPane api={api} doc={doc}
        codeUnavailable={!m.data.code.available ? (m.data.code.reason ?? 'not available on this host') : !m.best ? 'no release was checked, so there is no release code to show' : null}
        code={shown && <CodePane key={shown.release} runUrl={runUrl} refName={shown.release} previous={before(m, shown)} label={`Release ${shown.release}`} />} />
    </section>
  )
  const node = m?.nodes.find((n) => n.id === picked) ?? null
  const goalLine = doc.input?.objective ? firstSentence(goalText(doc.input.objective)) : undefined
  return (
    <section className="rj" data-run-journey>
      <header className="rj-head">
        <a className="rj-crumb" href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a>
        <div className="rj-title">
          <h1 title={m ? `${hours(m.t0, m.t1).toFixed(1)} h` : undefined}>Run {shortRun(doc.run.play, doc.run.id)}</h1>
          {/* The goal includes its own teardown: an unconfirmed cleanup is the run's state, said once with its counts and
              receipt records (root 23:24Z); the check's verdict then sits on the hero line. */}
          {lifecycle && lifecycle.state !== 'done' ? <span className="rj-life" title={`${goalLine ? `${goalLine}\n` : ''}${lifecycle.sentence} ${lifecycle.resources?.map((r) => `${r.id}: removal ${r.removal ?? 'unrecorded'}`).join('; ') ?? ''} · from RECEIPT.json${lifecycle.source ? ` (${lifecycle.source})` : ''}`}>{lifecycle.sentence.replace(/^Teardown not confirmed:\s*/, 'Teardown: ').split(';')[0]}</span> : view && <StatusPill status={viewChip(view.status)} title={goalLine} />}
          {/* Drew's layout (gate 1): one header row of name, pill and the run's numerals; the goal is the trace card's one line and
              the pill's tooltip, the prompt is in Details at the foot. A one-agent run has no trace, so it keeps them up. */}
          {m && !single && <Stats m={m} spend={doc.run.spend} />}
          {view && <AsOfStamp asOf={viewAsOf(view)} />}
        </div>
        {m && single && <Trigger doc={doc} m={m} />}
      </header>
      {!m ? <p className="rw-empty">{error ? `The run's agents are unavailable: ${error}` : 'Reading the run…'}</p> : (
        <>
          {/* How far the best release got and what holds it, first on every run (audit D5: 22a's sat in a closed Details). */}
          <Ladder doc={doc} m={m} onRelease={openRelease} />
          {single ? null : (
            <section aria-label="What the agents did">
              <Lanes m={m} live={m.data.live} cost={doc.run.spend?.apiEquivalentUsd ?? null} picked={chosen} onPick={setPicked} />
              <RunActivity doc={doc} />
            </section>
          )}
          {/* What it produced before how it got there: on a one-agent run the files come before its transcript and history, so the
              answer sits in a phone's first screen (root 2026-10-25 15:44Z: ANSWER at 761 px of 844, under a collapsed
              Transcript). With many agents the picked agent leads, then its files. */}
          {single && work}
          {node && <Drill m={m} node={node} transcript={transcript} onOpen={(release, path) => { update({ codeRef: release, fileSource: 'code', codeFile: path, codeView: 'diff' }); document.querySelector('.rj-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} onPick={setPicked} />}
          {!single && work}
          {!single && <details className="rj-details"><summary>Details</summary><Trigger doc={doc} m={m} /></details>}
        </>
      )}
    </section>
  )
}
