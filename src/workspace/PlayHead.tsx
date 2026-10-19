import { useState } from 'react'
import type { PlayDocument } from '../workspace.js'
import { money } from './data.js'
import {
  checkerIndex,
  checkerTitle,
  ENDING_GLYPH,
  gapWords,
  metricValue,
  type PlayBarMetric,
  type PlayBest,
  type PlayBlocker,
  type PlayHead as Head,
  RELEASE_STATE,
  rulingWords,
  shortRun,
  shortTag,
  span,
  stageWords,
  targetWords,
  utc,
  verdictWord,
  workloadWords,
} from './play-standing.js'
import { checkerColor } from '@tangle-network/charts'

type Play = PlayDocument & Head

/** The play's goal: the composer's first paragraph (at most 220 characters), else the play input's objective. */
function goalOf(play: Play): { text: string; full: string | null } | null {
  if (play.goal?.text) return { text: play.goal.text, full: play.goal.full && play.goal.full !== play.goal.text ? play.goal.full : null }
  const objective = play.input?.objective?.trim()
  if (!objective) return null
  const first = objective.split(/\n\s*\n/)[0]!.replace(/^Drew, [^:]{1,40}: "[^"]*"\.?\s*/, '').trim()
  return first.length > 220 ? { text: `${first.slice(0, 219).trimEnd()}…`, full: objective } : { text: first, full: first !== objective ? objective : null }
}

/** The standing sentence with its verdict clause in bold, as the composer wrote it. */
function Sentence({ text, status }: { text: string; status: string }) {
  const lead = /^(NOT SOLVED|SOLVED|UNDECIDED|NEVER PRESSED|NO CHECK DECLARED)\b/.exec(text)?.[0]
  return (
    <p className="play-sentence" data-standing={status}>
      {lead ? (
        <>
          <b className={`play-verdict verdict-${status}`}>{lead}</b>
          {text.slice(lead.length)}
        </>
      ) : (
        text
      )}
    </p>
  )
}

const verdictGlyph = (verdict: string | null | undefined) =>
  verdict === 'solved' || verdict === 'contract-held' ? '✓' : verdict === 'not-solved' || verdict === 'contract-failed' ? '✕' : verdict === 'undecided' ? '?' : ''

/** Where a best row came from: `rc16 (18b) ✕ withheld by the gate`, with its line on hover. */
function Provenance({ play, best }: { play: Play; best: PlayBest | null | undefined }) {
  if (!best) return null
  const glyph = verdictGlyph(best.verdict)
  return (
    <span className="goal-prov" title={[best.line, best.lastAt ?? best.at ? `last ${utc(best.lastAt ?? best.at)}` : null].filter(Boolean).join('\n') || undefined}>
      <b className="mono">{shortTag(best.tag) ?? 'no tag'}</b>
      {best.runId && <span className="faint"> ({shortRun(play.id, best.runId)})</span>}
      {glyph && <span className={`goal-glyph glyph-${glyph === '✓' ? 'ok' : glyph === '✕' ? 'fail' : 'unknown'}`}> {glyph}</span>}
      {best.state && best.state !== 'published' && <span className="faint"> {RELEASE_STATE[best.state] ?? best.state}</span>}
      {!best.state && best.verdict && <span className="faint"> {verdictWord(best.verdict)}</span>}
    </span>
  )
}

/** The current check's rows: stage reached, workloads passed, and how many published releases pass it. */
function CheckRows({ play }: { play: Play }) {
  const standing = play.standing!
  const current = play.checkers?.find((item) => item.current) ?? null
  const best = standing.bestCurrent ?? null
  const releases = standing.releases ?? null
  const index = current ? checkerIndex(play.checkers, current.sha256) : undefined
  return (
    <div className="goal-check" data-goal-check={current?.label ?? 'none'}>
      <h4>
        {current ? (
          <span className="checker-chip" title={checkerTitle(current)} style={{ ['--checker' as string]: checkerColor(index ?? 0) }}>
            Check {current.label}
          </span>
        ) : (
          'Check'
        )}
        {current?.ruling && (
          <span className="faint goal-ruling clamp-1" title={[current.ruling.label, current.ruling.reason].filter(Boolean).join('\n')}>
            {' '}
            {rulingWords(current.ruling)}
          </span>
        )}
      </h4>
      {best ? (
        <dl className="goal-rows">
          {stageWords(best) && (
            <div>
              <dt>stage</dt>
              <dd title={best.line ?? undefined}>
                <b>{best.reached} of {best.of}</b>
                {best.stage && <span className="faint"> {best.stage}</span>} <Provenance play={play} best={best} />
              </dd>
            </div>
          )}
          {workloadWords(best.workloads) && (
            <div>
              <dt>workloads</dt>
              <dd>
                <b>{best.workloads!.passed} of {best.workloads!.total}</b>
              </dd>
            </div>
          )}
          {!stageWords(best) && (
            <div>
              <dt>newest</dt>
              <dd>
                {verdictWord(best.verdict)} <Provenance play={play} best={best} />
              </dd>
            </div>
          )}
          {releases && releases.published !== null && releases.published !== undefined && (
            <div title={`Published releases that pass ${current?.label ?? 'the current check'}, of the published releases; ${releases.checked ?? 'an unrecorded number'} were ever checked, ${releases.withheld ?? 0} withheld by the gate, ${releases.superseded ?? 0} superseded`}>
              <dt>releases passing</dt>
              <dd>
                <b>{releases.passingCurrent ?? 0} of {releases.published}</b> <span className="faint">published{releases.withheld ? ` · ${releases.withheld} withheld` : ''}</span>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="faint">{current ? `${current.label} has not run on a commit yet.` : 'No check has run on a commit yet.'}</p>
      )}
    </div>
  )
}

/** One bar metric: the best comparable value, else the nearest candidate marked failing (✕), not comparable (*) or of unknown comparability (?). */
function BarRow({ play, metric }: { play: Play; metric: PlayBarMetric }) {
  const best = metric.best ?? null
  const nearest = best ? null : (metric.nearest ?? null)
  const mark = nearest ? (nearest.comparable === null || nearest.comparable === undefined ? '?' : nearest.verdict && /fail|not-solved/.test(nearest.verdict) ? '✕' : '*') : ''
  const target = targetWords(metric)
  // A distance is stated only for a comparable value: a 1-bit or failing candidate is no measure of the gap to the bar.
  const gap = best ? gapWords(metric, best.value) : null
  return (
    <div className="bar-row" data-bar-metric={metric.id} data-comparable={best ? 'yes' : nearest ? String(nearest.comparable) : 'none'}>
      <dt title={metric.label}>{metric.label}</dt>
      <dd className="bar-value">
        {best ? (
          <>
            <b>{metricValue(best.value, metric.unit)}</b> <span className="mono faint">{shortTag(best.tag)}</span>
          </>
        ) : nearest ? (
          <span className={`bar-nearest mark-${mark === '✕' ? 'fail' : 'na'}`} title={[`No release passes; nearest candidate ${shortTag(nearest.tag)} (${shortRun(play.id, nearest.runId)})`, nearest.why].filter(Boolean).join('\n')}>
            {shortTag(nearest.tag)} {metricValue(nearest.value, metric.unit)} {mark}
          </span>
        ) : (
          <span className="faint" title={metric.missing?.why ?? undefined}>not measured</span>
        )}
      </dd>
      <dd className="bar-target">
        {target ? (
          <>
            bar {target} <span aria-label={metric.direction === 'up' ? 'higher is better' : 'lower is better'}>{metric.direction === 'up' ? '↑' : '↓'}</span>
          </>
        ) : (
          <span className="faint">no target</span>
        )}
        {gap && <span className="bar-gap"> · {gap}</span>}
      </dd>
    </div>
  )
}

function GoalBlock({ play }: { play: Play }) {
  const metrics = (play.bar?.metrics ?? []).filter((metric) => !metric.precondition)
  const precondition = (play.bar?.metrics ?? []).find((metric) => metric.precondition)
  const marks = metrics.map((metric) => (metric.best ? null : metric.nearest)).filter(Boolean)
  return (
    <section className={`goal-block${metrics.length ? '' : ' no-bar'}`} aria-label="Goal">
      <CheckRows play={play} />
      {metrics.length > 0 && (
        <div className="goal-bar">
          <h4>
            Bar <span className="faint">· {play.bar?.source ?? 'the play’s bar'}</span>
          </h4>
          <dl className="bar-rows">
            {metrics.map((metric) => (
              <BarRow key={metric.id} play={play} metric={metric} />
            ))}
          </dl>
          <p className="faint bar-caption" title={[play.bar?.condition && `The bar: ${play.bar.condition}`, play.bar?.checkCondition && `The check measures: ${play.bar.checkCondition}`].filter(Boolean).join('\n') || undefined}>
            {marks.length === metrics.length && marks.length > 0 && <>No release passes; each value is the nearest candidate · </>}
            {marks.some((item) => item!.comparable === false && !/fail|not-solved/.test(item!.verdict ?? '')) && <>* not comparable{precondition ? ` (${precondition.label} below ${targetWords(precondition) ?? 'its bar'})` : ''} · </>}
            {marks.some((item) => item!.verdict && /fail|not-solved/.test(item!.verdict)) && <>✕ from a failing candidate · </>}
            {marks.some((item) => item!.comparable === null || item!.comparable === undefined) && <>? comparability unknown · </>}
            {play.bar?.condition && <>bar: {play.bar.condition}</>}
            {play.bar?.checkCondition && <> · ours: {play.bar.checkCondition}</>}
          </p>
        </div>
      )}
    </section>
  )
}

const BLOCKER_WORD: Record<string, string> = {
  'stuck-turn': 'Stuck',
  'check-infra': 'Check infrastructure',
  'quota-wall': 'Quota wall',
  'gate-undecided': 'Gate undecided',
}
const ago = (since: string | null | undefined) => (since ? span(Date.now() - new Date(since).valueOf()) : null)

/** The live run's blocker in one line: severity, class and age, its evidence and its source; every other class beneath. */
export function BlockerChip({ blocker }: { blocker: PlayBlocker }) {
  const age = ago(blocker.since)
  return (
    <div className={`blocker-chip severity-${blocker.severity}`} data-blocker={blocker.class}>
      <p>
        <b className="blocker-class">{BLOCKER_WORD[blocker.class] ?? blocker.class.replaceAll('-', ' ')}</b>
        {age && <b className="blocker-age"> {age}</b>}
        {blocker.evidence && (
          <span className="blocker-evidence" title={[blocker.evidence, blocker.source && `source: ${blocker.source}`, blocker.owner && `owner: ${blocker.owner}`].filter(Boolean).join('\n')}>
            {' '}
            · {blocker.evidence}
          </span>
        )}
      </p>
      {blocker.also?.map((item) => (
        <p key={item.class} className="blocker-also" data-blocker-also={item.class} title={item.source ?? undefined}>
          also <b>{BLOCKER_WORD[item.class] ?? item.class.replaceAll('-', ' ')}</b>
          {item.evidence && <span className="blocker-evidence"> · {item.evidence}</span>}
        </p>
      ))}
    </div>
  )
}

function LiveBox({ play }: { play: Play }) {
  const live = play.live ?? null
  const ending = play.standing?.lastEnding ?? null
  if (!live) {
    if (!ending) return null
    return (
      <section className="live-box is-settled" aria-label="Last run">
        <h4>Last run</h4>
        <p>
          <a className="mono" href={`/run/${encodeURIComponent(ending.runId)}`}>{ending.run ?? shortRun(play.id, ending.runId)}</a>{' '}
          <span className="ending-glyph">{ending.glyph ?? ENDING_GLYPH[ending.word] ?? ''}</span> {ending.word}
          {ending.at && <span className="faint"> {utc(ending.at)}</span>}
          {ending.reason && <span>: {ending.reason}</span>}
        </p>
      </section>
    )
  }
  const checkpoints = live.killCheckpoints ?? []
  return (
    <section className={`live-box ${live.blocker ? `severity-${live.blocker.severity}` : ''}`} aria-label="Live run" data-live={live.runId}>
      <h4>
        Live · <a className="mono" href={`/run/${encodeURIComponent(live.runId)}`}>{live.run ?? shortRun(play.id, live.runId)}</a>
        <span className="faint">
          {' '}
          {live.word && live.word !== 'live' ? `${live.word} · ` : ''}
          {live.elapsedMs !== null && live.elapsedMs !== undefined ? `T+${span(live.elapsedMs)}` : ''}
        </span>
      </h4>
      {live.blocker ? <BlockerChip blocker={live.blocker} /> : <p className="faint">No blocker recorded.</p>}
      {checkpoints.length > 0 && (
        <ol className="kill-checkpoints" aria-label="Kill checkpoints from the run's prediction">
          {checkpoints.map((item) => {
            const measured = item.measured ?? null
            const stage = measured?.bestStage
            const stageText = typeof stage === 'string' ? stage : stage ? [stage.reached !== null && stage.reached !== undefined && stage.of ? `stage ${stage.reached} of ${stage.of}` : null, shortTag(stage.tag)].filter(Boolean).join(' · ') : null
            return (
              <li key={item.label} data-due={item.due ? 'yes' : 'no'} title={item.clause ?? undefined}>
                <b className="mono">{item.label}</b> <span className="faint">{utc(item.at)}</span>{' '}
                {item.due ? (
                  <span className="faint">due</span>
                ) : measured ? (
                  <span>
                    {measured.publishedTags ?? 0} published {measured.publishedTags === 1 ? 'tag' : 'tags'}
                    {stageText ? ` · best ${stageText}` : ''}
                    {measured.checksOnCommit !== null && measured.checksOnCommit !== undefined ? ` · ${measured.checksOnCommit} checks on a commit` : ''}
                  </span>
                ) : (
                  <span className="faint">not measured</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
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
          · seat {cost.seatNow.seat}
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
    <div className="play-goal" data-goal-source={play.goal?.source ?? 'input.objective'}>
      <p className={open ? '' : 'clamp-2'}>{open && goal.full ? goal.full : goal.text}</p>
      {goal.full && (
        <button type="button" className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'less' : 'full goal'}
        </button>
      )}
    </div>
  )
}

/**
 * The focused play page's first screen (J7): what the play is trying to do, where it stands under the current check
 * with the checker named, the distance to its bar, what blocks the live run and whether it met its own checkpoints,
 * and the cost. The host composes each sentence and verdict; nothing here is inferred.
 */
export function PlayHeader({ play, fallback }: { play: Play; fallback?: React.ReactNode }) {
  const standing = play.standing ?? null
  return (
    <header className="ws-head play-head" data-play-head data-standing={standing?.status ?? 'none'}>
      <div className="ws-title-row">
        <h1>{play.title}</h1>
      </div>
      <Goal play={play} />
      {standing ? <Sentence text={standing.sentence} status={standing.status} /> : fallback}
      {standing && standing.status !== 'group' && (play.checkers?.length || play.bar || play.live || standing.lastEnding) && (
        <div className="play-goal-grid">
          {(play.checkers?.length || play.bar) && <GoalBlock play={play} />}
          <LiveBox play={play} />
        </div>
      )}
      <CostLine play={play} />
    </header>
  )
}
