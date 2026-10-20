/**
 * The last seven days' run reliability as discovery-lab `tools/reliability.mjs` writes it (`discovery-lab.reliability.v1`,
 * relayed byte for byte at `reliability`), read for the plays page. Types only, so the node tests load this file directly.
 */

export interface ReliabilityCause {
  id: string
  layer: string | null
  owner: string | null
  title: string
  runsLost: number
  runsHit: number
  lostAgentHours: number | null
  lastSeen: string | null
  examples?: string[]
}

export interface ReliabilityDay {
  day: string
  runs: number
  clean: number
  hit: number
  failed: number
  rate: number | null
}

export interface ReliabilityDocument {
  schema: string
  at: string
  window: { since: string; until: string; days: number }
  definition: string
  runs: { total: number; settled: number; clean: number; hit: number; failed: number; cancelled: number; open: number; unread: number }
  rate: number | null
  completed: number | null
  lostAgentHours: number | null
  causes: ReliabilityCause[]
  daily: ReliabilityDay[]
}

/** A cause is live when the record saw it within this many hours of the document's own time. */
export const LIVE_HOURS = 48

/**
 * The causes still happening: seen within LIVE_HOURS of the document's time, most runs lost first (then most agent-hours
 * lost). A cause that stopped days ago can top the week's count; it is not live.
 */
export function liveCauses(doc: ReliabilityDocument, count = 3, hours = LIVE_HOURS): ReliabilityCause[] {
  const at = Date.parse(doc.at)
  if (!Number.isFinite(at)) return []
  return doc.causes
    .filter((cause) => {
      const seen = cause.lastSeen ? Date.parse(cause.lastSeen) : NaN
      return Number.isFinite(seen) && at - seen <= hours * 3_600_000 && cause.runsLost + cause.runsHit > 0
    })
    .sort((a, b) => b.runsLost - a.runsLost || (b.lostAgentHours ?? 0) - (a.lostAgentHours ?? 0))
    .slice(0, count)
}

/** `36%`; an unknown rate is said, never 0. */
export const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'unknown' : `${Math.round(value * 100)}%`
