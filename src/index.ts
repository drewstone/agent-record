'use client'
export { AgentRecord, type AgentRecordProps } from './AgentRecord.js'
export { ResearchReport, type ResearchReportProps } from './ResearchReport.js'
export { parseResearchReport, researchReportSchema, reportToLatex } from './report.js'
export type { ResearchReportData, ResearchPlay, ResearchClaim, ResearchDocument, ResearchMetric, EvidenceReference, ResearchRule, ResearchRun, ResearchSection, ResearchTable, ResearchUnknown } from './report.js'
export { playReportToResearchReport, type PlayReportDocument, type PlayReportFact } from './play-report.js'
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
export * from './workspace-model.js'
export * from './assessment.js'
export { Workspace, type WorkspaceProps } from './Workspace.js'
export { FinalOutputPanel, TraceReviewSection } from './workspace/FinalOutput.js'
export { hostWords } from './workspace/play-standing.js'
export { newerStarted, StatusPill, statusOf, type Status, type StatusAxis, type StatusInput, type StatusTone } from './workspace/data.js'
export { PlayHeader } from './workspace/PlayHead.js'
export { AnswerStrip, AsOfStamp } from './workspace/AnswerStrip.js'
export { overviewAnswers, type Answer } from './workspace/answers.js'
export { RunStatusLine, RunWhy } from './workspace/RunFold.js'
export { RUN_TABS, RunTabBar, sectionOf, tabOf } from './workspace/RunTabs.js'
export { AgentTable } from './workspace/RunTable.js'
export { agentSpendRows, SpendBars } from './workspace/Spend.js'
export { CollapsibleValue, ValueControls, ValueScope, VALUE_PREVIEW, followCommand, valueChars, valuePreview } from './workspace/CollapsibleValue.js'
export { ProfileCanvas } from './workspace/ProfileCanvas.js'
export { InputView } from './workspace/InputView.js'
export { plain as plainFinding } from './workspace/FindingsFeed.js'
export { ProfileDetail } from './workspace/ProfileVersions.js'
export { RecordWorkGraph } from './workspace/WorkGraph.js'
export { recordWorkGraphModel } from './workspace/work-graph-model.js'
export type { GraphNode, GraphEdge, WorkGraphModel } from './workspace/work-graph-model.js'

export { RunOverview, RunReceiptView } from './workspace/RunOverview.js'
export { RecordFlowWaterfall } from './workspace/RunFlowWaterfall.js'
export { runReceiptSchema } from './workspace/run-receipt.js'
export type { RunReceipt } from './workspace/run-receipt.js'
