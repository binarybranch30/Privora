import argparse
import asyncio

from .gateway import call_gateway


async def main():
    parser = argparse.ArgumentParser(description="Call the PolicyGuard MCP tool")
    parser.add_argument("document_id", nargs="?", default="confidential_001")
    parser.add_argument("--destination", default="external_analyzer")
    parser.add_argument("--url", default="http://localhost:8000/mcp/")
    args = parser.parse_args()
    result = await call_gateway(args.url, {"document_id": args.document_id, "destination_service": args.destination})
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
