import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { writeSearch } from './data.js'

export function useSearch() {
  const [search, setSearch] = useState(() => window.location.search)
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

export function WorkspaceTabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly (readonly [T, string])[]; value: T; onChange: (tab: T) => void; label: string }) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  return (
    <div className="ui-tabs ws-tabs" role="tablist" aria-label={label}>
      {tabs.map(([tab, title], i) => (
        <button
          key={tab}
          ref={(element) => {
            if (element) refs.current.set(tab, element)
          }}
          type="button"
          role="tab"
          data-tab={tab}
          aria-selected={value === tab}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : undefined
            if (next) {
              event.preventDefault()
              onChange(next[0])
              refs.current.get(next[0])?.focus()
            }
          }}
        >
          {title}
        </button>
      ))}
    </div>
  )
}

