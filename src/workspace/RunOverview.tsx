import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RecordNode } from '../record.js'
import type { RunDocument } from '../workspace.js'
import type { NodeStats } from './RunTable.js'
import { ChartCard, Lines, SERIES } from './OverviewCharts.js'
import { money, useDocument } from './data.js'
import {
  bestOf,
  byState,
  checkWords,
  clockView,
  costView,
  cumulativeAt,
  dataQuality,
  effectWords,
  goalSentence,
  hoursText,
  lineageSegments,
  lineageUsage,
  missingChecks,
  productFiles,
  readerTest,
  riskOf,
  roleHistory,
  runLabel,
  scoreWords,
  scoredTags,
  stall,
  stripMachineKeys,
  t,
  teamCards,
  tierWord,
  tokensText,
  utcClock,
  utcDay,
} from './run-story.js'
import type { Meter as RunMeter, Releases, RoleVersion, Segment, Story, StoryTag, TeamCard } from './run-story.js'

type Doc = RunDocument & { story?: Story | null; lineage?: Segment[] | null }
type NodeMeter = { meter?: RunMeter | null }

/** The detail views a section opens: the conversation of one agent, the commit graph, the profile graph and the rest. */
export type OpenView = (section: string, patch?: Record<string, string | undefined>) => void

/**
 * The run page's default view: five questions answered in the header, then the deliverable, what is still missing, the
 * progress of the best score against its cost, the team, and (collapsed) the run's history, brief and data quality. Every
 * detail view (conversations, the commit graph, the profile graph, ledgers, assessments) is one click from the section
 * whose question it answers.
 */
export function RunOverview({ api, doc, nodes, stats, open }: { api: string; doc: Doc; nodes: RecordNode[] | null; stats: Record<string, NodeStats>; open: OpenView }) {
  const [now, setNow] = useState(() => Date.now())
  const live = doc.run.state === 'running'
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [live])
  const story = doc.story ?? null
  const releases = story?.releases ?? null
  const segments = doc.lineage ?? []
  const play = doc.run.play
  const best = bestOf(releases)
  const usage = useMemo(() => lineageUsage(segments, story?.series ?? []), [segments, story])
  const stalled = stall(releases, usage, now)
  const clock = clockView(story?.clock ?? null, doc.run.startedAt, doc.run.settledAt, now)
  const stop = doc.findings?.stop as { kind?: string; reason?: string; attempts?: number; limits?: { label?: string; limit?: string }[] } | undefined
  const stopWords = stopReason(doc.run.state, doc.run.reason, stop)
  const risk = riskOf(doc.run.state, clock, best, stalled, stopWords)
  const missing = missingChecks(releases)
  const readout = doc.finalOutput?.readout
  const cost = costView({
    meter: (doc.spend as { meter?: RunMeter | null }).meter ?? null,
    listUsd: doc.spend.listUsd,
    listKnown: doc.spend.listKnown,
    basis: (doc.spend as { basis?: string | null }).basis,
    gaps: doc.spend.gaps,
    readoutApi: readout && readout.status !== 'pending' ? (readoutCost(readout.cost).apiEquivalentUsd ?? null) : null,
    readoutBilled: readout && readout.status !== 'pending' ? (readoutCost(readout.cost).billedUsd?.total ?? null) : null,
    sandboxUsd: doc.spend.sandboxUsd,
    apiUsd: doc.spend.apiUsd,
    models: doc.run.models,
  })
  const cards = useMemo(() => byState(teamCards(teamInput(doc, nodes, stats), live, now)), [doc, nodes, stats, live, now])
  const working = cards.filter((card) => card.state === 'working').length
  const quality = dataQuality({
    capture: doc.run.record.capture,
    agents: cards.length,
    metered: cards.filter((card) => card.tokens !== null).length,
    priced: cards.filter((card) => card.usd !== null).length,
    live,
    unpricedModels: doc.spend.gaps.some((gap) => gap.code === 'price-unknown') || (cost.apiUsd === null && cost.tokens) ? doc.run.models : [],
  })
  const research = !releases && !!doc.findings?.items.some((item) => item.kind === 'result' || item.kind === 'claim')
  return (
    <div className="rs-page" data-overview>
      <header className="rs-head" data-section="header">
        <p className="rs-crumb">
          <a href={`/play/${encodeURIComponent(play)}`}>{play}</a> <span aria-hidden="true">/</span> <span className="mono">{runLabel(doc.run.id, play)}</span>
          {segments.length > 1 && (
            <span className="rs-crumb-lineage">
              {' · continues '}
              {segments.slice(0, -1).map((segment, i) => (
                <span key={segment.runId}>
                  {i > 0 ? ' → ' : ''}
                  <a href={`/run/${encodeURIComponent(segment.runId)}`} className="mono">{runLabel(segment.runId, play)}</a>
                </span>
              ))}
            </span>
          )}
        </p>
        <h1 className="rs-goal" title={doc.run.purpose ?? undefined}>{goalSentence(doc.run.purpose ?? doc.input?.objective) ?? doc.run.id}</h1>
        <div className="rs-tiles">
          <Tile label="Status" tone={risk.level === 'at-risk' ? 'warn' : risk.level === 'ended' ? (doc.run.state === 'winner' ? 'ok' : 'fail') : 'ok'} data="status">
            <b className="rs-big">{live ? 'Running' : `Settled · ${doc.run.state.replaceAll('-', ' ')}`}</b>
            <span>
              {hoursText(clock.elapsedMs)} {live ? 'in' : 'run'}
              {clock.leftMs !== null && live ? ` · ${hoursText(clock.leftMs)} left (deadline ${utcClock(clock.deadlineAt)})` : ''}
              {!live && doc.run.settledAt ? ` · ended ${utcDay(doc.run.settledAt)}` : ''}
            </span>
            {clock.used !== null && live && <Bar share={clock.used} label={`${Math.round(clock.used * 100)}% of the time window used`} />}
            <span className={`rs-risk risk-${risk.level}`}>{risk.level === 'on-track' ? 'On track' : risk.level === 'at-risk' ? 'At risk' : 'Ended'}: {risk.reason}</span>
          </Tile>
          <Tile label="Best version" tone={best?.vector?.exact && best.vector.exact[0] === best.vector.exact[1] ? 'ok' : 'warn'} data="best">
            {best ? (
              <>
                <b className="rs-big">
                  {best.name} <small className="faint">from {runLabel(best.run, play)}</small>
                </b>
                <span>{scoreWords(best.vector)}</span>
                {best.vector?.exact && <Bar share={best.vector.exact[1] ? best.vector.exact[0] / best.vector.exact[1] : 0} label={`${best.vector.exact[0]} of ${best.vector.exact[1]} must-pass checks pass; the bar is all of them`} />}
                <span className={stalled && stalled.after ? 'rs-trend-flat' : 'rs-trend-up'}>
                  {stalled
                    ? `${stalled.after ? `not improving: ${stalled.after} later version${stalled.after === 1 ? '' : 's'}, none better` : 'newest best'} · since ${utcDay(stalled.since.at)}`
                    : 'the newest version is the best'}
                </span>
              </>
            ) : (
              <b className="rs-big">No version scored yet</b>
            )}
          </Tile>
          <Tile label="Still missing" tone={missing.length ? 'warn' : 'ok'} data="missing">
            {releases ? (
              <>
                <b className="rs-big">{missingSummary(missing).head}</b>
                {missingSummary(missing).rest && <span>{missingSummary(missing).rest}</span>}
                {best?.vector?.blockers ? <span>{`${best.vector.blockers} open referee blocker${best.vector.blockers === 1 ? '' : 's'}`}</span> : null}
                <span>{live ? `${working} of ${cards.length} agents working` : `${cards.length} agents ran`}</span>
              </>
            ) : (
              <b className="rs-big">No bar registered</b>
            )}
          </Tile>
          <Tile label={live ? 'Cost so far' : 'Cost'} tone="plain" data="cost">
            <b className="rs-big">{cost.apiUsd !== null ? `${money(cost.apiUsd)} at API prices` : cost.tokens !== null ? `${cost.tokensFloor ? '≥ ' : ''}${tokensText(cost.tokens)} tokens` : 'Nothing metered yet'}</b>
            {cost.apiUsd !== null && cost.tokens !== null && <span>{tokensText(cost.tokens)} tokens</span>}
            {cost.apiMissing && cost.tokens !== null && <span title="API-equivalent dollars price every token at list price, whoever paid">{cost.apiMissing}</span>}
            <span>Billed: {cost.billedUsd !== null ? money(cost.billedUsd) : cost.billedNote}</span>
            <button type="button" className="link-button rs-tile-link" onClick={() => open('spend')}>Ledger</button>
          </Tile>
        </div>
        <Decision live={live} best={best} stalled={stalled} play={play} risk={risk} />
      </header>

      {story?.receipt && <Deliverable doc={doc} releases={releases} best={best} play={play} />}

      {releases && (
        <Section title="What’s left" note={missing.length ? `${missing.length} check${missing.length === 1 ? '' : 's'} the best version fails, must-pass first` : 'The best version passes every check'} data="missing">
          <MissingList rows={missing} />
          <p className="rs-more">
            {releases.rule && <span className="faint">The best version is chosen by {releases.rule.replace(/\s*\(.*\)$/, '')}. </span>}
            <button type="button" className="link-button" onClick={() => open('versions', best?.commit ? { commit: best.commit } : {})}>Open {best?.name ?? 'the best version'} in the version graph</button>
          </p>
        </Section>
      )}

      {releases && scoredTags(releases).length > 0 && (
        <Section title="Progress" note="Score of each version against its bar, and the tokens the lineage used getting there" data="progress">
          <ProgressCharts releases={releases} usage={usage} play={play} />
          <VersionTimeline releases={releases} play={play} onOpen={(commit) => open('versions', { commit })} />
        </Section>
      )}

      {research && (
        <Section title="Findings" note="The results and claims this run's agents wrote" data="findings">
          <button type="button" className="link-button" onClick={() => open('findings')}>Read the findings</button>
        </Section>
      )}

      <Section title="Team" note={cards.length ? `${cards.length} agents${live ? ` · ${working} working now` : ''}` : 'No agent recorded yet'} data="team">
        <Team cards={cards} live={live} onOpen={(node) => open('agents', { node })} />
      </Section>

      <Collapsible title="History" summary={historySummary(segments, story?.profiles.length ?? 0, play)} data="history">
        {segments.length > 1 && <Lineage segments={segments} releases={releases} current={doc.run.id} play={play} />}
        <RoleChanges api={api} doc={doc} releases={releases} play={play} />
        <p className="rs-more">
          <a href={`/play/${encodeURIComponent(play)}?tab=story&at=${encodeURIComponent(doc.run.id)}`}>The play’s story</a>
          {' · '}
          <button type="button" className="link-button" onClick={() => open('profiles')}>Open the profile graph</button>
          {' · '}
          <button type="button" className="link-button" onClick={() => open('versions')}>Open the commit graph</button>
        </p>
      </Collapsible>

      <Collapsible title="Brief" summary="What the run was asked: the objective, the deliverables, the bar and its deadline" data="brief">
        <Brief doc={doc} best={best} onInput={() => open('input')} />
      </Collapsible>

      {quality && (
        <details className="rs-quality" data-section="quality">
          <summary>
            <span className="rs-quality-label">Data quality</span> {quality.line}
          </summary>
          {quality.reasons.map((reason) => <p key={reason} className="faint">{reason}</p>)}
          <p>
            <button type="button" className="link-button" onClick={() => open('coverage')}>Capture by agent</button>
            {' · '}
            <button type="button" className="link-button" onClick={() => open('assessments')}>Trace assessments</button>
          </p>
        </details>
      )}
    </div>
  )
}

type Figure = { usd: number | null; provenance: string | null }
/** The readout's two cost figures (tangle-tools readout_cost): API-equivalent and billed, each with its provenance. */
const readoutCost = (cost: unknown) => cost as { apiEquivalentUsd?: Figure | null; billedUsd?: { total?: Figure | null } | null }

/** A share of a whole as a thin bar; its label is the accessible name and the tooltip. */
function Bar({ share, label }: { share: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100)
  return (
    <span className="rs-bar-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} title={label}>
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}

function Tile({ label, tone, data, children }: { label: string; tone: string; data: string; children: ReactNode }) {
  return (
    <div className={`rs-tile tone-${tone}`} data-tile={data}>
      <span className="rs-tile-label">{label}</span>
      {children}
    </div>
  )
}

function Section({ title, note, data, children }: { title: string; note?: string; data: string; children: ReactNode }) {
  return (
    <section className="rs-section" aria-label={title} data-section={data}>
      <header className="rs-section-head">
        <h2>{title}</h2>
        {note && <p className="faint">{note}</p>}
      </header>
      {children}
    </section>
  )
}

function Collapsible({ title, summary, data, children }: { title: string; summary: string; data: string; children: ReactNode }) {
  return (
    <details className="rs-section rs-collapsible" data-section={data}>
      <summary>
        <h2>{title}</h2>
        <span className="faint">{summary}</span>
      </summary>
      <div className="rs-collapsible-body">{children}</div>
    </details>
  )
}

function stopReason(state: string, reason: string | null, stop?: { kind?: string; reason?: string; attempts?: number; limits?: { label?: string; limit?: string }[] }) {
  if (state === 'running') return null
  const words = [reason && reason !== state ? reason.replaceAll('-', ' ') : null]
  if (stop?.attempts) words.push(`after ${stop.attempts} driver attempts`)
  const limit = stop?.limits?.[0]
  if (limit?.label) words.push(`${limit.label.split(' · ')[0]} hit its ${limit.limit ?? 'subscription'} limit`)
  return words.filter(Boolean).join(' · ') || `settled ${state.replaceAll('-', ' ')}`
}

/** The failing checks by tier: the headline names the heaviest tier, the line under it the rest. */
function missingSummary(missing: ReturnType<typeof missingChecks>) {
  if (!missing.length) return { head: 'Nothing: every check passes', rest: null }
  const tiers = new Map<string, number>()
  for (const row of missing) tiers.set(tierWord(row.tier), (tiers.get(tierWord(row.tier)) ?? 0) + 1)
  const [[first, count], ...others] = [...tiers.entries()]
  return {
    head: `${count} ${first} check${count === 1 ? '' : 's'}`,
    rest: others.length ? `and ${others.map(([tier, n]) => `${n} ${tier}`).join(', ')}` : null,
  }
}

const sizeText = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`)

function Decision({ live, best, stalled, play, risk }: { live: boolean; best: StoryTag | null; stalled: ReturnType<typeof stall>; play: string; risk: ReturnType<typeof riskOf> }) {
  if (!best) return null
  const spent = stalled?.tokens ? `; ${tokensText(stalled.tokens)} tokens used since` : ''
  if (live && risk.level === 'at-risk' && stalled)
    return (
      <p className="rs-decision" role="status" data-decision>
        <b>Decide:</b> no better version than {best.name} in {hoursText(stalled.ms)}{spent}. Keep paying for this run, or stop it and take {best.name}.
      </p>
    )
  if (!live)
    return (
      <p className="rs-decision" data-decision>
        <b>Decide:</b> take {best.name} (from {runLabel(best.run, play)}) as the product, or fund a continuation from it.
      </p>
    )
  return null
}

// ------------------------------------------------------------------------------------------------- the deliverable

function Deliverable({ doc, releases, best, play }: { doc: Doc; releases: Releases | null; best: StoryTag | null; play: string }) {
  const receipt = doc.story!.receipt!
  const [whole, setWhole] = useState(false)
  const files = productFiles(receipt.files)
  const tag = releases?.tags.find((item) => item.name === receipt.tag) ?? best
  const reader = readerTest(releases, tag ?? null)
  const summary = stripMachineKeys(receipt.summary?.markdown)
  const paragraphs = summary.split(/\n{2,}/)
  const shown = whole ? summary : paragraphs.slice(0, 2).join('\n\n')
  return (
    <section className="rs-section rs-deliverable" aria-label="The deliverable" data-section="deliverable">
      <header className="rs-section-head">
        <h2>The deliverable · {receipt.tag}</h2>
        <p className="faint">
          {receipt.status ?? 'best version'}
          {tag ? ` · from ${runLabel(tag.run, play)}` : ''}
          {receipt.taggedAt ? ` · tagged ${utcDay(receipt.taggedAt)}` : ''}
        </p>
      </header>
      <div className="rs-files" role="group" aria-label="Open the deliverable">
        {files.map((file, i) => (
          <a key={file.file} className={`rs-file ${i === 0 ? 'primary' : ''}`} href={file.href} target="_blank" rel="noopener noreferrer" title={file.label}>
            {file.kind}
            {file.bytes ? <small>{sizeText(file.bytes)}</small> : null}
          </a>
        ))}
        <a className="rs-file subtle" href={receipt.href} target="_blank" rel="noopener noreferrer">Receipt</a>
      </div>
      {summary && (
        <blockquote className="rs-summary">
          {receipt.summary?.heading && <h3>{receipt.summary.heading}</h3>}
          <Markdown skipHtml remarkPlugins={[remarkGfm]}>{shown}</Markdown>
          {paragraphs.length > 2 && (
            <button type="button" className="link-button" onClick={() => setWhole(!whole)} aria-expanded={whole}>
              {whole ? 'Show less' : 'Read the whole summary'}
            </button>
          )}
        </blockquote>
      )}
      {reader && (
        <p className={`rs-reader ${reader.pass ? 'state-ok' : 'state-warn'}`} data-reader-test>
          Reader test: {reader.score !== null ? reader.score.toFixed(2) : 'no score'}
          {reader.bar !== null ? ` (needs ${reader.bar.toFixed(2)})` : ''} · {reader.pass ? 'passes' : 'fails'}
          <span className="faint"> · a fresh reader answers the board's hidden questions from the executive summary</span>
        </p>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------- what's left

function MissingList({ rows }: { rows: ReturnType<typeof missingChecks> }) {
  if (!rows.length) return <p className="faint">Nothing: every check of the best version passes.</p>
  return (
    <ol className="rs-missing" data-missing={rows.length}>
      {rows.map((row) => (
        <li key={row.id} data-check={row.id}>
          <div className="rs-missing-head">
            <b>{row.title}</b>
            <span className="rs-tier">{tierWord(row.tier)}</span>
            <span className={`rs-movement ${row.regressed ? 'regressed' : ''}`}>{row.movement}</span>
          </div>
          <Track track={row.track} />
          {row.evidence && <p className="rs-evidence">{row.evidence}</p>}
        </li>
      ))}
    </ol>
  )
}

/** Pass and fail of one check across the scored versions, oldest first. */
function Track({ track }: { track: { tag: string; pass: boolean | null }[] }) {
  return (
    <span className="rs-track" role="img" aria-label={track.map((row) => `${row.tag} ${row.pass === null ? 'not run' : row.pass ? 'pass' : 'fail'}`).join(', ')}>
      {track.map((row) => (
        <i key={row.tag} className={row.pass === null ? 'none' : row.pass ? 'pass' : 'fail'} title={`${row.tag}: ${row.pass === null ? 'not run' : row.pass ? 'pass' : 'fail'}`} />
      ))}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------- progress

function ProgressCharts({ releases, usage, play }: { releases: Releases; usage: [number, number][]; play: string }) {
  const scored = scoredTags(releases).filter((tag) => Number.isFinite(t(tag.at)))
  const label = new Map(scored.map((tag) => [t(tag.at), `${tag.name} · ${runLabel(tag.run, play)}`]))
  const pct = (pair: [number, number] | null) => (pair && pair[1] ? Math.round((pair[0] / pair[1]) * 100) : null)
  const points = (pick: (tag: StoryTag) => number | null) =>
    scored.flatMap((tag) => {
      const value = pick(tag)
      return value === null ? [] : [[t(tag.at), value] as [number, number]]
    })
  const exact = points((tag) => pct(tag.vector?.exact ?? null))
  const held = points((tag) => pct(tag.vector?.heldOut ?? null))
  const judge = points((tag) => tag.vector?.judge ?? null)
  const axis = (time: number) => new Date(time).toISOString().slice(5, 16).replace('T', ' ')
  const marks = scored.flatMap((tag) => {
    const value = cumulativeAt(usage, t(tag.at))
    return value === null ? [] : [[t(tag.at), value] as [number, number]]
  })
  return (
    <div className="rs-charts">
      <ChartCard
        title="Score per version"
        legend={[
          { name: 'must-pass %', color: SERIES[0] },
          { name: 'held-out %', color: SERIES[1] },
          { name: 'judge', color: SERIES[3] },
          { name: 'bar', color: 'var(--ar-fg-muted)' },
        ]}
        note="Each point is a version at the time it was tagged: the share of its must-pass and held-out checks that pass, and the judge's 0–100 score. The bar is 100."
      >
        <Lines
          series={[
            { name: 'must-pass %', color: SERIES[0], points: exact, label: (time) => label.get(time) ?? '' },
            { name: 'held-out %', color: SERIES[1], points: held },
            { name: 'judge', color: SERIES[3], points: judge },
            // The bar: every check passing, so the scale always reaches it.
            { name: 'bar', color: 'var(--ar-fg-muted)', points: exact.length ? [[exact[0]![0], 100], [exact.at(-1)![0], 100]] : [] },
          ]}
          format={(value) => String(Math.round(value))}
          axis={axis}
        />
      </ChartCard>
      {usage.length > 0 && (
        <ChartCard title="Tokens used" legend={[{ name: 'tokens', color: SERIES[2] }, { name: 'a version', color: SERIES[0] }]} note="Cumulative across the lineage, by Runtime's meter at each turn's end; dots are versions.">
          <Lines
            series={[
              { name: 'tokens', color: SERIES[2], points: usage },
              { name: 'version', color: SERIES[0], points: marks, dots: true, label: (time) => label.get(time) ?? '' },
            ]}
            format={tokensText}
            axis={axis}
          />
        </ChartCard>
      )}
    </div>
  )
}

function VersionTimeline({ releases, play, onOpen }: { releases: Releases; play: string; onOpen: (commit: string) => void }) {
  const scored = scoredTags(releases)
  let previous: number | null = null
  return (
    <ol className="rs-timeline" aria-label="Versions" data-timeline={releases.tags.length}>
      {releases.tags.map((tag) => {
        const exact = tag.vector?.exact
        const delta = exact && previous !== null ? exact[0] - previous : null
        if (exact) previous = exact[0]
        return (
          <li key={tag.name} className={`${tag.best ? 'best' : ''} ${tag.vector ? '' : 'unscored'}`}>
            <button type="button" disabled={!tag.commit} onClick={() => tag.commit && onOpen(tag.commit)} title={`${tag.name} · ${scoreWords(tag.vector)} · ${utcDay(tag.at)}`}>
              <b>{tag.name}</b>
              <span className="mono">{exact ? `${exact[0]}/${exact[1]}` : '—'}</span>
              {delta !== null && delta !== 0 && <span className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</span>}
              {tag.best && <span className="star" aria-label="best">★</span>}
              <small>{runLabel(tag.run, play)}</small>
            </button>
          </li>
        )
      })}
      {scored.length < releases.tags.length && <li className="rs-timeline-note faint">— not scored by this run's checks</li>}
    </ol>
  )
}

// ------------------------------------------------------------------------------------------------- team

function teamInput(doc: Doc, nodes: RecordNode[] | null, stats: Record<string, NodeStats>) {
  const progress = new Map((doc.progress?.agents ?? []).map((agent) => [agent.node, agent]))
  const list = (nodes ?? []).filter((node) => node.kind !== 'finding' && node.kind !== 'session')
  // Without the record yet, the progress document names the team.
  const rows = list.length
    ? list.map((node) => ({ id: node.id, label: node.label, role: (node.role as string | undefined) ?? null, parent: node.parent ?? null, model: (node.servedModel as string | undefined) ?? (node.model as string | undefined) ?? null, harness: (node.harness as string | undefined) ?? null, status: (node.status as string | undefined) ?? null, start: (node.start as string | undefined) ?? null, end: (node.end as string | undefined) ?? null }))
    : (doc.progress?.agents ?? []).map((agent) => ({ id: agent.node, label: agent.label, role: agent.label, parent: agent.parent ?? null, model: agent.model, harness: null, status: null, start: agent.startedAt, end: null }))
  return rows.map((row) => {
    const stat = stats[row.id] as (NodeStats & { calls?: number; lastText?: string | null; lastTextAt?: string | null }) | undefined
    const agent = progress.get(row.id)
    const spend = doc.spend.nodes[row.id] as (typeof doc.spend.nodes)[string] & NodeMeter & { basis?: string } | undefined
    const recordTokens = stat?.tokens ? stat.tokens.input + stat.tokens.output + stat.tokens.cacheRead + stat.tokens.cacheWrite : null
    return {
      ...row,
      liveStatus: agent?.status ?? null,
      lastActiveAt: agent?.lastActiveAt ?? stat?.lastAt ?? null,
      calls: stat?.calls ?? null,
      lastText: stat?.lastText ?? null,
      lastTextAt: stat?.lastTextAt ?? null,
      meter: spend?.meter ?? null,
      recordTokens,
      usd: spend?.listUsd ?? stat?.listUsd ?? null,
      usdEstimated: spend?.basis === 'estimated' || (agent?.usdEstimated ?? false),
    }
  })
}

const TEAM_SHOWN = 8

function Team({ cards, live, onOpen }: { cards: TeamCard[]; live: boolean; onOpen: (node: string) => void }) {
  const [all, setAll] = useState(false)
  const groups = (['working', 'failed', 'stopped', 'finished', 'ended'] as const)
    .map((state) => ({ state, cards: cards.filter((card) => card.state === state) }))
    .filter((group) => group.cards.length)
  const heading: Record<TeamCard['state'], string> = { working: 'Working now', failed: 'Failed', stopped: 'Stopped', finished: 'Finished', ended: 'Ended without a recorded result' }
  return (
    <div className="rs-team">
      {groups.map((group) => {
        const many = group.state !== 'working' && group.cards.length > TEAM_SHOWN && !all
        return (
          <div key={group.state} className="rs-team-group" data-team-group={group.state}>
            <h3>
              {heading[group.state]} <span className="faint">{group.cards.length}</span>
            </h3>
            <ul className="rs-cards">
              {(many ? group.cards.slice(0, TEAM_SHOWN) : group.cards).map((card) => (
                <li key={card.id} className={`rs-card state-${card.state}`} data-agent-card={card.id}>
                  <div className="rs-card-head">
                    <b title={card.title}>{card.title}</b>
                    <span className="mono faint">{card.short}</span>
                  </div>
                  <p className="rs-card-line">
                    <span className={`rs-dot ${card.state}`} aria-hidden="true" />
                    {card.line}
                  </p>
                  <p className="rs-card-usage faint">
                    {[card.model, card.tokens !== null ? `${tokensText(card.tokens)} tokens` : null, card.usd !== null && card.usd > 0 ? `${money(card.usd)}${card.usdEstimated ? ' est.' : ''} at API prices` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {card.lastText && <p className="rs-card-words">“{card.lastText}”</p>}
                  <button type="button" className="link-button rs-card-open" onClick={() => onOpen(card.id)}>Conversation</button>
                </li>
              ))}
            </ul>
            {many && (
              <button type="button" className="ui-button" onClick={() => setAll(true)}>
                Show all {group.cards.length}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------- history

function historySummary(segments: Segment[], profiles: number, play: string) {
  const chain = segments.length > 1 ? `Lineage ${segments.map((segment) => runLabel(segment.runId, play)).join(' → ')}` : 'No earlier run'
  return `${chain} · ${profiles} profile version${profiles === 1 ? '' : 's'}`
}

function Lineage({ segments, releases, current, play }: { segments: Segment[]; releases: Releases | null; current: string; play: string }) {
  const rows = lineageSegments(segments, releases, current, play)
  return (
    <div className="rs-lineage-wrap">
      <h3>Lineage</h3>
      <ol className="rs-lineage" data-lineage={rows.length}>
        {rows.map((row) => (
          <li key={row.runId} className={row.current ? 'current' : ''}>
            <a href={`/run/${encodeURIComponent(row.runId)}`} className="mono">{row.label}</a>
            <span className="faint">{[row.state !== 'unknown' ? row.state.replaceAll('-', ' ') : null, utcDay(row.forkedAt ?? row.startedAt)].filter(Boolean).join(' · ')}</span>
            <span>
              {row.tags.length ? `${row.tags.length} version${row.tags.length === 1 ? '' : 's'}` : 'no versions'}
              {row.bestTag ? ` · best ${row.bestTag.name} ${row.bestTag.vector?.exact ? `${row.bestTag.vector.exact[0]}/${row.bestTag.vector.exact[1]}` : ''}` : ''}
            </span>
            <span className={row.improved ? 'state-ok' : 'faint'}>{row.tags.length ? (row.improved ? 'raised the best score' : 'did not beat what it inherited') : 'tagged nothing'}</span>
            <span className="faint">
              {[row.tokens !== null ? `${tokensText(row.tokens)} tokens` : null, row.apiUsd !== null ? `${money(row.apiUsd)} API` : null, row.billedUsd !== null ? `${money(row.billedUsd)} billed` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function RoleChanges({ api, doc, releases, play }: { api: string; doc: Doc; releases: Releases | null; play: string }) {
  const roles = useMemo(() => roleHistory(doc.story?.profiles ?? [], releases), [doc.story, releases])
  if (!roles.length) return null
  return (
    <div className="rs-roles">
      <h3>Profile changes by role</h3>
      <p className="faint">
        Each version of a role’s profile, with the reason its commit states and the score of the next version. A next version’s score is what changed after,
        not proof the profile caused it.
      </p>
      <ul>
        {roles.map(({ role, versions }) => (
          <li key={role}>
            <details>
              <summary>
                <b>{checkWords(role)}</b> <span className="faint">{versions.length} version{versions.length === 1 ? '' : 's'} · latest {runLabel(versions.at(-1)!.run, play)}</span>
              </summary>
              <ol className="rs-role-versions">
                {[...versions].reverse().map((version) => (
                  <RoleVersionRow key={version.commit} api={api} version={version} doc={doc} play={play} />
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoleVersionRow({ api, version, doc, play }: { api: string; version: RoleVersion; doc: Doc; play: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <p>
        <span className="mono">{runLabel(version.run, play)}</span> <span className="faint">{utcDay(version.at)}{version.status ? ` · ${version.status}` : ''}</span>
      </p>
      {version.reason && <p>{version.reason}</p>}
      <p className="faint">{effectWords(version)}</p>
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide what changed' : 'What changed'}</button>
      {open && <ProfileDiff url={`${api}/runs/${encodeURIComponent(doc.run.id)}/profile-change/${version.commit}`} />}
    </li>
  )
}

interface ProfileDiffDoc {
  first: boolean
  parentNode: string | null
  added: string[]
  removed: string[]
  fields: { field: string; from: string | null; to: string | null }[]
}

function ProfileDiff({ url }: { url: string }) {
  const diff = useDocument<ProfileDiffDoc>(url)
  if (!diff.data) return <p className="faint" role={diff.error ? 'alert' : 'status'}>{diff.error ? `Unavailable: ${diff.error}` : 'Reading the change…'}</p>
  const d = diff.data
  if (d.first) return <p className="faint">The first version of this role in the store.</p>
  if (!d.added.length && !d.removed.length && !d.fields.length) return <p className="faint">Same profile as the version before.</p>
  return (
    <div className="rs-diff">
      {d.parentNode && <p className="faint">Compared with the role’s previous version{d.parentNode ? ` (${d.parentNode.split(':').slice(1).join(':') || d.parentNode})` : ''}.</p>}
      {d.added.length > 0 && (
        <>
          <h4>Instructions added</h4>
          <ul className="rs-diff-added">{d.added.map((line) => <li key={line}>{line}</li>)}</ul>
        </>
      )}
      {d.removed.length > 0 && (
        <>
          <h4>Instructions removed</h4>
          <ul className="rs-diff-removed">{d.removed.map((line) => <li key={line}>{line}</li>)}</ul>
        </>
      )}
      {d.fields.length > 0 && (
        <>
          <h4>Settings changed</h4>
          <ul className="rs-diff-fields">
            {d.fields.map((field) => (
              <li key={field.field}>
                <code>{field.field}</code>: {field.from === null ? 'added' : field.to === null ? 'removed' : <>{clip(field.from)} → {clip(field.to)}</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

const clip = (text: string | null) => (text && text.length > 80 ? `${text.slice(0, 79)}…` : text)

// ------------------------------------------------------------------------------------------------- brief

function Brief({ doc, best, onInput }: { doc: Doc; best: StoryTag | null; onInput: () => void }) {
  const input = doc.input
  const receipt = doc.story?.receipt
  const tiers = new Map<string, string[]>()
  for (const [id, tier] of best?.results ?? []) tiers.set(tierWord(tier), [...(tiers.get(tierWord(tier)) ?? []), checkWords(id)])
  const clock = doc.story?.clock
  return (
    <div className="rs-brief">
      {input?.objective && (
        <>
          <h3>Objective</h3>
          <p>{input.objective}</p>
        </>
      )}
      {receipt?.deliverables.length ? (
        <>
          <h3>Deliverables</h3>
          <p>{receipt.deliverables.map((item) => `${item.id}${item.present === false ? ' (missing)' : ''}`).join(' · ')}</p>
        </>
      ) : null}
      {tiers.size > 0 && (
        <>
          <h3>The bar</h3>
          <ul className="rs-bar">
            {[...tiers.entries()].map(([tier, checks]) => (
              <li key={tier}>
                <b>{checks.length} {tier}</b>: {checks.join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Deadline and models</h3>
      <p>
        {clock?.deadlineAt ? `Deadline ${utcDay(clock.deadlineAt)}${clock.spanMs ? ` (${hoursText(clock.spanMs)} window${clock.inheritedFrom ? `, from ${clock.inheritedFrom}` : ''})` : ''}. ` : ''}
        {doc.run.models.length ? `Models: ${doc.run.models.join(', ')}` : ''}
        {doc.run.harnesses.length ? ` on ${doc.run.harnesses.join(', ')}` : ''}.
      </p>
      <button type="button" className="link-button" onClick={onInput}>The full input and profile</button>
    </div>
  )
}

