import type { FeedItem, PlayDocument } from '../workspace.js'
import { dataStatus, statusOf } from './data.js'
import { plain } from './FindingsFeed.js'
import { checkerLabel, type PlayHead, shortRun, shortTag, utc, verdictWord } from './play-standing.js'

type Play = PlayDocument & PlayHead

/** The host's groups (tangle-tools joined_findings), each with words that are true of every row in it. */
const GROUPS = [
  ['verified', 'Verified by the current check', 'A commit it cites is solved, or its contract held, under the current checker.'],
  ['contradicted', 'Contradicted', 'No check or gate held what it cites, and at least one contradicted it.'],
  ['mixed', 'Checked, not settled', 'A check or the gate held what it cites under one checker; another contradicted it.'],
  ['undecided', 'Undecided', 'Every row on the commits it cites is undecided.'],
  ['unchecked', 'Unchecked agent claims', 'No check row matches anything it cites.'],
] as const

// A group this renderer does not know is shown as checked-not-settled, never as unchecked: it has evidence.
const groupOf = (item: FeedItem) => (GROUPS.some(([id]) => id === item.group) ? (item.group as string) : item.commits?.length ? 'mixed' : 'unchecked')
/** A cited commit's verdict, read against its check version: a pass under a retired check is neutral, like every miss. */
const commitStatus = (play: Play, commit: { verdict?: string | null; checker?: string | null }) => {
  const named = commit.checker ? play.checkers?.find((item) => item.sha256 === commit.checker || item.label === commit.checker || item.sha256.startsWith(commit.checker!)) : null
  return statusOf({ axis: 'result', verdict: commit.verdict, current: named?.current ?? true, checker: named?.label ?? null })
}

function Row({ play, item }: { play: Play; item: FeedItem }) {
  const title = plain(item.title) || plain(item.text).slice(0, 140) || 'Untitled page'
  const writer = item.writer ?? item.agentLabel ?? null
  const at = item.writtenAt ?? null
  const href = item.href ?? `/run/${encodeURIComponent(item.runId)}?section=findings`
  return (
    <li className="finding-row" data-finding={item.id ?? item.sha256} data-group={groupOf(item)}>
      <a className="finding-title" href={href} title={plain(item.text).slice(0, 600) || undefined}>
        {title}
      </a>
      <span className="finding-meta faint">
        <span className="chip kind-chip">{item.kind}</span>
        <span className="mono">{shortRun(play.id, item.runId)}</span>
        {writer && <> · {writer}</>}
        {at ? <> · {utc(at)}</> : !item.writtenAt && item.at ? <span title="The page's time as the record states it, not the commit that wrote it"> · {utc(item.at)}</span> : null}
        {item.duplicates && item.duplicates.length > 0 && <span className="chip" title="Pages that say the same thing, folded here"> +{item.duplicates.length} alike</span>}
      </span>
      {item.commits && item.commits.length > 0 && (
        <span className="finding-commits">
          {item.commits.map((commit) => (
            <span
              key={`${commit.sha}:${commit.checker ?? ''}:${commit.kind ?? ''}`}
              className="commit-chip"
              data-status={dataStatus(commitStatus(play, commit))}
              title={[`commit ${commit.sha}`, commit.line, commit.at ? `at ${utc(commit.at)}` : null, commit.kind === 'gate' ? 'tag gate' : null].filter(Boolean).join('\n')}
            >
              {commit.tag ? <b>{shortTag(commit.tag)}</b> : <>commit {commit.sha.slice(0, 7)}</>}
              {commit.run && <> ({shortRun(play.id, commit.run)})</>} {verdictWord(commit.verdict)}
              {typeof commit.workloads === 'object' && commit.workloads?.total ? ` ${commit.workloads.passed}/${commit.workloads.total}` : ''}
              {commit.checker && <> · {checkerLabel(play.checkers, commit.checker)}</>}
            </span>
          ))}
        </span>
      )}
    </li>
  )
}

/**
 * What the play found, ranked by its check (3.7): pages whose cited commits the current check confirms, contradicts or
 * has not decided, then claims no check touched, folded. `limit` keeps the top rows for the Standing tab.
 */
export function PlayFindings({ play, limit, onMore }: { play: Play; limit?: number; onMore?: () => void }) {
  const items = play.findings ?? []
  if (!items.length) return null
  const ordered = GROUPS.flatMap(([id]) => items.filter((item) => groupOf(item) === id))
  const shown = limit ? ordered.slice(0, limit) : ordered
  const counts = new Map(GROUPS.map(([id]) => [id, items.filter((item) => groupOf(item) === id).length]))
  return (
    <section className="ws-section play-findings" data-play-findings aria-label="Findings">
      <header className="section-head">
        <h3>Findings</h3>
        <p className="faint">
          {GROUPS.filter(([id]) => counts.get(id))
            .map(([id, label]) => `${counts.get(id)} ${label.toLowerCase()}`)
            .join(' · ')}
        </p>
      </header>
      {GROUPS.map(([id, label, why]) => {
        const rows = shown.filter((item) => groupOf(item) === id)
        if (!rows.length) return null
        return (
          <details key={id} className={`finding-group group-${id}`} open={id !== 'unchecked' || !limit}>
            <summary>
              <b>{label}</b> <span className="faint">{counts.get(id)} · {why}</span>
            </summary>
            <ul>
              {rows.map((item) => (
                <Row key={item.id ?? item.sha256} play={play} item={item} />
              ))}
            </ul>
          </details>
        )
      })}
      {limit && ordered.length > limit && onMore && (
        <button type="button" className="link-button" onClick={onMore}>
          All {ordered.length} findings →
        </button>
      )}
    </section>
  )
}
