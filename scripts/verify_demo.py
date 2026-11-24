"""Run the destructive synthetic demo against the local API and actual MCP endpoint."""

import asyncio

import httpx

from privora.gateway import call_gateway

ORIGIN = "http://localhost:8000"
CONFIDENTIAL = {"document_id": "confidential_001", "destination_service": "external_analyzer"}


async def main():
    async with httpx.AsyncClient(base_url=ORIGIN, trust_env=False, timeout=30) as client:
        async def request(method, route):
            response = await client.request(method, "/api/" + route)
            response.raise_for_status()
            return response.json()

        async def analyze(arguments):
            return await call_gateway(ORIGIN + "/mcp/", arguments)

        await request("POST", "demo/reset")
        before = await analyze(CONFIDENTIAL)
        receipts = await request("GET", "demo/receipts")
        assert (before.decision, before.policy_version, before.delivery) == ("ALLOW", 1, "RECEIVED")
        assert receipts == {"count": 1, "request_ids": [before.request_id]}
        print(f"Policy v1: {before.decision} / {before.reason}; analyzer receipts = 1")

        change = await request("POST", "demo/simulate-policy-change")
        assert change == {"version": 2, "changed": True, "status": "REVIEW_REQUIRED"}
        denied = await analyze(CONFIDENTIAL)
        assert (denied.decision, denied.policy_version, denied.reason, denied.delivery) == (
            "REVIEW_REQUIRED", 2, "AI_TRAINING_CONFLICT", "NOT_SENT",
        )
        assert await request("GET", "demo/receipts") == receipts
        print(f"Policy v2: {denied.decision} / {denied.reason}; analyzer receipts = 1 (unchanged)")

        public = await analyze(CONFIDENTIAL | {"document_id": "public_001"})
        assert (public.decision, public.delivery) == ("ALLOW", "RECEIVED")
        assert (await request("GET", "demo/receipts"))["count"] == 2
        print(f"Public transfer: {public.decision} / {public.reason}; analyzer receipts = 2")

        versions = await request("GET", "policies/versions")
        changes = await request("GET", "policies/changes")
        audit = await request("GET", "audit")
        assert [version["number"] for version in versions] == [2, 1]
        assert changes[0]["passages"][0]["new"] == versions[0]["content"]
        assert [(row["request_id"], row["reason"], row["policy_version"]) for row in reversed(audit)] == [
            (before.request_id, before.reason, 1), (denied.request_id, denied.reason, 2), (public.request_id, public.reason, 2),
        ]
        print("Verified both persisted versions, changed clause, and all three audit records.")


if __name__ == "__main__":
    asyncio.run(main())
