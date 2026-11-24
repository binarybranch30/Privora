# MVP plan

1. Prove the gateway calls the private MCP servers and audits transfers.
2. Persist policy snapshots and invalidate approval when the snapshot changes.
3. Verify the allowed, held and public cases using analyzer receipts.
4. Surface policy evidence and controls in the dashboard.
5. Rehearse from a clean database and run CI before the demo.

The acceptance criterion is a switch from ALLOW on v1 to REVIEW_REQUIRED on v2 for identical input, with the analyzer receipt count unchanged for the retry.
