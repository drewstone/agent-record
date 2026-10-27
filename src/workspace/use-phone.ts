import { useSyncExternalStore } from 'react'

const PHONE = '(max-width: 1023px)'
/** Whether the page is phone-width: the workspace stacks there, and an agent opens as a full-screen sheet. */
export function usePhone(media = PHONE) {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(media)
      query.addEventListener('change', change)
      return () => query.removeEventListener('change', change)
    },
    () => window.matchMedia(media).matches,
    () => false,
  )
}
