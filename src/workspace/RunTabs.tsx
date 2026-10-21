import type { RunDocument } from '../workspace-model.js'
import { RUN_TABS, type RunSection, tabOf } from './run-tabs.js'
import { runStatus, StatusPill } from './data.js'
import { shortRun } from './play-standing.js'

/** The counts the tabs show: findings, agents and output files. */
export type RunCounts = Partial<Record<RunSection, number>>

/**
 * The run's tab bar, below its first screen: five tabs, then the views of the open tab when it has more than one. Under
 * 520 px the tabs are a select, so all five stay reachable on a phone.
 */
export function RunTabs({ section, counts, onOpen }: { section: RunSection | null; counts: RunCounts; onOpen: (section: RunSection | null) => void }) {
  const current = tabOf(section)
  const count = (tab: (typeof RUN_TABS)[number]) => tab.sections.reduce((sum, [value]) => sum + (counts[value] ?? 0), 0)
  const open = (id: string) => onOpen(RUN_TABS.find((tab) => tab.id === id)?.sections[0]?.[0] ?? null)
  return (
    <nav className="run-tabs detail-bar" aria-label="Run views" data-detail-bar={current.id}>
      <div className="run-tab-strip" role="tablist" aria-label="Run views">
        {RUN_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={tab.id === current.id} className={`run-tab ${tab.id === current.id ? 'on' : ''}`} data-section-tab={tab.id} onClick={() => open(tab.id)}>
            {tab.label}
            {count(tab) ? <span className="run-tab-count">{count(tab)}</span> : null}
          </button>
        ))}
      </div>
      <select className="run-tab-select" aria-label="Run view" value={current.id} onChange={(event) => open(event.target.value)}>
        {RUN_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
      </select>
      {current.sections.length > 1 && (
        <span className="detail-views" aria-label={`${current.label} views`}>
          {current.sections.map(([value, label]) => (
            <button key={value} type="button" className={`run-tab run-subtab ${section === value ? 'on' : ''}`} aria-current={section === value ? 'page' : undefined} data-section-tab={value} onClick={() => onOpen(value)}>
              {label}
              {counts[value] ? <span className="run-tab-count">{counts[value]}</span> : null}
            </button>
          ))}
        </span>
      )}
    </nav>
  )
}

/** On a tab page the run's status is one 32 px sticky line: its name and its status. */
export function RunStatusLine({ doc }: { doc: RunDocument }) {
  const run = doc.run
  return (
    <p className="run-status-line" role="status" data-run-status>
      <a href={`/run/${encodeURIComponent(run.id)}`} className="mono">Run {shortRun(run.play, run.id)}</a> <StatusPill status={runStatus(run)} />
      <span className="faint"> · <a href={`/play/${encodeURIComponent(run.play)}`}>{run.play}</a></span>
    </p>
  )
}

