import { useState, type ReactNode } from 'react'
import type { OverviewDocument } from '../workspace.js'
import { useDocument } from './data.js'
import { bytes, ChartCard, compact, DayBars, Histogram, HBars, Lines, Meter, pct, SERIES, Spark, STATE_COLOR, usd } from './OverviewCharts.js'

const ago = (value: string | null | undefined) => {
  if (!value) return 'never'
  const hours = (Date.now() - Date.parse(value)) / 3_600_000
  return hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} days ago`
}
const label = (value: string) => value.replaceAll('-', ' ')
const sumOf = (values: number[] | undefined) => (values ?? []).reduce((a, b) => a + b, 0)

function Kpi({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'fail' }) {
  return (
    <div className={`ov-kpi ${tone ? `tone-${tone}` : ''}`}>
      <span className="ov-kpi-title">{title}</span>
      <span className="ov-kpi-value">{value}</span>
      {sub && <span className="ov-kpi-sub">{sub}</span>}
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <section className="ov-section" aria-label={title}>
      <h2 className={`kicker ${tone}`}>{title}</h2>
      <div className="ov-grid">{children}</div>
    </section>
  )
}

/**
 * The Discovery overview: a world view of the last 30 days. What the runs found and how they ended, the model tokens
 * and list price they consumed, what was paid, the sandbox fleet, storage and the subscription seats. Every number is
 * what a store recorded; a series nobody measured says so instead of drawing zero.
 */
export function OverviewPage({ api }: { api: string }) {
  const doc = useDocument<OverviewDocument>(`${api}/overview`, 60_000, true)
  // The day charts and the totals above them follow this range; histograms and causes are the composed 30 days.
  const [range, setRange] = useState(14)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">The overview is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Composing the overview…</p>
  const d = doc.data
  const cut = (values: number[] | undefined) => (values ?? []).slice(-range)
  const days = d.days.slice(-range)
  const runsByDay = Object.fromEntries(Object.entries(d.runs.byDay).map(([k, v]) => [k, cut(v)]))
  const findingsByDay = Object.fromEntries(Object.entries(d.findings.byDay).map(([k, v]) => [k, cut(v)]))
  const tokensByDay = { input: cut(d.tokens.byDay.input), output: cut(d.tokens.byDay.output), cacheRead: cut(d.tokens.byDay.cacheRead), cacheWrite: cut(d.tokens.byDay.cacheWrite) }
  const runsInRange = Object.values(runsByDay).reduce((a, v) => a + sumOf(v), 0)
  const state = d.state
  const tokens = d.tokens
  const measured = tokens.harness.reduce((a, h) => a + h.measured, 0)
  const agents = tokens.harness.reduce((a, h) => a + h.agents, 0)
  const findingsTotal = sumOf(findingsByDay.result) + sumOf(findingsByDay.claim)
  const hosts = d.fleet.hosts
  const history = d.fleet.history
  const seats = [...d.seats.now].sort((a, b) => (b.d7 ?? -1) - (a.d7 ?? -1))
  const stood = state.standdown
  const researchQuiet = !state.running && state.lastResearchStart && Date.now() - Date.parse(state.lastResearchStart) > 24 * 3_600_000
  return (
    <div className="ws-page ov-page" data-overview>
      <header className={`ov-banner ${stood ? 'tone-warn' : researchQuiet ? 'tone-warn' : 'tone-ok'}`}>
        <div>
          <h1>Discovery overview</h1>
          <p>
            {stood
              ? `Research is stood down${stood.reason ? `: ${stood.reason}` : ''}${stood.by ? ` (by ${stood.by})` : ''}.`
              : researchQuiet
                ? `No research run has started since ${state.lastResearchStart?.slice(0, 16).replace('T', ' ')} UTC (${ago(state.lastResearchStart)}). No stand-down flag is set on this host.`
                : `${state.running} run${state.running === 1 ? '' : 's'} running now. Last research run started ${state.lastResearchStart ? `${state.lastResearchStart.slice(0, 16).replace('T', ' ')} UTC (${ago(state.lastResearchStart)})` : 'never'}.`}
          </p>
        </div>
        <div className="ov-banner-facts">
          <span><b>{state.running}</b> running</span>
          <span><b>{state.queued}</b> queued</span>
          <span><b>{state.sandboxesRunning ?? '—'}</b> sandboxes now ({state.sandboxesByKind.discovery ?? 0} Discovery)</span>
          <span><b>{state.boxesUnreleased ?? '—'}</b> boxes unreleased</span>
        </div>
      </header>

      <div className="ov-toolbar" role="group" aria-label="Range">
        {[7, 14, 30].map((value) => (
          <button key={value} type="button" className={`filter-chip ${range === value ? 'on' : ''}`} aria-pressed={range === value} onClick={() => setRange(value)}>
            {value} days
          </button>
        ))}
      </div>

      <div className="ov-kpis">
        <Kpi title={`Runs started, ${range} d`} value={compact(runsInRange)} sub={`${sumOf(runsByDay.winner)} winners · ${sumOf(runsByDay['driver-failed'])} driver failed`} />
        <Kpi title={`Results and claims, ${range} d`} value={compact(findingsTotal)} sub="written by the agents, not yet reviewed" />
        <Kpi title={`Output tokens, ${range} d`} value={compact(sumOf(tokensByDay.output))} sub={`${compact(sumOf(tokensByDay.cacheRead))} cache reads`} />
        <Kpi title={`List price, ${range} d`} value={usd(sumOf(cut(d.money.listByDay)))} sub="subscription use, not billed" />
        <Kpi title={`Paid, ${range} d`} value={usd(sumOf(cut(d.money.paidByDay)))} sub="sandbox compute on run keys" />
        <Kpi title="Agent-hours lost, 30 d" value={compact(d.runs.lostHours)} sub="to limits, outages and retries" tone={d.runs.lostHours > 100 ? 'warn' : undefined} />
        <Kpi title="Usage measured, 30 d" value={pct(agents ? measured / agents : null)} sub={`${measured} of ${agents} agents recorded tokens`} tone={agents && measured / agents < 0.8 ? 'warn' : undefined} />
      </div>

      <Section title="Outcomes" tone="tone-finding">
        <ChartCard
          title="Findings written per day"
          legend={[{ name: 'results', color: SERIES[0] }, { name: 'claims', color: SERIES[2] }, { name: 'checks', color: SERIES[3] }]}
          note="Knowledge pages the agents wrote, by the day they wrote them (runs whose findings are derived)."
        >
          <DayBars days={days} series={[{ name: 'results', color: SERIES[0], values: findingsByDay.result ?? [] }, { name: 'claims', color: SERIES[2], values: findingsByDay.claim ?? [] }, { name: 'checks', color: SERIES[3], values: findingsByDay.check ?? [] }]} />
        </ChartCard>
        <ChartCard title="Runs started per day, by how they ended" legend={Object.keys(STATE_COLOR).filter((s) => sumOf(runsByDay[s])).map((s) => ({ name: label(s), color: STATE_COLOR[s]! }))}>
          <DayBars days={days} series={Object.keys(STATE_COLOR).filter((s) => sumOf(runsByDay[s])).map((s) => ({ name: label(s), color: STATE_COLOR[s]!, values: runsByDay[s] ?? [] }))} />
        </ChartCard>
        <ChartCard title="Why runs failed" note="Root cause of each driver-failed or failed run, 30 days.">
          <HBars rows={d.runs.causes.map(([cause, n]) => ({ label: label(cause), value: n }))} color="var(--ar-c-fail)" />
        </ChartCard>
        <ChartCard title="Agents per run" note={`Depth: ${d.runs.depth.map(([k, n]) => `${k} → ${n}`).join(' · ')}`}>
          <Histogram bins={d.runs.agentsHistogram} unit="agents" format={(v) => String(Math.round(v))} />
        </ChartCard>
      </Section>

      <Section title="Model work" tone="tone-info">
        <ChartCard title="Input and output tokens per day" legend={[{ name: 'output', color: SERIES[1] }, { name: 'input', color: SERIES[0] }]} note="By the day each run started. Input excludes cache reads and writes.">
          <DayBars days={days} series={[{ name: 'output', color: SERIES[1], values: tokensByDay.output }, { name: 'input', color: SERIES[0], values: tokensByDay.input }]} />
        </ChartCard>
        <ChartCard title="Cache reads and writes per day" legend={[{ name: 'cache reads', color: SERIES[3] }, { name: 'cache writes', color: SERIES[2] }]} note="The same context re-read each turn: most of the tokens, a fraction of the price.">
          <DayBars days={days} series={[{ name: 'cache reads', color: SERIES[3], values: tokensByDay.cacheRead }, { name: 'cache writes', color: SERIES[2], values: tokensByDay.cacheWrite }]} />
        </ChartCard>
        <ChartCard title="Output tokens per agent" note="How much each measured agent wrote, on a log scale.">
          <Histogram bins={tokens.agentOutputHistogram} unit="output tokens" color={SERIES[1]} />
        </ChartCard>
        <ChartCard title="Usage recorded, by harness" note="Agents whose record carries token usage; the rest are unmeasured, not zero.">
          <HBars rows={tokens.harness.map((h) => ({ label: h.harness, value: h.agents, note: `${h.measured} measured · ${usd(h.list)} list` }))} format={(v) => `${v} agents`} color={SERIES[4]} />
        </ChartCard>
        <ChartCard title="Plays by output tokens" wide note="30 days. List price is subscription use at API prices; paid is sandbox compute.">
          <HBars
            rows={tokens.topPlays.map((p) => ({ label: p.play, value: p.output, note: `${p.runs} runs · ${p.claims} claims · ${usd(p.list)} list · ${usd(p.paid)} paid · ${compact(p.cacheRead)} cache reads`, href: `/play/${encodeURIComponent(p.play)}` }))}
            color={SERIES[1]}
            limit={12}
          />
        </ChartCard>
      </Section>

      <Section title="Money" tone="tone-warn">
        <ChartCard title="List price per day" note="Subscription use priced at API list; never billed.">
          <DayBars days={days} series={[{ name: 'list price', color: SERIES[0], values: cut(d.money.listByDay) }]} format={usd} />
        </ChartCard>
        <ChartCard title="Paid per day" note="Sandbox compute charged to the runs' keys.">
          <DayBars days={days} series={[{ name: 'paid', color: SERIES[1], values: cut(d.money.paidByDay) }]} format={usd} />
        </ChartCard>
        <ChartCard title="List price per run">
          <Histogram bins={d.money.runListHistogram} unit="list $ per run" format={usd} />
        </ChartCard>
        <ChartCard title="Discovery fleet key" note={`${usd(d.money.fleetKey.debits48h)} debited in the last 48 h.`}>
          <Meter used={d.money.fleetKey.spent} total={d.money.fleetKey.cap} format={usd} />
        </ChartCard>
        <ChartCard title="Autoscaled hosts, monthly price" note="14 days, from the fleet cost pass every ten minutes.">
          <Lines series={[{ name: 'monthly $', color: SERIES[0], points: history.map((h) => [h[0], h[4]] as [number, number]) }]} format={usd} />
        </ChartCard>
      </Section>

      <Section title="Sandboxes" tone="tone-neutral">
        <ChartCard title="Boxes running and parked" legend={[{ name: 'running', color: SERIES[0] }, { name: 'parked', color: SERIES[1] }]} note="14 days. Parked boxes hold a host slot without running.">
          <Lines series={[{ name: 'running', color: SERIES[0], points: history.map((h) => [h[0], h[1]] as [number, number]) }, { name: 'parked', color: SERIES[1], points: history.map((h) => [h[0], h[2]] as [number, number]) }]} />
        </ChartCard>
        <ChartCard title="Why boxes stay" note="Boxes by the reason they are held, with the median hours parked.">
          <HBars rows={d.fleet.waste.map((w) => ({ label: w.label, value: w.boxes, note: w.hours ? `${compact(w.hours)} h median` : undefined, color: w.waste ? 'var(--ar-c-run)' : SERIES[0] }))} format={(v) => `${v} boxes`} />
        </ChartCard>
        <ChartCard title="Hosts" wide note={`${d.fleet.totals.hosts ?? hosts.length} hosts · autoscaled ${usd(d.fleet.totals.autoscaledMonthlyUsd)} a month · Hetzner cloud ${usd(d.fleet.totals.hetznerCloudMonthlyUsd)} a month`}>
          <div className="ov-hosts">
            {hosts.map((h) => (
              <div key={h.name} className="ov-host">
                <span className="ov-host-name" title={h.name}>{h.name.replace('autoscale-prod-', 'auto-').slice(0, 18)} <small>{h.type}{h.draining ? ' · draining' : ''}</small></span>
                <span>slots <Meter used={h.active + h.parked} total={h.capacity} text={`${h.active} running · ${h.parked} parked of ${h.capacity}`} /></span>
                <span>CPU <Meter used={h.cpu} total={100} text={h.cpu === null ? '—' : `${Math.round(h.cpu)}%`} /></span>
                <span>memory <Meter used={h.memory} total={100} text={h.memory === null ? '—' : `${Math.round(h.memory)}%`} /></span>
                <span className="ov-host-price">{usd(h.monthlyUsd)}/mo</span>
              </div>
            ))}
          </div>
        </ChartCard>
        <ChartCard title="Reaper, last hour">
          <HBars rows={Object.entries(d.fleet.reaper).map(([k, v]) => ({ label: label(k.replaceAll('_', ' ')), value: v }))} color={SERIES[2]} />
        </ChartCard>
      </Section>

      <Section title="Storage" tone="tone-neutral">
        <ChartCard title="Traces volume" note={d.storage.volume?.path}>
          <Meter used={d.storage.volume?.used} total={d.storage.volume?.total} format={bytes} />
          <p className="ov-note">Record files: {bytes(d.storage.recordsBytes)}</p>
        </ChartCard>
        <ChartCard title="Run directories by program" note="30 days, the size the catalog recorded for each run.">
          <HBars rows={d.storage.byProgram.map(([program, size]) => ({ label: program, value: size }))} format={bytes} color={SERIES[2]} />
        </ChartCard>
        <ChartCard title="Run directory size">
          <Histogram bins={d.storage.runSizeHistogram} unit="per run" format={bytes} color={SERIES[2]} />
        </ChartCard>
      </Section>

      <Section title="Subscription seats" tone="tone-info">
        <ChartCard title="Weekly and 5-hour use per seat" wide note="Utilization the provider reports for each seat; the line is the weekly use since sampling began.">
          <ol className="ov-seats">
            {seats.map((seat) => (
              <li key={`${seat.tool}:${seat.email}`}>
                <span className="ov-seat-name"><b>{seat.tool}</b> {seat.email}</span>
                <span>week <Meter used={seat.d7} total={1} text={pct(seat.d7)} /></span>
                <span>5 h <Meter used={seat.h5} total={1} text={pct(seat.h5)} /></span>
                <Spark points={d.seats.history[`${seat.tool}:${seat.email}`] ?? []} />
              </li>
            ))}
          </ol>
        </ChartCard>
      </Section>
      <p className="faint ov-composed">Composed {d.composedAt.slice(0, 16).replace('T', ' ')} UTC from the run catalog, record metas, spend snapshots, cached findings, fleet cost, the census and acct.</p>
    </div>
  )
}
