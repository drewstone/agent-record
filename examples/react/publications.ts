import sources from '../../docs/evidence/sources.json' with { type: 'json' }

export const publicationIds = ['ftqc-zips-2026-08-05-r1', 'fc-audit-smoke-a', 'q-conj-entropy-bcww-repair', 'q-q36-lw6-unbounded-ladder', 'q-ca-bcww-shareable-pkg']

/** Read the original owner's immutable bytes; the example and real-data checks share this input. */
export async function readPublication(id: string, signal?: AbortSignal): Promise<string> {
  const key = `examples/react/public/records/${id}.json` as keyof typeof sources.sha256
  const expected = sources.sha256[key]
  if (!publicationIds.includes(id) || !expected) throw new Error(`Unknown retained publication: ${id}`)
  const response = await fetch(`https://raw.githubusercontent.com/drewstone/drewstone.github.io/${sources.upstreamBlogRevision}/public/research/records/${id}.json`, { signal })
  if (!response.ok) throw new Error(`Could not read retained publication ${id}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  if (digest !== expected) throw new Error(`Retained publication ${id} does not match its source digest`)
  return new TextDecoder().decode(bytes)
}
