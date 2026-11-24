# PolicyGuard MCP

Privacy policies can change after an organization approves a provider. PolicyGuard links each confidential transfer to the currently reviewed policy. A changed policy puts confidential transfers on hold until a local administrator verifies the new terms.

Built for wHACKiest 2026, Make MCP Matter. The default demo uses three synthetic documents and a fictional analyzer.

## Windows, WSL and Linux

Install Python 3.12+, uv, Docker Compose, and Node.js 24. Run these from the repository root in PowerShell. In Bash, use `cp` in place of `Copy-Item`, `npm` in place of `npm.cmd`, and use the equivalent environment variable syntax.

```powershell
Copy-Item .env.example .env
docker compose up -d --wait
uv sync --locked --python 3.12
uv run alembic upgrade head
npm.cmd ci --prefix frontend
```

Start the backend and frontend in separate terminals.

```powershell
uv run uvicorn policyguard.api:app --host 127.0.0.1 --port 8000
npm.cmd --prefix frontend run dev -- --hostname 127.0.0.1
```

Open [the dashboard](http://localhost:3000). The gateway MCP URL is `http://localhost:8000/mcp/`. To seed or reset the synthetic demo, use **Reset demo**, or run:

```powershell
curl.exe -X POST http://localhost:8000/api/demo/reset
uv run python -m policyguard.client confidential_001
curl.exe -X POST http://localhost:8000/api/demo/simulate-policy-change
uv run python -m policyguard.client confidential_001
uv run python -m policyguard.client public_001
```

Run the complete reset-and-verify sequence with `uv run python -m scripts.verify_demo`. It checks receipts, versions, evidence and audit records over the live service. The document and analyzer MCP servers are private stdio subprocesses started by the gateway. Developers can launch either through `uv run python -m policyguard.downstream documents` or `uv run python -m policyguard.downstream analyzer` for MCP inspection.

For a Docker-free local demo, set `DATABASE_URL=sqlite:///./policyguard.db` in `.env` before applying migrations. The Docker setup uses PostgreSQL on loopback port 55439. Keep the backend on one worker and both applications on loopback.

## Checks

```powershell
uv run pytest -q
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

Tests default to an isolated SQLite database. Set `TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database to run the same tests against PostgreSQL. Tests reset the contents of that database.

- [Architecture](docs/ARCHITECTURE.md)
- [Product spec](docs/PRODUCT_SPEC.md)
- [Security model](docs/SECURITY_MODEL.md)
- [MVP plan](docs/MVP_PLAN.md)
- [API contracts](docs/API_CONTRACTS.md)
- [Team workflow](docs/TEAM_WORKFLOW.md)
- [Demo script](docs/DEMO_SCRIPT.md)

## Phase 2 Live Mode

Run the existing Demo backend and a separate Live backend to use the dashboard mode selector. Live requires its own PostgreSQL database and role, its own administrative and MCP credentials, and explicit GitHub connector configuration. Follow the [Live setup guide](docs/LIVE_SETUP.md).

## Phase 3 policy enforcement

The optional fictional analyzer exercises automatic HTTPS policy-to-enforcement using the same Live MCP gateway and analyzer. Each observed change can be inspected with a database-backed blast radius. Follow the [Phase 3 demonstration](docs/PHASE3_DEMO.md).
