import { HBars } from '@tangle-network/charts/react'
import { type MouseEvent, useMemo, useState } from 'react'
import type { FeedItem, FindingsFeedDocument } from '../workspace-model.js'
import { useDocument } from './data.js'
import { findingTitle } from './PlayFindings.js'
import { shortRun, utc } from './play-standing.js'

/** The host's outside verdict per page (tangle-tools findings.page_review), in the order the trust bars read. */
export const REVIEWS = [
  ['new', 'New', 'var(--ar-c-ok)'],
  ['reproduction', 'Reproduced', 'var(--ar-c-info)'],
  ['known', 'Already known', 'var(--ar-c-neutral)'],
  ['wrong', 'Wrong', 'var(--ar-c-fail)'],
  ['unverifiable', 'Unverifiable', 'color-mix(in srgb, var(--ar-c-neutral) 70%, transparent)'],
  ['pending', 'Not reviewed', 'color-mix(in srgb, var(--ar-c-neutral) 35%, transparent)'],
] as const
export type Review = (typeof REVIEWS)[number][0]
const GROUP_ROWS = 6
const PAGE_ROWS = 50

const short = (label: string | null | undefined) => (label ? label.split(' · ')[0]! : 'agent')
// A card shows prose: markdown emphasis, code ticks and list bullets from the page are dropped, the words kept.
/**
 * A finding as a reader reads it, by the host's rules (tangle-tools fleet/discovery_workspace.py `_plain`): no front matter
 * or key line ahead of its prose (`--- kind: claim … ---`, `kind: evidence`), no heading or list marker, no Markdown
 * emphasis or code marks. A document composed before the host applied them reads the same.
 */
export const plain = (text: string | null | undefined) =>
  (text ?? '')
    .replace(/^\s*---\s[\s\S]{0,4096}?\s---(?=\s|$)/, '')
    .replace(/^(?:\s*[a-z_][a-z0-9_]*(?:[-.][a-z0-9_]+)*:(?:[ \t]+(?:\[[^\]\n]*\]|[^\s[]+))?(?=\s|$))+/, '')
    .replace(/(^|\s)#{1,6}\s+(?=\S)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .trim()

/**
 * What the runs found and whether an outside reviewer trusts it (journey Q5): the served findings as bars by outside
 * verdict, each bar a filter, over one line per finding grouped the same way. Counts are the host's (`shown.byReview`).
 */
export function FindingsFeed({ api, query = '', program = '', review, onReview }: { api: string; query?: string; program?: string; review: Review | null; onReview: (review: Review | null) => void }) {
  const feed = useDocument<FindingsFeedDocument>(`${api}/findings`)
  const [more, setMore] = useState(PAGE_ROWS)
  const items = useMemo(() => {
    const needle = query.toLowerCase()
    return (feed.data?.items ?? []).filter((item) => (!program || item.program === program) && (!needle || `${item.play} ${item.title} ${item.text}`.toLowerCase().includes(needle)))
  }, [feed.data, program, query])
  if (feed.error && !feed.data) return <p className="ws-status" role="alert">Findings are unavailable: {feed.error}</p>
  if (!feed.data) return <p className="ws-status" role="status">Gathering what the runs found…</p>
  const { runs, shown } = feed.data
  const filtered = !!(query || program)
  // A bar is a link to its filter; the click stays in the page (no reload), a second click clears it.
  const pick = (event: MouseEvent) => {
    const href = (event.target as Element).closest('a')?.getAttribute('href')
    const picked = href && new URLSearchParams(href.split('?')[1]).get('review')
    if (!picked) return
    event.preventDefault()
    setMore(PAGE_ROWS)
    onReview(picked === review ? null : (picked as Review))
  }
  const groups = REVIEWS.map(([id, label, color]) => ({ id, label, color, rows: items.filter((item) => item.review === id) })).filter((group) => group.rows.length)
  const open = review ? groups.filter((group) => group.id === review) : groups
  return (
    <section className="findings-feed" aria-label="What the runs found" data-findings-feed={items.length}>
      <div className="findings-trust" data-review={review ?? 'all'} onClickCapture={pick}>
        <p className="faint">
          {shown ? `Newest ${shown.items} of ${runs.results + runs.claims}` : runs.results + runs.claims} findings from {runs.withFindings} runs
          {runs.pending ? `; ${runs.pending} runs not read yet` : ''}.
        </p>
        {shown && (
          <HBars
            limit={REVIEWS.length}
            rows={REVIEWS.map(([id, label, color]) => ({ label, value: shown.byReview[id] ?? 0, color, href: `/plays?view=findings&review=${id}` }))}
            format={(value) => value.toLocaleString('en-US')}
          />
        )}
      </div>
      {!items.length && <p className="ws-status">No findings match.</p>}
      <div className="finding-groups" data-primary-content>
        {(shown ? open : [{ id: null, label: null, color: null, rows: items }]).map((group) => {
          const rows = review || !shown ? group.rows.slice(0, more) : group.rows.slice(0, GROUP_ROWS)
          return (
            <section key={group.id ?? 'all'} className="finding-group" data-review={group.id ?? undefined}>
              {group.label && (
                <h3>
                  <span className="dot" style={{ background: group.color ?? undefined }} aria-hidden="true" />
                  {group.label} <span className="num faint">{filtered ? group.rows.length : (shown?.byReview[group.id as Review] ?? group.rows.length)}</span>
                </h3>
              )}
              <ol className="finding-lines">
                {rows.map((item) => <Line key={`${item.runId}:${item.sha256}`} item={item} />)}
              </ol>
              {group.rows.length > rows.length && (
                <button type="button" className="link-button" onClick={() => (review || !shown ? setMore(group.rows.length) : onReview(group.id as Review))}>
                  All {group.rows.length} →
                </button>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}

/** One finding on one line: its title, play and run, and when it was written; the full text is the tooltip. */
function Line({ item }: { item: FeedItem }) {
  const text = plain(item.text)
  const title = item.ledger ? `${short(item.agentLabel)}'s result: ${findingTitle(text.slice(0, 140))}` : findingTitle(plain(item.title) || text.slice(0, 140)) || 'Untitled page'
  return (
    <li className="finding-line" data-review={item.review ?? 'pending'}>
      <a href={`/run/${encodeURIComponent(item.runId)}?section=findings`} title={[plain(item.title), text].filter(Boolean).join('\n\n')}>
        <span className="finding-line-title clamp-1">{title}</span>
        <span className="finding-line-meta faint">
          {item.play} <span className="mono">{shortRun(item.play, item.runId)}</span> · {utc(item.at) ?? 'undated'}
        </span>
      </a>
    </li>
  )
}
