"""Serve only fictional policy text over a verified loopback development TLS endpoint."""

import argparse
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from policyguard.monitor import DRIFT, SAFE


def fixture_server(cert, key, state, port):
    class PolicyHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/robots.txt":
                body = "User-agent: *\nAllow: /privacy\n"
            elif self.path == "/privacy":
                try:
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
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()
    with fixture_server(args.cert, args.key, args.state, args.port) as server:
        print(f"Fictional terms at https://127.0.0.1:{args.port}/privacy", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
