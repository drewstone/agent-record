import { useState } from 'react'
import type { PlayReportDocument } from '../play-report.js'
import type { PlayDocument, RunDocument } from '../workspace-model.js'
import { AnswerStrip, AsOf } from './AnswerStrip.js'
import { clip, clockZ, lastOutput, playAnswers, playAsOf, since } from './answers.js'
import { dataStatus, money, newerStarted, StandingText, StatusPill, statusOf, useDocument } from './data.js'
import {
  barSide,
  hostWords,
  lineReason,
  metricValue,
  type PlayBarMetric,
  type PlayBest,
  type PlayBlocker,
  type PlayHead as Head,
  RELEASE_STATE,
  rulingWords,
  shortRun,
  shortTag,
  seatWords,
  span,
  targetWords,
  utc,
  workloadWords,
} from './play-standing.js'
import { builtOf, spreadOf } from './served-fields.js'

type Play = PlayDocument & Head

/**
 * The play's goal exactly as the composer serves it from the play file's # Goal. A null goal (an index group, a play
 * without a goal section) draws no goal line: a run's objective is never shown as the play's goal.
 */
function goalOf(play: Play): { text: string; full: string | null } | null {
  if (!play.goal?.text) return null
  return { text: play.goal.text, full: play.goal.full && play.goal.full !== play.goal.text ? play.goal.full : null }
}

/** Where a best row came from: `rc16 (18b) ○ not published`, with its line on hover. */
function Provenance({ play, best }: { play: Play; best: PlayBest | null | undefined }) {
  if (!best) return null
  const result = best.verdict ? statusOf({ axis: 'result', verdict: best.verdict }) : null
  // A workspace row has no release: it reads as its verdict.
  const release = best.state ?? (typeof best.release === 'string' && best.release !== 'workspace' ? best.release : null)
  return (
    <span className="goal-prov" title={[best.line, best.lastAt ?? best.at ? `last ${utc(best.lastAt ?? best.at)}` : null].filter(Boolean).join('\n') || undefined}>
      <b className="mono">{shortTag(best.tag) ?? 'workspace'}</b>
      {best.runId && <span className="faint"> ({shortRun(play.id, best.runId)})</span>}
      {result && <span className="goal-glyph" data-status={dataStatus(result)} title={result.word}> {result.shape}</span>}
      {release && release !== 'published' && <span className="faint"> {RELEASE_STATE[release] ?? release}</span>}
      {(!release || release === 'published') && result && <span className="faint"> {result.word}</span>}
    </span>
  )
}

/**
 * The current check's stages as a ladder: one cell per stage the check scores, named as its SCORE lines name them,
 * then SOLVED. Cells before the best row's stage passed; its stage is where it failed (filled by its partial progress);
 * a pass under an earlier checker is a dashed ring on SOLVED. Nothing is drawn for a check that prints no stages.
 */
function StageLadder({ play, best }: { play: Play; best: PlayBest }) {
  const of = best.of ?? null
  const reached = best.reached ?? null
  if (!of || reached === null) return null
  const named = new Map((play.climb?.y?.gridlines ?? []).filter((line) => line.at < 1).map((line) => [Math.round(line.at * of) + 1, line.label]))
  const solved = best.verdict === 'solved'
  const partial = best.progress !== null && best.progress !== undefined ? Math.max(0, Math.min(1, best.progress * of - (reached - 1))) : 0
  const ever = play.standing?.bestEver ?? null
  const earlier = ever && ever.checker && ever.checker !== best.checker ? ever : null
  const cells = Array.from({ length: of }, (_, i) => {
    const k = i + 1
    const name = named.get(k)
    const state = solved || k < reached ? 'passed' : k === reached ? 'failed' : 'ahead'
    return { k, name: name && !/^stage \d+$/.test(name) ? name : `stage ${k}`, title: `stage ${k} of ${of}${name ? ` (${name})` : ''}: ${state === 'passed' ? 'passed' : state === 'failed' ? `stopped here${best.line ? `: ${best.line}` : ''}` : 'not reached'}`, state }
  })
  return (
    <ol className="stage-ladder" aria-label={`Stage ${reached} of ${of}`} data-stage-ladder>
      {cells.map((cell) => (
        <li key={cell.k} data-state={cell.state} title={cell.title}>
          <i style={cell.state === 'failed' ? { ['--fill' as string]: `${Math.round(partial * 100)}%` } : undefined} />
          <span>{cell.name}</span>
        </li>
      ))}
      <li data-state={solved ? 'passed' : 'ahead'} data-earlier={earlier ? 'yes' : 'no'} className="stage-solved"
        title={earlier ? `${shortTag(earlier.tag)} (${shortRun(play.id, earlier.runId)}) passed an earlier version of the check ${earlier.count ?? 1}×, ${utc(earlier.firstAt ?? earlier.at)}` : solved ? 'solved' : 'not solved under this check'}>
        <i />
        <span>{solved ? '✓ solved' : earlier ? 'passed before ✓' : 'solved'}</span>
      </li>
    </ol>
  )
}

/** Workloads passed of total as one dot each, with the count. */
function WorkloadDots({ value }: { value: { passed: number | null; total: number | null } }) {
  const total = value.total ?? 0
  const passed = value.passed ?? 0
  if (!total || total > 64) return <b>{passed} of {total}</b>
  return (
    <span className="workload-dots" title={`${passed} of ${total} workloads passed`}>
      <span aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} data-passed={i < passed ? 'yes' : 'no'} />
        ))}
      </span>
      <b>{passed} of {total}</b>
    </span>
  )
}

const BLOCKER_WORD: Record<string, string> = {
  'stuck-turn': 'Hung turn',
  'check-infra': 'Check infrastructure',
  'quota-wall': 'Quota wall',
  'gate-undecided': 'Gate unverified',
}
const ago = (since: string | null | undefined, until: string | null | undefined, now: number) => (since ? span((until ? new Date(until).valueOf() : now) - new Date(since).valueOf()) : null)

/**
 * A run's blocker in one line: severity, class and age, its evidence and its source; every other class beneath. For a
 * run that has ended, `until` is its end, so the age is how long the block lasted rather than time since.
 */
export function BlockerChip({ blocker, until, wallHours, now = Date.now() }: { blocker: PlayBlocker; until?: string | null; wallHours?: number | null; now?: number }) {
  // A blocker's tone comes from its severity only while its run is live; on an ended run (`until`) it is past, neutral.
  const status = statusOf({ axis: 'alert', severity: blocker.severity, live: !until })
  const lasted = blocker.since ? (until ? new Date(until).valueOf() : now) - new Date(blocker.since).valueOf() : null
  // On a run that has ended, a block that lasted (nearly) the whole run says so instead of repeating the run's hours.
  const whole = until && wallHours && lasted !== null && lasted >= wallHours * 3_600_000 * 0.9
  const age = whole ? 'the whole run' : ago(blocker.since, until, now)
  return (
    <div className="blocker-chip" data-blocker={blocker.class}>
      <p>
        {/* Red names its owner in its own visible text: an act-now mark is never only a colour. */}
        <StatusPill status={status} className="blocker-class">
          {BLOCKER_WORD[blocker.class] ?? blocker.class.replaceAll('-', ' ')}
          {status.tone === 'fail' && ` · act now: ${blocker.owner ?? 'Discovery operator'}`}
        </StatusPill>
        {age && <b className="blocker-age"> {age}</b>}
        {blocker.evidence && (
          <span className="blocker-evidence" title={[blocker.evidence, blocker.source && `source: ${blocker.source}`, blocker.owner && `owner: ${blocker.owner}`].filter(Boolean).join('\n')}>
            {' '}
            · {blocker.evidence}
          </span>
        )}
      </p>
      {blocker.also?.map((item) => (
        <p key={item.class} className="blocker-also" data-blocker-also={item.class} title={[item.evidence, item.source && `source: ${item.source}`].filter(Boolean).join('\n') || undefined}>
          also <b>{BLOCKER_WORD[item.class] ?? item.class.replaceAll('-', ' ')}</b>
          {item.evidence && <span className="blocker-evidence"> · {item.evidence}</span>}
        </p>
      ))}
    </div>
  )
}

type Checkpoint = NonNullable<NonNullable<Head['live']>['killCheckpoints']>[number]

/**
 * The prediction's kill checkpoints: each one's clause (cut to 15 words, whole in its tip), when it falls due, and what
 * was measured by then, or "measured: not yet" before it.
 */
function Checkpoints({ items, now }: { items: Checkpoint[]; now: number }) {
  if (!items.length) return null
  return (
    <ol className="kill-checkpoints" aria-label="Checkpoints from the run's prediction">
      {items.map((item) => {
        const measured = item.measured ?? null
        const stage = measured?.bestStage
        const stageText = typeof stage === 'string' ? stage : stage ? [stage.reached !== null && stage.reached !== undefined && stage.of ? `stage ${stage.reached} of ${stage.of}` : null, shortTag(stage.tag)].filter(Boolean).join(' · ') : null
        const missed = measured && !measured.publishedTags && !stageText
        return (
          <li key={item.label} data-due={item.due ? 'yes' : 'no'} data-missed={missed ? 'yes' : 'no'} title={item.clause ?? undefined}>
            <b className="mono">{item.label}</b>
            {item.clause && <span className="checkpoint-clause"> {clip(item.clause, 15)}</span>}
            <span className="faint"> · {item.due ? 'due' : 'fell due'} {clockZ(item.at, now) ?? 'at an unrecorded time'}</span>{' '}
            {measured ? (
              <span>
                · measured: {measured.publishedTags ?? 0} published {measured.publishedTags === 1 ? 'release' : 'releases'}
                {stageText ? ` · best ${stageText}` : ''}
                {measured.checksOnCommit !== null && measured.checksOnCommit !== undefined ? ` · ${measured.checksOnCommit} ${measured.checksOnCommit === 1 ? 'check' : 'checks'} on a commit` : ''}
              </span>
            ) : (
              <span className="faint">· measured: not yet</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** API-equivalent dollars with provenance, the priced share of started runs, the seat now and billing. Never $0 for unknown use. */
function CostLine({ play }: { play: Play }) {
  const cost = play.standing?.cost ?? null
  if (!cost) return null
  const unpriced = [...(cost.unpriced ?? []), ...(cost.unmetered ?? [])]
  return (
    <p className="play-cost faint" data-cost-provenance={cost.provenance ?? 'none'}>
      {cost.apiEquivalentUsd !== null && cost.apiEquivalentUsd !== undefined && cost.priced ? (
        <>
          <b className="play-cost-usd">{money(cost.apiEquivalentUsd)}</b> API-equivalent{cost.provenance && cost.provenance !== 'reported' ? ` (${cost.provenance})` : ''} ·{' '}
          <span title={unpriced.length ? `Not priced: ${unpriced.map((run) => shortRun(play.id, run)).join(', ')}` : undefined}>
            {cost.priced} of {cost.started ?? '?'} started runs priced
          </span>
        </>
      ) : (
        <>API-equivalent unpriced for {cost.started ?? unpriced.length} runs</>
      )}
      {cost.seatNow?.seat && (
        <>
          {' '}
          · seat <span title={cost.seatNow.seat}>{seatWords(cost.seatNow.seat)}</span>
          {cost.seatNow.kind ? ` (${cost.seatNow.kind})` : ''}
        </>
      )}
      {cost.billed !== null && cost.billed !== undefined && <> · billed: {typeof cost.billed === 'number' ? money(cost.billed) : cost.billed.replaceAll('-', ' ')}</>}
    </p>
  )
}

function Goal({ play }: { play: Play }) {
  const goal = goalOf(play)
  const [open, setOpen] = useState(false)
  if (!goal) return null
  return (
    <div className="play-goal" data-goal-source={play.goal?.source ?? 'composer'}>
      <p className={open ? '' : 'clamp-2'}>{open && goal.full ? goal.full : goal.text}</p>
      {goal.full && (
        <button type="button" className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'less' : 'full goal'}
        </button>
      )}
    </div>
  )
}


/** A bar row as a ratio to the bar: `Proving rate 202K cycles/s of 7.2M–8.7M cycles/s · 36× short`; a value that does not count says why. */
function BarRatio({ play, metric }: { play: Play; metric: PlayBarMetric }) {
  const best = metric.best ?? null
  const nearest = best ? null : (metric.nearest ?? null)
  const shown = best ?? nearest
  const target = targetWords(metric)
  const side = shown ? barSide(metric, shown.value) : null
  const ratio = best ? ratioWords(metric, best.value, side) : null
  const why = nearest ? (nearest.short ?? nearest.why ?? 'does not count') : null
  return (
    <div className="bar-row" data-bar-metric={metric.id} data-comparable={best ? 'yes' : nearest ? String(nearest.comparable) : 'none'}
      title={nearest ? `Nearest release ${shortTag(nearest.tag)} (${shortRun(play.id, nearest.runId)}) does not count: ${why}` : undefined}>
      <dt>{metric.label}</dt>
      <dd>
        {shown ? <b>{metricValue(shown.value, metric.unit)}</b> : <span className="faint">not measured</span>}
        {target && <> of {target}</>}
        {ratio && <span className="bar-gap"> · {ratio}</span>}
        {why && <span className="bar-gap faint" data-candidate-why> · {shortTag(nearest!.tag)}: {why}</span>}
      </dd>
    </div>
  )
}

function ratioWords(metric: PlayBarMetric, value: number, side: ReturnType<typeof barSide>) {
  if (side === 'within') return 'within the bar'
  const low = metric.target?.min ?? metric.target?.approx ?? metric.target?.max ?? null
  const high = metric.target?.max ?? metric.target?.approx ?? metric.target?.min ?? null
  if (low === null || high === null || !(value > 0)) return null
  const times = value < low ? low / value : value / high
  return `${times >= 10 ? Math.round(times) : times.toFixed(1)}× ${side === 'past' ? 'past' : 'short'}`
}

/**
 * The check's own vocabulary, behind one disclosure (wall redesign v2, Words): which version of the check rules and why,
 * how far one commit's score moves across reruns, how many releases it read, and the host's sentence as composed. Check
 * versions, amendments and gates are named only here.
 */
function HowTheCheckWorks({ play, report }: { play: Play; report: PlayReportDocument | null }) {
  const current = play.checkers?.find((item) => item.current) ?? null
  const ruler = ((report as { rulers?: unknown[] } | null)?.rulers ?? []).find((item) => (item as { current?: boolean }).current) ?? null
  const spread = spreadOf(current) ?? spreadOf(ruler)
  const marks = (play.climb?.marks ?? []).filter((mark) => current && mark.checker === current.label)
  const read = (kind: string) => new Set(marks.filter((mark) => mark.kind === kind).map((mark) => mark.columnId)).size
  const releases = play.standing?.releases ?? null
  return (
    <details className="how-check" data-how>
      <summary>How the check works</summary>
      {current && (
        <p data-ruler-line>
          Check {current.label} since {utc(current.ruling?.at ?? current.firstAt) ?? 'an unrecorded time'}
          {current.ruling?.by ? ` (${current.ruling.by})` : ''}; {play.checkers!.length} {play.checkers!.length === 1 ? 'version' : 'versions'}
          {current.ruling && <span className="faint" title={current.ruling.reason ?? undefined}> · {rulingWords(current.ruling)}</span>}
        </p>
      )}
      {spread && (
        <p data-measurement>
          Measurement: check spread {spread.min}–{spread.max} of {spread.of ?? 15} on one commit
          {spread.undecided ? ` · ${spread.undecided} undecided at the ${spread.capS ?? '?'} s prover cap` : ''}
          {spread.owner ? ` · owner ${spread.owner}` : ''}
        </p>
      )}
      {current && marks.length > 0 ? (
        <p data-releases-read>Releases: {read('check') + read('gate')} read under {current.label} ({read('check')} check, {read('gate')} gate){releases?.passingCurrent !== null && releases?.passingCurrent !== undefined ? ` · ${releases.passingCurrent} pass` : ''}</p>
      ) : releases?.checkedCurrent !== null && releases?.checkedCurrent !== undefined ? (
        <p data-releases-read>Releases: {releases.checkedCurrent} checked under {releases.checker ?? current?.label ?? 'the current check'} · {releases.passingCurrent ?? 0} pass</p>
      ) : null}
      {play.standing?.sentence && <p className="faint" data-standing-sentence><StandingText text={play.standing.sentence} /></p>}
    </details>
  )
}

function SolvedDrawer({ play, report }: { play: Play; report: PlayReportDocument | null }) {
  const best = play.standing?.bestCurrent ?? null
  const metrics = (play.bar?.metrics ?? []).filter((metric) => !metric.precondition)
  return (
    <>
      <Goal play={play} />
      {best ? (
        <dl className="goal-rows">
          <div className="goal-best"><dt>Best release</dt><dd><Provenance play={play} best={best} /></dd></div>
          {workloadWords(best.workloads) && <div><dt>Workloads</dt><dd><WorkloadDots value={best.workloads!} /></dd></div>}
        </dl>
      ) : (
        <p className="faint">No release has been checked yet.</p>
      )}
      {best && <StageLadder play={play} best={best} />}
      {metrics.length > 0 && (
        <>
          <h4>Against the bar <span className="faint">· {play.bar?.source ?? 'the play’s bar'}</span></h4>
          <dl className="bar-rows">{metrics.map((metric) => <BarRatio key={metric.id} play={play} metric={metric} />)}</dl>
        </>
      )}
      <HowTheCheckWorks play={play} report={report} />
    </>
  )
}

/** The live run, or the last one: its run and status, its newest output and check, its blocker and its checkpoints. */
function ProducingDrawer({ play, liveRun, now }: { play: Play; liveRun: RunDocument | null; now: number }) {
  const live = play.live ?? null
  const ending = play.standing?.lastEnding ?? null
  if (!live) {
    if (!ending) return <><p className="faint">No run of this play has started.</p><CostLine play={play} /></>
    const wall = ending.wallHours ?? play.ledger?.rows.find((row) => row.runId === ending.runId)?.wallHours ?? null
    // A crash needs a person for its first 24 h only while no newer run of the play has started; a play whose run list
    // does not list it cannot tell, so the crash is past.
    const listed = play.runs.find((run) => run.id === ending.runId)
    const newer = listed ? newerStarted({ id: ending.runId, play: listed.play, startedAt: ending.startedAt ?? listed.startedAt }, play.runs) : undefined
    const ended = statusOf({ axis: 'run', state: ending.word, reason: ending.reason, endedAt: ending.at, newerStarted: newer })
    return (
      <>
        <div className="live-box is-settled" aria-label="Last run" data-last-run={ending.runId}>
          <h4>
            Last run · <a className="mono" href={`/run/${encodeURIComponent(ending.runId)}`}>{ending.run ?? shortRun(play.id, ending.runId)}</a>{' '}
            <StatusPill status={ended} className="ending-glyph" />
            <span className="faint nowrap">{ending.at ? ` ${utc(ending.at)}` : ''}{wall !== null ? ` after ${wall >= 10 ? Math.round(wall) : wall.toFixed(1)} h` : ''}</span>
          </h4>
          {ending.blocker && <BlockerChip blocker={ending.blocker} until={ending.at} wallHours={wall} />}
          {ending.reason && !ending.blocker && <p className="faint ending-reason clamp-2" title={ending.reason}>ended: {hostWords(ending.reason.replaceAll('-', ' '))}</p>}
          <Checkpoints items={ending.killCheckpoints ?? []} now={now} />
        </div>
        <CostLine play={play} />
      </>
    )
  }
  const running = statusOf({ axis: 'run', state: 'running', elapsedMs: live.elapsedMs })
  const alert = live.blocker ? statusOf({ axis: 'alert', severity: live.blocker.severity, live: true }) : null
  const last = lastOutput(liveRun)
  const check = liveRun?.progress?.outcome?.latestCheck ?? null
  return (
    <>
      <div className="live-box" data-status={dataStatus(alert ?? running)} aria-label="Live run" data-live={live.runId}>
        <h4>
          Live · <a className="mono" href={`/run/${encodeURIComponent(live.runId)}`}>{live.run ?? shortRun(play.id, live.runId)}</a>{' '}
          <StatusPill status={running} className="ending-glyph" />
        </h4>
        <dl className="goal-rows">
          <div><dt>Output</dt><dd>{last ? `last output ${since(last.at, now)} ago (${last.kind})` : 'not read yet'}</dd></div>
          <div><dt>Newest check</dt><dd>{check?.at ? `${clockZ(check.at, now)}${check.tag ? ` on ${shortTag(check.tag)}` : ''}: ${clip(hostWords(lineReason(check.line) || 'no line'), 12)}` : 'none yet'}</dd></div>
        </dl>
        {live.blocker ? <BlockerChip blocker={live.blocker} now={now} /> : <p className="faint">No blocker recorded.</p>}
        <Checkpoints items={live.killCheckpoints ?? []} now={now} />
      </div>
      <CostLine play={play} />
    </>
  )
}

function BuiltDrawer({ play, report }: { play: Play; report: PlayReportDocument | null }) {
  const served = play as unknown as { built?: unknown; play_head?: { built?: unknown } }
  const built = builtOf(served.play_head?.built ?? served.built) ?? builtOf(report?.built)
  const href = `/play/${encodeURIComponent(play.id)}/report#built`
  if (!built?.crates?.value?.length) return <p className="faint">The play report lists no release contents yet. <a href={href} data-play-report-link>Open the play report</a></p>
  const commands = Object.entries(built.commands?.value ?? {})
  return (
    <>
      <h4>At {shortTag(built.release?.tag) ?? 'the best release'}{built.release?.runId ? ` (run ${shortRun(play.id, built.release.runId)})` : ''}</h4>
      <p className="built-crates">{built.crates.value.map((crate) => <span key={crate} className="tag">{crate}</span>)}</p>
      <dl className="goal-rows">
        {built.guests?.value ? <div><dt>Guest programs</dt><dd>{built.guests.value}</dd></div> : null}
        {commands.length > 0 && <div><dt>Ships</dt><dd>{commands.map(([name]) => name).join(', ')}</dd></div>}
        <div><dt>Outside crates</dt><dd>{built.externalCrates?.value ?? 'not read'}</dd></div>
      </dl>
      <a href={href} data-play-report-link>The full inventory in the play report</a>
    </>
  )
}

function NeedsDrawer({ play, now }: { play: Play; now: number }) {
  const live = play.live ?? null
  const ending = play.standing?.lastEnding ?? null
  if (!live?.blocker && !ending?.blocker) return <p className="faint">Nothing on this play needs a person.</p>
  return (
    <>
      {live?.blocker && <BlockerChip blocker={live.blocker} now={now} />}
      {ending?.blocker && <BlockerChip blocker={ending.blocker} until={ending.at} wallHours={ending.wallHours ?? null} />}
    </>
  )
}

/**
 * The focused play page's first screen (wall redesign v2): the play's name and one as-of, then four answers, solved?,
 * producing?, built and needs you, each with its detail in a drawer. Off the Standing tab the head is one sticky line:
 * name, verdict word and live run. The host composes every sentence and verdict; nothing here is inferred.
 */
export function PlayHeader({ play, fallback, api, compact = false, report, liveRun, now }: {
  play: Play
  fallback?: React.ReactNode
  /** Where to read the play report (for what was built) and the live run (for its output); tests pass both instead. */
  api?: string
  compact?: boolean
  report?: PlayReportDocument | null
  liveRun?: RunDocument | null
  now?: number
}) {
  const standing = play.standing ?? null
  const reportDoc = useDocument<PlayReportDocument>(api && report === undefined && standing ? `${api}/plays/${encodeURIComponent(play.id)}/report` : null)
  const liveDoc = useDocument<RunDocument>(api && liveRun === undefined && play.live ? `${api}/runs/${encodeURIComponent(play.live.runId)}` : null)
  const reportData = report === undefined ? (reportDoc.data ?? null) : report
  const liveData = liveRun === undefined ? (liveDoc.data ?? null) : liveRun
  const clock = now ?? Date.now()
  const asOf = <AsOf at={playAsOf(play, reportData)} source="the play document from the wall API" />
  if (!standing || standing.status === 'group')
    return (
      <header className="ws-head play-head" data-play-head data-standing={standing?.status ?? 'none'}>
        <div className="ws-title-row"><h1>{play.title}</h1>{asOf}</div>
        {standing ? <p className="play-sentence"><StandingText text={standing.sentence} /></p> : fallback}
      </header>
    )
  const answers = playAnswers({ play, report: reportData, liveRun: liveData, now: clock })
  if (compact) {
    const solved = answers[0]!
    return (
      <header className="ws-head play-head play-head-compact" data-play-head data-compact data-standing={standing.status}>
        <h1>{play.title}</h1>
        <span>· {solved.headline}</span>
        {play.live && <span>· <a className="mono" href={`/run/${encodeURIComponent(play.live.runId)}`}>{play.live.run ?? shortRun(play.id, play.live.runId)}</a> running</span>}
        {asOf}
      </header>
    )
  }
  const drawers: Record<string, React.ReactNode> = {
    'did-it-work': <SolvedDrawer play={play} report={reportData} />,
    'is-it-working': <ProducingDrawer play={play} liveRun={liveData} now={clock} />,
    'what-was-built': <BuiltDrawer play={play} report={reportData} />,
    'needs-me': <NeedsDrawer play={play} now={clock} />,
  }
  return (
    <header className="ws-head play-head" data-play-head data-standing={standing.status}>
      <div className="ws-title-row"><h1>{play.title}</h1>{asOf}</div>
      <AnswerStrip id={`play-${play.id}`} tiles={answers.map((answer) => ({ ...answer, drawer: drawers[answer.slot] }))} />
    </header>
  )
}
