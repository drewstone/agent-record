import type { NodeSpend, Spend } from '../workspace.js'
import { duration, money, tokens } from './data.js'

const seatWeekValue = (value: number | null | undefined) =>
  value == null ? '—' : value > 0 && value < 0.000001 ? value.toExponential(2) : value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 6 })

const seatLabel = (seat: string) => `seat ${seat.slice(0, 12)}`
const segmentTime = (value: string | null | undefined) => value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'end unmeasured'

/** Weekly allowance use comes from subscription history; it is not paid spend or list price. */
export function SeatWeeksPanel({ spend }: { spend: Spend }) {
  const seats = spend.bySeat ?? []
  if (!seats.length) return null
  return (
    <section className="seat-weeks" aria-label="Subscription seat usage">
      <h3>Subscription seats</h3>
      <p className="seat-weeks-total"><strong>{seatWeekValue(spend.seatWeeks)}</strong> seat-weeks{spend.seatWeeksKnown === false && spend.seatWeeks != null ? ' · partial' : ''}</p>
      <p className="seat-weeks-note">Observed share of each seat's seven-day allowance; not billed cost.</p>
      <div className="seat-weeks-list">
        {seats.map((row) => (
          <div className="seat-week-row" key={`${row.seat}:${row.provider}:${row.model}`}>
            <span><code title={row.seat}>{seatLabel(row.seat)}</code> · {[row.provider, row.model].filter(Boolean).join(' · ') || 'model unmeasured'}</span>
            <span>{seatWeekValue(row.seatWeeks)} seat-weeks{!row.known && row.seatWeeks !== null ? ' · partial' : ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Keep billed API, billed compute, and unbilled subscription use in separate figures. */
export function SpendSummary({ spend, compact = false }: { spend: Spend | null | undefined; compact?: boolean }) {
  if (!spend) return <span className="spend-chip unknown">spend unknown</span>
  return (
    <span className={`spend-summary ${compact ? 'compact' : ''}`} data-spend>
      <span className={`spend-chip subscription ${spend.subscriptionUsd === null ? 'unknown' : ''}`}>
        <b>{money(spend.subscriptionUsd)}</b> subscription use at API prices · not billed
        {!spend.subscriptionKnown && spend.subscriptionUsd !== null && <em className="not-known">partial</em>}
      </span>
      <span className={`spend-chip api ${spend.apiUsd === null ? 'unknown' : ''}`} title={spend.sources.join(', ') || undefined}>
        <b>{money(spend.apiUsd)}</b> model API · billed
      </span>
      <span className={`spend-chip sandbox ${spend.sandboxUsd === null ? 'unknown' : ''}`}>
        <b>{money(spend.sandboxUsd)}</b> sandbox compute · billed
      </span>
      {!compact && spend.costBasisUsd !== null && <span className="spend-split">sandbox cost basis {money(spend.costBasisUsd)}</span>}
      {!compact && spend.tokens && (
        <span className="spend-split">
          tokens in {tokens(spend.tokens.input)} · out {tokens(spend.tokens.output)} · cache read {tokens(spend.tokens.cacheRead)}
        </span>
      )}
    </span>
  )
}

type Row = { label: string; subscription: number | null; api: number | null; sandbox: number | null; subscriptionKnown?: boolean; note?: string; href?: string }

/** A dollar figure with its certainty: unknown stays a word, a partial figure says so. */
function Amount({ value, known, what }: { value: number | null; known: boolean | undefined; what: string }) {
  if (value === null) return <span className="unknown">unknown <small>{what}</small></span>
  return (
    <span>
      {money(value)} <small>{what}</small>
      {known === false && <small className="spend-note"> not fully known</small>}
    </span>
  )
}

/** Three cost kinds; missing measurements stay visible. */
export function SpendBars({ rows, onOpen }: { rows: Row[]; onOpen?: (row: Row) => void }) {
  const max = Math.max(1e-9, ...rows.map((row) => (row.subscription ?? 0) + (row.api ?? 0) + (row.sandbox ?? 0)))
  if (!rows.length) return <p className="chat-empty">No spend is recorded.</p>
  return (
    <div className="spend-bars" role="table">
      {rows.map((row) => {
        const unknown = row.subscription === null && row.api === null && row.sandbox === null
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
                  <i className={`bar subscription ${row.subscription === null ? 'unknown' : ''}`} style={{ width: `${row.subscription === null ? 8 : (row.subscription / max) * 100}%` }} title={`subscription use ${money(row.subscription)} at API prices, not billed`} />
                  <i className={`bar api ${row.api === null ? 'unknown' : ''}`} style={{ width: `${row.api === null ? 8 : (row.api / max) * 100}%` }} title={`model API ${money(row.api)}, billed`} />
                  <i className={`bar sandbox ${row.sandbox === null ? 'unknown' : ''}`} style={{ width: `${row.sandbox === null ? 8 : (row.sandbox / max) * 100}%` }} title={`sandbox compute ${money(row.sandbox)}, billed`} />
                </>
              )}
            </span>
            <span className="spend-value" role="cell">
              <Amount value={row.subscription} known={row.subscriptionKnown} what="subscription" /> · <Amount value={row.api} known={undefined} what="API" /> · <Amount value={row.sandbox} known={undefined} what="sandbox" />
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
  rows: { label: string; ms: number | null; tokens: number | null; listUsd: number | null }[]
}) {
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map((row) => row.ms ?? 0))
  const unmeasured = [
    rows.some((row) => row.ms === null) && 'time',
    rows.some((row) => row.tokens === null) && 'tokens',
    rows.some((row) => row.listUsd === null) && 'usage price',
  ].filter(Boolean).join(', ')
  return (
    <section className="breakdown">
      <h4>{title}</h4>
      <div className="breakdown-rows">
        {rows.map((row) => (
          <div key={row.label} className="breakdown-row">
            <span className={`breakdown-label`}>
              <i className={`category-${row.label.split(' ')[0]}`} />
              {row.label.replaceAll('_', ' ')}
            </span>
            <span className="breakdown-track">{row.ms === null ? <i className="unknown" style={{ width: '100%' }} /> : <i style={{ width: `${(row.ms / max) * 100}%` }} />}</span>
            <span className="breakdown-value">
              {row.ms === null ? '—' : duration(row.ms)} · {row.tokens === null ? '—' : tokens(row.tokens)} tokens · {row.listUsd === null ? '—' : money(row.listUsd)} at API prices
            </span>
          </div>
        ))}
      </div>
      {unmeasured && <p><small>— marks unmeasured {unmeasured}.</small></p>}
    </section>
  )
}

/** Spend per served model, from the agents that ran it. */
export function byModel(spend: Spend | null | undefined) {
  return (spend?.byModel ?? [])
    .map((row) => ({ label: row.model, subscription: row.subscriptionUsd, api: row.apiUsd, sandbox: row.sandboxUsd,
      note: `${row.agents} agents` }))
    .sort((a, b) => (b.subscription ?? 0) + (b.sandbox ?? 0) - ((a.subscription ?? 0) + (a.sandbox ?? 0)))
}

export function NodeSpendPanel({ spend, listFromRecord }: { spend: NodeSpend | undefined; listFromRecord: number | null }) {
  if (!spend)
    return (
      <div className="node-spend">
        <p className="chat-empty">No spend is recorded for this agent.{listFromRecord !== null ? ` Recorded model usage prices at ${money(listFromRecord)} at API rates.` : ''}</p>
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
        {!!spend.segments?.length && <div><dt>Seat-weeks</dt><dd>{seatWeekValue(spend.seatWeeks)}{spend.seatWeeksKnown === false && spend.seatWeeks != null ? ' · partial' : ''}</dd></div>}
      </dl>
      {spend.sandboxes.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>Sandbox</th><th>Compute billed</th><th>Cost basis</th><th>Hours</th></tr>
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
      {!!spend.segments?.length && (
        <section className="seat-segments" aria-label="Agent seat segments">
          <h4>Seat segments</h4>
          {spend.segments.map((segment, index) => (
            <div className="seat-segment" key={`${segment.seat}:${segment.startedAt}:${index}`}>
              <div><code title={segment.seat}>{seatLabel(segment.seat)}</code> · {[segment.provider, segment.model].filter(Boolean).join(' · ') || 'model unmeasured'}</div>
              <div className="seat-segment-time">{segmentTime(segment.startedAt)} → {segmentTime(segment.endedAt)}</div>
              <div>{seatWeekValue(segment.seatWeeks)} seat-weeks{!segment.seatWeeksKnown && segment.seatWeeks !== null ? ' · partial' : ''}{segment.reason ? ` · ${segment.reason}` : ''}</div>
            </div>
          ))}
        </section>
      )}
      {spend.gaps.length > 0 && (
        <ul className="gap-list">
          {spend.gaps.map((gap, i) => <li key={i}><code>{gap.code}</code> {gap.detail}</li>)}
        </ul>
      )}
    </div>
  )
}
