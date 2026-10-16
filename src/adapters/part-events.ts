/** Browser-safe projection shared by retained ingest and the live Conversations view.
 * The host supplies source anchors, clipping, classification and the event sink. */
type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const isoAt = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value)
  return Number.isFinite(date.valueOf()) && date.valueOf() >= Date.UTC(2001, 0, 1) && date.valueOf() < Date.UTC(2100, 0, 1) ? date.toISOString() : null
}
export function projectPartEvents(context: Json, node: Json, rel: string, entry: { sha256: string }, events: Json[], loc: { where(index: number): Json; full(index: number, path: (string | number)[], value: Json): Json }, categoryOf: (name: string, input: unknown) => string): number {
    let produced = 0
    // Final state per part id, in first-seen order, with the carried clock at first sight.
    const order: string[] = []
    const final = new Map<string, { part: Json; index: number; firstMs: number | null }>()
    const codex = new Map<string, { item: Json; index: number; firstMs: number | null }>()
    const codexOrder: string[] = []
    let clock: number | null = node.start ? Date.parse(node.start) : null
    let lastText: Json | undefined
    let done: Json = null
    const extras: { index: number; at: number | null; kind: string; data: Json }[] = []
    events.forEach((event, index) => {
      const data = event?.data ?? {}
      if (event?.type === 'message.part.updated' && data.part?.id) {
        const part = data.part
        const time = num(part.state?.time?.start) ?? num(part.time?.start)
        if (time !== undefined) clock = Math.max(clock ?? 0, time)
        if (!final.has(part.id)) order.push(part.id)
        const previous = final.get(part.id)
        final.set(part.id, { part, index, firstMs: previous?.firstMs ?? clock })
        const end = num(part.state?.time?.end) ?? num(part.time?.end)
        if (end !== undefined) clock = Math.max(clock ?? 0, end)
      } else if (event?.type === 'raw' && data.event?.type === 'item.completed' && data.event.item?.id) {
        const item = data.event.item
        if (!codex.has(item.id)) codexOrder.push(item.id)
        codex.set(item.id, { item, index, firstMs: clock })
      } else if (event?.type === 'raw' && data.event?.role === 'tool' && typeof data.event.tool_call_id === 'string') {
        // Kimi streams tool results without their calls.
        extras.push({ index, at: clock, kind: 'tool-result', data: data.event })
      } else if (event?.type === 'raw' && data.event?.type === 'rate_limit_event') {
        extras.push({ index, at: clock, kind: 'rate-limit', data: data.event.rate_limit_info ?? {} })
      } else if (event?.type === 'done') {
        done = { data, usage: event.usage, index }
      } else if (event?.type === 'result' && data.outcome && data.outcome.type !== 'completed') {
        extras.push({ index, at: clock, kind: 'execution-error', data: data.outcome })
      }
    })
    const atOf = (ms: number | null) => isoAt(ms ?? undefined) ?? node.start ?? null
    for (const id of order) {
      const { part, index } = final.get(id)!
      const firstMs = final.get(id)!.firstMs
            if (part.type === 'text' || part.type === 'reasoning') {
        const text = str(part.text)
        if (!text) continue
        const shown = context.clip(text, () => loc.full(index, ['data', 'part', 'text'], text))
        const at = atOf(num(part.time?.start) ?? firstMs)
        if (!at) continue
        context.emit({
          node: node.id,
          at,
          kind: 'message',
          category: 'reasoning',
          label: 'assistant',
          source: { path: rel, sha256: entry.sha256, ...loc.where(index) },
          detail: { role: 'assistant', nativeRecordId: id, ...(part.type === 'text' ? { publicText: shown.text } : { reasoning: shown.text }), ...(shown.clip ? { clip: shown.clip } : {}), ...(part.time?.start ? {} : { atBasis: 'carried' }) },
        })
        produced++
        lastText = context.events.at(-1)
      } else if (part.type === 'tool') {
        const state = part.state ?? {}
        const name = str(part.tool)
        const callId = str(part.callID || id)
        const category = categoryOf(name, state.input)
        const input = context.clip(JSON.stringify(state.input ?? {}), () => loc.full(index, ['data', 'part', 'state', 'input'], state.input ?? {}))
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
          source: { path: rel, sha256: entry.sha256, ...loc.where(index), ...(settled ? { item: 0 } : {}) },
          detail: { role: 'assistant', nativeRecordId: id, publicToolCalls: [{ id: callId, name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
        })
        produced++
        if (settled) {
          const field = state.status === 'error' ? 'error' : 'output'
          const body = str(state[field])
          const shown = context.clip(body, () => loc.full(index, ['data', 'part', 'state', field], state[field]))
          const endMs = num(state.time?.end)
          context.emit({
            node: node.id,
            at: atOf(endMs ?? startMs)!,
            kind: 'tool-result',
            category,
            label: `tool result · ${name}`,
            source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 1 },
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
    for (const id of codexOrder) {
      const { item, index, firstMs } = codex.get(id)!
      if (item.type !== 'command_execution' && item.type !== 'mcp_tool_call' && item.type !== 'web_search' && item.type !== 'file_change') continue
      const at = atOf(firstMs)
      if (!at) continue
      const name = item.type === 'mcp_tool_call' ? str(item.tool ?? item.name) : item.type
      const inputValue = item.type === 'command_execution' ? { command: item.command } : item.type === 'web_search' ? { query: item.query } : item.type === 'file_change' ? { changes: item.changes } : item.arguments ?? {}
      const input = context.clip(JSON.stringify(inputValue), () => loc.full(index, ['data', 'event', 'item'], item))
      const category = categoryOf(name, inputValue)
      context.emit({
        node: node.id,
        at,
        kind: 'message',
        category,
        label: `assistant · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 0 },
        detail: { role: 'assistant', nativeRecordId: str(id), publicToolCalls: [{ id: str(id), name, input: input.text, ...(input.clip ? { clip: input.clip } : {}) }] },
      })
      const body = str(item.aggregated_output ?? item.result ?? item.output ?? item.status)
      const shown = context.clip(body, () => loc.full(index, ['data', 'event', 'item'], item))
      context.emit({
        node: node.id,
        at,
        kind: 'tool-result',
        category,
        label: `tool result · ${name}`,
        source: { path: rel, sha256: entry.sha256, ...loc.where(index), item: 1 },
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
        const shown = context.clip(body, () => loc.full(extra.index, ['data', 'event', 'content'], content))
        context.emit({
          node: node.id,
          at,
          kind: 'tool-result',
          category: 'other',
          label: 'tool result',
          source: { path: rel, sha256: entry.sha256, ...loc.where(extra.index) },
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
        source: { path: rel, sha256: entry.sha256, ...loc.where(extra.index) },
        detail:
          extra.kind === 'rate-limit'
            ? { rateLimit: { window, utilization, status: extra.data.status ?? null }, data: context.compactValue(extra.data) }
            : { responseStatus: 'error', isError: true, publicText: context.clip(str(extra.data.error ?? extra.data), null).text },
      })
    }
    if (done) {
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
      const unmeteredZero =
        (done.data?.tokensKnown === false || done.tokensKnown === false) &&
        !num(usage?.inputTokens) && !num(usage?.outputTokens) && !num(usage?.cacheReadInputTokens) && !num(usage?.cacheCreationInputTokens) && !cost
      if (target && usage && !unmeteredZero) {
        target.detail.usage = {
          input: num(usage.inputTokens),
          output: num(usage.outputTokens),
          cacheRead: num(usage.cacheReadInputTokens),
          cacheWrite: num(usage.cacheCreationInputTokens),
        }
        target.detail.usageScope = 'execution-total'
        if (cost !== undefined) {
          target.detail.costListUsd = cost
          target.detail.usdKnown = false
        }
      }
    }

    return produced
}
