/** Browser-safe projection shared by retained ingest and the live Conversations view, and the value helpers every harness reader uses.
 * The host supplies source anchors, clipping, classification and the event sink. A placeholder time (the Unix epoch, before 2001) is no time. */
export type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any
export const str = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
export const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
export const isoAt = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value)
  return Number.isFinite(date.valueOf()) && date.valueOf() >= Date.UTC(2001, 0, 1) && date.valueOf() < Date.UTC(2100, 0, 1) ? date.toISOString() : null
}
interface PartFrame {
  event: Json
  where(): Json
  full(path: (string | number)[], value: Json): Json
}

export function projectPartEvents(context: Json, node: Json, rel: string, entry: { sha256: string }, events: Json[], loc: { where(index: number): Json; full(index: number, path: (string | number)[], value: Json): Json }, categoryOf: (name: string, input: unknown) => string): number {
    function* frames(): Generator<PartFrame> {
      for (const [index, event] of events.entries()) yield { event, where: () => loc.where(index), full: (path, value) => loc.full(index, path, value) }
    }
    return projectPartFrames(context, node, rel, entry, frames(), categoryOf)
}

/** The final state of each part retains its source frame; superseded input frames can be released. */
export function projectPartFrames(context: Json, node: Json, rel: string, entry: { sha256: string }, frames: Iterable<PartFrame>, categoryOf: (name: string, input: unknown) => string): number {
    let produced = 0
    // Final state per part id, in first-seen order, with the carried clock at first sight.
    const roles = new Map<string, string>()
    const final = new Map<string, { part: Json; frame: PartFrame; firstMs: number | null }>()
    const codex = new Map<string, { item: Json; frame: PartFrame; firstMs: number | null }>()
    let clock: number | null = node.start ? Date.parse(node.start) : null
    let lastText: Json | undefined
    let done: Json = null
    const extras: { frame: PartFrame; at: number | null; kind: string; data: Json }[] = []
    for (const frame of frames) {
      const { event } = frame
      const data = event?.data ?? {}
      if (event?.type === 'message.updated' && data.info?.id && data.info?.role) {
        roles.set(data.info.id, data.info.role)
      } else if (event?.type === 'message.part.updated' && data.part?.id) {
        const part = data.part
        const time = num(part.state?.time?.start) ?? num(part.time?.start)
        if (time !== undefined) clock = Math.max(clock ?? 0, time)
        final.set(part.id, { part, frame, firstMs: final.get(part.id)?.firstMs ?? clock })
        const end = num(part.state?.time?.end) ?? num(part.time?.end)
        if (end !== undefined) clock = Math.max(clock ?? 0, end)
      } else if (event?.type === 'raw' && data.event?.type === 'item.completed' && data.event.item?.id) {
        const item = data.event.item
        codex.set(item.id, { item, frame, firstMs: clock })
      } else if (event?.type === 'raw' && data.event?.role === 'tool' && typeof data.event.tool_call_id === 'string') {
        // Kimi streams tool results without their calls.
        extras.push({ frame, at: clock, kind: 'tool-result', data: data.event })
      } else if (event?.type === 'raw' && data.event?.type === 'rate_limit_event') {
        extras.push({ frame, at: clock, kind: 'rate-limit', data: data.event.rate_limit_info ?? {} })
      } else if (event?.type === 'done') {
        done = { data, usage: event.usage }
      } else if (event?.type === 'result' && data.outcome && data.outcome.type !== 'completed') {
        extras.push({ frame, at: clock, kind: 'execution-error', data: data.outcome })
      }
    }
    const atOf = (ms: number | null) => isoAt(ms ?? undefined) ?? node.start ?? null
    for (const [id, { part, frame, firstMs }] of final) {
      const role = roles.get(part.messageID) === 'user' ? 'user' : 'assistant'
      if (part.type === 'text' || part.type === 'reasoning') {
        const text = str(part.text)
        if (!text) continue
        const shown = context.clip(text, () => frame.full(['data', 'part', 'text'], text))
        const at = atOf(num(part.time?.start) ?? firstMs)
        if (!at) continue
        context.emit({
          node: node.id,
          at,
          kind: 'message',
          category: 'reasoning',
          label: role,
          source: { path: rel, sha256: entry.sha256, ...frame.where() },
          detail: { role, nativeRecordId: id, ...(part.type === 'text' ? { publicText: shown.text } : { reasoning: shown.text }), ...(shown.clip ? { clip: shown.clip } : {}), ...(part.time?.start ? {} : { atBasis: 'carried' }) },
        })
        produced++
        if (role === 'assistant') lastText = context.events.at(-1)
      } else if (part.type === 'tool') {
        const state = part.state ?? {}
        const name = str(part.tool)
        const callId = str(part.callID || id)
        const category = categoryOf(name, state.input)
        const input = context.clip(JSON.stringify(state.input ?? {}), () => frame.full(['data', 'part', 'state', 'input'], state.input ?? {}))
        const startMs = num(state.time?.start) ?? firstMs
        const at = atOf(startMs)
        if (!at) continue
        const settled = state.status === 'completed' || state.status === 'error'
        context.emit({
          node: node.id,
          at,
          kind: 'message',
          category,
          label: `assistant · ${name}`,
          source: { path: rel, sha256: entry.sha256, ...frame.where(), ...(settled ? { item: 0 } : {}) },
          detail: { role: 'assistant', nativeRecordId: id, publicToolCalls: [{ id: callId, name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
        })
        produced++
        if (settled) {
          const field = state.status === 'error' ? 'error' : 'output'
          const shown = context.clip(str(state[field]), () => frame.full(['data', 'part', 'state', field], state[field]))
          const endMs = num(state.time?.end)
          context.emit({
            node: node.id,
            at: atOf(endMs ?? startMs)!,
            kind: 'tool-result',
            category,
            label: `tool result · ${name}`,
            source: { path: rel, sha256: entry.sha256, ...frame.where(), item: 1 },
            detail: {
              role: 'toolResult',
              nativeRecordId: id,
              toolCallId: callId,
              isError: state.status === 'error',
              publicText: shown.text,
              ...(shown.clip ? { clip: shown.clip } : {}),
              ...(endMs !== undefined && startMs !== null && startMs !== undefined ? { durationMs: Math.max(0, endMs - startMs) } : {}),
            },
          })
        }
      }
    }
    for (const [id, { item, frame, firstMs }] of codex) {
      if (item.type !== 'command_execution' && item.type !== 'mcp_tool_call' && item.type !== 'web_search' && item.type !== 'file_change') continue
      const at = atOf(firstMs)
      if (!at) continue
      const name = item.type === 'mcp_tool_call' ? str(item.tool ?? item.name) : item.type
      const inputValue = item.type === 'command_execution' ? { command: item.command } : item.type === 'web_search' ? { query: item.query } : item.type === 'file_change' ? { changes: item.changes } : item.arguments ?? {}
      const input = context.clip(JSON.stringify(inputValue), () => frame.full(['data', 'event', 'item'], item))
      const category = categoryOf(name, inputValue)
      context.emit({
        node: node.id,
        at,
        kind: 'message',
        category,
        label: `assistant · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...frame.where(), item: 0 },
        detail: { role: 'assistant', nativeRecordId: str(id), publicToolCalls: [{ id: str(id), name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
      })
      const shown = context.clip(str(item.aggregated_output ?? item.result ?? item.output ?? item.status), () => frame.full(['data', 'event', 'item'], item))
      context.emit({
        node: node.id,
        at,
        kind: 'tool-result',
        category,
        label: `tool result · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...frame.where(), item: 1 },
        detail: {
          role: 'toolResult',
          nativeRecordId: str(id),
          toolCallId: str(id),
          isError: (typeof item.exit_code === 'number' && item.exit_code !== 0) || item.status === 'failed',
          publicText: shown.text,
          ...(shown.clip ? { clip: shown.clip } : {}),
          atBasis: 'carried',
        },
      })
      produced += 2
    }
    for (const extra of extras) {
      const at = atOf(extra.at)
      if (!at) continue
      if (extra.kind === 'tool-result') {
        const content = extra.data.content
        const body = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: Json) => str(part?.text ?? part)).join('\n') : str(content)
        const shown = context.clip(body, () => extra.frame.full(['data', 'event', 'content'], content))
        context.emit({
          node: node.id,
          at,
          kind: 'tool-result',
          category: 'other',
          label: 'tool result',
          source: { path: rel, sha256: entry.sha256, ...extra.frame.where() },
          detail: { role: 'toolResult', toolCallId: str(extra.data.tool_call_id), isError: /<system>ERROR/.test(body), publicText: shown.text, ...(shown.clip ? { clip: shown.clip } : {}), atBasis: 'carried' },
        })
        produced++
        continue
      }
      const window = extra.data.rateLimitType ?? null
      const utilization = window ? num(extra.data.unifiedWindows?.[window]?.utilization) ?? null : null
      context.emit({
        node: node.id,
        at,
        kind: extra.kind,
        category: 'lifecycle',
        label: extra.kind === 'rate-limit' ? `rate limit · ${window ?? 'window unknown'}` : 'execution error',
        source: { path: rel, sha256: entry.sha256, ...extra.frame.where() },
        detail:
          extra.kind === 'rate-limit'
            ? { rateLimit: { window, utilization, status: extra.data.status ?? null }, data: context.compactValue(extra.data) }
            : { responseStatus: 'error', isError: true, publicText: context.clip(str(extra.data.error ?? extra.data), null).text },
      })
    }
    if (!done) return produced
    const backend = done.data?.effectiveBackend
    if (typeof backend?.model === 'string') {
      node.servedModel ??= backend.model
      node.modelSource ??= 'effective backend'
    }
    const usage = done.usage ?? done.data?.tokenUsage
    const cost = num(usage?.cost) ?? num(done.data?.totalCostUsd)
    const target = lastText ?? [...context.events].reverse().find((event) => event.node === node.id && event.source?.path === context.sourcePath(rel))
    // A zero report from an execution Runtime did not meter (tokensKnown false) is no evidence of zero use: a rate-limited
    // or lost attempt reports nothing for the attempts before it. Its usage stays unknown.
    const unmeteredZero = done.data?.tokensKnown === false &&
      !num(usage?.inputTokens) && !num(usage?.outputTokens) && !num(usage?.cacheReadInputTokens) && !num(usage?.cacheCreationInputTokens) && !cost
    if (target && usage && !unmeteredZero) {
      Object.assign(target.detail, {
        usage: {
          input: num(usage.inputTokens),
          output: num(usage.outputTokens),
          cacheRead: num(usage.cacheReadInputTokens),
          cacheWrite: num(usage.cacheCreationInputTokens),
        },
        usageScope: 'execution-total',
        ...(cost === undefined ? {} : { costListUsd: cost, usdKnown: false }),
      })
    }

    return produced
}
