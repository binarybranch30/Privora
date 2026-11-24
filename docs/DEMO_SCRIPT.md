# Demo script

1. Open the dashboard and click **Reset demo**. Verify policy v1 is approved and the analyzer count is 0.
2. Click **Run confidential analysis**. Expect ALLOW and a receipt count of 1.
3. Click **Simulate policy change**. Show the old and new AI training clauses. Policy v2 requires review.
4. Click **Retry confidential analysis**. Show AI_TRAINING_CONFLICT, delivery Not sent, and the unchanged receipt count of 1.
5. Click **Run public analysis**. Expect ALLOW and a receipt count of 2.
6. Show the audit rows and the version used for each decision.

For a scripted rehearsal, run `uv run python -m scripts.verify_demo`. It resets the data and prints the observed decisions and receipt counts.

For optional administrative review, set POLICYGUARD_ADMIN_TOKEN locally. POST to the review route with the matching X-Admin-Token header and version 2. Use verified_no_training=false with evidence that opt-out is unverified to record RESTRICTED. Use true only when applicable terms or account settings have been independently verified. The synthetic test can attest a verified fixture opt-out. Retry the same MCP request to see an approved transfer.
