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
const missing = 'not recorded'

/** All measures and decisions belong to the Lab document. This component only formats them. */
export function RunOverview({ api, doc, open, print = false }: { api: string; doc: RunDocument; nodes?: RecordNode[] | null; stats?: Record<string, NodeStats>; open?: OpenView; print?: boolean }) {
  const r = doc.receipt
  if (!r?.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p>The receipt document is {missing}.</p></section>
  return <RunReceiptView api={api} receipt={r} print={print} open={open} />
}

function Field({ path, value, format = String, children }: { path: string; value: string | number | null | undefined; format?: (value: never) => string; children?: ReactNode }) {
  return <span data-field={path} data-value={value ?? ''}>{children ?? (value === null || value === undefined ? missing : format(value as never))}</span>
}

function Drawer({ title, print, children }: { title: string; print: boolean; children: ReactNode }) {
  return <details className="rr-drawer" open={print || undefined}><summary>{title}</summary><div className="rr-drawer-body">{children}</div></details>
}

function Copy({ text }: { text: string }) {
  const [state, setState] = useState('Copy command')
  return <button type="button" className="rr-copy" onClick={() => { void navigator.clipboard.writeText(text).then(() => setState('Copied'), () => setState('Copy failed')) }} aria-live="polite">{state}</button>
}

export function RunReceiptView({ api = '/api/discovery', receipt: r, print = false, open }: { api?: string; receipt: RunReceipt; print?: boolean; open?: OpenView }) {
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [operation, setOperation] = useState<Record<string, string>>({})
  if (!r.outcome || !r.work) return <section className="rr-page"><h1>Run receipt</h1><p>The receipt document is {missing}.</p></section>
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
  const versionFigure = r.versions?.line.x ? timeSeries([{ id: 'exact', label: 'Exact checks passed', points: r.versions.rows.filter((row) => row.at).map((row) => ({ x: Date.parse(row.at!), y: row.exactPassed })) }], { x: { label: 'UTC', domain: r.versions.line.x }, y: { label: 'Exact checks passed', unit: 'checks', domain: r.versions.line.y }, formatX: (at) => new Date(at).toISOString().slice(11, 16), marks: r.versions.line.marks.map((mark) => ({ at: Date.parse(mark.t), label: mark.label, kind: mark.kind })) }) : null
  return <article className={`rr-page${print ? ' rr-print' : ''}`} data-overview data-receipt={r.runId}>
    <header className={`rr-verdict rr-${r.outcome.status}`}>
      <div className="rr-title-row"><h1 data-field="title" title={r.title}>{r.title}</h1><span className="rr-status" data-field="outcome.status">{r.outcome.status.replaceAll('-', ' ')}</span></div>
      <p data-field="outcome.sentence">{r.outcome.sentence}</p>
      <p className="rr-summary"><span>Chosen <Field path="chosen.tag" value={r.chosen.tag} /></span><span><Field path="cost.billedUsd.total.usd" value={r.cost.billedUsd.total.usd} format={money} /> billed</span><span><Field path="work.wallHours" value={r.work.wallHours} format={hoursText} /> elapsed</span><a className="rr-download" href={`/run/${encodeURIComponent(r.runId)}/receipt/${encodeURIComponent(r.tag)}?download=1`} download>Download receipt</a></p>
    </header>
    <div className="rr-columns">
      <div className="rr-evidence">
        <section aria-labelledby="rr-files"><h2 id="rr-files">What you got</h2><ul className="rr-files">{r.files.length ? r.files.map((file, i) => <li key={file.file}><a href={`${fileBase}/${encodeURIComponent(file.file)}`} data-field={`files.${i}.label`}>{file.label}</a><a href={`${fileBase}/${encodeURIComponent(file.file)}`} download aria-label={`Download ${file.file}`}>Download</a></li>) : <li>{missing}</li>}</ul></section>
        <section aria-labelledby="rr-check"><h2 id="rr-check">The check</h2>{!r.check && <p>No play check is registered for this run.</p>}<pre className="rr-output" data-field="check.output">{r.check?.output ?? missing}</pre><dl className="rr-facts">
          <dt>Ran on</dt><dd><Field path="check.tag" value={r.check?.tag} /> <code><Field path="check.commit" value={r.check?.commit} /></code></dd>
          <dt>At</dt><dd><Field path="check.at" value={r.check?.at} format={utcClock} /></dd>
          <dt>Inputs SHA-256</dt><dd><code><Field path="check.inputs.sha256" value={r.check?.inputs.sha256} /></code><span className="rr-muted" data-field="check.inputs.source">{r.check?.inputs.source ?? missing}</span></dd>
          <dt>Checker SHA-256</dt><dd><code><Field path="check.checker.sha256" value={r.check?.checker.sha256} /></code><span className="rr-muted" data-field="check.checker.path">{r.check?.checker.path}</span></dd>
        </dl>{r.check?.rerun && <div className="rr-rerun"><code data-field="check.rerun">{r.check?.rerun}</code>{!print && <Copy text={r.check?.rerun} />}</div>}</section>
      </div>
      <aside>
        <section aria-labelledby="rr-decide"><h2 id="rr-decide">Decide</h2><div className="rr-decisions">{r.decisions.map((decision, i) => <div key={decision.id}>
          {print ? <strong data-field={`decisions.${i}.label`}>{decision.label}</strong> : <button type="button" className={decision.id === 'take' ? 'rr-primary' : ''} disabled={!decision.enabled || pending !== null} onClick={() => { void decide(decision.id) }}>{pending === decision.id ? 'Saving…' : decision.label}</button>}
          <p data-field={`decisions.${i}.consequence`}>{decision.enabled ? decision.consequence : decision.reason ?? missing}</p>
          {decision.command && <details className="rr-command" open={print || undefined}><summary>Command</summary><code data-field={`decisions.${i}.command`}>{decision.command}</code></details>}
        </div>)}</div>{notice && <p role="status">{notice}</p>}</section>
        <section aria-labelledby="rr-cost"><h2 id="rr-cost">Cost and waste</h2><div className="rr-chart" data-field="work"><Meter total={r.work.recordedHours} segments={[{ label: 'Work', value: r.work.agentHours }, { label: 'Idle', value: r.work.idleHours }, { label: 'Untraced', value: r.work.untracedHours, kind: 'untraced' }]} format={hoursText} text="Recorded agent time" /></div>
          <dl className="rr-facts rr-measures"><dt>Work</dt><dd><Field path="work.agentHours" value={r.work.agentHours} format={hoursText} /></dd><dt>Idle</dt><dd><Field path="work.idleHours" value={r.work.idleHours} format={hoursText} /></dd><dt>Untraced</dt><dd><Field path="work.untracedHours" value={r.work.untracedHours} format={hoursText} /></dd><dt>Fresh tokens</dt><dd><Field path="work.tokens.fresh" value={r.work.tokens.fresh} format={tokensText} /></dd><dt>Cached tokens</dt><dd><Field path="work.tokens.cached" value={r.work.tokens.cached} format={tokensText} /></dd><dt>Total tokens</dt><dd><Field path="work.tokens.total" value={r.work.tokens.total} format={tokensText} /></dd><dt>After first pass</dt><dd><Field path="waste.afterPass.hours" value={r.waste.afterPass.hours} format={hoursText} />, <Field path="waste.afterPass.tokens" value={r.waste.afterPass.tokens} format={tokensText} />, <Field path="waste.afterPass.usd" value={r.waste.afterPass.usd} format={money} /></dd><dt>Verdict delay</dt><dd><Field path="waste.verdictDelay.minutes" value={r.waste.verdictDelay.minutes} /> min, <Field path="waste.verdictDelay.refusedChecks" value={r.waste.verdictDelay.refusedChecks} /> checks refused</dd></dl>
        </section>
      </aside>
    </div>
    <Drawer title="Where the time went" print={print}><div className="rr-chart" data-field="timeline"><FigureView figure={figure} /></div><ul>{r.timeline.marks.map((mark, i) => <li key={`${mark.t}-${i}`}><Field path={`timeline.marks.${i}.t`} value={mark.t} format={utcClock} />: <span data-field={`timeline.marks.${i}.label`}>{mark.label}</span></li>)}</ul></Drawer>
    <Drawer title="Versions" print={print}><p data-field="chosen.why">{r.chosen.why}</p>{r.versions ? <><div className="rr-table" data-field="versions.rows"><table><thead><tr><th>Version</th><th>Check</th><th>Result</th></tr></thead><tbody>{r.versions.rows.map((row, i) => row.checks.map((check, j) => <tr key={`${row.tag}-${check.id}`}><th><Field path={`versions.rows.${i}.tag`} value={row.tag} /></th><td data-field={`versions.rows.${i}.checks.${j}.label`}>{check.label ?? check.id}</td><td data-field={`versions.rows.${i}.checks.${j}.result`}>{check.result}</td></tr>))}</tbody></table></div>{versionFigure && <div className="rr-chart" data-field="versions"><FigureView figure={versionFigure} /></div>}</> : <p>{missing}</p>}{open && !print && <button onClick={() => open('versions')}>Open version history</button>}</Drawer>
    <Drawer title="How it ran" print={print}><dl className="rr-facts"><dt>Tool calls</dt><dd><Field path="work.toolCalls" value={r.work.toolCalls} /></dd><dt>Tries</dt><dd><Field path="work.tries" value={r.work.tries} /></dd><dt>Team</dt><dd data-field="timeline.lanes">{r.timeline.lanes.map((lane) => lane.label).join(', ') || missing}</dd><dt>Lineage</dt><dd data-field="lineage.chain">{r.lineage?.chain.join(' / ') ?? missing}</dd><dt>Run ended</dt><dd data-field="outcome.reason">{r.outcome.reason ?? missing}</dd></dl>{r.system?.errors?.top.map((error, i) => <div key={i}><Field path={`system.errors.top.${i}.count`} value={error.count} /> × {error.tool}<pre data-field={`system.errors.top.${i}.message`}>{error.message}</pre></div>)}{open && !print && <button onClick={() => open('agents')}>Open conversations</button>}</Drawer>
    <Drawer title="What was asked" print={print}><div className="rr-brief" data-field="brief"><Markdown remarkPlugins={[remarkGfm]}>{r.brief ?? missing}</Markdown></div></Drawer>
  </article>
}
