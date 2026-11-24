from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Decision:
    decision: Literal["ALLOW", "BLOCK", "REVIEW_REQUIRED"]
    reason: str


def evaluate(classification, service, rule):
    if service is None:
        return Decision("BLOCK", "UNKNOWN_DESTINATION")
    if not service.enabled:
        return Decision("BLOCK", "DESTINATION_DISABLED")
    if classification not in {"PUBLIC", "CONFIDENTIAL"}:
        return Decision("BLOCK", "UNKNOWN_CLASSIFICATION")
    if rule is None:
        return Decision("BLOCK", "UNKNOWN_ORGANIZATION")
    if classification == "PUBLIC":
        if rule.allow_public:
            return Decision("ALLOW", "PUBLIC_TRANSFER_ALLOWED")
        return Decision("BLOCK", "PUBLIC_TRANSFER_PROHIBITED")
    if service.status == "RESTRICTED":
        return Decision("BLOCK", service.reason)
    if (
        service.status != "APPROVED"
        or service.current_version is None
        or service.approved_version != service.current_version
    ):
        return Decision("REVIEW_REQUIRED", service.reason if service.status == "REVIEW_REQUIRED" else "POLICY_REVIEW_REQUIRED")
    if rule.no_training and not service.verified_no_training:
        return Decision("BLOCK", "AI_TRAINING_CONFLICT")
    return Decision("ALLOW", "POLICY_APPROVED")
