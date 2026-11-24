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
    fixture_ca: str = ""

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
            fixture_ca=values.get("LIVE_POLICY_FIXTURE_CA") or "",
        )
        db = make_url(settings.database_url)
        if db.drivername != "postgresql+psycopg" or db.database != "policyguard_live" or db.username != "policyguard_live":
            raise ValueError("Live requires its dedicated PostgreSQL database and role")
        if min(len(settings.admin_secret), len(settings.mcp_secret)) < 24 or settings.admin_secret == settings.mcp_secret:
            raise ValueError("Configure distinct Live admin and MCP secrets of at least 24 characters")
        if any((settings.chat_url, settings.chat_model, settings.chat_key)) and not all((settings.chat_url, settings.chat_model, settings.chat_key)):
            raise ValueError("Complete the optional LLM configuration")
        return settings
