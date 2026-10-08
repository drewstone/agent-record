# Agent-record domain language

- **Record**: one reviewable set of agent nodes, events and evidence references. A record can represent a Runtime run or a bundle of sessions. _Avoid_: trace, which names the underlying execution spans.
- **Session**: one native harness conversation, identified by its recorded harness and native session ID. A session is not an additional agent merely because it has a separate file. _Avoid_: worker when no execution identity proves that role.
- **Claim**: a distinct statement on a knowledge page, identified by the page SHA-256 and the claim ID recorded on that page. _Avoid_: finding when referring to a precise statement.
- **Verdict**: a recorded review of one precise claim by an identified reviewer session. Its judgment is the reviewer's statement, not a property of the claim itself. _Avoid_: validation when the review does not prove correctness.
- **Publication**: a site entry or other release that cites recorded claims and, when known, verdicts. The research-publication bundle remains the container for all harness evidence behind it. _Avoid_: bundle for a single site entry.
- **Profile version**: a content-addressed agent profile, with recorded parent digests and optional run or author references. _Avoid_: run version, which is a different axis.
