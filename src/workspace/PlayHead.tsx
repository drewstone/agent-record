import { blockerName, plainWords, type Play, playAsOf } from './answers.js'
import { AsOfStamp } from './AnswerStrip.js'
import { StatusPill, statusOf } from './data.js'
import { type PlayBlocker, shortRun, span } from './play-standing.js'
import { type HostView, viewChip } from './view.js'

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

/** The play page's header on every tab: its name, the host's status, the live run and the page's one as-of. */
export function PlayHeader({ play, linked = true }: { play: Play; linked?: boolean }) {
  const view = play.view as HostView | undefined
  return (
    <header className="ws-head play-head is-compact" data-play-head="compact">
      <h1>{linked ? <a href={`/play/${encodeURIComponent(play.id)}`}>{play.title}</a> : play.title}</h1>
      {view?.status && <StatusPill status={viewChip(view.status)} />}
      {play.live && <a className="mono" href={`/run/${encodeURIComponent(play.live.runId)}`}>{play.live.run ?? shortRun(play.id, play.live.runId)} live</a>}
      <AsOfStamp asOf={playAsOf(play)} />
    </header>
  )
}
