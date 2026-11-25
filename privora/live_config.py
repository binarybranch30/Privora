import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url


@dataclass(frozen=True)
class LiveSettings:
    database_url: str
    admin_secret: str
    mcp_secret: str
    policy_hosts: frozenset[str]
    github_command: str = ""
    github_token: str = ""
    github_repo: str = ""
    github_policy_url: str = ""
    chat_url: str = ""
    chat_model: str = ""
    chat_key: str = ""
    check_seconds: int = 900
    stale_seconds: int = 3600
    analyzer_policy_url: str = ""
    analyzer_b_policy_url: str = ""
    demo_public_resource: str = ""
    fixture_ca: str = ""
    queue_resources: frozenset[str] = frozenset()

    demo_resource: str = ""
    demo_count: int = 30
    demo_port: int = 8001
    demo_interval: float = 2.0

    @classmethod
    def load(cls):
        path = Path(os.environ["PRIVORA_LIVE_CONFIG"])
        if not path.is_file():
            raise ValueError("Live settings file was not found")
        values = dotenv_values(path, interpolate=False)
        settings = cls(
            database_url=values["LIVE_DATABASE_URL"], admin_secret=values["LIVE_ADMIN_SECRET"],
            mcp_secret=values["LIVE_MCP_SECRET"],
            policy_hosts=frozenset(v.strip().lower() for v in (values.get("LIVE_POLICY_HOSTS") or "").split(",") if v.strip()),
            github_command=values.get("LIVE_GITHUB_COMMAND") or "", github_token=values.get("LIVE_GITHUB_TOKEN") or "",
            github_policy_url=values.get("LIVE_GITHUB_POLICY_URL") or "",
            github_repo=values.get("LIVE_GITHUB_REPO") or "", chat_url=values.get("LIVE_LLM_URL") or "",
            chat_model=values.get("LIVE_LLM_MODEL") or "", chat_key=values.get("LIVE_LLM_KEY") or "",
            analyzer_policy_url=values.get("LIVE_ANALYZER_POLICY_URL") or "",
            analyzer_b_policy_url=values.get("LIVE_ANALYZER_B_POLICY_URL") or "",
            demo_public_resource=values.get("LIVE_DEMO_PUBLIC_RESOURCE") or "",
            fixture_ca=values.get("LIVE_POLICY_FIXTURE_CA") or "",
            demo_resource=values.get("LIVE_DEMO_RESOURCE") or "",
            demo_count=int(values.get("LIVE_DEMO_COUNT") or 30),
            demo_port=int(values.get("LIVE_DEMO_MCP_PORT") or 8001),
            demo_interval=float(values.get("LIVE_DEMO_ITEM_INTERVAL") or 2),
            queue_resources=frozenset(item.strip() for item in (values.get("LIVE_QUEUE_SYNTHETIC_RESOURCES") or "").split(",") if item.strip()),
        )
        db = make_url(settings.database_url)
        if db.drivername != "postgresql+psycopg" or db.database != "policyguard_live" or db.username != "policyguard_live":
            raise ValueError("Live requires its dedicated PostgreSQL database and role")
        if min(len(settings.admin_secret), len(settings.mcp_secret)) < 24 or settings.admin_secret == settings.mcp_secret:
            raise ValueError("Configure distinct Live admin and MCP secrets of at least 24 characters")
        if any((settings.chat_url, settings.chat_model, settings.chat_key)) and not all((settings.chat_url, settings.chat_model, settings.chat_key)):
            raise ValueError("Complete the optional LLM configuration")
        if settings.queue_resources and not (settings.fixture_ca and settings.analyzer_policy_url):
            raise ValueError("The synthetic queue requires the controlled HTTPS fixture")
        if settings.demo_resource and (
            settings.demo_resource not in settings.queue_resources or not 1 <= settings.demo_count <= 50
            or not 1024 <= settings.demo_port <= 65535 or not 1 <= settings.demo_interval <= 10
        ):
            raise ValueError("Configure an allowlisted demo resource, 1?50 items, a loopback MCP port, and a 1?10 second item interval")
        if settings.analyzer_b_policy_url and (
            settings.analyzer_b_policy_url == settings.analyzer_policy_url or not settings.fixture_ca
            or not settings.demo_resource or settings.demo_public_resource not in settings.queue_resources
            or settings.demo_public_resource == settings.demo_resource
        ):
            raise ValueError("Configure a separate Analyzer B HTTPS policy and a distinct allowlisted public fixture")
        return settings
