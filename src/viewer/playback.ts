/** time: the whole run in 30 s at speed 1; rate: `speed` recorded milliseconds per real millisecond; events: one event per step. */
export type PlaybackMode = 'time' | 'rate' | 'events'

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
  if (mode === 'rate') return Math.min(end, cutoff + Math.max(0, elapsedMs) * speed)
  return Math.min(
    end,
    cutoff + (Math.max(0, elapsedMs) * speed * (end - start)) / 30000,
  )
}
