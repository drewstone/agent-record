import { createHash } from 'node:crypto'
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

/** File identity and parser content own invalidation; views never reparse unchanged logs. */
export async function sessionCache(home) {
  const sources = await Promise.all(['cache.mjs', 'classify.mjs', 'sessions.mjs', 'claude.mjs', 'intervals.mjs']
    .map(name => readFile(new URL(name, import.meta.url))))
  const parser = createHash('sha256').update(Buffer.concat(sources)).digest('hex')
  const root = join(home, '.cache', 'agent-record', 'activity')
  await mkdir(root, { recursive: true, mode: 0o700 })
  return async (path, kind, reader, options) => {
    let info
    try { info = await stat(path) } catch { options.coverage.unreadableFiles++; return null }
    const identity = `${parser}:${kind}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
    const key = createHash('sha256').update(path).digest('hex')
    const target = join(root, key + '.json')
    let doc
    try { doc = JSON.parse(await readFile(target, 'utf8')) } catch {}
    if (doc?.identity === identity && doc.observedAt <= options.now && doc.windowStart <= options.since) {
      options.coverage.cacheHits = (options.coverage.cacheHits ?? 0) + 1
      for (const [key, count] of Object.entries(doc.diagnostics ?? {})) options.coverage[key] = (options.coverage[key] ?? 0) + count
      return doc.session
    }
    const diagnostics = { malformedLines: 0, unreadableFiles: 0, unmatchedOutputs: 0, missingSessionIdentity: 0 }
    const session = await reader({ ...options, coverage: diagnostics })
    options.coverage.cacheMisses = (options.coverage.cacheMisses ?? 0) + 1
    for (const [key, count] of Object.entries(diagnostics)) options.coverage[key] = (options.coverage[key] ?? 0) + count
    // A file may grow while streaming. Never cache that moving snapshot under a later identity.
    const after = await stat(path)
    if (after.size === info.size && after.mtimeMs === info.mtimeMs) {
      const tmp = target + `.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ identity, observedAt:options.now, windowStart:options.since, diagnostics, session }), { mode: 0o600 })
      await rename(tmp, target)
    }
    return session
  }
}
