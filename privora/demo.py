import hashlib
from typing import Literal

from sqlalchemy import delete

from .db import Audit, Change, Document, Receipt, Review, Rule, Service, Version, now
from .monitor import DEMO_SERVICE, SAFE

DemoDocumentId = Literal["confidential_001", "public_001"]
DEMO_ORG = "demo-org"

DOCUMENTS = (
    ("public_001", "Public release notes", "PUBLIC", "The synthetic sandbox adds report export and improved keyboard navigation."),
    ("confidential_001", "Source-code prototype", "CONFIDENTIAL", "def synthetic_discount(total): return total * 0.08"),
    ("confidential_002", "Business forecast", "CONFIDENTIAL", "Synthetic forecast: Orca pilot projects 120 prototype seats next quarter."),
)


def reset(db):
    for model in (Audit, Receipt, Change, Review, Version, Service, Document, Rule):
        db.execute(delete(model))
    db.add(Rule(id=DEMO_ORG, no_training=True, allow_public=True))
    service = Service(
        id=DEMO_SERVICE, name="External Analyzer", source="fixture://external-analyzer/privacy",
        enabled=True, status="APPROVED", current_version=1, approved_version=1,
        verified_no_training=True, reason="POLICY_APPROVED", last_checked=now(),
    )
    db.add(service)
    db.flush()
    db.add_all([
        Version(service_id=service.id, number=1, content=SAFE, source=service.source, digest=hashlib.sha256(SAFE.encode()).hexdigest()),
        Review(service_id=service.id, version=1, verified_no_training=True, evidence="Synthetic version 1 verified during demo seed."),
        *(Document(id=id_, name=name, classification=classification, body=body, organization_id=DEMO_ORG)
          for id_, name, classification, body in DOCUMENTS),
    ])
