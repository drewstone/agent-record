# Research reports

`ResearchReport` adds authored claim assessments to recorded evidence.
It accepts a validated `agent-research-report.v1` snapshot.
The host collects data, chooses the observation window, authors assessments, and decides who may see the snapshot.
The component makes no requests, starts no work, stores no data, and changes no URLs.

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
Optional `method` explains the assessment basis; `limitations` lists its scope and unresolved issues.
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

Search filters plays by title, summary, claim text, method, limitation, or source.
Assessment filters change the visible plays and claims.
Selecting a source event moves the existing trace viewer to that exact event and timestamp.
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
Compile with LuaLaTeX for Unicode text.
The export contains claim assessments, limitations, sources, checks, and question coverage, not the entire conversation.
Printing includes every play regardless of current filters.
Original event records remain in the JSON download.
