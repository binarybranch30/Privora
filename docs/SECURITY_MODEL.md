# Security model

The protected client can use only the HTTP gateway's analyze_document tool. The gateway retrieves classification over private MCP stdio and fetches the body only after authorization. The downstream analyzer has no HTTP listener and records request IDs and timestamps. The gateway audit stores classification, version, policy decision, reason and delivery status.

Confidential data requires an enabled destination, approval for its current version and, under the default organization rule, verified no-training terms. Changed snapshots conservatively invalidate approval. Clause extraction provides evidence and cannot approve or override the rule. Administrator review uses a locally configured token and requires version-specific evidence. The verification checkbox is a human attestation of the applicable terms or account setting.

Run this MVP on loopback with a single worker. Treat OS access, the database and local operators as trusted. Stdio isolation controls remote tool visibility. It offers no isolation from an actor with access to the local database or process account. The simulator and reset routes require demo mode. Keep demo mode off when using real configuration. Only configure public policy URLs controlled by an administrator. The optional extraction endpoint receives policy excerpts.

Policy change and transfer are ordered by the in-process lock and, on PostgreSQL, a service row lock. A transfer already accepted before an observation commits can finish. A downstream timeout may leave delivery unknown. Analyzer delivery and gateway audit have separate database transactions. The MVP has no production identity, tenant isolation, delivery reconciliation or configurable routing to additional analyzers.

## Live boundary

Live requires a database marker. The Demo instance refuses a Live database. Scoped database roles can only connect to their own database. Keep the migration account and host OS trusted. The dashboard uses a short-lived, HTTP-only, same-site cookie for Live routes and a custom mutation header. A distinct bearer credential protects the Live MCP endpoint. This setup assumes loopback and one worker per instance.

The HTTP fetcher restricts HTTPS hosts, pins the connection to a validated public IP while preserving TLS hostname verification, and rechecks redirected destinations. It respects robots.txt and bounds fetch time and decoded content. Failed or stale observations block confidential transfers. Historical imports and model interpretations cannot grant access. Human reviews verify account applicability and no-training conditions for the exact policy version.

Only the designated GitHub repository, registered text path and commit SHA can enter the connector flow. The connector validates the exact returned resource URI and rejects links or unsupported results. Protected body text goes to the approved local analyzer process. Operator trust extends to the official connector binary, GitHub credentials, resource classifications and evidence, and the configured local analyzer. Audit and model extraction do not receive repository bodies. This is a local MVP security boundary.

## Phase 3 boundaries

The fictional monitored analyzer is available only when explicitly configured. Normal Live HTTPS requests still enforce a public address, TLS verification, exact hostname allowlists, and redirect validation. The optional fixture trust exception applies to one operator-configured HTTPS 127.0.0.1 port and /privacy path, with the supplied development certificate and no redirects. Keep the fixture private key outside the project and avoid reusing its trust configuration elsewhere.

The gateway resolves resource classification and the workflow before retrieving any body. A scoped observed drift event suspends confidential permission and leaves public workflows eligible under the organization rule. A separate administrator hold retains its existing behavior. Model output cannot authorize transfers or mark a change cosmetic. The monitored fixture uses deterministic extraction. Historical review candidates are earlier deliveries for review under applicable terms, with no finding of unauthorized disclosure.
