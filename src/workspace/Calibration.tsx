import type { Calibration } from '../run-check-model.js'

/**
 * The calibration a verdict names (tangle-tools play_checks.check_calibration): the check's state, then each stage's,
 * as small neutral labels. A calibration is a fact about the check, not a status, so none is toned. `unknown` names the
 * record that would state it. The run page draws it under its verdict; the play page under each run's verdicts.
 */
export function CalibrationLabels({ calibration, field }: { calibration: Calibration; field: string }) {
  const answer = calibration.unknown ?? `${calibration.source ?? 'no record served'} would state it`
  return <p className="rr-now-calibration" data-field={field}>
    <span className="rr-calibration tone-neutral" data-calibration={calibration.state}>check {calibration.state}</span>
    {calibration.stages.map((stage, i) => <span key={`${stage.name}-${i}`} className="rr-calibration tone-neutral" data-stage={stage.name ?? ''} data-calibration={stage.state}>
      {stage.name ?? 'unnamed stage'} {stage.state}</span>)}
    {calibration.state === 'unknown' || calibration.stages.some((stage) => stage.state === 'unknown') ? <span className="rr-muted" data-field={`${field}.unknown`}>{answer}</span> : null}
  </p>
}
