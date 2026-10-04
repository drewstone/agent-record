import type { RecordSelection } from './record.js'
import type { ResearchReportData } from './report.js'

export type ResearchView = 'results' | 'activity' | 'sources'

export interface ResearchDocumentSelection {
  playId: string
  path: string
  line?: number
}

/** URL selections only name documents already supplied within the exact play. */
export function readReportLocation(report: ResearchReportData, search: string): {
  playId?: string
  document?: ResearchDocumentSelection
  view?: ResearchView
  activity?: RecordSelection
  error?: string
} {
  const params = new URLSearchParams(search)
  if (['play', 'document', 'line', 'view', 'agent', 'event'].some(key => params.getAll(key).length > 1)) {
    return { error: 'This citation contains an ambiguous selection.' }
  }
  const viewText = params.get('view')
  if (viewText !== null && !['results', 'activity', 'sources'].includes(viewText)) return { error: 'Unknown research view.' }
  const view = viewText as ResearchView | null
  const viewOption = view ? { view } : {}
  const playId = params.get('play') ?? undefined
  const path = params.get('document') ?? undefined
  const lineText = params.get('line') ?? undefined
  const agentId = params.get('agent') ?? undefined
  const eventId = params.get('event') ?? undefined
  if (!playId && (path !== undefined || lineText !== undefined || agentId !== undefined || eventId !== undefined)) {
    return { error: 'A document citation must name its play.' }
  }
  if (!playId) return viewOption
  const play = report.plays.find(item => item.id === playId)
  if (!play) return { error: 'The cited play is not included in this report.' }
  if (agentId !== undefined || eventId !== undefined) {
    if (path !== undefined || lineText !== undefined || !play.record) return { error: 'Activity citation does not match this play.' }
    const node = agentId ? play.record.nodes.find(item => item.id === agentId) : undefined
    const event = eventId ? play.record.events.find(item => item.id === eventId) : undefined
    if ((agentId && !node) || (eventId && !event)) return { error: 'This activity is not retained in the selected play.' }
    if (event && node) {
      const observed = play.record.nodes.find(item => item.id === event.node)
      if (event.node !== node.id && observed?.agentId !== node.id) return { error: 'The event belongs to a different agent.' }
    }
    return { playId, view: 'activity', activity: { runId: play.record.runId, ...(agentId ? { nodeId: agentId } : {}), ...(eventId ? { eventId } : {}) } }
  }
  if (path === undefined) return lineText === undefined ? { playId, ...viewOption } : { error: 'A line citation must name its document.' }
  if (!play.documents.some(item => item.path === path)) {
    return { error: 'The cited document is not retained in this play.' }
  }
  const line = lineText === undefined ? undefined : Number(lineText)
  if (line !== undefined && (!/^[1-9]\d*$/.test(lineText!) || !Number.isSafeInteger(line))) {
    return { error: 'The cited source line must be a positive whole number.' }
  }
  return { playId, ...viewOption, document: { playId, path, ...(line === undefined ? {} : { line }) } }
}

export function reportLocationSearch(search: string, playId: string, document?: ResearchDocumentSelection, view?: ResearchView, activity?: RecordSelection): string {
  const params = new URLSearchParams(search)
  params.set('play', playId)
  params.delete('document')
  params.delete('line')
  params.delete('view')
  params.delete('agent')
  params.delete('event')
  if (activity) {
    if (activity.nodeId) params.set('agent', activity.nodeId)
    if (activity.eventId) params.set('event', activity.eventId)
  }
  if (view) params.set('view', view)
  if (document && document.playId === playId) {
    params.set('document', document.path)
    if (document.line !== undefined) params.set('line', String(document.line))
  }
  return '?' + params.toString()
}
