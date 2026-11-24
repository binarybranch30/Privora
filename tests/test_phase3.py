import os
import shutil
import subprocess
from threading import Thread

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import func, select

from privora.db import Receipt, Service, sessions
from privora.gateway import invoke
from privora.live_api import bootstrap, create_live_app
from privora.live_config import LiveSettings
from privora.live_fetch import fetch_live_policy
from privora.live_policy import formatting_equivalent
from privora.monitor import DRIFT, SAFE
from test_live import ADMIN, AGENT, MUTATION, ORIGIN, URL, migrate
from scripts.serve_policy_fixture import fixture_server

DESTINATION = "fictional_analyzer"
DEST_URL = "https://fixture.example/privacy"


def test_only_cosmetic_equivalence():
    assert formatting_equivalent("## Privacy Policy\n" + SAFE, "# Privacy Policy\n" + SAFE)
    assert not formatting_equivalent(SAFE, DRIFT)
    assert not formatting_equivalent("We do not share records.", "We do share records.")


@pytest.fixture
def local_https(tmp_path, request):
    if not request.param:
        yield None
        return
    openssl = shutil.which("openssl")
    if not openssl:
        pytest.skip("OpenSSL is needed to generate development TLS credentials")
    cert, key, state = (tmp_path / name for name in ("fixture.crt", "fixture.key", "version.txt"))
    subprocess.run([
        openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=Privora Local Fixture", "-addext", "subjectAltName=IP:127.0.0.1",
        "-keyout", str(key), "-out", str(cert),
    ], check=True, capture_output=True, timeout=15)
    state.write_text("1", encoding="ascii")
    with fixture_server(cert, key, state, 0) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield f"https://127.0.0.1:{server.server_port}/privacy", str(cert), state
        finally:
            server.shutdown()
            worker.join()


@pytest.mark.parametrize("local_https", [False, True], indirect=True, ids=["mock-http", "trusted-https"])
async def test_observed_destination_drift_and_impact(tmp_path, local_https):
    db_env = "TEST_PHASE3_TLS_DATABASE_URL" if local_https else "TEST_PHASE3_DATABASE_URL"
    url = os.getenv(db_env) or f"sqlite:///{(tmp_path / 'phase3.db').as_posix()}"
    migrate(url)
    factory = sessions(url)
    with factory.begin() as db:
        bootstrap(db)
    fixture = {"content": SAFE, "unavailable": False}
    connector_reads = []
    destination_url, ca, state = local_https or (DEST_URL, "", None)
    settings = LiveSettings(url, ADMIN, AGENT, frozenset({"policy.example", "fixture.example"}),
                            github_command="fixture", github_token="fixture", github_repo="org/test",
                            github_policy_url=URL, analyzer_policy_url=destination_url, fixture_ca=ca)

    async def fetch(value, hosts, *, fixture_ca=""):
        if fixture_ca:
            return await fetch_live_policy(value, hosts, fixture_ca=fixture_ca)
        async def resolve(_host):
            return "93.184.216.34"

        def handle(request):
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /")
            if request.headers["host"] == "fixture.example" and fixture["unavailable"]:
                return httpx.Response(503)
            policy = fixture["content"] if request.headers["host"] == "fixture.example" else SAFE
            return httpx.Response(200, text=policy)

        return await fetch_live_policy(value, hosts, transport=httpx.MockTransport(handle), resolve=resolve)

    async def read(_settings, _repo, path, _sha):
        connector_reads.append(path)
        return "Synthetic content for testing"

    app = create_live_app(settings, fetch=fetch, read_file=read, schedule=False)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=transport, base_url=ORIGIN) as http:
        assert (await http.get("/api/policy-changes/1/impact")).status_code == 401
        assert (await http.post(f"/api/services/{DESTINATION}/review", json={})).status_code == 401
        login = await http.post("/api/session", json={"secret": ADMIN}, headers=MUTATION)
        assert login.status_code == 200
        headers = MUTATION | {"Cookie": "privora_live_session=" + http.cookies["privora_live_session"]}

        async def api(method, path, payload=None):
            response = await http.request(method, "/api/" + path, headers=headers, json=payload)
            response.raise_for_status()
            return response.json()

        async def transfer(resource, service=DESTINATION):
            async with httpx.AsyncClient(transport=transport, headers={"Authorization": "Bearer " + AGENT}) as client:
                async with streamable_http_client(ORIGIN + "/mcp/", http_client=client) as (incoming, outgoing, _):
                    async with ClientSession(incoming, outgoing) as session:
                        await session.initialize()
                        return await invoke(session, "analyze_document", {"document_id": resource, "destination_service": service})

        def total():
            with factory() as db:
                return db.scalar(select(func.count()).select_from(Receipt))

        await api("POST", "services", {"id": "github", "name": "GitHub test", "url": URL})
        review = {"version": 1, "applicability": "VERIFIED", "opt_out": "NOT_REQUIRED",
                  "agreement": "Verified synthetic test account handling.", "no_training": True}
        for service in ("github", DESTINATION, "local_analyzer"):
            if service != "local_analyzer":
                observed = await api("POST", f"services/{service}/refresh")
                assert observed == {"version": 1, "status": "OK", "changed": True}
            assert (await api("POST", f"services/{service}/review", review))["status"] == "APPROVED"

        for resource, classification in (("protected", "CONFIDENTIAL"), ("public", "PUBLIC")):
            await api("POST", "resources", {"id": resource, "service_id": "github", "path": resource + ".txt",
                                           "commit": "a" * 40, "classification": classification})
            await api("POST", "workflows", {"resource_id": resource, "destination": DESTINATION})

        allowed = await transfer("protected")
        assert (allowed["decision"], allowed["policy_version"], allowed["delivery"]) == ("ALLOW", 1, "RECEIVED")
        assert total() == 1 and connector_reads == ["protected.txt"]
        fixture["content"] = DRIFT
        if state:
            state.write_text("2", encoding="ascii")
        assert await api("POST", f"services/{DESTINATION}/refresh") == {"status": "OK", "version": 2, "changed": True}
        denied = await transfer("protected")
        assert (denied["decision"], denied["reason"], denied["delivery"], denied["analysis"]) == (
            "REVIEW_REQUIRED", "AI_TRAINING_CONFLICT", "NOT_SENT", None,
        )
        assert total() == 1 and connector_reads == ["protected.txt"]
        with factory() as db:
            assert db.get(Receipt, allowed["request_id"]) and not db.get(Receipt, denied["request_id"])
        assert (await transfer("public"))["delivery"] == "RECEIVED"
        assert (await transfer("protected", "local_analyzer"))["delivery"] == "RECEIVED"
        assert total() == 3
        assert not (await api("POST", f"services/{DESTINATION}/refresh"))["changed"]

        dashboard = await api("GET", "dashboard")
        audit = next(row for row in dashboard["audit"] if row["request_id"] == denied["request_id"])
        assert audit["decision_origin"] == "POLICY_DRIFT" and audit["policy_version"] == 2
        impact = await api("GET", f"policy-changes/{audit['policy_change_id']}/impact")
        assert impact["affected_workflows"] == 1 and impact["restricted_workflows"] == 1
        assert impact["unaffected_workflows"] == 1 and impact["historical_review_candidates"] == 1
        assert impact["impacted_classifications"] == ["CONFIDENTIAL"]
        assert impact["previous"]["version"] == 1 and impact["observed"]["version"] == 2
        assert impact["observed"]["url"] == destination_url
        assert impact["evidence"]["passages"] == [{"old": SAFE, "new": DRIFT}]
        protected = next(item for item in impact["workflows"] if item["resource_id"] == "protected")
        assert protected["historical"]["label"] == "HISTORICAL_REVIEW_CANDIDATES"
        assert protected["historical"]["request_ids"] == [allowed["request_id"]]
        stale = await http.post(f"/api/services/{DESTINATION}/review", headers=headers, json=review)
        assert stale.status_code == 409
        if state:
            return

        fixture["content"] = "## Terms\nWe may process submitted information in ways that depend on the service."
        await api("POST", f"services/{DESTINATION}/refresh")
        assert (await transfer("protected"))["decision"] == "REVIEW_REQUIRED"
        assert (await transfer("public"))["decision"] == "ALLOW"
        assert connector_reads.count("protected.txt") == 2

        assert (await api("POST", f"services/{DESTINATION}/review", review | {"version": 3}))["status"] == "APPROVED"
        fixture["content"] = fixture["content"].replace("## Terms", "# Terms")
        assert (await api("POST", f"services/{DESTINATION}/refresh"))["version"] == 4
        with factory() as db:
            analyzer = db.get(Service, DESTINATION)
            assert analyzer.approved_version == 4 and analyzer.reason == "POLICY_APPROVAL_CARRIED_FORWARD"
        fixture["unavailable"] = True
        assert (await api("POST", f"services/{DESTINATION}/refresh"))["status"] == "FETCH_FAILED"
        assert (await transfer("protected"))["reason"] == "DESTINATION_POLICY_UNAVAILABLE"
        assert connector_reads.count("protected.txt") == 2
