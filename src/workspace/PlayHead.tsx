import type { ReactNode } from 'react'
import type { PlayReportDocument } from '../play-report.js'
import { type Answer, barRatioLine, blockerName, checkVersionLine, measurementLine, plainWords, type Play, playAnswers, playAsOf } from './answers.js'
import { AnswerStrip, AsOfStamp } from './AnswerStrip.js'
import { dataStatus, money, standingSentence, StatusPill, statusOf } from './data.js'
import { hostWords, type PlayBlocker, shortRun, seatWords, span } from './play-standing.js'

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

/**
 * How the check works: the ruler and everything that names its versions (design-system section 6). The standing sentence
 * as the composer wrote it, the current version, the measurement noise, the releases the current version read, and each
 * bar metric's ratio to the bar. Closed by default; the words gate, v1–v4, amendment and superseded live only here.
 */
function CheckWorks({ play, now }: { play: Play; now: number }) {
  const standing = play.standing ?? null
  const version = checkVersionLine(play, now)
  const measurement = measurementLine(play)
  const releases = standing?.releases ?? null
  const metrics = (play.bar?.metrics ?? []).filter((metric) => !metric.precondition)
  const bars = metrics.map((metric) => ({ id: metric.id, line: barRatioLine(metric) })).filter((item) => item.line)
  if (!standing && !version && !bars.length) return null
  return (
    <details className="check-works" data-check-works>
      <summary>How the check works</summary>
      {standing && <Sentence text={standing.sentence} status={standing.status} />}
      {version && <p data-check-version>{version}</p>}
      {measurement && <p data-measurement>Measurement: {measurement}</p>}
      {releases && releases.published != null && (
        <p data-releases-checked={releases.checkedCurrent ?? undefined} title={releases.source ?? undefined}>
          Releases: {releases.checkedCurrent ?? '?'} read under {releases.checker ?? 'the current check'}, {releases.passingCurrent ?? 0} pass, {releases.neverCheckedCurrent ?? '?'} of {releases.published} published never read
        </p>
      )}
      {bars.length > 0 && (
        <ul className="check-bars" aria-label={`Against the bar: ${play.bar?.source ?? 'the play’s bar'}`}>
          {bars.map((item) => <li key={item.id} data-bar-metric={item.id}>{item.line}</li>)}
        </ul>
      )}
      {play.bar?.condition && <p className="faint">The bar: {play.bar.condition}. Ours: {play.bar.checkCondition ?? 'not stated'}.</p>}
    </details>
  )
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
          {blockerName(blocker)}
          {status.tone === 'fail' && ` · act now: ${blocker.owner ?? 'Discovery operator'}`}
        </StatusPill>
        {age && <b className="blocker-age"> {age}</b>}
        {blocker.evidence && (
          <span className="blocker-evidence" title={[blocker.evidence && plainWords(blocker.evidence), blocker.source && `source: ${blocker.source}`, blocker.owner && `owner: ${blocker.owner}`].filter(Boolean).join('\n')}>
            {' '}
            · {plainWords(blocker.evidence)}
          </span>
        )}
      </p>
      {blocker.also?.map((item) => (
        <p key={item.class} className="blocker-also" data-blocker-also={item.class} title={[item.evidence && plainWords(item.evidence), item.source && `source: ${item.source}`].filter(Boolean).join('\n') || undefined}>
          also <b>{blockerName(item)}</b>
          {item.evidence && <span className="blocker-evidence"> · {plainWords(item.evidence)}</span>}
        </p>
      ))}
    </div>
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

/**
 * The focused play page's first screen (v2): the h1 and the page's one as-of, then four answers (Solved?, Producing?,
 * Built, Needs you) and "How the check works", closed. `report` is the play report, whose `built` answers Built until
 * the play serves `play_head.built`. Off the Standing tab (`compact`) the header is one sticky line: name, verdict word,
 * live run.
 */
export function PlayHeader({ play, report, fallback, compact = false, linked = true, now = Date.now() }: { play: Play; report?: PlayReportDocument | null; fallback?: ReactNode; compact?: boolean; linked?: boolean; now?: number }) {
  const standing = play.standing ?? null
  const asOf = playAsOf(play)
  if (compact) {
    const verdict = standing?.bestCurrent ? statusOf({ axis: 'result', verdict: standing.status === 'solved' ? 'solved' : 'not-solved' }) : null
    return (
      <header className="ws-head play-head is-compact" data-play-head="compact">
        <h1>{linked ? <a href={`/play/${encodeURIComponent(play.id)}`}>{play.title}</a> : play.title}</h1>
        {verdict && <StatusPill status={verdict} />}
        {play.live && <a className="mono" href={`/run/${encodeURIComponent(play.live.runId)}`}>{play.live.run ?? shortRun(play.id, play.live.runId)} live</a>}
        <AsOfStamp asOf={asOf} />
      </header>
    )
  }
  const answers: Answer[] | null = standing && standing.status !== 'group' ? playAnswers(play, report, now) : null
  return (
    <header className="ws-head play-head" data-play-head data-standing={standing?.status ?? 'none'}>
      <div className="ws-title-row">
        <h1>{play.title}</h1>
        <AsOfStamp asOf={asOf} />
      </div>
      {answers ? <AnswerStrip answers={answers} label="Answers" extras={{ 'is-it-working': <CostLine play={play} /> }} /> : fallback}
      {answers && <CheckWorks play={play} now={now} />}
    </header>
  )
}
