import type { PlaysDocument } from '../workspace.js'

type PlayRow = PlaysDocument['plays'][number]

/**
 * Why a run or a play sits behind the workspace's default filter: a test or smoke run (named smoke, canary or probe, or
 * with no program), a failed run (failed, driver-failed), or a run whose directory was archived. The host decides it,
 * per run (`RunSummary.hidden`) and per play (`hidden`, set only when every run of the play is hidden); the viewer
 * counts and reveals what it hides and never guesses why.
 */
export type HiddenReason = 'failed' | 'smoke' | 'archived'
export const HIDDEN_ORDER = ['failed', 'smoke', 'archived'] as const
export const HIDDEN_LABEL: Record<HiddenReason, string> = { failed: 'failed', smoke: 'tests & smoke', archived: 'archived' }

const zero = (): Record<HiddenReason, number> => ({ failed: 0, smoke: 0, archived: 0 })

function split<T>(items: readonly T[], reason: (item: T) => HiddenReason | null | undefined, showHidden: boolean) {
  const counts = zero()
  let hidden = 0
  for (const item of items) {
    const why = reason(item)
    if (why) {
      counts[why] += 1
      hidden += 1
    }
  }
  return { shown: showHidden ? [...items] : items.filter((item) => !reason(item)), counts, hidden }
}

/** The plays a page shows, and the plays the filter holds back counted by reason, whether or not they are shown. */
export const splitHidden = <T extends PlayRow>(plays: readonly T[], showHidden: boolean) => split(plays, (play) => play.hidden, showHidden)

/** A play's runs the same way. */
export const splitRuns = <T extends { hidden?: HiddenReason | null }>(runs: readonly T[], showHidden: boolean) => split(runs, (run) => run.hidden, showHidden)

/** "2 failed · 1 archived": the non-zero counts, in the filter's order. */
export const hiddenSummary = (counts: Record<HiddenReason, number>) =>
  HIDDEN_ORDER.filter((reason) => counts[reason] > 0)
    .map((reason) => `${counts[reason]} ${HIDDEN_LABEL[reason]}`)
    .join(' · ')
