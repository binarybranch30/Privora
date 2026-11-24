# Run Phase 2 locally

Keep the dashboard and both APIs on loopback. Demo uses port 8000 and Live uses 8001. Only Live needs a second credentials file. The dashboard runs on port 3000.

## Create scoped database roles

With the existing Compose PostgreSQL healthy, run `uv run alembic upgrade head` using the existing Demo migration connection. Open `docker compose exec db psql -U policyguard -d postgres`. Run the following once for the supplied Compose database. At each password prompt use a distinct randomly generated password. PostgreSQL URL-encode passwords containing reserved characters.

```sql
CREATE ROLE policyguard_demo LOGIN;
\password policyguard_demo
CREATE ROLE policyguard_live LOGIN;
\password policyguard_live
CREATE DATABASE policyguard_live OWNER policyguard_live;
REVOKE CONNECT ON DATABASE policyguard FROM PUBLIC;
REVOKE CONNECT ON DATABASE policyguard_live FROM PUBLIC;
GRANT CONNECT ON DATABASE policyguard TO policyguard_demo;
\connect policyguard
GRANT USAGE ON SCHEMA public TO policyguard_demo;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO policyguard_demo;
REVOKE INSERT, UPDATE, DELETE ON live_identity FROM policyguard_demo;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO policyguard_demo;
\quit
```

Keep the Compose superuser for migrations only. When starting Demo, set `DATABASE_URL` in the Demo process to the scoped connection `postgresql+psycopg://policyguard_demo:<password>@127.0.0.1:55439/policyguard` and keep `DEMO_MODE=true`. Regrant privileges on future Demo tables as needed. To rehearse just Demo, the original setup still works.

## Configure and start Live

Copy `.env.live.example` to `.env.live`. Fill in the Live database URL and use two distinct high-entropy secrets of at least 24 characters for the dashboard and the agent endpoint. Enter them locally. Git ignores `.env.live`. Set a separate environment variable in the Live terminal:

```powershell
$env:POLICYGUARD_LIVE_CONFIG = ".env.live"
uv run python -m policyguard.live_setup migrate
uv run uvicorn policyguard.live_api:app_factory --factory --host 127.0.0.1 --port 8001
```

Use `export POLICYGUARD_LIVE_CONFIG=.env.live` in Bash. Start the Demo backend and dashboard as described in the README. Select **Live Mode** and sign in with the Live admin secret. Register policy hosts in the settings allowlist before submitting URLs. Register a policy source and refresh it. Live also checks each registered direct source every 15 minutes. Confidential transfers require a successful observation no more than one hour old. Failed observations suspend transfers until a successful refresh. Changed observations need a new human review.

The optional LLM is an OpenAI-compatible chat completions endpoint selected by the operator. Configure all three LLM settings together. Public policy text is the only input.

## Import Open Terms Archive history

Download the ZIP asset from a pinned, supported [France collection release](https://github.com/OpenTermsArchive/france-versions/releases) or [Contrib collection release](https://github.com/OpenTermsArchive/contrib-versions/releases). Use an existing Live service and the exact provider and terms directory names from the dataset. Example for a registered Apple service:

```powershell
uv run python -m policyguard.live_setup import-archive apple path/to/france-collection-dataset-2026-11-23.zip https://github.com/OpenTermsArchive/france-versions/releases/tag/france-collection-dataset-2026-11-23 Apple "Privacy Policy" --policy-url https://www.apple.com/legal/privacy/
```

Pass the original policy URL when documented for the collection. The optional URL is provenance and is never fetched by the importer. Imported dates are archive dates. Check the collection scope and attribution in the release.

## Run a credentialed GitHub transfer

1. Install the official GitHub MCP server binary from the verified [v2.2.0 release](https://github.com/github/github-mcp-server/releases/tag/v2.2.0). Set its absolute path in `LIVE_GITHUB_COMMAND`. Configure a fine-grained token for a designated test repository with Contents read permission and set `LIVE_GITHUB_REPO` to that repository's exact `owner/repo`. Keep the token in the ignored Live settings.
2. Register and refresh the direct policy URL in `LIVE_GITHUB_POLICY_URL`. Review the applicable account terms and opt-out status. Review and approve the local analyzer's handling profile. Use a small regular Markdown or text file at an immutable commit in the designated repository. Register the path, SHA, and trusted classification in Live Mode.
3. Run `uv run python -m policyguard.live_client <resource-id>` from the Live-configured terminal. A successful result reports `RECEIVED`; Live audit identifies the resource and both policy bases. Use a test fixture whose classification and policy applicability you can actually attest. The analyzer returns a word count and stores a local receipt.
