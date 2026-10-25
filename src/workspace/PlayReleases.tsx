import { HBars } from '@tangle-network/charts/react'
import type { PlayDocument } from '../workspace-model.js'
import { type PlayHead, type PlayRelease, shortRun, shortTag, verdictWord } from './play-standing.js'

type Play = PlayDocument & PlayHead

const GROUPS = [
  ['published', 'Published'],
  ['withheld', 'Not published'],
  ['superseded', 'Superseded'],
] as const
const tagNumber = (tag: string) => Number(/(\d+)$/.exec(tag)?.[1] ?? 0)

/** A release's best check as steps passed of the play's ladder: a pass is every step, else its progress share; null without a step score. */
function stepsPassed(release: PlayRelease, steps: number) {
  const checks = Object.values(release.checks ?? {}).filter(Boolean)
  if (checks.some((check) => check.verdict === 'solved')) return steps
  const progress = checks.map((check) => check.progress).filter((p): p is number => typeof p === 'number')
  return progress.length ? Math.round(Math.max(...progress) * steps) : null
}

/**
 * The play's releases as a funnel of its check's steps (REVIEW-8 chart 1, replacing a 567-word matrix of verdict dots):
 * how many checked releases got past each step, by each release's best check. Every release stays one fold away, with
 * its run, best verdict and the receipt to take it from.
 */
export function PlayReleases({ play }: { play: Play }) {
  const releases = play.releases ?? []
  if (!releases.length) return <p className="ws-status">No release tag has been recorded for this play.</p>
  const steps = play.view?.progress?.steps ?? []
  const checked = releases.filter((release) => Object.keys(release.checks ?? {}).length)
  const passed = checked.map((release) => stepsPassed(release, steps.length))
  const unscored = passed.filter((p) => p === null).length
  return (
    <section className="ws-section play-releases" data-play-releases aria-label="Releases">
      <p className="faint">
        {GROUPS.map(([state, label]) => `${releases.filter((release) => (release.state ?? 'published') === state).length} ${label.toLowerCase()}`).join(' · ')}
        {` · ${checked.length} checked`}{unscored ? `, ${unscored} by checks that count no steps` : ''}
      </p>
      {steps.length > 0 && <HBars max={checked.length} format={(v) => `${v} of ${checked.length}`}
        rows={steps.map((step, i) => ({ label: `${i + 1} · ${step.label}`, value: passed.filter((p) => p !== null && p > i).length }))} />}
      <details className="release-list">
        <summary>Every release</summary>
        {GROUPS.map(([state, label]) => {
          const list = releases.filter((release) => (release.state ?? 'published') === state).sort((a, b) => b.runId.localeCompare(a.runId) || tagNumber(b.tag) - tagNumber(a.tag))
          return list.length ? (
            <div key={state}>
              <h3>{label} <span className="faint">{list.length}</span></h3>
              <ul>{list.map((release) => <ReleaseItem key={`${release.runId}@${release.tag}`} play={play} release={release} />)}</ul>
            </div>
          ) : null
        })}
      </details>
    </section>
  )
}

function ReleaseItem({ play, release }: { play: Play; release: PlayRelease }) {
  const best = Object.values(release.checks ?? {}).find((check) => check?.verdict === 'solved') ?? Object.values(release.checks ?? {})[0]
  const tag = shortTag(release.tag) ?? release.tag
  return (
    <li data-release={`${release.runId}@${release.tag}`}>
      <a className="mono" href={`/run/${encodeURIComponent(release.runId)}`}>{shortRun(play.id, release.runId)}/{tag}</a>
      <span className="faint"> {best ? verdictWord(best.verdict) : 'not checked'}</span>
      {release.take?.enabled && <> · <a href={`/run/${encodeURIComponent(release.runId)}/receipt/${encodeURIComponent(tag)}/`}>Take</a></>}
    </li>
  )
}
