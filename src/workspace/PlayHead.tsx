import { useState } from 'react'
import type { PlayDocument } from '../workspace-model.js'
import { dataStatus, money, newerStarted, standingSentence, type Status, StatusPill, statusOf } from './data.js'
import {
  barSide,
  checkerIndex,
  checkerTitle,
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
  seatWords,
  span,
  targetWords,
  utc,
  verdictWord,
  workloadWords,
} from './play-standing.js'
import { checkerColor } from '@tangle-network/charts'

type Play = PlayDocument & Head

/**
 * The play's goal exactly as the composer serves it from the play file's # Goal. A null goal (an index group, a play
 * without a goal section) draws no goal line: a run's objective is never shown as the play's goal.
 */
function goalOf(play: Play): { text: string; full: string | null } | null {
  if (!play.goal?.text) return null
  return { text: play.goal.text, full: play.goal.full && play.goal.full !== play.goal.text ? play.goal.full : null }
}

/**
 * The standing sentence as the composer wrote it, its verdict clause replaced by the status word (`No pass yet`), which
 * is neutral: a research miss is never red or amber.
 */
function Sentence({ text, status }: { text: string; status: string }) {
  const { lead, rest } = standingSentence(text)
  const other = lead ? null : /^(NEVER PRESSED|NO CHECK DECLARED)\b/.exec(rest)?.[0]
  return (
    <p className="play-sentence" data-standing={status}>
      {lead && <b className="play-verdict" data-status={dataStatus(lead)}>{lead.shape} {lead.word}</b>}
      {other && <b className="play-verdict">{other}</b>}
      {other ? rest.slice(other.length) : rest}
    </p>
  )
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
        title={earlier ? `${shortTag(earlier.tag)} (${shortRun(play.id, earlier.runId)}) passed ${earlier.checker} ${earlier.count ?? 1}×, ${utc(earlier.firstAt ?? earlier.at)}; ${earlier.supersededBy ? `superseded by ${earlier.supersededBy}` : 'an earlier checker'}` : solved ? 'solved' : 'not solved under this check'}>
        <i />
        <span>{solved ? '✓ solved' : earlier ? `${earlier.checker} ✓` : 'solved'}</span>
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

/** The current check: its stage ladder, workloads passed, and how many published releases pass it. */
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
        <>
          <StageLadder play={play} best={best} />
          <dl className="goal-rows">
            {!best.of && best.progress !== null && best.progress !== undefined && best.progress > 0 && best.progress < 1 && (
              <div title={best.line ?? undefined}>
                <dt>progress</dt>
                <dd className="goal-progress">
                  <span className="progress-track" aria-hidden="true">
                    <i style={{ width: `${(best.progress * 100).toFixed(1)}%` }} />
                  </span>
                  <b>{best.progress < 0.1 ? (best.progress * 100).toFixed(1) : Math.round(best.progress * 100)}%</b>
                  {/(\d[\d,]*) of (\d[\d,]*) cells covered/.exec(best.line ?? '') && <span className="faint"> {/(\d[\d,]*) of (\d[\d,]*) cells covered/.exec(best.line ?? '')![0]}</span>}
                </dd>
              </div>
            )}
            <div className="goal-best">
              <dt>best</dt>
              <dd>
                <Provenance play={play} best={best} />
              </dd>
            </div>
            {workloadWords(best.workloads) && (
              <div>
                <dt>workloads</dt>
                <dd>
                  <WorkloadDots value={best.workloads!} />
                </dd>
              </div>
            )}
            {releases && releases.published !== null && releases.published !== undefined && <ReleasesRow releases={releases} label={releases.checker ?? current?.label ?? null} />}
          </dl>
        </>
      ) : (
        <p className="faint">{current ? `${current.label} has not run on a commit yet.` : 'No check has run on a commit yet.'}</p>
      )}
    </div>
  )
}

type Releases = NonNullable<NonNullable<Play['standing']>['releases']>

/**
 * Published releases under the current checker, with the denominator the checker actually read: `1 checked under v4
 * (rc14) · 0 pass · 106 never checked under v4`, never `0 of 107` when 102 of those tags only an earlier checker read.
 */
function ReleasesRow({ releases, label }: { releases: Releases; label: string | null }) {
  const checker = label ?? 'the current check'
  const hover = [
    `${releases.published} published releases (tags in the play repository); ${releases.checked ?? 'an unrecorded number'} were ever checked, ${releases.withheld ?? 0} not published by the gate, ${releases.superseded ?? 0} superseded.`,
    releases.checkedCurrent !== null && releases.checkedCurrent !== undefined
      ? `Under ${checker}: ${releases.checkedCurrent} published checked${releases.checkedCurrentTags?.length ? ` (${releases.checkedCurrentTags.join(', ')})` : ''}, ${releases.passingCurrent ?? 0} pass, ${releases.neverCheckedCurrent ?? '?'} never checked.`
      : null,
    releases.source ? `Source: ${releases.source}.` : null,
  ]
    .filter(Boolean)
    .join('\n')
  if (releases.checkedCurrent === null || releases.checkedCurrent === undefined)
    return (
      <div title={hover}>
        <dt>releases</dt>
        <dd>
          <b>{releases.passingCurrent ?? 0} of {releases.published}</b> <span className="faint">published pass {checker}</span>
        </dd>
      </div>
    )
  const tags = releases.checkedCurrentTags ?? []
  return (
    <div title={hover} data-releases-checked={releases.checkedCurrent}>
      <dt>releases</dt>
      <dd className="releases-row">
        <b>
          {releases.checkedCurrent} checked under {checker}
          {tags.length > 0 && tags.length <= 3 ? ` (${tags.map((tag) => shortTag(tag)).join(', ')})` : ''} · {releases.passingCurrent ?? 0} pass
        </b>
        {releases.neverCheckedCurrent ? <span className="faint"> · {releases.neverCheckedCurrent} published never checked under {checker}</span> : null}
      </dd>
    </div>
  )
}

/**
 * Where a value sits against the bar on one log (or linear) track: the target as a shaded band, the stretch target as a
 * dashed band, and the value as a mark — filled when comparable, a ring with ✕ for a failing candidate, * not comparable,
 * ? comparability unknown. The track spans the value and both bands with room either side, so the distance is visible.
 */
function BarTrack({ metric, value, mark, status }: { metric: PlayBarMetric; value: number | null; mark: '' | '✕' | '*' | '?'; status: Status }) {
  const t = metric.target ?? null
  const st = metric.stretch ?? null
  const bounds = [value, t?.min, t?.max, t?.approx, st?.min, st?.max].filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && (metric.scale !== 'log' || item > 0))
  if (!bounds.length) return null
  const log = metric.scale === 'log'
  const f = (v: number) => (log ? Math.log10(v) : v)
  let lo = f(Math.min(...bounds))
  let hi = f(Math.max(...bounds))
  const pad = log ? 0.35 : (hi - lo || Math.abs(hi) || 1) * 0.15
  lo -= pad
  hi += pad
  const at = (v: number) => `${(((f(v) - lo) / (hi - lo)) * 100).toFixed(2)}%`
  const band = (from: number | null | undefined, to: number | null | undefined, cls: string, label: string) => {
    const a = from ?? to
    const b = to ?? from
    if (typeof a !== 'number' || typeof b !== 'number' || (log && (a <= 0 || b <= 0))) return null
    return <i className={cls} style={{ left: at(Math.min(a, b)), width: `max(6px, calc(${at(Math.max(a, b))} - ${at(Math.min(a, b))}))` }} title={label} />
  }
  // A dashed rule from the value to the nearer edge of the target, so the distance reads at a glance.
  const lowEdge = t?.min ?? t?.approx ?? t?.max ?? null
  const highEdge = t?.max ?? t?.approx ?? t?.min ?? null
  const edge = value === null || lowEdge === null || highEdge === null ? null : value < lowEdge ? lowEdge : value > highEdge ? highEdge : null
  return (
    <span className="bar-track" aria-hidden="true">
      {edge !== null && value !== null && <i className="bar-gapline" style={{ left: at(Math.min(value, edge)), width: `calc(${at(Math.max(value, edge))} - ${at(Math.min(value, edge))})` }} />}
      {band(st?.min, st?.max, 'bar-stretch', `stretch${st?.label ? ` (${st.label})` : ''}`)}
      {band(t?.min ?? t?.approx, t?.max ?? t?.approx, 'bar-target', `bar ${targetWords(metric) ?? ''}`)}
      {value !== null && <b className="bar-dot" data-status={dataStatus(status)} style={{ left: at(value) }}>{mark || status.shape}</b>}
    </span>
  )
}

/**
 * Why a candidate does not count, in the few words the row has room for: the host's `short` (`failing candidate (4/15)`,
 * `not comparable: 1-bit declared`), else words from its mark. A value that does not count never gets a ratio to the bar:
 * "2369× below" read as beating the paper for a 2^12-cycle, 1-bit run.
 */
function candidateWords(nearest: NonNullable<PlayBarMetric['nearest']>, mark: '' | '✕' | '*' | '?') {
  if (nearest.short) return nearest.short
  const workloads = nearest.workloads?.total ? ` (${nearest.workloads.passed ?? '?'}/${nearest.workloads.total})` : ''
  return mark === '✕' ? `failing candidate${workloads}` : mark === '?' ? 'comparability unknown' : (nearest.why ?? 'not comparable')
}

/** One bar metric: the best comparable value, else the nearest candidate marked failing (✕), not comparable (*) or of unknown comparability (?). */
function BarRow({ play, metric }: { play: Play; metric: PlayBarMetric }) {
  const best = metric.best ?? null
  const nearest = best ? null : (metric.nearest ?? null)
  const mark = nearest ? (nearest.comparable === null || nearest.comparable === undefined ? '?' : nearest.verdict && /fail|not-solved/.test(nearest.verdict) ? '✕' : '*') : ''
  // The bar with its unit (`bar 11–13 ms`); a long unit the value already shows (`cycles/s`) is left off so the row fits.
  const target = metric.unit && metric.unit.length > 4 ? targetWords(metric)?.replace(` ${metric.unit}`, '') : targetWords(metric)
  // Only a comparable, passing value states its distance to the bar; a candidate that does not count says why instead.
  const gap = best ? gapWords(metric, best.value) : null
  const why = nearest ? candidateWords(nearest, mark) : null
  const shown = best ?? nearest
  // A number is toned by its own comparison to the bar; whether its release passes is a separate neutral word.
  const side = shown ? barSide(metric, shown.value) : null
  const standing = statusOf({ axis: 'measure', side })
  const hover = nearest ? [`No release passes; nearest candidate ${shortTag(nearest.tag)} (${shortRun(play.id, nearest.runId)})`, nearest.why].filter(Boolean).join('\n') : (metric.missing?.why ?? undefined)
  return (
    <div className="bar-row" data-bar-metric={metric.id} data-comparable={best ? 'yes' : nearest ? String(nearest.comparable) : 'none'} title={hover}>
      <dt>
        {metric.label} <span className="faint" aria-label={metric.direction === 'up' ? 'higher is better' : 'lower is better'}>{metric.direction === 'up' ? '↑' : '↓'}</span>
      </dt>
      <dd className="bar-value">
        {shown ? (
          <span className={best ? '' : 'bar-nearest'}>
            <b data-status={dataStatus(standing)}>{standing.shape} {metricValue(shown.value, metric.unit)}</b> <span className="mono">{shortTag(shown.tag)}</span>
          </span>
        ) : (
          <span className="faint">not measured</span>
        )}
        {gap && <span className="bar-gap">{gap}</span>}
        {why && <span className="bar-gap bar-gap-candidate faint" data-candidate-why>on a {why}</span>}
      </dd>
      <dd className="bar-target">{target ? <>bar {target}</> : <span className="faint">no target</span>}</dd>
      <dd className="bar-track-cell">
        <BarTrack metric={metric} value={shown?.value ?? null} mark={mark} status={standing} />
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
            {marks.length === metrics.length && marks.length > 0 && <>No release passes: each value is the nearest candidate. </>}
            {marks.some((item) => item!.comparable === false && !/fail|not-solved/.test(item!.verdict ?? '')) && <>* not comparable{precondition ? ` (${precondition.label.toLowerCase()} under ${targetWords(precondition) ?? 'its bar'})` : ''} · </>}
            {marks.some((item) => item!.verdict && /fail|not-solved/.test(item!.verdict)) && <>✕ failing candidate · </>}
            {marks.some((item) => item!.comparable === null || item!.comparable === undefined) && <>? comparability unknown · </>}
            {play.bar?.checkCondition && <>ours: {play.bar.checkCondition}</>}
          </p>
        </div>
      )}
    </section>
  )
}

const BLOCKER_WORD: Record<string, string> = {
  'stuck-turn': 'Hung turn',
  'check-infra': 'Check infrastructure',
  'quota-wall': 'Quota wall',
  'gate-undecided': 'Gate unverified',
}
const ago = (since: string | null | undefined, until?: string | null) => (since ? span((until ? new Date(until).valueOf() : Date.now()) - new Date(since).valueOf()) : null)

/**
 * A run's blocker in one line: severity, class and age, its evidence and its source; every other class beneath. For a
 * run that has ended, `until` is its end, so the age is how long the block lasted rather than time since.
 */
export function BlockerChip({ blocker, until, wallHours }: { blocker: PlayBlocker; until?: string | null; wallHours?: number | null }) {
  // A blocker's tone comes from its severity only while its run is live; on an ended run (`until`) it is past, neutral.
  const status = statusOf({ axis: 'alert', severity: blocker.severity, live: !until })
  const lasted = blocker.since ? (until ? new Date(until).valueOf() : Date.now()) - new Date(blocker.since).valueOf() : null
  // On a run that has ended, a block that lasted (nearly) the whole run says so instead of repeating the run's hours.
  const whole = until && wallHours && lasted !== null && lasted >= wallHours * 3_600_000 * 0.9
  const age = whole ? 'the whole run' : ago(blocker.since, until)
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

/** The prediction's kill checkpoints: each `T+Nh` time with what was measured by then, or "due" before it. */
function Checkpoints({ items }: { items: Checkpoint[] }) {
  if (!items.length) return null
  return (
    <ol className="kill-checkpoints" aria-label="Kill checkpoints from the run's prediction">
      {items.map((item) => {
        const measured = item.measured ?? null
        const stage = measured?.bestStage
        const stageText = typeof stage === 'string' ? stage : stage ? [stage.reached !== null && stage.reached !== undefined && stage.of ? `stage ${stage.reached} of ${stage.of}` : null, shortTag(stage.tag)].filter(Boolean).join(' · ') : null
        const missed = measured && !measured.publishedTags && !stageText
        return (
          <li key={item.label} data-due={item.due ? 'yes' : 'no'} data-missed={missed ? 'yes' : 'no'} title={item.clause ?? undefined}>
            <b className="mono">{item.label}</b> <span className="faint">{utc(item.at)}</span>{' '}
            {item.due ? (
              <span className="faint">due</span>
            ) : measured ? (
              <span>
                {measured.publishedTags ?? 0} published {measured.publishedTags === 1 ? 'tag' : 'tags'}
                {stageText ? ` · best ${stageText}` : ''}
                {measured.checksOnCommit !== null && measured.checksOnCommit !== undefined ? ` · ${measured.checksOnCommit} ${measured.checksOnCommit === 1 ? 'check' : 'checks'} on a commit` : ''}
              </span>
            ) : (
              <span className="faint">not measured</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function LiveBox({ play }: { play: Play }) {
  const live = play.live ?? null
  const ending = play.standing?.lastEnding ?? null
  if (!live) {
    if (!ending) return null
    const wall = ending.wallHours ?? play.ledger?.rows.find((row) => row.runId === ending.runId)?.wallHours ?? null
    const blocker = ending.blocker ?? null
    // A crash here needs a person for its first 24 h only while no newer run of the play has started. The play's run list
    // answers that only when it lists this run; a placeholder without it leaves the answer unknown, so the crash is past.
    const listed = play.runs.find((run) => run.id === ending.runId)
    const newer = listed ? newerStarted({ id: ending.runId, play: listed.play, startedAt: ending.startedAt ?? listed.startedAt }, play.runs) : undefined
    const ended = statusOf({ axis: 'run', state: ending.word, reason: ending.reason, endedAt: ending.at, newerStarted: newer })
    return (
      <section className="live-box is-settled" aria-label="Last run" data-last-run={ending.runId}>
        <h4>
          Last run · <a className="mono" href={`/run/${encodeURIComponent(ending.runId)}`}>{ending.run ?? shortRun(play.id, ending.runId)}</a>{' '}
          <StatusPill status={ended} className="ending-glyph" />
          <span className="faint nowrap">
            {ending.at ? ` ${utc(ending.at)}` : ''}
            {wall !== null ? ` after ${wall >= 10 ? Math.round(wall) : wall.toFixed(1)} h` : ''}
          </span>
        </h4>
        {blocker && <BlockerChip blocker={blocker} until={ending.at} wallHours={wall} />}
        {ending.reason && !blocker && (
          <p className="faint ending-reason clamp-2" title={ending.reason}>
            ended: {ending.reason.replaceAll('-', ' ')}
          </p>
        )}
        <Checkpoints items={ending.killCheckpoints ?? []} />
      </section>
    )
  }
  const running = statusOf({ axis: 'run', state: 'running', elapsedMs: live.elapsedMs })
  const alert = live.blocker ? statusOf({ axis: 'alert', severity: live.blocker.severity, live: true }) : null
  return (
    <section className="live-box" data-status={dataStatus(alert ?? running)} aria-label="Live run" data-live={live.runId}>
      <h4>
        Live · <a className="mono" href={`/run/${encodeURIComponent(live.runId)}`}>{live.run ?? shortRun(play.id, live.runId)}</a>{' '}
        <StatusPill status={running} className="ending-glyph" />
        {live.word && live.word !== 'live' && <span className="faint"> {live.word}</span>}
      </h4>
      {live.blocker ? <BlockerChip blocker={live.blocker} /> : <p className="faint">No blocker recorded.</p>}
      <Checkpoints items={live.killCheckpoints ?? []} />
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
        <a className="play-report-link" href={`/play/${encodeURIComponent(play.id)}/report`} data-play-report-link>
          Report
        </a>
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
