import { useState, type ReactNode } from 'react'
import type { OverviewDocument, OverviewLead, OverviewPlayWeek, OverviewRun } from '../workspace.js'
import { dataStatus, StatusPill, statusOf, useDocument } from './data.js'
import { plain } from './FindingsFeed.js'
import { byEnding, bytes, ChartCard, compact, DayBars, Histogram, HBars, Lines, Meter, pct, SERIES, Spark, usd } from './OverviewCharts.js'
import { hostWords } from './play-standing.js'

// Five ranked causes plus "other", none in a status hue: the series slots, then indigo, and "other" in faint ink.
const LOSS_COLOR = [...SERIES.slice(0, 4), SERIES[4] ?? '#3a4bc4', 'var(--ar-fg-faint)']
const hours = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} h`

const ago = (value: string | null | undefined) => {
  if (!value) return 'never'
  const minutes = (Date.now() - Date.parse(value)) / 60_000
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min ago`
  return minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}
// A running run with no activity this long reads as needing a look (the composer's STUCK_AFTER_S).
const STALE_MS = 2 * 3_600_000
// A host `unknown` key is an unknown, worded as one (design-system section 2).
const label = (value: string) => (value === 'unknown' ? 'not recorded' : value.replaceAll('-', ' '))
// Cost never mixes kinds: subscription use priced at API rates is not a bill; model API (Router) and sandbox compute are.
const money = (value: number | null | undefined) => (value === null || value === undefined ? '?' : value ? usd(value) : '—')
const costNote = (kind: string, value: number | null | undefined, known: number | undefined, runs: number) =>
  !known || value == null ? `${kind} not recorded` : `${kind} ${usd(value)}${known < runs ? ` known in ${known}/${runs} runs` : ''}`
/** A play's API-equivalent cost over its week: the runs' receipts when the host read them, else subscription use at API
 * prices. A zero over runs whose usage is unknown is unknown ('?', never '$0.00'); '+' marks a subtotal with unknown runs. */
const weekCost = (play: OverviewPlayWeek) => {
  const value = play.apiEquivalentUsd ?? play.subscriptionUsd ?? play.listUsd
  const unknown = play.costUnknownRuns ?? 0
  if (value === null || value === undefined || (unknown >= play.runCount && !value)) return '?'
  return `${money(value)}${unknown > 0 ? '+' : ''}`
}

/**
 * Cost rows with unknowns kept apart (design-system section 2): a card whose rows are mostly unknown collapses to one
 * line naming them; otherwise known rows print their value and an unknown row says "not recorded" in small text, never a
 * display-size "?".
 */
function CostRows({ subject, rows }: { subject: string; rows: { label: string; value: number | null | undefined; text?: string; short?: string }[] }) {
  const unknown = rows.filter((row) => row.value === null || row.value === undefined)
  if (unknown.length * 2 > rows.length)
    return <p className="ov-note" data-unknown-sources={unknown.length}>{subject}: {unknown.length} of {rows.length} sources not measured ({unknown.map((row) => row.short ?? row.label).join(', ')}).</p>
  return (
    <dl className="ov-costs">
      {rows.map((row) => (
        <div key={row.label}><dt>{row.label}</dt><dd>{row.value === null || row.value === undefined ? <small className="ov-unknown">not recorded</small> : (row.text ?? usd(row.value))}</dd></div>
      ))}
    </dl>
  )
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

/**
 * What a run found: a passed play check, else the newest check line and best score of a run whose checks never passed
 * (`progress`), else its best page. The title comes before the text (R12): the title says what it is, the text its lines.
 */
function Lead({ lead }: { lead: OverviewLead }) {
  const title = hostWords(plain(lead.title))
  const text = hostWords(plain(lead.text))
  // A research miss is "No pass yet" in neutral ink with its workloads, never a red tint (design-system section 1).
  const workloads = /(\d+)\s*(?:of|\/)\s*(\d+)\s*workloads/.exec(`${lead.title ?? ''} ${lead.text ?? ''}`)
  const result = lead.kind === 'progress' ? statusOf({ axis: 'result', verdict: lead.verdict ?? 'not-solved', passed: workloads ? Number(workloads[1]) : null, total: workloads ? Number(workloads[2]) : null }) : null
  const kind = lead.kind === 'check' ? 'check passed' : lead.kind
  const words = [title, text && text !== title ? text : ''].filter(Boolean)
  return (
    <span className="ov-lead" title={words.join(' · ') || undefined}>
      {result ? <StatusPill status={result} className="ov-lead-kind" /> : <span className={`ov-lead-kind kind-${lead.kind}`}>{kind}</span>}
      <span className="ov-lead-title">{title && <b>{title}</b>}{title && words.length > 1 ? ' · ' : ''}{words.length ? words.filter((word) => word !== title).join(' · ') : 'No answer recorded'}</span>
    </span>
  )
}

/** One running run: what it is for, how long it has run, whether it is still moving, and what it has found so far. */
function RunningRow({ run }: { run: OverviewRun }) {
  const stale = Date.now() - Date.parse(run.activeAt ?? run.startedAt ?? '') > STALE_MS
  // A running run is amber wherever it appears; a quiet one says so in words, and needs a person only when the host
  // raises it in Needs you.
  const running = statusOf({ axis: 'run', state: 'running' })
  return (
    <li>
      <a className="ov-running-row" href={`/run/${encodeURIComponent(run.runId)}`}>
        <span className="ov-light" data-status={dataStatus(running)} aria-hidden="true">{running.shape}</span>
        <span className="ov-running-title">{run.title}</span>
        <span className="ov-running-meta">
          <span>started {ago(run.startedAt)}</span>
          <span>{stale ? 'quiet since' : 'active'} {ago(run.activeAt)}</span>
          {run.agents !== null && <span>{run.agents} agents{run.depth !== null ? `, depth ${run.depth}` : ''}</span>}
          <span>{run.findingsPending ? 'findings not available yet' : `${run.results} results · ${run.claims} claims`}</span>
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
        {play.running > 0 && <span className="ov-badge">running</span>}
      </a>
      <span className="ov-week-runs">
        {play.runs.map((run) => {
          // Each run is its status shape in its tone, inside a 24 px hit box.
          const status = statusOf({ axis: 'run', state: run.state })
          return (
            <a key={run.runId} className="ov-chip" href={`/run/${encodeURIComponent(run.runId)}`} data-status={dataStatus(status)}
              title={`${status.word} · started ${run.startedAt?.slice(0, 16).replace('T', ' ') ?? 'unknown'} UTC${run.lostHours ? ` · ${hours(run.lostHours)} lost` : ''}`}
              aria-label={`run ${run.runId}, ${status.word}`}>
              <i aria-hidden="true">{status.shape}</i>
            </a>
          )
        })}
        {play.runCount > play.runs.length && <span className="ov-week-more">+{play.runCount - play.runs.length}</span>}
      </span>
      <span className="ov-week-found">
        {play.lead ? (
          <>
            <Lead lead={play.lead} />
            <span className="ov-week-counts">{play.results} results · {play.claims} claims</span>
          </>
        ) : (
          <span className="ov-week-none">{play.findingsPending ? `${play.findingsPending} run${play.findingsPending === 1 ? '' : 's'} without findings data` : 'no result or claim yet'}</span>
        )}
      </span>
      <span className="ov-week-num" data-label="lost">{play.lostHours ? hours(play.lostHours) : '—'}</span>
      <span className="ov-week-num" data-label="API-equivalent" title="Every token at API list price, whoever paid; + means some runs have no reading">{weekCost(play)}</span>
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
  const infraValues = (field: 'hostUsd' | 'volumeUsd' | 'snapshotUsd' | 'r2Usd' | 'r2ListUsd' | 'r2StorageListUsd' | 'r2OperationsListUsd' | 'egressBytes' | 'egressUsd') =>
    days.map((day) => infraDay.get(day)?.[field] ?? null)
  const running = d.now ?? []
  const attention = d.attention ?? []
  const week = d.week ?? []
  const weekDays = d.weekDays ?? 7
  const weekRuns = sumOf(week.map((p) => p.runCount))
  const weekResults = sumOf(week.map((p) => p.results))
  const weekClaims = sumOf(week.map((p) => p.claims))
  const weekCostTotal = week.reduce((sum, play) => sum + (play.apiEquivalentUsd ?? play.subscriptionUsd ?? play.listUsd ?? 0), 0)
  const weekCostUnknown = week.some((play) => (play.costUnknownRuns ?? 0) > 0)
  return (
    <div className="ws-page ov-page" data-overview>
      <div className="ov-now">
        <figure className="ov-card ov-now-runs" aria-label="Running now">
          <figcaption>
            <span className="ov-card-title">Running now</span>
            {/* A copy served while the overview recomposes says when it was composed; its running runs are read now. */}
            {doc.stale && <span className="ov-stale" data-stale>as of {d.composedAt.slice(11, 16)}Z · refreshing</span>}
            <span className="ov-card-sub">
              {running.length} running · {state.queued} queued
              {/* An unread census is left out rather than printed as "— (unknown)"; a census read earlier says how old it is. */}
              {state.sandboxesRunning != null && <> · {state.sandboxesRunning} sandboxes{state.sandboxesByKind.discovery != null ? ` (${state.sandboxesByKind.discovery} Discovery)` : ''}{state.censusAt ? `, census ${ago(state.censusAt)}` : ''}</>}
            </span>
          </figcaption>
          {running.length ? (
            <ol className="ov-running">{running.map((run) => <RunningRow key={run.runId} run={run} />)}</ol>
          ) : (
            <p className="ov-quiet">
              Nothing is running.{' '}
              {stood
                ? `Research is stood down${stood.reason ? `: ${stood.reason}` : ''}.`
                : `The last Discovery run started ${state.lastRunStart ? `${state.lastRunStart.slice(0, 16).replace('T', ' ')} UTC, ${ago(state.lastRunStart)}` : 'never'}.`}
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
                    {/* Only a crit item is red, and it names its owner in its own text; warn and info are neutral. */}
                    <StatusPill status={statusOf({ axis: 'alert', tone: item.tone, live: true })} className="ov-light">
                      {item.tone === 'crit' ? `act now · ${item.owner || 'Discovery operator'}` : undefined}
                    </StatusPill>
                    <span className="ov-attention-text">{hostWords(item.text)}{item.detail ? <small>{hostWords(item.detail)}</small> : null}
                      <small>{item.owner || 'Discovery operator'} · {item.next || 'Review this item'}</small></span>
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
          <span className="ov-card-sub">{week.length} plays · {weekRuns} runs · {weekResults} results · {weekClaims} claims{week.some((play) => play.findingsPending) ? ' · findings incomplete' : ''}</span>
        </div>
        <p className="ov-legend" aria-label="Run chip shapes">
          {[...new Map(week.flatMap((play) => play.runs).map((run) => statusOf({ axis: 'run', state: run.state })).map((status) => [status.shape, status])).values()].map((status) => (
            <span key={status.shape}><i aria-hidden="true">{status.shape}</i> <span className="faint">{status.word.replace(/ \(.*\)$/, '')}</span></span>
          ))}
        </p>
        <div className="ov-card ov-week">
          {week.length ? (
            <ol>
              <li className="ov-week-head" aria-hidden="true">
                <span>play</span><span>runs, newest first</span><span>what it found</span><span>lost</span><span>API-equivalent</span><span>last run</span>
              </li>
              {week.slice(0, weekShown).map((play) => <WeekRow key={play.play} play={play} />)}
              <li className="ov-week-total">
                <span>{week.length} plays</span><span>{weekRuns} runs</span><span>{weekResults} results · {weekClaims} claims</span>
                <span className="ov-week-num">{hours(sumOf(week.map((p) => p.lostHours)))}</span>
                <span className="ov-week-num" title="Known subtotal; + means some runs have no reading">{weekCostTotal ? `${usd(weekCostTotal)}${weekCostUnknown ? '+' : ''}` : '?'}</span>
                <span />
              </li>
            </ol>
          ) : (
            <p className="ov-quiet">No run started in the last {weekDays} days.</p>
          )}
          {week.length > weekShown && (
            <button type="button" className="filter-chip ov-week-all" onClick={() => setWeekShown(week.length)}>Show all {week.length} plays</button>
          )}
          <p className="ov-note">Each chip is a run's status shape; smoke and archived runs are left out. API-equivalent prices every token at API list rates, whoever paid (a subscription seat bills nothing); ? is not recorded, + a subtotal with runs unread. Billed model API and sandbox compute are on each play's Spend tab.</p>
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
        <div className="ov-loss-total" aria-label="Agent-hours lost in 30 days">
          <span className="ov-loss-total-label">Agent-hours lost · 30 days</span>
          <strong>{hours(d.runs.lostHours)}</strong>
          <span className="ov-loss-total-scope">{d.runs.scope ?? 'All indexed and current live runs started in the last 30 UTC days'}</span>
        </div>
        <div className="ov-run-trends">
          <ChartCard title="Runs started per day, by how they ended" values={Object.values(runsByDay).flat()} legend={byEnding(runsByDay).map(({ name, color }) => ({ name, color }))}>
            <DayBars days={days} series={byEnding(runsByDay)} />
          </ChartCard>
          <ChartCard title="Agent-hours lost per day, by cause" values={lostByDay.flatMap((cause) => cause.values)} legend={lostByDay.map(({ name, color }) => ({ name, color }))} note={`Top five causes over ${range} days, plus other. Grouped by the day each run started.`}>
            <DayBars days={days} series={lostByDay} format={hours} />
          </ChartCard>
        </div>
        <ChartCard
          title="Findings written per day"
          values={Object.values(findingsByDay).flat()}
          legend={[{ name: 'results', color: SERIES[0] }, { name: 'claims', color: SERIES[2] }, { name: 'checks', color: SERIES[3] }]}
          note="Knowledge pages the agents wrote, by the day they wrote them (runs whose findings are derived)."
        >
          <DayBars days={days} series={[{ name: 'results', color: SERIES[0], values: findingsByDay.result ?? [] }, { name: 'claims', color: SERIES[2], values: findingsByDay.claim ?? [] }, { name: 'checks', color: SERIES[3], values: findingsByDay.check ?? [] }]} />
        </ChartCard>
        <ChartCard title="Why runs crashed" values={d.runs.causes.map(([, n]) => n)} note="Root cause of each run that crashed (the driver or the run), 30 days.">
          <HBars rows={d.runs.causes.map(([cause, n]) => ({ label: label(cause), value: n }))} color="var(--ar-c-neutral)" />
        </ChartCard>
        <ChartCard title="Agents per run" values={d.runs.agentsHistogram.map((bin) => bin.n)} note={`Depth: ${d.runs.depth.map(([k, n]) => `${label(String(k))} → ${n}`).join(' · ')}`}>
          <Histogram bins={d.runs.agentsHistogram} unit="agents" format={(v) => String(Math.round(v))} />
        </ChartCard>
      </Section>

      <Section title="Model work" tone="tone-info">
        <ChartCard title="Input and output tokens per day" values={[...tokensByDay.input, ...tokensByDay.output]} usageKnown={measured === agents} legend={[{ name: 'output', color: SERIES[1] }, { name: 'input', color: SERIES[0] }]} note="By the day each run started. Input excludes cache reads and writes.">
          <DayBars days={days} series={[{ name: 'output', color: SERIES[1], values: tokensByDay.output }, { name: 'input', color: SERIES[0], values: tokensByDay.input }]} />
        </ChartCard>
        <ChartCard title="Cache reads and writes per day" values={[...tokensByDay.cacheRead, ...tokensByDay.cacheWrite]} usageKnown={measured === agents} legend={[{ name: 'cache reads', color: SERIES[3] }, { name: 'cache writes', color: SERIES[2] }]} note="The same context re-read each turn: most of the tokens, a fraction of the price.">
          <DayBars days={days} series={[{ name: 'cache reads', color: SERIES[3], values: tokensByDay.cacheRead }, { name: 'cache writes', color: SERIES[2], values: tokensByDay.cacheWrite }]} />
        </ChartCard>
        <ChartCard title="Output tokens per agent" values={tokens.agentOutputHistogram.map((bin) => bin.n)} note="How much each measured agent wrote, on a log scale.">
          <Histogram bins={tokens.agentOutputHistogram} unit="output tokens" color={SERIES[1]} />
        </ChartCard>
        <ChartCard title="Usage recorded, by harness" values={tokens.harness.map((h) => h.measured)} usageKnown={false} note={`${measured} of ${agents} agents (${pct(agents ? measured / agents : null)}) recorded token usage; the rest are unmeasured, not zero.`}>
          <HBars rows={tokens.harness.map((h) => ({ label: h.harness, value: h.agents, note: `${h.measured} measured · ${usd(h.list)} list` }))} format={(v) => `${v} agents`} color={SERIES[4]} />
        </ChartCard>
        <ChartCard title="Plays by output tokens" values={tokens.topPlays.map((p) => p.output)} usageKnown={false} wide note="30 days. Subscription is seat use at API prices (not billed); API and sandbox are billed.">
          <HBars
            rows={tokens.topPlays.map((p) => ({ label: p.play, value: p.output, note: `${p.runs} runs · ${p.claims} claims · subscription ${usd(p.subscription ?? p.list)} at API prices · ${costNote('API', p.api, p.apiKnown, p.runs)} · ${costNote('sandbox', p.sandbox, p.sandboxKnown, p.runs)} · ${compact(p.cacheRead)} cache reads`, href: `/play/${encodeURIComponent(p.play)}` }))}
            color={SERIES[1]}
            limit={12}
          />
        </ChartCard>
      </Section>

      <Section id="money" title="Money" tone="tone-neutral">
        <ChartCard title={`Cost by kind, ${range} days`} values={[costRuns?.api ? sumOf(cut(cost?.api)) : null, costRuns?.sandbox ? sumOf(cut(cost?.sandbox)) : null, costRuns?.subscription ? sumOf(cut(cost?.subscription)) : null]} note={costRuns ? `${costRuns.counted} catalog runs in 30 days; ${costRuns.snapshots} spend snapshots. Router recorded for ${costRuns.api}, sandbox compute for ${costRuns.sandbox}; other amounts are not measured, not zero.` : undefined}>
          <CostRows subject="Cost by kind" rows={[
            { label: 'Billed: model API (Router), measured subtotal', short: 'model API', value: costRuns?.api ? sumOf(cut(cost?.api)) : null },
            { label: 'Billed: sandbox compute, measured subtotal', short: 'sandbox compute', value: costRuns?.sandbox ? sumOf(cut(cost?.sandbox)) : null },
            { label: 'Not billed: subscription use at API prices', short: 'subscription use', value: costRuns?.subscription ? sumOf(cut(cost?.subscription)) : null },
            ...(sumOf(cost?.otherList) > 0 ? [{ label: 'API-key agents at list price', value: sumOf(cut(cost?.otherList)) }] : []),
          ]} />
        </ChartCard>
        <ChartCard title="Infrastructure billed to Discovery" values={infra ? [infra.totals.hostUsd, infra.totals.volumeUsd, infra.totals.snapshotUsd, infra.totals.r2Usd, infra.totals.egressUsd, infra.totals.r2ListUsd] : []} note={infra ? `${infra.window.from?.slice(0, 10) ?? 'unknown start'}–${infra.window.to.slice(0, 10)} · measured ${ago(infra.generatedAt)}. Missing sources are not measured.` : 'Infrastructure cost readings have not arrived.'}>
          <CostRows subject="Billed infrastructure" rows={[
            { label: 'Hosts', short: 'hosts', value: infra?.totals.hostUsd, text: money(infra?.totals.hostUsd) },
            { label: 'Hetzner volumes, including traces', short: 'volumes', value: infra?.totals.volumeUsd, text: money(infra?.totals.volumeUsd) },
            { label: 'Snapshots and backups', short: 'snapshots', value: infra?.totals.snapshotUsd, text: money(infra?.totals.snapshotUsd) },
            { label: 'Cloudflare R2', short: 'R2', value: infra?.totals.r2Usd, text: money(infra?.totals.r2Usd) },
            { label: 'Egress charges', short: 'egress', value: infra?.totals.egressUsd, text: money(infra?.totals.egressUsd) },
            { label: 'R2 egress', short: 'R2 egress', value: infra?.totals.r2EgressUsd, text: infra?.totals.r2EgressUsd === 0 ? '$0 (free)' : money(infra?.totals.r2EgressUsd) },
          ]} />
          {infra?.totals.r2ListUsd != null ? <p className="ov-note">R2 storage and operations at list rates: {usd(infra.totals.r2ListUsd)}; the billed allocation is not measured.</p> : null}
          {infra?.totals.r2DownloadBytesLowerBound != null ? <p className="ov-note">R2 download lower bound: {bytes(infra.totals.r2DownloadBytesLowerBound)}; R2 egress itself is free.</p> : null}
          {infra?.gaps?.length ? <p className="ov-note">Unmeasured: {infra.gaps.map((gap) => gap.detail).join(' · ')}</p> : null}
        </ChartCard>
        <ChartCard title="Provider bill reconciliation" values={[infra?.reconciliation?.billedUsd, infra?.reconciliation?.priorBillEvidence?.length || null]} note={infra?.reconciliation?.reason ?? 'No same-period provider bill is available.'}>
          <CostRows subject="Provider bill" rows={[
            { label: `Discovery billed allocation, ${infra?.reconciliation?.period ?? 'current period'}`, short: 'billed allocation', value: infra?.reconciliation?.billedUsd, text: money(infra?.reconciliation?.billedUsd) },
            { label: 'Prior bill evidence', value: infra?.reconciliation?.priorBillEvidence?.length ?? 0, text: `${infra?.reconciliation?.priorBillEvidence?.length ?? 0} lines` },
          ]} />
          {infra?.reconciliation?.priorBillEvidence?.map((bill, i) => <p className="ov-note" key={`${bill.vendor}:${bill.item}:${i}`}>{bill.vendor}: {money(bill.monthlyUsd)}/month · {bill.asOf} · {bill.item}</p>)}
        </ChartCard>
        <ChartCard title="Hosts with Discovery sidecars" values={(infra?.hosts ?? []).filter((host) => host.discoverySidecars).map((host) => host.monthlyUsd)} note="Provider list price and outbound counters are host-wide; Discovery share and egress charges are not measured.">
          <dl className="ov-costs">
            {(infra?.hosts ?? []).filter((host) => host.discoverySidecars).map((host) => <div key={host.id}><dt>{host.name ?? host.id} · {host.discoverySidecars} sidecars · {bytes(host.outgoingBytes)} outbound</dt><dd>{money(host.monthlyUsd)}/mo</dd></div>)}
          </dl>
        </ChartCard>
        <ChartCard title="Host allocation per day" values={infraValues('hostUsd')} note="Measured Discovery share of host fixed cost. A missing day has no allocation.">
          <DayBars days={days} series={[{ name: 'host', color: SERIES[2], values: infraValues('hostUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Storage charge per day" values={[...infraValues('volumeUsd'), ...infraValues('snapshotUsd'), ...infraValues('r2Usd')]} legend={[{ name: 'volumes', color: SERIES[1] }, { name: 'snapshots', color: SERIES[2] }, { name: 'R2', color: SERIES[4] }]} note="Billed storage categories; missing provider readings are not measured.">
          <DayBars days={days} series={[{ name: 'volumes', color: SERIES[1], values: infraValues('volumeUsd') }, { name: 'snapshots', color: SERIES[2], values: infraValues('snapshotUsd') }, { name: 'R2', color: SERIES[4], values: infraValues('r2Usd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="R2 at list rates per day" values={[...infraValues('r2StorageListUsd'), ...infraValues('r2OperationsListUsd')]} legend={[{ name: 'storage', color: SERIES[4] }, { name: 'operations', color: SERIES[2] }]} note="Direct Discovery bucket. Before the account free tier, retrieval charges and invoice rounding; not a billed amount.">
          <DayBars days={days} series={[{ name: 'storage', color: SERIES[4], values: infraValues('r2StorageListUsd') }, { name: 'operations', color: SERIES[2], values: infraValues('r2OperationsListUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Egress bytes per day" values={infraValues('egressBytes')} note="Outbound traffic attributed to Discovery where a source records it.">
          <DayBars days={days} series={[{ name: 'outbound', color: SERIES[3], values: infraValues('egressBytes') }]} format={bytes} missing="No reading" />
        </ChartCard>
        <ChartCard title="Egress charges per day" values={infraValues('egressUsd')} note={`Measured outbound charges: ${bytes(infra?.totals.egressBytes)} total bytes. Bytes without a tariff have no measured cost.`}>
          <DayBars days={days} series={[{ name: 'egress', color: SERIES[3], values: infraValues('egressUsd') }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Billed per day" values={[...cut(cost?.api), ...cut(cost?.sandbox ?? d.money.paidByDay)]} usageKnown={Boolean(costRuns?.api || costRuns?.sandbox)} legend={[{ name: 'model API', color: SERIES[3] }, { name: 'sandbox compute', color: SERIES[1] }]} note="What was charged: model calls through Router and sandbox compute on the runs' keys.">
          <DayBars days={days} series={[{ name: 'model API', color: SERIES[3], values: cut(cost?.api) }, { name: 'sandbox compute', color: SERIES[1], values: cut(cost?.sandbox ?? d.money.paidByDay) }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Subscription use at API prices, per day" values={cut(cost?.subscription ?? d.money.listByDay)} usageKnown={Boolean(costRuns?.subscription)} note="Seat use (Claude, Codex, Kimi, Gemini) priced at API list rates; covered by the seats, never billed.">
          <DayBars days={days} series={[{ name: 'subscription at API prices', color: SERIES[0], values: cut(cost?.subscription ?? d.money.listByDay) }]} format={usd} missing="No reading" />
        </ChartCard>
        <ChartCard title="Subscription use at API prices, per run" values={d.money.runListHistogram.map((bin) => bin.n)} note="30 days; not billed.">
          <Histogram bins={d.money.runListHistogram} unit="at API prices per run" format={usd} />
        </ChartCard>
        <ChartCard title="Discovery fleet key" values={[d.money.fleetKey.spent]} note={`${usd(d.money.fleetKey.debits48h)} debited in the last 48 h.`}>
          <Meter used={d.money.fleetKey.spent} total={d.money.fleetKey.cap} format={usd} />
        </ChartCard>
        <ChartCard title="Autoscaled hosts, monthly price" values={history.map((h) => h[4])} note="14 days, from the fleet cost pass every ten minutes.">
          <Lines series={[{ name: 'monthly $', color: SERIES[0], points: history.map((h) => [h[0], h[4]] as [number, number]) }]} format={usd} />
        </ChartCard>
      </Section>

      <Section id="sandboxes" title="Sandboxes" tone="tone-neutral">
        <ChartCard title="Boxes running and parked" values={history.flatMap((h) => [h[1], h[2]])} legend={[{ name: 'running', color: SERIES[0] }, { name: 'parked', color: SERIES[1] }]} note="14 days. Parked boxes hold a host slot without running.">
          <Lines series={[{ name: 'running', color: SERIES[0], points: history.map((h) => [h[0], h[1]] as [number, number]) }, { name: 'parked', color: SERIES[1], points: history.map((h) => [h[0], h[2]] as [number, number]) }]} />
        </ChartCard>
        <ChartCard title="Why boxes stay" values={d.fleet.waste.map((w) => w.boxes)} note="Boxes by the reason they are held, with the median hours parked.">
          <HBars rows={d.fleet.waste.map((w) => ({ label: w.label, value: w.boxes, note: w.hours ? `${compact(w.hours)} h median` : undefined, color: w.waste ? 'var(--ar-c-neutral)' : SERIES[0] }))} format={(v) => `${v} boxes`} />
        </ChartCard>
        <ChartCard title="Hosts" values={hosts.map((h) => h.capacity)} wide note={`${d.fleet.totals.hosts ?? hosts.length} hosts · autoscaled ${usd(d.fleet.totals.autoscaledMonthlyUsd)} a month · Hetzner cloud ${usd(d.fleet.totals.hetznerCloudMonthlyUsd)} a month`}>
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
        <ChartCard title="Reaper, last hour" values={Object.values(d.fleet.reaper)}>
          <HBars rows={Object.entries(d.fleet.reaper).map(([k, v]) => ({ label: label(k.replaceAll('_', ' ')), value: v }))} color={SERIES[2]} />
        </ChartCard>
      </Section>

      <Section title="Storage" tone="tone-neutral">
        <ChartCard title="Traces volume" values={[d.storage.volume?.used]} note={d.storage.volume?.path}>
          <Meter used={d.storage.volume?.used} total={d.storage.volume?.total} format={bytes} />
          <p className="ov-note">Record files: {bytes(d.storage.recordsBytes)}</p>
        </ChartCard>
        <ChartCard title="Run directories by program" values={d.storage.byProgram.map(([, size]) => size)} note="30 days, the size the catalog recorded for each run.">
          <HBars rows={d.storage.byProgram.map(([program, size]) => ({ label: program, value: size }))} format={bytes} color={SERIES[2]} />
        </ChartCard>
        <ChartCard title="Run directory size" values={d.storage.runSizeHistogram.map((bin) => bin.n)}>
          <Histogram bins={d.storage.runSizeHistogram} unit="per run" format={bytes} color={SERIES[2]} />
        </ChartCard>
      </Section>

      <Section id="seats" title="Subscription seats" tone="tone-info">
        <ChartCard title="Weekly and 5-hour use per seat" values={seats.flatMap((seat) => [seat.d7, seat.h5])} wide note="Utilization the provider reports for each seat; the line is the weekly use since sampling began.">
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
