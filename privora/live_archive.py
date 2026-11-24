import hashlib
import re
import zipfile
from datetime import datetime, timezone
from pathlib import PurePosixPath

from sqlalchemy import select

from .live_models import ArchiveVersion
from .monitor import LIMIT, normalize

RELEASE = re.compile(r"https://github\.com/OpenTermsArchive/(?:france|contrib)-versions/releases/tag/[A-Za-z0-9_.-]+")


def import_archive(db, service, archive, release, provider, terms, policy_url=None):
    if not RELEASE.fullmatch(release) or any("/" in item or not item.strip() for item in (provider, terms)):
        raise ValueError("Provide a supported pinned release and exact provider and terms names")
    with zipfile.ZipFile(archive) as dataset:
        entries = [item for item in dataset.infolist() if PurePosixPath(item.filename).parts[-3:-1] == (provider, terms) and item.filename.endswith(".md")]
        if not entries or len(entries) > 500 or sum(item.file_size for item in entries) > 20_000_000:
            raise ValueError("Archive selection is absent or exceeds import bounds")
        count = 0
        for entry in entries:
            if entry.file_size > LIMIT:
                raise ValueError("Archive document exceeds import bounds")
            stamp = PurePosixPath(entry.filename).stem
            archived_at = datetime.strptime(stamp, "%Y-%m-%dT%H-%M-%SZ").replace(tzinfo=timezone.utc)
            known = db.scalar(select(ArchiveVersion.id).where(
                ArchiveVersion.service_id == service.id, ArchiveVersion.release == release,
                ArchiveVersion.archived_at == archived_at,
            ))
            if known is None:
                with dataset.open(entry) as stream:
                    body = normalize(stream.read(LIMIT + 1).decode("utf-8"))
                if not body or len(body.encode()) > LIMIT:
                    raise ValueError("Archive document is empty or too large")
                db.add(ArchiveVersion(service_id=service.id, release=release, policy_url=policy_url,
                                      archived_at=archived_at, content=body, digest=hashlib.sha256(body.encode()).hexdigest()))
                db.flush()
                count += 1
        return count
