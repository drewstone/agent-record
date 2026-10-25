/**
 * A recorded source's text by its hash, from the run's source route. One reader for the run page and the drill-down
 * conversation's Details, so a changed source (409) or a missing one reads the same everywhere and never as empty.
 */
export function readSource(runUrl: string) {
  return async (sha: string) => {
    const response = await fetch(`${runUrl}/source/${sha}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(response.status === 409 ? 'The source no longer matches its recorded hash.' : `Source unavailable (HTTP ${response.status})`)
    return response.text()
  }
}
