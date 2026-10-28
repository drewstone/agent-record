import type { PlaysDocument } from '../workspace-model.js'
import { plainSummary } from './plain-words.js'
import { endingStatus, go, money, StandingText, StatusPill, statusOf } from './data.js'
import { Tip } from './AnswerStrip.js'
import { shortTag, verdictWord } from './play-standing.js'
import { viewChip } from './view.js'

type PlayRow = PlaysDocument['plays'][number]

/** `2026-10-24T00:13:05Z` as `10-24 00:13Z`: a list row's time on one line. */
const short = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z` : '')
/** A run's short id, `21c` for `magnetar-rust-20261021c` or `root-1-20261019b`; the full id is the link's title. */
const runOf = (run: string) => /\d{6}(\d\d[a-z])$/.exec(run)?.[1] ?? run
/** What the row's other columns do not say: the decision the play needs, else what blocks it. */
/**
 * What holds the play as a short label beside the pill (who holds it), the plain why in its tooltip: the sentence
 * clipped in every row (review 4 #15).
 */
const holding = (view: NonNullable<NonNullable<PlayRow['standing']>['view']>) => {
  // "Needs you" only for Drew's own items, as Today counts them; an item its owner holds names that owner (review 1 #2).
  const needs = (view.needsYou ?? []) as { text: string; action?: string | null; owner?: string | null }[]
  const mine = needs.find((n) => n.owner === 'Drew')
  if (mine) return { tone: 'needs', text: 'Needs you', why: plainSummary(mine.action ?? mine.text, 24) }
  const held = needs[0]
  if (held) return { tone: 'blocked', text: `With ${held.owner ?? 'its owner'}`, why: plainSummary(held.action ?? held.text, 24) }
  const b = view.blocker
  return b ? { tone: 'blocked', text: b.kind === 'stopped' ? 'Stopped' : 'Blocked', why: plainSummary(b.why ?? b.text, 24) } : null
}

/**
 * One line per play. Its status, best release and last run's status are the play's view (tangle-tools views.play_view,
 * carried in `standing.view`), the words its play, run and Today pages print; a play whose page has not been composed
 * since the view existed falls back to its standing.
 */
/** `live`: each play's running run, which the Last run column shows over a newer run that already stopped. */
export function PlaysTable({ rows, sort, onSort, live }: { rows: PlayRow[]; sort: string; onSort: (sort: 'runs' | 'spend' | null) => void; live?: ReadonlyMap<string, string> }) {
  // The numeric headers set the page's one order (its `sort` parameter), most first; a second click restores the latest-run order.
  const head = (key: 'runs' | 'spend', label: string, title?: string) => (
    <th className="num" aria-sort={sort === key ? 'descending' : undefined} title={title}>
      <button type="button" className="link-button sort-button" onClick={() => onSort(sort === key ? null : key)}>{label}{sort === key ? ' ↓' : ''}</button>
    </th>
  )
  return (
    <table className="data-table runs-table plays-table" data-play-list>
      <thead>
        <tr>
          <th>Play</th>
          <th>Status</th>
          <th>Best release</th>
          <th>Last run</th>
          {head('runs', 'Runs')}
          {head('spend', 'API-equivalent', 'Every token at list price, whoever paid; how many started runs were priced')}
        </tr>
      </thead>
      <tbody>
        {rows.map((play) => {
          const href = `/play/${encodeURIComponent(play.id)}`
          const open = () => go(href)
          const standing = play.standing ?? null
          const view = standing?.view ?? null
          const last = standing?.lastEnding ?? null
          const cost = standing?.cost ?? null
          // The newest run, with its status from the play's view; the last ended run's word only when it is that run (REVIEW-9).
          const lastId = live?.get(play.id) ?? play.latestRun?.id ?? last?.runId ?? null
          const lastStatus = lastId ? view?.runs?.[lastId] : undefined
          const lastWord = lastId && lastId === last?.runId ? last.word : null
          const best = view?.progress ?? null
          const legacy = (standing?.best ?? null) as { tag?: string | null; run?: string | null; checker?: string | null; verdict?: string | null } | null
          return (
            <tr key={play.id} data-play={play.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
              <td className="plays-name">
                <a href={href} title={play.program ? `program ${play.program}` : undefined} onClick={(event) => event.preventDefault()}>{play.title}</a>
              </td>
              <td className="plays-standing">
                {view ? (
                  // The pill alone, who holds it and why in its tooltip; only a decision for Drew keeps its words (REVIEW-5 #9:
                  // two-line cells made the rows uneven).
                  <Tip className="plays-status" text={[holding(view) && `${holding(view)!.text}: ${holding(view)!.why}`, view.sentence].filter(Boolean).join(' · ')}>
                    <StatusPill status={viewChip(view.status)} />
                    {holding(view)?.tone === 'needs' && <span data-holding="needs">{holding(view)!.text}</span>}
                  </Tip>
                ) : standing?.sentence ? (
                  <span className="clamp-1" title={standing.sentence}><StandingText text={standing.sentence} /></span>
                ) : (
                  <StatusPill status={statusOf({ axis: 'run', state: play.state })} />
                )}
              </td>
              <td className="plays-best">
                {/* One type for the release and its score (mono rc1 beside an italic 5/6 read as two systems, judges 10-27). */}
                {best ? (
                  <span title={`${best.runId ? `${runOf(best.runId)} ` : ''}${best.release}: ${best.sentence}`}>
                    <b className="rel">{best.release}</b>
                    <span className="td-steps" aria-label={best.sentence}>
                      {best.steps.map((step, i) => <i key={i} data-step={step.state} />)}
                    </span>
                    <span className="score">{best.passed}/{best.total}</span>
                  </span>
                ) : legacy?.tag || legacy?.run ? (
                  <span title={[legacy.checker ? `under ${legacy.checker}` : null, legacy.verdict ? verdictWord(legacy.verdict) : null].filter(Boolean).join(' · ') || undefined}>
                    {shortTag(legacy.tag) ? <b className="rel">{shortTag(legacy.tag)}</b> : <span className="faint">untagged</span>}
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
                {/* The last run's state only when it differs from the play's own (a second "▶ Running" beside the first said nothing). */}
                {(() => { const word = lastStatus ? lastStatus.label : lastWord ? endingStatus(lastWord).word : null; return word && word !== view?.status.label ? <span className="faint ending-word" title={short(lastStatus?.at ?? play.latestRun?.startedAt) ?? undefined}> {word}</span> : null })()}
              </td>
              <td className="num">{play.runCount}</td>
              <td className="num" title={cost?.priced !== null && cost?.priced !== undefined ? `${cost.priced} of ${cost.started ?? '?'} started runs priced${cost.provenance ? ` (${cost.provenance})` : ''}` : undefined}>
                {cost?.apiEquivalentUsd !== null && cost?.apiEquivalentUsd !== undefined && cost.priced ? (
                  <>
                    {cost.priced !== cost.started ? '≥' : ''}{money(cost.apiEquivalentUsd)}
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
