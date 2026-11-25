import asyncio
import shutil
import subprocess
from threading import Thread
from uuid import uuid4

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from privora.db import Audit, Receipt, sessions
from privora.gateway import invoke
from privora.live_api import bootstrap, create_live_app
from privora.live_config import LiveSettings
from privora.live_fetch import fetch_live_policy
from privora.live_models import TransferItem
from privora.live_queue import ProtectedQueue, rehearsal_job_id
from privora.monitor import DRIFT, SAFE
from scripts.serve_policy_fixture import fixture_server
from test_live import ADMIN, AGENT, MUTATION, ORIGIN, URL, migrate


@pytest.mark.asyncio
async def test_protected_queue_observes_saved_file_and_rechecks_each_item(tmp_path, monkeypatch):
    openssl = shutil.which("openssl")
    if not openssl:
        pytest.skip("OpenSSL is needed for the development TLS fixture")
    monkeypatch.setattr("privora.live_queue.POLICY_INTERVAL_SECONDS", .08)
    monkeypatch.setattr("privora.live_queue.ITEM_INTERVAL_SECONDS", .08)
    cert, key, policy = (tmp_path / name for name in ("fixture.crt", "fixture.key", "privacy.txt"))
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=Privora Queue Test", "-addext", "subjectAltName=IP:127.0.0.1",
                    "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True, timeout=15)
    policy.write_text(SAFE, encoding="utf-8")
    database = f"sqlite:///{(tmp_path / 'queue.db').as_posix()}"
    migrate(database)
    factory = sessions(database)
    with factory.begin() as db:
        bootstrap(db)
    reads = []
    entered, release, fetched_drift = (asyncio.Event() for _ in range(3))
    protected_body = "Synthetic confidential data \u2014 exactly measured."

    async def read(_settings, _repo, path, _sha):
        reads.append(path)
        if path == "protected.txt":
            entered.set()
            await release.wait()
            return protected_body
        return "Synthetic public data"

    async def fetch(value, hosts, *, fixture_ca=""):
        if fixture_ca:
            result = await fetch_live_policy(value, hosts, fixture_ca=fixture_ca)
            if result[1] == DRIFT:
                fetched_drift.set()
            return result
        return value, SAFE

    with fixture_server(cert, key, None, 0, policy_file=policy) as fixture:
        thread = Thread(target=fixture.serve_forever, daemon=True)
        thread.start()
        try:
            settings = LiveSettings(database, ADMIN, AGENT, frozenset({"policy.example"}),
                                    github_repo="org/test", github_command="fixture", github_token="fixture", github_policy_url=URL,
                                    analyzer_policy_url=f"https://127.0.0.1:{fixture.server_port}/privacy",
                                    fixture_ca=str(cert), queue_resources=frozenset({"protected", "public"}),
                                    demo_resource="protected", demo_interval=.25)
            app = create_live_app(settings, fetch=fetch, read_file=read)
            transport = httpx.ASGITransport(app=app)
            async with app.router.lifespan_context(app), httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=MUTATION) as admin:
                assert (await admin.get("/api/protection")).status_code == 401
                assert (await admin.post("/api/session", json={"secret": ADMIN})).status_code == 200
                admin.headers["Cookie"] = "privora_live_session=" + admin.cookies["privora_live_session"]

                async def api(method, url, data=None):
                    response = await admin.request(method, "/api/" + url, json=data)
                    response.raise_for_status()
                    return response.json()

                async def until(predicate):
                    async with asyncio.timeout(25):
                        while True:
                            snapshot = await api("GET", "protection")
                            if predicate(snapshot):
                                return snapshot
                            await asyncio.sleep(.05)

                async def submit(session, job, documents):
                    async with httpx.AsyncClient(transport=transport, headers={"Authorization": "Bearer " + AGENT}) as mcp:
                        async with streamable_http_client(ORIGIN + "/mcp/", http_client=mcp) as (incoming, outgoing, _):
                            async with ClientSession(incoming, outgoing) as client:
                                await client.initialize()
                                return await invoke(client, "submit_protected_job", {
                                    "session_id": session, "job_id": job, "document_ids": documents,
                                })

                await api("POST", "services", {"id": "github", "name": "GitHub test", "url": URL})
                for service in ("github", "fictional_analyzer"):
                    await api("POST", f"services/{service}/refresh")
                    await api("POST", f"services/{service}/review", {
                        "version": 1, "applicability": "VERIFIED", "agreement": "Only synthetic test resources.",
                        "opt_out": "NOT_REQUIRED", "no_training": True,
                    })
                for id, classification in (("protected", "CONFIDENTIAL"), ("public", "PUBLIC")):
                    await api("POST", "resources", {"id": id, "service_id": "github", "path": id + ".txt",
                                                   "commit": "a" * 40, "classification": classification})
                    await api("POST", "workflows", {"resource_id": id, "destination": "fictional_analyzer"})
                session = (await api("POST", "protection/session"))["session"]["id"]

                # An unavailable saved file is a failed observation and cannot authorize reads.
                policy.write_text("", encoding="utf-8")
                await until(lambda state: state["session"]["observation_status"] != "OK")
                failed_id = str(uuid4())
                await submit(session, failed_id, ["protected"])
                failed = await until(lambda state: state["jobs"][0]["items"][0]["finished_at"] is not None)
                assert failed["jobs"][0]["items"][0]["reason"] == "DESTINATION_POLICY_UNAVAILABLE"
                assert not reads
                policy.write_text(SAFE, encoding="utf-8")
                await until(lambda state: state["session"]["observation_status"] == "OK")

                job_id = str(uuid4())
                documents = ["protected", "protected", "protected", "public"]
                assert (await submit(session, job_id, documents))["job_id"] == job_id
                await asyncio.wait_for(entered.wait(), 10)
                # The in-flight document owns the normal gateway lock. The external
                # save is observed before it can commit the new policy.
                policy.write_text(DRIFT, encoding="utf-8")
                _, exposed = await fetch_live_policy(
                    settings.analyzer_policy_url, settings.policy_hosts, fixture_ca=settings.fixture_ca,
                )
                assert exposed == DRIFT
                assert (await api("GET", "protection"))["session"]["current_version"] == 1
                release.set()
                await asyncio.wait_for(fetched_drift.wait(), 10)

                final = await until(lambda state: len(state["jobs"]) == 2 and all(
                    item["finished_at"] is not None for item in state["jobs"][1]["items"]))
                assert final["session"]["current_version"] == 2
                assert final["session"]["approval"] == "REVIEW_REQUIRED"
                assert final["policy_change"]["passages"] == [{"old": SAFE, "new": DRIFT}]
                completed, *held, public = final["jobs"][1]["items"]
                assert completed["policy_version"] == 1 and completed["received_bytes"] == len(protected_body.encode())
                assert all(item["policy_version"] == 2 and item["decision"] == "REVIEW_REQUIRED"
                           and item["delivery"] == "NOT_SENT" and item["receipt_at"] is None for item in held)
                assert public["policy_version"] == 2 and public["delivery"] == "RECEIVED"
                assert final["jobs"][1]["confirmed_files"] == 2
                assert final["jobs"][1]["confirmed_bytes"] == len(protected_body.encode()) + len(b"Synthetic public data")
                assert reads == ["protected.txt", "public.txt"]
                assert (await submit(session, job_id, documents))["item_count"] == 4
                assert len((await api("GET", "protection"))["jobs"]) == 2
                await asyncio.sleep(.35)
                changes = (await api("GET", "dashboard"))["changes"]
                assert sum(row["service_id"] == "fictional_analyzer" and row["previous_id"] is not None for row in changes) == 1
                stop_job = str(uuid4())
                await submit(session, stop_job, ["protected"] * 8)
                stopped = await api("DELETE", "protection/session")
                assert stopped["session"]["stopped_at"]
                assert any(item["status"] == "CANCELLED" and item["receipt_at"] is None
                           for item in stopped["jobs"][-1]["items"])

                # Recovery recognizes already-persisted outcomes and never resends
                # unresolved claims or creates a result for a cancelled item.
                with factory.begin() as db:
                    for entry in (completed, held[0]):
                        db.get(TransferItem, entry["request_id"]).status = "RUNNING"
                    pending_id = str(uuid4())
                    db.add(TransferItem(request_id=pending_id, job_id=job_id, position=10,
                                        resource_id="protected", status="RUNNING"))
                ProtectedQueue(settings, factory, asyncio.Lock(), None, None).recover()
                with factory() as db:
                    assert db.get(TransferItem, pending_id).status == "INTERRUPTED"
                    assert not db.get(Audit, pending_id) and not db.get(Receipt, pending_id)
                    assert db.get(TransferItem, completed["request_id"]).status == "FINISHED"
                    assert db.get(TransferItem, held[0]["request_id"]).status == "FINISHED"

                # An admin-launched synthetic batch holds unclaimed files and resumes
                # only on the exact reviewed baseline, leaving ordinary MCP approval alone.
                policy.write_text(SAFE, encoding="utf-8")
                restored = await api("POST", "services/fictional_analyzer/refresh")
                await api("POST", "services/fictional_analyzer/review", {
                    "version": restored["version"], "applicability": "VERIFIED",
                    "agreement": "Only synthetic test resources.", "opt_out": "NOT_REQUIRED", "no_training": True,
                })
                session = (await api("POST", "protection/session"))["session"]["id"]
                demo_id = str(rehearsal_job_id(settings, session))
                await submit(session, demo_id, ["protected"] * 12)
                await until(lambda state: state["jobs"] and state["jobs"][0]["confirmed_files"] >= 1)
                policy.write_text(DRIFT, encoding="utf-8")
                paused = await until(lambda state: state["rehearsal_policy"] == "PAUSED")
                receipts_at_pause = paused["jobs"][0]["confirmed_files"]
                assert any(item["status"] == "QUEUED" for item in paused["jobs"][0]["items"])
                policy.write_text(SAFE + " Additional terms apply.", encoding="utf-8")
                near_match = await until(lambda state: state["session"]["current_version"] > paused["session"]["current_version"])
                assert near_match["rehearsal_policy"] == "PAUSED"
                assert near_match["jobs"][0]["confirmed_files"] == receipts_at_pause
                policy.write_text(SAFE, encoding="utf-8")
                resumed = await until(lambda state: state["rehearsal_policy"] == "RESTORED"
                                      and state["jobs"][0]["confirmed_files"] > receipts_at_pause)
                assert resumed["session"]["approval"] == "REVIEW_REQUIRED"
                async with httpx.AsyncClient(transport=transport, headers={"Authorization": "Bearer " + AGENT}) as mcp:
                    async with streamable_http_client(ORIGIN + "/mcp/", http_client=mcp) as (incoming, outgoing, _):
                        async with ClientSession(incoming, outgoing) as client:
                            await client.initialize()
                            manual = await invoke(client, "analyze_document", {
                                "document_id": "protected", "destination_service": "fictional_analyzer",
                            })
                assert manual["decision"] == "REVIEW_REQUIRED" and manual["delivery"] == "NOT_SENT"
                await until(lambda state: all(item["finished_at"] for item in state["jobs"][0]["items"]))
        finally:
            fixture.shutdown()
            thread.join()
