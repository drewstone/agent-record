import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RecordEvent, RecordSelection, RunRecord } from './record.js'
import { advancePlayback } from './viewer/playback.js'
import type { PlaybackMode } from './viewer/playback.js'
import { useDownload } from './viewer/useDownload.js'
import { AgentTree } from './viewer/AgentTree.js'
import { Conversation } from './viewer/Conversation.js'
import {
  categories,
  categoryClass,
  Timeline,
  UsageChart,
} from './viewer/Charts.js'
import type { Axis, Metric, PlotTooltip, ShowTooltip } from './viewer/Charts.js'
import {
  actorDescription,
  eventMatches,
  eventSource,
  indexRecord,
  interval,
  ms,
  roleOf,
  utcTime,
} from './viewer/model.js'

export interface AgentRecordProps {
  records: readonly RunRecord[]
  selection?: RecordSelection
  defaultSelection?: RecordSelection
  onSelectionChange?: (selection: RecordSelection) => void
  theme?: 'light' | 'dark' | 'auto'
  className?: string
}

function Select({
  label,
  value,
  onChange,
  children,
  field,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  field: string
}) {
  return (
    <label className="ui-field ar-select">
      <span className="ui-label">{label}</span>
      <span className="select-shell">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...{ [`data-${field}`]: '' }}
        >
          {children}
        </select>
        <span className="ui-chevron" aria-hidden="true" />
      </span>
    </label>
  )
}

/** Renders already-normalized records. Importing, persistence, and publication policy belong to the caller. */
export function AgentRecord({
  records,
  selection,
  defaultSelection,
  onSelectionChange,
  theme = 'auto',
  className = '',
}: AgentRecordProps) {
  const [internal, setInternal] = useState<RecordSelection | undefined>(
    defaultSelection,
  )
  const chosen = selection ?? internal
  const record =
    records.find((item) => item.runId === chosen?.runId) ?? records[0]
  const change = useCallback(
    (next: RecordSelection) => {
      if (selection === undefined) setInternal(next)
      onSelectionChange?.(next)
    },
    [selection, onSelectionChange],
  )
  return (
    <div className={`agent-record ${className}`} data-theme={theme}>
      {record ? (
        <RecordView
          key={record.runId}
          records={records}
          record={record}
          selection={
            chosen?.runId === record.runId ? chosen : { runId: record.runId }
          }
          onChange={change}
        />
      ) : (
        <p className="chat-empty" role="status">
          No records supplied.
        </p>
      )}
    </div>
  )
}

function RecordView({
  records,
  record,
  selection,
  onChange,
}: {
  records: readonly RunRecord[]
  record: RunRecord
  selection: RecordSelection
  onChange: (selection: RecordSelection) => void
}) {
  const uid = useId()
  const index = useMemo(() => indexRecord(record), [record])
  const explicitEvent = selection.eventId
    ? index.byEvent.get(selection.eventId)
    : undefined
  const requestedActor = selection.nodeId
    ? index.canonical(selection.nodeId)
    : undefined
  const actor = explicitEvent
    ? index.canonical(explicitEvent.node)
    : requestedActor && index.nodes.has(requestedActor)
      ? requestedActor
      : (index.actors[0]?.id ?? '')
  const event = explicitEvent ?? index.byActor.get(actor)?.[0]
  const node = index.nodes.get(actor)
  const view = selection.view ?? 'chat'
  const selectedAt = selection.at ? ms(selection.at) : index.end
  const cutoff = Number.isFinite(selectedAt)
    ? Math.max(index.start, Math.min(index.end, selectedAt))
    : index.end
  const cursor =
    index.end > index.start
      ? ((cutoff - index.start) / (index.end - index.start)) * 1000
      : 1000
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [metric, setMetric] = useState<Metric>('cumulative')
  const [axis, setAxis] = useState<Axis>('time')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [mode, setMode] = useState<PlaybackMode>('time')
  const [systemReducedMotion, setSystemReducedMotion] = useState(false)
  const [motion, setMotion] = useState('system')
  const reducedMotion = systemReducedMotion || motion === 'reduced'
  const [treeOpen, setTreeOpen] = useState(true)
  const [tooltip, setTooltip] = useState<PlotTooltip | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const download = useDownload()
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const latest = useRef({ selection, cutoff, index, onChange })
  latest.current = { selection, cutoff, index, onChange }
  const query = search.trim().toLowerCase()
  const visible = useMemo(
    () =>
      index.events.filter((item) => eventMatches(item, index, query, category)),
    [index, query, category],
  )
  const categoryOptions = [
    ...new Set([...categories, ...record.events.map((item) => item.category)]),
  ].filter((item) => item !== 'all' && item !== 'findings')
  const update = (patch: Partial<RecordSelection>) =>
    onChange({
      ...selection,
      runId: record.runId,
      nodeId: actor,
      eventId: event?.id,
      ...patch,
    })
  const inspect = (item: RecordEvent, source = false) => {
    setTooltip(null)
    setPlaying(false)
    onChange({
      runId: record.runId,
      nodeId: index.canonical(item.node),
      eventId: item.id,
      at: item.at,
      view: source ? 'source' : 'chat',
    })
  }
  const selectActor = (id: string) => {
    setTooltip(null)
    const first =
      index.byActor
        .get(id)
        ?.find(
          (item) =>
            item.detail.role ||
            item.detail.publicText ||
            item.detail.publicToolCalls?.length,
        ) ?? index.byActor.get(id)?.[0]
    onChange({
      runId: record.runId,
      nodeId: id,
      eventId: first?.id,
      view: 'chat',
      at: first && ms(first.at) > cutoff ? first.at : selection.at,
    })
  }
  const navigate = (direction: number) => {
    if (!visible.length) return
    const position = visible.findIndex((item) => item.id === event?.id)
    inspect(
      visible[
        position < 0
          ? direction > 0
            ? 0
            : visible.length - 1
          : (position + direction + visible.length) % visible.length
      ]!,
    )
  }
  const showTooltip: ShowTooltip = (target, title, lines) => {
    const box = target.currentTarget.getBoundingClientRect()
    const x = Math.max(
      8,
      Math.min(box.left + box.width / 2, window.innerWidth - 361),
    )
    const y =
      box.top > window.innerHeight / 2
        ? Math.max(8, box.top - 12)
        : box.bottom + 10
    setTooltip({ title, lines, x, y })
  }
  const hideTooltip = () => setTooltip(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    let narrow: boolean | undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width === undefined || width === 0) return
      const next = width <= 760
      if (narrow !== next) {
        narrow = next
        setTreeOpen(!next)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      setSystemReducedMotion(preference.matches)
      setPlaying(false)
    }
    change()
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])
  const effectiveMode = reducedMotion ? 'events' : mode
  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(
      () => {
        const current = latest.current
        const now = performance.now()
        const next = advancePlayback({
          cutoff: current.cutoff,
          start: current.index.start,
          end: current.index.end,
          elapsedMs: now - previous,
          speed: Number(speed),
          mode: effectiveMode,
          eventTimes: current.index.events.map((event) => ms(event.at)),
        })
        previous = now
        current.onChange({
          ...current.selection,
          runId: record.runId,
          at:
            next >= current.index.end
              ? undefined
              : new Date(next).toISOString(),
        })
        if (next >= current.index.end) setPlaying(false)
      },
      effectiveMode === 'events' ? 1000 / Number(speed) : 120,
    )
    const visibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [playing, record.runId, speed, effectiveMode])
  useEffect(() => {
    setTooltip(null)
  }, [cutoff, category, query, actor, view, metric, axis, record])
  const agents = record.nodes.filter((item) => item.kind === 'agent').length
  const sessions = record.nodes.filter((item) => item.kind === 'session').length
  const joins = record.nodes.filter(
    (item) => item.kind === 'session' && item.agentId,
  ).length
  const position = visible.findIndex((item) => item.id === event?.id)
  return (
    <div
      ref={container}
      className="ar-view"
      data-reduced-motion={reducedMotion || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hideTooltip()
      }}
      onScrollCapture={hideTooltip}
    >
      <div className="run-context">
        <p data-objective>{record.assignment.objective || record.title}</p>
        <span className="archive-state">Recorded run</span>
      </div>
      <div className="controls">
        <Select
          label="Run"
          field="run"
          value={record.runId}
          onChange={(runId) => {
            setPlaying(false)
            onChange({ runId })
          }}
        >
          {records.map((item) => (
            <option key={item.runId} value={item.runId}>
              {item.title}
            </option>
          ))}
        </Select>
        <Select
          label="Timeline activity"
          field="category"
          value={category}
          onChange={setCategory}
        >
          <option value="all">All activity</option>
          <option value="findings">Recorded findings</option>
          {categoryOptions.map((item) => (
            <option key={item} value={item}>
              {item[0]?.toUpperCase()}
              {item.slice(1)}
            </option>
          ))}
        </Select>
        <label className="ui-field">
          <span className="ui-label">Search the record</span>
          <input
            data-search
            type="search"
            placeholder="Text, agent, event…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <p data-summary className="record-summary">
        {agents} recorded agents · {sessions} native sessions · {visible.length}{' '}
        / {record.events.length} events ·{' '}
        {record.coverage.completeOriginalCapture
          ? 'original capture marked complete'
          : 'capture incomplete'}
      </p>
      <div className="playback">
        <button
          className="ui-button"
          data-play
          type="button"
          aria-label={
            playing ? 'Pause recorded progression' : 'Play recorded progression'
          }
          disabled={index.end <= index.start}
          onClick={() => {
            if (!playing && cutoff >= index.end)
              update({ at: new Date(index.start).toISOString() })
            setPlaying((value) => !value)
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <label>
          Recorded time{' '}
          <input
            data-cursor
            type="range"
            min={0}
            max={1000}
            value={cursor}
            aria-valuetext={utcTime(new Date(cutoff).toISOString(), true)}
            disabled={!record.events.length}
            onChange={(event) => {
              setPlaying(false)
              update({
                at: new Date(
                  index.start +
                    ((index.end - index.start) * Number(event.target.value)) /
                      1000,
                ).toISOString(),
              })
            }}
          />
          <output data-clock>{interval(cutoff - index.start)}</output>
        </label>
        <button
          className="ui-button"
          data-full
          type="button"
          onClick={() => {
            setPlaying(false)
            update({ at: undefined })
          }}
        >
          Full run
        </button>
      </div>
      <div className="replay-settings">
        <Select
          label="Replay speed"
          field="speed"
          value={speed}
          onChange={setSpeed}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </Select>
        <Select
          label="Replay progression"
          field="progression"
          value={effectiveMode}
          onChange={(value) => {
            setPlaying(false)
            setMode(value as PlaybackMode)
          }}
        >
          {!reducedMotion && <option value="time">Recorded time</option>}
          <option value="events">Event steps</option>
        </Select>
        <Select
          label="Motion"
          field="motion"
          value={motion}
          onChange={(value) => {
            setPlaying(false)
            setMotion(value)
          }}
        >
          <option value="system">System</option>
          <option value="reduced">Reduced</option>
        </Select>
        <p className="small">
          {reducedMotion ? 'Reduced motion: timestamp steps. ' : ''}
          {effectiveMode === 'time'
            ? '1× compresses the full recorded span into 30 seconds.'
            : '1× advances to the next recorded timestamp each second; gaps are skipped.'}
        </p>
      </div>
      <div className="timeline-heading">
        <span>Activity over time</span>
        <label>
          Zoom{' '}
          <input
            data-zoom
            type="range"
            min={1}
            max={8}
            step={1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
      </div>
      <Timeline
        index={index}
        events={visible}
        cutoff={cutoff}
        selected={event?.id}
        zoom={zoom}
        inspect={inspect}
        navigate={navigate}
        showTooltip={showTooltip}
        hideTooltip={hideTooltip}
      />
      <div className="legend">
        {categoryOptions.map((item) => (
          <span key={item}>
            <i className={`category-${categoryClass(item)}`} />
            {item}
          </span>
        ))}
      </div>
      <div className="workspace">
        <details
          className="topology"
          open={treeOpen}
          onToggle={(event) => setTreeOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Agents</span>
            <span data-agent-count>
              {index.actors.filter((item) => item.kind !== 'finding').length}
            </span>
          </summary>
          <p className="small" data-graph-caption>
            {sessions === 0
              ? 'No session traces supplied.'
              : `${joins} of ${sessions} sessions attributed to agents by the supplied records.`}
          </p>
          <AgentTree
            index={index}
            actor={actor}
            cutoff={cutoff}
            select={selectActor}
          />
        </details>
        <section
          className="conversation-panel"
          aria-label="Agent record details"
        >
          <div className="conversation-head">
            <div className="agent-identity">
              <span
                className="agent-avatar"
                data-agent-avatar
                aria-hidden="true"
              >
                {roleOf(node).slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h3 data-agent-title>{node?.label ?? 'Conversation'}</h3>
                <p data-agent-role>{actorDescription(node, record)}</p>
              </div>
            </div>
            <Select
              label="Agent"
              field="agent"
              value={actor}
              onChange={selectActor}
            >
              {index.actors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label === roleOf(item)
                    ? item.label
                    : `${item.label} · ${roleOf(item)}`}
                </option>
              ))}
            </Select>
          </div>
          <div className="ui-tabs" role="tablist" aria-label="Agent evidence">
            {(['chat', 'source', 'usage'] as const).map((tab, i, all) => (
              <button
                key={tab}
                ref={(element) => {
                  if (element) tabs.current.set(tab, element)
                  else tabs.current.delete(tab)
                }}
                type="button"
                data-view={tab}
                role="tab"
                aria-selected={view === tab}
                tabIndex={view === tab ? 0 : -1}
                id={`${uid}-${tab}-tab`}
                aria-controls={`${uid}-${tab}`}
                onClick={() => update({ view: tab })}
                onKeyDown={(event) => {
                  const target =
                    event.key === 'ArrowRight'
                      ? all[(i + 1) % all.length]
                      : event.key === 'ArrowLeft'
                        ? all[(i - 1 + all.length) % all.length]
                        : event.key === 'Home'
                          ? all[0]
                          : event.key === 'End'
                            ? all.at(-1)
                            : undefined
                  if (target) {
                    event.preventDefault()
                    update({ view: target })
                    tabs.current.get(target)?.focus()
                  }
                }}
              >
                {tab === 'chat'
                  ? 'Conversation'
                  : tab === 'source'
                    ? 'Source'
                    : 'Tokens'}
              </button>
            ))}
          </div>
          <div
            id={`${uid}-chat`}
            role="tabpanel"
            aria-labelledby={`${uid}-chat-tab`}
            data-panel="chat"
            hidden={view !== 'chat'}
          >
            <Conversation
              index={index}
              actor={actor}
              cutoff={cutoff}
              query={query}
              category={category}
              selected={event?.id}
              inspect={inspect}
            />
          </div>
          <div
            id={`${uid}-source`}
            role="tabpanel"
            aria-labelledby={`${uid}-source-tab`}
            data-panel="source"
            hidden={view !== 'source'}
          >
            {event ? (
              <>
                <h4 data-event-title>{event.label}</h4>
                <p className="small" data-event-meta>
                  {utcTime(event.at, true)} ·{' '}
                  {index.nodes.get(index.canonical(event.node))?.label ??
                    event.node}
                </p>
                <pre data-event-detail>
                  {ms(event.at) > cutoff
                    ? 'This event occurs after the selected time. Advance the timeline to read its content.'
                    : JSON.stringify(event.detail, null, 2)}
                </pre>
                <pre data-event-source>
                  {JSON.stringify(eventSource(event, record, index), null, 2)}
                </pre>
              </>
            ) : (
              <p className="chat-empty">No source event selected.</p>
            )}
          </div>
          <div
            id={`${uid}-usage`}
            role="tabpanel"
            aria-labelledby={`${uid}-usage-tab`}
            data-panel="usage"
            hidden={view !== 'usage'}
          >
            <div className="metric-controls">
              <Select
                label="Measure"
                field="metric"
                value={metric}
                onChange={(value) => setMetric(value as Metric)}
              >
                <option value="cumulative">Cumulative tokens</option>
                <option value="response">Tokens per response</option>
                <option value="tool-time">Tool return time</option>
              </Select>
              <Select
                label="Horizontal axis"
                field="axis"
                value={axis}
                onChange={(value) => setAxis(value as Axis)}
              >
                <option value="time">Elapsed time</option>
                <option value="order">Recorded order</option>
              </Select>
            </div>
            <UsageChart
              index={index}
              cutoff={cutoff}
              selected={event?.id}
              actor={actor}
              metric={metric}
              axis={axis}
              inspect={inspect}
              navigate={navigate}
              showTooltip={showTooltip}
              hideTooltip={hideTooltip}
            />
          </div>
        </section>
      </div>
      <div className="navigation">
        <Select
          label="Jump to a moment"
          field="moment"
          value={event?.id ?? ''}
          onChange={(id) => {
            const next = index.byEvent.get(id)
            if (next) inspect(next)
          }}
        >
          {!visible.some((item) => item.id === event?.id) && (
            <option value={event?.id ?? ''}>
              {event
                ? 'Selected event is outside this filter'
                : 'Select an event'}
            </option>
          )}
          {visible.map((item) => (
            <option key={item.id} value={item.id}>
              {utcTime(item.at)} · {item.label}
            </option>
          ))}
        </Select>
        <button
          className="ui-button"
          data-prev
          type="button"
          disabled={!visible.length}
          onClick={() => navigate(-1)}
        >
          Previous
        </button>
        <button
          className="ui-button"
          data-next
          type="button"
          disabled={!visible.length}
          onClick={() => navigate(1)}
        >
          Next
        </button>
        <span data-position>
          {position >= 0 ? position + 1 : '—'} / {visible.length}
        </span>
        <button
          type="button"
          className="download-record"
          data-download
          onClick={() =>
            download(
              JSON.stringify(record, null, 2),
              record.runId + '.json',
              'application/json',
            )
          }
        >
          Download record
        </button>
      </div>
      <details className="assignment">
        <summary>Original assignment</summary>
        <dl data-assignment>
          {Object.entries(record.assignment)
            .filter(([key]) => key !== 'source')
            .map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
                <dd>
                  {typeof value === 'string'
                    ? value
                    : JSON.stringify(value, null, 2)}
                </dd>
              </div>
            ))}
        </dl>
        {record.assignment.source && (
          <pre>{JSON.stringify(record.assignment.source, null, 2)}</pre>
        )}
      </details>
      <details className="coverage">
        <summary>Sources, redactions &amp; capture gaps</summary>
        <div data-coverage>
          <p>{record.coverage.publicContent}</p>
          <p>{record.coverage.categoryMethod}</p>
          <p>{record.coverage.cost}</p>
          <p>
            {agents} agents · {sessions} native sessions · {joins} attributed
            sessions · {record.sources.length} source files.
          </p>
          {record.terminal && (
            <p>
              Recorded terminal: {record.terminal.kind ?? 'unknown'}
              {record.terminal.reason ? ` · ${record.terminal.reason}` : ''}
            </p>
          )}
          <pre>
            {JSON.stringify(
              { coverage: record.coverage, sources: record.sources },
              null,
              2,
            )}
          </pre>
        </div>
      </details>
      {tooltip && (
        <div
          className="ui-plot-tooltip"
          role="tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform:
              tooltip.y > window.innerHeight / 2
                ? 'translateY(-100%)'
                : undefined,
          }}
        >
          <strong>{tooltip.title}</strong>
          {tooltip.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
