"""Authenticated client for the protected Live MCP tool."""

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from .gateway import invoke


async def submit(settings, session_id, job_id, documents, port=8001):
    return await call(settings, port, "submit_protected_job", {
        "session_id": str(session_id), "job_id": str(job_id), "document_ids": documents,
    })


async def submit_lanes(settings, session_id, token):
    return await call(settings, settings.demo_port, "submit_rehearsal_lanes", {
        "session_id": str(session_id), "launch_token": str(token),
    })


async def call(settings, port, tool, arguments):
    async with httpx.AsyncClient(headers={"Authorization": "Bearer " + settings.mcp_secret}, trust_env=False) as http:
        async with streamable_http_client(f"http://localhost:{port}/mcp/", http_client=http) as (read, write, _):
            async with ClientSession(read, write) as client:
                await client.initialize()
                return await invoke(client, tool, arguments)
