# Privora MCP

**Turning changing privacy policies into enforceable AI-agent permissions.**

Built for **wHACKiest 2026** · **Make MCP Matter — Less Magic, More Utility**

An AI agent may have permission to send confidential data to a provider. If that provider changes its privacy terms, a static permission list can keep allowing transfers under an outdated approval. Privora tracks the terms a workflow relies on and uses the current policy state to decide whether an MCP transfer can proceed. In the verified Live run, an observed clause change blocked the same confidential request without a gateway restart or an additional analyzer receipt.

## Live demo

Open **Overview** and click **Start Privora**. Privora fetches Analyzer A's current HTTPS terms and shows them for confirmation. Select **Approve and start Privora** to launch the batch, or **Cancel** to leave it idle. If the terms allow AI training, restore the approved starting sentence below and try again.

Each analyzer gets 13 confidential and 7 public submissions using the registered synthetic GitHub fixtures. The two lanes show which file is processing and its classification. The gateway animation follows real processing and receiver receipts. Use **Stop Privora** to end the session and cancel any files still in the queue.

1. Start with both analyzers independently approved and both policies using the no-training sentence below.
2. After the first deliveries, edit only [`privacy.txt`](privacy.txt) and save the training sentence.
3. Analyzer A holds its waiting confidential files. Its public files and Analyzer B's files continue where permitted. **View evidence** opens the observed terms, affected workflows, and receipt counts.
4. Restore the exact approved starting sentence to resume the waiting confidential files in that same synthetic rehearsal.

**Starting sentence**

> Customer-submitted documents are not used for AI model training.

**Training sentence**

> Customer-submitted documents may be used to improve our AI models unless an applicable opt-out is enabled.

| Analyzer | Editable file | Local HTTPS endpoint |
| --- | --- | --- |
| A | [`privacy.txt`](privacy.txt) | `https://127.0.0.1:8446/privacy` |
| B | [`privacy-analyzer-b.txt`](privacy-analyzer-b.txt) | `https://127.0.0.1:8447/privacy` |

Leave Analyzer B's terms unchanged during the demo. The [rehearsal runbook](docs/ALWAYS_ON_PROTECTION.md) covers the HTTPS servers, workflow bindings and approvals, and the separate synthetic-only comparison.

**Overview** shows the two analyzers. **Investigations** contains policy diffs and blast-radius analysis. **Activity** shows individual decisions and receipts. **Settings** contains policy sources, workflow bindings, and reviews.

## What works

- **Policy monitoring** fetches allowlisted HTTPS terms, stores normalized versions, and records changes with source URLs and timestamps. Open Terms Archive imports provide historical context.
- **Policy interpretation** uses deterministic extraction by default. An optional LLM can help interpret public policy excerpts. It cannot approve a provider or decide a transfer. The optional real model API has not been verified.
- **Automatic enforcement** invalidates the applicable confidential approval when the monitored destination policy changes. An eligible public workflow can remain allowed.
- **Real MCP integrations** connect the Live gateway to the official GitHub MCP server with scoped read-only access and to a local analyzer. The approved and blocked cases were verified against independent analyzer receipts.
- **Separate Demo and Live environments** use separate PostgreSQL databases, roles, and endpoints. Demo uses a synthetic fixture and can run without GitHub credentials.
- **Privacy Blast Radius Analysis** identifies affected workflows, shows the policy and rule behind each decision, and links historical review candidates to prior audit records. Candidates are records to review.
- **Policy evidence and audit** retain version identifiers, decisions, delivery states, and the observed change when it caused a restriction.

## Architecture

```mermaid
flowchart LR
    Agent["AI agent / MCP client"] -->|"MCP · Streamable HTTP"| Gateway["Privora MCP gateway"]
    Gateway --> Engine["Deterministic policy engine"]
    Engine -->|"Read policy, rule and workflow state"| DB[("PostgreSQL")]
    Gateway -->|"Allowed · private MCP stdio"| Source["Private data source / GitHub MCP"]
    Gateway -->|"Allowed · private MCP stdio"| Analyzer["Local downstream analyzer"]
    Gateway -->|"Write decisions"| DB
    Analyzer -->|"Record receipts"| DB
    Terms["Provider terms / HTTPS policy source"] --> Monitor["Policy monitoring pipeline"]
    Monitor -->|"Version, diff and approval transition"| DB
    UI["Next.js dashboard"] -->|"Dashboard API"| API["FastAPI backend"]
    API -->|"Manual refresh / review"| Monitor
    API -->|"Read evidence and impact"| DB
```

**Policy monitoring.** A scheduled or authenticated manual refresh fetches the terms, compares normalized content, and stores the new version and evidence. A relevant or ambiguous monitored change moves the destination’s confidential approval to review. Historical archive imports remain separate from active enforcement.

**MCP enforcement.** The gateway resolves the registered resource, classification, source, and destination from trusted configuration. The policy engine evaluates the applicable organization rules and version-specific approvals before retrieving the body. An allowed transfer goes to the analyzer over MCP. The analyzer stores a receipt and the gateway stores a separate audit decision.

## Screenshots / Product Preview

**Current Live Overview.** A completed synthetic run with two analyzer lanes, receiver-confirmed totals, and an incident summary.

![Privora Live Overview with Analyzer A, Analyzer B, and the policy change summary](docs/assets/screenshots/live-two-analyzer-overview.png)

**Earlier isolated Demo dashboard.** These screenshots show the original Demo workflow and audit views. The current Live workspace uses the two-analyzer Overview described above.

![Privora dashboard overview showing the Demo and Live mode selector and analyzer receipts](docs/assets/screenshots/demo-dashboard-overview.jpg)

**Policy comparison and transfer audit.** Demo Mode highlights the change from v1 to v2. The audit shows the confidential transfer held after the policy change and the public transfer allowed under v2.

![Demo policy comparison showing highlighted clauses and an audit with allowed and held transfers](docs/assets/screenshots/demo-policy-comparison.jpg)

## Quick start

Prerequisites are Git, Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 24 with npm, and Docker with Compose. Live additionally needs the official GitHub MCP server and a fine-grained token with **Contents: Read** for the designated fixture repository. The controlled local HTTPS fixture uses OpenSSL.

### 1. Clone and install

Run from PowerShell. On Linux or WSL, use `cp` instead of `Copy-Item`, `npm` instead of `npm.cmd`, and Bash environment syntax.

```powershell
git clone -b feature/privora-investigation-ui https://github.com/binarybranch30/Privora.git
cd Privora
Copy-Item .env.example .env
docker compose up -d --wait
uv sync --locked --python 3.12
uv run alembic upgrade head
npm.cmd ci --prefix frontend
```

The supplied Compose database listens locally on port `55439`. The Demo backend reads `DATABASE_URL` and `DEMO_MODE` from `.env`. For a Docker-free Demo, use `DATABASE_URL=sqlite:///./policyguard.db` before applying migrations.

Existing database and role names still use the `policyguard` prefix so current data and credentials remain usable. For an existing setup, update any exported project-specific settings to `PRIVORA_ADMIN_TOKEN`, `PRIVORA_API_ORIGIN`, and `PRIVORA_LIVE_CONFIG` as applicable. Direct Live dashboard API clients should send `X-Privora-Live: 1` for mutations.

### 2. Start the isolated Demo backend (optional)

Use separate terminals from the checkout root.

```powershell
uv run uvicorn privora.api:app --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd --prefix frontend run dev -- --hostname 127.0.0.1
```

To expose the separate Demo/Live selector, set `$env:NEXT_PUBLIC_PRIVORA_TRANSFER_DEMO = "0"` before starting the frontend. In that configuration select **Demo**, then click **Reset demo**. The FastAPI process also serves the Demo MCP gateway at `http://localhost:8000/mcp/`. To verify the synthetic sequence and its receipts:

```powershell
uv run python -m scripts.verify_demo
```

This command resets Demo data. The gateway starts the downstream MCP servers as private stdio subprocesses. For standalone MCP inspection, use `uv run python -m privora.downstream documents` or `uv run python -m privora.downstream analyzer`.

### 3. Add Live Mode

Follow the [Live setup guide](docs/LIVE_SETUP.md) to create scoped database roles and copy `.env.live.example` to the ignored `.env.live`. Configure `LIVE_DATABASE_URL`, `LIVE_ADMIN_SECRET`, `LIVE_MCP_SECRET`, the policy allowlist and GitHub connector settings. For the fictional analyzer, configure its policy URL and dedicated development certificate as described in the [final demo runbook](docs/FINAL_DEMO_RUNBOOK.md). Keep the credentials out of Git.

```powershell
$env:PRIVORA_LIVE_CONFIG = '.env.live'
uv run python -m privora.live_setup migrate
uv run uvicorn privora.live_api:app_factory --factory --host 127.0.0.1 --port 8001
```

The default dashboard opens Live. Standard Live requires an admin sign-in. Live MCP clients connect to `http://localhost:8001/mcp/` with their separate bearer credential. Keep both backends on loopback with one worker per instance.

### 4. Open the local presentation without a sign-in screen

Use this option on a trusted machine with a dedicated synthetic rehearsal configuration. Keep the rehearsal backend running and launch the presentation frontend:

```powershell
$env:PRIVORA_LIVE_CONFIG = ".env.live"
uv run python -m scripts.run_local_demo --port 3000 --live-port 8001
```

Open [Privora](http://127.0.0.1:3000). The launcher binds the frontend to loopback and the Next.js server obtains an ordinary admin session for the local browser. The secret stays server-side. Keep this option off for shared or public deployments. Match `--live-port` to your rehearsal backend.

## Verification

| Check | Confirmed result |
| --- | --- |
| Backend suite | Policy, HTTPS, isolation, gateway, and queue regression tests |
| Frontend | Lint and production build passed |
| Credentialed GitHub MCP | Nine-word confidential fixture delivered under approved v1 |
| Automatic restriction | Editing the root policy in a browser rehearsal held Analyzer A confidential files while its public lane and Analyzer B continued |
| Isolation | Live request IDs absent from Demo audit |
| Blast radius | One affected and restricted workflow, one unaffected workflow, one historical review candidate |

The [verification log](docs/VERIFICATION.md) distinguishes the real GitHub run, fictional HTTPS terms, and automated tests. The two-analyzer rehearsal was verified in a browser against independent local HTTPS sources. The optional commercial LLM call has not been verified.

```powershell
uv run pytest -q
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

For a full PostgreSQL test run, set `TEST_DATABASE_URL`, `TEST_LIVE_DATABASE_URL`, `TEST_PHASE3_DATABASE_URL`, and `TEST_PHASE3_TLS_DATABASE_URL` to separate disposable databases. The tests write fixtures to them.

## Security model

Privora controls transfers it mediates through its MCP gateway. A client supplies a registered resource ID, while trusted metadata defines classification and the permitted repository path and commit. The deterministic engine checks account applicability, organization rules, policy freshness, and exact-version approval. A model can provide analysis for review but has no authority to grant access.

| Decision | Meaning |
| --- | --- |
| `ALLOW` | The policy gate permits the operation. Check the delivery state or receipt independently. |
| `BLOCK` | The operation is denied by an applicable rule or boundary. |
| `REVIEW_REQUIRED` | Permission is held pending review or current evidence. The confidential transfer is withheld. |

A public T&C page may not reflect an account agreement, applicable product scope, or opt-out. Verify those separately before approval. Direct uploads, other connectors, and transfers outside the gateway are outside its enforcement boundary. Privora is a research and hackathon prototype with a local trust model. Enterprise DLP certification and production deployment assurance are outside its scope. See the [security model](docs/SECURITY_MODEL.md).

## Repository and contributing

| Path | Responsibility |
| --- | --- |
| `privora/` | FastAPI, MCP gateway and connectors, policy monitoring, decisions, and impact |
| `frontend/` | Next.js and TypeScript dashboard |
| `migrations/` | Alembic migrations |
| `scripts/` | Demo verifier and fictional HTTPS policy fixture |
| `tests/` | Policy, isolation, HTTPS, GitHub connector, and MCP integration tests |
| `docs/` | Architecture, API contracts, operations, and verification evidence |

The stack includes Python, FastAPI, Pydantic, the official MCP Python SDK, SQLAlchemy, Alembic, PostgreSQL, HTTPX, Beautiful Soup, Next.js, React, TypeScript, Tailwind CSS, Lucide, Docker Compose, and pytest.

Use a feature branch, keep fixtures synthetic, and run the backend and frontend checks before opening a pull request. Document significant decisions and state which integrations were exercised. See the [team workflow](docs/TEAM_WORKFLOW.md), [architecture decisions](docs/ARCHITECTURE_DECISIONS.md), and [API contracts](docs/API_CONTRACTS.md).

**Roadmap:** Verify more provider-specific account scopes, improve operational monitoring and delivery reconciliation, and harden deployment and identity before production use.

**License:** No license file is included.

**Acknowledgments:** The [Model Context Protocol](https://modelcontextprotocol.io/), [official GitHub MCP server](https://github.com/github/github-mcp-server), [Open Terms Archive](https://opentermsarchive.org/), and the open-source maintainers of the stack above.
