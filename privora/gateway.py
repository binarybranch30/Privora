import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel
from sqlalchemy import select

from .db import Audit, Rule, Service
from .engine import Decision, evaluate
from .monitor import DEMO_SERVICE


log = logging.getLogger(__name__)


class Analysis(BaseModel):
    request_id: str
    word_count: int


class ToolDecision(BaseModel):
    request_id: str
    decision: str
    reason: str
    classification: str | None
    policy_version: int | None
    delivery: str
    analysis: Analysis | None = None


async def invoke(session, name, arguments):
    result = await session.call_tool(name, arguments)
    if result.isError or result.structuredContent is None:
        raise RuntimeError("MCP downstream did not return a successful structured response")
    return result.structuredContent


@asynccontextmanager
async def subprocess_session(server, database_url):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "privora.downstream", server],
        env={"DATABASE_URL": database_url},
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        yield session


async def call_gateway(url, arguments, transport=None):
    async with httpx.AsyncClient(transport=transport, timeout=25, trust_env=False) as client:
        async with streamable_http_client(url, http_client=client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                data = await invoke(session, "analyze_document", arguments)
                return ToolDecision.model_validate(data)


def locked_service(db, service_id):
    return db.scalar(select(Service).where(Service.id == service_id).with_for_update())


def gateway_server(db_factory, database_url, lock):
    server = FastMCP("Privora", stateless_http=True, json_response=True, streamable_http_path="/")

    @server.tool()
    async def analyze_document(document_id: str, destination_service: str) -> ToolDecision:
        """Analyze a known document at a registered destination after privacy enforcement."""
        request_id = str(uuid4())
        classification = version = analysis = None
        delivery = "NOT_SENT"
        # A single worker serializes reset, review, monitoring and forwarding.
        # The service row lock also orders PostgreSQL decisions against other writers.
        async with lock:
            with db_factory.begin() as db:
                service = locked_service(db, destination_service) if len(destination_service) <= 80 else None
                version = service.current_version if service else None
                decision = Decision("BLOCK", "UNKNOWN_DESTINATION")
                if service is not None and service.id == DEMO_SERVICE:
                    decision = Decision("BLOCK", "UNKNOWN_DOCUMENT")
                    if 0 < len(document_id) <= 80:
                        try:
                            async with asyncio.timeout(15), subprocess_session("documents", database_url) as documents:
                                metadata = await invoke(documents, "document_metadata", {"document_id": document_id})
                                if metadata["found"]:
                                    classification = metadata["classification"]
                                    organization_id = metadata["organization_id"]
                                    decision = evaluate(classification, service, db.get(Rule, organization_id))
                                    if decision.decision == "ALLOW":
                                        body = await invoke(documents, "read_approved_document", {
                                            "document_id": document_id, "organization_id": organization_id,
                                            "classification": classification,
                                        })
                                        if not body["found"]:
                                            decision = Decision("BLOCK", "DOCUMENT_CHANGED")
                                        else:
                                            async with subprocess_session("analyzer", database_url) as analyzer:
                                                delivery = "UNKNOWN"
                                                analysis = Analysis.model_validate(await invoke(analyzer, "analyze_content", {
                                                    "request_id": request_id, "content": body["content"],
                                                }))
                                                if analysis.request_id != request_id:
                                                    analysis = None
                                                    raise ValueError("Mismatched analyzer receipt")
                                                delivery = "RECEIVED"
                        except Exception as error:
                            log.warning("Trusted MCP operation %s failed (%s)", request_id, type(error).__name__)
                            if delivery == "NOT_SENT":
                                decision = Decision("BLOCK", "TRUSTED_BACKEND_UNAVAILABLE")
                db.add(Audit(
                    request_id=request_id, operation="analyze_document", destination=destination_service[:80],
                    classification=classification, decision=decision.decision, reason=decision.reason,
                    policy_version=version, delivery=delivery,
                ))
        return ToolDecision(
            request_id=request_id, decision=decision.decision, reason=decision.reason, classification=classification,
            policy_version=version, delivery=delivery, analysis=analysis,
        )

    return server
