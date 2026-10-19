import { useMemo, useRef } from 'react'
import { VirtualList } from '../viewer/VirtualList.js'
import type { PlayDocument } from '../workspace.js'
import { checkerIndex, metricValue, type PlayHead, type PlayRelease, RELEASE_STATE, shortRun, shortTag, utc, verdictWord } from './play-standing.js'
import { checkerColor } from '@tangle-network/charts'

type Play = PlayDocument & PlayHead

const GROUPS = [
  ['published', 'Published'],
  ['withheld', 'Withheld by the gate'],
  ['superseded', 'Superseded'],
] as const
const tagNumber = (tag: string) => Number(/(\d+)$/.exec(tag)?.[1] ?? 0)
const tone = (verdict: string | null | undefined) => (verdict === 'solved' || verdict === 'contract-held' ? 'ok' : verdict === 'not-solved' || verdict === 'contract-failed' ? 'fail' : verdict ? 'unknown' : 'none')
const glyph = (verdict: string | null | undefined) => (tone(verdict) === 'ok' ? '✓' : tone(verdict) === 'fail' ? '✕' : verdict ? '?' : '·')

type Row = { kind: 'head'; id: string; label: string; count: number } | { kind: 'release'; id: string; release: PlayRelease }

/**
 * Every release tag across the play's runs (3.9): published, withheld by the gate and superseded, each with its gate
 * verdict, its verdict under every checker, how far it got, what it measured, the findings citing it, and whether it can
 * be taken. Published tags that were never checked are counted, not listed.
 */
export function PlayReleases({ play }: { play: Play }) {
  const releases = play.releases ?? []
  const scroller = useRef<HTMLDivElement>(null)
  const checkers = play.checkers ?? []
  const metrics = (play.bar?.metrics ?? []).filter((metric) => !metric.precondition)
  const rows = useMemo(() => {
    const out: Row[] = []
    const checked = releases.filter((release) => release.state !== 'published' || Object.keys(release.checks ?? {}).length || release.gate)
    for (const [state, label] of GROUPS) {
      const list = checked
        .filter((release) => (release.state ?? 'published') === state)
        .sort((a, b) => b.runId.localeCompare(a.runId) || tagNumber(b.tag) - tagNumber(a.tag))
      if (!list.length) continue
      out.push({ kind: 'head', id: `head:${state}`, label, count: list.length })
      for (const release of list) out.push({ kind: 'release', id: `${release.runId}@${release.tag}`, release })
    }
    return out
  }, [releases])
  if (!releases.length) return <p className="ws-status">No release tag has been recorded for this play.</p>
  const never = play.standing?.releases?.neverChecked ?? releases.filter((release) => (release.state ?? 'published') === 'published' && !Object.keys(release.checks ?? {}).length && !release.gate).length
  const columns = `64px 56px 84px 140px repeat(${checkers.length || 1}, minmax(52px, .5fr)) minmax(120px, 1.2fr) repeat(${metrics.length}, minmax(76px, .7fr)) 64px 64px`
  return (
    <section className="ws-section play-releases" data-play-releases aria-label="Releases">
      <p className="faint">
        {GROUPS.map(([state, label]) => `${releases.filter((release) => (release.state ?? 'published') === state).length} ${label.toLowerCase()}`).join(' · ')}
        {never ? ` · ${never} published but never checked (not listed)` : ''}
      </p>
      <div className="release-grid" style={{ ['--release-columns' as string]: columns }}>
        <div className="release-row release-header" role="row">
          <span>Tag</span>
          <span>Run</span>
          <span>Commit</span>
          <span>Gate</span>
          {checkers.length ? checkers.map((checker) => <span key={checker.sha256} title={checker.ruling?.label ?? checker.ruling?.reason ?? 'as pressed'} style={{ ['--checker' as string]: checkerColor(checkerIndex(checkers, checker.sha256) ?? 9) }} className="checker-head">{checker.label}</span>) : <span>Check</span>}
          <span>Furthest</span>
          {metrics.map((metric) => (
            <span key={metric.id} className="num">{metric.label}</span>
          ))}
          <span className="num">Findings</span>
          <span>Take</span>
        </div>
        <div ref={scroller} className="release-scroll">
          <VirtualList
            items={rows}
            keyOf={(row) => row.id}
            scroller={scroller}
            estimate={30}
            render={(row) =>
              row.kind === 'head' ? (
                <div className="release-group-head">
                  <b>{row.label}</b> <span className="faint">{row.count}</span>
                </div>
              ) : (
                <ReleaseRow play={play} release={row.release} metrics={metrics} />
              )
            }
          />
        </div>
      </div>
    </section>
  )
}

function ReleaseRow({ play, release, metrics }: { play: Play; release: PlayRelease; metrics: NonNullable<PlayHead['bar']>['metrics'] }) {
  const checkers = play.checkers ?? []
  const checks = release.checks ?? {}
  const furthest = Object.values(checks)
    .filter((check) => check.progress !== null && check.progress !== undefined)
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0]
  const take = release.take ?? null
  return (
    <div className="release-row" role="row" data-release={`${release.runId}@${release.tag}`} data-state={release.state ?? 'published'}>
      <span className="mono">
        <b>{shortTag(release.tag)}</b>
      </span>
      <span className="mono">
        <a href={`/run/${encodeURIComponent(release.runId)}`}>{shortRun(play.id, release.runId)}</a>
      </span>
      <span className="mono faint" title={[release.commit, release.taggedAt ? `tagged ${utc(release.taggedAt)}` : null, RELEASE_STATE[release.state ?? 'published']].filter(Boolean).join('\n')}>
        {release.commit?.slice(0, 8) ?? '—'}
      </span>
      <span className={`verdict-cell tone-${tone(release.gate?.verdict)}`} title={release.gate?.line ?? undefined}>
        {release.gate ? (
          <>
            {glyph(release.gate.verdict)} {verdictWord(release.gate.verdict)}
            {release.gate.count && release.gate.count > 1 ? ` ×${release.gate.count}` : ''}
          </>
        ) : (
          <span className="faint">no gate</span>
        )}
      </span>
      {checkers.length ? (
        checkers.map((checker) => {
          const check = checks[checker.label] ?? checks[checker.sha256]
          return (
            <span key={checker.sha256} className={`verdict-cell tone-${tone(check?.verdict)}`} title={check ? `${checker.label}: ${verdictWord(check.verdict)}${check.count && check.count > 1 ? ` ×${check.count}` : ''}` : `${checker.label}: not checked`}>
              {check ? (
                <>
                  {glyph(check.verdict)}
                  {check.count && check.count > 1 ? ` ×${check.count}` : ''}
                </>
              ) : (
                <span className="faint">·</span>
              )}
            </span>
          )
        })
      ) : (
        <span className="faint">·</span>
      )}
      <span>
        {furthest ? (
          <>
            {furthest.stage ?? verdictWord(furthest.verdict)}
            {furthest.workloads?.total ? ` · ${furthest.workloads.passed}/${furthest.workloads.total}` : ''}
          </>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      {metrics.map((metric) => {
        // The composer keys release metrics in camelCase (rateCps); the bar names them in snake case (rate_cps).
        const value = release.metrics?.[metric.id] ?? release.metrics?.[metric.id.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())]
        return (
          <span key={metric.id} className="num">
            {typeof value === 'number' ? metricValue(value, metric.unit) : <span className="faint">—</span>}
          </span>
        )
      })}
      <span className="num">{release.findings?.length || <span className="faint">0</span>}</span>
      <span>
        {take?.enabled ? (
          <a href={`/run/${encodeURIComponent(release.runId)}/receipt/${encodeURIComponent(shortTag(release.tag) ?? release.tag)}/`}>Take →</a>
        ) : (
          <span className="faint" title={`Not takeable: ${take?.why ?? 'not solved under the current check'}`}>
            —
          </span>
        )}
      </span>
    </div>
  )
}
