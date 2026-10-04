export interface ReportOptions { sourceSearchEndpoint?: string }

/** A renderer may commission one same-origin source reader, never an arbitrary host. */
export function parseReportOptions(value: unknown): ReportOptions {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid report options')
  const endpoint = (value as Record<string, unknown>).sourceSearchEndpoint
  if (endpoint === undefined) return {}
  if (typeof endpoint !== 'string' || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(endpoint) || endpoint.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Source search endpoint must be a same-origin absolute path')
  }
  return { sourceSearchEndpoint: endpoint }
}
