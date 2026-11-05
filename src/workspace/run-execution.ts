import { z } from 'zod'

/** A run's operator evidence, composed by the host from the live run directory (tangle-tools runs.run_execution). */
export const runExecutionSchema = z.object({
  /** Null means Runtime could not verify holder liveness; it does not mean the run ended. */
  alive: z.boolean().nullable(),
  /** Host-observed finality, separate from liveness and the recorded goal outcome. Absent on legacy records. */
  final: z.boolean().optional(),
  /** Runtime phase plus the Lab's launch/trace overlays; null on records without phase evidence. */
  phase: z.enum(['running', 'down', 'cancelling', 'settled', 'parked', 'unpressed', 'start-failed', 'trace-incomplete', 'unverified']).nullable().optional(),
  /** The Lab's bounded projection of Runtime RunState. Unknown Runtime facts are omitted, not inferred.
   * See agent-runtime src/durable/run-state.ts and src/runtime/supervise/run-cancellation.ts. */
  runtimeState: z.object({
    phase: z.enum(['running', 'parked', 'cancelling', 'settled', 'down']).optional(),
    failureCode: z.string().optional(),
    holderLive: z.boolean().optional(),
    lastActivityAt: z.string().optional(),
    cancelRequest: z.object({
      operationId: z.string().min(1),
      at: z.string(),
      source: z.string(),
      deadlineMs: z.number().nonnegative().optional(),
      // Runtime retains historical requests written before operator became required on new writes.
      operator: z.string().optional(),
      reason: z.string().optional(),
    }).optional(),
  }).nullable().optional(),
  lastActivityAt: z.string().nullable(),
  failedAttempts: z.number(),
  settleKind: z.string().nullable(),
  endingError: z.object({ name: z.string(), message: z.string() }).nullable(),
  lastAttempt: z.object({ error: z.string().nullable(), classification: z.string().nullable(), madeProgress: z.boolean().nullable().optional(), retryInMs: z.number().nullable().optional(), at: z.string().nullable().optional() }).nullable(),
  diagnoses: z.array(z.object({ id: z.string(), title: z.string().optional(), fix: z.string() })),
  diagnosisError: z.string().nullable().optional(),
  /** `reason` is null where resuming does not apply (a host-placed run has no source sandbox). */
  resume: z.object({ status: z.enum(['preserved', 'unavailable', 'unknown']), command: z.string().nullable(), reason: z.string().nullable() }),
  runnerTail: z.string().nullable().optional(),
})
