import { HBars } from '@tangle-network/charts/react'
import type { MouseEvent } from 'react'
import type { PlayDocument } from '../workspace-model.js'
import { useSearch } from './navigation.js'
import { checkerLabel, type PlayHead, type PlayRelease, shortRun, shortTag, verdictWord } from './play-standing.js'

type Play = PlayDocument & PlayHead
type Check = NonNullable<PlayRelease['checks']>[string]

const tagNumber = (tag: string) => Number(/(\d+)$/.exec(tag)?.[1] ?? 0)

/**
 * Where a release stops, by the newest check it ran under: a release checked again under a later check is judged by
 * that one (18b rc14 passed v3, then stopped at step 1 under v4). Passes are kept apart by whether their check is the
 * current one, so a pass under a replaced check never reads as the play's standing.
 */
function stopOf(play: Play, release: PlayRelease, steps: number): { key: string; checker: string | null; check: Check | null } {
  const order = (id: string) => (play.checkers ?? []).findIndex((item) => item.label === id || item.sha256 === id)
  const entries = Object.entries(release.checks ?? {}).filter(([, check]) => check)
  if (!entries.length) return { key: 'unchecked', checker: null, check: null }
  const [checker, check] = entries.sort(([a], [b]) => order(b) - order(a))[0]!
  const current = (play.checkers ?? []).find((item) => item.current)?.label ?? null
  if (check.verdict === 'solved') return { key: checker === current ? 'passed' : 'passed-replaced', checker, check }
  const reached = check.stage ?? (typeof check.progress === 'number' ? Math.round(check.progress * steps) + 1 : null)
  if (!reached) return { key: 'uncounted', checker, check }
  return { key: check.verdict === 'undecided' ? `open-${reached}` : `stop-${reached}`, checker, check }
}

/**
 * The play's releases as where each one stops (REVIEW-8 chart 1, in place of a 567-word matrix of verdict dots): one bar
 * per step that stopped a release, the hidden step whose verdict never came back, passes, and checks that count no steps.
 * A bar picks its releases into the list under the chart.
 */
export function PlayReleases({ play }: { play: Play }) {
  const [params, update] = useSearch()
  const releases = play.releases ?? []
  if (!releases.length) return <p className="ws-status">No release tag has been recorded for this play.</p>
  const steps = play.view?.progress?.steps ?? []
  const stops = releases.map((release) => ({ release, ...stopOf(play, release, steps.length) }))
  const label = (key: string) => {
    const step = Number(key.split('-')[1])
    if (key.startsWith('stop-')) return `Stopped at ${steps[step - 1]?.label ?? `step ${step}`}`
    if (key.startsWith('open-')) return `No verdict at ${steps[step - 1]?.label ?? `step ${step}`}`
    return { passed: `Passed all ${steps.length} steps`, 'passed-replaced': `Passed ${checkersOf(key).join(', ')}, since replaced`, uncounted: 'Check counts no steps', unchecked: 'Not checked' }[key] ?? key
  }
  const color = (key: string) =>
    // Colour is state only: the steps that stop releases are the play's open problem; everything else is neutral.
    key === 'passed' ? 'var(--ar-c-ok)' : key.startsWith('stop-') ? 'var(--ar-c-warn)' : key.startsWith('open-') ? 'color-mix(in srgb, var(--ar-c-warn) 45%, var(--ar-bg))' : 'var(--ar-c-neutral)'
  const keys = [
    ...steps.flatMap((_, i) => [`stop-${i + 1}`, `open-${i + 1}`]),
    'passed', 'passed-replaced', 'uncounted', 'unchecked',
  ].filter((key) => stops.some((stop) => stop.key === key))
  const checkersOf = (key: string) => [...new Set(stops.filter((stop) => stop.key === key).map((stop) => stop.checker).filter(Boolean))]
    .map((id) => checkerLabel(play.checkers, id))
  // With no pick, the list shows where the newest checked release stops: the play's current answer.
  const newest = stops.filter((stop) => stop.check).sort((a, b) => (b.release.firstCheckedAt ?? '').localeCompare(a.release.firstCheckedAt ?? ''))[0]?.key ?? null
  const asked = params.get('stop')
  const selected = asked === 'none' ? null : keys.includes(asked ?? '') ? asked! : newest
  // HBars rows are links; picking one stays on the page and fills the list (no reload, no history entry per pick).
  const pick = (event: MouseEvent) => {
    const link = (event.target as Element).closest('a[href*="stop="]')
    if (!link) return
    event.preventDefault()
    const key = new URL(link.getAttribute('href')!, window.location.href).searchParams.get('stop')
    update({ stop: key === selected ? 'none' : key }, true)
  }
  const shown = stops.filter((stop) => stop.key === selected).sort((a, b) => b.release.runId.localeCompare(a.release.runId) || tagNumber(b.release.tag) - tagNumber(a.release.tag))
  const byRun = [...new Set(shown.map((stop) => stop.release.runId))]
  return (
    <section className="ws-section play-releases" data-play-releases aria-label="Where releases stop">
      <div className="release-stops" data-primary-content data-picked={selected ? '' : undefined} onClick={pick}>
        {selected && <style>{`.ar-ws .release-stops a[href$="stop=${selected}"] { opacity: 1; background: var(--chart-live-hover); } .ar-ws .release-stops a[href$="stop=${selected}"] .ov-hbar-label { color: var(--ar-fg); font-weight: 600; }`}</style>}
        <HBars max={Math.max(...keys.map((key) => stops.filter((stop) => stop.key === key).length))} limit={keys.length}
          rows={keys.map((key) => ({
            label: label(key),
            value: stops.filter((stop) => stop.key === key).length,
            color: color(key),
            href: `?tab=releases&stop=${key}`,
          }))} />
      </div>
      {selected && (
        <div className="release-list" aria-label={label(selected)}>
          {byRun.map((runId) => (
            <p key={runId}>
              <a className="mono" href={`/run/${encodeURIComponent(runId)}`}>{shortRun(play.id, runId)}</a>
              {shown.filter((stop) => stop.release.runId === runId).map((stop) => <ReleaseItem key={stop.release.tag} play={play} release={stop.release} check={stop.check} checker={stop.checker} />)}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

function ReleaseItem({ play, release, check, checker }: { play: Play; release: PlayRelease; check: Check | null; checker: string | null }) {
  const tag = shortTag(release.tag) ?? release.tag
  const words = [
    `${shortRun(play.id, release.runId)}/${tag}`,
    release.state && release.state !== 'published' ? (release.state === 'withheld' ? 'not published' : release.state) : null,
    check ? `${verdictWord(check.verdict)} under ${checkerLabel(play.checkers, checker)}${check.workloads?.total ? `, ${check.workloads.passed}/${check.workloads.total} workloads` : ''}` : 'not checked',
    release.commit ? `commit ${release.commit}` : null,
  ].filter(Boolean).join(' · ')
  const href = release.take?.enabled ? `/run/${encodeURIComponent(release.runId)}/receipt/${encodeURIComponent(tag)}/` : `/run/${encodeURIComponent(release.runId)}`
  return <a className={`mono release-tag${release.state && release.state !== 'published' ? ' is-faint' : ''}`} href={href} title={words}>{tag}</a>
}
