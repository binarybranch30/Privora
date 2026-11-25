"""Standalone synthetic-only comparison with a local receiver and no Live imports."""

import argparse
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from queue import Queue
from threading import Event, Lock, Thread


def run_comparison(count, interval, port, *, on_demand=False):
    receipts = []
    lock = Lock()
    active_run = None

    def produce(queue, stopped):
        for index in range(1, count + 1):
            if stopped.wait(interval):
                break
            data = f"Fictional Privora comparison document {index:04d}. This contains only synthetic exercise text."
            queue.put((index, data.encode("utf-8")))
        queue.put(None)

    def receive(queue, stopped):
        nonlocal active_run
        while (item := queue.get()) is not None:
            index, body = item
            with lock:
                if active_run is stopped:
                    receipts.append({"fixture": index, "received_bytes": len(body),
                                     "received_at": datetime.now(timezone.utc).isoformat()})
        with lock:
            if active_run is stopped:
                active_run = None

    def start():
        nonlocal active_run
        with lock:
            if active_run is not None:
                return
            receipts.clear()
            stopped = active_run = Event()
        queue = Queue(maxsize=1)
        Thread(target=receive, args=(queue, stopped), daemon=True).start()
        Thread(target=produce, args=(queue, stopped), daemon=True).start()

    def stop():
        nonlocal active_run
        with lock:
            if active_run is not None:
                active_run.set()
                active_run = None

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.mutate(start)

        def do_DELETE(self):
            self.mutate(stop)

        def mutate(self, action):
            if not on_demand or self.path != "/api/comparison":
                self.send_error(404)
                return
            if (self.headers.get("X-Privora-Comparison") != "1"
                    or self.headers.get("Content-Length", "0") != "0"):
                self.send_error(403)
                return
            action()
            self.do_GET()

        def do_GET(self):
            if self.path == "/api/comparison":
                with lock:
                    payload = {"synthetic_only": True, "running": active_run is not None, "queued_files": count, "confirmed_files": len(receipts),
                               "confirmed_bytes": sum(item["received_bytes"] for item in receipts), "receipts": receipts.copy()}
                data = json.dumps(payload).encode()
                media = "application/json"
            elif self.path == "/":
                data = PAGE.encode()
                media = "text/html; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", media)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        if not on_demand:
            start()
        print(f"Synthetic comparison at http://127.0.0.1:{port}/", flush=True)
        server.serve_forever()


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Synthetic comparison | Privora demonstration</title>
<style>
body{font:16px/1.55 system-ui;background:#0b1420;color:#eef4ff;padding:2rem;max-width:720px;margin:auto}
small{color:#aac0df}h1{margin-block:8px 14px}dl{display:flex;flex-wrap:wrap;gap:2rem;border-block:1px solid #44526c;padding:1rem 0}
dd{font:2rem ui-monospace;margin:0;color:#81e1cf}progress{width:100%;accent-color:#81e1cf}
</style></head><body>
<small>ISOLATED SYNTHETIC COMPARISON</small><h1>Unprotected fixture receiver</h1>
<p>This standalone process consumes only its own generated text. It has no Live credentials or access to Privora resources.</p>
<dl><div><dt>Files received</dt><dd id="files">—</dd></div><div><dt>Bytes received</dt><dd id="bytes">—</dd></div></dl>
<progress id="progress" value="0" max="1" aria-label="Synthetic receiver progress"></progress><p id="status">Waiting for receiver data.</p>
<script>
const out = id => document.getElementById(id);
async function refresh() {
  try {
    const response = await fetch('/api/comparison', {cache:'no-store'});
    if (!response.ok) throw Error();
    const data = await response.json();
    out('files').textContent = data.confirmed_files + ' / ' + data.queued_files;
    out('bytes').textContent = data.confirmed_bytes;
    out('progress').max = data.queued_files;
    out('progress').value = data.confirmed_files;
    out('status').textContent = data.confirmed_files === data.queued_files ? 'Synthetic queue finished.' : 'Receiving synthetic documents.';
  } catch { out('status').textContent = 'Receiver connection unavailable.'; }
}
refresh();
setInterval(refresh,1000);
</script></body></html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=16)
    parser.add_argument("--interval", type=float, default=2)
    parser.add_argument("--port", type=int, default=8444)
    parser.add_argument("--on-demand", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.count <= 200 or not .25 <= args.interval <= 30:
        parser.error("Use 1–200 synthetic documents and an interval of 0.25–30 seconds")
    run_comparison(args.count, args.interval, args.port, on_demand=args.on_demand)
