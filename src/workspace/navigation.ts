import { useCallback, useEffect, useMemo, useState } from 'react'
import { writeSearch } from './data.js'
import type { ArtifactNavigation } from './RunArtifacts.js'

/** The page's query string as state: every page and the run's file selection read and write the URL through this one owner. */
export function useSearch() {
  const [search, setSearch] = useState(() => (typeof window === 'undefined' ? '' : window.location.search))
  useEffect(() => {
    const changed = () => setSearch(window.location.search)
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  const update = useCallback((patch: Record<string, string | undefined | null>, replace = false) => {
    writeSearch(patch, replace)
    setSearch(window.location.search)
  }, [])
  return [useMemo(() => new URLSearchParams(search), [search]), update] as const
}

/** One URL contract for retained artifact identity, version and comparison, so a file link survives reload and theme. */
export function artifactNavigation(params: URLSearchParams, update: (patch: Record<string, string | null | undefined>) => void): ArtifactNavigation {
  const view = params.get('fileView')
  return {
    version: params.get('fileVersion'), compare: params.get('compareVersion'), identity: params.get('fileIdentity'),
    view: view === 'source' || view === 'diff' ? view : 'preview',
    onVersion: (value) => update({ fileVersion: value, file: null, fileIdentity: null }),
    onCompare: (value) => update({ compareVersion: value }),
    onIdentity: (value) => update({ fileIdentity: value }),
    onView: (value) => update({ fileView: value }),
  }
}
