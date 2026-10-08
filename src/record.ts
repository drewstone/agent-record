import { z } from 'zod'

const time = z.iso.datetime({ offset: true })
const metadata = z.record(z.string(), z.unknown())
const sourceSchema = z
  .object({
    path: z.string(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    line: z.number().int().positive().optional(),
    /** JSON Pointer into a JSON file; the hash covers the resolved value. */
    pointer: z.string().startsWith('/').optional(),
  })
  .catchall(z.unknown())
const capture = z
  .object({
    channel: z.string(),
    status: z.enum(['complete', 'lossy', 'absent']),
    reason: z.string().nullable(),
  })
  .catchall(z.unknown())
const gap = z
  .object({
    runId: z.string().optional(),
    nodeId: z.string().nullable().optional(),
    code: z.string(),
    detail: z.string(),
  })
  .catchall(z.unknown())

const pageSha256 = z.string().regex(/^[0-9a-f]{64}$/)
const profileDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
/** These references are recorded by producers. A missing target stays unresolved; it is never joined by text or time. */
const claimReference = z.object({ pageSha256, claimId: z.string().min(1) }).catchall(z.unknown())
const artifact = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  digest: pageSha256.optional(),
  sessionNodeId: z.string().optional(),
  eventId: z.string().optional(),
  source: sourceSchema.nullish(),
}).catchall(z.unknown())
const claim = claimReference.extend({
  statement: z.string(),
  agentNodeId: z.string().optional(),
  eventId: z.string().optional(),
  runId: z.string().optional(),
}).catchall(z.unknown())
const verdict = z.object({
  id: z.string().min(1),
  subject: claimReference,
  reviewerSessionNodeId: z.string().min(1),
  judgment: z.string().min(1),
  at: time.nullish(),
  eventId: z.string().optional(),
}).catchall(z.unknown())
const publication = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  url: z.url().nullish(),
  sessionNodeId: z.string().optional(),
  cites: z.array(claimReference.extend({ verdictId: z.string().optional() })),
}).catchall(z.unknown())
const profileVersion = z.object({
  digest: profileDigest,
  parents: z.array(profileDigest),
  runId: z.string().optional(),
  authorNodeId: z.string().optional(),
  title: z.string().optional(),
}).catchall(z.unknown())

/** One run forked from another, joined by the fork's own receipt (`basis`, e.g. `fork.json`), never by name or time. */
const fork = z.object({
  /** The node of the run that was forked from, and the node of the run the fork made. */
  from: z.string().min(1),
  to: z.string().min(1),
  basis: z.string().min(1),
  at: time.nullish(),
  reason: z.string().nullish(),
  source: sourceSchema.nullish(),
}).catchall(z.unknown())
/** A run whose own record this record joins by reference: its node here, its record's digest and where to read it. */
const runReference = z.object({
  nodeId: z.string().min(1),
  runId: z.string().min(1),
  recordDigest: z.string().nullish(),
  href: z.string().nullish(),
}).catchall(z.unknown())

export const recordSchema = z
  .object({
    schema: z.literal('agent-record.v1'),
    runId: z.string().min(1),
    title: z.string(),
    nodes: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string(),
          parent: z.string().nullable().default(null),
          kind: z.enum(['agent', 'session', 'finding']),
          role: z.string().optional(),
          assignment: z.string().optional(),
          model: z.string().nullable().optional(),
          start: time.optional(),
          end: time.optional(),
          status: z.string().optional(),
          nativeSessionId: z.string().optional(),
          agentId: z.string().optional(),
          joinBasis: z.string().optional(),
          joinProof: metadata.optional(),
          modelSource: z.string().optional(),
          servedModel: z.string().nullable().optional(),
          harness: z.string().nullable().optional(),
          /** Execution environments, in first-seen order. */
          sandboxes: z.array(z.string()).optional(),
          capture: capture.optional(),
          /** A reviewer's statement of what this agent's capture lacks and why. */
          captureNote: z.string().optional(),
        })
        .catchall(z.unknown()),
    ),
    events: z.array(
      z
        .object({
          id: z.string().min(1),
          node: z.string().min(1),
          at: time,
          kind: z.string(),
          category: z.string().default('other'),
          label: z.string(),
          source: sourceSchema.nullable().optional(),
          detail: z
            .object({
              role: z.string().optional(),
              publicText: z.string().optional(),
              publicationNote: z.string().nullish(),
              contentOmitted: z.string().optional(),
              publicToolCalls: z
                .array(
                  z
                    .object({
                      id: z.string(),
                      name: z.string(),
                      /** Absent when the source holds no arguments for the call; the viewer says so. */
                      input: z.string().optional(),
                      publicationNote: z.string().nullish(),
                    })
                    .catchall(z.unknown()),
                )
                .optional(),
              toolCallIds: z.array(z.string()).optional(),
              toolNames: z.array(z.string()).optional(),
              toolCallId: z.string().optional(),
              isError: z.boolean().optional(),
              responseStatus: z.string().optional(),
              recordedClaim: z.string().optional(),
              assessment: z.string().optional(),
              usage: z
                .object({
                  input: z.number().nonnegative().optional(),
                  output: z.number().nonnegative().optional(),
                  cacheRead: z.number().nonnegative().optional(),
                  cacheWrite: z.number().nonnegative().optional(),
                })
                .catchall(z.unknown())
                .nullish(),
              reasoning: z.string().optional(),
              /** Thinking blocks the provider returned without text (display omitted): the model thought; no text exists. */
              reasoningOmitted: z.number().int().nonnegative().optional(),
              /** Encrypted redacted_thinking blocks. */
              reasoningRedacted: z.number().int().nonnegative().optional(),
              durationMs: z.number().nonnegative().optional(),
              /** List-price estimate from recorded usage. Not a bill. */
              costListUsd: z.number().nonnegative().optional(),
              usdKnown: z.boolean().optional(),
              rateLimit: z
                .object({
                  window: z.string().nullable(),
                  utilization: z.number().nullable(),
                  status: z.string().nullable(),
                })
                .catchall(z.unknown())
                .optional(),
              /** The body was shortened; the full text is the source entry with this hash. */
              clip: z
                .object({
                  bytes: z.number().int().nonnegative(),
                  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
                })
                .catchall(z.unknown())
                .optional(),
            })
            .catchall(z.unknown()),
        })
        .catchall(z.unknown()),
    ),
    /** Optional to keep existing v1 publication bytes and event anchors unchanged. */
    artifacts: z.array(artifact).optional(),
    claims: z.array(claim).optional(),
    verdicts: z.array(verdict).optional(),
    publications: z.array(publication).optional(),
    profileVersions: z.array(profileVersion).optional(),
    /** A play's record: the runs it joins by reference, and the forks between them. */
    runs: z.array(runReference).optional(),
    forks: z.array(fork).optional(),
    sources: z
      .array(
        sourceSchema.extend({ bytes: z.number().nonnegative().optional() }),
      )
      .default([]),
    assignment: z
      .object({
        objective: z.string(),
        suppliedKnowledge: z.string(),
        deliverables: z.string(),
        constraints: z.string(),
        source: sourceSchema.nullable(),
      })
      .catchall(z.unknown())
      .default({
        objective: '',
        suppliedKnowledge: '',
        deliverables: '',
        constraints: '',
        source: null,
      }),
    terminal: z
      .object({ kind: z.string().nullable(), reason: z.string().nullable() })
      .catchall(z.unknown())
      .nullable()
      .default(null),
    coverage: z
      .object({
        completeOriginalCapture: z.boolean(),
        publicContent: z.string(),
        categoryMethod: z.string(),
        cost: z.string(),
        nodes: z
          .array(capture.extend({ nodeId: z.string() }))
          .optional(),
        gaps: z.array(gap).optional(),
      })
      .catchall(z.unknown())
      .default({
        completeOriginalCapture: false,
        publicContent: '',
        categoryMethod: '',
        cost: 'Unknown',
      }),
  })
  .catchall(z.unknown())
  .superRefine((record, ctx) => {
    const nodes = new Map(record.nodes.map((node) => [node.id, node]))
    if (nodes.size !== record.nodes.length)
      ctx.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'Node IDs must be unique within a run',
      })
    if (
      new Set(record.events.map((event) => event.id)).size !==
      record.events.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Event IDs must be unique within a run',
      })
    for (const [i, node] of record.nodes.entries()) {
      if (
        node.agentId &&
        (node.kind !== 'session' || nodes.get(node.agentId)?.kind !== 'agent')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'agentId'],
          message: 'A proven session join must reference an existing agent',
        })
      const seen = new Set<string>([node.id])
      let parent = node.parent
      while (parent && nodes.has(parent)) {
        if (seen.has(parent)) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', i, 'parent'],
            message: 'Parent relationships must not contain a cycle',
          })
          break
        }
        seen.add(parent)
        parent = nodes.get(parent)!.parent
      }
    }
    for (const [i, event] of record.events.entries()) {
      if (!nodes.has(event.node))
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'node'],
          message:
            'An event must reference an existing node, even when that node has unresolved identity',
        })
      const calls = event.detail.publicToolCalls ?? []
      if (new Set(calls.map((call) => call.id)).size !== calls.length)
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'detail', 'publicToolCalls'],
          message: 'Published tool call IDs must be unique within an event',
        })
    }
    const unique = (values: readonly string[], path: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [path], message: `${path} identifiers must be unique` })
    }
    unique((record.artifacts ?? []).map((item) => item.id), 'artifacts')
    unique((record.claims ?? []).map((item) => `${item.pageSha256}:${item.claimId}`), 'claims')
    unique((record.verdicts ?? []).map((item) => item.id), 'verdicts')
    unique((record.publications ?? []).map((item) => item.id), 'publications')
    unique((record.profileVersions ?? []).map((item) => item.digest), 'profileVersions')
    const events = new Set(record.events.map((event) => event.id))
    for (const [i, item] of (record.artifacts ?? []).entries()) {
      if (item.sessionNodeId && !nodes.has(item.sessionNodeId))
        ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'sessionNodeId'], message: 'Artifact session must exist in this record' })
      if (item.eventId && !events.has(item.eventId))
        ctx.addIssue({ code: 'custom', path: ['artifacts', i, 'eventId'], message: 'Artifact event must exist in this record' })
    }
    for (const [i, item] of (record.claims ?? []).entries()) {
      if (item.agentNodeId && !nodes.has(item.agentNodeId))
        ctx.addIssue({ code: 'custom', path: ['claims', i, 'agentNodeId'], message: 'Claim agent must exist in this record' })
      if (item.eventId && !events.has(item.eventId))
        ctx.addIssue({ code: 'custom', path: ['claims', i, 'eventId'], message: 'Claim event must exist in this record' })
    }
    for (const [i, item] of (record.verdicts ?? []).entries()) {
      if (nodes.get(item.reviewerSessionNodeId)?.kind !== 'session')
        ctx.addIssue({ code: 'custom', path: ['verdicts', i, 'reviewerSessionNodeId'], message: 'Verdict reviewer must be a session in this record' })
      if (item.eventId && !events.has(item.eventId))
        ctx.addIssue({ code: 'custom', path: ['verdicts', i, 'eventId'], message: 'Verdict event must exist in this record' })
    }
    for (const [i, item] of (record.publications ?? []).entries()) {
      if (item.sessionNodeId && nodes.get(item.sessionNodeId)?.kind !== 'session')
        ctx.addIssue({ code: 'custom', path: ['publications', i, 'sessionNodeId'], message: 'Publication session must exist in this record' })
    }
    for (const [i, item] of (record.profileVersions ?? []).entries()) {
      if (item.authorNodeId && !nodes.has(item.authorNodeId))
        ctx.addIssue({ code: 'custom', path: ['profileVersions', i, 'authorNodeId'], message: 'Profile author must exist in this record' })
    }
  })

export type RunRecord = z.infer<typeof recordSchema>
export type RecordCapture = z.infer<typeof capture>
export type RecordGap = z.infer<typeof gap>
export type RecordNode = RunRecord['nodes'][number]
export type RecordEvent = RunRecord['events'][number]
export type RecordArtifact = NonNullable<RunRecord['artifacts']>[number]
export type RecordClaim = NonNullable<RunRecord['claims']>[number]
export type RecordVerdict = NonNullable<RunRecord['verdicts']>[number]
export type RecordPublication = NonNullable<RunRecord['publications']>[number]
export type RecordProfileVersion = NonNullable<RunRecord['profileVersions']>[number]
export interface RecordSelection {
  runId: string
  nodeId?: string
  eventId?: string
  /** UTC timestamp at the playback cursor. Omitted means the complete record. */
  at?: string
  view?: 'chat' | 'source' | 'usage'
}

/** Validate at the import boundary. Unknown metadata is preserved. */
export function parseRecord(value: unknown): RunRecord {
  return recordSchema.parse(value)
}
