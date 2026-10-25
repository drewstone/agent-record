import type { PlaysDocument } from '../workspace-model.js'
import { plainSummary } from './plain-words.js'
import { endingStatus, go, money, StandingText, StatusPill, statusOf } from './data.js'
import { shortTag, verdictWord } from './play-standing.js'
import { viewChip } from './view.js'

type PlayRow = PlaysDocument['plays'][number]

/** `2026-10-24T00:13:05Z` as `10-24 00:13Z`: a list row's time on one line. */
const short = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '')
/** A run's short id, `21c` for `magnetar-rust-20261021c` or `root-1-20261019b`; the full id is the link's title. */
const runOf = (run: string) => /\d{6}(\d\d[a-z])$/.exec(run)?.[1] ?? run
/** What the row's other columns do not say: the decision the play needs, else what blocks it. */
/**
 * What holds the play, in at most ten plain words: the host's plain why (or action) for the blocker, never its raw
 * text (a stopped run's blocker carries the operator's whole reason); the full text stays in the row's title.
 */
const holding = (view: NonNullable<NonNullable<PlayRow['standing']>['view']>) => {
  const need = view.needsYou?.[0] as { text: string; action?: string | null } | undefined
  if (need) return { tone: 'needs', text: `Needs you: ${plainSummary(need.action ?? need.text, 10)}` }
  const b = view.blocker
  return b ? { tone: 'blocked', text: `${b.kind === 'stopped' ? 'Stopped' : 'Blocked'}: ${plainSummary(b.why ?? b.text, 10)}` } : null
}

/**
 * One line per play. Its status, best release and last run's status are the play's view (tangle-tools views.play_view,
 * carried in `standing.view`), the words its play, run and Today pages print; a play whose page has not been composed
 * since the view existed falls back to its standing.
 */
export function PlaysTable({ rows, showHidden }: { rows: PlayRow[]; showHidden: boolean }) {
  return (
    <table className="data-table runs-table plays-table" data-play-list>
      <thead>
        <tr>
          <th>Play</th>
          <th>Status</th>
          <th>Best release</th>
          <th>Last run</th>
          <th className="num">Runs</th>
          <th className="num" title="Every token at list price, whoever paid; how many started runs were priced">API-equivalent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((play) => {
          const href = `/play/${encodeURIComponent(play.id)}`
          const open = () => go(href)
          const runs = !showHidden && play.counts ? play.counts.shown : play.runCount
          const standing = play.standing ?? null
          const view = standing?.view ?? null
          const last = standing?.lastEnding ?? null
          const cost = standing?.cost ?? null
          const lastId = last?.runId ?? play.latestRun?.id ?? null
          const lastStatus = lastId ? view?.runs?.[lastId] : undefined
          const best = view?.progress ?? null
          const legacy = (standing?.best ?? null) as { tag?: string | null; run?: string | null; checker?: string | null; verdict?: string | null } | null
          return (
            <tr key={play.id} data-play={play.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
              <td className="plays-name">
                <a href={href} title={play.program ? `program ${play.program}` : undefined} onClick={(event) => event.preventDefault()}>{play.title}</a>
              </td>
              <td className="plays-standing">
                {view ? (
                  <span className="plays-status" title={view.sentence}>
                    <StatusPill status={viewChip(view.status)} />
                    {holding(view) && <span className="clamp-1" data-holding={holding(view)!.tone}>{holding(view)!.text}</span>}
                  </span>
                ) : standing?.sentence ? (
                  <span className="clamp-1" title={standing.sentence}><StandingText text={standing.sentence} /></span>
                ) : (
                  <StatusPill status={statusOf({ axis: 'run', state: play.state })} />
                )}
              </td>
              <td className="plays-best">
                {best ? (
                  <span title={`${best.runId ? `${runOf(best.runId)} ` : ''}${best.release}: ${best.sentence}`}>
                    <span className="mono">{best.release}</span>
                    <span className="td-steps" aria-label={best.sentence}>
                      {best.steps.map((step, i) => <i key={i} data-step={step.state} />)}
                      <em>{best.passed}/{best.total}</em>
                    </span>
                  </span>
                ) : legacy?.tag || legacy?.run ? (
                  <span title={[legacy.checker ? `under ${legacy.checker}` : null, legacy.verdict ? verdictWord(legacy.verdict) : null].filter(Boolean).join(' · ') || undefined}>
                    <span className="mono">{shortTag(legacy.tag) ?? 'workspace'}</span>
                  </span>
                ) : (
                  <span className="faint">—</span>
                )}
              </td>
              <td className="plays-last">
                {lastId ? (
                  <a className="mono" title={lastId} href={`/run/${encodeURIComponent(lastId)}`}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); go(`/run/${encodeURIComponent(lastId)}`) }}>
                    {runOf(lastId)}
                  </a>
                ) : '—'}
                <span title={short(lastStatus?.at ?? last?.at ?? play.latestRun?.startedAt) ?? undefined}>{lastStatus ? <> <StatusPill status={viewChip(lastStatus)} className="ending-word" /></> : last?.word ? <> <StatusPill status={endingStatus(last.word)} className="ending-word" /></> : null}</span>
              </td>
              <td className="num" title={runs !== play.runCount ? `${play.runCount} in all; ${play.runCount - runs} behind the filter` : undefined}>
                {runs}
              </td>
              <td className="num" title={cost?.priced !== null && cost?.priced !== undefined ? `${cost.priced} of ${cost.started ?? '?'} started runs priced${cost.provenance ? ` (${cost.provenance})` : ''}` : undefined}>
                {cost?.apiEquivalentUsd !== null && cost?.apiEquivalentUsd !== undefined && cost.priced ? (
                  <>
                    {money(cost.apiEquivalentUsd)}{cost.priced !== cost.started ? '+' : ''}
                  </>
                ) : (
                  <span className="faint" title="API-equivalent not priced">—</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
