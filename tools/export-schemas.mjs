// Writes JSON Schema for every served shape to dist/schemas/, for consumers that do not run Zod.
import { mkdirSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { recordSchema } from '../dist/record.js'
import { bundleSchema, snapshotSchema } from '../dist/publication.js'
import { playsDocumentSchema, playDocumentSchema, profileGraphDocumentSchema, runDocumentSchema, versionGraphDocumentSchema } from '../dist/workspace.js'
import { assessmentsDocumentSchema, assessmentRowSchema, dimensionsDocumentSchema } from '../dist/assessment.js'

const schemas = {
  'agent-record.v1': recordSchema,
  'agent-record.bundle.v1': bundleSchema,
  'evidence.snapshot.v1': snapshotSchema,
  'agent-workspace.plays.v1': playsDocumentSchema,
  'agent-workspace.play.v1': playDocumentSchema,
  'agent-workspace.run.v1': runDocumentSchema,
  'discovery-lab.profile-graph': profileGraphDocumentSchema,
  'agent-workspace.version-graph': versionGraphDocumentSchema,
  'agent-trace-assessments.v1': assessmentsDocumentSchema,
  'agent-trace-assessment.v1': assessmentRowSchema,
  'agent-trace-dimensions.v1': dimensionsDocumentSchema,
}
mkdirSync('dist/schemas', { recursive: true })
for (const [name, schema] of Object.entries(schemas))
  writeFileSync(`dist/schemas/${name}.json`, JSON.stringify({ $id: name, ...z.toJSONSchema(schema, { unrepresentable: 'any' }) }, null, 2) + '\n')
