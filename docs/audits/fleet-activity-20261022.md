# Fleet activity blind audit

The third disjoint sample accepted **98/100** predictions against independently predeclared valid activity sets. Exact agreement with the preferred primary class was **89/100**. Compound calls can execute multiple meaningful activities; alternatives below were frozen before classifier predictions were run.

| Round | Exact preferred primary | Valid predeclared class | Result |
| --- | ---: | ---: | --- |
| First blind sample | 75/100 | 84/100 | Parsing defects; retained as development evidence |
| Second disjoint blind sample | 86/100 | 90/100 | Remote heredoc/target defects; retained as development evidence |
| Third disjoint blind sample | 89/100 | 98/100 | Two rejected predictions; nine valid secondary-class predictions |

Selection: deterministic seeded uniform shuffle over 716 unique native session/call IDs in Codex logs for 2026-10-22T12:00:00Z through 2026-10-22T18:40:00Z, all account roots deduplicated, excluding the fleet-time lane. The third sample used seed 20261024 and excluded both earlier samples (remaining population 516). Labels retain the exact reviewed inputs locally; public evidence omits transcripts, personal account identifiers and commands. Sampled inputs and frozen labels were unchanged; classifier fixes were made between disjoint rounds.

Frozen classifier SHA-256: `6b371b9fd1d31600c55073398d01d75061583248688ff84a254ae78b4fcfbbb0`.
Release classifier SHA-256: `535a5b09bef9629dbd44d06061f1d4e07af42c8d101f15d92db462937cc11931`. After the audit, two newly shipped fleet CLI operations were added: `fleet wait` is waiting; `fleet status set` is a status edit. Replaying the frozen third sample produced identical activity predictions (89 exact / 98 valid); those new commands do not occur in this historical sample. This is API support, not a new blind measurement.

Frozen third label SHA-256: `624764c730578a526ccf34dc6092df758afef8f13f32886523e072d1ed095f45`.

Inference limits: one batched tool call may read, query, wait and edit. The preferred-primary score measures the reviewer’s choice among those actions. The valid-class score measures whether the predicted activity was independently judged a meaningful action in that call. This is an activity audit, not validation of estimated cognitive timing or per-command duration allocation.

| Call | Tool | Preferred primary | Other valid classes | Predicted | Valid / exact | Reviewed operation |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | exec | edit files | git/PR write, waiting | edit files | PASS / PASS | Creates and runs a durable browser-test patch, commits/pushes it, and polls an unidentified session. |
| 2 | exec | git/PR write | query status | git/PR write | PASS / PASS | Creates local PR-body transport text and actually creates a draft GitHub PR, then reads gate progress. |
| 3 | exec | edit files | — | edit files | PASS / PASS | Python over SSH rewrites durable integration proof source and checks its diff. |
| 4 | exec | edit files | query status | edit files | PASS / PASS | Rewrites substantive durable evidence index HTML and reads browser-gate progress. |
| 5 | exec | analysis script | — | analysis script | PASS / PASS | Downloads Debian release/key metadata, hashes it into receipts, and converts downloaded public keys for verification; no system install. |
| 6 | exec | read code/files | query status | query status | PASS / FAIL | Reads/searches default-branch usage source and invokes have to discover relevant owner surfaces. |
| 7 | exec | query status | — | query status | PASS / PASS | Checks runtime cache size, generated artifact names, and renderer stderr logs. |
| 8 | exec | query status | analysis script | analysis script | PASS / FAIL | Reads a gate log and inspects current canary process/result-file state through proc over SSH. |
| 9 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 10 | exec | read code/files | — | read code/files | PASS / PASS | Reads a source diff and searches markup implementation references. |
| 11 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 12 | exec | edit files | other tool | edit files | PASS / PASS | Patches durable cleanup source, renames its old log, and launches that script; its full implementation is not supplied in this call. |
| 13 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 14 | exec | edit files | — | edit files | PASS / PASS | Python over SSH rewrites integration scenario status/header assertions and checks its diff; assertions are not run. |
| 15 | exec | edit files | — | edit files | PASS / PASS | Python rewrites durable pricing records and implementation source across several files, then reads diffs. |
| 16 | exec | read code/files | — | read code/files | PASS / PASS | Reads canary/profile API source and discovers workspace route paths. |
| 17 | exec | read code/files | — | read code/files | PASS / PASS | Reads measurement/brand source and a fixture hash file. |
| 18 | exec | messaging | analysis script, waiting | messaging | PASS / PASS | Builds generated verification receipts and a message payload, then actually sends it with fleet send; also polls an unidentified session. |
| 19 | exec | read code/files | — | read code/files | PASS / PASS | Reads repository instructions and integration harness implementation source, and lists instruction directories. |
| 20 | exec | waiting | query status | waiting | PASS / PASS | Polls session 13765 for30seconds and extracts current gate summary lines; no supplied origin proves its action. |
| 21 | exec | query status | analysis script | edit files | FAIL / FAIL | GETs existing assets/persistence/workspace state and agent scorecard, retaining responses and reading export counts/errors. |
| 22 | exec | read code/files | waiting | read code/files | PASS / PASS | Reads Blender source and existing PR text, then polls an unidentified session. |
| 23 | exec | query status | analysis script | query status | PASS / PASS | Parses and tails gate output for phase/test results; no test or build is started. |
| 24 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 25 | exec | read code/files | — | read code/files | PASS / PASS | Reads/searches timer, background-job, deployment, and proof source; those operations are not invoked. |
| 26 | exec | query status | read code/files | read code/files | PASS / FAIL | Reads integration progress and repository revision/status/diff statistics and file counts. |
| 27 | exec | edit files | — | edit files | PASS / PASS | Python extends a durable browser proof script, then checks syntax/diff; inserted browser/DB operations remain unexecuted source. |
| 28 | exec | read code/files | — | read code/files | PASS / PASS | Reads cleanup/operator scripts and instructions, and lists owner tool paths. |
| 29 | exec | edit files | — | edit files | PASS / PASS | Creates and executes a patch that rewrites creative renderer/browser/assembly source. |
| 30 | exec | read code/files | query status | read code/files | PASS / PASS | Reads renderer differences and source ranges plus repository/tool metadata. |
| 31 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 32 | exec | query status | waiting | query status | PASS / PASS | Reads current integration-gate progress and polls an unidentified session for1second. |
| 33 | exec | read code/files | — | read code/files | PASS / PASS | Reads provider identity source and searches existing pricing/calculator evidence. |
| 34 | exec | analysis script | read code/files | read code/files | PASS / FAIL | Projects keys and measured text fields from retained fixture JSON, then discovers fixture evidence paths. |
| 35 | exec | read code/files | query status | query status | PASS / FAIL | Reads the plan and repository instructions, alongside git identity/status/revision queries. |
| 36 | exec | edit files | — | edit files | PASS / PASS | Python over SSH rewrites durable integration pricing admission source and reads its diff. |
| 37 | exec | analysis script | — | analysis script | PASS / PASS | Computes raster polygon/logo distances and area shares in memory from an existing image; no durable code edit. |
| 38 | exec | query status | — | query status | PASS / PASS | Reads integration-gate progress and enumerates generated JSON artifacts. |
| 39 | exec | read code/files | — | read code/files | PASS / PASS | Reads renderer/browser implementation and existing browser test source. |
| 40 | exec | read code/files | waiting | waiting | PASS / FAIL | Views an existing image and polls an unidentified session. |
| 41 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 42 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 43 | exec | read code/files | waiting | read code/files | PASS / PASS | Searches existing plan/review Markdown after polling an unidentified session. |
| 44 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 45 | exec | read code/files | — | read code/files | PASS / PASS | Reads/searches provider credential and pricing implementation source. |
| 46 | exec | gate/test | read code/files | gate/test | PASS / PASS | Starts an explicit real-browser Vitest integration gate, then reads existing STATUS.md. |
| 47 | exec | query status | — | query status | PASS / PASS | Reads integration progress and checks generated evidence names/cache size. |
| 48 | exec | read code/files | — | read code/files | PASS / PASS | Reads measurement/code/brand source and an existing rendered fixture. |
| 49 | exec | read code/files | query status | read code/files | PASS / PASS | Reads default-branch image preview implementation plus local component/test source. |
| 50 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 51 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 52 | exec | read code/files | waiting | read code/files | PASS / PASS | Reads/searches default-branch operator/usage/evaluation source and polls an unidentified session. |
| 53 | exec | read code/files | — | read code/files | PASS / PASS | Reads measurement, renderer CLI, and review source. |
| 54 | exec | analysis script | read code/files | read code/files | PASS / FAIL | Searches remote retained files and parses a prior transcript to extract matching historical tool inputs; those historical calls are not executed. |
| 55 | exec | read code/files | — | read code/files | PASS / PASS | Reads a retained comparison report and lists its evidence files. |
| 56 | exec | edit files | query status | edit files | PASS / PASS | Rewrites substantive durable status documentation, then appends an owner skill-run status record. |
| 57 | exec | waiting | — | waiting | PASS / PASS | Only polls a numbered session; its originating action is not established. |
| 58 | exec | edit files | other tool, read code/files | edit files | PASS / PASS | Creates revised durable client/snapshot/export helper source and launches a snapshot script, then reads owner route/tool source. |
| 59 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 60 | exec | read code/files | — | read code/files | PASS / PASS | Reads test/component/brand source and searches image preview implementation. |
| 61 | exec | edit files | git/PR write | edit files | PASS / PASS | Creates and executes a durable renderer patch, then commits and pushes it. |
| 62 | exec | read code/files | — | read code/files | PASS / PASS | Reads runtime receipts, tool help, deployment configuration, and operations instructions. |
| 63 | exec | edit files | messaging | edit files | PASS / PASS | Substantively rewrites an existing attribution JSON document and actually invokes fleet send through Python subprocess. |
| 64 | exec | waiting | — | waiting | PASS / PASS | Only polls an unidentified numbered session. |
| 65 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 66 | exec | read code/files | — | read code/files | PASS / PASS | Reads branch source differences and critical-audit instructions. |
| 67 | exec | other tool | read code/files | read code/files | PASS / FAIL | Launches an existing export.mjs via unattended; its body is not supplied, so do not infer its API/mutation behavior from the filename. Also inspects git paths/source. |
| 68 | exec | query status | waiting | query status | PASS / PASS | Reads current verification phase/result lines and polls two unidentified sessions for1second each. |
| 69 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 70 | exec | read code/files | — | read code/files | PASS / PASS | Reads component/documentation differences and the component source. |
| 71 | exec | read code/files | query status | read code/files | PASS / PASS | Searches creative implementation/test source and reads fixtures plus tool/repository metadata. |
| 72 | exec | edit files | — | edit files | PASS / PASS | An SSH heredoc writes durable integration scenario source; its HTTP/DB/test operations are quoted code, not executed. |
| 73 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 74 | exec | read code/files | — | read code/files | PASS / PASS | Reads repository guidance, proof/UI source, package metadata, and fixture paths. |
| 75 | exec | read code/files | waiting | query status | FAIL / FAIL | Searches existing browser test shader source and polls an unidentified session. |
| 76 | exec | read code/files | — | read code/files | PASS / PASS | Reads provider identity implementation and pricing JSON ranges. |
| 77 | exec | read code/files | query status, analysis script | analysis script | PASS / FAIL | Fetches official CPython source and prints matching implementation lines, then reads integration progress. |
| 78 | exec | query status | waiting | query status | PASS / PASS | Lists renderer output artifacts, reads stderr logs, and polls an unidentified session. |
| 79 | exec | query status | read code/files, waiting | query status | PASS / PASS | Reads integration-gate and git status/diff statistics alongside a1second unidentified-session poll. |
| 80 | exec | edit files | — | edit files | PASS / PASS | An SSH heredoc creates durable provider-peer integration source; it does not start that peer or execute its quoted HTTP behavior. |
| 81 | exec | query status | — | query status | PASS / PASS | Reads integration progress and lists produced provenance files. |
| 82 | exec | edit files | query status | edit files | PASS / PASS | Rewrites existing PR text and substantive durable STATUS.md, then reads a gate log. |
| 83 | exec | analysis script | query status | analysis script | PASS / PASS | Computes retained image-reference existence and extracts historical crop tool records into generated gap evidence, then projects cleanup status. |
| 84 | exec | read code/files | — | read code/files | PASS / PASS | Reads existing beelink-gate implementation slices. |
| 85 | exec | edit files | analysis script | edit files | PASS / PASS | Creates/runs a temporary evidence-retention script and copies artifacts, then separately rewrites substantive durable STATUS.md. |
| 86 | exec | read code/files | — | read code/files | PASS / PASS | Reads proof source and architecture/product/token documentation. |
| 87 | exec | edit files | analysis script, query status | edit files | PASS / PASS | Computes qualification/manifest evidence, substantively changes durable index HTML, and logs owner task status. |
| 88 | exec | query status | waiting | query status | PASS / PASS | GETs existing PRs associated with a commit and polls an unidentified session. |
| 89 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 90 | exec | edit files | — | edit files | PASS / PASS | Python over SSH rewrites durable candidate grant proof source and reads/checks its diff. |
| 91 | exec | read code/files | — | read code/files | PASS / PASS | Reads credit/schema implementation and searches immutable-price migration source. |
| 92 | exec | read code/files | query status | read code/files | PASS / PASS | Reads integration test source and git status; no tests are executed. |
| 93 | exec | waiting | — | waiting | PASS / PASS | Only waits30seconds on an unidentified numbered session. |
| 94 | exec | waiting | — | waiting | PASS / PASS | Only polls an unidentified numbered session. |
| 95 | exec | read code/files | — | read code/files | PASS / PASS | Reads AI/provider source and searches existing pricing scenario source. |
| 96 | exec | read code/files | — | read code/files | PASS / PASS | Runs Wrangler versions view --help through Node; no version state is changed or production request inferred. |
| 97 | exec | read code/files | — | read code/files | PASS / PASS | Searches fixture/provenance and CLI authorization source and reads review implementation. |
| 98 | send_message | subagents | — | subagents | PASS / PASS | Collaboration send_message targets another agent. |
| 99 | exec | read code/files | — | read code/files | PASS / PASS | Searches installed Wrangler source for logging environment options. |
| 100 | exec | edit files | — | edit files | PASS / PASS | Python over SSH rewrites durable integration environment/listing source and reads/checks its diff. |

The two rejected predictions (21 and 75) remain visible above. Audit replay uses the maintained `agent-record-ingest <home> --activity --since ISO --out FILE --audit LABELS.json` entrypoint, which reports exact and accepted counts separately.
