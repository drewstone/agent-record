# Research reports

`ResearchReport` adds authored claim assessments to recorded evidence.
It accepts a validated `agent-research-report.v1` snapshot.
The host collects data, chooses the observation window, authors assessments, and decides who may see the snapshot.
By default the component makes no requests. It starts no agent work, stores no data, and changes no URLs. An optional commissioned source-search endpoint provides scoped retrieval; the standalone reader owns browser navigation.

```tsx
import { ResearchReport, parseResearchReport } from '@drewstone/agent-record'
import '@drewstone/agent-record/styles.css'

const report = parseResearchReport(input)
<ResearchReport report={report} theme="light" onPlayChange={setPlayId} />
```

`theme`, `className`, `defaultPlayId`, and `onPlayChange` are optional.
New immutable `report` objects update the displayed evidence.
The renderer preserves additional metadata in downloaded JSON.

## Contract

The complete types and validator are exported from `@drewstone/agent-record/report` without React.

| Field | Meaning |
| --- | --- |
| `schema` | `agent-research-report.v1` |
| `id`, `title`, `summary` | Report identity and authored introduction. |
| `generatedAt` | ISO timestamp with timezone for this report snapshot. |
| `assessmentBy` | Optional attribution for the assessments. |
| `window` | Optional `{from, to, label?}`; `to` must follow `from`. |
| `limitations` | Visible report limitations; defaults to an empty array. |
| `plays` | Ordered play snapshots; IDs must be unique. |
| `freshness` | Optional scheduler assertion: `{state, checkedAt, message, lastSuccessfulAt?}`. |
| `questionCoverage` | Optional report-wide coverage of named questions. |

Freshness `state` is `current`, `stale`, or `error`.
It is a timestamped producer assertion, not a browser liveness check.
The host must regenerate stale/error snapshots when a refresh fails.

Each play requires `id`, `title`, `summary`, `updatedAt`, `status`, and `claims`.
Unknown `updatedAt` and `status` are `null`.
Optional `record` contains a validated `agent-record.v1` record.
Omit it when no event record is available; the UI states that topology and activity are unavailable.
A summary never manufactures events from counts or prose.

Plays can include `limitations`, `sources`, `observations`, and `questionCoverage`.
These arrays default to empty.
Run verdicts such as `winner` are recorded execution state, not scientific verification.

A claim requires `id`, `statement`, `status`, and `evidence`.
Optional `title` gives a short heading while `statement` remains the result body. Optional `method` explains the assessment basis; `limitations` lists its scope and unresolved issues.
Statuses are `supported`, `hypothesis`, `unresolved`, and `refuted`.
Supported and refuted assessments require at least one source.
The validator checks provenance structure, not scientific correctness or source availability.

An evidence reference needs at least one of `path`, `url`, or `eventId`.
It can also include `label`, `sha256`, positive physical `line`, and a curated `excerpt`.
URLs must use HTTP or HTTPS.
Paths remain inspectable text; the renderer does not open host files.
An `eventId` must resolve in that play's attached record.
Report-wide sources use paths or URLs because event identities are scoped to plays.

## Checks and question coverage

Observations are separate from scientific claims:

```ts
{
  id: 'cost-coverage',
  kind: 'resources',
  title: 'Billed spend unavailable',
  body: 'The retained record marks cost completeness as unknown.',
  evidence: [{ path: 'receipt.json', line: 12 }],
}
```

Allowed kinds are `check`, `negative-finding`, `wait`, `resources`, `next-step`, and `context`.
Each observation requires `id`, `kind`, `title`, `body`, and `evidence`.
Sources and explicit uncertainty belong beside the observation.

Question coverage uses `{id, question, status, answer?, evidence}`.
Status is `observed`, `unavailable`, or `not_applicable`.
An observed answer requires a source.
This supports a caller's C01–C12 contract without defining the questions or scheduling policy here.

## Inspect and replay

The play rail selects a single workspace with Results, Activity, and Sources sections.
Results show claims before operational measurements; coverage and original metadata remain available in disclosures.
Activity searches retained event text and tool payloads across agents, reports matching counts, and opens the owning agent/event.
The agent selector and optional topology show recorded identities; absence of retained conversation does not mean no work occurred.
Tool inputs and results have readable text/field previews; original payloads and provenance remain secondary disclosures.
The trace cursor does not change the later report assessment.

Replay is paused initially.
In recorded-time mode, 1× compresses the complete event span into 30 seconds.
In event-step mode, 1× advances to the next distinct recorded timestamp each second.
Both modes offer 0.5×, 1×, 2×, and 4× speed, pause, scrub, and full-record controls.
The OS reduced-motion preference and explicit Reduced option use timestamp steps and disable CSS motion.
Leaving the browser tab pauses replay.

## Standalone HTML and LaTeX

The release contains the offline viewer bundle and this CLI:

```sh
agent-record-report authored-report.json report.html
```

It validates the input and writes `report.html` and `report.tex` with private permissions for newly created files.
The caller owns output directories, file retention, atomic publication, and access control.
The command prints JSON paths, the play count, and the supplied generation timestamp.
It exits nonzero on invalid data or a rendering failure.

HTML embeds CSS, the report JSON, and the React viewer.
It needs no server, CDN, font download, or network request.
Its CSP allows only the embedded script's SHA-256 hash and inline styles; connections are blocked.
A server CSP must allow that script hash for hydration.
Use the meta policy verbatim or compute the hash from the executable inline script.

The initial HTML is server-rendered and remains readable without JavaScript.
JavaScript enables play selection, filters, exports, and recorded replay.
The supplied report data is embedded in full; publishing HTML publishes all that data.
Review content and source metadata before public distribution.

`reportToLatex(report, playId?)` exports the whole report or one selected play.
The UI also downloads these documents.
All supplied text is escaped as text, including mathematical TeX; arbitrary author macros are not executed.
Compile with LuaLaTeX and the DejaVu Sans TrueType fonts from TeX Live's `dejavu` package.
The exporter names the regular, bold, italic and bold-italic font files explicitly.
These fonts cover Latin, Greek, Cyrillic and common mathematical symbols; arbitrary scripts may need a different font family.
Missing glyphs stop compilation instead of silently dropping claim content.
Long identifiers, paths and hashes receive line-break opportunities without truncation or inserted hyphens.
The export contains claim assessments, limitations, sources, checks, and question coverage, not the entire conversation.
Printing includes every play regardless of current filters.
Original event records remain in the JSON download.

## Retained documents and measurements

A play may include `documents`: `{id, path, title, content, sha256?, kind?}`.
`content` is the complete UTF-8 text selected by the producer; `kind` is `report`,
`knowledge` (default), `code`, or `data`. IDs and paths must be unique in that play.
The producer owns source selection, authorization, hash verification and capture
coverage. Additional metadata survives validation and JSON export.

The reader searches the included text, renders Markdown tables and native MathML,
opens relative references only when the target is included, and offers the original
text and line numbers. HTML and remote images do not execute or load. A claim source
whose path resolves to an included document opens it at the referenced line.
Unresolved links remain labeled text; they never read host files. Search retrieves
retained material; it does not generate an answer or establish a shared agent store.
Search text is prepared once per snapshot; queries still scan the included text and
are not constant-time. Use a bounded selected report, not an unbounded trace archive.

A play may include `metrics`: `{id, label, value, unit?, coverage?, source?}`.
`value` is a string or `null`; null displays as Unknown and does not acquire a unit.
Retain knownness and the measured population in `coverage`. Metrics and their source
references appear in HTML, JSON and LaTeX. LaTeX includes a document manifest; full
document bodies remain in the HTML and JSON, so exporting a summary does not pretend
to reproduce every original file.

Single-dollar text is preserved literally so financial figures are not misread as
formulas. Use double-dollar math for mathematical rendering. Optional retained
`sourcePath` and `aliases` metadata can resolve original absolute or store-relative
references to an included document; ambiguous aliases are not opened. Relative
references resolve against their originating document before alias lookup.

## Link to a retained source

Standalone reports accept `?play=PLAY_ID&document=EXACT_PATH&line=POSITIVE_LINE`. The play is required for a document citation, and the exact path must belong to that play. An unknown or ambiguous citation displays an explicit error instead of opening a different source. Source lines outside the document remain visibly out of range. Selecting a play or retained document updates the standalone report URL, so its current source can be shared. The original report data stays unchanged.

The React component does not modify URLs; it remains network-free unless `sourceSearchEndpoint` is supplied. Embedders can pass `defaultDocumentSelection: { playId, path, line? }` and handle `onDocumentChange` alongside `defaultPlayId` / `onPlayChange`. The standalone command owns browser URL handling.


## Commissioned source search and activity links

A host can opt into its existing same-origin source API:

```sh
agent-record-report authored-report.json report.html --source-search-endpoint /research/revisions/REVISION/knowledge.json
```

The equivalent React prop is `sourceSearchEndpoint`; the programmatic renderer accepts it in `renderReportFile(input, output, options)` and `renderReportHtml(report, options)`. It must be an absolute same-origin path with no query, fragment, or dot segments. The standalone renderer embeds `research-report-options` JSON and changes `connect-src` to `self` only for this explicit option. A server must authorize the same endpoint from its own verified publication metadata; arbitrary report text does not commission network access.

The Sources form calls the endpoint with `play`, `q`, and a bounded `limit`. It expects the shared Knowledge response `{scopeId, revision, indexedAt, hits:[{source:{id, contentHash, text}}]}`. Every hit must exactly match a document ID, digest, and body already retained in the selected play; revision routes must return the commissioned revision. Failure is explicit and never falls back to a broader corpus. The UI shows source excerpts, not generated answers. Offline Sources filtering remains available without this option.

Standalone section links use `?play=PLAY&view=results|activity|sources`. Activity links add `agent=NODE_ID` and/or `event=EVENT_ID`; each ID must belong to that play, and an event/agent pair must match its retained session join. Browser Back restores prior selections. The React callbacks `onViewChange` and `onActivityChange(playId, selection)` let embedders own equivalent navigation; `defaultView` and `defaultActivitySelection` select the initial view.

Activity and offline document search scan the supplied snapshot, so their runtime depends on retained data size. The viewer does not index raw archives, ingest missing captures, infer agent joins, or expose hidden reasoning.
