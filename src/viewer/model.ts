import { recordModel } from '@tangle-network/sandbox-ui/run'
import type { RunRecord } from '../record.js'

// Retained UI consumers share the owner projection until their composition moves.
export const { ms, utcTime, compact, hostless, fmt, interval, roleOf, textOf, toolKey, callsOf, preview, indexRecord, measuredUsage, agentState, eventMatches, eventSource, hoverLines, modelIdentity, tooltipSections } = recordModel
export type ToolCall = recordModel.ToolCall
export type TooltipSection = recordModel.TooltipSection
export type RecordIndex = recordModel.RecordIndex<RunRecord>
