import os
from types import SimpleNamespace

import httpx
import pytest
from alembic import command
from alembic.config import Config

from privora.api import create_app
from privora.engine import evaluate
from privora.gateway import call_gateway, subprocess_session

DESTINATION = "external_analyzer"
CONFIDENTIAL = {"document_id": "confidential_001", "destination_service": DESTINATION}


def test_engine():
    service = SimpleNamespace(enabled=True, status="APPROVED", current_version=1, approved_version=1,
                              verified_no_training=True, reason="POLICY_APPROVED")
    rule = SimpleNamespace(allow_public=True, no_training=True)
    assert evaluate("CONFIDENTIAL", service, rule).decision == "ALLOW"
    assert evaluate("PRIVATE", service, rule).reason == "UNKNOWN_CLASSIFICATION"
    assert evaluate("CONFIDENTIAL", None, rule).reason == "UNKNOWN_DESTINATION"
    service.verified_no_training = False
    assert evaluate("CONFIDENTIAL", service, rule).reason == "AI_TRAINING_CONFLICT"
    service.status, service.reason = "RESTRICTED", "AI_TRAINING_CONFLICT"
    assert evaluate("CONFIDENTIAL", service, rule).decision == "BLOCK"
    assert evaluate("PUBLIC", service, rule).decision == "ALLOW"
    rule.allow_public = False
    assert evaluate("PUBLIC", service, rule).decision == "BLOCK"
    service.status = "UNKNOWN"
    assert evaluate("CONFIDENTIAL", service, rule).decision == "REVIEW_REQUIRED"
    service.status, service.current_version = "APPROVED", 2
    assert evaluate("CONFIDENTIAL", service, rule).decision == "REVIEW_REQUIRED"


@pytest.fixture
def database(tmp_path, monkeypatch):
    url = os.getenv("TEST_DATABASE_URL") or f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    command.upgrade(Config("alembic.ini"), "head")
    return url


@pytest.mark.asyncio
async def test_real_mcp_drift_and_receipts(database, monkeypatch):
    monkeypatch.setenv("PRIVORA_ADMIN_TOKEN", "local-integration-secret")
    app = create_app(database, demo_mode=True)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
            assert (await http.post("/api/demo/reset")).status_code == 200
            assert (await http.get("/api/demo/receipts")).json()["count"] == 0
            first = await call_gateway("http://localhost:8000/mcp/", CONFIDENTIAL, transport)
            assert (first.decision, first.reason, first.policy_version, first.delivery) == (
                "ALLOW", "POLICY_APPROVED", 1, "RECEIVED",
            )
            assert first.analysis and first.analysis.word_count > 0
            receipts = (await http.get("/api/demo/receipts")).json()
            assert receipts == {"count": 1, "request_ids": [first.request_id]}
            drift = await http.post("/api/demo/simulate-policy-change")
            assert drift.json() == {"version": 2, "changed": True, "status": "REVIEW_REQUIRED"}

            second = await call_gateway("http://localhost:8000/mcp/", CONFIDENTIAL, transport)
            assert (second.decision, second.reason, second.policy_version, second.delivery) == (
                "REVIEW_REQUIRED", "AI_TRAINING_CONFLICT", 2, "NOT_SENT",
            )
            assert (await http.get("/api/demo/receipts")).json() == receipts
            unchanged = await http.post("/api/demo/simulate-policy-change")
            assert unchanged.json()["changed"] is False
            versions = (await http.get("/api/policies/versions")).json()
            assert [row["number"] for row in versions] == [2, 1]
            changes = (await http.get("/api/policies/changes")).json()
            assert len(changes) == 1 and changes[0]["analysis_status"] == "COMPLETE"
            assert changes[0]["clauses"][0]["new_clause"] == versions[0]["content"]

            public = await http.post("/api/demo/analyze", json={"document_id": "public_001"})
            assert (public.json()["decision"], public.json()["delivery"]) == ("ALLOW", "RECEIVED")
            assert (await http.get("/api/demo/receipts")).json()["count"] == 2
            unknown = await call_gateway("http://localhost:8000/mcp/", CONFIDENTIAL | {"destination_service": "unknown"}, transport)
            assert unknown.reason == "UNKNOWN_DESTINATION" and unknown.delivery == "NOT_SENT"
            audit = (await http.get("/api/audit")).json()
            assert [(row["reason"], row["policy_version"]) for row in reversed(audit)] == [
                ("POLICY_APPROVED", 1), ("AI_TRAINING_CONFLICT", 2),
                ("PUBLIC_TRANSFER_ALLOWED", 2), ("UNKNOWN_DESTINATION", None),
            ]
            assert "synthetic_discount" not in str(audit)
            path = f"/api/admin/services/{DESTINATION}/review"
            form = {"version": 2, "verified_no_training": False, "evidence": "Opt-out could not be verified."}
            assert (await http.post(path, json=form)).status_code == 403
            headers = {"X-Admin-Token": "local-integration-secret"}
            assert (await http.post(path, json=form | {"version": 1}, headers=headers)).status_code == 409
            assert (await http.post(path, json=form, headers=headers)).json()["status"] == "RESTRICTED"
            denied = await call_gateway("http://localhost:8000/mcp/", CONFIDENTIAL, transport)
            assert denied.decision == "BLOCK"
            assert (await http.get("/api/demo/receipts")).json()["count"] == 2
            verified = form | {"verified_no_training": True, "evidence": "Synthetic account opt-out independently verified."}
            assert (await http.post(path, json=verified, headers=headers)).json()["status"] == "APPROVED"
            restored = await call_gateway("http://localhost:8000/mcp/", CONFIDENTIAL, transport)
            assert restored.delivery == "RECEIVED"
            assert (await http.get("/api/demo/receipts")).json()["count"] == 3

    async with subprocess_session("documents", database) as documents:
        result = await documents.call_tool("document_metadata", {"document_id": "confidential_001"})
        assert result.structuredContent["classification"] == "CONFIDENTIAL"
        assert "content" not in result.structuredContent


async def test_malformed_extraction_and_disabled_demo(database):
    class Malformed:
        async def extract(self, passages):
            return [{"status": "APPROVED"}]

    app = create_app(database, demo_mode=True, extractor=Malformed())
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as http:
            assert (await http.post("/api/demo/reset")).status_code == 200
            assert (await http.post("/api/demo/simulate-policy-change")).json()["status"] == "REVIEW_REQUIRED"
            changes = (await http.get("/api/policies/changes")).json()
            assert changes[0]["analysis_status"] == "FAILED"
            assert changes[0]["passages"] and not changes[0]["clauses"]
            assert (await http.get("/api/demo/receipts")).json()["count"] == 0

    app = create_app(database, demo_mode=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as http:
            for route in ("reset", "simulate-policy-change", "analyze"):
                assert (await http.post(f"/api/demo/{route}")).status_code == 404
            assert (await http.get("/api/health")).json()["demo_mode"] is False
