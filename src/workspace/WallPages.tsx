import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DayBars, HBars, Lines, Meter } from '@tangle-network/charts/react'
import { AsOfStamp, Tip } from './AnswerStrip.js'
import { hm } from './answers.js'
import { useDocument } from './data.js'

/**
 * Fleet, Sandboxes and Ideas: the Discovery site's three operations pages, drawn from the host's view models
 * (tangle-tools fleet/wall_parts/disco_pages.py, /api/discovery/wall/<page>). Every number is one field there; a null is
 * shown as not reported. Fleet asks which host can take work and whether agents and seats are healthy; Sandboxes what
 * the autoscaled hosts cost and hold; Ideas which idea waits on Drew.
 */
type State = 'ok' | 'warn' | 'breach' | 'stale' | 'unknown'
interface Host { name: string; state: State; local: boolean; reportMin: number | null; reportLimitMin: number | null; load1: number | null; loadLimit: number | null; cores: number | null; diskFreeGb: number | null; diskFloorGb: number | null; swap: number | null; breached: string[]; over: string | null }
interface Agent { name: string; lane: string; state: 'asks' | 'working' | 'blocked' | 'limited'; harness: string | null; model: string | null; effort: string | null; since: string | null; limitUntil: string | null; step: string | null }
interface QuotaWindow { used: number | null; reset: string | null; label: string | null; why: string | null }
interface Seat { provider: string; name: string; state: 'room' | 'empty' | 'unknown'; long: QuotaWindow; short: QuotaWindow; back: string | null }
interface FleetDoc { asOf: string | null; hostsAt: string | null; agentsAt: string | null; seatsAt: string | null; hosts: Host[]; agents: { counts: Record<string, number | null>; total: number | null; rows: Agent[] }; seats: { room: number | null; limited: number | null; total: number | null; rows: Seat[] } }
interface SandboxHost { name: string; id: string; type: string; state: string; running: number | null; parked: number | null; slots: number | null; occupied: number | null; cpu: number | null; monthlyUsd: number | null; autoscaled: boolean; retire: string | null; heldBy: string | null }
interface SandboxesDoc {
  asOf: string | null; known: boolean; why: string | null
  totals: Record<'hosts' | 'monthlyUsd' | 'perHourUsd' | 'slots' | 'running' | 'runningShare' | 'occupiedShare' | 'parked' | 'discoveryRunning' | 'discoveryParked' | 'idleHosts' | 'idleMonthlyUsd' | 'draining', number | null>
  hosts: SandboxHost[]; hostsOverTime: [number, number][]; parked: { label: string; boxes: number; discovery: number; hours: number | null; cause: string }[]
  scaler: Record<'decision' | 'current' | 'target' | 'max' | 'breaker' | 'pendingRetirement' | 'error', string | number | null>
  fleetKey: { name: string | null; capUsd: number | null; spentUsd: number | null; leftUsd: number | null }
  spendDaily: Record<'subscription' | 'api' | 'sandbox', [number, number][]>
}
interface Idea { id: string; title: string; origin: string; destination: string; stage: string; summary: string; problems: number; created: string | null; problemStatements: string[] }
interface IdeasDoc { asOf: string | null; stages: { stage: string; count: number | null; of: number | null }[]; awaiting: number | null; decideUrl: string | null; rows: Idea[] }

const TONE: Record<string, string> = { ok: 'var(--ar-c-ok, #22c55e)', warn: 'var(--ar-c-warn, #f5a524)', breach: 'var(--ar-c-fail, #ef4444)', stale: 'var(--ar-fg-faint)', unknown: 'var(--ar-fg-faint)' }
// What each breached host invariant is called on a card (fleet INVARIANTS.md families); the full readings are its tooltip.
const BREACH: Record<string, string> = { disk: 'disk below floor', load: 'load over limit', swap: 'swap over limit', capture: 'trace capture too long', orphans: 'deleted files held open', writes: 'disk writes over limit', codex: 'codex processes', wall: 'kiosk window' }
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const usd = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : `$${v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`)
const num = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : v.toFixed(digits))
const age = (iso: string | null) => {
  if (!iso) return '—'
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000)
  return min < 2 ? 'now' : min < 90 ? `${Math.round(min)} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`
}
const ago = (min: number) => age(new Date(Date.now() - min * 60_000).toISOString())
const asOf = (at: string | null, source: string) => (at ? { at, meaning: `when the host last read ${source} (${hm(at)})`, source } : null)

/** A section's own read time, shown only when it is older than the viewer's freshness window (AsOfStamp's 15 min). */
function StaleStamp({ at, source }: { at: string | null; source: string }) {
  if (at && Date.now() - Date.parse(at) <= 15 * 60_000) return null
  return at ? <AsOfStamp asOf={asOf(at, source)} /> : <span className="as-of is-stale">not read</span>
}

function Page({ mode, title, at, source, doc, children }: { mode: string; title: string; at?: string | null; source: string; doc: { error?: string; data?: unknown }; children: () => ReactNode }) {
  return (
    <div className="ws-page td wp" data-mode={mode}>
      <header className="td-head"><h1>{title}</h1><AsOfStamp asOf={asOf(at ?? null, source)} /></header>
      {doc.data ? <div className="wp-body">{children()}</div> : <p className="ws-status" role={doc.error ? 'alert' : 'status'}>{doc.error ? `${title} is unavailable: ${doc.error}` : `Reading ${source}…`}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Fleet

/** A host is up while its report's age (fleet now's reading of it plus the time since) is inside its limit; the local host
 * has no report of its own, so its card says how old the reading is and claims nothing. Unknown is neither. */
function hostUp(h: Host) { return h.reportMin === null || h.reportLimitMin === null ? null : h.reportMin <= h.reportLimitMin }

/** Free disk against its floor on one scale from 0 to 1.5 floors (free past that fills the bar); the floor is the tick. */
function DiskBar({ h }: { h: Host }) {
  if (h.diskFreeGb === null || h.diskFloorGb === null) return <span className="wp-muted">disk not reported</span>
  const top = Math.max(h.diskFloorGb * 1.5, 1)
  const below = h.diskFreeGb < h.diskFloorGb
  return (
    <Tip className="wp-bar" text={`${num(h.diskFreeGb, 1)} GB free; the floor is ${h.diskFloorGb} GB${below ? `, ${num(h.diskFloorGb - h.diskFreeGb, 1)} GB below it` : `, ${num(h.diskFreeGb - h.diskFloorGb, 1)} GB above it`}`}>
      <span className="wp-track"><span style={{ width: `${Math.min(100, (h.diskFreeGb / top) * 100)}%`, background: below ? TONE.breach : TONE.ok }} /><i style={{ left: `${(h.diskFloorGb / top) * 100}%` }} /></span>
      <span className="wp-val">{num(h.diskFreeGb)} GB free</span>
    </Tip>
  )
}

function HostCard({ h }: { h: Host }) {
  const up = hostUp(h)
  const perCore = h.load1 !== null && h.cores ? h.load1 / h.cores : null
  const loadShare = h.load1 !== null && h.loadLimit ? h.load1 / h.loadLimit : null
  return (
    <li className="wp-host" data-up={up === false ? 'no' : undefined}>
      <Tip className="wp-host-head" text={h.over ? `Over a limit: ${h.over}` : up ? 'Inside every limit it reports' : 'No fresh report'}>
        {/* The dot says whether the host reports (filled: up or freshly read; hollow: no report or unknown); breaches are the red line below. */}
        <i className="wp-dot" style={{ background: up || (h.local && h.reportMin !== null && h.reportMin < 15) ? TONE.ok : 'transparent', borderColor: up === false ? TONE.warn : up || h.local ? TONE.ok : TONE.unknown }} />
        <b>{h.name}</b>
        <span className={up === false ? 'wp-warn' : 'wp-muted'}>{h.local ? (h.reportMin === null ? 'not read' : h.reportMin < 2 ? 'read now' : `read ${ago(h.reportMin)} ago`) : up === null ? 'report age unknown' : up ? 'up' : `no report for ${ago(h.reportMin!)}`}</span>
      </Tip>
      <span className="wp-k">Load</span>
      <Tip className="wp-bar" text={`load1 ${num(h.load1, 1)} on ${h.cores ?? '—'} cores (${num(perCore, 2)} per core); the limit is ${num(h.loadLimit)}`}>
        <Meter used={h.load1} total={h.loadLimit} text={`${num(perCore, 1)} per core`} tone={loadShare !== null && loadShare >= 1 ? TONE.breach : loadShare !== null && loadShare >= 2 / 3 ? TONE.warn : 'var(--ar-accent)'} />
      </Tip>
      <span className="wp-k">Disk</span>
      <DiskBar h={h} />
      {h.breached.length > 0 && <Tip className="wp-over" text={h.over ?? ''}>{[...new Set(h.breached)].map((b) => BREACH[b] ?? b).join(' · ')}</Tip>}
    </li>
  )
}

const AGENT_TONE: Record<string, string> = { asks: TONE.warn, working: TONE.ok, blocked: TONE.breach, limited: TONE.warn, idle: 'var(--ar-fg-faint)' }

const AGENT_STATES = ['asks', 'blocked', 'limited', 'working'] as const

/** One state's agents behind its count: a name, its step as the tooltip, and how long since it last moved. */
function AgentGroup({ state, rows, count }: { state: Agent['state']; rows: Agent[]; count: number | null }) {
  if (!count) return null
  return (
    <details className="wp-group">
      <summary><i className="wp-dot" style={{ background: AGENT_TONE[state], borderColor: AGENT_TONE[state] }} />{count} {count === 1 && state === 'asks' ? 'ask' : state}</summary>
      <ul className="wp-rows">
        {rows.map((a) => (
          <li key={a.lane}>
            <i className="wp-dot" style={{ background: AGENT_TONE[a.state], borderColor: AGENT_TONE[a.state] }} />
            <Tip text={a.step ?? a.lane}><b>{a.name}</b></Tip>
            <span className="wp-muted">{a.state === 'limited' && a.limitUntil ? `until ${hm(a.limitUntil)}` : a.state}</span>
            <span className="wp-muted">{[a.harness, a.model].filter(Boolean).join(' · ')}</span>
            <Tip className="wp-num" text={a.since ? `last activity ${hm(a.since)}` : 'no activity recorded'}>{age(a.since)}</Tip>
          </li>
        ))}
      </ul>
    </details>
  )
}

function FleetView({ doc }: { doc: FleetDoc }) {
  const { counts } = doc.agents
  // A seat with no long-window reading is listed apart, never drawn as 0% (an unknown is not a zero).
  const read = doc.seats.rows.filter((s) => s.long.used !== null).sort((a, b) => b.long.used! - a.long.used!)
  const unread = doc.seats.rows.filter((s) => s.long.used === null)
  const back = doc.seats.rows.filter((s) => s.state === 'empty' && s.back).map((s) => s.back!).sort()[0]
  return (
    <>
      {/* The page's one primary region (disco-ui-review gate 1): the host capacity strip. Agents and seats are counts that open,
          in a column beside the hosts so the first screen holds the whole page. */}
      <div className="wp-fleet">
      <section aria-label="Hosts"><h2>Hosts<StaleStamp at={doc.hostsAt} source="fleet now" /></h2>
        <ul className="wp-hosts" data-primary-content>{doc.hosts.map((h) => <HostCard key={h.name} h={h} />)}</ul></section>
      <div className="wp-side">
        <section aria-label="Agents">
          <h2>Agents<StaleStamp at={doc.agentsAt} source="agent panes" /></h2>
          <Tip className="wp-agents-meter" text={(['working', 'asks', 'blocked', 'limited', 'idle'] as const).map((s) => `${counts[s] ?? '—'} ${s}`).join(', ')}><Meter text="" total={doc.agents.total} segments={(['working', 'asks', 'blocked', 'limited', 'idle'] as const).map((s) => ({ label: s, value: counts[s] ?? null, color: AGENT_TONE[s] }))} format={(v) => String(v)} /></Tip>
          <div className="wp-groups">
            {AGENT_STATES.map((state) => <AgentGroup key={state} state={state} count={counts[state] ?? null} rows={doc.agents.rows.filter((a) => a.state === state)} />)}
            <span className="wp-muted wp-idle">{counts.idle ?? '—'} idle</span>
          </div>
        </section>
        <section aria-label="Seats">
          <h2>Seats<StaleStamp at={doc.seatsAt} source="subscription quotas" /></h2>
          <details className="wp-group">
            <summary>{doc.seats.limited ?? '—'} of {doc.seats.total ?? '—'} at a limit{back ? `, first back ${hm(back)}` : ''}</summary>
            <HBars limit={read.length} max={1} format={pct}
              rows={read.map((s) => ({ label: `${s.provider.toLowerCase()} ${s.name}`, value: s.long.used!, color: s.state === 'empty' ? TONE.warn : undefined,
                note: [s.long.label, s.state === 'empty' ? `back ${s.back ? hm(s.back) : '—'}` : s.state === 'unknown' ? 'state unknown' : null].filter(Boolean).join(' · ') || undefined }))} />
            {unread.length > 0 && <p className="wp-muted wp-line">Not reported: {unread.map((s) => `${s.provider.toLowerCase()} ${s.name}${s.long.why ? ` (${s.long.why})` : ''}`).join(', ')}</p>}
          </details>
        </section>
      </div>
      </div>
    </>
  )
}

export function FleetPage({ api }: { api: string }) {
  const doc = useDocument<FleetDoc>(`${api}/wall/fleet`, 30_000, true)
  return <Page mode="fleet" title="Fleet" at={doc.data?.asOf} source="host reports, agents and seats" doc={doc}>{() => <FleetView doc={doc.data!} />}</Page>
}

// ---------------------------------------------------------------- Sandboxes

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return <div className="wp-stat"><span className="wp-k">{label}</span><b>{value}</b>{children}</div>
}

/** Retire an idle autoscaled host: the orchestrator's dry run first, then one click retires exactly the hosts it named. */
function Retire({ host, onDone }: { host: SandboxHost; onDone: () => void }) {
  const [reason, setReason] = useState('idle: nothing running or parked')
  const [plan, setPlan] = useState<{ result: string; retiring: { hostId: string }[]; kept: { hostId: string; why: string }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [births, setBirths] = useState(false)
  const act = async (dryRun: boolean, hostIds: string[]) => {
    setError(null)
    const response = await fetch('/api/act', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retire-hosts', dryRun, reason, hostIds, allowWhileBirthsEnabled: births }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body
  }
  const dry = () => act(true, [host.retire!]).then(setPlan, (e: Error) => setError(e.message))
  useEffect(() => { void dry() }, [])
  return (
    <div className="wp-retire" role="group" aria-label={`Retire ${host.name}`}>
      <input value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} aria-label="Reason the orchestrator logs" />
      <label><input type="checkbox" checked={births} onChange={(e) => setBirths(e.target.checked)} /> retire even while cloud births run</label>
      <span>{error ?? (plan ? (plan.retiring.length ? `Would retire ${plan.retiring.map((h) => h.hostId).join(', ')}` : `Kept: ${plan.kept.map((h) => h.why).join('; ') || plan.result}`) : 'Asking for a dry run…')}</span>
      <button type="button" onClick={dry}>Dry run again</button>
      <button type="button" disabled={!plan?.retiring.length} onClick={() => act(false, plan!.retiring.map((h) => h.hostId)).then(onDone, (e: Error) => setError(e.message))}>Retire</button>
    </div>
  )
}

function SandboxesView({ doc, writer }: { doc: SandboxesDoc; writer: boolean }) {
  const [retiring, setRetiring] = useState<string | null>(null)
  const t = doc.totals
  const key = doc.fleetKey
  const week = Date.now() / 1000 - 7 * 86_400
  const days = doc.spendDaily.subscription.map(([at]) => new Date(at * 1000).toISOString().slice(0, 10))
  const daily = (name: 'subscription' | 'api' | 'sandbox') => days.map((day) => doc.spendDaily[name].find(([at]) => new Date(at * 1000).toISOString().slice(0, 10) === day)?.[1] ?? null)
  const named = { subscription: 'Subscription at API prices', api: 'Billed API', sandbox: 'Billed sandbox' } as const
  const measured = (Object.keys(named) as (keyof typeof named)[]).filter((name) => doc.spendDaily[name].length)
  const spendTitle = `${measured.length === 1 ? named[measured[0]!] : 'Discovery spend'}, daily`
  const lastDay = days.at(-1)
  const spendStale = lastDay ? Date.now() - Date.parse(`${lastDay}T23:59:59Z`) > 2 * 86_400_000 : false
  if (!doc.known) return <p className="ws-status" role="alert">The host scan is unavailable: {doc.why ?? 'not reported'}</p>
  return (
    <>
      <div className="wp-stats">
        <Stat label="Autoscaled hosts" value={`${t.hosts ?? '—'} · ${usd(t.monthlyUsd)}/mo`}><Tip className={t.idleHosts ? 'wp-warn' : 'wp-muted'} text={`${t.idleHosts ?? '—'} idle, ${usd(t.idleMonthlyUsd)} a month; ${usd(t.perHourUsd, 2)} an hour at list price`}>{t.idleHosts ? `${t.idleHosts} idle` : 'none idle'}</Tip></Stat>
        <Stat label="Slots running" value={pct(t.runningShare)}><Tip text={`${t.running ?? '—'} of ${t.slots ?? '—'} slots run a sandbox; ${t.discoveryRunning ?? '—'} are Discovery's`}><Meter used={t.running} total={t.slots} tone="var(--ar-accent)" text="" /></Tip></Stat>
        <Stat label="Parked" value={String(t.parked ?? '—')}><Tip text={`${t.discoveryParked ?? '—'} of them Discovery's`}><Meter used={t.parked} total={t.slots} tone={TONE.warn} text="" /></Tip></Stat>
        <Stat label="Fleet key left" value={usd(key.leftUsd, 2)}><Tip text={`${key.name ?? 'Discovery fleet key'}: ${usd(key.spentUsd, 2)} spent of a ${usd(key.capUsd, 2)} cap`}><Meter used={key.spentUsd} total={key.capUsd} tone={key.leftUsd !== null && key.capUsd ? (key.leftUsd / key.capUsd < 0.1 ? TONE.warn : 'var(--ar-accent)') : undefined} text="" /></Tip></Stat>
      </div>
      <section aria-label="Hosts">
        {/* The page's one primary region (disco-ui-review gate 1): the hosts table. */}
        <table className="wp-table" data-primary-content>
          <thead><tr><th>Host</th><th>State</th><th>Slots used</th><th>CPU</th><th className="wp-r">Per month</th>{writer && <th />}</tr></thead>
          <tbody>
            {doc.hosts.map((h) => (
              <tr key={h.id} data-state={h.state}>
                <td><Tip text={`${h.id} · ${h.type}${h.heldBy && h.heldBy !== '—' ? ` · parked boxes held by ${h.heldBy}` : ''}`}><b>{h.name}</b></Tip> <span className="wp-muted">{h.type}</span></td>
                <td className={h.state === 'idle' ? 'wp-warn' : 'wp-muted'}>{h.state}</td>
                <td><Tip text={`${h.running ?? '—'} running and ${h.parked ?? '—'} parked of ${h.slots ?? '—'} slots`}><Meter used={(h.running ?? 0) + (h.parked ?? 0)} total={h.slots} tone={(h.occupied ?? 0) > 0.9 ? TONE.warn : 'var(--ar-accent)'} text={`${h.running ?? '—'} running · ${h.parked ?? '—'} parked of ${h.slots ?? '—'}`} /></Tip></td>
                <td><Tip text={`CPU ${pct(h.cpu)} at the host scan`}><Meter used={h.cpu} total={1} tone={(h.cpu ?? 0) > 0.85 ? TONE.warn : 'var(--ar-accent)'} text={pct(h.cpu)} /></Tip></td>
                <td className="wp-r wp-num">{usd(h.monthlyUsd)}</td>
                {writer && <td>{h.retire && h.state === 'idle' && <button type="button" onClick={() => setRetiring(h.id)}>Retire</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {retiring && <Retire host={doc.hosts.find((h) => h.id === retiring)!} onDone={() => setRetiring(null)} />}
      </section>
      <div className="wp-split">
        <section aria-label="Hosts over time"><h2><Tip text={`Autoscaler decision ${doc.scaler.decision}: ${doc.scaler.current} counted, target ${doc.scaler.target}, max ${doc.scaler.max}; birth breaker ${doc.scaler.breaker}; ${doc.scaler.pendingRetirement ?? 0} pending retirement; last error ${doc.scaler.error ?? 'none'}`}>Autoscaled hosts, 7 days</Tip></h2>
          <div><Lines series={[{ name: 'hosts', color: 'var(--ar-accent)', points: doc.hostsOverTime.filter(([at]) => at >= week).map(([at, n]) => [at * 1000, n]) }]} format={(v) => String(Math.round(v))} /></div></section>
        <section aria-label="Spend by kind"><h2>{spendTitle}{lastDay && <span className={spendStale ? 'as-of is-stale' : 'as-of'}>to {lastDay.slice(5)}</span>}</h2>
          <div><DayBars days={days} format={(v) => usd(v)} missing="not recorded" tick={(day) => day.slice(5)}
            series={[{ name: 'subscription at API prices', color: 'var(--ar-accent)', values: daily('subscription') }, { name: 'billed API', color: TONE.warn, values: daily('api') }, { name: 'billed sandbox', color: TONE.ok, values: daily('sandbox') }]} /></div>
        </section>
      </div>
      <div className="wp-foot">
      <details className="wp-group" aria-label="Why parked sandboxes stay"><summary>Why {t.parked ?? '—'} stay parked</summary>
        <div><HBars limit={doc.parked.length} format={(v) => String(v)} color={TONE.warn}
          rows={doc.parked.map((c) => ({ label: c.label, value: c.boxes, note: `${c.discovery} Discovery's${c.hours === null ? '' : ` · ${num(c.hours, 1)} h`}` }))} /></div>
      </details>
      {/* The harness latency matrix is still the wall's drawer (tangle-tools fleet/README.md "Harness lifecycle latency"). */}
      <a href="/?profile=discovery&drawer=harness-lifecycle#discovery-fleet">Harness latency</a>
      </div>
    </>
  )
}

export function SandboxesPage({ api }: { api: string }) {
  const doc = useDocument<SandboxesDoc>(`${api}/wall/sandboxes`, 60_000, true)
  const me = useDocument<{ writer: boolean }>(`${api}/me`)
  return <Page mode="sandboxes" title="Sandboxes" at={doc.data?.asOf} source="the host scan" doc={doc}>{() => <SandboxesView doc={doc.data!} writer={Boolean(me.data?.writer)} />}</Page>
}

// ---------------------------------------------------------------- Ideas

const STAGE_ORDER: Record<string, number> = { awaiting: 0, approved: 1, routed: 2, launched: 3, discarded: 4 }

/** A problem statement's title and the rest: its text before the first colon when short, else its first clause (up to a
 * comma, parenthesis or 8 words); the whole statement opens under it. */
const claim = (text: string): [string, string] => {
  const at = text.indexOf(':')
  if (at > 0 && at < 80) return [text.slice(0, at), text.slice(at + 1).trim()]
  const clause = text.split(/[,(;]/)[0]!.split(/\s+/)
  const title = clause.slice(0, 8).join(' ')
  return title.length < text.length ? [`${title}…`, text] : [text, '']
}

/** An idea: its title, where it goes and since when, the summary's first sentence (the rest opens), each problem as a
 * titled line that opens to its statement, and the link to decide it. */
function IdeaDetail({ idea, decideUrl }: { idea: Idea; decideUrl: string | null }) {
  const first = idea.summary.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? idea.summary
  const rest = idea.summary.slice(first.length).trim()
  return (
    <article className="wp-idea">
      <h2>#{idea.id} {idea.title}</h2>
      <p className="wp-muted">{idea.destination} · {idea.stage}{idea.created ? ` · ${age(idea.created)} ago` : ''}</p>
      <p>{first}</p>
      {rest && <details className="wp-group"><summary>More</summary><p>{rest}</p></details>}
      {idea.problemStatements.length > 0 && (
        <ol>
          {idea.problemStatements.map((statement) => {
            const [title, body] = claim(statement)
            return <li key={statement}>{body ? <details className="wp-group"><summary>{title}</summary><p>{body}</p></details> : title}</li>
          })}
        </ol>
      )}
      {decideUrl && <a className="wp-go" href={decideUrl}>{idea.stage === 'awaiting' ? 'Decide in Idea Triage' : 'Open in Idea Triage'}</a>}
    </article>
  )
}

function IdeasView({ doc }: { doc: IdeasDoc }) {
  const rows = [...doc.rows].sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) || Number(b.id) - Number(a.id))
  const awaiting = rows.filter((r) => r.stage === 'awaiting')
  const decided = rows.filter((r) => r.stage !== 'awaiting')
  const [picked, setPicked] = useState(() => new URLSearchParams(location.search).get('idea'))
  // An opened idea is a history entry, so Back returns to the one before (REVIEW-8 #1: Back left the wall).
  useEffect(() => {
    const back = () => setPicked(new URLSearchParams(location.search).get('idea'))
    addEventListener('popstate', back)
    return () => removeEventListener('popstate', back)
  }, [])
  const pick = (id: string) => {
    const next = id === picked ? null : id
    history.pushState(null, '', next ? `?idea=${encodeURIComponent(next)}` : location.pathname)
    setPicked(next)
  }
  const counted = doc.stages.filter((s) => s.count !== null)
  const max = Math.max(1, ...counted.map((s) => s.count!))
  return (
    <>
      <p className="tj-hero">{doc.awaiting === null ? 'The idea inbox was not read.' : doc.awaiting ? `${doc.awaiting} ${doc.awaiting === 1 ? 'idea waits' : 'ideas wait'} on you.` : 'No idea waits on you.'}</p>
      {/* The page's one primary region (disco-ui-review gate 1): the ideas awaiting Drew, each whole. */}
      {awaiting.length > 0 && <ul className="wp-awaiting" aria-label="Awaiting you" data-primary-content>{awaiting.map((r) => <li key={r.id}><IdeaDetail idea={r} decideUrl={doc.decideUrl} /></li>)}</ul>}
      <section aria-label="From intake to launch">
        <HBars limit={counted.length} max={max} format={(v) => String(v)} rows={counted.map((s) => ({ label: s.stage, value: s.count!, note: s.of !== null ? `of ${s.of} approved for Discovery` : undefined }))} />
        {counted.length < doc.stages.length && <p className="wp-muted wp-line">Not reported: {doc.stages.filter((s) => s.count === null).map((s) => s.stage).join(', ')}</p>}
      </section>
      <section aria-label="Decided">
        <h2>Decided</h2>
        <ul className="wp-rows wp-ideas">
          {decided.map((r) => (
            <li key={r.id} aria-current={r.id === picked || undefined}>
              <button type="button" aria-expanded={r.id === picked} onClick={() => pick(r.id)}>
                <i className="wp-dot" style={{ background: r.stage === 'discarded' ? 'transparent' : 'var(--ar-accent)', borderColor: 'var(--ar-accent)' }} />
                <b>{r.title}</b><span className="wp-muted">{r.stage}</span><span className="wp-num">{r.problems}</span>
              </button>
              {r.id === picked && <IdeaDetail idea={r} decideUrl={doc.decideUrl} />}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export function IdeasPage({ api }: { api: string }) {
  const doc = useDocument<IdeasDoc>(`${api}/wall/ideas`, 60_000, true)
  return <Page mode="ideas" title="Ideas" at={doc.data?.asOf} source="the idea inbox" doc={doc}>{() => <IdeasView doc={doc.data!} />}</Page>
}
