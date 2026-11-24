import re

from sqlalchemy import select

from .db import Change, Version
from .live_models import LiveReview, LiveTransition

MONITORED_ANALYZER = "fictional_analyzer"
MONITORED_SCOPE = "synthetic-fixture"
LOCAL_SCOPE = "local-controlled"


def formatting_equivalent(previous, current):
    def canonical(text):
        return " ".join(re.sub(r"^#{1,6} ", "", line) for line in text.splitlines())

    return canonical(previous) == canonical(current)


def change_for_version(db, service):
    if service is None or service.current_version is None:
        return None
    return db.scalar(
        select(Change).join(Version, Change.version_id == Version.id)
        .where(Version.service_id == service.id, Version.number == service.current_version)
    )


def has_current_review(db, service):
    if not service or not service.current_version:
        return False
    return db.scalar(select(LiveReview.id).where(
        LiveReview.service_id == service.id, LiveReview.version == service.current_version,
    ).limit(1)) is not None


def active_drift(db, service):
    if service is None or service.status != "REVIEW_REQUIRED":
        return None
    change = change_for_version(db, service)
    if not change or not change.previous_id:
        return None
    transition = db.get(LiveTransition, change.id)
    if transition and transition.current_status == "REVIEW_REQUIRED" and not has_current_review(db, service):
        return change
    return None
