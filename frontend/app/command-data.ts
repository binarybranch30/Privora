import { instant, policyForEvent, type Audit, type Change, type Result, type Snapshot, type Impact } from "./investigation-data";

import { linkedTransfers, type VerificationCandidate } from "./incident-data";

export type CommandFrame = {
  id: string;
  kind: "event" | "policy" | "rule" | "impact" | "audit" | "gap";
  title: string;
  detail?: string;
  event?: Result;
  audit?: Audit;
  change?: Change;
};

export function commandFrames(data: Snapshot, focus?: Result, observed?: Change, preferred?: Change, live = false) {
  const record = data.audit.find(row => row.request_id === focus?.request_id);
  const recordedChange = record && policyForEvent(data, record);
  const automatic = preferred ?? data.changes.find(item => item.previous_id != null) ?? data.changes[0];
  const change = observed ?? recordedChange ?? (record ? undefined : automatic);
  const previous = data.versions.find(row => row.id === change?.previous_id);
  const current = data.versions.find(row => row.id === change?.version_id);
  const cutoff = change ? instant(change.observed_at).getTime() : undefined;
  const policyMatches = (row: Audit, number?: number) => number != null &&
    ((row.destination === change?.service_id && row.policy_version === number) ||
      (row.source_service === change?.service_id && row.source_version === number));
  const held = change && data.audit.find(row => row.classification === "CONFIDENTIAL" && row.delivery === "NOT_SENT"
    && ["BLOCK", "REVIEW_REQUIRED"].includes(row.decision)
    && (row.policy_change_id === change.id || (!live && policyMatches(row, current?.number) && row.reason === change.reason)));
  const prior = change && cutoff != null && data.audit.find(row =>
    row.classification === "CONFIDENTIAL" && row.decision === "ALLOW" && row.delivery === "RECEIVED"
    && (held?.workflow_id == null || held.workflow_id === row.workflow_id)
    && policyMatches(row, previous?.number) && instant(row.timestamp).getTime() <= cutoff);
  const timeline: CommandFrame[] = [];

  const transfer = (source: Result, audit?: Audit, associated?: Change): CommandFrame => ({
    id: source.request_id, kind: "event", event: source, audit, change: associated,
    title: source.decision === "ALLOW" && source.delivery === "RECEIVED" ? source.classification === "PUBLIC" ? "Public delivery" : "Delivered"
      : source.decision === "REVIEW_REQUIRED" || source.decision === "BLOCK" ? "Intercepted" : "Transfer decision",
  });

  if (prior) timeline.push(transfer(prior, prior));
  if (change) {
    timeline.push({ id: "policy:" + change.id, kind: "policy", title: "Policy observation", change });
    if (change.enforcement === "REVIEW_REQUIRED" || change.enforcement === "RESTRICTED" || change.enforcement === "BLOCK") {
      timeline.push({ id: "rule:" + change.id, kind: "rule", title: "Rule applied", change });
    }
  }
  if (held) timeline.push(transfer(held, held, change));
  const fallback = focus ?? (!timeline.length ? data.audit[0] : undefined);
  if (fallback && !timeline.some(row => row.id === fallback.request_id)) {
    timeline.push(transfer(fallback, record ?? data.audit.find(row => row.request_id === fallback.request_id), recordedChange));
  }
  if (change && live) timeline.push({ id: "impact:" + change.id, kind: "impact", title: "Impact & audit", change });
  else if (held) timeline.push({ id: "evidence:" + held.request_id, kind: "audit", title: "Audit evidence", change, audit: held });
  return timeline;
}

export function investigationFrames(data: Snapshot, live: boolean, change?: Change, focus?: Audit, impact?: Impact, verified?: VerificationCandidate) {
  const frames: CommandFrame[] = [];
  const transfer = (row: Audit, title: string): CommandFrame => ({
    id: row.request_id, kind: "event", title, event: row, audit: row, change,
  });
  if (!change) return focus ? [transfer(focus, "Recorded transfer")] : frames;
  const related = linkedTransfers(data, change, live).slice().sort((a, b) => instant(a.timestamp).getTime() - instant(b.timestamp).getTime());
  const linked = verified?.withheld ?? (focus && related.find(row => row.request_id === focus.request_id)) ?? related.find(row => row.delivery === "NOT_SENT") ?? related[0];
  const scopedPaths = linked?.workflow_id != null ? impact?.workflows.filter(path => path.id === linked.workflow_id) : impact?.workflows.filter(path => path.affected);
  const historical = scopedPaths?.flatMap(path => path.historical.events) ?? [];
  const prior = verified?.delivered ?? data.audit.find(row => historical.some(item => item.request_id === row.request_id)
    && row.decision === "ALLOW" && row.delivery === "RECEIVED");
  if (prior) frames.push({ ...transfer(prior, "Before the change"), change: undefined });
  else frames.push({ id: "before:" + change.id, kind: "gap", title: "Before the change",
    detail: impact ? (historical.length ? "An earlier delivery is listed in impact evidence. Its full audit record is outside this dashboard snapshot."
      : "No earlier confirmed confidential delivery is linked in the available impact evidence.")
      : "Earlier delivery evidence is unavailable in this view." });
  frames.push({ id: "policy:" + change.id, kind: "policy", title: "Policy observation", change });
  frames.push({ id: "rule:" + change.id, kind: "rule", title: "Organization rule", change });
  if (linked) frames.push(transfer(linked, "Gateway response"));
  else frames.push({ id: "response:" + change.id, kind: "gap", title: "Gateway response", change,
    detail: "No linked gateway decision is available in the recent audit records." });
  if (verified) frames.push(transfer(verified.public, "Public control"));
  frames.push({ id: "impact:" + change.id, kind: "impact", title: "Workflow impact", change });
  return frames;
}
