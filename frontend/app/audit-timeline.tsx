import { ArrowRight, Copy } from "lucide-react";
import { useState } from "react";
import { instant, label, names, time, version, type Audit, type Snapshot } from "./investigation-data";
import { Status } from "./status";

const reasons: Record<string, string> = {
  AI_TRAINING_CONFLICT: "The policy conflicts with the organization's rule against AI training on confidential documents.",
  POLICY_APPROVED: "The destination had approval for this policy version, and the request met the organization's rule.",
  PUBLIC_TRANSFER_ALLOWED: "The document was classified as public, and the organization's rule permits public transfers.",
  PUBLIC_TRANSFER_PROHIBITED: "The organization's rule does not permit public transfers.",
  POLICY_REVIEW_REQUIRED: "The destination lacked a current approval for confidential transfers.",
  DESTINATION_PROFILE_UNAPPROVED: "The destination profile did not have a current approval.",
  DESTINATION_POLICY_UNAVAILABLE: "The monitored destination policy was unavailable or overdue for verification.",
  SOURCE_POLICY_UNAVAILABLE: "The source policy was unavailable or overdue for verification.",
  CONNECTOR_UNAVAILABLE: "The trusted connector could not complete the request.",
  UNKNOWN_DOCUMENT: "Privora could not identify an eligible document for this request.",
  UNKNOWN_DESTINATION: "Privora could not identify an eligible destination for this request.",
  DESTINATION_DISABLED: "Transfers to this destination were disabled.",
};

export function explainDecision(event: Pick<Audit, "reason" | "decision">) {
  return reasons[event.reason] ?? (event.decision === "ALLOW"
    ? "The gateway permitted this request under the applicable policy."
    : event.decision === "REVIEW_REQUIRED" ? "The gateway held this request pending review." : "The gateway denied this request.");
}

export function EventRows({ events, data, onSelect, selected }: { events: Audit[]; data: Snapshot; onSelect: (event: Audit) => void; selected?: string }) {
  return <ol className="event-list">
    {events.map(event => <li key={event.request_id}>
      <button aria-pressed={event.request_id === selected} onClick={() => onSelect(event)}>
        <time dateTime={event.timestamp}>{instant(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        <Status value={event.decision} />
        <span className="event-route">{event.source_service === "demo_documents" ? "Synthetic documents" : names(data.services, event.source_service)} <ArrowRight size={13} /> {names(data.services, event.destination)}</span>
        <span className="event-delivery">{label(event.delivery)}</span>
        <small className="event-why">{explainDecision(event)}</small>
      </button>
    </li>)}
  </ol>;
}

export function EventDetails({ event }: { event: Audit }) {
  const [copy, setCopy] = useState("");
  async function copyId() {
    try { await navigator.clipboard.writeText(event.request_id); setCopy("Request ID copied."); }
    catch { setCopy("Clipboard unavailable. Select the request ID to copy it."); }
  }
  return <>
    <p><Status value={event.decision} /> <Status value={event.delivery} /></p>
    <div className="audit-explanation">
      <h3>Why the gateway made this decision</h3><p>{explainDecision(event)}</p>
      <h3>Delivery evidence</h3><p>{event.delivery === "RECEIVED" ? "The analyzer confirmed receipt of this request."
        : event.delivery === "NOT_SENT" ? "The gateway did not forward this request to the analyzer."
          : "The available record does not confirm analyzer delivery."}</p>
    </div>
    <dl className="facts">
      <dt>Timestamp</dt><dd>{time(event.timestamp)}</dd>
      <dt>Operation</dt><dd><code>{event.operation}</code></dd>
      <dt>Classification</dt><dd>{event.classification ? label(event.classification) : "Unavailable"}</dd>
      <dt>Reason</dt><dd><code>{event.reason}</code></dd>
      {event.decision_origin && <><dt>Decision origin</dt><dd>{label(event.decision_origin)}</dd></>}
      <dt>Source policy</dt><dd>{version(event.source_version)}</dd>
      <dt>Destination policy</dt><dd>{version(event.policy_version)}</dd>
      {event.receiver && <><dt>Confirmed receiver</dt><dd>{event.receiver === "fictional_analyzer" ? "Analyzer A" : event.receiver === "fictional_analyzer_b" ? "Analyzer B" : event.receiver}</dd></>}
      {event.receipt_at && <><dt>Received at</dt><dd>{time(event.receipt_at)}</dd></>}
      <dt>Request ID</dt><dd><code>{event.request_id}</code></dd>
    </dl>
    <button className="ghost" onClick={() => void copyId()}><Copy size={14} /> Copy request ID</button>
    {copy && <p role="status">{copy}</p>}
  </>;
}

export function AuditTimeline({ data, selected, choose, inspect }: { data: Snapshot; selected?: string; choose: (event: Audit) => void; inspect: (event: Audit) => React.ReactNode }) {
  const [service, setService] = useState("");
  const [decision, setDecision] = useState("");
  const [classification, setClassification] = useState("");
  const [range, setRange] = useState("");
  const [end, setEnd] = useState("");
  const [policy, setPolicy] = useState("");
  const cutoff = range ? new Date(range).getTime() : -Infinity;
  const until = end ? new Date(end).getTime() : Infinity;
  const events = data.audit.filter(event => (!service || [event.source_service, event.destination].includes(service))
    && (!decision || event.decision === decision) && (!classification || event.classification === classification)
    && (!policy || [event.source_version, event.policy_version].some(number => String(number) === policy))
    && instant(event.timestamp).getTime() >= cutoff && instant(event.timestamp).getTime() <= until);
  const event = events.find(row => row.request_id === selected) ?? events[0];
  const services = Array.from(new Set(data.audit.flatMap(row => row.source_service ? [row.source_service, row.destination] : [row.destination])));
  const versions = Array.from(new Set(data.audit.flatMap(row => [row.source_version, row.policy_version]).filter(number => number != null))).sort((a, b) => a - b);
  return <>
    <div className="audit-filters">
      <label>Service<select aria-label="Service" value={service} onChange={e => setService(e.target.value)}><option value="">All services</option>{services.map(id => <option key={id} value={id}>{id === "demo_documents" ? "Synthetic documents" : names(data.services, id)}</option>)}</select></label>
      <label>Decision<select aria-label="Decision" value={decision} onChange={e => setDecision(e.target.value)}><option value="">All decisions</option>{["ALLOW", "REVIEW_REQUIRED", "BLOCK"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Classification<select aria-label="Classification" value={classification} onChange={e => setClassification(e.target.value)}><option value="">All classifications</option><option value="PUBLIC">Public</option><option value="CONFIDENTIAL">Confidential</option></select></label>
      <label>From <input type="datetime-local" value={range} onChange={e => setRange(e.target.value)} /></label>
      <label>To <input type="datetime-local" min={range || undefined} value={end} onChange={e => setEnd(e.target.value)} /></label>
      <label>Policy version<select aria-label="Policy version" value={policy} onChange={e => setPolicy(e.target.value)}><option value="">All versions</option>{versions.map(number => <option key={number} value={number}>v{number}</option>)}</select></label>
    </div>
    <div className="investigation-grid audit-layout">
      <section><h2>{events.length} of {data.audit.length} recent events</h2><p className="muted">Filters apply to the latest 100 available records.</p>
        {events.length ? <EventRows events={events} data={data} selected={event?.request_id} onSelect={choose} /> : <p className="empty">No transfers match these filters.</p>}
      </section>
      <aside className="inspector"><h2>Event details</h2>{event ? inspect(event) : <p className="muted">Select a transfer to inspect its policy and delivery evidence.</p>}</aside>
    </div>
  </>;
}
