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
        {spend.listKnown === false && spend.listUsd !== null && (
          <em className="not-known" title={spend.gaps.filter((gap) => gap.code === 'list-partial').map((gap) => gap.detail).join('\n') || undefined}>
            not fully known
          </em>
        )}
      </span>
      {!compact && spend.tokens && (
        <span className="spend-split">
          tokens in {tokens(spend.tokens.input)} · out {tokens(spend.tokens.output)} · cache read {tokens(spend.tokens.cacheRead)}
        </span>
      )}
    </span>
  )
}

type Row = { label: string; paid: number | null; list: number | null; paidKnown?: boolean; listKnown?: boolean; note?: string; href?: string }

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
              <Amount value={row.paid} known={row.paidKnown} what="paid" /> · <Amount value={row.list} known={row.listKnown} what="list" />
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
    rows.some((row) => row.listUsd === null) && 'list price',
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
              {row.ms === null ? '—' : duration(row.ms)} · {row.tokens === null ? '—' : tokens(row.tokens)} tokens · {row.listUsd === null ? '—' : money(row.listUsd)} list
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
    .map((row) => ({ label: row.model, paid: row.paidUsd, list: row.listUsd }))
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
        {!!spend.segments?.length && <div><dt>Seat-weeks</dt><dd>{seatWeekValue(spend.seatWeeks)}{spend.seatWeeksKnown === false && spend.seatWeeks != null ? ' · partial' : ''}</dd></div>}
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
