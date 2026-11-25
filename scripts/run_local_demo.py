"""Start the loopback-only Privora presentation frontend."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess

from privora.live_config import LiveSettings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--live-port", type=int, default=8001)
    parser.add_argument("--production", action="store_true", help="Build and run the local production bundle.")
    args = parser.parse_args()
    if not all(1024 <= port <= 65535 for port in (args.port, args.live_port)) or args.port == args.live_port:
        parser.error("Use two distinct ports between 1024 and 65535")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        parser.error("npm is required")
    root = Path(__file__).resolve().parents[1]
    settings = LiveSettings.load()
    command = [npm, "--prefix", "frontend", "run"]
    environment = {
        **os.environ,
        "NEXT_PUBLIC_PRIVORA_LOCAL_DEMO": "1",
        "PRIVORA_LOCAL_DEMO_ORIGIN": f"http://127.0.0.1:{args.port}",
        "PRIVORA_LIVE_API_PORT": str(args.live_port),
    }
    environment.pop("PRIVORA_LOCAL_DEMO_SECRET", None)
    if args.production:
        subprocess.run([*command, "build"], cwd=root, env=environment, check=True)
    environment["PRIVORA_LOCAL_DEMO_SECRET"] = settings.admin_secret
    mode = "start" if args.production else "dev"
    subprocess.run([*command, mode, "--", "--hostname", "127.0.0.1", "--port", str(args.port)],
                   cwd=root, env=environment, check=True)


if __name__ == "__main__":
    main()
