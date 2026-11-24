# Security model

The protected client can use only the HTTP gateway's analyze_document tool. The gateway retrieves classification over private MCP stdio and fetches the body only after authorization. The downstream analyzer has no HTTP listener and records request IDs and timestamps. The gateway audit stores classification, version, policy decision, reason and delivery status.

Confidential data requires an enabled destination, approval for its current version and, under the default organization rule, verified no-training terms. Changed snapshots conservatively invalidate approval. Clause extraction provides evidence and cannot approve or override the rule. Administrator review uses a locally configured token and requires version-specific evidence. The verification checkbox is a human attestation of the applicable terms or account setting.

Run this MVP on loopback with a single worker. Treat OS access, the database and local operators as trusted. Stdio isolation controls remote tool visibility. It offers no isolation from an actor with access to the local database or process account. The simulator and reset routes require demo mode. Keep demo mode off when using real configuration. Only configure public policy URLs controlled by an administrator. The optional extraction endpoint receives policy excerpts.

Policy change and transfer are ordered by the in-process lock and, on PostgreSQL, a service row lock. A transfer already accepted before an observation commits can finish. A downstream timeout may leave delivery unknown. Analyzer delivery and gateway audit have separate database transactions. The MVP has no production identity, tenant isolation, delivery reconciliation or configurable routing to additional analyzers.
