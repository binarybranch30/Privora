import argparse
import asyncio

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from .gateway import invoke
from .live_config import LiveSettings


async def main():
    parser = argparse.ArgumentParser(description="Analyze a registered Live resource over MCP")
    parser.add_argument("resource")
    args = parser.parse_args()
    settings = LiveSettings.load()
    async with httpx.AsyncClient(timeout=35, trust_env=False, headers={"Authorization": "Bearer " + settings.mcp_secret}) as http:
        async with streamable_http_client("http://localhost:8001/mcp/", http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await invoke(session, "analyze_document", {"document_id": args.resource, "destination_service": "local_analyzer"})
                import json
                print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
