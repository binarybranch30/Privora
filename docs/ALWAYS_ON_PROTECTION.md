# Always-on protected queue rehearsal

Use only synthetic documents, fictional terms, and a dedicated Live rehearsal database. Run the additive migration with `python -m privora.live_setup migrate` using the rehearsal Live configuration before starting Live. Use a fresh database for literal policy versions v1 and v2. The confirmed historical Live replay remains in its original database.

## Run the independent HTTPS policy fixture

The editable file is [privacy.txt](../privacy.txt), located at `D:\privora\privacy.txt` in this checkout. Before presenting, use the no-training wording below and verify approval in Privora. The fixture reads this file on every GET, serves UTF-8 text, and disables response caching. Its monitored URL is **https://127.0.0.1:8443/privacy**.

From the checkout in PowerShell, create a dedicated local certificate and start the server in its own terminal:

```powershell
$tls = Join-Path $env:TEMP 'privora-queue-tls'
New-Item -ItemType Directory -Force $tls | Out-Null
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Privora Queue Fixture' -addext 'subjectAltName=IP:127.0.0.1' -keyout (Join-Path $tls 'fixture.key') -out (Join-Path $tls 'fixture.crt')
.venv/Scripts/python.exe -m scripts.serve_policy_fixture --cert (Join-Path $tls 'fixture.crt') --key (Join-Path $tls 'fixture.key') --policy-file .\privacy.txt --port 8443
```

In the rehearsal Live settings file configure:

```dotenv
LIVE_ANALYZER_POLICY_URL=https://127.0.0.1:8443/privacy
LIVE_POLICY_FIXTURE_CA=C:/absolute/path/to/privora-queue-tls/fixture.crt
LIVE_QUEUE_SYNTHETIC_RESOURCES=github_confidential_fixture,github_synthetic_fixture
```

Keep the key and configuration out of Git. Use the official GitHub MCP executable and a read-only credential for the designated fixture repository. Register the synthetic files at their exact Git commit IDs, bind them to `fictional_analyzer`, and complete the initial source and destination reviews as in the [Live runbook](FINAL_DEMO_RUNBOOK.md). These reviews establish the initial approved state before the rehearsal. Start Live normally to run its scheduler. For a parallel rehearsal, choose a separate loopback Live port and set `PRIVORA_LIVE_API_PORT` when building the corresponding frontend.

## Prepare the one-click homepage

Set these values in the isolated rehearsal Live settings file, in addition to the fixture settings above.

```dotenv
LIVE_DEMO_RESOURCE=github_confidential_fixture
LIVE_DEMO_COUNT=30
LIVE_DEMO_MCP_PORT=8001
LIVE_DEMO_ITEM_INTERVAL=2
```

The port is the loopback port used by your Live service. Use the same value in `PRIVORA_LIVE_API_PORT` when building the frontend. The launcher accepts no browser-supplied files, destinations, or credentials. It submits the configured fixture through the authenticated MCP tool and keeps one batch per active session. The default batch processes up to 30 copies of the registered synthetic file with a two-second interval between items. Start the fixture and Live service using the commands above and in the linked Live runbook. Start the frontend from the checkout with `npm --prefix frontend run dev` after exporting the API port if it differs from 8001.

Before each presentation, stop the previous demo if it is still active. From the repository root, run `.\scripts\reset_demo_policy.ps1`. It restores the same served file to:

> Customer-submitted documents are not used for AI model training.

Sign into Live. If the observed terms need review, open **Review current terms** and explicitly verify applicability and the training condition for this controlled test. If a previous session is still active, stop it before preparing another run. Editing the terms back does not restore an earlier approval. The gateway checks the currently approved revision.

During the presentation, click **Start Privora** to open the protected session, then click **Start file transfer** to submit the batch. Wait for the first receiver-confirmed delivery, edit the external file as shown below, and save. Watch the **Delivered** and **Withheld** totals, then open **View evidence**. The checked-in fixture setup serves `D:\privora\privacy.txt`. If you passed a different file to the HTTPS server, edit that file. In a dashboard-launched rehearsal, waiting files pause when the terms conflict or observation fails. Restore the exact starting terms while files are still waiting and the same batch resumes after a successful HTTPS observation. The existing approval must have been explicitly reviewed for the starting revision. The restoration applies only to this synthetic batch. Ordinary Live requests still require approval for the current policy revision.

## Two-analyzer Live rehearsal

Use a dedicated Live rehearsal configuration and run the additive migration with `.venv/Scripts/python.exe -m privora.live_setup migrate`. Run the independent HTTPS fixture twice with the same trusted local certificate:

```powershell
$tls = Join-Path $env:TEMP 'privora-queue-tls'
.venv/Scripts/python.exe -m scripts.serve_policy_fixture --cert (Join-Path $tls 'fixture.crt') --key (Join-Path $tls 'fixture.key') --policy-file .\privacy.txt --port 8446
# Second terminal
.venv/Scripts/python.exe -m scripts.serve_policy_fixture --cert (Join-Path $tls 'fixture.crt') --key (Join-Path $tls 'fixture.key') --policy-file .\privacy-analyzer-b.txt --port 8447
```

Set `LIVE_ANALYZER_POLICY_URL=https://127.0.0.1:8446/privacy`, `LIVE_ANALYZER_B_POLICY_URL=https://127.0.0.1:8447/privacy`, and `LIVE_DEMO_PUBLIC_RESOURCE=github_synthetic_fixture` alongside the existing confidential fixture and port settings. A previously provisioned analyzer keeps its configured URL. Use a separate rehearsal database when changing that URL.

Bind both fixtures to both analyzers. In Settings, observe and independently review each analyzer's no-training terms. Click **Start Live Demo** from Overview. It queues 13 confidential and 7 public synthetic files per analyzer. Once the lanes have deliveries, edit only [Analyzer A's policy](../privacy.txt) to permit training. Leave [Analyzer B's policy](../privacy-analyzer-b.txt) unchanged. The animated gateway follows observed file processing and new receiver receipts automatically.

## Start the comparison from Overview

In single-analyzer configuration, run the separate synthetic receiver with `.venv/Scripts/python.exe -m scripts.serve_synthetic_comparison --on-demand --count 20 --interval 2`. Set `NEXT_PUBLIC_PRIVORA_COMPARISON=1` when building the local frontend. The shared **Start file transfer** button sends synthetic comparison files before Privora is started and uses the protected MCP queue after Privora starts. **Stop file transfer** stops an active comparison. Starting the website, receiver, or Privora monitoring does not launch a batch. The comparison receiver records deliveries of its own generated documents independently of the HTTPS policy fixture.

## Manual MCP client and optional comparison

1. Sign in to **Live → Overview** and select **Start protected monitoring**. Copy the displayed session ID.
2. In an independent terminal pointing `PRIVORA_LIVE_CONFIG` at the rehearsal settings, submit real MCP work:

   ```powershell
   .venv/Scripts/python.exe -m scripts.submit_protected_queue <session-id> github_confidential_fixture --repeat 14 --append github_synthetic_fixture
   ```

   Use `--port 8002` if the rehearsal Live backend uses port 8002. Pass a stable `--job-id <uuid>` to retry the same submission idempotently. The queue accepts registered fixture IDs and never accepts file bodies.
3. Start the independent comparison in another terminal and open [its receiver](http://127.0.0.1:8444):

   ```powershell
   .venv/Scripts/python.exe -m scripts.serve_synthetic_comparison --count 20 --interval 2
   ```

4. After Privora shows the first completed confidential receipt, run `code .\privacy.txt` or open that exact file in VS Code. Replace the existing sentence and save:

   > Customer-submitted documents may be used to improve our AI models unless an applicable opt-out is enabled.

5. Watch Privora without clicking refresh or changing approval. The independent fixture immediately serves the new text. The protected session checks it about every two seconds, subject to fetch time and the gateway lock. The browser polls progress every second while the session is active. After observation commits, later confidential items have **Review required / Not sent** and no receipt. The separately classified public item can still complete. The independent synthetic receiver continues counting its own generated files.

## Interpret the result

A document admitted before v2 commits may finish. Compare the actual policy version and receipt attached to each request. The demo reports bytes acknowledged by the private analyzer and counts whole-document receipts. It has no staging or partial-file counters. Unknown delivery is reported as unknown. Stopping the session cancels queued work. It cannot recall data already received.

The comparison process is loopback-only, accepts no file input, and has no connection to Privora or any Live database. Its built-in synthetic texts can have a different byte length from the GitHub fixtures.
