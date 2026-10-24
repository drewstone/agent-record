import { z } from 'zod'

/** A run's operator evidence, composed by the host from the live run directory (tangle-tools runs.run_execution). */
export const runExecutionSchema = z.object({
  alive: z.boolean(),
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
