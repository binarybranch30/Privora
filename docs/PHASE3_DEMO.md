# Phase 3 demonstration

The monitored destination is **Fictional monitored analyzer**. Its policy is synthetic. It points to the existing local word-count MCP analyzer, while GitHub remains the real source of the registered files.

## Start with policy v1

Create a directory outside the repository for the development certificate, private key, and fixture state. Run these commands in PowerShell using OpenSSL:

```powershell
$fixture = Join-Path $env:TEMP "policyguard-phase3-tls"
New-Item -ItemType Directory -Force $fixture | Out-Null
$cert = Join-Path $fixture "fixture.crt"
$key = Join-Path $fixture "fixture.key"
$state = Join-Path $fixture "version.txt"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 -subj "/CN=PolicyGuard Local Fixture" -addext "subjectAltName=IP:127.0.0.1" -keyout $key -out $cert
[IO.File]::WriteAllText($state, "1")
uv run python -m scripts.serve_policy_fixture --cert $cert --key $key --state $state
```

Set `LIVE_ANALYZER_POLICY_URL=https://127.0.0.1:8443/privacy` and `LIVE_POLICY_FIXTURE_CA=<absolute path to fixture.crt>` in the ignored `.env.live`. Reserve the development certificate for this fixture. The standard public HTTPS fetch path continues to reject loopback addresses. A team-controlled public HTTPS endpoint also works if its hostname is on the allowlist and fixture-CA mode is disabled.

Apply the migration with `uv run python -m policyguard.live_setup migrate` from the Live-configured terminal, then start Live Mode. Keep that process running through both policy observations. Refresh **Fictional monitored analyzer** in Live services. For a newly provisioned test destination the SAFE clause appears as v1. Approve the exact version after verifying that the fictional terms and the local analyzer's no-training handling apply.

## Register and run the GitHub fixture

1. Commit a distinct, entirely fictional `confidential-test.txt` in the authorized GitHub fixture repo. Use the configured fine-grained read-only token and full commit SHA.
2. Refresh GitHub's real policy and obtain the operator's account-specific review. An unknown GitHub source approval prevents confidential retrieval. Keep the same verified source version for both transfer calls.
3. Register the file as `CONFIDENTIAL` in the dashboard and bind the resource to `fictional_analyzer`. Bind a different synthetic `PUBLIC` resource to the same destination for the public control.
4. Run the first command below. A receipt must exist for its request ID.

```powershell
uv run python -m policyguard.live_client <confidential-resource> --destination fictional_analyzer --expect allowed
```

## Change the HTTPS fixture and prove enforcement

From another terminal, change only the file served by the fixture:

```powershell
[IO.File]::WriteAllText((Join-Path $env:TEMP "policyguard-phase3-tls/version.txt"), "2")
```

Refresh the fictional analyzer policy from Live services, or wait for the normal scheduler. The dashboard shows the observed training clause, v2, and review-required status. Reissue the same transfer. The extra command-line flags verify the result and do not change the MCP arguments.

```powershell
uv run python -m policyguard.live_client <confidential-resource> --destination fictional_analyzer --expect blocked --reason AI_TRAINING_CONFLICT
uv run python -m policyguard.live_client <public-resource> --destination fictional_analyzer --expect allowed
```

The blocked request has no analysis and no analyzer receipt. Under **Observed policy changes**, open the fictional analyzer change and select **View blast radius**. Expand a workflow to see its rule, decision, prior delivery count and request IDs. Historical review candidates warrant review of the applicable terms at the time.

## Reset only the fictional fixture

Write `1` to the fixture state file again and refresh the fictional analyzer. On a previously used Live database this produces a new version number and requires a fresh review. It preserves history and audit. For literal v1/v2 numbering, use a freshly provisioned verification database. Demo reset remains separate.
