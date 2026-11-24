"use client";

import { Activity, ArrowDownUp, CheckCircle2, CircleAlert, FileText, FlaskConical, Play, RotateCcw, Shield, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import LiveDashboard from "./live";

type Service = { id: string; name: string; status: string; source: string; enabled: boolean; current_version: number | null; verified_no_training: boolean; last_checked: string | null; reason: string };
type Version = { id: number; number: number; source: string };
type Change = { id: number; previous_id: number | null; version_id: number; passages: { old: string; new: string }[]; clauses: { topic: string; new_interpretation: string }[]; analysis_status: string; enforcement: string; rule: string; reason: string };
type Result = { request_id: string; decision: string; reason: string; classification: string | null; policy_version: number | null; delivery: string; analysis: { word_count: number } | null };
type Audit = Result & { timestamp: string; destination: string; operation: string };
type Snapshot = { demo: boolean; services: Service[]; versions: Version[]; changes: Change[]; audit: Audit[]; receipts: { count: number } | null };
type Action = "reset" | "simulate-policy-change" | "confidential" | "public";

async function api<T>(path: string, payload?: object): Promise<T> {
  const response = await fetch("/api/" + path, payload === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "Request failed (" + response.status + ").");
  }
  return response.json();
}

async function snapshot(): Promise<Snapshot> {
  const health = await api<{ demo_mode: boolean }>("health");
  const [services, versions, changes, audit, receipts] = await Promise.all([
    api<Service[]>("services"), api<Version[]>("policies/versions"), api<Change[]>("policies/changes"),
    api<Audit[]>("audit"), health.demo_mode ? api<{ count: number }>("demo/receipts") : null,
  ]);
  return { demo: health.demo_mode, services, versions, changes, audit, receipts };
}

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}

function time(value: string | null) {
  if (!value) return "Never";
  const utc = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(utc));
}

function Status({ value }: { value: string }) {
  const tone = ["APPROVED", "ALLOW", "RECEIVED"].includes(value) ? "good" : value === "REVIEW_REQUIRED" ? "warn" : value === "BLOCK" || value === "RESTRICTED" ? "bad" : "neutral";
  return <span className={"pill " + tone}><span aria-hidden="true" />{label(value)}</span>;
}

export default function Dashboard() {
  const [live, setLive] = useState(false);
  return <>
    <div className="mode-bar"><div className="shell mode-inner" role="group" aria-label="Dashboard mode">
      <button className={live ? "ghost" : "secondary"} aria-pressed={!live} onClick={() => setLive(false)}>Demo Mode</button>
      <button className={live ? "secondary" : "ghost"} aria-pressed={live} onClick={() => setLive(true)}>Live Mode</button>
      <span>{live ? "Observed data" : "Synthetic data"}</span>
    </div></div>
    {live ? <LiveDashboard /> : <DemoDashboard />}
  </>;
}

function DemoDashboard() {
  const [data, setData] = useState<Snapshot>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<Action | "refresh">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    snapshot().then((value) => { if (active) setData(value); }).catch((problem: Error) => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, []);

  async function act(action: Action | "refresh") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      if (action === "reset") {
        await api("demo/reset", {});
        setResult(undefined);
        setNotice("Demo reset to the approved policy.");
      } else if (action === "simulate-policy-change") {
        const change = await api<{ version: number; changed: boolean }>("demo/simulate-policy-change", {});
        setResult(undefined);
        setNotice(change.changed ? "Policy v" + change.version + " requires review. Retry the same confidential request." : "Policy text is unchanged.");
      } else if (action !== "refresh") {
        const decision = await api<Result>("demo/analyze", { document_id: action === "public" ? "public_001" : "confidential_001" });
        setResult(decision);
      }
      setData(await snapshot());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Request failed.");
    } finally {
      setBusy(undefined);
    }
  }

  const totals = data ? [
    { name: "Connected services", amount: data.services.filter((service) => service.enabled).length, icon: Shield, tone: "" },
    { name: "Need policy review", amount: data.services.filter((service) => service.status === "REVIEW_REQUIRED" || service.status === "UNKNOWN").length, icon: CircleAlert, tone: "warn-text" },
    { name: "Allowed operations", amount: data.audit.filter((row) => row.decision === "ALLOW").length, icon: ShieldCheck, tone: "good-text" },
    { name: "Blocked operations", amount: data.audit.filter((row) => row.decision !== "ALLOW").length, icon: ShieldX, tone: "bad-text" },
  ] : [];
  const provider = data?.services.find((service) => service.id === "external_analyzer");
  const last = data?.changes[0];

  return (
    <>
      <header className="top"><div className="shell top-inner">
        <a href="#overview" className="brand"><span className="brand-icon"><ShieldCheck size={20} /></span>Privora <small>MCP</small></a>
        <nav aria-label="Sections"><a href="#services">Services</a><a href="#changes">Policy changes</a><a href="#audit">Audit</a></nav>
        <button className="ghost refresh" disabled={!!busy} onClick={() => void act("refresh")}><RotateCcw size={15} /> Refresh</button>
      </div></header>
      <main className="shell">
        <section id="overview" className="intro">
          <div><h1>Privacy firewall</h1><p>Inspect provider policy changes and their effect on document transfers.</p></div>
          {data && <span className="connection"><Activity size={17} /> Gateway connected</span>}
        </section>
        {error && <p role="alert" className="message error">{error}</p>}
        {!data && !error && <p role="status" className="message">Loading gateway state…</p>}
        {!!data && <>
          <div className="metrics">{totals.map(({ name, amount, icon: Icon, tone }) =>
            <div className="metric" key={name}><span>{name}</span><div><strong>{amount}</strong><Icon size={23} className={tone} aria-hidden="true" /></div></div>)}
          </div>
          {data.demo && <section className="demo panel" aria-labelledby="demo-heading">
            <div className="demo-main">
              <div className="demo-label"><FlaskConical size={17} /> Synthetic demo</div>
              <h2 id="demo-heading">Test a confidential transfer</h2>
              <p>Run an analysis, change the provider policy, then retry the same document to see the firewall enforce the new terms.</p>
              <div className="invocation"><span>analyze_document</span><code>(confidential_001, external_analyzer)</code></div>
              <div className="actions">
                <button className="primary" disabled={!!busy || !provider} onClick={() => void act("confidential")}><Play size={17} />{provider?.status === "APPROVED" ? "Run confidential analysis" : "Retry confidential analysis"}</button>
                <button className="secondary" disabled={!!busy || !provider} onClick={() => void act("simulate-policy-change")}><ArrowDownUp size={16} /> Simulate policy change</button>
                <button className="ghost" disabled={!!busy || !provider} onClick={() => void act("public")}>Run public analysis</button>
                <button className="ghost" disabled={!!busy} onClick={() => void act("reset")}><RotateCcw size={15} /> Reset demo</button>
              </div>
            </div>
            <aside className="receipt" aria-live="polite">
              <span className="muted">Analyzer receipts</span>
              <strong>{data.receipts?.count ?? 0}</strong>
              <p>Requests received by the downstream MCP server.</p>
              {!!notice && <div className="notice">{notice}</div>}
              {!!busy && <p className="notice">Working…</p>}
              {result && <div className="outcome"><Status value={result.decision} /><code>{result.reason}</code><small>{label(result.delivery)} · Policy v{result.policy_version ?? "—"}{result.analysis ? " · " + result.analysis.word_count + " words analyzed" : ""}</small></div>}
              {!provider && <div className="notice">Reset the demo to seed the provider and documents.</div>}
            </aside>
          </section>}
          <section id="services" className="section">
            <h2>Connected services</h2>
            <div className="panel table-wrap"><table><thead><tr><th>Service</th><th>Policy status</th><th>Version</th><th>Last checked</th><th>Data-use condition</th></tr></thead>
              <tbody>{data.services.map((service) => <tr key={service.id}><td><strong>{service.name}</strong><small>{service.id}</small></td><td><Status value={service.status} /></td><td>{service.current_version ? "v" + service.current_version : "—"}</td><td>{time(service.last_checked)}</td><td>{!service.enabled ? "Destination disabled" : service.verified_no_training ? "No AI training verified" : label(service.reason)}</td></tr>)}
              {!data.services.length && <tr><td colSpan={5} className="empty">No services configured.</td></tr>}</tbody>
            </table></div>
          </section>
          <section id="changes" className="section">
            <h2>Recent policy changes</h2>
            {data.changes.length ? data.changes.map((change) => {
              const previous = data.versions.find((version) => version.id === change.previous_id);
              const next = data.versions.find((version) => version.id === change.version_id);
              return <article className="panel evidence" key={change.id}>
                <div className="evidence-head"><div><h3><FileText size={18} /> {change.clauses[0]?.topic ?? "Policy text changed"}</h3><p>{change.rule}</p></div><Status value={change.enforcement} /></div>
                {change.passages.map((passage, index) => <div className="diff" key={index}><div><span>Previous{previous ? " · v" + previous.number : ""}</span><p><mark>{passage.old || "No previous clause"}</mark></p></div><div><span>Updated{next ? " · v" + next.number : ""}</span><p><mark>{passage.new || "Clause removed"}</mark></p></div></div>)}
                <p className="evidence-footer">{change.clauses[0]?.new_interpretation ?? (change.analysis_status === "FAILED" ? "Extraction failed. The observed text is pending manual review." : label(change.reason))}</p>
              </article>;
            }) : <div className="panel empty">{last ? "" : "No policy changes observed."}</div>}
          </section>
          <section id="audit" className="section">
            <h2>Transfer audit</h2>
            <div className="panel table-wrap"><table><thead><tr><th>Timestamp</th><th>Tool / destination</th><th>Classification</th><th>Decision</th><th>Reason / version</th><th>Delivery</th></tr></thead>
              <tbody>{data.audit.map((row) => <tr key={row.request_id}><td>{time(row.timestamp)}</td><td><code>{row.operation}</code><small>{row.destination}</small></td><td>{row.classification ? label(row.classification) : "—"}</td><td>{row.decision === "REVIEW_REQUIRED" ? <span className="audit-decision"><Status value={row.decision} /><small>Transfer blocked</small></span> : <Status value={row.decision} />}</td><td><code>{row.reason}</code><small>{row.policy_version ? "Policy v" + row.policy_version : "—"}</small></td><td>{label(row.delivery)}</td></tr>)}
              {!data.audit.length && <tr><td colSpan={6} className="empty"><CheckCircle2 size={16} /> No transfers recorded.</td></tr>}</tbody>
            </table></div>
          </section>
        </>}
      </main>
    </>
  );
}
