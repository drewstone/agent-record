import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { FlowMarker, FlowSpan, FlowTrace } from '@tangle-network/charts'
import { FlowWaterfall, Lines } from '@tangle-network/charts/react'
import type { RunDocument } from '../workspace-model.js'
import { AsOfStamp, Tip } from './AnswerStrip.js'
import { duration, money, StatusPill, tokens, useDocument } from './data.js'
import { releaseName, shortRun } from './play-standing.js'
import { CodePane, type RunWorkspaceDocument, type WorkspaceRelease } from './RunWorkspace.js'
import { viewAsOf, viewChip } from './view.js'
import { goalText, plainSummary, stepWord } from './plain-words.js'
import { RefDiff } from './ref-file.js'
import { RunFilesPane } from './RunFilesPane.js'
import { useSearch } from './navigation.js'

/**
 * The run page (journey spec Q5/Q6, the lead's 21:05Z pick): how close the best release is and what stops it (the step
 * ladder, one sentence, the action that clears the blocker), then what the agents did across the run's hours (the shared
 * agent timeline, releases as markers), then, for the agent picked, its summary, what it changed (code first) and its
 * transcript.
 */
/** An agent's usage as the host read it (tangle-tools agent_usage): its OpenCode store while it runs, else its record. */
type Usage = { billedUsd: number | null; listUsd: number | null; listComplete: boolean; calls: number | null; pricedCalls: number | null; tokens: number | null; at: string | null; source: string; matchedBy?: string | null; priceSource?: { repository?: string; commit?: string } | null; steps?: Step[] }
/** One stretch of an agent's time from its OpenCode store (epoch ms): a model call, a tool, or waiting between calls. */
type Step = { kind: 'model' | 'tool' | 'waiting'; startMs: number; endMs: number; failed: boolean }
type Node = RunWorkspaceDocument['nodes'][number] & { start?: string | null; end?: string | null; usage?: Usage | null }
type Release = WorkspaceRelease & { by?: Record<string, number>; files?: Record<string, string[]>; tagged?: boolean }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const hours = (a: number, b: number) => (b - a) / 3_600_000
const relTone = (r: Release) => (r.passed != null && r.total ? (r.passed === r.total ? 'pass' : r.passed / r.total >= 0.8 ? 'near' : 'fail') : 'none')
/** Run artefacts, not code: logs, bench outputs, proofs, generated JSON; folded under the code a reader came for. */
const ARTEFACT = /(\.(log|bin|out|csv|jsonl|json|txt)$|(^|\/)(logs?|run|runs|results?|benches|outputs?)\/|(^|\/)\.[^/]+$|_done$|launched$)/
/** An agent whose last words report a crash, or whose status is failed (v6-battery: "CRASH_timeout_2700s"). */
/** "4 m ago", "3 h ago" from now. */
const ago = (iso: string) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000); return m < 90 ? `${Math.round(m)} m ago` : `${Math.round(m / 60)} h ago` }
/**
 * Two numbers, always (lead 10:05Z): API-equivalent at list price and what the seat billed, with the tokens and how
 * complete the pricing is ("≥$4.12 list, 38 of 41 calls priced"). "—" only when the host has no source at all.
 */
function costText(u: Usage | null | undefined): { text: string; title: string } {
  if (!u) return { text: '—', title: 'No usage source: no OpenCode store on this host and no usage in the record' }
  const list = u.listUsd == null ? null : `${u.listComplete ? '≈' : '≥'}${money(u.listUsd)} list`
  const partial = !u.listComplete && u.calls ? `, ${u.pricedCalls ?? 0} of ${u.calls} calls priced` : ''
  const parts = [list && `${list}${partial}`, u.billedUsd != null && `${money(u.billedUsd)} billed`, u.tokens != null && `${tokens(u.tokens)} tokens`].filter(Boolean)
  const from = u.source === 'opencode store' ? `its OpenCode store${u.matchedBy ? ` (matched by ${u.matchedBy})` : ''}` : 'the run record'
  const price = u.priceSource?.repository ? `; list price from ${u.priceSource.repository} ${u.priceSource.commit?.slice(0, 8) ?? ''}` : ''
  return { text: parts.join(' · ') || '—', title: `Read from ${from}${u.at ? `, updated ${ago(u.at)}` : ''}${price}` }
}
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
    const releases = (data.releases as Release[]).map((r) => ({ ...r, tagged: Boolean(r.taggedAt), taggedAt: r.taggedAt ?? r.at ?? null })).filter((r) => r.taggedAt)
    const t0 = Math.min(...nodes.map((n) => ms(n.start)).filter(Number.isFinite))
    const t1 = Math.max(...nodes.map((n) => ms(n.end ?? n.lastAt)).filter(Number.isFinite), ...releases.map((r) => ms(r.taggedAt)))
    const best = releases.find((r) => r.release === data.best) ?? releases.at(-1) ?? null
    const commits = new Map<string, number>()
    for (const r of releases) for (const [id, n] of Object.entries(r.by ?? {})) commits.set(id, (commits.get(id) ?? 0) + n)
    const root = nodes.find((n) => n.role === 'root' || n.role === 'lead')?.id ?? doc.run.id
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


/** `said`: the line above names the failing step, so the blocker says only who acts (REVIEW-7 #6: 22a said it twice). */
function NextStep({ runId, blocker, paused, said = false }: { runId: string; blocker: Blocker; paused: boolean; said?: boolean }) {
  // While research is paused only Drew lifts it: point at Today's decision, never "nothing for you" beside it.
  const pause = paused && <p className="rj-next"><b>Research is paused; lifting it is your decision</b> <a href="/today">→ Today</a></p>
  if (blocker.owner === 'Drew' && blocker.kind === 'check-dispute' && blocker.dispute) {
    return (
      <p className="rj-next"><b>Your decision:</b> {blocker.action} <RulingButtons runId={runId} dispute={blocker.dispute} /></p>
    )
  }
  const why = blocker.why && !said ? `${blocker.why}; ` : ''
  return (
    <>
      {pause}
      <p className="rj-next">{!paused && <b>Nothing for you. </b>}<span className="rj-muted">{why}{blocker.owner ?? 'Its owner'} will {blocker.action?.charAt(0).toLowerCase()}{blocker.action?.slice(1)}.</span></p>
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
        {m.best ? <><b>{releaseName(m.best.release, m.data.lineage)}</b> · {m.open ? (m.open.state === 'fail' ? `failed the ${m.open.label}${m.best.checker ? ` under check ${m.best.checker}` : ''}` : `the ${m.open.label} has not run`) : doc.view?.status.key === 'solved-earlier' && m.best.checker ? `every step of check ${m.best.checker} passes` : 'every step passes'}</> : 'No release was checked.'}
      </p>
      {lifecycle && lifecycle.state !== 'done' && (
        <p className="rj-life-line">
          {/* The header pill names it; the line gives the counts, and the receipt's own records stay one toggle away
              (root 2026-10-25 08:42Z: resource ids and source reachable). */}
          <Full what="teardown record" short={lifecycle.sentence.replace(/^Teardown not confirmed:\s*/, '').replace(/^./, (c) => c.toUpperCase())}
            raw={`${lifecycle.sentence} ${lifecycle.resources?.map((r) => `${r.id}: removal ${r.removal ?? 'unrecorded'}`).join('; ') ?? ''} · from RECEIPT.json${lifecycle.source ? ` (${lifecycle.source})` : ''}`} />
        </p>
      )}
      {/* A settled run's blocker is history: only a live run, or one waiting on Drew, says who acts now (review 2 #3:
          21c's Oct 23 blocker contradicted the play's current one). */}
      {blocker?.action && (doc.execution?.alive || blocker.owner === 'Drew') && <NextStep runId={doc.run.id} blocker={blocker} paused={Boolean(doc.view?.paused)} said={Boolean(m.open)} />}
      {m.releases.length > 1 && <p className="rj-releases">
        {m.same
          ? `${m.releases[0]!.release}–${m.releases.at(-1)!.release}: all ${m.releases[0]!.passed}/${m.releases[0]!.total}`
          // A release with no tag recorded has no name the code reader resolves (21c rc116 opened a 404 pane): a label, not a
          // button. Its tooltip says what was recorded; whether its commit's code was kept is not known (root review of #179).
          : m.releases.map((r) => r.tagged
            ? <button type="button" key={r.release} className={`rj-mini rj-${relTone(r)}`} title={[releaseName(r.release, m.data.lineage), r.sentence].filter(Boolean).join('\n')} onClick={() => onRelease(r.release)}>{r.release} {r.passed}/{r.total}</button>
            // One plain sentence (REVIEW-7 #5: the check's raw text leaked into it and contradicted the count).
            : <Tip key={r.release} className={`rj-mini rj-${relTone(r)}`} text={`${r.release} passed ${r.passed ?? '?'} of ${r.total ?? '?'} steps. No release tag recorded; recorded commit ${r.commit ?? 'none'}.`}>{r.release} {r.passed}/{r.total}</Tip>)}
      </p>}
    </section>
  )
}

/**
 * Q5: one row per agent across the run's hours in the shared agent timeline (charts FlowWaterfall, agents view), which
 * sizes from its container, truncates long names at the end with the full name in the tooltip, and zooms. Each release
 * is a marker on the trace clock; opening a row picks that agent for the drill-down below.
 */
/**
 * Is the run working or idling (REVIEW-8 chart 3, Drew): agents working at each of the host's progress samples and
 * tokens per minute from the run's metered token series, on one time axis under the timeline.
 */
function Activity({ doc }: { doc: RunDocument }) {
  const working = (doc.progress?.samples ?? []).map((s): [number, number] => [Date.parse(s.at), s.working])
  const metered = ((doc as { lineage?: { series?: [string, number][] }[] }).lineage?.[0]?.series ?? []).map(([at, n]): [number, number] => [Date.parse(at), n])
  const rate = metered.slice(1).map(([t, n], i): [number, number] => [t, t > metered[i]![0] ? ((n - metered[i]![1]) * 60_000) / (t - metered[i]![0]) : 0])
  if (working.length < 2 && rate.length < 2) return null
  const axis = (t: number) => new Date(t).toISOString().slice(11, 16)
  return (
    <div className="rj-activity" aria-label="Agents working and tokens per minute">
      {working.length > 1 && <Lines rows={3} axis={axis} series={[{ name: 'agents working', color: 'var(--ar-accent, #8e59ff)', points: working }]} />}
      {rate.length > 1 && <Lines rows={3} axis={axis} format={(v) => tokens(v)} series={[{ name: 'tokens per minute', color: 'var(--ar-c-ok, #22c55e)', points: rate }]} />}
    </div>
  )
}

function Lanes({ m, live, onPick }: { m: Model; live: boolean; onPick: (id: string) => void }) {
  // The lane's color and the legend (charts 0.18.0 FlowSpan.outcome; review 2 #2): shipped, nothing shipped, crashed.
  // A live agent that has not shipped yet is Running, not "Nothing shipped" (review 4 #6: 7 live agents on 22a read as idle).
  const running = (n: Node) => live && !n.end && ['running', 'waiting'].includes(n.status)
  const tone = (n: Node): FlowSpan['outcome'] => (crashed(n) ? { tone: 'failed', label: 'Crashed' } : m.commits.get(n.id) ? { tone: 'ok', label: 'Shipped' } : running(n) ? { tone: 'warn', label: 'Running' } : n.id === m.root ? undefined : { tone: 'neutral', label: 'Nothing shipped' })
  const outcome = (n: Node) => {
    if (crashed(n)) return 'crashed'
    const commits = m.commits.get(n.id)
    if (!commits) return n.id === m.root ? null : running(n) ? 'running' : 'nothing shipped'
    const into = m.releases.filter((r) => r.by?.[n.id]).map((r) => r.release)
    // Short enough not to clip in the row (review 4 #2: 13 of 17 clipped); the harness is in the card.
    return `${commits} ${commits === 1 ? 'commit' : 'commits'}${into.length ? ` → ${into.length > 2 ? `${into[0]}…${into.at(-1)}` : into.join(', ')}` : ''}`
  }
  const trace = useMemo((): FlowTrace => {
    const parent = new Map(m.data.edges.filter((e) => e.kind === 'spawn').map((e) => [e.to, e.from]))
    const ids = new Set(m.nodes.map((n) => n.id))
    const spans: FlowSpan[] = m.nodes.filter((n) => Number.isFinite(ms(n.start))).map((n) => {
      const end = ms(n.end ?? n.lastAt)
      const from = parent.get(n.id)
      return {
        id: n.id, ...(from && ids.has(from) ? { parentId: from } : {}), kind: 'pipeline' as const,
        name: n.id === m.root ? 'lead' : n.role ?? n.label,
        // Its outcome first (review 2 #2: the tooltip said only "1 commits"): shipped into which releases, crashed, or idle.
        detail: outcome(n) ?? undefined,
        startMs: ms(n.start) - m.t0, endMs: Math.max(ms(n.start), Number.isFinite(end) ? end : ms(n.start)) - m.t0,
        status: running(n) ? 'running' as const : crashed(n) ? 'failed' as const : 'done' as const,
        ...(tone(n) ? { outcome: tone(n) } : {}),
        // The list-price cost the record measured so far (its nodeStats); absent stays absent, never a zero.
        ...(typeof n.usage?.listUsd === 'number' ? { costUsd: n.usage.listUsd } : typeof (n as { costUsd?: number | null }).costUsd === 'number' ? { costUsd: (n as { costUsd?: number }).costUsd } : {}),
        // The card's cells (charts 0.19.0 FlowSpan.facts): releases it shipped into and its commits.
        facts: [
          { label: 'Releases', value: m.releases.filter((r) => r.by?.[n.id]).map((r) => r.release).join(', ') || '—' },
          { label: 'Commits', value: String(m.commits.get(n.id) ?? 0) },
          ...(n.harness ? [{ label: 'Harness', value: n.harness }] : []),
          ...(n.model ? [{ label: 'Model', value: n.model.split('/').pop()! }] : []),
          ...(n.usage?.billedUsd != null ? [{ label: 'Billed', value: money(n.usage.billedUsd) }] : []),
          ...(n.usage?.tokens != null ? [{ label: 'Tokens', value: tokens(n.usage.tokens) }] : []),
        ],
      }
    })
    const { tokens: measured, listUsd } = runUsage(m)
    // Each agent's steps as its child spans, so its bar is drawn in thinking / tool / waiting / failed segments (review 4 #1).
    const steps: FlowSpan[] = m.nodes.flatMap((n) => (n.usage?.steps ?? []).map((step, i) => ({
      id: `${n.id}#${i}`, parentId: n.id, kind: step.kind, name: step.kind === 'model' ? 'thinking' : step.kind,
      startMs: step.startMs - m.t0, endMs: step.endMs - m.t0, status: step.failed ? 'failed' as const : 'done' as const,
    })))
    spans.push(...steps)
    return { spans, totalMs: m.t1 - m.t0, promptTokens: measured ?? 0, completionTokens: 0, toolCalls: 0, ...(listUsd != null ? { costUsd: listUsd, costBasis: 'list' as const } : {}) }
  }, [m, live])
  // Releases that moved the score, the best and the newest: 17c tagged 205 releases, and a line for each buried the rows.
  const marked = useMemo(() => m.releases.filter((r, i) => r === m.best || i === m.releases.length - 1 || r.passed !== m.releases[i - 1]?.passed), [m])
  const markers = useMemo((): FlowMarker[] => marked.map((r) => ({
    at: ms(r.taggedAt) - m.t0,
    label: `${r.release}${r.passed != null && r.total ? ` ${r.passed}/${r.total}` : ''}${r === m.best ? ' best' : ''}`,
    tone: relTone(r) === 'pass' ? 'ok' as const : relTone(r) === 'fail' ? 'failed' as const : 'neutral' as const,
  })), [m, marked])
  return <FlowWaterfall trace={trace} live={live} defaultView="agents" label="What the agents did" markers={markers} onSelect={(span) => { const id = span.kind === 'pipeline' ? span.id : span.parentId ?? span.id; if (id) onPick(id) }} />
}

/** A plain line, with the agent's own words behind "full" when the line shortened them. */
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

/** The run's numbers as one row of large numerals above the timeline (review 4 #4); an unmeasured value is left out. */
function Stats({ m }: { m: Model }) {
  const { listUsd, complete } = runUsage(m)
  // As the timeline's legend counts them: every agent that shipped, the lead included, and a crash counts as Crashed even
  // when it shipped first (REVIEW-6 #2: 21c read Shipped 14 + Crashed 2 + 2 others for 17 agents).
  const shipped = m.nodes.filter((n) => m.commits.get(n.id) && !crashed(n)).length
  const stats: [string, string, string?][] = [
    ['Duration', duration(m.t1 - m.t0)],
    ['Agents', String(m.nodes.length)],
    ...(listUsd != null ? [['Cost', `${complete ? '≈' : '≥'}${money(listUsd)}`, 'API-equivalent at list price; each agent\'s billed amount is in its card'] as [string, string, string]] : []),
    ...(m.attributed ? [['Shipped', String(shipped)] as [string, string]] : []),
    ['Crashed', String(m.nodes.filter(crashed).length)],
    ...(m.best ? [['Best', `${m.best.release}${m.best.passed != null && m.best.total ? ` ${m.best.passed}/${m.best.total}` : ''}`, releaseName(m.best.release, m.data.lineage)] as [string, string, string]] : []),
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

/**
 * The opening prompt as its own labelled disclosure: a "full" after the agent line read as dead (review 4 #11), and a lone
 * "prompt" after it as a stray word (REVIEW-5 #15).
 */
function Prompt({ text }: { text: string }) {
  return <details className="rj-prompt"><summary>Opening prompt</summary><p className="rj-full-text">{text}</p></details>
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
  // The id path names the parent when the journal's edge is missing: run:s6 is the root's child (lead 2026-10-25 10:00Z).
  const prefix = node.id.includes(':') ? node.id.slice(0, node.id.lastIndexOf(':')) : null
  const byPath = prefix ? m.nodes.find((n) => n.id === prefix) : null
  if (byPath) return `${byPath.id === m.root ? 'the lead' : byPath.role ?? byPath.label} (${byPath.label})`
  if (prefix && prefix === m.root) return 'the lead'
  return node.id === m.root ? 'the play press (the run was submitted from run-input.json)' : 'not in the spawn journal'
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
  if (!input) return <p className="rj-trigger rj-muted">What started this run was not recorded.</p>
  const source = input.source?.path?.split('/').pop()
  return (
    <div className="rj-trigger">
      {/* The goal's whole first sentence: a 14-word cut ended at "retain the…" and dropped the teardown this smoke is about
          (root 2026-10-25 15:44Z). */}
      {input.objective && <p><Full what="goal" short={firstSentence(goalText(input.objective))} raw={goalText(input.objective)} /></p>}
      {/* Who ran it is not who started it (root 2026-10-25): the input records no initiator, only the press's source file. */}
      <p className="rj-muted">Run by {root ? who(root) : 'the root agent'} · <span title={source ? `submitted by the play press from ${source}${input.source?.sha256 ? ` (sha256 ${input.source.sha256})` : ''}` : undefined}>started by: not recorded</span></p>
      {input.instruction && <Prompt text={input.instruction} />}
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
  const prev = release ? before(m, release) : null
  const role = node.id === m.root ? 'lead' : node.role ?? node.label
  const single = m.nodes.length === 1
  return (
    <section className="rj-drill" aria-label={`${role}: what it did`}>
      {!single && <h2>{role}</h2>}
      {!single && <dl className="rj-summary">
        <dt>Who</dt><dd>{who(node)}</dd>
        <dt>Spawned by</dt><dd>{spawnedBy(m, node)}</dd>
        <dt>Task</dt><dd>{node.assignment ? <Full what="task" short={plainSummary(node.assignment)} raw={node.assignment} /> : 'not recorded'}</dd>
        <dt>Result</dt><dd>{crashed(node) ? 'Crashed. ' : ''}{node.turn ? <Full what="result" short={plainSummary(node.turn)} raw={node.turn} /> : node.status === 'running' ? `Running${node.lastAt ? `, last output ${ago(node.lastAt)}` : ''}; no turn has finished yet` : 'its last turn wrote no text'}</dd>
        <dt>Cost</dt><dd title={costText(node.usage).title}>{costText(node.usage).text}</dd>
        {m.attributed && <><dt>Changed</dt><dd>{paths.length ? `${code.length} code ${code.length === 1 ? 'file' : 'files'}${artefacts.length ? `, ${artefacts.length} logs and outputs` : ''}, in ${landed.map((r) => r.release).join(', ')}` : node.status === 'running' ? (node.hasCode ? 'work on its branch, not yet in a release' : 'nothing committed yet') : 'nothing that landed in a release'}</dd></>}
      </dl>}
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
  const receipt = doc.receipt
  return (
    <section className="rj" data-run-journey>
      <header className="rj-head">
        <a className="rj-crumb" href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a>
        <div className="rj-title">
          <h1 title={m ? `${hours(m.t0, m.t1).toFixed(1)} h` : undefined}>Run {shortRun(doc.run.play, doc.run.id)}</h1>
          {view && <StatusPill status={viewChip(view.status)} />}
          {/* The check's verdict is not the requested lifecycle: a disposable run says whether its teardown is confirmed
              (root 2026-10-25; the host's run_view lifecycle, from the receipt's retention records). */}
          {lifecycle && lifecycle.state !== 'done' && <span className="rj-life" title={lifecycle.sentence}>Teardown not confirmed</span>}
          {view && <AsOfStamp asOf={viewAsOf(view)} />}
        </div>
        {m && <Trigger doc={doc} m={m} />}
      </header>
      {!m ? <p className="rw-empty">{error ? `The run's agents are unavailable: ${error}` : 'Reading the run…'}</p> : (
        <>
          <Ladder doc={doc} m={m} onRelease={openRelease} />
          {single ? null : (
            <section aria-label="What the agents did">
              <Stats m={m} />
              <Lanes m={m} live={Boolean(doc.execution?.alive)} onPick={setPicked} />
              <Activity doc={doc} />
            </section>
          )}
          {/* What it produced before how it got there: on a one-agent run the files come before its transcript and history, so the
              answer sits in a phone's first screen (root 2026-10-25 15:44Z: ANSWER at 761 px of 844, under a collapsed
              Transcript). With many agents the picked agent leads, then its files. */}
          {single && work}
          {node && <Drill runUrl={runUrl} m={m} node={node} transcript={transcript} onPick={setPicked} />}
          {!single && work}
          {receipt && <footer className="rj-foot"><a href={`/run/${encodeURIComponent(doc.run.id)}/receipt/`}>Published receipt</a></footer>}
        </>
      )}
    </section>
  )
}
