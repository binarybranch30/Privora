"""Submit a synthetic queue to the real Live MCP endpoint."""

import argparse
import asyncio
import json
from uuid import UUID, uuid4

from privora.live_queue_client import submit
from privora.live_config import LiveSettings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session_id", type=UUID)
    parser.add_argument("document_ids", nargs="+")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--append", action="append", default=[])
    parser.add_argument("--job-id", type=UUID)
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use a loopback MCP port between 1024 and 65535")
    if not 1 <= args.repeat <= 50 or len(args.document_ids) * args.repeat + len(args.append) > 50:
        parser.error("Submit between 1 and 50 items")
    job_id = args.job_id or uuid4()
    print("Submission ID:", job_id, flush=True)
    print(json.dumps(asyncio.run(submit(
        LiveSettings.load(), args.session_id, job_id, args.document_ids * args.repeat + args.append, args.port,
    )), indent=2))


if __name__ == "__main__":
    main()
