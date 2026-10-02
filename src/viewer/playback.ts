export type PlaybackMode = 'time' | 'events'

/** The clock is a display cursor. Playback never creates events or infers activity. */
export function advancePlayback({
  cutoff,
  start,
  end,
  elapsedMs,
  speed,
  mode,
  eventTimes,
}: {
  cutoff: number
  start: number
  end: number
  elapsedMs: number
  speed: number
  mode: PlaybackMode
  eventTimes: readonly number[]
}): number {
  if (end <= start) return end
  if (mode === 'events') return eventTimes.find((time) => time > cutoff) ?? end
  return Math.min(
    end,
    cutoff + (Math.max(0, elapsedMs) * speed * (end - start)) / 30000,
  )
}
