# Privora final demo runbook

Run commands from the Privora checkout in PowerShell. Keep the dashboard and both API processes on loopback. The monitored analyzer's terms are fictional. The repository file is synthetic and intentionally classified CONFIDENTIAL to exercise the real enforcement path.

## Present the recorded Live investigation

Start Live against the database that retains the credentialed run documented in [VERIFICATION.md](VERIFICATION.md#final-credentialed-confidential-run). Sign in to **Live → Overview** and select **Replay verified Live run**. The option checks the original audit, policy, and impact evidence before it opens. The replay advances automatically. Use **Pause**, **Resume**, the stage buttons, or the replay control to pace the presentation. **Inspect audit**, **Compare versions**, and **Open Blast Radius** open the linked records.

The replay uses a real GitHub MCP read of a synthetic file and a controlled HTTPS endpoint serving fictional analyzer terms. It makes read-only requests and requires no reset, approval change, or new transfer. If the original records have aged out of the dashboard's recent evidence window or are absent from this database, the option is unavailable. **Demo → Record a Demo incident** records an isolated synthetic run in one action when there is no existing incident. It can initialize an empty sandbox, and an existing Demo incident can be replayed without a reset.

## Preflight and startup

Use the PostgreSQL roles described in the [Live setup guide](LIVE_SETUP.md). Keep existing Demo and Live data. Never reset Demo to prepare the Live presentation.

| Process | Environment or settings names |
| --- | --- |
| Demo API | `DATABASE_URL`, `DEMO_MODE` |
| Live API and CLI | `PRIVORA_LIVE_CONFIG` |
| Live settings file | `LIVE_DATABASE_URL`, `LIVE_ADMIN_SECRET`, `LIVE_MCP_SECRET`, `LIVE_POLICY_HOSTS`, `LIVE_GITHUB_POLICY_URL`, `LIVE_GITHUB_COMMAND`, `LIVE_GITHUB_TOKEN`, `LIVE_GITHUB_REPO`, `LIVE_ANALYZER_POLICY_URL`, `LIVE_POLICY_FIXTURE_CA` |
| Dashboard | `PRIVORA_API_ORIGIN` only if overriding the built-in Demo origin |

Keep credentials in the machine-local ignored settings. The GitHub token needs Contents read permission on the designated fixture repo.

Install and build:

```powershell
docker compose up -d --wait
uv sync --locked --python 3.12
npm.cmd ci --prefix frontend
npm.cmd --prefix frontend run build
```

For the local TLS fixture, prepare the certificate and key once using [Phase 3 TLS setup](PHASE3_DEMO.md#start-with-policy-v1). The Live settings must already point to this fixture and its certificate. Start the fixture in terminal 1:

```powershell
$fixture = Join-Path $env:TEMP 'policyguard-phase3-tls'
$state = Join-Path $fixture 'version.txt'
uv run python -m scripts.serve_policy_fixture --cert (Join-Path $fixture 'fixture.crt') --key (Join-Path $fixture 'fixture.key') --state $state
```

With the scoped Demo `DATABASE_URL` set locally, start Demo in terminal 2:

```powershell
$env:DEMO_MODE = 'true'
uv run uvicorn privora.api:app --host 127.0.0.1 --port 8000
```

Start Live in terminal 3. Keep this process running for the entire verification.

```powershell
$env:PRIVORA_LIVE_CONFIG = '.env.live'
uv run python -m privora.live_setup migrate
uv run uvicorn privora.live_api:app_factory --factory --host 127.0.0.1 --port 8001
```

Start the dashboard in terminal 4:

```powershell
npm.cmd --prefix frontend run start -- --hostname 127.0.0.1
```

In the presentation terminal, set `PRIVORA_LIVE_CONFIG` as in terminal 3. Open the dashboard at `http://127.0.0.1:3000` and sign into Live before sharing the screen.

## Rehearse and present

1. Refresh the GitHub source and verify that its applicable account review is current. Confirm that **Fictional monitored analyzer** is showing the no-training clause and is approved for that exact observed version.
2. Confirm that `github_confidential_fixture` points to the committed synthetic file at the verified SHA and is bound to `fictional_analyzer`. `github_synthetic_fixture` is the separately classified public control.
3. Run the allowed request below. Highlight `ALLOW / RECEIVED`, nine words, the request ID and its receipt. This is the only confidential delivery in the pair.

```powershell
uv run python -m privora.live_client github_confidential_fixture --destination fictional_analyzer --expect allowed --word-count 9
```

4. Change only the HTTPS fixture state, then use **Configuration** in Live Mode to refresh **Fictional monitored analyzer**. Leave the gateway running and do not edit the approval. Wait for the replacement clause and review-required status.

```powershell
[IO.File]::WriteAllText((Join-Path $env:TEMP 'policyguard-phase3-tls/version.txt'), '2')
```

5. Retry the identical MCP operation. The expectation flags verify the result locally. Expected output is `REVIEW_REQUIRED / AI_TRAINING_CONFLICT / NOT_SENT`, no analysis, and `analyzer_receipt: false` for the retry.

```powershell
uv run python -m privora.live_client github_confidential_fixture --destination fictional_analyzer --expect blocked --reason AI_TRAINING_CONFLICT
```

6. Run the public control after the blocked attempt. Expect `ALLOW / RECEIVED` and six words.

```powershell
uv run python -m privora.live_client github_synthetic_fixture --destination fictional_analyzer --expect allowed --word-count 6
```

7. In **Policy Intelligence**, show the old and new clauses, versions, warning, and organization rule. Open **View blast radius**. On the clean verified run it shows one affected and restricted workflow, one unaffected workflow, and one historical review candidate. Expand both workflows and match the prior confidential delivery to its Live audit ID. Later rehearsals can accumulate more prior deliveries. Historical candidates are records to review.

## Return the fixture to v1 terms

Write `1` to the fixture state and refresh **Fictional monitored analyzer** only. The policy returns to the original no-training wording. Existing databases record this as a new observation with a new version number. Review that new observed version before the next rehearsal. Keep the database, receipts, and history intact. Use a fresh, separately provisioned Live verification database only if literal v1/v2 numbering is needed.

```powershell
[IO.File]::WriteAllText((Join-Path $env:TEMP 'policyguard-phase3-tls/version.txt'), '1')
```

## Troubleshooting

- **Dashboard fails to load** — Confirm PostgreSQL is healthy and ports 3000, 8000, 8001, and 8443 have the expected processes. After an API restart, sign into Live again.
- **Fixture refresh fails** — Check the fixture terminal and state file. Confirm the certificate has a loopback IP subject alternative name, is current, and matches the Live CA setting. Keep TLS verification enabled.
- **Source review required or stale** — Refresh GitHub and ask the operator to verify the applicable current terms. Never fill in an unverified attestation.
- **Connector unavailable** — Check the official MCP executable, designated repository, full SHA, file path, and token expiration and Contents read permission. Use the synthetic fixture.
- **Duplicate refresh** — Refreshing unchanged fixture text should preserve the existing version. If the scheduler already observed changed text, inspect the latest version and audit evidence.
- **Unexpected receipt result** — Stop the rehearsal. Match request IDs between MCP output, Live audit, and the verifier. An unknown delivery requires review.

## Browser checklist and recording fallback

Before the event, manually switch Demo → Live → Demo, then return to Live. Confirm Live sign-in, fetch success and visible failure states, change and audit links, expansion of both workflow details, and the separate public and confidential rows. For a controlled fetch error, stop only the fictional fixture process, refresh that service, then restart the fixture with the same state and refresh again. Keep the Live API and Demo running.

Capture a rehearsal clip with the terminal results, clause comparison, expanded blast radius, and both request IDs. Start recording after signing in and keep credentials and settings out of the frame. If the network or browser fails on stage, play that recorded rehearsal. If a clip is unavailable, show the real request IDs and receipts from [VERIFICATION.md](VERIFICATION.md) and the persisted Live audit. For a runnable fallback, use Demo Mode and disclose that it uses synthetic data. Avoid resetting either mode while using prior evidence.
## Guided Demo walkthrough

In **Demo → Overview**, select **Start demo** for a fresh sandbox or **Reset to approved v1** if the displayed policy has changed. Follow the four actions at the top of the screen. The successful confidential request creates one analyzer receipt. The same request under v2 returns **Review required / Not sent**, and the count stays at one. **Investigate blast radius** shows the restricted confidential route, the unaffected public route, and the earlier receipt as a review candidate. Use **Inspect retry in Audit** to open the exact withheld request. The optional public transfer adds a second receipt.
