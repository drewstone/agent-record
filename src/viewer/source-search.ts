import type { ResearchDocument } from '../report.js'

export interface SourceSearchResult { documents: ResearchDocument[]; indexedAt: string | null; revision: string; excerpts: Map<string, string> }
/** Render only source IDs and bytes already supplied in the selected play. */
export function readSourceSearch(value: unknown, playId: string, documents: ResearchDocument[], revision?: string): SourceSearchResult {
  if (!value || typeof value !== 'object') throw new Error('Source response unavailable')
  const result = value as Record<string, unknown>
  if (result.scopeId !== playId || typeof result.revision !== 'string' || (revision !== undefined && result.revision !== revision) || !Array.isArray(result.hits)) throw new Error('Source response does not match this play')
  const excerpts = new Map<string, string>()
  const hits = result.hits.map((hit: unknown) => {
    if (!hit || typeof hit !== 'object') throw new Error('Invalid source response')
    const source = (hit as Record<string, unknown>).source
    if (!source || typeof source !== 'object') throw new Error('Invalid source response')
    const item = source as Record<string, unknown>
    const document = documents.find(doc => doc.id === item.id)
    if (!document || document.sha256 !== item.contentHash || document.content !== item.text) throw new Error('Source bytes do not match this retained play')
    excerpts.set(document.id, document.content)
    return document
  })
  return { documents: hits, indexedAt: typeof result.indexedAt === 'string' ? result.indexedAt : null, revision: result.revision, excerpts }
}
