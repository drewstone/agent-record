import type { PlaysDocument } from '../workspace.js'

type PlayRow = PlaysDocument['plays'][number]

/** Why a play sits behind the plays page's "failed, test and smoke" filter. */
export type HiddenReason = 'no-program' | 'smoke' | 'failed'

/** Latest-run states where the run itself broke (its driver or its record), not where research came back empty. */
const FAILED_STATES = new Set(['failed', 'driver-failed'])

/** A play whose id carries one of these words checks the stack rather than doing research. */
const SMOKE_WORD = /(?:^|[-_.])(?:smoke|canary|probe)(?:$|[-_.])/u

/**
 * Why the plays page hides this play until the filter is switched on, or null when it is shown by default. A play
 * whose runs name no program (`noProgram`, the catalog's no-program group) is a test or smoke run; a play named
 * smoke, canary or probe is one too; a play whose latest run failed is a failure, whatever it was for.
 */
export function hiddenReason(play: PlayRow): HiddenReason | null {
  if (play.noProgram === true) return 'no-program'
  if (SMOKE_WORD.test(play.id)) return 'smoke'
  if (play.state && FAILED_STATES.has(play.state)) return 'failed'
  return null
}

/** The plays a page shows, and how many the filter holds back from them. */
export function splitHidden<T extends PlayRow>(plays: readonly T[], showHidden: boolean): { shown: T[]; hidden: number } {
  if (showHidden) return { shown: [...plays], hidden: plays.filter((play) => hiddenReason(play) !== null).length }
  const shown = plays.filter((play) => hiddenReason(play) === null)
  return { shown, hidden: plays.length - shown.length }
}
