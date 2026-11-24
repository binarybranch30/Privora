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
