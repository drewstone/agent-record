import { useEffect, useState } from 'react'

/** The existing inline file-preview budget, shared by every retained text reader. */
export const FILE_PREVIEW_BYTES = 4 << 20

async function retainedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > FILE_PREVIEW_BYTES) {
    await response.body?.cancel()
    throw new Error('This file exceeds the inline preview limit. Use Download for the complete file.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0, text = ''
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) return text + decoder.decode()
      bytes += part.value.byteLength
      if (bytes > FILE_PREVIEW_BYTES) {
        await reader.cancel()
        throw new Error('This file exceeds the inline preview limit. Use Download for the complete file.')
      }
      text += decoder.decode(part.value, { stream: true })
    }
  } finally { reader.releaseLock() }
}

/** One owner for abortable, same-origin retained file reads in the run's readers. */
export function useFileText(href: string | null, expectedCommit?: string): { href: string | null; text?: string; error?: string } {
  const [state, setState] = useState<{ href: string | null; text?: string; error?: string }>({ href: null })
  useEffect(() => {
    setState({ href })
    if (!href) return
    const controller = new AbortController()
    fetch(href, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'This retained file is unavailable.' : `File request failed, HTTP ${response.status}.`)
        if (response.headers.has('X-Workspace-Cut')) throw new Error('This source returned only part of the file. A complete preview or diff is unavailable.')
        if (expectedCommit && response.headers.get('X-Workspace-Commit') !== expectedCommit) throw new Error('The file source did not verify the selected code version. Refresh the version before reading it.')
        return retainedText(response)
      })
      .then((text) => { if (!controller.signal.aborted) setState({ href, text }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ href, error: error instanceof Error ? error.message : 'File request failed.' })
      })
    return () => controller.abort()
  }, [href, expectedCommit])
  return state.href === href ? state : { href }
}
