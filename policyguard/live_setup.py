import argparse

from alembic import command
from alembic.config import Config

from .db import Service, sessions
from .live_api import bootstrap
from .live_archive import import_archive
from .live_config import LiveSettings
from .live_models import LiveIdentity


def main():
    parser = argparse.ArgumentParser(description="Provision Live storage or import Open Terms Archive history")
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("migrate")
    archive = sub.add_parser("import-archive")
    for argument in ("service_id", "archive", "release", "provider", "terms"):
        archive.add_argument(argument)
    archive.add_argument("--policy-url")
    args = parser.parse_args()
    settings = LiveSettings.load()
    if args.operation == "migrate":
        config = Config("alembic.ini")
        config.attributes["database_url"] = settings.database_url
        command.upgrade(config, "head")
    with sessions(settings.database_url).begin() as db:
        live = db.get(LiveIdentity, 1)
        if args.operation == "migrate":
            if live is None:
                bootstrap(db)
            print("Live database ready")
        else:
            service = db.get(Service, args.service_id)
            if live is None or service is None or not service.source.startswith("https://"):
                parser.error("Provision Live and register a direct policy source first")
            count = import_archive(db, service, args.archive, args.release, args.provider, args.terms, args.policy_url)
            print(f"Imported {count} historical versions")


if __name__ == "__main__":
    main()
