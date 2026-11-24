import io
import os
import zipfile

import httpx
import pytest
from alembic import command
from alembic.config import Config
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import func, select

from privora.api import create_app
from privora.db import Audit, Receipt, Service, sessions
from privora.gateway import ToolDecision, invoke
from privora.live_api import bootstrap, create_live_app
from privora.live_archive import import_archive
from privora.live_config import LiveSettings
from privora.live_connector import github_text
from privora.live_fetch import FetchError, fetch_live_policy
from privora.live_client import verify_transfer

ORIGIN = "http://localhost:8001"
URL = "https://policy.example/privacy"
ADMIN = "local-test-admin-secret-not-real"
AGENT = "local-test-mcp-secret-not-real"
MUTATION = {"X-Privora-Live": "1"}


def migrate(url):
    config = Config("alembic.ini")
    config.attributes["database_url"] = url
    command.upgrade(config, "head")


async def test_fetch_policy_uses_pinned_ip_and_robots():
    state = {"response": "<main><p>We retain account records for thirty days.</p></main>"}
    seen = []

    async def resolve(host):
        assert host == "policy.example"
        return "93.184.216.34"

    def handler(request):
        assert request.url.host == "93.184.216.34"
        assert request.headers["host"] == "policy.example"
        assert request.extensions["sni_hostname"] == "policy.example"
        seen.append(request.url.path)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=state.get("robots", "User-agent: *\nAllow: /"))
        if state.get("redirect"):
            return httpx.Response(302, headers={"Location": state["redirect"]})
        return httpx.Response(200, html=state["response"])

    async def fetch():
        return await fetch_live_policy(URL, {"policy.example"}, transport=httpx.MockTransport(handler), resolve=resolve)

    assert await fetch() == (URL, "We retain account records for thirty days.")
    assert seen == ["/robots.txt", "/privacy"]
    state["robots"] = "User-agent: *\nDisallow: /privacy"
    with pytest.raises(FetchError, match="ROBOTS_DENIED"):
        await fetch()
    state.pop("robots")
    state["redirect"] = "https://127.0.0.1/private"
    with pytest.raises(FetchError, match="URL_NOT_ALLOWLISTED"):
        await fetch()
    state.pop("redirect")
    state["response"] = "<main></main>"
    with pytest.raises(FetchError, match="MALFORMED_POLICY"):
        await fetch()


async def test_live_and_demo_isolation(tmp_path):
    live_url = os.getenv("TEST_LIVE_DATABASE_URL") or f"sqlite:///{(tmp_path / 'live.db').as_posix()}"
    demo_url = f"sqlite:///{(tmp_path / 'demo.db').as_posix()}"
    for url in (live_url, demo_url):
        migrate(url)
    live_db = sessions(live_url)
    with live_db.begin() as db:
        bootstrap(db)
    settings = LiveSettings(live_url, ADMIN, AGENT, frozenset({"policy.example"}), github_command="fixture",
                            github_token="fixture", github_repo="org/test", github_policy_url=URL)
    fixture = {"text": "We do not train models on customer materials."}
    reads = []

    async def fetch(url, hosts):
        assert url == URL and hosts == settings.policy_hosts
        if fixture.get("unavailable"):
            raise FetchError("POLICY_UNAVAILABLE")
        return url, fixture["text"]

    async def read(_settings, repo, path, sha):
        reads.append((repo, path, sha))
        return "Synthetic protected test content"

    live = create_live_app(settings, fetch=fetch, read_file=read, schedule=False)
    demo = create_app(demo_url, demo_mode=True)
    mistaken_demo = create_app(live_url, demo_mode=True)
    with pytest.raises(RuntimeError, match="cannot use a Live database"):
        async with mistaken_demo.router.lifespan_context(mistaken_demo):
            pytest.fail("Demo accepted the Live database")

    async with live.router.lifespan_context(live), demo.router.lifespan_context(demo):
        transport = httpx.ASGITransport(app=live)
        async with httpx.AsyncClient(transport=transport, base_url=ORIGIN) as http:
            assert (await http.get("/api/dashboard")).status_code == 401
            assert (await http.post("/api/session", json={"secret": AGENT}, headers=MUTATION)).status_code == 401
            assert (await http.post("/mcp/", headers={"Authorization": "Bearer " + ADMIN})).status_code == 401
            assert (await http.post("/api/session", json={"secret": ADMIN}, headers=MUTATION)).status_code == 200
            token = http.cookies["privora_live_session"]
            headers = MUTATION | {"Cookie": "privora_live_session=" + token}
            register = {"id": "github", "name": "GitHub", "url": URL}
            assert (await http.post("/api/services", headers={"Cookie": headers["Cookie"]}, json=register)).status_code == 403
            assert (await http.post("/api/services", headers=headers, json=register)).status_code == 201
            assert (await http.post("/api/demo/reset", headers=headers)).status_code == 404
            assert (await http.post("/api/demo/simulate-policy-change", headers=headers)).status_code == 404

            async def dashboard():
                response = await http.get("/api/dashboard", headers=headers)
                response.raise_for_status()
                return response.json()

            async def refresh():
                response = await http.post("/api/services/github/refresh", headers=headers)
                response.raise_for_status()
                return response.json()

            async def review(service, **changes):
                data = {"version": 1, "applicability": "VERIFIED", "agreement": "Account agreement has been checked.",
                        "opt_out": "NOT_REQUIRED", "no_training": True} | changes
                response = await http.post(f"/api/services/{service}/review", json=data, headers=headers)
                response.raise_for_status()
                return response.json()["status"]

            assert await refresh() == {"status": "OK", "version": 1, "changed": True}
            assert not (await refresh())["changed"]
            assert await review("github", applicability="UNKNOWN") == "REVIEW_REQUIRED"
            assert await review("local_analyzer") == "APPROVED"
            registration = {"id": "sample", "service_id": "github", "path": "README.md", "commit": "a" * 40,
                            "classification": "CONFIDENTIAL"}
            assert (await http.post("/api/resources", headers=headers, json=registration | {"path": "../README.md"})).status_code == 422
            assert (await http.post("/api/resources", headers=headers, json=registration)).status_code == 201

            async def transfer(document="sample"):
                async with httpx.AsyncClient(transport=transport, headers={"Authorization": "Bearer " + AGENT}) as client:
                    async with streamable_http_client(ORIGIN + "/mcp/", http_client=client) as (incoming, outgoing, _):
                        async with ClientSession(incoming, outgoing) as session:
                            await session.initialize()
                            assert [tool.name for tool in (await session.list_tools()).tools] == ["analyze_document"]
                            return await invoke(session, "analyze_document", {"document_id": document, "destination_service": "local_analyzer"})

            def count(model):
                with live_db() as db:
                    return db.scalar(select(func.count()).select_from(model))

            denied = await transfer()
            assert denied["reason"] == "CONTRACT_APPLICABILITY_UNKNOWN" and count(Receipt) == 0 and not reads
            assert await review("github") == "APPROVED"
            allowed = await transfer()
            assert allowed["delivery"] == "RECEIVED" and count(Receipt) == 1 and len(reads) == 1
            with live_db() as db:
                evidence = verify_transfer(db, "sample", ToolDecision.model_validate(allowed), "allowed", word_count=4)
                assert evidence == {
                    "analyzer_receipt": True, "resource_id": "sample", "source_service": "github",
                    "source_policy_version": 1, "destination_profile": "local-word-count-v1",
                    "destination_policy_version": 1,
                }
            assert await review("local_analyzer", applicability="UNKNOWN") == "REVIEW_REQUIRED"
            denied = await transfer()
            with live_db() as db:
                evidence = verify_transfer(db, "sample", ToolDecision.model_validate(denied), "blocked",
                                           "CONTRACT_APPLICABILITY_UNKNOWN")
                assert evidence["analyzer_receipt"] is False
            assert count(Receipt) == 1 and len(reads) == 1
            assert await review("local_analyzer") == "APPROVED"
            fixture["unavailable"] = True
            assert (await refresh())["status"] == "POLICY_UNAVAILABLE"
            assert (await transfer())["reason"] == "SOURCE_POLICY_UNAVAILABLE"
            fixture.pop("unavailable")
            fixture["text"] = "We may train AI models on customer materials unless opted out."
            assert (await refresh())["version"] == 2
            denied = await transfer()
            assert denied["decision"] == "REVIEW_REQUIRED" and denied["delivery"] == "NOT_SENT"
            assert count(Receipt) == 1 and len(reads) == 1
            assert (await transfer("unregistered"))["reason"] == "UNKNOWN_DOCUMENT"
            assert count(Audit) == 6
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w") as dataset:
                dataset.writestr("GitHub/Privacy Policy/2024-02-03T12-00-00Z.md", "Historical policy evidence.")
            with live_db.begin() as db:
                release = "https://github.com/OpenTermsArchive/france-versions/releases/tag/sample-2024"
                assert import_archive(db, db.get(Service, "github"), archive, release, "GitHub", "Privacy Policy", URL) == 1
                assert import_archive(db, db.get(Service, "github"), archive, release, "GitHub", "Privacy Policy", URL) == 0
            view = await dashboard()
            assert view["archive"][0]["archived_at"].startswith("2024-02-03T12:00")
            assert len(view["versions"]) == 3 and view["audit"][1]["source_version"] == 2
            assert "Synthetic protected test content" not in str(view)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=demo), base_url="http://localhost:8000") as demo_http:
                assert (await demo_http.post("/api/demo/reset")).status_code == 200
                assert [row["id"] for row in (await demo_http.get("/api/services")).json()] == ["external_analyzer"]
                assert (await demo_http.get("/api/dashboard", headers=headers)).status_code == 404
            assert count(Audit) == 6 and count(Receipt) == 1


async def test_github_connector_rejects_wrong_repository_before_start():
    settings = LiveSettings("unused", ADMIN, AGENT, frozenset(), github_command="foo", github_token="fixture",
                            github_repo="org/test")
    with pytest.raises(ValueError, match="unavailable"):
        await github_text(settings, "other/repo", "README.md", "a" * 40)


async def test_github_connector_accepts_only_exact_resource(monkeypatch):
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from privora import live_connector

    commit = "a" * 40
    uri = f"repo://org/test/sha/{commit}/contents/README.md"
    result = {"uri": uri}
    settings = LiveSettings("unused", ADMIN, AGENT, frozenset(), github_command="fixture", github_token="fixture",
                            github_repo="org/test")

    @asynccontextmanager
    async def transport(params):
        assert params.command == "fixture"
        assert params.args == ["--read-only", "--tools", "get_file_contents", "stdio"]
        assert set(params.env) == {"GITHUB_PERSONAL_ACCESS_TOKEN"}
        yield None, None

    class Session:
        def __init__(self, *_streams):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def initialize(self):
            pass

        async def call_tool(self, name, args):
            assert name == "get_file_contents"
            assert args == {"owner": "org", "repo": "test", "path": "README.md", "sha": commit}
            return SimpleNamespace(isError=False, content=[
                SimpleNamespace(type="text", text=f"successfully downloaded text file (SHA: {commit})"),
                SimpleNamespace(type="resource", resource=SimpleNamespace(uri=result["uri"], text="Approved text"))
            ])

    monkeypatch.setattr(live_connector, "stdio_client", transport)
    monkeypatch.setattr(live_connector, "ClientSession", Session)
    assert await github_text(settings, "org/test", "README.md", commit) == "Approved text"
    result["uri"] = uri.replace("README.md", "elsewhere/README.md")
    with pytest.raises(ValueError, match="exact registered"):
        await github_text(settings, "org/test", "README.md", commit)


def test_live_configuration_ignores_demo_database(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://policyguard:placeholder@localhost/policyguard")
    config = tmp_path / "live.env"
    monkeypatch.setenv("PRIVORA_LIVE_CONFIG", str(config))
    content = f"LIVE_ADMIN_SECRET={ADMIN}\nLIVE_MCP_SECRET={AGENT}\n"
    config.write_text(content + "LIVE_DATABASE_URL=postgresql+psycopg://policyguard:placeholder@localhost/policyguard\n")
    with pytest.raises(ValueError, match="dedicated PostgreSQL database"):
        LiveSettings.load()
    config.write_text(content + "LIVE_DATABASE_URL=postgresql+psycopg://policyguard_live:placeholder@localhost/policyguard_live\n")
    assert LiveSettings.load().database_url.endswith("/policyguard_live")
