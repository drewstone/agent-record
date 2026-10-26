import type { ReactNode } from 'react'
import { RUN_TABS, type RunSection, type RunTab } from './RunTabs.js'

export type DetailsTab = Exclude<RunTab, 'now'>
const DETAILS = RUN_TABS.filter((tab): tab is (typeof RUN_TABS)[number] & { id: DetailsTab } => tab.id !== 'now')

/** The Details tab a URL asks for (`?details=`); Built when it names none (Findings by default doubled the run page: 0.90.12). */
export const detailsOf = (params: URLSearchParams): DetailsTab => DETAILS.find((tab) => tab.id === params.get('details'))?.id ?? 'built'

/**
 * Everything under the run's code frame is one Details region (Drew, 2026-10-25: no tab bar floating over an empty panel):
 * the selected tab and its panel directly beneath it. Each tab's full page stays one link away (`section=`).
 */
export function RunDetails({ tab, counts, onTab, children }: { tab: DetailsTab; counts: Partial<Record<RunSection, number>>; onTab: (tab: DetailsTab) => void; children: ReactNode }) {
  const count = (id: DetailsTab) => DETAILS.find((item) => item.id === id)!.parts.reduce((sum, [part]) => sum + (counts[part] ?? 0), 0)
  return (
    <section className="run-details" aria-label="Details" data-run-details={tab}>
      <div className="run-tab-strip" role="tablist" aria-label="Details">
        {DETAILS.map((item) => (
          <button key={item.id} type="button" role="tab" id={`details-${item.id}`} aria-controls="details-panel" className={`run-tab ${tab === item.id ? 'on' : ''}`} aria-selected={tab === item.id} onClick={() => onTab(item.id)}>
            {item.label}
            {count(item.id) ? <span className="run-tab-count">{count(item.id)}</span> : null}
          </button>
        ))}
      </div>
      <div className="run-details-panel" role="tabpanel" id="details-panel" aria-labelledby={`details-${tab}`}>{children}</div>
    </section>
  )
}
