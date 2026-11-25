"""Serve only fictional policy text over a verified loopback development TLS endpoint."""

import argparse
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from privora.monitor import DRIFT, SAFE


def fixture_server(cert, key, state, port, *, policy_file=None):
    class PolicyHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/robots.txt":
                body = "User-agent: *\nAllow: /privacy\n"
            elif self.path == "/privacy":
                try:
                    if policy_file is not None:
                        with policy_file.open("rb") as source:
                            raw = source.read(65537)
                        if not raw.strip() or len(raw) > 65536:
                            raise ValueError("Use a nonempty UTF-8 policy of up to 64 KiB")
                        body = raw.decode("utf-8-sig")
                    else:
                        version = state.read_text(encoding="ascii").strip()
                        body = {"1": SAFE, "2": DRIFT}[version]
                except (OSError, ValueError, KeyError):
                    self.send_error(503)
                    return
            else:
                self.send_error(404)
                return
            data = body.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server = ThreadingHTTPServer(("127.0.0.1", port), PolicyHandler)
    try:
        server.socket = context.wrap_socket(server.socket, server_side=True)
    except Exception:
        server.server_close()
        raise
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--state", type=Path)
    source.add_argument("--policy-file", type=Path)
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()
    with fixture_server(args.cert, args.key, args.state, args.port, policy_file=args.policy_file) as server:
        print(f"Fictional terms at https://127.0.0.1:{args.port}/privacy", flush=True)
        if args.policy_file:
            print(f"Editing {args.policy_file.resolve()} changes the next HTTPS response.", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
