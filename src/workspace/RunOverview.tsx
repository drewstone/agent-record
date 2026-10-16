import { useState } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FigureView, Meter } from '@tangle-network/charts/react'
import { timeline, timeSeries } from '@tangle-network/charts'
import type { RecordNode } from '../record.js'
import type { RunDocument } from '../workspace.js'
import type { NodeStats } from './RunTable.js'
import type { RunReceipt } from './run-receipt.js'
import { hoursText, tokensText, utcClock } from './run-receipt.js'

export type OpenView = (section: string, patch?: Record<string, string | undefined>) => void
const recorded = (value: unknown) => value !== null && value !== undefined && value !== ''

/** All measures and decisions belong to the Lab document. This component only formats them. */
export function RunOverview({ api, doc, open, print = false }: { api: string; doc: RunDocument; nodes?: RecordNode[] | null; stats?: Record<string, NodeStats>; open?: OpenView; print?: boolean }) {
  const r = doc.receipt
  if (!r?.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p className="rr-muted">No receipt recorded yet.</p></section>
  return <RunReceiptView api={api} receipt={r} print={print} open={open} />
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

function ProfileBehavior({ reading, print }: { reading: NonNullable<RunReceipt['behaviorExpectations']>; print: boolean }) {
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

export function RunReceiptView({ api = '/api/discovery', receipt: r, print = false, open }: { api?: string; receipt: RunReceipt; print?: boolean; open?: OpenView }) {
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operation, setOperation] = useState<Record<string, string>>({})
  if (!r.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p className="rr-muted">No receipt recorded yet.</p></section>
  const hasRelease = Boolean(r.chosen.commit && r.chosen.tag && r.chosen.tag !== 'store')
  const decisions = r.decisions.map((decision, i) => ({ ...decision, index: i })).filter((decision) =>
    decision.enabled && (decision.id === 'rerun' ? Boolean(r.check?.rerun) : hasRelease))
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
  const lanes = r.timeline.lanes.map((lane) => ({ ...lane, spans: lane.spans.map((span) => ({ ...span, start: Date.parse(span.start), end: span.end === null ? null : Date.parse(span.end), note: span.note ?? undefined })) }))
  const marks = r.timeline.marks.map((mark) => ({ at: Date.parse(mark.t), label: mark.label, kind: mark.kind }))
  const figure = timeline(lanes, { measure: 'Recorded agent time', ...(r.timeline.end ? { now: Date.parse(r.timeline.end) } : {}), marks })
  const versionFigure = r.versions?.rows.length && r.versions.line.x ? timeSeries([{ id: 'exact', label: 'Exact checks passed', points: r.versions.rows.filter((row) => row.at).map((row) => ({ x: Date.parse(row.at!), y: row.exactPassed })) }], { x: { label: 'UTC', domain: r.versions.line.x }, y: { label: 'Exact checks passed', unit: 'checks', domain: r.versions.line.y }, formatX: (at) => new Date(at).toISOString().slice(11, 16), marks: r.versions.line.marks.map((mark) => ({ at: Date.parse(mark.t), label: mark.label, kind: mark.kind })) }) : null
  return <article className={`rr-page${print ? ' rr-print' : ''}`} data-overview data-receipt={r.runId}>
    <header className={`rr-verdict rr-${r.outcome.status}`}>
      <div className="rr-title-row"><h1 data-field="title" title={r.title}>{r.title}</h1><span className="rr-status" data-field="outcome.status">{r.outcome.status.replaceAll('-', ' ')}</span></div>
      <p data-field="outcome.sentence">{r.outcome.sentence}</p>
      <p className="rr-summary">{hasRelease && <span>Chosen <Field path="chosen.tag" value={r.chosen.tag} /></span>}{recorded(r.cost.billedUsd.total.usd) && <span><Field path="cost.billedUsd.total.usd" value={r.cost.billedUsd.total.usd} format={money} /> billed</span>}{recorded(r.work.wallHours) && <span><Field path="work.wallHours" value={r.work.wallHours} format={hoursText} /> elapsed</span>}<a className="rr-download" href={`/run/${encodeURIComponent(r.runId)}/receipt/${encodeURIComponent(r.tag)}?download=1`} download>Download receipt</a></p>
      {behavior && <p className="rr-summary"><a href="#rr-behavior-title">Profile behavior: {behavior.verdict}</a><span>Advisory</span></p>}
    </header>
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
          {print ? <strong data-field={`decisions.${decision.index}.label`}>{decision.label}</strong> : <button type="button" className={decision.id === 'take' ? 'rr-primary' : ''} disabled={!decision.enabled || pending !== null} onClick={() => { void decide(decision.id) }}>{pending === decision.id ? 'Saving…' : decision.label}</button>}
          <p data-field={`decisions.${decision.index}.consequence`}>{decision.consequence}</p>
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
            <Fact label="After first pass" when={Object.values(r.waste.afterPass).some(recorded)}><Measures values={[{ path: 'waste.afterPass.hours', value: r.waste.afterPass.hours, format: hoursText }, { path: 'waste.afterPass.tokens', value: r.waste.afterPass.tokens, format: tokensText }, { path: 'waste.afterPass.usd', value: r.waste.afterPass.usd, format: money }]} /></Fact>
            <Fact label="Verdict delay" when={Object.values(r.waste.verdictDelay).some(recorded)}><Measures values={[{ path: 'waste.verdictDelay.minutes', value: r.waste.verdictDelay.minutes, suffix: ' min' }, { path: 'waste.verdictDelay.refusedChecks', value: r.waste.verdictDelay.refusedChecks, suffix: ' checks refused' }]} /></Fact>
          </dl>
        </section>}
      </aside>
    </div>
    {behavior && <ProfileBehavior reading={behavior} print={print} />}
    {(lanes.length > 0 || marks.length > 0) && <Drawer title="Where the time went" print={print}><div className="rr-chart" data-field="timeline"><FigureView figure={figure} /></div><ul>{r.timeline.marks.map((mark, i) => <li key={`${mark.t}-${i}`}><Field path={`timeline.marks.${i}.t`} value={mark.t} format={utcClock} />: <span data-field={`timeline.marks.${i}.label`}>{mark.label}</span></li>)}</ul></Drawer>}
    {(Boolean(r.versions?.rows.length) || recorded(r.chosen.why) || Boolean(open)) && <Drawer title="Versions" print={print}><p data-field="chosen.why">{r.chosen.why}</p>{r.versions?.rows.length ? <><div className="rr-table" data-field="versions.rows"><table><thead><tr><th>Version</th><th>Check</th><th>Result</th></tr></thead><tbody>{r.versions.rows.map((row, i) => row.checks.map((check, j) => <tr key={`${row.tag}-${check.id}`}><th><Field path={`versions.rows.${i}.tag`} value={row.tag} /></th><td data-field={`versions.rows.${i}.checks.${j}.label`}>{check.label ?? check.id}</td><td data-field={`versions.rows.${i}.checks.${j}.result`}>{check.result}</td></tr>))}</tbody></table></div>{versionFigure && <div className="rr-chart" data-field="versions"><FigureView figure={versionFigure} /></div>}</> : null}{open && !print && <button onClick={() => open('versions')}>Open version history</button>}</Drawer>}
    {(recorded(r.work.toolCalls) || recorded(r.work.tries) || lanes.length > 0 || Boolean(r.lineage?.chain.length) || recorded(r.outcome.reason) || Boolean(r.system?.errors?.top.length) || Boolean(open)) && <Drawer title="How it ran" print={print}><dl className="rr-facts">
      <Fact label="Tool calls" when={recorded(r.work.toolCalls)}><Field path="work.toolCalls" value={r.work.toolCalls} /></Fact>
      <Fact label="Tries" when={recorded(r.work.tries)}><Field path="work.tries" value={r.work.tries} /></Fact>
      <Fact label="Team" when={lanes.length > 0}><span data-field="timeline.lanes">{r.timeline.lanes.map((lane) => lane.label).join(', ')}</span></Fact>
      <Fact label="Lineage" when={Boolean(r.lineage?.chain.length)}><span data-field="lineage.chain">{r.lineage?.chain.join(' / ')}</span></Fact>
      <Fact label="Run ended" when={recorded(r.outcome.reason)}><span data-field="outcome.reason">{r.outcome.reason}</span></Fact>
    </dl>{r.system?.errors?.top.map((error, i) => <div key={i}><Field path={`system.errors.top.${i}.count`} value={error.count} /> × {error.tool}<pre data-field={`system.errors.top.${i}.message`}>{error.message}</pre></div>)}{open && !print && <button onClick={() => open('agents')}>Open conversations</button>}</Drawer>}
    {recorded(r.brief) && <Drawer title="What was asked" print={print}><div className="rr-brief" data-field="brief"><Markdown remarkPlugins={[remarkGfm]}>{r.brief!}</Markdown></div></Drawer>}
  </article>
}
