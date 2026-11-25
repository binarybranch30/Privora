export type View = "overview" | "investigation" | "policies" | "impact" | "audit" | "configuration";
export type Service = { id: string; name: string; source: string; status: string; enabled: boolean; current_version: number | null; last_checked: string | null; fetch_status?: string; reason?: string };
export type Version = { id: number; service_id: string; number: number; source: string; observed_at: string; digest: string; content: string };
export type Passage = { old: string; new: string };
export type Change = { id: number; service_id: string; previous_id: number | null; version_id: number; enforcement: string; analysis_status: string; observed_at: string; rule: string; reason: string; passages: Passage[]; clauses: { topic: string; new_interpretation: string; reason: string; uncertainty: string; review_action: string }[] };
export type Result = { request_id: string; decision: string; reason: string; classification: string | null; policy_version: number | null; delivery: string };
export type Audit = Result & { timestamp: string; destination: string; operation: string; resource_id?: string | null; source_service?: string | null; source_version?: number | null; workflow_id?: number | null; decision_origin?: string | null; policy_change_id?: number | null; receiver?: string | null; receipt_at?: string | null };
export type Workflow = {
  id: number; resource_id: string; source_service: string; destination: string; operation: string; classification: string;
  decision?: string; reason?: string; evaluated_at?: string; account_scope?: string; rule_id?: string;
  decision_origin?: string; decision_change_id?: number | null; source_version?: number | null; policy_version?: number | null;
  no_training?: boolean; allow_public?: boolean;
};
export type ImpactWorkflow = Workflow & {
  affected: boolean; next_action: string; historical: { count: number; previously_allowed: number; first_received: string | null; last_received: string | null;
    events: Pick<Audit, "request_id" | "timestamp" | "decision" | "delivery" | "classification">[] };
};
export type Impact = {
  policy_change_id: number;
  previous: { version: number; url: string } | null; observed: { version: number; url: string };
  restricted_workflows: number; unaffected_workflows: number; historical_review_candidates: number;
  impacted_classifications: string[]; workflows: ImpactWorkflow[];
};
export type Archive = { service_id: string; release: string; policy_url: string | null; archived_at: string; imported_at: string; content: string; passages: Passage[] };
export type Snapshot = { services: Service[]; versions: Version[]; changes: Change[]; audit: Audit[]; workflows: Workflow[]; archive?: Archive[] };

export const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
export const instant = (value: string) => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z");
export const time = (value?: string | null) => value ? instant(value).toLocaleString() : "Unavailable";
export const version = (value?: number | null) => value == null ? "Unavailable" : "v" + value;
export const isWebUrl = (value: string) => /^https?:\/\//i.test(value);
export const names = (services: Service[], id?: string | null) => id === "demo_documents" ? "Synthetic documents"
  : services.find(service => service.id === id)?.name ?? id ?? "Source unavailable";

export function demoWorkflow(event: Pick<Result, "classification">) {
  return event.classification === "CONFIDENTIAL" ? 1 : event.classification === "PUBLIC" ? 2 : undefined;
}

export function policyForEvent(data: Snapshot, event: Audit) {
  return data.changes.find(change => change.id === event.policy_change_id)
    ?? data.changes.find(change => {
      const record = data.versions.find(item => item.id === change.version_id);
      return record && ((record.service_id === event.destination && record.number === event.policy_version)
        || (record.service_id === event.source_service && record.number === event.source_version));
    });
}

export function changedWords(previous: string, observed: string) {
  const a = previous.match(/\s+|[^\s]+/g) ?? [];
  const b = observed.match(/\s+|[^\s]+/g) ?? [];
  // Bound the comparison for large policy passages.
  if (a.length * b.length > 120_000 || a.length + b.length > 4000) {
    let start = 0;
    let end = 0;
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
    while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
    return [a, b].map(tokens => tokens.map((text, i) => ({ text, changed: i >= start && i < tokens.length - end })));
  }
  const widths = b.length + 1;
  const common = new Uint16Array((a.length + 1) * widths);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * widths + j] = a[i] === b[j]
        ? 1 + common[(i + 1) * widths + j + 1]
        : Math.max(common[(i + 1) * widths + j], common[i * widths + j + 1]);
    }
  }
  const left = a.map(text => ({ text, changed: true }));
  const right = b.map(text => ({ text, changed: true }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      left[i++].changed = false;
      right[j++].changed = false;
    } else if (common[(i + 1) * widths + j] >= common[i * widths + j + 1]) i++;
    else j++;
  }
  return [left, right];
}
