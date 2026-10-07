import type { RoleCard, RoleEdit, RoleScorecardSummary } from '../workspace.js'

type Cost = RoleScorecardSummary['cost'] | RoleCard['cost']
type Expectations = RoleScorecardSummary['expectations'] | RoleCard['expectations']

/** Blocker classes, heaviest first: `[class, count]`; `other` (no rule) last. */
export function classCounts(byClass: Record<string, number | { count: number; weight?: number }>): [string, number][] {
  const rows = Object.entries(byClass).map(([kind, value]) => [kind, typeof value === 'number' ? value : value.count, typeof value === 'number' ? value : (value.weight ?? value.count)] as const)
  return rows
    .sort((a, b) => (a[0] === 'other' ? 1 : 0) - (b[0] === 'other' ? 1 : 0) || b[2] - a[2] || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => [kind, count])
}

/** Blockers by severity as `blocker/major/minor`. */
export const severityText = (bySeverity: Record<string, number>) => `${bySeverity.blocker ?? 0}/${bySeverity.major ?? 0}/${bySeverity.minor ?? 0}`

/** Dollars per accepted page, with what is unmeasured said, never priced at zero. */
export function costText(cost: Cost): string {
  const unmeasured = typeof cost.unmeasuredNodes === 'number' ? cost.unmeasuredNodes : cost.unmeasuredNodes.length
  if (cost.perAcceptedPage === null) return cost.acceptedPages === 0 ? 'no accepted page' : `unknown over ${cost.acceptedPages} accepted (${unmeasured} unmeasured)`
  const usd = `$${cost.perAcceptedPage.usd.toFixed(2)}/page over ${cost.acceptedPages}`
  return cost.perAcceptedPage.complete ? usd : `≥ ${usd} (${unmeasured} unmeasured)`
}

/** Met/partial/missing of the items a role owns, or why they are not scored. */
export function expectationsText(expectations: Expectations): string {
  if (expectations.status !== 'scored') return `${expectations.owned} owned, ${expectations.status}`
  return `${expectations.met} met · ${expectations.partial} partial · ${expectations.missing} missing of ${expectations.owned}`
}

export const minutes = (ms: number | null) => (ms === null ? 'unknown' : `${Math.round(ms / 60_000)} min`)

/** The replay's decision in one line; a held claim with an interval spanning zero is a tie for Drew's grade. */
export function replayText(replay: RoleEdit['replay']): string {
  if (!replay) return 'not replayed: weak evidence until a replay on held-out checks measures it'
  const interval = replay.liftInterval ? ` [${replay.liftInterval.low.toFixed(3)}, ${replay.liftInterval.high.toFixed(3)}]` : ''
  const lift = typeof replay.lift === 'number' ? ` lift ${replay.lift >= 0 ? '+' : ''}${replay.lift.toFixed(3)}${interval}` : ''
  const fell = replay.checksFell && replay.checksFell.length > 0 ? ` · fell: ${replay.checksFell.join(', ')}` : ''
  const library = replay.library === 'eligible' ? ' · joins the template library' : ''
  return `${replay.decision}${lift}${fell}${library}${replay.tieBreak ? ' · tie: Drew grades' : ''}`
}

type Side = { critiques: number; blockers: number; perCritique: number | null }
/** An adopted edit's in-run measure: the role's blockers of the edit's classes per critique, before and after adoption. */
export function weakText(measured: { before: Side; after: Side }): string {
  const side = (value: Side) => (value.perCritique === null ? `no critique yet` : `${value.blockers} in ${value.critiques} critiques`)
  return `before ${side(measured.before)}, after ${side(measured.after)}`
}
