import { useMemo } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import type { RecordEvent } from '../record.js'
import { fmt, hoverLines, interval, ms, toolKey, utcTime } from './model.js'
import type { RecordIndex } from './model.js'

export interface PlotTooltip {
  title: string
  lines: string[]
  x: number
  y: number
}
export type ShowTooltip = (
  event: MouseEvent<SVGElement> | FocusEvent<SVGElement>,
  title: string,
  lines: string[],
) => void

export const activate = (
  event: KeyboardEvent<SVGElement>,
  action: () => void,
) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    action()
  }
}

interface PlotProps {
  index: RecordIndex
  cutoff: number
  selected?: string
  inspect: (event: RecordEvent, source?: boolean) => void
  showTooltip: ShowTooltip
  hideTooltip: () => void
  navigate: (direction: number) => void
}

export function Timeline({
  index,
  cutoff,
  selected,
  inspect,
  showTooltip,
  hideTooltip,
  navigate,
  events,
  zoom,
}: PlotProps & { events: RecordEvent[]; zoom: number }) {
  const width = 940 * zoom,
    left = 160,
    step = 23,
    height = Math.max(85, 48 + index.actors.length * step)
  const span = Math.max(index.end - index.start, 1)
  const x = (at: number) =>
    left + ((at - index.start) / span) * (width - left - 20)
  const lanes = useMemo(
    () => new Map(index.actors.map((node, i) => [node.id, i])),
    [index],
  )
  const buckets = useMemo(() => {
    const result = new Map<
      string,
      { lane: number; bin: number; events: RecordEvent[] }
    >()
    for (const event of events) {
      const lane = lanes.get(index.canonical(event.node))
      if (lane === undefined) continue
      const bin = Math.floor(
        (((ms(event.at) - index.start) / span) * (width - left - 20)) / 6,
      )
      const key = `${lane}:${bin}`
      const bucket = result.get(key) ?? { lane, bin, events: [] }
      bucket.events.push(event)
      result.set(key, bucket)
    }
    return [...result.values()]
  }, [events, lanes, index, span, width])
  const ticks = Math.ceil(width / 160)
  return (
    <div
      className="timeline-scroll"
      tabIndex={0}
      aria-label="Scrollable agent activity timeline"
    >
      <svg
        data-timeline
        viewBox={`0 0 ${width} ${height}`}
        style={{ width, height }}
        role="group"
        tabIndex={0}
        aria-label="Activity timeline. Left and right arrows select events."
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            navigate(event.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const xx = left + (i / ticks) * (width - left - 20)
          return (
            <g key={i}>
              <line
                x1={xx}
                x2={xx}
                y1={30}
                y2={height - 12}
                className="grid-line"
              />
              <text x={xx} y={18} textAnchor="middle" className="axis-label">
                {interval(((index.end - index.start) * i) / ticks)}
              </text>
            </g>
          )
        })}
        {index.actors.map((node, i) => (
          <g key={node.id}>
            <text x={4} y={44 + i * step} className="lane-label">
              <title>{node.label}</title>
              {node.label.length > 21
                ? `${node.label.slice(0, 19)}…`
                : node.label}
            </text>
            <line
              x1={left}
              x2={width - 20}
              y1={40 + i * step}
              y2={40 + i * step}
              className="grid-line"
            />
          </g>
        ))}
        {buckets.map(({ lane, bin, events: group }) => {
          const selectedIndex = group.findIndex(
            (event) => event.id === selected,
          )
          const event = group[selectedIndex < 0 ? 0 : selectedIndex]!
          const lines = hoverLines(event, index, cutoff)
          if (group.length > 1)
            lines.unshift(
              `${group.length} events in this interval. Select again to cycle; zoom separates nearby times.`,
            )
          const choose = () => {
            hideTooltip()
            inspect(
              group[
                selectedIndex < 0 ? 0 : (selectedIndex + 1) % group.length
              ]!,
            )
          }
          return (
            <rect
              key={`${lane}:${bin}`}
              x={left + bin * 6}
              y={34 + lane * step}
              width={4}
              height={12}
              rx={1}
              className={`event category-${categoryClass(event.category)} ${selectedIndex >= 0 ? 'selected' : ''}`}
              opacity={group.every((item) => ms(item.at) > cutoff) ? 0.25 : 1}
              data-id={event.id}
              data-cluster-count={group.length}
              role="button"
              tabIndex={selectedIndex >= 0 ? 0 : -1}
              aria-label={`${event.label}, ${index.actors[lane]?.label}, ${utcTime(event.at, true)}${group.length > 1 ? `, ${group.length} events, activate to cycle` : ''}`}
              onMouseEnter={(e) => showTooltip(e, event.label, lines)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip(e, event.label, lines)}
              onBlur={hideTooltip}
              onClick={choose}
              onKeyDown={(e) => activate(e, choose)}
            >
              <title>{`${event.label} · ${utcTime(event.at, true)}`}</title>
            </rect>
          )
        })}
        <line
          x1={x(cutoff)}
          x2={x(cutoff)}
          y1={26}
          y2={height - 8}
          className="cursor-line"
          pointerEvents="none"
        />
        {!events.length && (
          <text x={left + 10} y={height - 8} className="axis-label">
            No events match this filter.
          </text>
        )}
      </svg>
    </div>
  )
}

export const categories = [
  'coordination',
  'computation',
  'verification',
  'literature',
  'infrastructure',
  'other',
] as const
export const categoryClass = (category: string) =>
  categories.includes(category as (typeof categories)[number])
    ? category
    : 'other'
export type Metric = 'cumulative' | 'response' | 'tool-time'
export type Axis = 'time' | 'order'
const channels = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
type Channel = (typeof channels)[number]
const channelLabels: Record<Channel, string> = {
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
}
interface Point {
  event: RecordEvent
  at: number
  values: Partial<Record<Channel, number>>
  elapsed?: number
}

export function UsageChart({
  index,
  cutoff,
  inspect,
  showTooltip,
  hideTooltip,
  navigate,
  actor,
  metric,
  axis,
}: PlotProps & { actor: string; metric: Metric; axis: Axis }) {
  const measured = useMemo(() => {
    const points: Point[] = []
    const totals: Record<Channel, number> = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }
    const counts: Record<Channel, number> = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    }
    let incomplete = 0,
      ambiguous = 0,
      invalidTiming = 0
    const chronological = index.byActor.get(actor) ?? []
    // A source's recorded order can differ from wall-clock order.
    const order = index.recordedOrder
    const events =
      axis === 'order'
        ? [...chronological].sort(
            (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
          )
        : chronological
    for (const event of events) {
      if (ms(event.at) > cutoff) continue
      if (metric === 'tool-time') {
        if (event.detail.toolCallId === undefined) continue
        const calls =
          index.calls.get(toolKey(event.node, event.detail.toolCallId)) ?? []
        if (calls.length !== 1) {
          ambiguous++
          continue
        }
        const call = calls[0]!.event
        if (ms(call.at) > cutoff || ms(event.at) < ms(call.at)) {
          invalidTiming++
          continue
        }
        points.push({
          event,
          at: ms(event.at),
          values: {},
          elapsed: (ms(event.at) - ms(call.at)) / 1000,
        })
        continue
      }
      const usage = event.detail.usage
      if (!usage) continue
      if (channels.some((channel) => usage[channel] === undefined)) incomplete++
      const values: Partial<Record<Channel, number>> = {}
      for (const channel of channels) {
        const value = usage[channel]
        if (value === undefined) continue
        totals[channel] += value
        counts[channel]++
        values[channel] = metric === 'cumulative' ? totals[channel] : value
      }
      if (Object.keys(values).length)
        points.push({ event, at: ms(event.at), values })
    }
    return { points, totals, counts, incomplete, ambiguous, invalidTiming }
  }, [index, cutoff, actor, metric, axis])
  const { points, totals, counts } = measured
  const width = 580,
    left = 62,
    right = 22,
    top = 28,
    bottom = 218
  const max = Math.max(
    1,
    ...points.flatMap((point) =>
      metric === 'tool-time'
        ? [point.elapsed ?? 0]
        : Object.values(point.values),
    ),
  )
  const x = (point: Point, i: number) =>
    left +
    (axis === 'time'
      ? (point.at - index.start) / Math.max(1, cutoff - index.start)
      : i / Math.max(1, points.length - 1)) *
      (width - left - right)
  const y = (value: number) => bottom - (value / max) * (bottom - top)
  const path = (channel: Channel) => {
    let connected = false
    return points
      .map((point, i) => {
        const value = point.values[channel]
        if (value === undefined) {
          connected = false
          return ''
        }
        const segment = `${connected ? 'L' : 'M'}${x(point, i)},${y(value)}`
        connected = true
        return segment
      })
      .join(' ')
  }
  return (
    <>
      <svg
        data-tokens
        viewBox="0 0 580 265"
        role="group"
        tabIndex={0}
        aria-label="Recorded usage or tool return time. Points open source events."
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            navigate(event.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        {Array.from({ length: 5 }, (_, i) => {
          const value = (i * max) / 4,
            yy = y(value),
            xx = left + (i / 4) * (width - left - right)
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={yy}
                y2={yy}
                className="grid-line"
              />
              <text
                x={left - 7}
                y={yy + 4}
                textAnchor="end"
                className="axis-label"
              >
                {metric === 'tool-time'
                  ? `${value.toFixed(max > 10 ? 0 : 1)}s`
                  : fmt(value)}
              </text>
              <text x={xx} y={240} textAnchor="middle" className="axis-label">
                {axis === 'time'
                  ? interval(((cutoff - index.start) * i) / 4)
                  : points.length
                    ? String(Math.round(((points.length - 1) * i) / 4) + 1)
                    : '—'}
              </text>
            </g>
          )
        })}
        <text x={left} y={14} className="axis-label">
          {metric === 'tool-time'
            ? 'Observed call → result interval (seconds)'
            : metric === 'cumulative'
              ? 'Cumulative measured tokens'
              : 'Measured tokens per response'}
        </text>
        {metric !== 'tool-time' &&
          channels.map((channel) => (
            <path
              key={channel}
              d={path(channel)}
              className={`usage-line ${channel}-line`}
            />
          ))}
        {points.map((point, i) => {
          const value =
            metric === 'tool-time'
              ? point.elapsed!
              : Math.max(0, ...Object.values(point.values))
          const lines = hoverLines(point.event, index, cutoff)
          if (metric === 'tool-time')
            lines.push(
              `${point.elapsed!.toFixed(3)} seconds between the recorded call and this result. Includes queue and tool time.`,
            )
          else if (metric === 'cumulative')
            lines.push(
              channels
                .map(
                  (channel) =>
                    `${channelLabels[channel]} total ${point.values[channel] === undefined ? 'unmeasured here' : fmt(point.values[channel]!)}`,
                )
                .join(' · '),
            )
          const choose = () => {
            hideTooltip()
            inspect(point.event, true)
          }
          return (
            <circle
              key={point.event.id}
              cx={x(point, i)}
              cy={y(value)}
              r={4}
              className={
                metric === 'tool-time'
                  ? point.event.detail.isError
                    ? 'time-error'
                    : 'time-point'
                  : 'usage-point'
              }
              data-id={point.event.id}
              tabIndex={0}
              role="button"
              aria-label={`${point.event.label}, ${metric === 'tool-time' ? `${point.elapsed?.toFixed(3)} seconds` : 'measured token usage'}`}
              onMouseEnter={(e) => showTooltip(e, point.event.label, lines)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip(e, point.event.label, lines)}
              onBlur={hideTooltip}
              onClick={choose}
              onKeyDown={(e) => activate(e, choose)}
            />
          )
        })}
        {!points.length && (
          <text
            x={width / 2}
            y={120}
            textAnchor="middle"
            className="axis-label"
          >
            {metric === 'tool-time'
              ? 'No matched tool timing at this time'
              : 'No measured usage at this time'}
          </text>
        )}
      </svg>
      {metric !== 'tool-time' && (
        <div className="usage-legend">
          {channels.map((channel) => (
            <span key={channel} className={`${channel}-key`}>
              {channelLabels[channel]}
            </span>
          ))}
        </div>
      )}
      <p className="small" data-token-caption>
        {metric === 'tool-time'
          ? `${points.length} exact call/result intervals through the selected time. ${measured.ambiguous} unmatched or ambiguous results; ${measured.invalidTiming} invalid intervals omitted. This is observed tool return time, not model latency.`
          : `${points.length} responses with measured usage; ${measured.incomplete} have incomplete counters. ${channels.map((channel) => `${channelLabels[channel]} ${counts[channel] ? fmt(totals[channel]) : 'unknown'} (${counts[channel]} measured)`).join(' · ')}. Missing counters remain unknown. Repeated and cached context can count repeatedly; tokens are not billed cost.`}
      </p>
    </>
  )
}
