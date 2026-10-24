import { z } from 'zod'
import { sameOriginHref } from './final-output.js'

const fileIdentity = {
  path: z.string(), href: z.string(), bytes: z.number().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), kind: z.string(),
  source: z.enum(['knowledge', 'output', 'attachment', 'submitted result', 'receipt']),
  objectId: z.string().optional(),
}
const runFileIdentitySchema = z.object(fileIdentity).catchall(z.unknown())
export const runFileSchema = runFileIdentitySchema.extend({ alternates: z.array(runFileIdentitySchema).optional() })
/** Validation of the maintained host inventory, not a second file enumerator. */
export const runFilesDocumentSchema = z.object({
  schema: z.literal('agent-workspace.run-files.v1'), runId: z.string(),
  generatedAt: z.string(), version: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  scope: z.literal('retained_artifacts'), scopeDetails: z.string(), complete: z.boolean(),
  state: z.enum(['available', 'partial', 'unavailable']), reason: z.string().nullable(),
  items: z.array(runFileSchema),
  history: z.object({
    state: z.enum(['available', 'unavailable']), reason: z.string().nullable(),
    complete: z.boolean().optional(), omittedVersions: z.number().nonnegative().nullable().optional(),
    versions: z.array(z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), label: z.string(), at: z.string().nullable(), subject: z.string() }).catchall(z.unknown())),
  }).catchall(z.unknown()),
  source: z.object({ runDocumentStale: z.union([z.boolean(), z.object({ asOf: z.string().nullable(), refreshing: z.literal(true) }).catchall(z.unknown())]).optional(), meaning: z.string() }).catchall(z.unknown()),
  provenanceHref: z.string(),
}).catchall(z.unknown())
export type RunFile = z.infer<typeof runFileSchema>
export type RunFilesDocument = z.infer<typeof runFilesDocumentSchema>
export type RunFileVersion = z.infer<typeof runFileIdentitySchema>

export function readRunFiles(value: unknown, runId: string, version: string | null, api: string): RunFilesDocument {
  const document = runFilesDocumentSchema.parse(value)
  if (document.runId !== runId || document.version !== version) throw new Error('The file inventory does not match the requested run and version.')
  const paths = new Set<string>()
  for (const item of document.items) {
    if (paths.has(item.path)) throw new Error('The file inventory contains duplicate paths.')
    paths.add(item.path)
    for (const identity of [item, ...(item.alternates ?? [])]) {
      if (identity.path !== item.path || !identity.path || identity.path.startsWith('/') || /[\\\u0000-\u001f]/.test(identity.path) || identity.path.split('/').some((part) => part === '..' || part === '.' || !part))
        throw new Error('The file inventory contains an invalid retained path.')
      const prefix = `${api}/runs/${encodeURIComponent(runId)}/`
      const base = 'https://agent-workspace.invalid'
      const target = new URL(identity.href, base)
      const owner = new URL(prefix, base)
      if (target.origin !== owner.origin || !['final/', 'page/', 'artifact/', 'receipt/'].some((route) => identity.href.startsWith(prefix + route) && target.pathname.startsWith(owner.pathname + route)))
        throw new Error('The file inventory contains a content route outside this run.')
    }
  }
  if (document.provenanceHref !== `/run/${encodeURIComponent(runId)}?section=profiles`)
    throw new Error('The file inventory provenance does not match this run.')
  return document
}

export function runFileHref(file: Pick<RunFile, 'href'>): string | null {
  return typeof window === 'undefined' ? null : sameOriginHref(file.href, window.location.href)
}

/** Only the complete historical page scope can establish a retained page's absence. */
export function retainedPageAbsent(document: RunFilesDocument | null, file: RunFileVersion): boolean {
  return Boolean(document?.version && document.state === 'available' && document.complete && file.source === 'knowledge'
    && file.path.startsWith('pages/') && !document.items.some((item) => item.path === file.path))
}
