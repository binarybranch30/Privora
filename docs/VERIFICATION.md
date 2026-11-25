# Verification

Verified locally on Windows with Python 3.12.10, MCP SDK 1.30.0, PostgreSQL 17, Node 24.19.0 and Next.js 16.4.6.

| Command | Observed result |
| --- | --- |
| uv sync --python 3.12 | Installed the backend and test dependencies |
| npm.cmd install --prefix frontend --prefer-offline --no-audit --no-fund --fetch-retries=1 | Installed frontend dependencies and produced the lockfile |
| docker compose up -d --wait | PostgreSQL healthy on 127.0.0.1:55439 |
| uv run alembic upgrade head | Installed schema revision 90e57e9cadb9 |
| uv run alembic current | Reported 90e57e9cadb9 at head |
| uv run alembic check | No upgrade operations pending |
| uv run pytest -q | 3 passed using isolated SQLite files |
| docker compose exec -T db createdb -U policyguard policyguard_test | Created dedicated PostgreSQL test database |
| uv run pytest -q with TEST_DATABASE_URL=postgresql+psycopg://policyguard:policyguard@127.0.0.1:55439/policyguard_test | 3 passed on PostgreSQL |
| npm.cmd --prefix frontend run lint | Passed without warnings after correcting PostCSS export |
| npm.cmd --prefix frontend run build | Production build and TypeScript checks passed |
| uv run uvicorn privora.api:app --host 127.0.0.1 --port 8000 | Started the API and MCP gateway |
| uv run python -m scripts.verify_demo | Proved the live MCP transition and checked persisted versions, clause evidence, and audit |
| npm.cmd --prefix frontend run start -- --hostname 127.0.0.1 | Dashboard returned HTTP 200 on port 3000 |
| uv lock --check | Backend lockfile current |

Both the live CLI sequence and an HTTP smoke test through the dashboard's Next.js API proxy produced the following results.

| Transfer | Policy | Decision | Delivery | Total analyzer receipts |
| --- | --- | --- | --- | --- |
| confidential_001 | v1 | ALLOW | RECEIVED | 1 |
| confidential_001 again | v2 | REVIEW_REQUIRED | NOT_SENT | 1 |
| public_001 | v2 | ALLOW | RECEIVED | 2 |

The first Compose start found port 55432 in use by another project. Privora uses 55439. Initial integration failures exposed an SDK host validation error and an untyped downstream response. The final tests used a loopback host with a port and explicit Pydantic response models. The live PostgreSQL setup uses an IPv4 loopback address after localhost connection delays.

Browser visual and click verification was blocked by the computer-use runtime. The dashboard HTTP response and the actual API routes behind all four demo actions were verified. The optional real LLM and live policy URL were not exercised. GitHub Actions is configured and was not run remotely.

## Phase 2

| Command or check | Observed result |
| --- | --- |
| uv run python -m privora.live_setup migrate | Provisioned separate Live PostgreSQL storage with both additive migrations |
| uv run pytest -q | 8 passed with SQLite |
| uv run pytest -q with TEST_DATABASE_URL and TEST_LIVE_DATABASE_URL pointing to dedicated PostgreSQL test databases | 8 passed with PostgreSQL |
| npm.cmd --prefix frontend run lint | Passed |
| npm.cmd --prefix frontend run build | Passed |
| uv run python -m scripts.verify_demo | Demo receipts still progressed 1, 1, 2 |
| Live refresh for the GitHub General Privacy Statement, twice | Real HTTPS fetch succeeded. First run stored v1. Second returned v1 unchanged. |
| uv run python -m privora.live_setup import-archive apple with the published France release dated 2026-11-23 | Imported 11 Apple privacy-policy versions with original archive timestamps |
| uv run python -m privora.live_client unregistered | Real authenticated MCP request returned BLOCK / UNKNOWN_DOCUMENT / NOT_SENT |
| Official GitHub MCP v2.2.0 started over stdio with --read-only --tools get_file_contents stdio | Real SDK session initialized and reported one tool, get_file_contents |
| HTTP requests through the running Next.js backend | Verified both mode routes, Live login and logout, absence of Live reset, and no Live state change from Demo reset |
| PostgreSQL cross-mode access | Both scoped roles were denied when connecting to the other database |

The automated Live transfer test mocks GitHub repository file retrieval and uses real gateway MCP messages and a real local stdio analyzer. It checks unknown applicability, fetch failure and policy drift, and confirms denied transfers neither read the file nor create a receipt. Browser interaction was not verified in Phase 2.

## Credentialed GitHub Live transfer

The authorized GitHub fixture `binarybranch30/policyguard-live-fixture` supplied `test.txt` at commit `38781134d2a78734278e7eee8f74f1fefaab8e80`. The official GitHub MCP server v2.2.0 used the scoped credential and the registered resource ID `github_synthetic_fixture`. The administrator classified the synthetic fixture as PUBLIC. This check did not attest GitHub account terms for confidential transfers.

Both calls used the real Live Streamable HTTP MCP endpoint and the same tool arguments. GitHub's privacy statement refreshed successfully and remained at v1. The destination was the local controlled word-count analyzer under its version 1 handling profile.

| Analyzer approval | Decision and delivery | Reason | Request ID | Receipts |
| --- | --- | --- | --- | --- |
| Approved | ALLOW / RECEIVED | PUBLIC_TRANSFER_ALLOWED | `701f4abb-4127-427c-88a1-c1d46c728d7f` | 1 |
| Held for review | REVIEW_REQUIRED / NOT_SENT | DESTINATION_PROFILE_UNAPPROVED | `5767dab4-fb46-424e-b8c4-0388cdd91d02` | 1 |

The local analyzer counted six words for the allowed request. The request had a persisted analyzer receipt. The held request had no receipt for its ID and no analysis result. Both records were verified through the running dashboard's Live API and against PostgreSQL. Neither request appeared in the Demo audit. Analyzer approval was restored after the test.

The separate automated confidential-flow test uses a mocked GitHub file read with the real MCP gateway and analyzer. It verifies that unknown applicability and policy changes block forwarding. The credentialed workflow above used no mocked file read. The optional model API remains unverified.

## Phase 3 automatic drift and blast radius

- `uv run pytest -q` passed 11 tests with SQLite. The PostgreSQL run also passed 11 tests using dedicated databases for the Phase 2 regression and the mock-HTTP and trusted-HTTPS Phase 3 cases. The new PostgreSQL migration is 3fb3e06f3d14.
- `npm.cmd --prefix frontend run lint` and `npm.cmd --prefix frontend run build` passed.
- The automated Phase 3 scenario uses genuine MCP calls to the Live gateway and the local analyzer. One variant uses mocked HTTP. The second uses the actual serving process implementation on loopback with TLS and a trusted development certificate. Both use a mocked GitHub file read. On v1 the confidential transfer was delivered. A normal refresh detected v2 and committed the automatic restriction. The same request returned REVIEW_REQUIRED / AI_TRAINING_CONFLICT / NOT_SENT without restarting the gateway, invoking the connector again, or adding a receipt. Public and unrelated workflows were allowed. The impact API reported one affected and restricted workflow, one unaffected workflow, and one historical review candidate, backed by the request ID for the prior delivery.
- In the running Live environment, the real fetcher retrieved GitHub's policy and the loopback HTTPS fixture. The fictional analyzer observed v1. After its v1 review, the official credentialed GitHub connector transferred test.txt through workflow 2 to the monitored analyzer. The analyzer returned six words and PostgreSQL recorded receipt 0c90e038-bfaf-4716-92d8-bc6bf79ba8ca. The trusted classification for this credentialed check was PUBLIC.
- At the end of the initial Phase 3 pass, the distinct confidential fixture was committed locally as 3861e1cdf2b131c6bece049115215fe1f0ebf76f and the fictional destination was left at approved v1. The subsequent real run is recorded below.

## Final credentialed confidential run

The one-line fixture contains exclusively fictional project text. After explicit authorization, only commit `3861e1cdf2b131c6bece049115215fe1f0ebf76f` was pushed to `binarybranch30/policyguard-live-fixture` on `main`. The operator attested that the applicable GitHub account terms or settings satisfy the no-training rule. The real GitHub policy refresh returned v1 unchanged. The source review recorded the operator's attestation. The allowlisted official GitHub MCP server v2.2.0 used the existing read-only credential.

Resource `github_confidential_fixture` was registered as CONFIDENTIAL with workflow 4 to `fictional_analyzer`. The Live MCP session used identical arguments for the first two rows. After the first call, only the fictional HTTPS fixture state changed. The ordinary authenticated refresh observed v2 and automatically invalidated the analyzer approval. There were no manual destination review writes in this run. The gateway stayed at PID 34332.

| Request | Analyzer policy | Decision and delivery | Reason | Request ID | Total receipts |
| --- | --- | --- | --- | --- | --- |
| Confidential fixture | v1 | ALLOW / RECEIVED | POLICY_APPROVED | `c786181a-7eaf-41ab-91df-6da860c770ef` | 3 |
| Identical confidential retry | v2 | REVIEW_REQUIRED / NOT_SENT | AI_TRAINING_CONFLICT | `874c30ad-7f2c-461f-88ad-e00bfd2f805e` | 3 |
| Public control | v2 | ALLOW / RECEIVED | PUBLIC_TRANSFER_ALLOWED | `3e8818ac-a01b-4c6b-bab4-a9efb2e1414b` | 4 |

The pre-run total was 2. PostgreSQL held a receipt for the nine-word confidential delivery and none for its retry. The retry returned no analysis. The public delivery counted six words. All three request IDs were visible through the Live dashboard API, and none appeared in Demo audit.

Live impact for change 4 returned one affected and restricted workflow, one unaffected workflow, and one historical review candidate. The candidate links to the v1 confidential delivery above. The audit identified the retry's decision origin as POLICY_DRIFT and linked change 4. The fixture uses genuine HTTPS with a trusted development certificate and fictional terms. The file reads used real GitHub MCP and the analyzer ran locally. There were no mocks in this run.

Browser inspection reached the existing dashboard tab, then computer use was stopped with Escape. A full interaction pass was not completed. Use the browser checklist in [FINAL_DEMO_RUNBOOK.md](FINAL_DEMO_RUNBOOK.md). The fixture remains on v2 for evidence inspection.

Final checks passed with 11 tests on SQLite and 11 on dedicated PostgreSQL test databases, including the real TLS fixture and MCP integration cases. Frontend lint and production build passed. Through the running dashboard proxy, an unchanged fixture refresh stayed at v2, an intentionally unavailable fixture surfaced FETCH_FAILED without changing the version or review state, and the recovered fixture still returned v2 unchanged.

## Always-on protected queue rehearsal

The run used an isolated PostgreSQL 17 rehearsal database, the official credentialed GitHub MCP connector, the file-backed loopback HTTPS fixture, and the real private analyzer. The independent MCP client submitted job `1fbeb962-619a-4396-a33f-ffcfd938d8c2`. Its first confirmed request was `56270076-2d72-47e3-b430-dc562096882b`.

The fictional policy was saved to the fixture's `privacy.txt` after the first receipt. A separate TLS-verified GET returned the new text immediately. The running Live monitor persisted change 3 and invalidated approval. The browser observed v2 and the withheld items through polling. After setup, the only browser writes were Live sign-in and starting protected monitoring. The external client submitted the work over MCP. No refresh action, approval write, policy simulation, or restart occurred during the run.

| Observed result | Receiver evidence |
| --- | --- |
| Confidential documents admitted under v1 | 2 completed receipts totaling 144 UTF-8 payload bytes |
| Confidential documents evaluated under v2 | 12 `REVIEW_REQUIRED / NOT_SENT`, zero completed receipts |
| Public control evaluated under v2 | 1 completed receipt, 57 payload bytes |
| Isolated synthetic comparison | 9 completed when the protected queue first showed withholding, then 24 completed totaling 2,088 payload bytes |

The integration regression exercises an in-flight authorization race, an unavailable policy file, idempotent queue submission, unchanged observations, cancellation, and recovery of unresolved claims. This queue transfers whole documents. It has no partially staged files. See the [protected queue runbook](ALWAYS_ON_PROTECTION.md) for the fixture filename and launch commands.
## Three-stream rehearsal

The follow-up rehearsal used 13 confidential and 7 public submissions per analyzer, and pointed Analyzer A's existing HTTPS endpoint at the root `privacy.txt`. A real browser run verified all four lane sizes and the receipt-driven gateway animation. Editing the root file was observed after about four seconds. Analyzer A held the 12 confidential files still waiting, and each of the other three lanes recorded a receipt after the observation. Analyzer B continued using its separate no-training terms at revision 1.

The browser rehearsal used a separate PostgreSQL database, two independent loopback HTTPS fixtures, and the pinned read-only GitHub MCP connector. The launch produced receiver-tagged receipts in all three lanes. Editing only Analyzer A's file led to an observed restriction in about 5.7 seconds. At the inspection point, one Analyzer A confidential file had already arrived, 11 were held, and no later Analyzer A confidential transfer had been initiated during the restriction. Analyzer A public and Analyzer B confidential each had a post-observation receipt. Analyzer B stayed approved on its original revision.

The incident summary matched the persisted receipts. **View evidence** opened the changed clause and impacted workflows. Restoring Analyzer A's exact starting terms resumed its existing lane. The same incident record remained visible and its current held count cleared. The older single-analyzer rehearsal remained on its original database.
