/**
 * The run page's sections and its five tabs (v2): Work (the overview), Files and versions (outputs, versions, readout), Conversations,
 * Findings, and How it ran (spend, assessments, capture, profiles, graph, input). Every older `?section=` value still
 * names a section, so its link lands on the tab that holds it, at that part.
 */
export type RunSection = 'findings' | 'progress' | 'agents' | 'graph' | 'versions' | 'profiles' | 'readout' | 'outputs' | 'spend' | 'assessments' | 'input' | 'coverage'
const SECTIONS: readonly RunSection[] = ['findings', 'progress', 'agents', 'spend', 'readout', 'outputs', 'graph', 'versions', 'profiles', 'assessments', 'input', 'coverage']

export type RunTab = 'now' | 'built' | 'agents' | 'findings' | 'how'
export const RUN_TABS: readonly { id: RunTab; label: string; parts: readonly (readonly [RunSection, string])[] }[] = [
  { id: 'now', label: 'Work', parts: [] },
  { id: 'built', label: 'Files and versions', parts: [['outputs', 'Files'], ['versions', 'Versions'], ['readout', 'Readout']] },
  { id: 'agents', label: 'Conversations', parts: [['agents', 'Conversations']] },
  { id: 'findings', label: 'Findings', parts: [['findings', 'Findings']] },
  { id: 'how', label: 'How it ran', parts: [['spend', 'Spend'], ['assessments', 'Assessments'], ['coverage', 'Capture'], ['profiles', 'Profiles'], ['graph', 'Graph'], ['input', 'Input']] },
]

/** The tab a section belongs to; the overview (null) is Now. */
export const tabOf = (section: RunSection | null): RunTab => RUN_TABS.find((tab) => tab.parts.some(([part]) => part === section))?.id ?? 'now'

/** Sections that draw from the selected agent's record part (every node, that agent's events). */
export const AGENT_PART_SECTIONS = new Set<RunSection>(['agents', 'spend', 'assessments', 'coverage'])

/** The section a URL asks for, or null for Now; links from before the tabs (`section`, `view`, `tab`, `node`) still land on
 * the part they named. `progress` lives in Now. */
export function sectionOf(params: URLSearchParams): RunSection | null {
  const asked = params.get('section')
  const known = SECTIONS.find((value) => value === asked)
  if (known) return known === 'progress' ? null : known
  const view = params.get('view')
  if (view === 'readout' || view === 'outputs') return view
  const tab = params.get('tab')
  if (tab === 'spend' || tab === 'assessments' || tab === 'input' || tab === 'coverage') return tab
  if (params.get('node') || params.get('event') || tab) return 'agents'
  return null
}

/**
 * The run's five tabs, then the parts of the open tab. Under 520 px the tab strip is a `<select>` (styles.css shows one
 * or the other). Labels describe the work available in each view.
 */
export function RunTabBar({ section, onOpen }: { section: RunSection | null; onOpen: (section: RunSection | null) => void }) {
  const current = tabOf(section)
  const parts = RUN_TABS.find((tab) => tab.id === current)!.parts
  const first = (id: RunTab) => RUN_TABS.find((tab) => tab.id === id)!.parts[0]?.[0] ?? null
  return (
    <nav className="run-tabs" aria-label="Run" data-run-tabs={current}>
      <div className="run-tab-strip" role="tablist" aria-label="Run">
        {RUN_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" className={`run-tab ${current === tab.id ? 'on' : ''}`} aria-selected={current === tab.id} data-section-tab={tab.id} onClick={() => onOpen(first(tab.id))}>
            {tab.label}
          </button>
        ))}
      </div>
      <label className="run-tab-select">
        <span className="sr-only">Run tab</span>
        <select value={current} onChange={(event) => onOpen(first(event.target.value as RunTab))}>
          {RUN_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
        </select>
      </label>
      {parts.length > 1 && (
        <div className="run-tab-parts" role="group" aria-label={`${RUN_TABS.find((tab) => tab.id === current)!.label} parts`}>
          {parts.map(([part, label]) => (
            <button key={part} type="button" className={`run-part ${section === part ? 'on' : ''}`} aria-pressed={section === part} data-section-part={part} onClick={() => onOpen(part)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}
