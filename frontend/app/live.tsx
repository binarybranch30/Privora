"use client";

import { FormEvent, useEffect, useState } from "react";
import { Workspace } from "./workspace";
import { label, time, type Impact, type Service, type Snapshot, type View } from "./investigation-data";
import { Status } from "./status";
import { ProtectionPanel, type ProtectionStatus } from "./protection";

type Dashboard = Snapshot & {
  resources: { id: string; service_id: string; classification: string }[];
  connector_configured: boolean;
};

async function request<T>(route: string, data?: object, method = "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/live/" + route, data === undefined
    ? { cache: "no-store", signal }
    : { method, headers: { "Content-Type": "application/json", "X-Privora-Live": "1" }, body: JSON.stringify(data) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(typeof payload?.detail === "string" ? payload.detail : "Live request failed (" + response.status + ")."), { status: response.status });
  }
  return await response.json();
}

function observeAnalyzer() {
  return request<{ status: string }>("services/fictional_analyzer/refresh", {});
}

function loadProtection(signal?: AbortSignal) {
  return request<ProtectionStatus>("protection", undefined, "GET", signal);
}

function mutateProtection(method: "POST" | "DELETE", launchDemo: boolean) {
  return request<ProtectionStatus>(launchDemo && method === "POST" ? "protection/demo" : "protection/session", {}, method);
}

function loadImpact(id: number) {
  return request<Impact>("policy-changes/" + id + "/impact");
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

const receivedAt = () => Date.now();
const localDemo = process.env.NEXT_PUBLIC_PRIVORA_LOCAL_DEMO === "1";

async function loadDashboard(signal?: AbortSignal) {
  try {
    return await request<Dashboard>("dashboard", undefined, "GET", signal);
  } catch (failure) {
    if (!localDemo || (failure as { status?: number }).status !== 401) throw failure;
  }

  const result = await fetch("/api/local-demo-session", {
    method: "POST",
    headers: { "X-Privora-Local-Demo": "1" },
    signal,
  });
  if (!result.ok) throw new Error("Could not open the local demo session. Check the Live backend and demo settings.");
  return request<Dashboard>("dashboard", undefined, "GET", signal);
}

export default function LiveDashboard({ view, navigate, transferDemo }: { transferDemo: boolean; view: View; navigate: (view: View) => void }) {
  const [data, setData] = useState<Dashboard>();
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Service>();
  const [lastUpdate, setLastUpdate] = useState<number>();
  const [watchError, setWatchError] = useState(false);
  const watching = !!data && !busy;

  async function refresh() {
    try {
      const snapshot = await loadDashboard();
      setData(snapshot);
      setNeedsAuth(false);
      setLastUpdate(receivedAt());
      setWatchError(false);
      return snapshot;
    } catch (failure) {
      setData(undefined);
      if ((failure as { status?: number }).status === 401) setNeedsAuth(true);
      else throw failure;
    }
  }
  useEffect(() => {
    let active = true;
    loadDashboard().then((snapshot) => {
      if (active) { setData(snapshot); setLastUpdate(receivedAt()); }
    }).catch((failure: { status?: number }) => {
      if (!active) return;
      if (failure.status === 401) setNeedsAuth(true);
      else setError(localDemo ? "Could not open the local demo session. Start the Live service and check the demo settings."
        : "The Live backend could not be reached. Start the Live service and retry.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!watching) return;
    let active = true;
    let pending: AbortController | undefined;
    async function poll() {
      if (document.visibilityState !== "visible" || pending) return;
      pending = new AbortController();
      try {
        const snapshot = await loadDashboard(pending.signal);
        if (active) {
          setData(snapshot);
          setLastUpdate(receivedAt());
          setWatchError(false);
        }
      } catch (failure) {
        if (!active) return;
        if ((failure as { status?: number }).status === 401) {
          setData(undefined);
          setNeedsAuth(true);
          setReview(undefined);
        } else setWatchError(true);
      } finally { pending = undefined; }
    }
    const timer = window.setInterval(() => void poll(), 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [watching]);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const result = await task();
      const snapshot = await refresh();
      if (snapshot) setFeedback(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const analyzer = data?.services.find(item => item.id === "fictional_analyzer");

  function reviewForm(id: string) {
    const inline = id === "overview-policy-review";
    if (!review) return null;
    const simple = inline && transferDemo;
    const policy = data?.versions.find(item => item.service_id === review.id && item.number === review.current_version);
    return <section className="section panel live-panel" id={id} tabIndex={-1}>
        <h2>{inline ? "Review the analyzer's terms" : "Review " + review.name}</h2>
        <p className="muted">Confirm that these terms apply to your test. If the terms change, Privora requires a new review.</p>
        {policy && <details className="policy-review-terms" open={inline}><summary>Current terms</summary><pre>{policy.content}</pre>{!simple && <small className="muted">Recorded revision {policy.number}</small>}</details>}
        <Form submit={(fields) => void run(async () => {
          if (simple && (!policy || !fields.has("confirm_terms"))) throw new Error("Read and confirm the current terms first.");
          const result = await request<{ status: string }>("services/" + review.id + "/review", {
            version: review.current_version,
            applicability: simple ? "VERIFIED" : fields.get("applicability"),
            opt_out: simple ? "NOT_REQUIRED" : fields.get("opt_out"),
            agreement: simple ? ("Reviewed fictional terms: " + policy?.content).slice(0, 2000) : fields.get("agreement"),
            no_training: simple ? fields.has("confirm_terms") : fields.has("no_training"),
          });
          setReview(undefined);
          return result.status === "APPROVED" ? (simple ? "" : "Terms approved. You can start monitoring.") : "Review saved. Confidential transfers still require approval.";
        })}>
          {simple ? <label className="live-check"><input name="confirm_terms" type="checkbox" required />
            I confirm these terms apply to this test and exclude submitted files from training without requiring an opt-out.
          </label> : <>
          <label>Do these terms apply to this integration?<select name="applicability"><option value="UNKNOWN">Unknown</option><option value="VERIFIED">Yes, I verified they apply</option></select></label>
          <label>Training opt-out<select name="opt_out"><option value="UNKNOWN">Unknown</option><option value="VERIFIED">Verified</option><option value="NOT_REQUIRED">Not required</option></select></label>
          <label>Evidence for your decision<textarea name="agreement" required placeholder="Quote the relevant clause or describe what you verified." minLength={10} maxLength={2000} /></label>
          <label className="live-check"><input name="no_training" type="checkbox" /> I verified that submitted documents are excluded from training</label>
          </>}
          <button className="primary" disabled={busy || (simple && !policy)}>{simple ? "Approve these terms" : "Save policy review"}</button>
          <button type="button" className="ghost" onClick={() => setReview(undefined)}>Cancel</button>
        </Form>
      </section>;
  }

  return <main className="workspace-shell" id="workspace" tabIndex={-1}>
    {!data && <div className="workspace-heading"><div><h1>Live workspace</h1><p>{localDemo ? "Opening the local Live demo." : transferDemo ? "Sign in to run the transfer protection demo." : "Sign in to watch recorded policy incidents. For a local synthetic scenario, switch to Demo."}</p></div></div>}
    {error && <p role="alert" className="message error">{error}</p>}
    {feedback && <p role="status" className="message">{feedback}</p>}
    {loading && <p role="status" className="message">Connecting to Live Mode...</p>}
    {!loading && !data && (!needsAuth || localDemo) && <button className="secondary" disabled={busy} onClick={() => void run(async () => "Live state refreshed.")}>Refresh Live state</button>}
    {needsAuth && !localDemo && <section className="panel live-panel live-signin">
      <h2>Sign in to Live Mode</h2>
      <Form submit={(fields) => void run(async () => { await request("session", { secret: fields.get("secret") }); return "Live session started."; })}>
        <label>Live admin secret<input name="secret" type="password" required autoComplete="current-password" /></label>
        <button className="primary" disabled={busy}>Sign in</button>
      </Form>
    </section>}
    {data && <Workspace transferDemo={transferDemo} view={view} navigate={navigate} live data={{ ...data, workflows: data.workflows ?? [] }} loadImpact={loadImpact} connectorConfigured={data.connector_configured}
      protection={open => <ProtectionPanel fetchStatus={loadProtection} mutate={mutateProtection} investigate={open}
        analyzer={analyzer}
        analyzerTerms={data.versions.find(policy => policy.service_id === analyzer?.id && policy.number === analyzer.current_version)?.content}
        busyReview={busy}
        review={review?.id === analyzer?.id ? reviewForm("overview-policy-review") : null}
        observeSavedPolicy={async () => {
          setReview(undefined);
          const observation = await observeAnalyzer();
          const snapshot = await refresh();
          if (observation.status !== "OK" || !snapshot) {
            throw new Error("Could not read the saved terms. Check that the HTTPS policy server is running.");
          }
          const service = snapshot.services.find(item => item.id === "fictional_analyzer");
          const policy = snapshot.versions.find(item => item.service_id === service?.id && item.number === service.current_version);
          return service && policy ? { service, content: policy.content } : undefined;
        }}
        approveStartingPolicy={async ({ service, content }) => {
          const result = await request<{ status: string }>("services/" + service.id + "/review", {
            version: service.current_version, applicability: "VERIFIED", opt_out: "NOT_REQUIRED",
            no_training: true, agreement: "Confirmed the controlled analyzer terms at startup: " + content,
          });
          if (result.status !== "APPROVED") throw new Error("The starting terms could not be approved.");
        }}
        openReview={service => {
          setReview(service);
          requestAnimationFrame(() => document.getElementById("overview-policy-review")?.focus());
        }}
        refreshReadiness={async () => { await refresh(); }} />}
      reviewService={id => {
        const service = data.services.find(item => item.id === id);
        if (!service?.current_version || busy) return;
        setReview(service);
        navigate("configuration");
        requestAnimationFrame(() => document.getElementById("live-policy-review")?.focus());
      }}
      toolbar={<>
        {!transferDemo && <><span className="muted" title="Refreshes every 15 seconds while this tab is visible">{watchError ? "Watch disconnected / Showing last snapshot"
          : lastUpdate ? "Watching Live / " + new Date(lastUpdate).toLocaleTimeString() : "Watching Live"}</span>
        <button className="ghost" disabled={busy} onClick={() => void run(async () => "Live state refreshed.")}>Refresh evidence</button></>}
        {!localDemo && <button className="ghost" disabled={busy} onClick={() => void run(async () => { await request("session", {}, "DELETE"); setData(undefined); setReview(undefined); return "Live session ended."; })}>Sign out</button>}
      </>}
      serviceActions={id => data.services.some(item => item.id === id) && <button className="ghost" onClick={() => navigate("configuration")}>Manage service</button>}
      configuration={<>
        <p>Use this page to manage policy sources and GitHub files. To run the transfer test, start on <button className="ghost" onClick={() => navigate("overview")}>Overview</button>.</p>
        <p className="muted">GitHub MCP {data.connector_configured ? "configured" : "unconfigured"}</p>
        <section className="section"><h2>Policy services</h2>
          {data.services.map(item => <div className="service-row" key={item.id}>
            <div><strong>{item.name}</strong><small>{item.source}</small></div>
            <div><Status value={item.status} /><small>{label(item.fetch_status ?? "UNKNOWN")} / {time(item.last_checked)}</small></div>
            <div className="actions">
              {item.fetch_status !== "LOCAL_PROFILE" && <button className="ghost" disabled={busy} onClick={() => void run(async () => {
                const result = await request<{ status: string; changed: boolean }>("services/" + item.id + "/refresh", {});
                return result.status !== "OK" ? "Policy refresh: " + label(result.status) : result.changed ? "New policy version observed." : "Policy unchanged.";
              })}>Refresh policy</button>}
              <button className="secondary" disabled={busy || !item.current_version} onClick={() => setReview(item)}>Review</button>
            </div>
          </div>)}
        </section>
      {reviewForm("live-policy-review")}
      <section className="section">
        <h2>Advanced setup</h2>
        <details className="panel live-panel">
          <summary>Add a policy source</summary>
          <Form submit={(fields) => void run(async () => {
            await request("services", Object.fromEntries(fields));
            return "Service registered. Refresh its policy to observe the first version.";
          })}>
            <label>Service ID<input name="id" type="text" required pattern="[a-z][a-z0-9_\-]{0,79}" placeholder="github" /></label>
            <label>Provider name<input name="name" type="text" required maxLength={150} /></label>
            <label>Policy URL<input name="url" type="url" required placeholder="https://" /></label>
            <button className="primary" disabled={busy}>Add service</button>
          </Form>
        </details>
        {data.connector_configured && <details className="panel live-panel">
          <summary>Manage GitHub resources</summary>
          <Form submit={(fields) => void run(async () => { await request("resources", Object.fromEntries(fields)); return "GitHub resource registered."; })}>
            <label>Resource ID<input required name="id" /></label><label>Policy service ID<input required name="service_id" /></label>
            <label>Text file path<input required name="path" placeholder="README.md" /></label><label>Commit SHA<input required name="commit" minLength={40} maxLength={40} /></label>
            <label>Classification<select name="classification"><option>CONFIDENTIAL</option><option>PUBLIC</option></select></label>
            <button className="primary" disabled={busy}>Register resource</button>
          </Form>
          <p className="muted">{data.resources.length ? data.resources.map((item) => item.id + " · " + item.classification).join(" | ") : "No resources registered."}</p>
          {data.services.some((service) => service.id === "fictional_analyzer") && data.resources.length > 0 && <Form submit={(fields) => void run(async () => {
            await request("workflows", { resource_id: fields.get("resource_id"), destination: fields.get("destination") });
            return "Workflow bound to the selected analyzer.";
          })}>
            <label>Resource for monitored analyzer<select name="resource_id">{data.resources.map((item) => <option key={item.id}>{item.id}</option>)}</select></label>
            <label>Destination<select name="destination">{data.services.filter(item => ["fictional_analyzer", "fictional_analyzer_b"].includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button className="secondary" disabled={busy}>Bind workflow</button>
          </Form>}
        </details>}
      </section>
      </>} />}
  </main>;
}
