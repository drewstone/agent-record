import type { RunCheck, RunProgress } from '../workspace-model.js'
import { statusOf } from './data.js'

/** The recorded check's result, including held and superseded checks; shared by the work view and receipt. */
export function runCheckView(check: RunCheck | null, outcome: NonNullable<RunProgress['outcome']> | null) {
  // With no verdict, what the checks did say: 19b's 17 checks found no pushed release tag, which is not "pending".
  const checks = check?.counts?.checks ?? null
  const untagged = outcome?.solved === null || outcome?.solved === undefined ? (checks && check?.latest && !check.latest.tag ? check.latest : null) : null
  // The verdict is read against the check version it ran under: a miss under a retired check says so, neutral.
  const digest = check?.latest?.checker ?? null
  const named = digest ? (check?.checkerNames?.find((item) => digest.startsWith(item.sha256) || item.sha256.startsWith(digest)) ?? null) : null
  // A pass held for stages no known-good fixture passed is its own verdict, never failing: the run's held pass, or the Lab's
  // newest check marked uncalibratedPass with the check's uncalibrated stages (tangle-tools runs.held_pass).
  const held = outcome && outcome.solved !== true && (check?.held || outcome.latestCheck?.uncalibratedPass === true)
    ? (check?.held?.stages ?? check?.calibration?.stages.filter((stage) => stage.state !== 'calibrated').map((stage) => stage.name ?? 'unnamed stage') ?? [])
    : null
  const result = held
    ? statusOf({ axis: 'result', verdict: 'held', held })
    : outcome && outcome.solved !== null && outcome.solved !== undefined
      ? statusOf({ axis: 'result', verdict: outcome.solved ? 'solved' : 'not-solved', current: named?.current ?? true, checker: named?.current === false ? 'an earlier check' : null })
      : null
  // The host's label leads (it composes the sentence); a held pass and a verdict under a retired check read as statusOf words them.
  const verdict = result && (held || named?.current === false) ? result.word : (outcome?.solvedLabel ?? result?.word ?? (untagged ? `${checks} ${checks === 1 ? 'check' : 'checks'}, none on a release` : 'No check verdict yet'))
  return { result, verdict, untagged, held, named }
}
