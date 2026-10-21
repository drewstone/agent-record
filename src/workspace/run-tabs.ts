import type { RunDocument } from '../workspace-model.js'

/** The run page's detail views, by the `section` URL key; without one the page shows the run's Now view. */
export type RunSection = 'findings' | 'agents' | 'graph' | 'versions' | 'profiles' | 'readout' | 'outputs' | 'spend' | 'assessments' | 'input' | 'coverage'
type TabId = 'now' | 'built' | 'conversations' | 'findings' | 'how'

/**
 * Five tabs (design-system section 6): Now, Built, Conversations, Findings and How it ran. Each detail view is a section
 * of one tab, so every old `?section=` link still opens its view, now under its tab.
 */
export const RUN_TABS: readonly { id: TabId; label: string; sections: readonly (readonly [RunSection, string])[] }[] = [
  { id: 'now', label: 'Now', sections: [] },
  { id: 'built', label: 'Built', sections: [['versions', 'Versions'], ['outputs', 'Outputs'], ['readout', 'Readout']] },
  { id: 'conversations', label: 'Conversations', sections: [['agents', 'Conversations']] },
  { id: 'findings', label: 'Findings', sections: [['findings', 'Findings']] },
  { id: 'how', label: 'How it ran', sections: [['spend', 'Spend'], ['assessments', 'Assessments'], ['coverage', 'Capture'], ['profiles', 'Profiles'], ['graph', 'Graph'], ['input', 'Input']] },
]
const SECTIONS = new Set<string>(RUN_TABS.flatMap((tab) => tab.sections.map(([value]) => value)))
export const tabOf = (section: RunSection | null) => RUN_TABS.find((tab) => tab.sections.some(([value]) => value === section)) ?? RUN_TABS[0]!

/**
 * The detail view a URL asks for, or null for the Now view. A tab's own name opens its first view (`section=built`,
 * `section=how`); links from before the tabs (`section`, `view`, `tab`, `node`) still land on the view they named, and
 * `progress` now lives in the Now view.
 */
export function sectionOf(params: URLSearchParams): RunSection | null {
  const asked = params.get('section')
  if (asked && SECTIONS.has(asked)) return asked as RunSection
  const named = RUN_TABS.find((tab) => tab.id === asked)
  if (named) return named.sections[0]?.[0] ?? null
  if (asked === 'progress' || asked === 'now') return null
  const view = params.get('view')
  if (view === 'readout' || view === 'outputs') return view
  const tab = params.get('tab')
  if (tab === 'spend' || tab === 'assessments' || tab === 'input' || tab === 'coverage') return tab
  if (params.get('node') || params.get('event') || tab) return 'agents'
  return null
}

/** The agent of a live run that wrote most recently, so live Conversations opens where the run is moving. */
export function activeAgent(doc: RunDocument | undefined) {
  const agents = (doc?.progress?.agents ?? []).filter((agent) => agent.lastActiveAt && Number.isFinite(Date.parse(agent.lastActiveAt)))
  return agents.sort((a, b) => Date.parse(b.lastActiveAt!) - Date.parse(a.lastActiveAt!))[0]?.node ?? null
}
