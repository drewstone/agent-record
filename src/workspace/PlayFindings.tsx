import type { FeedItem, PlayDocument } from '../workspace-model.js'
import { dataStatus, statusOf } from './data.js'
import { plain } from './FindingsFeed.js'
import { checkerLabel, type PlayHead, shortRun, shortTag, utc, verdictWord } from './play-standing.js'
import { plainSummary } from './plain-words.js'

type Play = PlayDocument & PlayHead

/** The host's groups (tangle-tools joined_findings), each with words that are true of every row in it. */
const GROUPS = [
  ['verified', 'Verified by the current check', 'A commit it cites is solved, or its contract held, under the current checker.'],
  ['contradicted', 'Contradicted', 'No check or gate held what it cites, and at least one contradicted it.'],
  ['mixed', 'Checked, not settled', 'A check or the gate held what it cites under one checker; another contradicted it.'],
  ['undecided', 'Unverified', 'Every row on the commits it cites is unverified: no check decided it.'],
  ['unchecked', 'Unchecked agent claims', 'No check row matches anything it cites.'],
] as const

// A group this renderer does not know is shown as checked-not-settled, never as unchecked: it has evidence.
const groupOf = (item: FeedItem) => (GROUPS.some(([id]) => id === item.group) ? (item.group as string) : item.commits?.length ? 'mixed' : 'unchecked')
/** A cited commit's verdict, read against its check version: a pass under a retired check is neutral, like every miss. */
const commitStatus = (play: Play, commit: { verdict?: string | null; checker?: string | null }) => {
  const named = commit.checker ? play.checkers?.find((item) => item.sha256 === commit.checker || item.label === commit.checker || item.sha256.startsWith(commit.checker!)) : null
  return statusOf({ axis: 'result', verdict: commit.verdict, current: named?.current ?? true, checker: named?.label ?? null })
}

/**
 * An agent's page title as one plain sentence (review 1 #12): no parenthesised branches, tips or hashes, no shouted
 * words, no "PLAY —" prefix, sentence case, at most 14 words. The agent's own title stays the link's tooltip.
 */
export function findingTitle(raw: string, tag?: string | null) {
  const parts = raw.replace(/\s*\([^)]*(\)|$)/g, '').replace(/\b(tip\s+)?[0-9a-f]{7,40}\b/g, '').replace(/\s+@\s*/g, ' ').split(/\s+—\s+/)
  const kept = parts.length > 1 && /^[A-Z0-9-]+$/.test(parts[0]!.trim()) ? parts.slice(1) : parts
  const words = kept.join(': ').replace(/\s+\+\s+/g, ', ').replace(/\b([A-Z]{4,}|THE|AND|FOR|NOT|ALL)\b/g, (w) => w.toLowerCase()).replace(/\s+/g, ' ').trim()
  const line = (words.split(' ').length < 2 && tag ? `${words} at ${tag}` : words).replace(/^./, (c) => c.toUpperCase())
  return plainSummary(line, 14)
}

function Row({ play, item }: { play: Play; item: FeedItem }) {
  const tags = [...new Map((item.commits ?? []).map((commit) => [commit.tag ?? commit.sha, commit])).values()]
  const base = findingTitle(plain(item.title) || plain(item.text).slice(0, 140), tags.find((c) => c.tag)?.tag) || 'Untitled page'
  // Two runs' handoffs at the same tag read alike; the run tells them apart (review 2 #12).
  const title = /^Handoff\b/.test(base) ? `${base} (${shortRun(play.id, item.runId)})` : base
  const writer = item.writer ?? item.agentLabel ?? null
  const at = item.writtenAt ?? null
  const href = item.href ?? `/run/${encodeURIComponent(item.runId)}?section=findings`
  return (
    <li className="finding-row" data-finding={item.id ?? item.sha256} data-group={groupOf(item)}>
      <a className="finding-title" href={href} title={[plain(item.title), plain(item.text).slice(0, 600)].filter(Boolean).join('\n\n') || undefined}>
        {title}
      </a>
      <span className="finding-meta faint" title={[writer, at ? utc(at) : item.at ? `${utc(item.at)} (the record's time, not the commit's)` : null].filter(Boolean).join(' · ') || undefined}>
        <span className="chip kind-chip">{item.kind}</span>
        <span className="mono">{shortRun(play.id, item.runId)}</span>
        {item.duplicates && item.duplicates.length > 0 && <span className="chip" title="Pages that say the same thing, folded here"> +{item.duplicates.length} alike</span>}
      </span>
      {tags.length > 0 && (
        <span className="finding-commits">
          {/* One chip per release: the same tag cited under two checks or kinds was drawn twice (rc125). */}
          {tags.map((commit) => {
            const status = commitStatus(play, commit)
            return (
            <span
              key={`${commit.sha}:${commit.checker ?? ''}:${commit.kind ?? ''}`}
              className="commit-chip"
              data-status={dataStatus(status)}
              title={[
                [commit.run ? shortRun(play.id, commit.run) : null, verdictWord(commit.verdict), typeof commit.workloads === 'object' && commit.workloads?.total ? `${commit.workloads.passed}/${commit.workloads.total}` : null, commit.checker ? checkerLabel(play.checkers, commit.checker) : null].filter(Boolean).join(' · '),
                `commit ${commit.sha}`, commit.line, commit.at ? `at ${utc(commit.at)}` : null, commit.kind === 'gate' ? 'tag gate' : null,
              ].filter(Boolean).join('\n')}
            >
              {status.shape}{' '}
              {commit.tag ? <b>{shortTag(commit.tag)}</b> : <>commit {commit.sha.slice(0, 7)}</>}
            </span>
            )
          })}
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
  // Newest first within a group, so the three newest verified findings lead (review 1 #12).
  const newest = (a: FeedItem, b: FeedItem) => Date.parse(b.writtenAt ?? b.at ?? '') - Date.parse(a.writtenAt ?? a.at ?? '') || 0
  const ordered = GROUPS.flatMap(([id]) => items.filter((item) => groupOf(item) === id).sort(newest))
  const shown = limit ? ordered.slice(0, limit) : ordered
  const counts = new Map(GROUPS.map(([id]) => [id, items.filter((item) => groupOf(item) === id).length]))
  return (
    <section className="ws-section play-findings" data-play-findings aria-label="Findings">
      <header className="section-head">
        <h3>Findings</h3>
      </header>
      {GROUPS.map(([id, label, why]) => {
        const rows = shown.filter((item) => groupOf(item) === id)
        if (!rows.length) return null
        return (
          <details key={id} className={`finding-group group-${id}`} open={id !== 'unchecked' || !limit}>
            <summary title={why}>
              <b>{label}</b> <span className="num">{counts.get(id)}</span>
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
