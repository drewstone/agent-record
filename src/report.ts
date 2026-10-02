import { z } from 'zod'
import { recordSchema } from './record.js'

const time = z.iso.datetime({ offset: true })
const webUrl = z
  .url()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Use an HTTP or HTTPS source URL',
  )

export const claimStatuses = [
  'supported',
  'hypothesis',
  'unresolved',
  'refuted',
] as const

export const evidenceReferenceSchema = z
  .object({
    label: z.string().optional(),
    path: z.string().min(1).optional(),
    url: webUrl.optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    line: z.number().int().positive().optional(),
    eventId: z.string().min(1).optional(),
    excerpt: z.string().optional(),
  })
  .catchall(z.unknown())
  .refine(
    (source) => source.path || source.url || source.eventId,
    'Evidence needs a source path, URL, or recorded event',
  )

const claimSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    status: z.enum(claimStatuses),
    method: z.string().optional(),
    evidence: z.array(evidenceReferenceSchema),
    limitations: z.array(z.string()).default([]),
  })
  .catchall(z.unknown())
  .superRefine((claim, ctx) => {
    if (
      (claim.status === 'supported' || claim.status === 'refuted') &&
      !claim.evidence.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'A supported or refuted assessment needs evidence',
      })
  })

const questionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string(),
    status: z.enum(['observed', 'unavailable', 'not_applicable']),
    answer: z.string().optional(),
    evidence: z.array(evidenceReferenceSchema),
  })
  .superRefine((question, ctx) => {
    if (question.status === 'observed' && !question.evidence.length)
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'An observed answer needs evidence',
      })
  })

const observationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'check',
    'negative-finding',
    'wait',
    'resources',
    'next-step',
    'context',
  ]),
  title: z.string(),
  body: z.string(),
  evidence: z.array(evidenceReferenceSchema),
})

/** Versioned editorial annotations sit beside records; they never change recorded events. */
export const researchReportSchema = z
  .object({
    schema: z.literal('agent-research-report.v1'),
    id: z.string().min(1),
    title: z.string().min(1),
    generatedAt: time,
    summary: z.string(),
    assessmentBy: z.string().optional(),
    window: z
      .object({ from: time, to: time, label: z.string().optional() })
      .optional(),
    limitations: z.array(z.string()).default([]),
    freshness: z
      .object({
        state: z.enum(['current', 'stale', 'error']),
        checkedAt: time,
        message: z.string(),
        lastSuccessfulAt: time.optional(),
      })
      .optional(),
    questionCoverage: z.array(questionSchema).default([]),
    plays: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          summary: z.string(),
          updatedAt: time.nullable(),
          status: z.string().nullable(),
          claims: z.array(claimSchema),
          limitations: z.array(z.string()).default([]),
          sources: z.array(evidenceReferenceSchema).default([]),
          observations: z.array(observationSchema).default([]),
          questionCoverage: z.array(questionSchema).default([]),
          record: recordSchema.optional(),
        })
        .catchall(z.unknown()),
    ),
  })
  .catchall(z.unknown())
  .superRefine((report, ctx) => {
    if (
      report.window &&
      Date.parse(report.window.from) >= Date.parse(report.window.to)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['window'],
        message: 'The report window must end after it starts',
      })
    if (
      new Set(report.plays.map((play) => play.id)).size !== report.plays.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['plays'],
        message: 'Play IDs must be unique',
      })
    for (const [i, question] of report.questionCoverage.entries())
      if (question.evidence.some((source) => source.eventId))
        ctx.addIssue({
          code: 'custom',
          path: ['questionCoverage', i],
          message:
            'Report-wide evidence needs a path or URL; event references belong to one play',
        })
    for (const [i, play] of report.plays.entries()) {
      if (
        new Set(play.claims.map((claim) => claim.id)).size !==
        play.claims.length
      )
        ctx.addIssue({
          code: 'custom',
          path: ['plays', i, 'claims'],
          message: 'Claim IDs must be unique within a play',
        })
      const events = new Set(play.record?.events.map((event) => event.id))
      for (const field of ['observations', 'questionCoverage'] as const) {
        if (
          new Set(play[field].map((item) => item.id)).size !==
          play[field].length
        )
          ctx.addIssue({
            code: 'custom',
            path: ['plays', i, field],
            message: 'IDs must be unique within a section',
          })
        for (const [j, item] of play[field].entries())
          for (const [k, source] of item.evidence.entries())
            if (source.eventId && !events.has(source.eventId))
              ctx.addIssue({
                code: 'custom',
                path: ['plays', i, field, j, 'evidence', k, 'eventId'],
                message: 'Evidence event must exist in this play record',
              })
      }
      for (const [j, source] of play.sources.entries())
        if (source.eventId && !events.has(source.eventId))
          ctx.addIssue({
            code: 'custom',
            path: ['plays', i, 'sources', j, 'eventId'],
            message: 'Evidence event must exist in this play record',
          })
      for (const [j, claim] of play.claims.entries())
        for (const [k, source] of claim.evidence.entries())
          if (source.eventId && !events.has(source.eventId))
            ctx.addIssue({
              code: 'custom',
              path: ['plays', i, 'claims', j, 'evidence', k, 'eventId'],
              message: 'Evidence event must exist in this play record',
            })
    }
  })

export type ResearchReportData = z.infer<typeof researchReportSchema>
export type ResearchPlay = ResearchReportData['plays'][number]
export type ResearchClaim = ResearchPlay['claims'][number]
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>
export type QuestionCoverage = z.infer<typeof questionSchema>

export function parseResearchReport(value: unknown): ResearchReportData {
  return researchReportSchema.parse(value)
}

export function claimMatches(
  claim: ResearchClaim,
  query: string,
  status: string,
) {
  return (
    (status === 'all' || claim.status === status) &&
    [
      claim.statement,
      claim.method,
      ...claim.limitations,
      ...claim.evidence.flatMap((source) => [
        source.label,
        source.path,
        source.url,
        source.excerpt,
      ]),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
}

/** Escape all supplied content. Reports do not execute author-supplied TeX. Compile with LuaLaTeX for Unicode. */
export function escapeLatex(value: string): string {
  const replacements: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    $: '\\$',
    '&': '\\&',
    '#': '\\#',
    '%': '\\%',
    _: '\\_',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  }
  return value.replace(/[\\{}$&#%_~^]/g, (char) => replacements[char]!)
}

export function reportToLatex(
  report: ResearchReportData,
  playId?: string,
): string {
  const plays =
    playId === undefined
      ? report.plays
      : report.plays.filter((play) => play.id === playId)
  if (playId !== undefined && !plays.length)
    throw new Error('Unknown play: ' + playId)
  const text = escapeLatex
  const paragraph = (value: string) => text(value) + '\n\n'
  const list = (values: string[]) =>
    values.length
      ? '\\begin{itemize}\n' +
        values.map((value) => '\\item ' + text(value)).join('\n') +
        '\n\\end{itemize}\n'
      : ''
  const source = (value: EvidenceReference) =>
    [
      value.label,
      value.path,
      value.line === undefined ? '' : 'line ' + value.line,
      value.url,
      value.eventId ? 'event ' + value.eventId : '',
      value.sha256 ? 'SHA-256 ' + value.sha256 : '',
      value.excerpt ? 'Excerpt: ' + value.excerpt : '',
    ]
      .filter(Boolean)
      .join(' · ')
  const questions = (items: QuestionCoverage[]) =>
    items.length
      ? [
          '\\subsection*{Question coverage}',
          ...items.flatMap((item) => [
            paragraph(item.id + ' · ' + item.status + ' · ' + item.question),
            item.answer ? paragraph(item.answer) : '',
            list(item.evidence.map(source)),
          ]),
        ].join('\n')
      : ''
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage{fontspec}',
    '\\usepackage[margin=25mm]{geometry}',
    '\\usepackage{enumitem}',
    '\\setlist{nosep}',
    '\\setlength{\\emergencystretch}{3em}',
    '\\title{' +
      text(playId === undefined ? report.title : plays[0]!.title) +
      '}',
    '\\author{' + text(report.assessmentBy ?? 'Research report') + '}',
    '\\date{' + text(report.generatedAt) + '}',
    '\\begin{document}',
    '\\maketitle',
    paragraph(report.summary),
    report.window
      ? paragraph(
          'Observation window: ' +
            (report.window.label ?? '') +
            ' · ' +
            report.window.from +
            ' to ' +
            report.window.to,
        )
      : '',
    paragraph(
      'Assessment labels are supplied by the report author. This export does not independently verify research claims.',
    ),
    list(report.limitations),
    report.freshness
      ? paragraph(
          'Report freshness: ' +
            report.freshness.state +
            ' · checked ' +
            report.freshness.checkedAt +
            ' · ' +
            report.freshness.message,
        )
      : '',
    questions(report.questionCoverage),
    ...plays.flatMap((play) => [
      '\\section{' + text(play.title) + '}',
      paragraph(
        'Play: ' +
          play.id +
          ' · State: ' +
          (play.status ?? 'Unknown') +
          ' · Updated: ' +
          (play.updatedAt ?? 'Unknown'),
      ),
      paragraph(play.summary),
      list(play.limitations),
      ...play.claims.flatMap((claim) => [
        '\\subsection{' + text(claim.status + ': ' + claim.statement) + '}',
        claim.method ? paragraph('Method: ' + claim.method) : '',
        list(claim.limitations),
        claim.evidence.length
          ? list(claim.evidence.map(source))
          : paragraph('No supporting evidence supplied.'),
      ]),
      play.sources.length
        ? '\\subsection*{Play sources}\n' + list(play.sources.map(source))
        : '',
      ...play.observations.flatMap((item) => [
        '\\subsection*{' + text(item.kind + ': ' + item.title) + '}',
        paragraph(item.body),
        list(item.evidence.map(source)),
      ]),
      questions(play.questionCoverage),
      paragraph(
        play.record
          ? 'Trace: ' +
              play.record.runId +
              '; ' +
              play.record.events.length +
              ' retained events. Capture ' +
              (play.record.coverage.completeOriginalCapture
                ? 'marked complete by producer.'
                : 'incomplete or unknown.') +
              ' Cost: ' +
              play.record.coverage.cost
          : 'No event record was supplied. Topology, activity, and cost are unknown.',
      ),
    ]),
    '\\end{document}',
    '',
  ].join('\n')
}
