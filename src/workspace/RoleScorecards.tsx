import type { ProfileGraphDocument, ProfileNode, RoleCard, RoleEdit, RunRoleCard } from '../workspace.js'
import { when } from './data.js'
import { classCounts, costText, expectationsText, minutes, replayText, severityText, weakText } from './role-scorecards.js'

const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

/** A run's roles, worst first: what each was held to and charged with, and the role versions delivered to the run. */
export function RunRoles({ roles }: { roles: RunRoleCard }) {
  if (!roles.available) return <p className="faint">No role scorecard: {roles.reason ?? 'unavailable'}.</p>
  const list = roles.roles ?? []
  return (
    <section className="role-scorecards" aria-label="Role scorecards">
      <h4>Roles</h4>
      <p className="faint">
        Each director role of this run, worst first, charged with the referee blockers it owned, the regressions between release tags its pages
        caused{roles.best ? ` (best tag ${roles.best.tag})` : ''}, rework, and list dollars per accepted page{roles.builtAt ? `; read ${when(roles.builtAt)}` : ''}.
      </p>
      <div className="table-scroll">
        <table className="data-table role-table">
          <thead>
            <tr>
              <th>Role</th>
              <th className="num">Burden</th>
              <th title="blocker / major / minor">Blockers</th>
              <th>Classes</th>
              <th className="num">Regressions</th>
              <th className="num">Rework</th>
              <th>Expectations</th>
              <th>Milestones</th>
              <th>Cost per accepted page</th>
            </tr>
          </thead>
          <tbody>
            {list.map((role) => (
              <RoleRow key={role.role} role={role} />
            ))}
          </tbody>
        </table>
      </div>
      {list.some((role) => role.blockers.items.length > 0) && (
        <details className="role-blockers">
          <summary>Blockers by role and class</summary>
          {list.filter((role) => role.blockers.items.length > 0).map((role) => <RoleBlockers key={role.role} role={role} />)}
        </details>
      )}
      {(roles.regressions ?? []).length > 0 && (
        <>
          <h5>Regressions between release tags</h5>
          <ul className="profile-evidence">
            {(roles.regressions ?? []).map((item) => (
              <li key={`${item.from}..${item.tag}`}>
                <span className="mono">{item.from} → {item.tag}</span> {item.checks.join(', ')}{' '}
                {item.infrastructure ? <span className="chip">infrastructure: charged to no role</span> : Object.entries(item.shares).map(([role, share]) => `${role} ${Math.round(share * 100)}%`).join(' · ')}
              </li>
            ))}
          </ul>
        </>
      )}
      <h5>Role versions delivered</h5>
      {(roles.edits ?? []).length === 0 ? (
        <p className="faint">None delivered to this run.</p>
      ) : (
        <ul className="profile-evidence">
          {(roles.edits ?? []).map((edit) => (
            <li key={edit.operationId} data-role-edit={edit.operationId}>
              <b>{edit.role}</b> <code>{edit.digest}</code> {edit.markers.map((marker) => <span key={marker} className="chip mono">{marker}</span>)} delivered {when(edit.deliveredAt)} ({edit.effect});{' '}
              {edit.adopted ? <>adopted by <span className="mono">{edit.adopted.label ?? edit.adopted.nodeId}</span> {when(edit.adopted.at)}</> : 'not adopted yet'}
              {edit.measured && <> · <span className="chip">weak evidence</span> {weakText(edit.measured)}</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RoleRow({ role }: { role: RoleCard }) {
  return (
    <tr data-role={role.role}>
      <td className="mono">{role.role}</td>
      <td className="num">{role.burden.total}</td>
      <td className="mono">{severityText(role.blockers.bySeverity)}</td>
      <td>
        <div className="chips">
          {classCounts(role.blockers.byClass).map(([kind, count]) => (
            <span key={kind} className={`chip ${kind === 'other' ? 'faint' : ''}`}>{kind} {count}</span>
          ))}
        </div>
      </td>
      <td className="num">{role.regressions.length}</td>
      <td className="num">{role.rework.cycles}</td>
      <td>{expectationsText(role.expectations)}</td>
      <td>{role.milestones.done}/{role.milestones.count} · median {minutes(role.milestones.medianMs)}</td>
      <td>{costText(role.cost)}</td>
    </tr>
  )
}

function RoleBlockers({ role }: { role: RoleCard }) {
  return (
    <div className="role-blocker-list">
      <h5>{role.role}</h5>
      <ul className="profile-evidence">
        {role.blockers.items.map((item) => (
          <li key={item.id}>
            <span className="mono">{item.id}</span> <span className="chip">{item.severity}</span> <span className="chip">{item.class}</span>{' '}
            {item.basis === 'referee' ? 'named by the referee' : item.basis === 'repository' ? 'its page\'s last writer' : 'unowned'} · {item.summary}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** On a profile version: each run a role ran it in, with that role's scorecard there. */
export function ProfileScorecards({ doc, node }: { doc: ProfileGraphDocument; node: ProfileNode }) {
  const cards = node.scorecards ?? []
  if (cards.length === 0) return null
  return (
    <>
      <h4>Role scorecards</h4>
      <div className="table-scroll">
        <table className="data-table role-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Role</th>
              <th className="num">Burden</th>
              <th title="blocker / major / minor">Blockers</th>
              <th>Classes</th>
              <th className="num">Regressions</th>
              <th className="num">Rework</th>
              <th>Expectations</th>
              <th>Cost per accepted page</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={`${card.runId}:${card.role}`} data-scorecard={`${card.runId}:${card.role}`}>
                <td className="mono"><a href={runHref(card.runId)}>{card.runId}</a></td>
                <td className="mono">{card.role}</td>
                <td className="num">{card.burden.total}</td>
                <td className="mono">{severityText(card.blockers.bySeverity)}</td>
                <td>
                  <div className="chips">
                    {classCounts(card.blockers.byClass).map(([kind, count]) => <span key={kind} className={`chip ${kind === 'other' ? 'faint' : ''}`}>{kind} {count}</span>)}
                  </div>
                </td>
                <td className="num">{card.regressions}</td>
                <td className="num">{card.rework}</td>
                <td>{expectationsText(card.expectations)}</td>
                <td>{costText(card.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cards.map((card) => {
        const full = doc.scorecards?.[card.runId]?.roles?.find((role) => role.role === card.role)
        return full && full.blockers.items.length > 0 ? (
          <details key={`${card.runId}:${card.role}:items`} className="role-blockers">
            <summary>{card.role} blockers in {card.runId}</summary>
            <RoleBlockers role={full} />
          </details>
        ) : null
      })}
    </>
  )
}

/** On a role version: each rule, the check it adds, the referee blockers it cites, the budget, and the replay's decision. */
export function EditEvidence({ edit }: { edit: RoleEdit }) {
  return (
    <section className="role-edit" aria-label="Edit evidence" data-role-edit-version={edit.role}>
      <h4>Edit evidence</h4>
      <div className="ws-facts">
        <span><b>Role</b> <span className="mono">{edit.role}</span></span>
        {edit.target && <span><b>For</b> <a className="mono" href={runHref(edit.target)}>{edit.target}</a></span>}
        {edit.budget && <span><b>Instructions</b> {edit.budget.after} of {edit.budget.limit} characters</span>}
        <span><b>Replay</b> {replayText(edit.replay)}</span>
      </div>
      <ol className="role-rules">
        {edit.rules.map((rule) => (
          <li key={rule.id} data-rule={rule.id}>
            <span className="chip mono">{rule.id}</span> {rule.label}
            <p className="role-rule-text">{rule.text}</p>
            <ul className="profile-evidence">
              {rule.evidence.map((item, i) => (
                <li key={i}>
                  <span className="mono">{item.blocker ?? 'score'}</span> {item.severity && <span className="chip">{item.severity}</span>} <code>{item.source}</code> {item.note}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
