"use client";

import { FormEvent, useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";

type Service = { id: string; name: string; status: string; current_version: number | null; source: string; last_checked: string | null; last_attempt: string | null; fetch_status: string };
type Version = { id: number; service_id: string; number: number; observed_at: string; source: string; content: string };
type Change = { id: number; service_id: string; previous_id: number | null; version_id: number; enforcement: string; analysis_status: string; rule: string; reason: string; passages: { old: string; new: string }[]; clauses: { topic: string; new_interpretation: string; reason: string; uncertainty: string; review_action: string }[] };
type Audit = { request_id: string; resource_id: string | null; classification: string | null; source_service: string | null; source_version: number | null; destination: string; destination_profile: string | null; policy_version: number | null; decision: string; delivery: string; reason: string; timestamp: string; decision_origin: string | null; policy_change_id: number | null };
type Historical = { service_id: string; release: string; policy_url: string | null; archived_at: string; imported_at: string; content: string; passages: { old: string; new: string }[] };
type Dashboard = {
  services: Service[]; versions: Version[]; changes: Change[]; audit: Audit[]; archive: Historical[];
  resources: { id: string; service_id: string; classification: string }[]; connector_configured: boolean;
};
type Impact = {
  previous: { version: number; url: string } | null;
  observed: { version: number; url: string };
  affected_workflows: number; restricted_workflows: number; unaffected_workflows: number;
  historical_review_candidates: number; impacted_classifications: string[];
  workflows: {
    id: number; resource_id: string; source_service: string; operation: string; destination: string;
    classification: string; account_scope: string; decision: string; reason: string; affected: boolean;
    no_training: boolean; allow_public: boolean; next_action: string;
    historical: { previously_allowed: number; count: number; first_received: string | null; last_received: string | null;
      events: { request_id: string; timestamp: string; classification: string | null; decision: string; delivery: string }[] };
  }[];
};

const label = (value: string) => value.replaceAll("_", " ");
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

async function request<T>(route: string, data?: object, method = "POST"): Promise<T> {
  const response = await fetch("/api/live/" + route, data === undefined
    ? { cache: "no-store" }
    : { method, headers: { "Content-Type": "application/json", "X-Privora-Live": "1" }, body: JSON.stringify(data) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(typeof payload?.detail === "string" ? payload.detail : "Live request failed (" + response.status + ")."), { status: response.status });
  }
  return await response.json();
}

function BlastRadius({ change }: { change: Change }) {
  const [impact, setImpact] = useState<Impact>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      setImpact(await request<Impact>("policy-changes/" + change.id + "/impact"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to load impact.");
    } finally {
      setLoading(false);
    }
  }
  return <div className="live-impact">
    <button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Calculating…" : impact ? "Refresh blast radius" : "View blast radius"}</button>
    {error && <p role="alert" className="message error">{error}</p>}
    {impact && <div>
      <h4>Privacy blast radius</h4>
      <p>{impact.previous ? "v" + impact.previous.version + " → " : ""}v{impact.observed.version} · <a href={impact.observed.url}>Observed policy source</a></p>
      <p>{impact.affected_workflows} affected · {impact.restricted_workflows} restricted · {impact.unaffected_workflows} unaffected · {impact.historical_review_candidates} historical review candidates</p>
      {!!impact.impacted_classifications.length && <p>Impacted classifications · {impact.impacted_classifications.map(label).join(", ")}</p>}
      {!impact.workflows.length && <p>No configured workflows use this service.</p>}
      {impact.workflows.map((workflow) => <details key={workflow.id}>
        <summary>{workflow.source_service} → {workflow.operation} → {workflow.destination} · {label(workflow.classification)} · {label(workflow.decision)}</summary>
        <p><strong>{workflow.resource_id}</strong> · {workflow.account_scope} · {workflow.affected ? "Affected by this change" : "Unaffected by this change"}</p>
        <p>{workflow.no_training ? "No AI training on confidential documents" : "Explicit approval for confidential transfers"} · {workflow.allow_public ? "Public transfers allowed" : "Public transfers prohibited"}</p>
        <p><code>{workflow.reason}</code> · {workflow.next_action}</p>
        <p>{workflow.historical.previously_allowed} previously allowed · {workflow.historical.count} historical review candidates</p>
        {workflow.historical.count > 0 && <>
          <p>{time(workflow.historical.first_received)} – {time(workflow.historical.last_received)}. Review these deliveries against the applicable terms at the time.</p>
          <ul>{workflow.historical.events.map((event) => <li key={event.request_id}>{time(event.timestamp)} · {label(event.classification ?? "Unknown")} · {label(event.decision)} / {label(event.delivery)} · <a href={"#audit-" + event.request_id}><code>{event.request_id}</code></a></li>)}</ul>
        </>}
      </details>)}
    </div>}
  </div>;
}

function Form({ children, submit }: { children: React.ReactNode; submit: (fields: FormData) => void }) {
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (fields.has("secret")) event.currentTarget.reset();
    submit(fields);
  }
  return <form className="live-form" onSubmit={handle}>{children}</form>;
}

export default function LiveDashboard() {
  const [data, setData] = useState<Dashboard>();
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Service>();

  async function refresh() {
    try {
      setData(await request<Dashboard>("dashboard"));
      setNeedsAuth(false);
    } catch (failure) {
      setData(undefined);
      if ((failure as { status?: number }).status === 401) setNeedsAuth(true);
      else throw failure;
    }
  }
  useEffect(() => {
    let active = true;
    request<Dashboard>("dashboard").then((snapshot) => {
      if (active) setData(snapshot);
    }).catch((failure: { status?: number }) => {
      if (!active) return;
      if (failure.status === 401) setNeedsAuth(true);
      else setError("The Live backend could not be reached. Start the Live service and retry.");
    });
    return () => { active = false; };
  }, []);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      setFeedback(await task());
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell live-shell">
    <section className="intro"><div><h1>Live privacy firewall</h1><p>Observed provider policies, authorized connectors and transfer decisions.</p></div>{data && <span className="connection"><ShieldCheck size={17} /> Live session</span>}</section>
    {error && <p role="alert" className="message error">{error}</p>}
    {feedback && <p role="status" className="message">{feedback}</p>}
    {!data && !needsAuth && <button className="secondary" disabled={busy} onClick={() => void run(async () => "Live state refreshed.")}>Refresh Live state</button>}
    {needsAuth && <section className="panel live-panel">
      <h2>Sign in to Live Mode</h2>
      <Form submit={(fields) => void run(async () => { await request("session", { secret: fields.get("secret") }); return "Live session started."; })}>
        <label>Live admin secret<input name="secret" type="password" required autoComplete="current-password" /></label>
        <button className="primary" disabled={busy}>Sign in</button>
      </Form>
    </section>}
    {data && <>
      <div className="live-toolbar">
        <span>GitHub MCP {data.connector_configured ? "configured" : "unconfigured"}</span>
        <button className="ghost" disabled={busy} onClick={() => void run(async () => { await request("session", {}, "DELETE"); setData(undefined); setReview(undefined); return "Live session ended."; })}>Sign out</button>
      </div>
      <section className="section">
        <h2>Live services</h2>
        <div className="panel table-wrap"><table><thead><tr><th>Service and source</th><th>Policy</th><th>Fetch status</th><th>Last fetched</th><th>Actions</th></tr></thead><tbody>
          {data.services.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.source}</small></td><td>{label(item.status)} · {item.current_version ? "v" + item.current_version : "—"}</td><td>{label(item.fetch_status)}<small>{item.last_attempt && "Attempt " + time(item.last_attempt)}</small></td><td>{time(item.last_checked)}</td><td className="live-row-actions">
            {item.fetch_status !== "LOCAL_PROFILE" && <button className="ghost" disabled={busy} onClick={() => void run(async () => {
              const result = await request<{ status: string; changed: boolean }>("services/" + item.id + "/refresh", {});
              return result.status !== "OK" ? "Policy refresh: " + label(result.status) : result.changed ? "New policy observed. Review required." : "Policy unchanged.";
            })}>Refresh policy</button>}
            <button className="secondary" disabled={busy || !item.current_version} onClick={() => setReview(item)}>Review</button>
          </td></tr>)}
        </tbody></table></div>
      </section>
      {review && <section className="section panel live-panel">
        <h2>Review {review.name} · v{review.current_version}</h2>
        <p className="muted">Verify account-specific terms and opt-out status before approving confidential transfers.</p>
        <Form submit={(fields) => void run(async () => {
          const result = await request<{ status: string }>("services/" + review.id + "/review", {
            version: review.current_version, applicability: fields.get("applicability"), opt_out: fields.get("opt_out"),
            agreement: fields.get("agreement"), no_training: fields.has("no_training"),
          });
          setReview(undefined);
          return "Review recorded: " + label(result.status);
        })}>
          <label>Account applicability<select name="applicability"><option value="UNKNOWN">Unknown</option><option value="VERIFIED">Verified</option></select></label>
          <label>Opt-out status<select name="opt_out"><option value="UNKNOWN">Unknown</option><option value="VERIFIED">Verified</option><option value="NOT_REQUIRED">Not required</option></select></label>
          <label>Verification evidence<textarea name="agreement" required minLength={10} maxLength={2000} /></label>
          <label className="live-check"><input name="no_training" type="checkbox" /> No training verified</label>
          <button className="primary" disabled={busy}>Save review</button>
          <button type="button" className="ghost" onClick={() => setReview(undefined)}>Cancel</button>
        </Form>
      </section>}
      <section className="section panel live-panel">
        <h2>Add a policy source</h2>
        <Form submit={(fields) => void run(async () => {
          await request("services", Object.fromEntries(fields));
          return "Service registered. Refresh its policy to observe the first version.";
        })}>
          <label>Service ID<input name="id" type="text" required pattern="[a-z][a-z0-9_\-]{0,79}" placeholder="github" /></label>
          <label>Provider name<input name="name" type="text" required maxLength={150} /></label>
          <label>Policy URL<input name="url" type="url" required placeholder="https://" /></label>
          <button className="primary" disabled={busy}>Add service</button>
        </Form>
      </section>
      {data.connector_configured && <section className="section panel live-panel">
        <h2>Register a GitHub resource</h2>
        <Form submit={(fields) => void run(async () => { await request("resources", Object.fromEntries(fields)); return "GitHub resource registered."; })}>
          <label>Resource ID<input required name="id" /></label><label>Policy service ID<input required name="service_id" /></label>
          <label>Text file path<input required name="path" placeholder="README.md" /></label><label>Commit SHA<input required name="commit" minLength={40} maxLength={40} /></label>
          <label>Classification<select name="classification"><option>CONFIDENTIAL</option><option>PUBLIC</option></select></label>
          <button className="primary" disabled={busy}>Register resource</button>
        </Form>
        <p className="muted">{data.resources.length ? data.resources.map((item) => item.id + " · " + item.classification).join(" | ") : "No resources registered."}</p>
        {data.services.some((service) => service.id === "fictional_analyzer") && data.resources.length > 0 && <Form submit={(fields) => void run(async () => {
          await request("workflows", { resource_id: fields.get("resource_id"), destination: "fictional_analyzer" });
          return "Workflow bound to the fictional monitored analyzer.";
        })}>
          <label>Resource for monitored analyzer<select name="resource_id">{data.resources.map((item) => <option key={item.id}>{item.id}</option>)}</select></label>
          <button className="secondary" disabled={busy}>Bind workflow</button>
        </Form>}
      </section>}
      <section className="section">
        <h2>Observed policy changes</h2>
        {data.changes.length === 0 && <div className="panel empty">No observed changes.</div>}
        {data.changes.map((change) => <article className="panel evidence" key={change.id} id={"policy-change-" + change.id}>
          <div className="evidence-head"><h3><FileText size={18} />{change.service_id} · {label(change.reason)}</h3><span className="muted">{change.rule}</span></div>
          <p className="evidence-footer">{data.versions.find((item) => item.id === change.previous_id)?.number ? "v" + data.versions.find((item) => item.id === change.previous_id)?.number + " → " : ""}v{data.versions.find((item) => item.id === change.version_id)?.number ?? "—"} · {label(change.enforcement)}</p>
          {change.passages.map((passage, index) => <div className="diff" key={index}><div><span>Previous</span><p><mark>{passage.old || "First observation"}</mark></p></div><div><span>Observed</span><p><mark>{passage.new || "Clause removed"}</mark></p></div></div>)}
          {change.clauses.map((clause, index) => <p className="evidence-footer" key={index}>{clause.topic} · {clause.new_interpretation} {clause.reason}<br />{clause.uncertainty} {clause.review_action}</p>)}
          <p className="evidence-footer">Applicability requires human verification. Extraction {label(change.analysis_status).toLowerCase()}.</p>
          <BlastRadius change={change} />
        </article>)}
      </section>
      <section className="section">
        <h2>Policy version history</h2>
        {data.versions.map((version) => <details className="panel live-panel" key={version.id}><summary>{version.service_id} · v{version.number} · {time(version.observed_at)}</summary><p className="muted">{version.source}</p><pre>{version.content}</pre></details>)}
        {data.archive.map((item) => <details className="panel live-panel" key={item.release + item.service_id + item.archived_at}><summary>{item.service_id} · Archive · {time(item.archived_at)}</summary><p className="muted">Imported {time(item.imported_at)} · {item.policy_url ?? "Original URL unavailable"}</p><a href={item.release}>Dataset release</a>{item.passages.map((passage, index) => <div className="diff" key={index}><div><span>Prior archive version</span><p>{passage.old || "Clause added"}</p></div><div><span>This archive version</span><p>{passage.new || "Clause removed"}</p></div></div>)}<pre>{item.content}</pre></details>)}
      </section>
      <section className="section">
        <h2>Live transfer audit</h2>
        <div className="panel table-wrap"><table><thead><tr><th>Time / request ID</th><th>Resource</th><th>Source policy</th><th>Analyzer policy</th><th>Decision</th><th>Reason</th><th>Delivery</th></tr></thead><tbody>
          {data.audit.map((row) => <tr key={row.request_id} id={"audit-" + row.request_id}>
            <td>{time(row.timestamp)}<small><code>{row.request_id}</code></small></td>
            <td>{row.resource_id ?? "—"}{row.classification && <small>{label(row.classification)}</small>}</td>
            <td>{row.source_service ?? "—"}{row.source_version ? " · v" + row.source_version : ""}</td>
            <td>{row.destination_profile ?? row.destination}{row.policy_version ? " · v" + row.policy_version : ""}</td>
            <td>{label(row.decision)}</td><td><code>{row.reason}</code>
              {row.decision_origin && <small>{label(row.decision_origin)}</small>}
              {row.policy_change_id && <small><a href={"#policy-change-" + row.policy_change_id}>Policy change evidence</a></small>}
            </td><td>{label(row.delivery)}</td>
          </tr>)}
          {!data.audit.length && <tr><td colSpan={7} className="empty">No Live transfers recorded.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </main>;
}
