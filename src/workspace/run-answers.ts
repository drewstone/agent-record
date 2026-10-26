import type { RunDocument } from '../workspace-model.js'
import { ms, type Play } from './answers.js'
import { shortRun, shortTag } from './play-standing.js'
import type { ContractDelivery, RunReceipt } from './run-receipt.js'

/**
 * A run page's first screen, read from served fields: its one status chip, its one clock, and the four slots (state, best,
 * blocker, output). The play document, when the page has it, supplies the play's best, the run's lineage and the run
 * that continued it; without it each slot falls back to the run document alone.
 */

export const isLive = (doc: RunDocument) => doc.execution?.alive ?? (doc.progress ? !(doc.progress.final || doc.progress.phase === 'settled') : doc.run.state === 'running')

/** The agent whose stream moved last: a live run's conversations open at its newest event. */
export function newestAgent(doc: RunDocument): string | null {
  let best: { node: string; at: number } | null = null
  for (const agent of doc.progress?.agents ?? []) {
    const at = ms(agent.lastActiveAt)
    if (Number.isFinite(at) && (!best || at > best.at)) best = { node: agent.node, at }
  }
  return best?.node ?? null
}

/** The start point's commit: the gate the run inherited from its fork, which is not the run's own result. */
export function inheritedGate(doc: RunDocument, play: Play | null | undefined): string | null {
  const gate = doc.run.check?.gate ?? null
  if (!gate) return null
  const fork = (doc.receipt as { codeRepository?: { forkCommit?: string | null } | null } | null | undefined)?.codeRepository?.forkCommit ?? null
  const inherited = (gate as { inherited?: boolean }).inherited === true || Boolean(fork && gate.commit && (fork.startsWith(gate.commit) || gate.commit.startsWith(fork)))
  if (!inherited) return null
  const lineage = play?.ledger?.rows.find((row) => row.runId === doc.run.id)?.lineage ?? null
  const from = lineage?.parentRun && lineage.parentTag ? `${shortRun(doc.run.play, lineage.parentRun)} ${shortTag(lineage.parentTag)}` : (shortTag(gate.tag) ?? gate.commit?.slice(0, 8) ?? 'the fork')
  const score = gate.score
  const w = score?.workloads
  const timeout = /prover for ([\w-]+) .*did not finish in (\d+) s/.exec(gate.line ?? '')
  const verdict = gate.verdict === 'pass' ? 'passed' : gate.verdict === 'fail' ? 'failed' : 'unverified'
  return `Start point (${from}) rechecked: ${w?.total ? `${w.passed ?? 0}/${w.total}` : 'no score'}${score?.reached ? ` at stage ${score.reached}` : ''}, ${verdict}${timeout ? ` (${timeout[1]} over ${timeout[2]} s)` : ''}`
}

/**
 * When a release tag was cut, as the receipt records it: the first score on that tag (the Lab checks a tag as it is cut),
 * else when the line it resolved was resolved.
 */
function tagCutAt(receipt: RunReceipt, tag: string | null | undefined): number | null {
  if (!tag) return null
  const name = shortTag(tag)
  const times = (receipt.system?.play?.scores ?? []).filter((point) => shortTag(point.tag) === name).map((point) => ms(typeof point.firstAt === 'string' ? point.firstAt : point.at)).filter(Number.isFinite)
  return times.length ? Math.min(...times) : null
}

/** "Fixed in" only when the fixing tag was cut after the line was sent; otherwise the line was not fixed by a later release. */
export function fixedIn(receipt: RunReceipt, line: ContractDelivery): { tag: string; commit: string | null } | null {
  if (!line.fixCommit && !line.resolvedOn) return null
  const tag = shortTag(line.resolvedOn) ?? line.fixCommit!.slice(0, 8)
  const cut = tagCutAt(receipt, line.resolvedOn) ?? (line.resolvedAt ? ms(line.resolvedAt) : null)
  if (cut === null || !(cut > ms(line.at))) return null
  return { tag, commit: line.fixCommit?.slice(0, 8) ?? null }
}
