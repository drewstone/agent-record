import type { ResearchReportData } from './report.js'

export interface ResearchDocumentSelection {
  playId: string
  path: string
  line?: number
}

/** URL selections only name documents already supplied within the exact play. */
export function readReportLocation(report: ResearchReportData, search: string): {
  playId?: string
  document?: ResearchDocumentSelection
  error?: string
} {
  const params = new URLSearchParams(search)
  if (['play', 'document', 'line'].some(key => params.getAll(key).length > 1)) {
    return { error: 'This citation contains an ambiguous selection.' }
  }
  const playId = params.get('play') ?? undefined
  const path = params.get('document') ?? undefined
  const lineText = params.get('line') ?? undefined
  if (!playId && (path !== undefined || lineText !== undefined)) {
    return { error: 'A document citation must name its play.' }
  }
  if (!playId) return {}
  const play = report.plays.find(item => item.id === playId)
  if (!play) return { error: 'The cited play is not included in this report.' }
  if (path === undefined) return lineText === undefined ? { playId } : { error: 'A line citation must name its document.' }
  if (!play.documents.some(item => item.path === path)) {
    return { error: 'The cited document is not retained in this play.' }
  }
  const line = lineText === undefined ? undefined : Number(lineText)
  if (line !== undefined && (!/^[1-9]\d*$/.test(lineText!) || !Number.isSafeInteger(line))) {
    return { error: 'The cited source line must be a positive whole number.' }
  }
  return { playId, document: { playId, path, ...(line === undefined ? {} : { line }) } }
}

export function reportLocationSearch(search: string, playId: string, document?: ResearchDocumentSelection): string {
  const params = new URLSearchParams(search)
  params.set('play', playId)
  params.delete('document')
  params.delete('line')
  if (document && document.playId === playId) {
    params.set('document', document.path)
    if (document.line !== undefined) params.set('line', String(document.line))
  }
  return '?' + params.toString()
}
