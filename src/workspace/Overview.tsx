import { useState, type ReactNode } from 'react'
import type { OverviewDocument, OverviewLead, OverviewPlayWeek, OverviewRun } from '../workspace.js'
import { useDocument } from './data.js'
import { bytes, ChartCard, compact, DayBars, Histogram, HBars, Legend, Lines, Meter, pct, SERIES, Spark, STATE_COLOR, usd } from './OverviewCharts.js'

// Five ranked causes plus "other". The six fixed slots passed the categorical validator on #16181f.
const LOSS_COLOR = [...SERIES, '#b97637']
const hours = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} h`

const ago = (value: string | null | undefined) => {
  if (!value) return 'never'
  const minutes = (Date.now() - Date.parse(value)) / 60_000
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min ago`
  return minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}
// A running run with no activity this long reads as needing a look (the composer's STUCK_AFTER_S).
const STALE_MS = 2 * 3_600_000
const label = (value: string) => value.replaceAll('-', ' ')
// Cost never mixes kinds: subscription use priced at API rates is not a bill; model API (Router) and sandbox compute are.
const money = (value: number | null | undefined) => (value === null || value === undefined ? '?' : value ? usd(value) : '—')
// Runs whose outcome is not known draw hollow, so they never pass for a near hue with a known outcome
// (unknown beside no winner, no record beside driver failed).
const HOLLOW = new Set(['unknown', 'no-record'])
const chipStyle = (state: string) => {
  const color = STATE_COLOR[state] ?? STATE_COLOR.unknown!
  return HOLLOW.has(state) || !STATE_COLOR[state] ? { boxShadow: `inset 0 0 0 2px ${color}` } : { background: color }
}
const sumOf = (values: (number | null)[] | undefined) => (values ?? []).reduce<number>((a, b) => a + (b ?? 0), 0)

function Section({ id, title, tone, aside, children }: { id?: string; title: string; tone: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ov-section" aria-label={title} id={id}>
      <div className="ov-section-head">
        <h2 className={`kicker ${tone}`}>{title}</h2>
        {aside}
      </div>
      <div className="ov-grid">{children}</div>
    </section>
  )
}

function Lead({ lead }: { lead: OverviewLead }) {
  return (
    <span className="ov-lead" title={lead.text || undefined}>
      <span className={`ov-lead-kind kind-${lead.kind}`}>{lead.kind}</span>
      <span className="ov-lead-title">{lead.title || 'untitled page'}</span>
    </span>
  )
}

/** One running run: what it is for, how long it has run, whether it is still moving, and what it has found so far. */
function RunningRow({ run }: { run: OverviewRun }) {
  const stale = Date.now() - Date.parse(run.activeAt ?? run.startedAt ?? '') > STALE_MS
  return (
    <li>
      <a className="ov-running-row" href={`/run/${encodeURIComponent(run.runId)}`}>
        <span className={`ov-light ${stale ? 'tone-fail' : 'tone-live'}`} aria-hidden="true" />
        <span className="ov-running-title">{run.title}</span>
        <span className="ov-running-meta">
          <span>started {ago(run.startedAt)}</span>
          <span className={stale ? 'is-stale' : undefined}>active {ago(run.activeAt)}</span>
          {run.agents !== null && <span>{run.agents} agents{run.depth !== null ? `, depth ${run.depth}` : ''}</span>}
          <span>{run.results} results · {run.claims} claims</span>
          <span>subscription {money(run.subscriptionUsd ?? run.listUsd)} at API prices · API {money(run.apiUsd)} · sandbox {money(run.sandboxUsd)}</span>
        </span>
        {run.purpose && <span className="ov-running-purpose">{run.purpose}</span>}
        {run.lead && <Lead lead={run.lead} />}
      </a>
    </li>
  )
}

/** One play's last week: each run as a chip in its end state, what the play found, what it lost and cost. */
function WeekRow({ play }: { play: OverviewPlayWeek }) {
  return (
    <li className={play.running ? 'is-running' : undefined}>
      <a className="ov-week-play" href={`/play/${encodeURIComponent(play.play)}`}>
        {play.title}
        {play.running > 0 && <span className="ov-badge tone-live">running</span>}
      </a>
      <span className="ov-week-runs">
        {play.runs.map((run) => (
          <a key={run.runId} className="ov-chip" href={`/run/${encodeURIComponent(run.runId)}`} style={chipStyle(run.state)}
            title={`${label(run.state)} · started ${run.startedAt?.slice(0, 16).replace('T', ' ') ?? 'unknown'} UTC${run.lostHours ? ` · ${hours(run.lostHours)} lost` : ''}`}
            aria-label={`run ${run.runId}, ${label(run.state)}`} />
        ))}
        {play.runCount > play.runs.length && <span className="ov-week-more">+{play.runCount - play.runs.length}</span>}
      </span>
      <span className="ov-week-found">
        {play.lead ? (
          <>
            <Lead lead={play.lead} />
            <span className="ov-week-counts">{play.results} results · {play.claims} claims</span>
          </>
        ) : (
          <span className="ov-week-none">no result or claim yet</span>
        )}
      </span>
      <span className={`ov-week-num ${play.lostHours >= 10 ? 'is-warn' : ''}`} data-label="lost">{play.lostHours ? hours(play.lostHours) : '—'}</span>
      <span className="ov-week-num" data-label="subscription">{money(play.subscriptionUsd ?? play.listUsd)}</span>
      <span className="ov-week-num" data-label="API">{money(play.apiUsd)}</span>
      <span className="ov-week-num" data-label="sandbox">{money(play.sandboxUsd)}</span>
      <span className="ov-week-num ov-week-ago" data-label="last run">{ago(play.lastStartedAt)}</span>
    </li>
  )
}

/**
 * The Discovery overview answers, in order: what is running now, what needs a person, what each play ran in the last
 * week and what it found; then the 30-day trends, then consumption (tokens, money, sandboxes, storage, seats). Every
 * number is what a store recorded; a series nobody measured says so instead of drawing zero.
 */
export function OverviewPage({ api }: { api: string }) {
  const doc = useDocument<OverviewDocument>(`${api}/overview`, 60_000, true)
  // The day charts and the totals above them follow this range; histograms and causes are the composed 30 days.
  const [range, setRange] = useState(14)
  const [weekShown, setWeekShown] = useState(25)
  if (doc.error && !doc.data) return <p className="ws-status" role="alert">The overview is unavailable: {doc.error}</p>
  if (!doc.data) return <p className="ws-status" role="status">Composing the overview…</p>
  const d = doc.data
  const cut = (values: (number | null)[] | undefined) => (values ?? []).slice(-range)
  const days = d.days.slice(-range)
  const runsByDay = Object.fromEntries(Object.entries(d.runs.byDay).map(([k, v]) => [k, cut(v)]))
  const lostByDay = Object.entries(d.runs.lostByDay ?? {}).map(([cause, values], i) => ({ name: label(cause), color: LOSS_COLOR[i] ?? LOSS_COLOR.at(-1)!, values: cut(values) }))
  const startsByDay = days.map((_, i) => Object.values(runsByDay).reduce((sum, values) => sum + (values[i] ?? 0), 0))
  const lostPerRun = days.map((_, i) => startsByDay[i] ? lostByDay.reduce((sum, cause) => sum + (cause.values[i] ?? 0), 0) / startsByDay[i]! : null)
  const findingsByDay = Object.fromEntries(Object.entries(d.findings.byDay).map(([k, v]) => [k, cut(v)]))
  const tokensByDay = { input: cut(d.tokens.byDay.input), output: cut(d.tokens.byDay.output), cacheRead: cut(d.tokens.byDay.cacheRead), cacheWrite: cut(d.tokens.byDay.cacheWrite) }
  const state = d.state
  const tokens = d.tokens
  const measured = tokens.harness.reduce((a, h) => a + h.measured, 0)
  const agents = tokens.harness.reduce((a, h) => a + h.agents, 0)
  const hosts = d.fleet.hosts
  const history = d.fleet.history
  const seats = [...d.seats.now].sort((a, b) => (b.d7 ?? -1) - (a.d7 ?? -1))
  const stood = state.standdown
  const cost = d.money.costByDay
  const costRuns = d.money.costRuns
  const infra = d.money.infra
  const infraDay = new Map(infra?.byDay?.map((row) => [row.date, row]))
  const infraValues = (field: 'hostUsd' | 'volumeUsd' | 'snapshotUsd' | 'r2Usd' | 'r2ListUsd' | 'egressBytes' | 'egressUsd') =>
    days.map((day) => infraDay.get(day)?.[field] ?? null)
  const running = d.now ?? []
  const attention = d.attention ?? []
  const week = d.week ?? []
  const weekDays = d.weekDays ?? 7
  const weekRuns = sumOf(week.map((p) => p.runCount))
  const weekResults = sumOf(week.map((p) => p.results))
  const weekClaims = sumOf(week.map((p) => p.claims))
  return (
    <div className="ws-page ov-page" data-overview>
      <div className="ov-now">
        <figure className="ov-card ov-now-runs" aria-label="Running now">
          <figcaption>
            <span className="ov-card-title">Running now</span>
            <span className="ov-card-sub">
              {state.running} running · {state.queued} queued · {state.sandboxesRunning ?? '—'} sandboxes ({state.sandboxesByKind.discovery ?? 0} Discovery)
            </span>
          </figcaption>
          {running.length ? (
            <ol className="ov-running">{running.map((run) => <RunningRow key={run.runId} run={run} />)}</ol>
          ) : (
            <p className="ov-quiet">
              Nothing is running.{' '}
              {stood
                ? `Research is stood down${stood.reason ? `: ${stood.reason}` : ''}.`
                : `The last research run started ${state.lastResearchStart ? `${state.lastResearchStart.slice(0, 16).replace('T', ' ')} UTC, ${ago(state.lastResearchStart)}` : 'never'}.`}
            </p>
          )}
        </figure>
        <figure className="ov-card ov-attention" aria-label="Needs you">
          <figcaption><span className="ov-card-title">Needs you</span></figcaption>
          {attention.length ? (
            <ul>
              {attention.map((item) => {
                const body = (
                  <>
                    <span className={`ov-light tone-${item.tone === 'crit' ? 'fail' : item.tone === 'warn' ? 'warn' : 'info'}`} aria-hidden="true" />
                    <span className="ov-attention-text">{item.text}{item.detail ? <small>{item.detail}</small> : null}</span>
                  </>
                )
                // An in-page anchor scrolls this page; the embed's <base target="_top"> would send it to the wall.
                return <li key={item.text}>{item.href ? <a href={item.href} target={item.href.startsWith('#') ? '_self' : undefined}>{body}</a> : <div>{body}</div>}</li>
              })}
            </ul>
          ) : (
            <p className="ov-quiet">Nothing needs you.</p>
          )}
        </figure>
      </div>

      <section className="ov-section" aria-label={`Last ${weekDays} days by play`}>
        <div className="ov-section-head">
          <h2 className="kicker tone-finding">Last {weekDays} days, by play</h2>
          <span className="ov-card-sub">{week.length} plays · {weekRuns} runs · {weekResults} results · {weekClaims} claims</span>
        </div>
        <Legend items={Object.keys(STATE_COLOR).filter((s) => s !== 'running' || running.length).map((s) => ({ name: label(s), color: STATE_COLOR[s]!, hollow: HOLLOW.has(s) }))} />
        <div className="ov-card ov-week">
          {week.length ? (
            <ol>
              <li className="ov-week-head" aria-hidden="true">
                <span>play</span><span>runs, newest first</span><span>what it found</span><span>lost</span><span>subscription</span><span>API</span><span>sandbox</span><span>last run</span>
              </li>
              {week.slice(0, weekShown).map((play) => <WeekRow key={play.play} play={play} />)}
              <li className="ov-week-total">
                <span>{week.length} plays</span><span>{weekRuns} runs</span><span>{weekResults} results · {weekClaims} claims</span>
                <span className="ov-week-num">{hours(sumOf(week.map((p) => p.lostHours)))}</span>
                <span className="ov-week-num">{usd(sumOf(week.map((p) => p.subscriptionUsd ?? p.listUsd)))}</span>
                <span className="ov-week-num">{usd(sumOf(week.map((p) => p.apiUsd ?? 0)))}</span>
                <span className="ov-week-num">{usd(sumOf(week.map((p) => p.sandboxUsd ?? 0)))}</span>
                <span />
              </li>
            </ol>
          ) : (
            <p className="ov-quiet">No run started in the last {weekDays} days.</p>
          )}
          {week.length > weekShown && (
            <button type="button" className="filter-chip ov-week-all" onClick={() => setWeekShown(week.length)}>Show all {week.length} plays</button>
          )}
          <p className="ov-note">Each chip is a run in its end state, hollow when the outcome is not known; smoke and archived runs are left out. Subscription is seat use priced at API rates and never billed; API is model spend billed through Router; sandbox is compute billed to the runs' keys; ? is not recorded, — is none.</p>
        </div>
      </section>

      <Section
        id="trends"
        title="Trends"
        tone="tone-info"
        aside={
          <div className="ov-toolbar" role="group" aria-label="Range">
            {[7, 14, 30].map((value) => (
              <button key={value} type="button" className={`filter-chip ${range === value ? 'on' : ''}`} aria-pressed={range === value} onClick={() => setRange(value)}>
                {value} days
              </button>
            ))}
          </div>
        }
      >
        <div className="ov-run-trends">
          <ChartCard title="Runs started per day, by how they ended" legend={Object.keys(STATE_COLOR).filter((s) => sumOf(runsByDay[s])).map((s) => ({ name: label(s), color: STATE_COLOR[s]! }))}>
            <DayBars days={days} series={Object.keys(STATE_COLOR).filter((s) => sumOf(runsByDay[s])).map((s) => ({ name: label(s), color: STATE_COLOR[s]!, values: runsByDay[s] ?? [] }))} />
          </ChartCard>
          <ChartCard title="Agent-hours lost per day, by cause" legend={lostByDay.map(({ name, color }) => ({ name, color }))} note="Top five causes over 30 days, plus other. Grouped by the day each run started.">
            {lostByDay.length ? <DayBars days={days} series={lostByDay} format={hours} /> : <p className="ov-empty">Loss by cause has not been composed yet.</p>}
          </ChartCard>
          <ChartCard title="Lost hours per run started" note="Daily lost hours divided by all catalog runs started that day. A day without a start has no rate.">
            {lostByDay.length ? <DayBars days={days} series={[{ name: 'lost hours per run', color: SERIES[0], values: lostPerRun }]} format={hours} /> : <p className="ov-empty">Loss by cause has not been composed yet.</p>}
          </ChartCard>
        </div>
        <ChartCard
          title="Findings written per day"
          legend={[{ name: 'results', color: SERIES[0] }, { name: 'claims', color: SERIES[2] }, { name: 'checks', color: SERIES[3] }]}
          note="Knowledge pages the agents wrote, by the day they wrote them (runs whose findings are derived)."
        >
          <DayBars days={days} series={[{ name: 'results', color: SERIES[0], values: findingsByDay.result ?? [] }, { name: 'claims', color: SERIES[2], values: findingsByDay.claim ?? [] }, { name: 'checks', color: SERIES[3], values: findingsByDay.check ?? [] }]} />
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
        <ChartCard title="Usage recorded, by harness" note={`${measured} of ${agents} agents (${pct(agents ? measured / agents : null)}) recorded token usage; the rest are unmeasured, not zero.`}>
          <HBars rows={tokens.harness.map((h) => ({ label: h.harness, value: h.agents, note: `${h.measured} measured · ${usd(h.list)} list` }))} format={(v) => `${v} agents`} color={SERIES[4]} />
        </ChartCard>
        <ChartCard title="Plays by output tokens" wide note="30 days. Subscription is seat use at API prices (not billed); API and sandbox are billed.">
          <HBars
            rows={tokens.topPlays.map((p) => ({ label: p.play, value: p.output, note: `${p.runs} runs · ${p.claims} claims · subscription ${usd(p.subscription ?? p.list)} at API prices · API ${usd(p.api ?? 0)} · sandbox ${usd(p.sandbox ?? 0)} · ${compact(p.cacheRead)} cache reads`, href: `/play/${encodeURIComponent(p.play)}` }))}
            color={SERIES[1]}
            limit={12}
          />
        </ChartCard>
      </Section>

      <Section id="money" title="Money" tone="tone-warn">
        <ChartCard title={`Cost by kind, ${range} days`} note={costRuns ? `${costRuns.counted} catalog runs in 30 days; ${costRuns.snapshots} spend snapshots. Router recorded for ${costRuns.api}, sandbox compute for ${costRuns.sandbox}; other amounts are unknown, not zero.` : undefined}>
          <dl className="ov-costs">
            <div><dt>Billed: model API (Router), measured subtotal</dt><dd>{costRuns?.api ? usd(sumOf(cut(cost?.api))) : '?'}</dd></div>
            <div><dt>Billed: sandbox compute, measured subtotal</dt><dd>{costRuns?.sandbox ? usd(sumOf(cut(cost?.sandbox))) : '?'}</dd></div>
            <div><dt>Not billed: subscription use at API prices</dt><dd>{costRuns?.subscription ? usd(sumOf(cut(cost?.subscription))) : '?'}</dd></div>
            {sumOf(cost?.otherList) > 0 && <div><dt>API-key agents at list price</dt><dd>{usd(sumOf(cut(cost?.otherList)))}</dd></div>}
          </dl>
        </ChartCard>
        <ChartCard title="Infrastructure billed to Discovery" note={infra ? `${infra.window.from?.slice(0, 10) ?? 'unknown start'}–${infra.window.to.slice(0, 10)} · measured ${ago(infra.generatedAt)}. Missing sources remain unknown.` : 'Infrastructure cost readings have not arrived.'}>
          <dl className="ov-costs">
            <div><dt>Hosts</dt><dd>{money(infra?.totals.hostUsd)}</dd></div>
            <div><dt>Hetzner volumes, including traces</dt><dd>{money(infra?.totals.volumeUsd)}</dd></div>
            <div><dt>Snapshots and backups</dt><dd>{money(infra?.totals.snapshotUsd)}</dd></div>
            <div><dt>Cloudflare R2</dt><dd>{money(infra?.totals.r2Usd)}</dd></div>
            <div><dt>Egress charges</dt><dd>{money(infra?.totals.egressUsd)}</dd></div>
          </dl>
          {infra?.totals.r2ListUsd != null ? <p className="ov-note">R2 storage at list rates: {usd(infra.totals.r2ListUsd)}; the billed allocation is unknown.</p> : null}
          {infra?.totals.r2DownloadBytesLowerBound != null ? <p className="ov-note">R2 download lower bound: {bytes(infra.totals.r2DownloadBytesLowerBound)}; R2 egress itself is free.</p> : null}
          {infra?.gaps?.length ? <p className="ov-note">Unmeasured: {infra.gaps.map((gap) => gap.detail).join(' · ')}</p> : null}
        </ChartCard>
        <ChartCard title="Provider bill reconciliation" note={infra?.reconciliation?.reason ?? 'No same-period provider bill is available.'}>
          <dl className="ov-costs">
            <div><dt>Discovery billed allocation, {infra?.reconciliation?.period ?? 'current period'}</dt><dd>{money(infra?.reconciliation?.billedUsd)}</dd></div>
            <div><dt>Prior bill evidence</dt><dd>{infra?.reconciliation?.priorBillEvidence?.length ?? 0} lines</dd></div>
          </dl>
          {infra?.reconciliation?.priorBillEvidence?.map((bill, i) => <p className="ov-note" key={`${bill.vendor}:${bill.item}:${i}`}>{bill.vendor}: {money(bill.monthlyUsd)}/month · {bill.asOf} · {bill.item}</p>)}
        </ChartCard>
        <ChartCard title="Hosts with Discovery sidecars" note="Provider list price and outbound counters are host-wide; Discovery share and egress charges are unknown.">
          <dl className="ov-costs">
            {(infra?.hosts ?? []).filter((host) => host.discoverySidecars).map((host) => <div key={host.id}><dt>{host.name ?? host.id} · {host.discoverySidecars} sidecars · {bytes(host.outgoingBytes)} outbound</dt><dd>{money(host.monthlyUsd)}/mo</dd></div>)}
          </dl>
        </ChartCard>
        <ChartCard title="Host allocation per day" note="Measured Discovery share of host fixed cost. A missing day has no allocation.">
          <DayBars days={days} series={[{ name: 'host', color: SERIES[2], values: infraValues('hostUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Storage charge per day" legend={[{ name: 'volumes', color: SERIES[1] }, { name: 'snapshots', color: SERIES[2] }, { name: 'R2', color: SERIES[4] }]} note="Billed storage categories; missing provider readings are unknown.">
          <DayBars days={days} series={[{ name: 'volumes', color: SERIES[1], values: infraValues('volumeUsd') }, { name: 'snapshots', color: SERIES[2], values: infraValues('snapshotUsd') }, { name: 'R2', color: SERIES[4], values: infraValues('r2Usd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="R2 storage at list rates per day" note="Direct Discovery bucket. Before the account free tier, operation charges and invoice rounding; not a billed amount.">
          <DayBars days={days} series={[{ name: 'R2 list rate', color: SERIES[4], values: infraValues('r2ListUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Egress bytes per day" note="Outbound traffic attributed to Discovery where a source records it.">
          <DayBars days={days} series={[{ name: 'outbound', color: SERIES[3], values: infraValues('egressBytes') }]} format={bytes} missing="No reading" />
        </ChartCard>
        <ChartCard title="Egress charges per day" note={`Measured outbound charges: ${bytes(infra?.totals.egressBytes)} total bytes. Bytes without a tariff have unknown cost.`}>
          <DayBars days={days} series={[{ name: 'egress', color: SERIES[3], values: infraValues('egressUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Billed per day" legend={[{ name: 'model API', color: SERIES[3] }, { name: 'sandbox compute', color: SERIES[1] }]} note="What was charged: model calls through Router and sandbox compute on the runs' keys.">
          <DayBars days={days} series={[{ name: 'model API', color: SERIES[3], values: cut(cost?.api) }, { name: 'sandbox compute', color: SERIES[1], values: cut(cost?.sandbox ?? d.money.paidByDay) }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Subscription use at API prices, per day" note="Seat use (Claude, Codex, Kimi, Gemini) priced at API list rates; covered by the seats, never billed.">
          <DayBars days={days} series={[{ name: 'subscription at API prices', color: SERIES[0], values: cut(cost?.subscription ?? d.money.listByDay) }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Subscription use at API prices, per run" note="30 days; not billed.">
          <Histogram bins={d.money.runListHistogram} unit="at API prices per run" format={usd} />
        </ChartCard>
        <ChartCard title="Discovery fleet key" note={`${usd(d.money.fleetKey.debits48h)} debited in the last 48 h.`}>
          <Meter used={d.money.fleetKey.spent} total={d.money.fleetKey.cap} format={usd} />
        </ChartCard>
        <ChartCard title="Autoscaled hosts, monthly price" note="14 days, from the fleet cost pass every ten minutes.">
          <Lines series={[{ name: 'monthly $', color: SERIES[0], points: history.map((h) => [h[0], h[4]] as [number, number]) }]} format={usd} />
        </ChartCard>
      </Section>

      <Section id="sandboxes" title="Sandboxes" tone="tone-neutral">
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

      <Section id="seats" title="Subscription seats" tone="tone-info">
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
