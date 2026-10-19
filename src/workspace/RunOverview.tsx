import { useState } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FigureView, HBars, Meter } from '@tangle-network/charts/react'
import { OUTCOME_ORDER, type TickOutcome, timeline, timeSeries } from '@tangle-network/charts'
import type { RecordNode } from '../record.js'
import type { RunDocument, RunProgress } from '../workspace.js'
import type { NodeStats } from './RunTable.js'
import type { ContractDelivery, RunReceipt, ScorePoint } from './run-receipt.js'
import { hoursText, tokensText, utcClock } from './run-receipt.js'

export type OpenView = (section: string, patch?: Record<string, string | undefined>) => void
const recorded = (value: unknown) => value !== null && value !== undefined && value !== ''

/** All measures and decisions belong to the Lab document. This component only formats them. */
export function RunOverview({ api, doc, open, print = false }: { api: string; doc: RunDocument; nodes?: RecordNode[] | null; stats?: Record<string, NodeStats>; open?: OpenView; print?: boolean }) {
  const r = doc.receipt
  if (!r?.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p className="rr-muted">No receipt recorded yet.</p></section>
  const settled = doc.progress ? doc.progress.final || doc.progress.phase === 'settled' : false
  return <RunReceiptView api={api} receipt={r} print={print} open={open} outcome={doc.progress?.outcome ?? null} settled={settled} billing={doc.run?.spend?.billing ?? null} />
}

/**
 * The outcome a receipt's own check states, for a page that has no progress document (the print view, B5): the check's
 * verdict, when and on which version it ran, and its output's first NOT SOLVED line.
 */
export function outcomeOfCheck(r: RunReceipt): Outcome | null {
  const check = r.check
  if (!check || check.passed === null || !check.known) return null
  const output = check.output ?? ''
  const failing = check.passed ? null : (output.split('\n').map((line) => line.trim()).find((line) => /^NOT SOLVED/.test(line)) ?? output.split('\n').find((line) => line.trim()) ?? null)
  return { solved: check.passed, checkedAt: check.at, firstFailingLine: failing, stage: null, tag: check.tag, lastStreamAt: null, minutesSinceLastStream: null }
}

type Outcome = NonNullable<RunProgress['outcome']>
const shortTag = (tag: string | null | undefined) => tag?.split('/').pop() ?? null
const clock = (at: string) => `${at.slice(11, 16)} UTC`
const shortAgent = (id: string | null, runId: string) => id === null ? 'agent' : id === runId ? 'root' : id.startsWith(`${runId}:`) ? id.slice(runId.length + 1) : id
const checkerOf = (point: ScorePoint) => typeof point.checker === 'string' ? point.checker : point.checker?.sha256 ?? null

/**
 * Where the run's passes stand when the current check does not pass (R1, R3): the version that passed, under which
 * checker and how often, from the Lab's per-checker score rows; else the time the check first passed. Null while the
 * current check passes or nothing ever passed.
 */
function earlierPasses(r: RunReceipt, outcome: Outcome | null) {
  if (outcome?.solved !== false) return null
  const passes = (r.system?.play?.scores ?? []).filter((point) => point.solved)
  const last = passes.at(-1)
  if (last) {
    const same = passes.filter((point) => point.tag === last.tag && checkerOf(point) === checkerOf(last))
    const checker = checkerOf(last)
    return `Nothing passes the current check; ${shortTag(last.tag) ?? last.commit?.slice(0, 8) ?? 'a version'} passed${checker ? ` under checker ${checker.slice(0, 8)}` : ''} ${same.length}×, ${clock(same[0]!.at)}${same.length > 1 ? `–${clock(last.at)}` : ''}`
  }
  const first = r.system?.play?.firstPassAt
  return first ? `Nothing passes the current check; the check first passed at ${clock(first)}` : null
}

const RESOLVED: Record<string, string> = { passed: 'the check passed', released: 'its public stages passed and the tag was published', moved: 'a later stage failed instead' }

type Dispute = NonNullable<Outcome['disputes']>[number]

/** A dispute's state as the Lab recorded it: open with the referee's attempts, awaiting the operator, or ruled. */
function disputeState(d: Dispute) {
  if (d.state === 'open') return `Open: the referee outside the run is ruling${d.attempts ? ` (${d.attempts} attempt${d.attempts === 1 ? '' : 's'} so far)` : ''}`
  if (d.state === 'operator') return 'Awaiting an operator ruling: the referee could not decide'
  if (d.state === 'upheld') return `Upheld by the ${d.by ?? 'referee'}${d.ruledAt ? ` at ${clock(d.ruledAt)}` : ''}: the check is amended for this run`
  if (d.state === 'rejected') return `Rejected by the ${d.by ?? 'referee'}${d.ruledAt ? ` at ${clock(d.ruledAt)}` : ''}: the line stands`
  return 'State not recorded'
}

function contractState(d: ContractDelivery) {
  if (d.resolvedAt === null) return d.lastFailingAt === null ? 'not checked again yet' : `still failing at ${clock(d.lastFailingAt)}`
  return `${RESOLVED[d.resolution ?? ''] ?? 'resolved'} at ${clock(d.resolvedAt)}`
}

/**
 * What the run is doing now, before anything else: the outcome its progress document states first (the verdict and the
 * first failing line), the play check's dense score over versions, and each contract line sent to the fleet with its
 * acknowledgements and the commit that fixed it. Every value is the Lab's; this only lays them out.
 */
/** The outside goal audit of the passing check (discovery-lab runner/goal-audit.mjs), as the Now line words it. */
const GOAL_AUDIT = { consistent: 'goal audit consistent', contradiction: 'goal audit found a contradiction', unaudited: 'goal audit not ruled yet' } as const

/**
 * The run's check progress over time, one series per checker so an amended check's first low score never reads as the
 * work regressing: each checker is named by the ruling that made it (the Lab's `play.rulings`), the y axis by the
 * check's own stage names, and the figure is drawn at its panel's width.
 */
function stageFigure(r: RunReceipt, scores: ScorePoint[], contract: ContractDelivery[], width: number) {
  const digestOf = (point: ScorePoint) => (typeof point.checker === 'string' ? point.checker : (point.checker?.sha256 ?? null))
  const rulings = (((r.system?.play as { rulings?: unknown } | null | undefined)?.rulings ?? []) as Array<{ at?: string; by?: string; verdict?: string; newDigest?: string | null }>).filter((item) => item.verdict === 'upheld' && item.newDigest)
  const order: string[] = []
  for (const point of [...scores].sort((a, b) => a.at.localeCompare(b.at))) {
    const digest = digestOf(point) ?? 'unrecorded'
    if (!order.includes(digest)) order.push(digest)
  }
  const nameOf = (digest: string, index: number) => {
    const ruling = rulings.find((item) => item.newDigest && digest.startsWith(item.newDigest.slice(0, 8)))
    return ruling ? `after the ${ruling.by ?? ''} ruling ${ruling.at ? clock(ruling.at) : ''}`.replace(/\s+/g, ' ').trim() : index === 0 ? 'check as pressed' : `checker ${index + 1}`
  }
  const stages = new Map<number, string>()
  for (const point of scores) {
    const of = point.score?.of
    if (of && point.score?.stage && point.score.reached) stages.set(Math.round(((point.score.reached - 1) / of) * 1000) / 1000, point.score.stage)
  }
  const ticks = [...stages.entries()].sort((a, b) => a[0] - b[0]).map(([at, label]) => ({ at, label }))
  const rows = order.map((digest, index) => ({
    id: `checker-${index}`,
    label: nameOf(digest, index),
    colorIndex: order.length - 1 - index,
    points: scores
      .filter((point) => (digestOf(point) ?? 'unrecorded') === digest)
      // A row recorded n times sits at its first time: the first time that checker scored that release.
      .map((point) => ({ x: Date.parse(typeof point.firstAt === 'string' ? point.firstAt : point.at), y: point.solved ? 1 : point.progress!, ...(point.tag ? { label: shortTag(point.tag) ?? undefined } : {}) }))
      .sort((a, b) => a.x - b.x)
      .filter((point, i, list) => i === 0 || point.x > list[i - 1]!.x),
  })).filter((row) => row.points.length)
  const times = rows.flatMap((row) => row.points.map((point) => point.x))
  const [first, last] = [Math.min(...times), Math.max(...times)]
  const stageAt = (value: number) => (value >= 1 ? 'solved' : ([...ticks].reverse().find((tick) => tick.at <= value + 1e-9)?.label ?? `${Math.round(value * 100)}%`))
  return timeSeries(rows, {
    id: `stage-${r.runId}`,
    x: { label: 'UTC', domain: first === last ? [first - 60_000, last + 60_000] : [first, last] },
    y: { label: 'Check progress', unit: '', domain: [0, 1], ...(ticks.length ? { ticks: [...ticks, { at: 1, label: 'SOLVED' }] } : {}) },
    formatX: (at) => new Date(at).toISOString().slice(11, 16),
    formatY: stageAt,
    marks: contract.map((d) => ({ at: Date.parse(d.at), label: `line sent on ${shortTag(d.tag) ?? '?'}`, kind: 'event' as const })).filter((mark) => mark.at >= first && mark.at <= last),
    width,
  })
}

function RunNow({ receipt: r, outcome, settled }: { receipt: RunReceipt; outcome: Outcome | null; settled: boolean }) {
  const scores = (r.system?.play?.scores ?? []).filter((point) => typeof point.progress === 'number' || point.solved)
  const contract = r.contract ?? []
  const disputes = outcome?.disputes ?? []
  if (!outcome && scores.length === 0 && contract.length === 0) return null
  const figure = scores.length === 0 ? null : (width: number) => stageFigure(r, scores, contract, width)
  const verdict = outcome?.solvedLabel ?? (outcome?.solved === true ? 'Check passed' : outcome?.solved === false ? 'Check not passing' : 'No check verdict yet')
  const audit = outcome?.goalAudit ?? null
  const tone = audit?.verdict === 'unaudited' ? 'unaudited' : outcome?.solved === true ? 'passed' : outcome?.solved === false ? 'failing' : 'unknown'
  const passes = earlierPasses(r, outcome)
  return <section className="rr-now" aria-labelledby="rr-now-title" data-section="now">
    <h2 id="rr-now-title">Now</h2>
    {outcome && <p className={`rr-now-verdict rr-now-${tone}`} data-field="progress.outcome.solved">
      <strong data-field="progress.outcome.solvedLabel">{verdict}</strong>
      {outcome.checkedAt && <span> · checked {clock(outcome.checkedAt)}{outcome.tag && <> on <code>{shortTag(outcome.tag)}</code></>}</span>}
      {audit?.verdict && <span data-field="progress.outcome.goalAudit"> · {GOAL_AUDIT[audit.verdict]}{audit.at && ` ${audit.verdict === 'unaudited' ? 'last tried' : 'at'} ${clock(audit.at)}`}</span>}
      {/* A settled run's last stream is a time, not an age that froze when its progress was last written (B6). */}
      {settled ? outcome.lastStreamAt && <span data-field="progress.outcome.lastStreamAt"> · last agent stream {clock(outcome.lastStreamAt)}</span>
        : outcome.minutesSinceLastStream !== null && <span data-field="progress.outcome.minutesSinceLastStream"> · last agent stream {outcome.minutesSinceLastStream} min ago</span>}
    </p>}
    {passes && <p className="rr-now-passes" data-field="system.play.firstPassAt">{passes}</p>}
    {outcome?.checkWait && <p className="rr-now-wait" data-field="progress.outcome.checkWait">
      <strong>{shortTag(outcome.checkWait.tag) ?? 'The newest version'} is not checked yet</strong>
      {outcome.checkWait.publishedAt && <span> · published {clock(outcome.checkWait.publishedAt)}</span>}
      {outcome.checkWait.reason && <span> · {outcome.checkWait.reason}{outcome.checkWait.since && ` (since ${clock(outcome.checkWait.since)})`}</span>}
    </p>}
    {outcome?.firstFailingLine && <><p className="rr-muted">First failing line{outcome.stage ? ` (${outcome.stage} stage)` : ''}</p><pre className="rr-output" data-field="progress.outcome.firstFailingLine">{outcome.firstFailingLine}</pre></>}
    {disputes.length > 0 && <><h3>Check disputes</h3><ol className="rr-contract" data-field="progress.outcome.disputes">{disputes.map((d, i) =>
      <li key={d.id ?? i} data-field={`progress.outcome.disputes.${i}`}>
        <code className="rr-contract-line">{d.line ?? '?'}</code>
        <span>Disputed {d.at ? clock(d.at) : 'at an unrecorded time'}{d.id && <> as <code>{d.id}</code></>}</span>
        <span data-field={`progress.outcome.disputes.${i}.state`}>{disputeState(d)}</span>
      </li>)}</ol></>}
    {figure && <div className="rr-chart" data-field="system.play.scores"><FigureView figure={figure} /></div>}
    {contract.length > 0 && <><h3>Contract lines sent</h3><ol className="rr-contract" data-field="contract">{contract.map((d, i) => {
      const acks = d.acknowledgements ?? []
      return <li key={`${d.at}-${i}`} data-field={`contract.${i}`}>
        <code className="rr-contract-line">{d.line}</code>
        <span>Sent {clock(d.at)} on <code>{shortTag(d.tag) ?? d.commit?.slice(0, 8) ?? '?'}</code> to {d.targets.length === 1 ? 'the root' : `${d.targets.length} agents`}</span>
        <span data-field={`contract.${i}.acknowledgements`}>Acknowledged: {acks.length === 0 ? 'none recorded' : acks.map((ack) => `${shortAgent(ack.worker, r.runId)} ${ack.effect}`).join(', ')}</span>
        <span data-field={`contract.${i}.fixCommit`}>{d.fixCommit ? <>Fixed in <code>{d.fixCommit.slice(0, 8)}</code>{d.resolvedOn && shortTag(d.resolvedOn) !== d.fixCommit ? <> (<code>{shortTag(d.resolvedOn)}</code>)</> : null}: </> : null}{contractState(d)}</span>
      </li>
    })}</ol></>}
  </section>
}

function Field({ path, value, format = String, suffix = '', children }: { path: string; value: string | number | null | undefined; format?: (value: never) => string; suffix?: string; children?: ReactNode }) {
  if (!recorded(value)) return null
  return <span data-field={path} data-value={value}>{children ?? format(value as never)}{suffix}</span>
}

function Fact({ label, when, children }: { label: string; when: boolean; children: ReactNode }) {
  return when ? <><dt>{label}</dt><dd>{children}</dd></> : null
}

function Measures({ values }: { values: Array<{ path: string; value: number | null; format?: (value: never) => string; suffix?: string }> }) {
  return values.filter(({ value }) => recorded(value)).map((field, i) => <span key={field.path}>{i > 0 && ', '}<Field {...field} /></span>)
}

function Drawer({ title, print, children }: { title: string; print: boolean; children: ReactNode }) {
  return <details className="rr-drawer" open={print || undefined}><summary>{title}</summary><div className="rr-drawer-body">{children}</div></details>
}

function Copy({ text }: { text: string }) {
  const [state, setState] = useState('Copy command')
  return <button type="button" className="rr-copy" onClick={() => { void navigator.clipboard.writeText(text).then(() => setState('Copied'), () => setState('Copy failed')) }} aria-live="polite">{state}</button>
}

/** Whether any profile's expectation was met or violated; with none, the reading is one line (X1). */
const behaviorMeasured = (reading: NonNullable<RunReceipt['behaviorExpectations']>) =>
  reading.profiles.some((profile) => profile.verdict !== 'unknown' || profile.nodes.some((node) => node.dimensions.some((dimension) => dimension.verdict !== 'unknown')))

/** The unmeasured reading in one line: how many profiles declare no expectations, and why the rest are unknown. */
function behaviorLine(reading: NonNullable<RunReceipt['behaviorExpectations']>) {
  const declaresNone = reading.profiles.filter((profile) => profile.nodes.every((node) => node.dimensions.length === 0)).length
  const rest = reading.profiles.filter((profile) => profile.nodes.some((node) => node.dimensions.length > 0))
  const reasons = [...new Set(rest.flatMap((profile) => profile.nodes.flatMap((node) => node.dimensions.map((dimension) => dimension.reason ?? 'not measured'))))]
  return [declaresNone && `${declaresNone} of ${reading.profiles.length} profiles declare no expectations`,
    rest.length && `${rest.map((profile) => profile.name ?? 'a profile').join(', ')}: ${reasons.slice(0, 2).join('; ')}`].filter(Boolean).join('; ')
}

function ProfileBehavior({ reading, print }: { reading: NonNullable<RunReceipt['behaviorExpectations']>; print: boolean }) {
  if (!behaviorMeasured(reading)) return <p className="rr-muted rr-behavior-line" data-field="behaviorExpectations">Profile behavior (advisory): nothing met or violated. {behaviorLine(reading) || 'No profile behavior is recorded'}.</p>
  return <section className="rr-behavior" aria-labelledby="rr-behavior-title" data-field="behaviorExpectations">
    <h2 id="rr-behavior-title">Profile behavior · <span data-field="behaviorExpectations.verdict">{reading.verdict}</span></h2>
    <p className="rr-muted">Advisory: {reading.basis}.</p>
    {reading.profiles.length === 0 && <p>No profile behavior is recorded.</p>}
    {reading.profiles.map((profile, i) => <details className="rr-profile" key={profile.digest ?? i} open={print || profile.verdict === 'violated' || undefined}>
      <summary><span>{profile.name ?? 'Unknown profile'}</span><strong data-field={`behaviorExpectations.profiles.${i}.verdict`}>{profile.verdict}</strong><code>{profile.digest?.slice(7, 19) ?? 'unknown version'}</code></summary>
      <div className="rr-profile-body">
        {profile.digest && <p className="rr-muted">Profile version <code>{profile.digest}</code></p>}
        {profile.nodes.map((node) => <div key={node.nodeId} className="rr-behavior-node">
          <h3><code>{node.nodeId}</code> · {node.verdict}</h3>
          {node.reason && <p className="rr-muted">{node.reason}</p>}
          {node.dimensions.map((dimension) => <div className="rr-expectation" key={dimension.dimension} data-dimension={dimension.dimension}>
            <p><strong>{dimension.dimension} · {dimension.verdict}</strong>{dimension.interpretation && <> · {dimension.interpretation}</>}</p>
            <dl className="rr-facts"><dt>Observed candidates</dt><dd>{dimension.count ?? 'unknown'} over {dimension.observed} observed events</dd><dt>Expected</dt><dd><code>{typeof dimension.expected === 'string' ? dimension.expected : `${dimension.expected.min}–${dimension.expected.max}`}</code></dd></dl>
            {dimension.reason && <p className="rr-muted">{dimension.reason}</p>}
            {dimension.verdict === 'violated' && <div className="rr-behavior-evidence"><strong>Evidence spans</strong>{dimension.evidence.length ? <ul>{dimension.evidence.map((item, j) => <li key={j}>
              {item.source ? <><code>{item.source.path}</code><span>bytes {item.source.offset}–{item.source.offset + item.source.bytes}</span><code>SHA-256 {item.source.lineSha256}</code></> : <span>Source span unavailable{item.eventId ? `; event ${item.eventId}` : ''}</span>}
            </li>)}</ul> : <p>No source span recorded.</p>}</div>}
          </div>)}
        </div>)}
      </div>
    </details>)}
  </section>
}

export function RunReceiptView({ api = '/api/discovery', receipt: r, print = false, open, outcome = null, settled = false, billing = null }: { api?: string; receipt: RunReceipt; print?: boolean; open?: OpenView; outcome?: Outcome | null; settled?: boolean; billing?: RunDocument['run']['spend']['billing'] }) {
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operation, setOperation] = useState<Record<string, string>>({})
  if (!r.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p className="rr-muted">No receipt recorded yet.</p></section>
  const hasRelease = Boolean(r.chosen.commit && r.chosen.tag && r.chosen.tag !== 'store')
  // A version is a choice only when a play check ran on its commit (R1): the Lab says so, else a check or a score names it.
  const checkedCommits = new Set([r.check?.commit, ...(r.system?.play?.scores ?? []).map((point) => point.commit)].filter(Boolean))
  const chosenChecked = r.chosen.checked ?? (r.chosen.commit ? checkedCommits.has(r.chosen.commit) : false)
  const unchecked = hasRelease && !chosenChecked ? `No play check ran on ${shortTag(r.chosen.tag)} (${r.chosen.commit!.slice(0, 8)}), so there is no checked version to act on.` : null
  const decisions = r.decisions.map((decision, i) => ({ ...decision, index: i, blocked: decision.id === 'rerun' ? null : unchecked })).filter((decision) =>
    decision.enabled && (decision.id === 'rerun' ? Boolean(r.check?.rerun) : hasRelease))
  const equivalent = r.cost.apiEquivalentUsd?.usd ?? null
  // What was billed: the receipt's reconciled total, else the host's reading of a seat-paid host placement ($0 per call).
  const billed = r.cost.billedUsd.total.usd ?? billing?.billedUsd ?? null
  const plan = r.cost.plan ?? (billing?.seat ? `${billing.seat} seat` : null)
  const quota = r.system?.attempts?.causes.find((cause) => cause.cause === 'rate-limited' && cause.tries > 0) ?? null
  const failures = (r.system?.attempts?.causes ?? []).filter((cause) => cause.cause !== 'completed' && cause.tries > 0)
  const workers = r.system?.workers ?? null
  const firstPassAt = r.system?.play?.firstPassAt ?? null
  const behavior = r.behaviorExpectations ?? r.system?.behaviorExpectations
  const fileBase = `${api}/runs/${encodeURIComponent(r.runId)}/receipt/${encodeURIComponent(r.tag)}`
  const decide = async (id: string) => {
    const operationId = operation[id] ?? crypto.randomUUID()
    setOperation((prior) => ({ ...prior, [id]: operationId }))
    setPending(id)
    setNotice(null)
    try {
      const response = await fetch(`${api}/runs/${encodeURIComponent(r.runId)}/decisions`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: id, tag: r.chosen.tag, commit: r.chosen.commit, operationId }) })
      const body = await response.json() as { error?: string; message?: string }
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
      setNotice(body.message ?? 'Recorded')
      setOperation((prior) => { const next = { ...prior }; delete next[id]; return next })
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed') }
    finally { setPending(null) }
  }
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
  // Each lane's recorded attempts draw as ticks in the shared outcome palette; an outcome the palette does not name is "other".
  const lanes = r.timeline.lanes.map(({ ticks, ...lane }) => ({
    ...lane,
    spans: lane.spans.map((span) => ({ ...span, start: Date.parse(span.start), end: span.end === null ? null : Date.parse(span.end), note: span.note ?? undefined })),
    ...(ticks?.length ? { ticks: ticks.filter((tick) => Number.isFinite(Date.parse(tick.at))).map((tick) => ({ at: Date.parse(tick.at), outcome: (OUTCOME_ORDER as readonly string[]).includes(tick.outcome) ? (tick.outcome as TickOutcome) : 'other', ...(tick.cause ? { note: tick.cause } : {}) })) } : {}),
  }))
  const marks = r.timeline.marks.map((mark) => ({ at: Date.parse(mark.t), label: mark.label, kind: mark.kind }))
  const figure = timeline(lanes, { measure: 'Recorded agent time', ...(r.timeline.end ? { now: Date.parse(r.timeline.end) } : {}), marks })
  const versionFigure = r.versions?.rows.length && r.versions.line.x ? timeSeries([{ id: 'exact', label: 'Exact checks passed', points: r.versions.rows.filter((row) => row.at).map((row) => ({ x: Date.parse(row.at!), y: row.exactPassed })) }], { x: { label: 'UTC', domain: r.versions.line.x }, y: { label: 'Exact checks passed', unit: 'checks', domain: r.versions.line.y }, formatX: (at) => new Date(at).toISOString().slice(11, 16), marks: r.versions.line.marks.map((mark) => ({ at: Date.parse(mark.t), label: mark.label, kind: mark.kind })) }) : null
  return <article className={`rr-page${print ? ' rr-print' : ''}`} data-overview data-receipt={r.runId}>
    <header className={`rr-verdict rr-${r.outcome.status}`}>
      <div className="rr-title-row"><h1 data-field="title" title={r.title}>{r.title}</h1><span className="rr-status" data-field="outcome.status">{r.outcome.status.replaceAll('-', ' ')}</span></div>
      <p data-field="outcome.sentence">{r.outcome.sentence}</p>
      <p className="rr-summary">{hasRelease && chosenChecked && <span>Chosen <Field path="chosen.tag" value={r.chosen.tag} /></span>}{recorded(equivalent) && <span title={r.cost.apiEquivalentUsd?.provenance ?? undefined}><Field path="cost.apiEquivalentUsd.usd" value={equivalent} format={money} /> API-equivalent</span>}{recorded(billed) && <span title={billing?.basis ?? undefined}><Field path="cost.billedUsd.total.usd" value={billed} format={money} /> billed{plan && <> ({plan})</>}</span>}{quota && <span data-field="system.attempts.causes">{quota.tries} quota hits</span>}{recorded(r.work.wallHours) && <span><Field path="work.wallHours" value={r.work.wallHours} format={hoursText} /> elapsed</span>}<a className="rr-download" href={`/run/${encodeURIComponent(r.runId)}/receipt/${encodeURIComponent(r.tag)}?download=1`} download>Download receipt</a></p>
      {behavior && behaviorMeasured(behavior) && <p className="rr-summary"><a href="#rr-behavior-title">Profile behavior: {behavior.verdict}</a><span>Advisory</span></p>}
    </header>
    <RunNow receipt={r} outcome={outcome} settled={settled} />
    <div className="rr-columns">
      <div className="rr-evidence">
        {r.files.length > 0 ? <section aria-labelledby="rr-files"><h2 id="rr-files">What you got</h2><ul className="rr-files">{r.files.map((file, i) => <li key={file.file}><a href={`${fileBase}/${encodeURIComponent(file.file)}`} data-field={`files.${i}.label`}>{file.label}</a><a href={`${fileBase}/${encodeURIComponent(file.file)}`} download aria-label={`Download ${file.file}`}>Download</a></li>)}</ul></section> : !hasRelease && <p className="rr-muted">No release recorded yet.</p>}
        {r.check && [r.check.output, r.check.tag, r.check.commit, r.check.at, r.check.rerun, r.check.checker.sha256, r.check.checker.path, r.check.inputs.sha256, r.check.inputs.source].some(recorded) ? <section aria-labelledby="rr-check"><h2 id="rr-check">The check</h2>
          {recorded(r.check.output) && <pre className="rr-output" data-field="check.output">{r.check.output}</pre>}<dl className="rr-facts">
            <Fact label="Ran on" when={[r.check.tag, r.check.commit].some(recorded)}><Field path="check.tag" value={r.check.tag} />{recorded(r.check.tag) && recorded(r.check.commit) && ' '}<code><Field path="check.commit" value={r.check.commit} /></code></Fact>
            <Fact label="At" when={recorded(r.check.at)}><Field path="check.at" value={r.check.at} format={utcClock} /></Fact>
            <Fact label="Inputs SHA-256" when={[r.check.inputs.sha256, r.check.inputs.source].some(recorded)}><code><Field path="check.inputs.sha256" value={r.check.inputs.sha256} /></code><span className="rr-muted"><Field path="check.inputs.source" value={r.check.inputs.source} /></span></Fact>
            <Fact label="Checker SHA-256" when={[r.check.checker.sha256, r.check.checker.path].some(recorded)}><code><Field path="check.checker.sha256" value={r.check.checker.sha256} /></code><span className="rr-muted"><Field path="check.checker.path" value={r.check.checker.path} /></span></Fact>
          </dl>{r.check.rerun && <div className="rr-rerun"><code data-field="check.rerun">{r.check.rerun}</code>{!print && <Copy text={r.check.rerun} />}</div>}</section> : null}
      </div>
      <aside>
        {decisions.length > 0 && <section aria-labelledby="rr-decide"><h2 id="rr-decide">Decide</h2><div className="rr-decisions">{decisions.map((decision) => <div key={decision.id}>
          {print ? <strong data-field={`decisions.${decision.index}.label`}>{decision.label}</strong> : <button type="button" className={decision.id === 'take' && !decision.blocked ? 'rr-primary' : ''} disabled={!decision.enabled || Boolean(decision.blocked) || pending !== null} onClick={() => { void decide(decision.id) }}>{pending === decision.id ? 'Saving…' : decision.label}</button>}
          {decision.blocked ? <p data-blocked={decision.id}>{decision.blocked}</p> : <p data-field={`decisions.${decision.index}.consequence`}>{decision.consequence}</p>}
          {decision.command && <details className="rr-command" open={print || undefined}><summary>Command</summary><code data-field={`decisions.${decision.index}.command`}>{decision.command}</code></details>}
        </div>)}</div>{notice && <p role="status">{notice}</p>}</section>}
        {[r.work.recordedHours, r.work.agentHours, r.work.idleHours, r.work.untracedHours, r.work.tokens.fresh, r.work.tokens.cached, r.work.tokens.total, ...Object.values(r.waste.afterPass), ...Object.values(r.waste.verdictDelay)].some(recorded) && <section aria-labelledby="rr-cost"><h2 id="rr-cost">Cost and waste</h2>
          {recorded(r.work.recordedHours) && <div className="rr-chart" data-field="work"><Meter total={r.work.recordedHours} segments={[{ label: 'Work', value: r.work.agentHours }, { label: 'Idle', value: r.work.idleHours }, { label: 'Untraced', value: r.work.untracedHours, kind: 'untraced' }]} format={hoursText} text="Recorded agent time" /></div>}
          <dl className="rr-facts rr-measures">
            <Fact label="Work" when={recorded(r.work.agentHours)}><Field path="work.agentHours" value={r.work.agentHours} format={hoursText} /></Fact>
            <Fact label="Idle" when={recorded(r.work.idleHours)}><Field path="work.idleHours" value={r.work.idleHours} format={hoursText} /></Fact>
            <Fact label="Untraced" when={recorded(r.work.untracedHours)}><Field path="work.untracedHours" value={r.work.untracedHours} format={hoursText} /></Fact>
            <Fact label="Fresh tokens" when={recorded(r.work.tokens.fresh)}><Field path="work.tokens.fresh" value={r.work.tokens.fresh} format={tokensText} /></Fact>
            <Fact label="Cached tokens" when={recorded(r.work.tokens.cached)}><Field path="work.tokens.cached" value={r.work.tokens.cached} format={tokensText} /></Fact>
            <Fact label="Total tokens" when={recorded(r.work.tokens.total)}><Field path="work.tokens.total" value={r.work.tokens.total} format={tokensText} /></Fact>
            <Fact label={firstPassAt ? `After the first pass (${clock(firstPassAt)})` : 'After first pass'} when={Object.values(r.waste.afterPass).some(recorded)}><Measures values={[{ path: 'waste.afterPass.hours', value: r.waste.afterPass.hours, format: hoursText }, { path: 'waste.afterPass.tokens', value: r.waste.afterPass.tokens, format: tokensText }, { path: 'waste.afterPass.usd', value: r.waste.afterPass.usd, format: money }]} /></Fact>
            <Fact label="Verdict delay" when={Object.values(r.waste.verdictDelay).some(recorded)}><Measures values={[{ path: 'waste.verdictDelay.minutes', value: r.waste.verdictDelay.minutes, suffix: ' min' }, { path: 'waste.verdictDelay.refusedChecks', value: r.waste.verdictDelay.refusedChecks, suffix: ' checks refused' }]} /></Fact>
          </dl>
        </section>}
      </aside>
    </div>
    {behavior && <ProfileBehavior reading={behavior} print={print} />}
    {(lanes.length > 0 || marks.length > 0) && <Drawer title="Where the time went" print={print}><div className="rr-chart" data-field="timeline"><FigureView figure={figure} /></div></Drawer>}
    {(Boolean(r.versions?.rows.length) || recorded(r.chosen.why) || Boolean(open)) && <Drawer title="Versions" print={print}><p data-field="chosen.why">{r.chosen.why}</p>{r.versions?.rows.length ? <><div className="rr-table" data-field="versions.rows"><table><thead><tr><th>Version</th><th>Check</th><th>Result</th></tr></thead><tbody>{r.versions.rows.map((row, i) => row.checks.map((check, j) => <tr key={`${row.tag}-${check.id}`}><th><Field path={`versions.rows.${i}.tag`} value={row.tag} /></th><td data-field={`versions.rows.${i}.checks.${j}.label`}>{check.label ?? check.id}</td><td data-field={`versions.rows.${i}.checks.${j}.result`}>{check.result}</td></tr>))}</tbody></table></div>{versionFigure && <div className="rr-chart" data-field="versions"><FigureView figure={versionFigure} /></div>}</> : null}{open && !print && <button onClick={() => open('versions')}>Open version history</button>}</Drawer>}
    {(recorded(r.work.toolCalls) || recorded(r.work.tries) || lanes.length > 0 || (r.lineage?.chain.length ?? 0) > 1 || recorded(r.outcome.reason) || Boolean(r.system?.errors?.top.length) || failures.length > 0 || Boolean(workers?.count) || Boolean(open)) && <Drawer title="How it ran" print={print}>
      {failures.length > 0 && <div className="rr-chart" data-field="system.attempts.causes"><p className="rr-muted">Why turns failed: {r.system!.attempts!.failed} of {r.system!.attempts!.tries} tries, hours each cause took</p><HBars rows={failures.map((cause) => ({ label: cause.label ?? cause.cause, value: cause.hours ?? 0, note: `${cause.tries} ${cause.tries === 1 ? 'try' : 'tries'}` }))} format={hoursText} color="var(--ar-c-fail)" /></div>}
      <dl className="rr-facts">
      <Fact label="Tool calls" when={recorded(r.work.toolCalls)}><Field path="work.toolCalls" value={r.work.toolCalls} /></Fact>
      <Fact label="Tries" when={recorded(r.work.tries)}><Field path="work.tries" value={r.work.tries} /></Fact>
      <Fact label="Workers" when={Boolean(workers?.count)}><span data-field="system.workers">{workers?.count} workers{workers?.neverFinished ? `, ${workers.neverFinished} never finished a turn${workers.neverFinishedHours ? ` (${hoursText(workers.neverFinishedHours)})` : ''}` : ''}</span></Fact>
      <Fact label="Team" when={lanes.length > 0}><span data-field="timeline.lanes">{r.timeline.lanes.map((lane) => lane.label).join(', ')}</span></Fact>
      <Fact label="Lineage" when={(r.lineage?.chain.length ?? 0) > 1}><span data-field="lineage.chain">{r.lineage?.chain.join(' / ')}</span></Fact>
      <Fact label="Run ended" when={recorded(r.outcome.reason)}><span data-field="outcome.reason">{r.outcome.reason}</span></Fact>
    </dl>{r.system?.errors?.top.map((error, i) => <div key={i}><Field path={`system.errors.top.${i}.count`} value={error.count} /> × {error.tool}<pre data-field={`system.errors.top.${i}.message`}>{error.message}</pre></div>)}{open && !print && <button onClick={() => open('agents')}>Open conversations</button>}</Drawer>}
    {recorded(r.brief) && <Drawer title="What was asked" print={print}><div className="rr-brief" data-field="brief"><Markdown remarkPlugins={[remarkGfm]}>{r.brief!}</Markdown></div></Drawer>}
  </article>
}
