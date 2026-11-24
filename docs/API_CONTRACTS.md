# API contracts

| Method and path | Result |
| --- | --- |
| GET /api/health | Database connectivity and demo-mode flag |
| GET /api/services | Destination policy state, currently observed version and last check |
| GET /api/policies/versions | Latest 100 policy texts, digests and sources |
| GET /api/policies/changes | Latest 100 evidence records, including old and new version IDs |
| GET /api/audit | Latest 100 MCP decisions and delivery states |
| POST /api/demo/reset | Clears demo state and seeds approved v1 |
| POST /api/demo/simulate-policy-change | Introduces synthetic v2 through the monitor |
| POST /api/demo/analyze | Accepts document_id and sends an SDK request to the gateway |
| GET /api/demo/receipts | Total analyzer receipts and up to 100 request IDs |
| POST /api/admin/services/external_analyzer/monitor | Observes the server-configured POLICY_SOURCE_URL |
| POST /api/admin/services/external_analyzer/review | Accepts version, verified_no_training and evidence |

Demo routes return 404 when demo mode is disabled. Administrative routes require X-Admin-Token matching PRIVORA_ADMIN_TOKEN. Stale version reviews return 409. To observe a real policy, seed the demo first in an isolated local database, disable demo mode, specify POLICY_SOURCE_URL and set a local admin token. Then call the monitor route and review the observed version.

The Streamable HTTP MCP endpoint is /mcp/. Its tool analyze_document takes document_id and destination_service. The result includes decision, reason, classification, policy_version, request_id, delivery, and optional simulated analysis. REVIEW_REQUIRED and BLOCK both prevent forwarding. ALLOW indicates authorization. Delivery reports whether the analyzer confirmed receipt.

## Phase 2 Live endpoints

The dashboard proxies /api/live to the Live backend on port 8001. The following paths are relative to the dashboard prefix. On the backend, use the /api prefix. Live mutations require the X-Privora-Live: 1 header and a valid Live session after login.

| Method and route | Purpose |
| --- | --- |
| POST /session | Admin secret exchange for short-lived cookie |
| DELETE /session | End the current Live session |
| GET /dashboard | Live service status, history, changes, resources, and audit |
| POST /services | Register id, name and allowlisted policy URL |
| POST /services/{id}/refresh | Fetch and observe policy for that service |
| POST /services/{id}/review | Record version-specific applicability, agreement evidence, opt-out status and no-training verification |
| POST /resources | Register resource ID, GitHub policy service ID, text path, commit SHA and classification |

Live MCP is http://localhost:8001/mcp/ with a separate bearer credential. The sole tool accepts document_id and destination_service. Use the registered resource ID and local_analyzer as destination. Source and destination evidence are stored in audit. The Live backend implements no demo reset or synthetic policy mutations.

## Phase 3 Live endpoints

| Method and route | Authentication | Result and failures |
| --- | --- | --- |
| GET /policy-changes/{id}/impact | Live admin session | Returns policy URLs and versions, evidence, workflow decisions, calculated counts, and dated history. Returns 404 for an unknown change and 401 without a session. |
| POST /workflows | Live admin session and mutation header | Accepts resource_id and destination fictional_analyzer. Returns the workflow ID. Returns 404 for an unknown resource, 409 for an existing binding or disabled fixture, and 422 for invalid input. |

Use existing /services/{id}/refresh and /services/{id}/review endpoints for the monitored analyzer. A review for a superseded version returns 409. Dashboard audit includes workflow_id, policy_change_id and decision_origin where recorded. Historical counts cover matching allowed transfers on the superseded version before the change. Candidate history narrows this to received confidential transfers and includes up to 25 example request IDs per workflow.
