import type { NodeSpend, Spend } from '../workspace.js'
import { duration, money, tokens } from './data.js'

const seatWeekValue = (value: number | null | undefined) =>
  value == null ? '—' : value > 0 && value < 0.000001 ? value.toExponential(2) : value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 6 })

const seatLabel = (seat: string) => `seat ${seat.slice(0, 12)}`
const segmentTime = (value: string | null | undefined) => value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'end unmeasured'
export const spendGapLabel = (code: string) => code === 'list-partial' ? 'usage at API prices incomplete' : code

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

type SpendLike = Pick<Spend, 'subscriptionUsd' | 'apiUsd' | 'listUsd' | 'gaps'> & { listKnown?: boolean; account?: { kind?: string }; apiEquivalentUsd?: unknown }

const usageUnknown = (spend: SpendLike) =>
  spend.listKnown === false || spend.account?.kind === 'unknown' || spend.gaps.some((gap) => gap.code === 'spend-unknown' || gap.code === 'list-partial')

/**
 * Subscription use at API prices, honestly (R6): a zero is a reading only when the usage behind it is known. An agent on an
 * account of unknown kind, a total over agents whose usage is unknown, or a zero beside list-priced usage is unknown
 * (null), never "$0.00".
 */
export function knownSubscription(spend: SpendLike | null | undefined): number | null {
  if (!spend) return null
  const value = spend.subscriptionUsd
  if (value !== 0) return value
  if (spend.account?.kind === 'router' || (spend.apiUsd ?? 0) > 0) return 0
  return usageUnknown(spend) || (spend.listUsd ?? 0) > 0 ? null : 0
}

/** API-equivalent dollars (every token at API list price, whoever paid): the host's figure, else the list price of the
 * usage it read; `partial` when some usage behind it is unknown. */
export function apiEquivalent(spend: SpendLike | null | undefined): { usd: number | null; partial: boolean } {
  if (!spend) return { usd: null, partial: false }
  const stated = spend.apiEquivalentUsd
  const usd = typeof stated === 'number' ? stated : stated && typeof stated === 'object' && typeof (stated as { usd?: unknown }).usd === 'number' ? (stated as { usd: number }).usd : spend.listUsd
  return { usd: usd ?? null, partial: usd != null && usageUnknown(spend) }
}

/**
 * What the spend was, kind by kind, and only the kinds that were read: API-equivalent dollars, subscription use at API
 * prices (not billed), model API and sandbox compute (billed). Unread kinds are not drawn: the Spend tab names them once
 * for all agents (`SpendBars`), never as chips of "unknown" or a false "$0.00". `coverage` is a play's: how many of its
 * runs the API-equivalent total prices. `agents` is a run's: how many of its agents the token total covers.
 */
export function SpendSummary({ spend, compact = false, coverage, agents }: { spend: Spend | null | undefined; compact?: boolean; coverage?: { usd: number | null; priced: number; runs: number }; agents?: { measured: number; total: number } }) {
  if (!spend) return <span className="spend-chip unknown">spend unknown</span>
  const subscription = knownSubscription(spend)
  const own = apiEquivalent(spend)
  const equivalent = coverage ? { usd: coverage.usd, partial: coverage.priced < coverage.runs } : own
  const showEquivalent = equivalent.usd !== null && (subscription === null || Math.abs(equivalent.usd - subscription) > 0.005)
  return (
    <span className={`spend-summary ${compact ? 'compact' : ''}`} data-spend>
      {showEquivalent && (
        <span className="spend-chip equivalent" data-field="apiEquivalentUsd" title="Every token at API list price, whoever paid; not a bill">
          <b>{money(equivalent.usd)}</b> API-equivalent
          {coverage && coverage.priced < coverage.runs ? <em className="not-known">{coverage.priced} of {coverage.runs} runs priced</em> : equivalent.partial && <em className="not-known">partial</em>}
        </span>
      )}
      {subscription !== null && (
        <span className="spend-chip subscription">
          <b>{money(subscription)}</b> subscription use at API prices · not billed
          {!spend.subscriptionKnown && <em className="not-known">partial</em>}
        </span>
      )}
      {spend.apiUsd !== null && (
        <span className="spend-chip api" title={spend.sources.join(', ') || undefined}>
          <b>{money(spend.apiUsd)}</b> model API · billed
        </span>
      )}
      {spend.sandboxUsd !== null && (
        <span className="spend-chip sandbox">
          <b>{money(spend.sandboxUsd)}</b> sandbox compute · billed
        </span>
      )}
      {!compact && spend.costBasisUsd !== null && <span className="spend-split">sandbox cost basis {money(spend.costBasisUsd)}</span>}
      {!compact && spend.tokens && (
        <span className="spend-split" data-run-tokens>
          tokens in <b>{tokens(spend.tokens.input)}</b> · out <b>{tokens(spend.tokens.output)}</b> · cache read <b>{tokens(spend.tokens.cacheRead)}</b>
          {agents && (agents.measured < agents.total ? <em className="not-known"> {agents.measured} of {agents.total} agents measured</em> : ` across ${agents.total} agents`)}
        </span>
      )}
    </span>
  )
}

type Row = { label: string; subscription: number | null; api: number | null; sandbox: number | null; subscriptionKnown?: boolean; note?: string; href?: string }

const KINDS = [['subscription', 'subscription use'], ['api', 'model API'], ['sandbox', 'sandbox compute']] as const

/**
 * The kinds no row measured, said once: `Not measured: subscription use, model API and sandbox compute for 15 of 15
 * agents`. 18b's Spend tab printed "unknown" three times on each of its 16 rows instead. A kind counts for a row only
 * when that row has no reading of it at all; a partial reading is a value and says so on its row.
 */
function unmeasuredLine(rows: readonly Row[], noun: string): string | null {
  const groups = new Map<number, string[]>()
  for (const [key, label] of KINDS) {
    const count = rows.filter((row) => row[key] === null).length
    if (count) groups.set(count, [...(groups.get(count) ?? []), label])
  }
  if (!groups.size) return null
  const list = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0])
  return `Not measured: ${[...groups.entries()].sort((a, b) => b[0] - a[0]).map(([count, words]) => `${list(words)} for ${count} of ${rows.length} ${noun}`).join('; ')}.`
}

/** Three cost kinds, each row only what it measured; `unmeasured` names the row noun for the one line that says what was not. */
export function SpendBars({ rows, onOpen, unmeasured }: { rows: Row[]; onOpen?: (row: Row) => void; unmeasured?: string }) {
  const max = Math.max(1e-9, ...rows.map((row) => (row.subscription ?? 0) + (row.api ?? 0) + (row.sandbox ?? 0)))
  if (!rows.length) return <p className="chat-empty">No spend is recorded.</p>
  const missing = unmeasured ? unmeasuredLine(rows, unmeasured) : null
  return (
    <>
    {missing && <p className="faint spend-unmeasured" data-spend-unmeasured>{missing}</p>}
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
                <i className="bar unknown" style={{ width: '100%' }} title="not measured" />
              ) : (
                <>
                  {row.subscription !== null && <i className="bar subscription" style={{ width: `${(row.subscription / max) * 100}%` }} title={`subscription use ${money(row.subscription)} at API prices, not billed`} />}
                  {row.api !== null && <i className="bar api" style={{ width: `${(row.api / max) * 100}%` }} title={`model API ${money(row.api)}, billed`} />}
                  {row.sandbox !== null && <i className="bar sandbox" style={{ width: `${(row.sandbox / max) * 100}%` }} title={`sandbox compute ${money(row.sandbox)}, billed`} />}
                </>
              )}
            </span>
            <span className="spend-value" role="cell">
              {[
                row.subscription !== null && <span key="subscription">{money(row.subscription)} <small>subscription</small>{row.subscriptionKnown === false && <small className="spend-note"> not fully known</small>}</span>,
                row.api !== null && <span key="api">{money(row.api)} <small>API</small></span>,
                row.sandbox !== null && <span key="sandbox">{money(row.sandbox)} <small>sandbox</small></span>,
              ].filter(Boolean).flatMap((item, i) => (i ? [' · ', item] : [item]))}
              {row.note ? <small className="spend-note"> {row.note}</small> : unknown && <span className="faint">—</span>}
            </span>
          </div>
        )
      })}
    </div>
    </>
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
        {spend.account.kind !== 'unknown' && <div><dt>Account</dt><dd>{spend.account.kind}</dd></div>}
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
          {spend.gaps.map((gap, i) => <li key={i}><code title={gap.code}>{spendGapLabel(gap.code)}</code> {gap.detail}</li>)}
        </ul>
      )}
    </div>
  )
}
