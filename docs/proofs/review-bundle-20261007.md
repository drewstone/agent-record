# 2026-10-07 research review bundle proof

The source run is `research-debruijn-frontier-20261004system3`. Its anchored publication record remains intact. This proof adds retained Codex and Claude review sessions and the Pi GLM judgments for claims from that run to one validated `RunRecord`. It is an internal consumer fixture, not a publication input.

## Reproduce

Build agent-record, then pass the local retained record, review manifest, Pi session directory, claim index, verdict ledger, and a private output directory:

```sh
node --max-old-space-size=4096 tools/prove-review-bundle.mjs \
  "$RUN_RECORD" "$REVIEW_MANIFEST" "$PI_SESSION_DIR" \
  "$CLAIM_INDEX" "$VERDICTS" "$PRIVATE_OUTPUT_DIR"
```

The script writes `proof.json` and a gzip JSON record into the output directory with private file permissions. `proof.json` stores SHA-256 digests for the input ledgers, each selected session copy, and the uncompressed record. It lists every skipped input and coverage gap.

The review manifest had 31 JSONL copies. Two pairs had the same recorded native session ID; in each pair the shorter copy was an exact byte prefix of the longer copy. The proof retains the longer copy and records that byte comparison. It rejects non-prefix conflicts and digest mismatches. The Pi directory is filtered by exact verdict IDs for this run; sessions assigned to other runs are listed as skipped.

The shared `@tangle-network/harness-sessions` reader parses every selected transcript. `fromHarnessSessions` projects it to record nodes and events. Parent edges use `parentNativeSessionId` only when that ID names one selected session. The claim ledger supplies the recorded page SHA and claim ID; the page cache bytes are checked against each SHA. A GLM verdict joins only when its ID is exactly `math-<claim ID>` and a Pi session has that same native ID. No review transcript is attached to a research agent by name, time, or text search.

## Observed output

At the checked inputs, the combined record passed `parseRecord` with 36 nodes (4 research agents, 27 Codex sessions, 2 Claude sessions, 3 Pi sessions), 42,699 events, 7 claims, 6 digest-verified claim pages, 3 verdicts, and 11 recorded session-parent edges. The JSON is 62,604,247 bytes before gzip. The Pi directory contained 11 other-run or unassigned session files, which are listed but not joined to this run.

The 96 explicit gaps are 55 messages without recorded time, 23 native-reader integrity gaps, and 18 review roots without a recorded parent link to the research run. The three Pi verdict sessions have exact claim links, so they are not counted as unjoined roots. The run's original coverage also says its output-parts capture is lossy. A graph may show these components together, but it must not draw provenance edges across these gaps.

The validated record also rendered through `AgentRecord` server rendering (7,348,340 HTML bytes; root and run marker present). Browser interaction and a served release require the shared graph consumer and its deployment evidence.
