/** One row represents occupied session time, even when that session starts tools in parallel. */
export function partitionIntervals(events, since, now) {
  const marks = new Map(), points = []
  const put = (at, type, event) => {
    if (!marks.has(at)) marks.set(at, { start: [], end: [] })
    marks.get(at)[type].push(event)
  }
  for (const event of events) {
    const at = Math.max(since, Date.parse(event.at)), end = Math.min(now, Date.parse(event.end))
    if (event.incomplete && end === at && at >= since && at <= now) {
      points.push({ ...event, durationUnknown: true }); continue
    }
    if (!Number.isFinite(at) || !Number.isFinite(end) || end <= at) continue
    put(at, 'start', event); put(end, 'end', event)
  }
  const active = new Set(), result = [], times = [...marks.keys()].sort((a, b) => a - b)
  for (let i = 0; i < times.length - 1; i++) {
    const at = times[i], end = times[i + 1], mark = marks.get(at)
    for (const event of mark.end) active.delete(event)
    for (const event of mark.start) active.add(event)
    if (!active.size) continue
    const all = [...active], first = all[0]
    const activities = [...new Set(all.flatMap(e => e.activities ?? [e.activity]))]
    const primary = [...new Set(all.map(e => e.activity))]
    const phase = all.some(e => e.phase === 'tool') ? 'tool' : first.phase
    const segment = { ...first, id: all.map(e => e.id).join('+') + ':' + at,
      at: new Date(at).toISOString(), end: new Date(end).toISOString(), phase,
      activity: primary.length === 1 ? primary[0] : 'unknown',
      category: primary.length === 1 ? primary[0] : 'unknown', activities,
      ...(all.length > 1 ? { concurrentCalls: all.length, callIds: all.map(e => e.id), label: 'concurrent tools; ' + activities.join(', ') } : {}) }
    if (phase === 'model' && first.modelSplit) {
      const ratio = (end - at) / (Date.parse(first.end) - Date.parse(first.at))
      segment.modelSplit = Object.fromEntries(Object.entries(first.modelSplit).map(([key, value]) => [key, value * ratio]))
    }
    if (all.length > 1) {
      delete segment.usage
      if (all.some(e => e.editMethod)) {
        segment.editMethod = [...new Set(all.map(e => e.editMethod).filter(Boolean))].length === 1 ? all.find(e => e.editMethod)?.editMethod : 'multiple methods'
        segment.editTarget = [...new Set(all.map(e => e.editTarget).filter(Boolean))].length === 1 ? all.find(e => e.editTarget)?.editTarget : 'mixed'
      }
    }
    result.push(segment)
  }
  return [...result, ...points].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}
