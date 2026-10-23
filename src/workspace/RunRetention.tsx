import type { RunReceipt } from './run-receipt.js'
import { utcClock } from './run-receipt.js'

/** Format the owner's facts; a confirmed sandbox removal says nothing about its snapshot repository. */
export function RunRetention({ retention }: { retention: NonNullable<RunReceipt['system']>['retention'] }) {
  if (!retention) return null
  return <section aria-labelledby="rr-retention">
    <h2 id="rr-retention">Resource cleanup</h2>
    <p><span data-field="system.retention.removed">{retention.removed}</span> sandbox removals confirmed; <span data-field="system.retention.pending">{retention.pending}</span> pending.</p>
    <dl className="rr-facts">
      <dt>Retention</dt><dd><span data-field="system.retention.disposition">{retention.disposition}</span>; <span data-field="system.retention.workspace">{retention.workspace}</span> workspace</dd>
      <dt>Native capture</dt><dd data-field="system.retention.nativeCapture">{retention.nativeCapture}</dd>
      <dt>Cloud evidence</dt><dd data-field="system.retention.cloudEvidence">{retention.cloudEvidence}</dd>
      <dt>Snapshot absence</dt><dd data-field="system.retention.snapshotAbsenceVerified">{retention.snapshotAbsenceVerified === true ? 'verified' : retention.snapshotAbsenceVerified === false ? 'not absent' : 'unverified'}</dd>
    </dl>
    <ul>{retention.resources.map((resource, i) => <li key={resource.id}>
      <code data-field={`system.retention.resources.${i}.id`}>{resource.id}</code>: <span data-field={`system.retention.resources.${i}.removal`}>{resource.removal}</span>
      {resource.removedAt && <> at <time data-field={`system.retention.resources.${i}.removedAt`} dateTime={resource.removedAt}>{utcClock(resource.removedAt)}</time></>}
    </li>)}</ul>
  </section>
}
