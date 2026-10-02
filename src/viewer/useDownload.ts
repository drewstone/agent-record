import { useEffect, useRef } from 'react'

export function useDownload() {
  const pending = useRef(new Map<string, number>())
  useEffect(() => {
    const urls = pending.current
    return () => {
      for (const [url, timer] of urls) {
        window.clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      urls.clear()
    }
  }, [])
  return (content: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    link.click()
    pending.current.set(
      url,
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
        pending.current.delete(url)
      }, 1000),
    )
  }
}
