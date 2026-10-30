'use client'
export { AgentRecord, type AgentRecordProps } from './AgentRecord.js'
export { ResearchReport, type ResearchReportProps } from './ResearchReport.js'
export { parseResearchReport, researchReportSchema, reportToLatex, parseReportOptions, type ReportOptions } from './report.js'
export type { ResearchReportData, ResearchPlay, ResearchClaim, ResearchDocument, ResearchMetric, EvidenceReference, ResearchRule, ResearchRun, ResearchSection, ResearchTable, ResearchUnknown } from './report.js'
export { playReportToResearchReport, type PlayReportDocument, type PlayReportFact } from './play-report.js'
export { parseRecord, recordSchema } from './record.js'
export type {
  RunRecord, RecordNode, RecordEvent, RecordSelection,
  RecordArtifact, RecordClaim, RecordVerdict,
  RecordPublication, RecordProfileVersion,
} from './record.js'

export * from './workspace-model.js'
export * from './assessment.js'
export { hostWords } from './workspace/play-standing.js'
export { RecordWorkGraph } from './workspace/WorkGraph.js'
export { recordWorkGraphModel } from './record.js'
export type { GraphNode, GraphEdge, WorkGraphModel } from './record.js'

export { runReceiptSchema } from './workspace/run-receipt.js'
export type { RunReceipt } from './workspace/run-receipt.js'
