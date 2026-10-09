'use client'
export { AgentRecord, type AgentRecordProps } from './AgentRecord.js'
export { ResearchReport, type ResearchReportProps } from './ResearchReport.js'
export { parseResearchReport, researchReportSchema, reportToLatex } from './report.js'
export type { ResearchReportData, ResearchPlay, ResearchClaim, ResearchDocument, ResearchMetric, EvidenceReference } from './report.js'
export { parseRecord, recordSchema } from './record.js'
export type {
  RunRecord,
  RecordNode,
  RecordEvent,
  RecordSelection,
  RecordArtifact,
  RecordClaim,
  RecordVerdict,
  RecordPublication,
  RecordProfileVersion,
} from './record.js'

export { parseReportOptions, type ReportOptions } from './report-options.js'
export * from './workspace.js'
export * from './assessment.js'
export { Workspace, type WorkspaceProps } from './Workspace.js'
export { FinalOutputPanel, TraceReviewSection } from './workspace/FinalOutput.js'
export { RecordWorkGraph } from './workspace/WorkGraph.js'
export { recordWorkGraphModel } from './workspace/work-graph-model.js'
export type { GraphNode, GraphEdge, WorkGraphModel } from './workspace/work-graph-model.js'
