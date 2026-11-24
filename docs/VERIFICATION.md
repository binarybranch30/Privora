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
| uv run uvicorn policyguard.api:app --host 127.0.0.1 --port 8000 | Started the API and MCP gateway |
| uv run python -m scripts.verify_demo | Proved the live MCP transition and checked persisted versions, clause evidence, and audit |
| npm.cmd --prefix frontend run start -- --hostname 127.0.0.1 | Dashboard returned HTTP 200 on port 3000 |
| uv lock --check | Backend lockfile current |

Both the live CLI sequence and an HTTP smoke test through the dashboard's Next.js API proxy produced the following results.

| Transfer | Policy | Decision | Delivery | Total analyzer receipts |
| --- | --- | --- | --- | --- |
| confidential_001 | v1 | ALLOW | RECEIVED | 1 |
| confidential_001 again | v2 | REVIEW_REQUIRED | NOT_SENT | 1 |
| public_001 | v2 | ALLOW | RECEIVED | 2 |

The first Compose start found port 55432 in use by another project. PolicyGuard uses 55439. Initial integration failures exposed an SDK host validation error and an untyped downstream response. The final tests used a loopback host with a port and explicit Pydantic response models. The live PostgreSQL setup uses an IPv4 loopback address after localhost connection delays.

Browser visual and click verification was blocked by the computer-use runtime. The dashboard HTTP response and the actual API routes behind all four demo actions were verified. The optional real LLM and live policy URL were not exercised. GitHub Actions is configured and was not run remotely.

## Phase 2

| Command or check | Observed result |
| --- | --- |
| uv run python -m policyguard.live_setup migrate | Provisioned separate Live PostgreSQL storage with both additive migrations |
| uv run pytest -q | 8 passed with SQLite |
| uv run pytest -q with TEST_DATABASE_URL and TEST_LIVE_DATABASE_URL pointing to dedicated PostgreSQL test databases | 8 passed with PostgreSQL |
| npm.cmd --prefix frontend run lint | Passed |
| npm.cmd --prefix frontend run build | Passed |
| uv run python -m scripts.verify_demo | Demo receipts still progressed 1, 1, 2 |
| Live refresh for the GitHub General Privacy Statement, twice | Real HTTPS fetch succeeded. First run stored v1. Second returned v1 unchanged. |
| uv run python -m policyguard.live_setup import-archive apple with the published France release dated 2026-11-23 | Imported 11 Apple privacy-policy versions with original archive timestamps |
| uv run python -m policyguard.live_client unregistered | Real authenticated MCP request returned BLOCK / UNKNOWN_DOCUMENT / NOT_SENT |
| Official GitHub MCP v2.2.0 started over stdio with --read-only --tools get_file_contents stdio | Real SDK session initialized and reported one tool, get_file_contents |
| HTTP requests through the running Next.js backend | Verified both mode routes, Live login and logout, absence of Live reset, and no Live state change from Demo reset |
| PostgreSQL cross-mode access | Both scoped roles were denied when connecting to the other database |

Tests mock GitHub repository file retrieval. The Live transfer test uses real gateway MCP messages and a real local stdio analyzer. It checks unknown applicability, fetch failure and policy drift, and confirms denied transfers neither read the file nor create a receipt. The credentialed GitHub repository read and model API call need operator configuration and remain unverified. Browser interaction was not verified in Phase 2.
