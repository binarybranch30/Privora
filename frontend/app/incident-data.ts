import { instant, type Audit, type Change, type Impact, type Snapshot } from "./investigation-data";

// Identifiers documented by the credentialed integration run. They locate records;
// the replay takes its timestamps, decisions, clauses and counts from the API.
const verifiedIds = {
  delivered: "c786181a-7eaf-41ab-91df-6da860c770ef",
  withheld: "874c30ad-7f2c-461f-88ad-e00bfd2f805e",
  public: "3e8818ac-a01b-4c6b-bab4-a9efb2e1414b",
};
export type VerificationCandidate = { change: Change; delivered: Audit; withheld: Audit; public: Audit };

export function linkedTransfers(data: Snapshot, change: Change, live: boolean) {
  const observed = data.versions.find(row => row.id === change.version_id);
  return data.audit.filter(row => row.policy_change_id === change.id || (!live && observed
    && row.destination === change.service_id && row.policy_version === observed.number
    && row.decision === "REVIEW_REQUIRED" && row.reason === change.reason
    && instant(row.timestamp).getTime() >= instant(change.observed_at).getTime()));
}

export function changeForInvestigation(data: Snapshot, event: Audit, live: boolean) {
  return data.changes.find(change => linkedTransfers(data, change, live).some(row => row.request_id === event.request_id));
}

export function verificationCandidate(data: Snapshot): VerificationCandidate | undefined {
  const delivered = data.audit.find(row => row.request_id === verifiedIds.delivered);
  const withheld = data.audit.find(row => row.request_id === verifiedIds.withheld);
  const publicControl = data.audit.find(row => row.request_id === verifiedIds.public);
  if (!delivered || !withheld || !publicControl || withheld.policy_change_id == null) return;
  const change = data.changes.find(row => row.id === withheld.policy_change_id);
  const previous = data.versions.find(row => row.id === change?.previous_id);
  const observed = data.versions.find(row => row.id === change?.version_id);
  const path = data.workflows.find(row => row.id === withheld.workflow_id);
  if (!change || !previous || !observed || !path || change.service_id !== "fictional_analyzer"
    || path.resource_id !== "github_confidential_fixture" || path.destination !== change.service_id
    || delivered.workflow_id !== path.id || delivered.resource_id !== withheld.resource_id
    || delivered.source_service !== "github" || withheld.source_service !== "github"
    || delivered.destination !== change.service_id || withheld.destination !== change.service_id
    || delivered.classification !== "CONFIDENTIAL" || withheld.classification !== "CONFIDENTIAL"
    || delivered.decision !== "ALLOW" || delivered.delivery !== "RECEIVED" || delivered.policy_version !== previous.number
    || withheld.decision !== "REVIEW_REQUIRED" || withheld.delivery !== "NOT_SENT" || withheld.policy_version !== observed.number
    || withheld.decision_origin !== "POLICY_DRIFT"
    || publicControl.destination !== change.service_id || publicControl.classification !== "PUBLIC"
    || publicControl.decision !== "ALLOW" || publicControl.delivery !== "RECEIVED" || publicControl.policy_version !== observed.number
    || instant(delivered.timestamp).getTime() >= instant(change.observed_at).getTime()
    || instant(withheld.timestamp).getTime() < instant(change.observed_at).getTime()) return;
  return { change, delivered, withheld, public: publicControl };
}

export function confirmsVerification(candidate: VerificationCandidate, impact: Impact) {
  return impact.policy_change_id === candidate.change.id && impact.workflows.some(row => row.id === candidate.withheld.workflow_id
    && row.affected && row.historical.events.some(event => event.request_id === candidate.delivered.request_id && event.delivery === "RECEIVED"))
    && impact.workflows.some(row => row.id === candidate.public.workflow_id && !row.affected);
}
