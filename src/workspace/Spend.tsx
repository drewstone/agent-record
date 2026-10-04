import type { NodeSpend, RunSummary, Spend } from '../workspace.js'
import { duration, money, tokens } from './data.js'

/** Paid dollars, list price and unknown, never merged. */
export function SpendSummary({ spend, compact = false }: { spend: Spend | null | undefined; compact?: boolean }) {
  if (!spend) return <span className="spend-chip unknown">spend unknown</span>
  return (
    <span className={`spend-summary ${compact ? 'compact' : ''}`} data-spend>
      <span className={`spend-chip paid ${spend.paidUsd === null ? 'unknown' : ''}`} title={spend.sources.join(', ') || undefined}>
        <b>{money(spend.paidUsd)}</b> paid
        {!spend.paidKnown && spend.paidUsd !== null && <em className="not-known" title={spend.gaps.map((gap) => gap.detail).join('\n') || undefined}>not fully known</em>}
      </span>
      {!compact && (
        <span className="spend-split">
          sandbox {money(spend.sandboxUsd)}
          {spend.costBasisUsd !== null && <> (cost basis {money(spend.costBasisUsd)})</>} · Router {money(spend.routerUsd)}
        </span>
      )}
      <span className={`spend-chip list ${spend.listUsd === null ? 'unknown' : ''}`}>
        <b>{money(spend.listUsd)}</b> list price, not billed
      </span>
      {!compact && spend.tokens && (
        <span className="spend-split">
          tokens in {tokens(spend.tokens.input)} · out {tokens(spend.tokens.output)} · cache read {tokens(spend.tokens.cacheRead)}
        </span>
      )}
    </span>
  )
}

type Row = { label: string; paid: number | null; list: number | null; note?: string; href?: string }

/** One bar per row: paid solid, list price outlined, unknown hatched. */
export function SpendBars({ rows, onOpen }: { rows: Row[]; onOpen?: (row: Row) => void }) {
  const max = Math.max(1e-9, ...rows.map((row) => (row.paid ?? 0) + (row.list ?? 0)))
  if (!rows.length) return <p className="chat-empty">No spend is recorded.</p>
  return (
    <div className="spend-bars" role="table">
      {rows.map((row) => {
        const paid = row.paid ?? 0
        const list = row.list ?? 0
        const unknown = row.paid === null && row.list === null
        return (
          <div
            key={row.label}
            className={`spend-row ${onOpen ? 'clickable' : ''}`}
            role="row"
            tabIndex={onOpen ? 0 : undefined}
            onClick={() => onOpen?.(row)}
            onKeyDown={(event) => {
              if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                onOpen(row)
              }
            }}
          >
            <span className="spend-label" role="cell" title={row.label}>{row.label}</span>
            <span className="spend-track" role="cell">
              {unknown ? (
                <i className="bar unknown" style={{ width: '100%' }} title="unknown" />
              ) : (
                <>
                  <i className={`bar paid ${row.paid === null ? 'unknown' : ''}`} style={{ width: `${row.paid === null ? 8 : (paid / max) * 100}%` }} title={`paid ${money(row.paid)}`} />
                  <i className={`bar list ${row.list === null ? 'unknown' : ''}`} style={{ width: `${row.list === null ? 8 : (list / max) * 100}%` }} title={`list price ${money(row.list)}, not billed`} />
                </>
              )}
            </span>
            <span className="spend-value" role="cell">
              {money(row.paid)} <small>paid</small> · {money(row.list)} <small>list</small>
              {row.note && <small className="spend-note"> {row.note}</small>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function BreakdownTable({
  title,
  rows,
}: {
  title: string
  rows: { label: string; ms: number; tokens: number | null; listUsd: number | null }[]
}) {
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map((row) => row.ms))
  return (
    <section className="breakdown">
      <h4>{title}</h4>
      <div className="breakdown-rows">
        {rows.map((row) => (
          <div key={row.label} className="breakdown-row">
            <span className={`breakdown-label`}>
              <i className={`category-${row.label}`} />
              {row.label.replaceAll('_', ' ')}
            </span>
            <span className="breakdown-track"><i style={{ width: `${(row.ms / max) * 100}%` }} /></span>
            <span className="breakdown-value">
              {duration(row.ms)} · {tokens(row.tokens)} tokens · {money(row.listUsd)} list
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Spend per model across runs; a run with several models stays together. */
export function byModel(runs: RunSummary[]) {
  const groups = new Map<string, { paid: number | null; list: number | null; runs: number }>()
  for (const run of runs) {
    const key = run.models.length === 1 ? run.models[0]! : run.models.length ? 'several models' : 'model unknown'
    const group = groups.get(key) ?? { paid: null, list: null, runs: 0 }
    if (run.spend.paidUsd !== null) group.paid = (group.paid ?? 0) + run.spend.paidUsd
    if (run.spend.listUsd !== null) group.list = (group.list ?? 0) + run.spend.listUsd
    group.runs++
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([label, group]) => ({ label, paid: group.paid, list: group.list }))
    .sort((a, b) => (b.paid ?? 0) + (b.list ?? 0) - ((a.paid ?? 0) + (a.list ?? 0)))
}

export function NodeSpendPanel({ spend, listFromRecord }: { spend: NodeSpend | undefined; listFromRecord: number | null }) {
  if (!spend)
    return (
      <div className="node-spend">
        <p className="chat-empty">No spend is recorded for this agent.{listFromRecord !== null ? ` Recorded usage prices at ${money(listFromRecord)} list, not billed.` : ''}</p>
      </div>
    )
  const limit = spend.account.rateLimit
  return (
    <div className="node-spend" data-node-spend>
      <SpendSummary spend={spend} />
      <dl className="kv">
        <div><dt>Account</dt><dd>{spend.account.kind}</dd></div>
        {limit && (
          <div>
            <dt>Rate limit</dt>
            <dd>
              {limit.window ?? 'window unknown'} · {limit.utilization === null ? 'utilization unknown' : `${Math.round(limit.utilization * 100)}% used`} · {limit.status ?? 'status unknown'}
            </dd>
          </div>
        )}
        {spend.sandboxHours !== null && <div><dt>Sandbox time</dt><dd>{spend.sandboxHours.toFixed(2)} h</dd></div>}
      </dl>
      {spend.sandboxes.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>Sandbox</th><th>Paid</th><th>Cost basis</th><th>Hours</th></tr>
          </thead>
          <tbody>
            {spend.sandboxes.map((box) => (
              <tr key={box.id}>
                <td className="mono">{box.id}</td>
                <td>{money(box.usd)}</td>
                <td>{money(box.costBasisUsd)}</td>
                <td>{box.hours === null ? 'unknown' : box.hours.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {spend.gaps.length > 0 && (
        <ul className="gap-list">
          {spend.gaps.map((gap, i) => <li key={i}><code>{gap.code}</code> {gap.detail}</li>)}
        </ul>
      )}
    </div>
  )
}
