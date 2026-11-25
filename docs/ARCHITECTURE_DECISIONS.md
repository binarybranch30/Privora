# Architecture decisions

## Phase 2 · Approved 2026-11-24

- Run Demo and Live as two processes from one codebase, with separate PostgreSQL databases and scoped roles, settings, and loopback endpoints. Keep the existing SDK, Streamable HTTP gateway, and deterministic engine. Compared with row partitioning, the database boundary lowers reset and query leakage risk. Separate PostgreSQL servers add setup overhead.
- Use direct HTTPS observation and pinned Open Terms Archive release datasets. Only direct observations affect enforcement. Use additive migrations and schedule checks in the Live instance. Collection APIs and a separate queue can be revisited when needed.
- Use the official GitHub MCP server over private stdio with read-only file access and an explicit repository and resource allowlist. Send approved content to a local controlled analyzer. The hosted connector would simplify setup but give the gateway less control over the connector process.
- Live begins without inherited approvals. Session-authenticated Live dashboard operations and separately authenticated MCP requests use distinct credentials. LLM assistance receives public policy excerpts and cannot decide transfers.

Approval was provided in the project conversation following the Phase 2 proposal.

## Phase 3 · Approved 2026-11-24

- Bind a separate fictional, monitored analyzer destination to the existing local analyzer MCP process. Keep the original destination and transport for compatibility. This separates GitHub source terms from destination terms without adding another analyzer.
- On a relevant or ambiguous observed change, invalidate confidential approval transactionally. Carry approval forward only for narrowly recognized cosmetic edits. Distinguish policy drift from administrator review, and keep eligible public paths available when only confidential terms are in question.
- Use a controlled public HTTPS fixture when available. Otherwise permit one operator-configured loopback HTTPS policy path with a dedicated trust certificate and no redirects. Keep the public-source SSRF boundary.
- Store explicit Live workflow bindings and provenance links with an additive migration. Compute blast radius on demand using the existing deterministic gate and persisted audit. Keep historical records intact and label earlier deliveries as review candidates.

The user explicitly approved these four decisions in the project conversation.

## Investigation UI · Approved

- Render the network from stored workflow bindings and use the existing deterministic evaluator for a read-only decision snapshot in the authenticated Live dashboard response. Keep authorization decisions, recorded events, and analyzer delivery separate.
- Share the investigation shell across environments. Demo uses its synthetic fixture paths and real gateway outcomes. Live impact remains change-scoped and uses the existing impact API.

## Always-on transfer protection · Approved

- Add an opt-in, single-worker Live queue for explicitly allowlisted synthetic resource IDs bound to the controlled analyzer. Queue items enter the same locked per-document evaluator and forwarding path as direct MCP calls. An item admitted before observation commits may complete.
- Persist session, job and item IDs in Live storage. Receiver bytes are nullable on older receipts. Restart reconciliation uses the original request ID and never resends a claimed item with an uncertain outcome.
- During a protected session, observe only the dedicated fictional HTTPS fixture at the shorter cadence. Keep the existing HTTPS validation, approval rules, and ordinary source schedule. Use authenticated polling for UI progress.
- Keep the unprotected comparison in a standalone loopback process with internally generated data. It has no Live inputs, connector, database or forwarding endpoint. Chunked transfer and partial-file staging are outside this design.

## One-click protected rehearsal

- Enable the launcher only in the opt-in Live rehearsal configuration with a designated, allowlisted confidential fixture and a bounded batch.
- Use the existing admin mutation boundary to start the rehearsal. Use the separately authenticated loopback MCP endpoint to submit the server-configured job. Keep the MCP credential server-side and derive the job ID from the active session for retries.
- Keep the existing HTTPS observer, per-document authorization, receipt model, and separate Live database. Browser progress reads use the existing authenticated protection snapshot.

- Dashboard-launched synthetic batches hold unclaimed files during policy conflict or observation failure. After a fresh HTTPS observation of the same source and exact reviewed starting content, only the synthetic batch can use its starting approval. The per-file decision still checks source approval and organization rules. The persisted service approval and ordinary Live MCP behavior are unchanged.

## Three-lane rehearsal · Approved

- Provision Analyzer B as an independent monitored service with a separate loopback HTTPS policy. Reuse the controlled receiver code with its identity pinned by the gateway at process launch. Persist receiver identity for new receipts and leave older receipts intact.
- Use an additive Live queue migration for lane, destination, and starting revision. An authenticated admin launch uses a session-scoped token to submit all three configured lanes atomically through MCP. The single worker interleaves whole files and skips a held lane while the other lanes remain eligible.
- Aggregate incident evidence by observed change, persisted lane, and identified receiver receipt. Report waiting holds separately from explicit gateway denials. Count post-observation deliveries only when receipts confirm them.
