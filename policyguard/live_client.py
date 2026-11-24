import argparse
import asyncio
import json

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from .db import Audit, Receipt, sessions
from .gateway import ToolDecision, invoke
from .live_config import LiveSettings
from .live_gateway import ANALYZER
from .live_models import LiveTrace
from .live_policy import MONITORED_ANALYZER


def verify_transfer(db, resource, result, expectation, reason=None, word_count=None, *, destination=ANALYZER):
    audit = db.get(Audit, result.request_id)
    trace = db.get(LiveTrace, result.request_id)
    receipt = db.get(Receipt, result.request_id)
    if not audit or not trace or trace.resource_id != resource or audit.destination != destination:
        raise ValueError("No matching Live audit and resource trace")
    if any(getattr(audit, field) != getattr(result, field) for field in
           ("classification", "policy_version", "decision", "reason", "delivery")):
        raise ValueError("MCP result and persisted audit disagree")
    if not trace.source_version or not trace.destination_profile or not audit.policy_version:
        raise ValueError("Audit is missing source or destination policy evidence")
    if expectation == "allowed":
        if result.decision != "ALLOW" or result.delivery != "RECEIVED" or not receipt or not result.analysis:
            raise ValueError("Expected an allowed transfer with an analyzer receipt")
        if result.analysis.request_id != result.request_id or (
            word_count is not None and result.analysis.word_count != word_count
        ):
            raise ValueError("Analyzer result did not match the request or expected fixture")
    elif (result.decision not in {"BLOCK", "REVIEW_REQUIRED"} or result.delivery != "NOT_SENT"
          or receipt or result.analysis or not reason or result.reason != reason):
        raise ValueError("Expected the specified policy denial and no analyzer receipt")
    return {
        "analyzer_receipt": receipt is not None,
        "resource_id": trace.resource_id,
        "source_service": trace.source_service,
        "source_policy_version": trace.source_version,
        "destination_profile": trace.destination_profile,
        "destination_policy_version": audit.policy_version,
    }


async def main():
    parser = argparse.ArgumentParser(description="Analyze a registered Live resource over MCP")
    parser.add_argument("resource")
    parser.add_argument("--destination", choices=[ANALYZER, MONITORED_ANALYZER], default=ANALYZER)
    parser.add_argument("--expect", choices=["allowed", "blocked"], help="Verify persisted Live audit and analyzer receipt")
    parser.add_argument("--reason", help="Expected policy reason for a blocked request")
    parser.add_argument("--word-count", type=int, help="Expected word count of the synthetic fixture")
    args = parser.parse_args()
    if args.expect == "blocked" and not args.reason:
        parser.error("--expect blocked requires --reason")
    settings = LiveSettings.load()
    async with httpx.AsyncClient(timeout=35, trust_env=False, headers={"Authorization": "Bearer " + settings.mcp_secret}) as http:
        async with streamable_http_client("http://localhost:8001/mcp/", http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = ToolDecision.model_validate(await invoke(session, "analyze_document", {
                    "document_id": args.resource, "destination_service": args.destination,
                }))
    output = result.model_dump()
    if args.expect:
        try:
            with sessions(settings.database_url)() as db:
                output["verification"] = verify_transfer(
                    db, args.resource, result, args.expect, args.reason, args.word_count, destination=args.destination,
                )
                trace = db.get(LiveTrace, result.request_id)
                output["verification"].update(workflow_id=trace.workflow_id, policy_change_id=trace.policy_change_id,
                                              decision_origin=trace.decision_origin)
        except ValueError as error:
            parser.exit(1, f"{result.request_id}: {result.reason} / {result.delivery}. {error}\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
