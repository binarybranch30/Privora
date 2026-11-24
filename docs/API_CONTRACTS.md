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

Demo routes return 404 when demo mode is disabled. Administrative routes require X-Admin-Token matching POLICYGUARD_ADMIN_TOKEN. Stale version reviews return 409. To observe a real policy, seed the demo first in an isolated local database, disable demo mode, specify POLICY_SOURCE_URL and set a local admin token. Then call the monitor route and review the observed version.

The Streamable HTTP MCP endpoint is /mcp/. Its tool analyze_document takes document_id and destination_service. The result includes decision, reason, classification, policy_version, request_id, delivery, and optional simulated analysis. REVIEW_REQUIRED and BLOCK both prevent forwarding. ALLOW indicates authorization. Delivery reports whether the analyzer confirmed receipt.
