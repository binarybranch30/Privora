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
| GET /api/demo/policy-changes/{id}/impact | Read-only impact of a synthetic Demo observation on the supported confidential and public routes |
| POST /api/admin/services/external_analyzer/monitor | Observes the server-configured POLICY_SOURCE_URL |
| POST /api/admin/services/external_analyzer/review | Accepts version, verified_no_training and evidence |

Demo routes return 404 when demo mode is disabled. Administrative routes require X-Admin-Token matching PRIVORA_ADMIN_TOKEN. Stale version reviews return 409. To observe a real policy, seed the demo first in an isolated local database, disable demo mode, specify POLICY_SOURCE_URL and set a local admin token. Then call the monitor route and review the observed version.

Demo impact uses the same response shape as Live impact and evaluates the supported routes with the same deterministic evaluator used by the Demo gateway. Historical candidates are prior confidential deliveries under the superseded version that have a persisted analyzer receipt. Demo audit identifies these by classification, operation, and destination. The endpoint does not assign historical receipts to individual document IDs.

The Streamable HTTP MCP endpoint is /mcp/. Its tool analyze_document takes document_id and destination_service. The result includes decision, reason, classification, policy_version, request_id, delivery, and optional simulated analysis. REVIEW_REQUIRED and BLOCK both prevent forwarding. ALLOW indicates authorization. Delivery reports whether the analyzer confirmed receipt.

## Phase 2 Live endpoints

The dashboard proxies /api/live to the Live backend on port 8001. The following paths are relative to the dashboard prefix. On the backend, use the /api prefix. Live mutations require the X-Privora-Live: 1 header and a valid Live session after login.

| Method and route | Purpose |
| --- | --- |
| POST /session | Admin secret exchange for short-lived cookie |
| DELETE /session | End the current Live session |
| GET /dashboard | Live service status, history, changes, resources, configured workflows, and audit |
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

The authenticated dashboard includes workflow bindings even before their first transfer. Each reports the resource, source, destination, operation, classification, organization rule, account scope, policy versions, evaluation timestamp, decision, reason, origin, and linked policy change when applicable. This read-only evaluation uses the gateway's decision function and creates no audit records or downstream receipts.

## Protected synthetic queue

| Endpoint or tool | Contract |
| --- | --- |
| GET /protection | Live admin session. Returns feature availability, the latest session, recent policy evidence from that session, and jobs/items with joined audit and receiver receipts. |
| POST /protection/session | Live admin session and mutation header. Requires the opt-in fixture, a fresh approved destination policy, and at least one eligible confidential fixture route. Starting again returns the active session. |
| DELETE /protection/session | Live admin session and mutation header. Stops the session and cancels queued items. A transfer already admitted may finish. |
| MCP `submit_protected_job` | Existing Live bearer credential. Accepts the session UUID, a client job UUID, and 1–50 allowlisted registered fixture IDs. Repeating the same UUID and payload returns the same job; changing its payload fails. The tool is absent when disabled. |

Queue results report analyzer-confirmed bytes and files from persisted receipts. The private analyzer records byte counts for queue items only. A claimed request without recoverable evidence reports unknown delivery and is never automatically resubmitted. Polling this API does not perform policy refreshes or transfers.

With Analyzer B configured, the admin rehearsal launcher invokes the MCP tool `submit_rehearsal_lanes` with a session-scoped launch token. The server selects three configured resource and destination pairs, confirms trusted classifications and independent approvals, then commits the lanes together. The protected snapshot includes each lane's destination, current state, receipt identities, and an incident summary when Analyzer A's change invalidates approval. Summary counts distinguish files held in the queue, explicit gateway denials, and confirmed deliveries after the observation.
