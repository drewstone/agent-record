import { useSyncExternalStore } from 'react'

const PHONE = '(max-width: 1023px)'
/** Whether the page is phone-width: the workspace stacks there, and an agent opens as a full-screen sheet. */
export function usePhone() {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(PHONE)
      query.addEventListener('change', change)
      return () => query.removeEventListener('change', change)
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  )
}
