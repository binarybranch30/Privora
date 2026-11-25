"use client";

import { FlaskConical, Radio, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import LiveDashboard from "./live";
import { Workspace } from "./workspace";
import { DemoGuide } from "./demo-guide";
import { demoWorkflow, type Change, type Impact, type Result, type Snapshot, type View, type Workflow } from "./investigation-data";

const transferDemo = process.env.NEXT_PUBLIC_PRIVORA_TRANSFER_DEMO !== "0";

const navigation: { id: View; text: string }[] = [
  { id: "overview", text: "Overview" }, { id: "policies", text: "Policy Intelligence" },
  { id: "impact", text: "Blast Radius" }, { id: "audit", text: "Audit" },
  { id: "configuration", text: "Service setup" },
];

type DemoSnapshot = Snapshot & { demo: boolean; receipts: { count: number; request_ids: string[] } | null };
type Action = "reset" | "simulate-policy-change" | "confidential" | "public" | "refresh";

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

function loadDemoImpact(id: number) {
  return api<Impact>("demo/policy-changes/" + id + "/impact");
}

async function snapshot(): Promise<DemoSnapshot> {
  const health = await api<{ demo_mode: boolean }>("health");
  const [services, versions, changes, events, receipts] = await Promise.all([
    api<Snapshot["services"]>("services"), api<Snapshot["versions"]>("policies/versions"), api<Snapshot["changes"]>("policies/changes"),
    api<Snapshot["audit"]>("audit"), health.demo_mode ? api<DemoSnapshot["receipts"]>("demo/receipts") : null,
  ]);
  const provider = services.find(service => service.id === "external_analyzer");
  const workflows: Workflow[] = health.demo_mode && provider ? [
    { id: 1, resource_id: "confidential_001", classification: "CONFIDENTIAL", source_service: "demo_documents", destination: provider.id, operation: "analyze_document" },
    { id: 2, resource_id: "public_001", classification: "PUBLIC", source_service: "demo_documents", destination: provider.id, operation: "analyze_document" },
  ] : [];
  const audit = health.demo_mode ? events.map(event => ({
    ...event, source_service: "demo_documents", workflow_id: demoWorkflow(event),
  })) : events;
  return { demo: health.demo_mode, services, versions, changes, workflows, audit, receipts };
}

export default function Dashboard() {
  const [live, setLive] = useState(true);
  const [view, setView] = useState<View>("overview");
  function switchMode(value: boolean) {
    setLive(value);
    setView("overview");
  }
  return <>
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="product-header">
      <button className="wordmark" onClick={() => setView("overview")}><ShieldCheck size={22} /> Privora</button>
      <nav aria-label="Workspace" className="product-nav">{navigation.filter(item => transferDemo ? item.id !== "impact" : live || item.id !== "configuration").map(item =>
        <button key={item.id} aria-current={view === item.id || (view === "investigation" && item.id === "overview") ? "page" : undefined} onClick={() => setView(item.id)}>{transferDemo ? ({ policies: "Investigations", audit: "Activity", configuration: "Settings" }[item.id as "policies" | "audit" | "configuration"] ?? item.text) : item.text}</button>)}</nav>
      {!transferDemo && <div className="mode-inner" role="group" aria-label="Dashboard mode">
        <button aria-pressed={!live} onClick={() => switchMode(false)}><FlaskConical size={15} /> Demo</button>
        <button aria-pressed={live} onClick={() => switchMode(true)}><Radio size={15} /> Live</button>
      </div>}
    </header>
    {live ? <LiveDashboard transferDemo={transferDemo} view={view} navigate={setView} /> : <DemoDashboard view={view} navigate={setView} />}
  </>;
}

function DemoDashboard({ view, navigate }: { view: View; navigate: (view: View) => void }) {
  const [data, setData] = useState<DemoSnapshot>();
  const [result, setResult] = useState<Result>();
  const [observedChange, setObservedChange] = useState<number>();
  const [busy, setBusy] = useState<Action>();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [proof, setProof] = useState<{ delivered?: string; changeId?: number; retry?: string }>({});
  const service = data?.services.find(item => item.id === "external_analyzer");
  const ready = service?.source.startsWith("fixture://") ?? false;
  const needsReset = !!service && (!ready || (proof.changeId == null
    ? service.current_version !== 1 || service.status !== "APPROVED"
    : !data?.changes.some(item => item.id === proof.changeId && data.versions.some(record =>
      record.id === item.version_id && record.number === service.current_version))));
  const stage = proof.retry ? 3 : proof.changeId ? 2 : proof.delivered ? 1 : 0;
  const retryRecord = data?.audit.find(item => item.request_id === proof.retry);

  useEffect(() => {
    let active = true;
    snapshot().then(value => { if (active) setData(value); }).catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);

  async function act(action: Action) {
    setBusy(action);
    setObservedChange(undefined);
    setResult(undefined);
    setError("");
    setNotice("");
    try {
      let outcome: Result | undefined;
      let message = "";
      let changedVersion: number | undefined;
      if (action === "reset") {
        await api("demo/reset", {});
        setProof({});
        message = "Demo reset to the approved policy.";
      } else if (action === "simulate-policy-change") {
        const change = await api<{ version: number; changed: boolean; status: string }>("demo/simulate-policy-change", {});
        if (change.changed && change.status === "REVIEW_REQUIRED") changedVersion = change.version;
        message = change.changed ? "Policy v" + change.version + " observed. Retry the confidential transfer." : "Policy text is unchanged.";
      } else if (action !== "refresh") {
        outcome = await api<Result>("demo/analyze", { document_id: action === "public" ? "public_001" : "confidential_001" });
      }
      const current = await snapshot();
      setData(current);
      setResult(outcome);
      if (action === "simulate-policy-change") {
        const observed = current.versions.find(item => item.service_id === "external_analyzer" && item.number === changedVersion);
        const change = current.changes.find(item => item.version_id === observed?.id && item.enforcement === "REVIEW_REQUIRED");
        if (!change) throw new Error("The backend did not confirm a new policy with approval held for review.");
        setObservedChange(change.id);
        setProof(previous => ({ ...previous, changeId: change.id }));
        message = "Policy v" + changedVersion + " observed. Approval now requires review.";
      }
      if (action === "confidential" && outcome) {
        const row = current.audit.find(item => item.request_id === outcome.request_id);
        const receipt = current.receipts?.request_ids.includes(outcome.request_id);
        if (stage === 0) {
          if (outcome.decision !== "ALLOW" || outcome.delivery !== "RECEIVED" || outcome.policy_version !== 1 || !row || !receipt)
            throw new Error("The backend did not confirm delivery and a receipt under approved v1.");
          setProof({ delivered: outcome.request_id });
          message = "Allowed and received. The analyzer receipt is confirmed.";
        } else {
          if (outcome.decision !== "REVIEW_REQUIRED" || outcome.delivery !== "NOT_SENT" || outcome.policy_version !== service?.current_version
            || !row || !current.receipts || receipt || current.receipts.count !== data?.receipts?.count) {
            throw new Error("Could not verify the retry was held with an unchanged analyzer receipt count.");
          }
          setProof(previous => ({ ...previous, retry: outcome.request_id }));
          message = "Review required / Not sent. No additional analyzer receipt.";
        }
      }
      if (action === "public" && outcome) {
        message = outcome.decision === "ALLOW" && outcome.delivery === "RECEIVED" && current.receipts?.request_ids.includes(outcome.request_id)
          ? "Public transfer allowed. The new analyzer receipt is confirmed."
          : "Public transfer result: " + outcome.decision + " / " + outcome.delivery + ".";
      }
      setNotice(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
    } finally {
      setBusy(undefined);
    }
  }

  async function recordDemo() {
    if (recording || busy) return;
    setRecording(true);
    setError("");
    try {
      let before = await snapshot();
      if (!before.demo) throw new Error("Demo mode is unavailable.");
      if (!before.services.length && !before.audit.length && before.receipts?.count === 0) {
        await api("demo/reset", {});
        before = await snapshot();
      }
      const service = before.services.find(row => row.id === "external_analyzer");
      if (!service?.source.startsWith("fixture://") || service.current_version !== 1 || service.status !== "APPROVED") {
        throw new Error("Recording needs the approved Demo v1 fixture. You can replay existing evidence or restart under Manual Demo tools.");
      }
      const first = await api<Result>("demo/analyze", { document_id: "confidential_001" });
      const delivered = await snapshot();
      if (first.decision !== "ALLOW" || first.delivery !== "RECEIVED" || first.policy_version !== 1
        || !delivered.receipts?.request_ids.includes(first.request_id)) throw new Error("The first confidential delivery could not be verified.");
      const policy = await api<{ version: number; changed: boolean; status: string }>("demo/simulate-policy-change", {});
      if (!policy.changed || policy.status !== "REVIEW_REQUIRED") throw new Error("The expected policy observation was not confirmed.");
      const retry = await api<Result>("demo/analyze", { document_id: "confidential_001" });
      const recorded = await snapshot();
      const current = recorded.versions.find(row => row.service_id === service.id && row.number === policy.version);
      const change: Change | undefined = recorded.changes.find(row => row.version_id === current?.id);
      if (!change || retry.decision !== "REVIEW_REQUIRED" || retry.delivery !== "NOT_SENT" || retry.policy_version !== policy.version
        || !recorded.audit.some(row => row.request_id === retry.request_id)
        || !recorded.receipts || recorded.receipts.count !== delivered.receipts.count || recorded.receipts.request_ids.includes(retry.request_id)) {
        throw new Error("The retry and unchanged receipt count could not be verified.");
      }
      setData(recorded);
      setProof({ delivered: first.request_id, changeId: change.id, retry: retry.request_id });
      setResult(undefined);
      setObservedChange(undefined);
      return { data: recorded, change, focus: recorded.audit.find(row => row.request_id === retry.request_id), receiptCount: recorded.receipts.count };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not record the Demo incident.");
      try { setData(await snapshot()); } catch { /* Keep the latest available evidence. */ }
    } finally { setRecording(false); }
  }

  return <main className="workspace-shell" id="workspace" tabIndex={-1}>
    {error && <p role="alert" className="message error">{error}</p>}
    {!data && (error ? <button className="ghost" disabled={!!busy || recording} onClick={() => void act("refresh")}>Retry connection</button> : <p role="status" className="message">Loading Demo workspace...</p>)}
    {data && <Workspace view={view} navigate={navigate} data={data} live={false} playback={result} observedChange={observedChange} receiptCount={data.receipts?.count} loadImpact={data.demo ? loadDemoImpact : undefined} recordDemo={data.demo && !busy ? recordDemo : undefined} recording={recording} guidedChangeId={proof.changeId} guidedRetryId={retryRecord?.request_id} pending={busy === "confidential" ? 1 : busy === "public" ? 2 : undefined}
      toolbar={<button className="ghost" disabled={!!busy || recording} onClick={() => void act("refresh")}><RotateCcw size={15} /> Refresh</button>}
      demoControls={data.demo ? (inspectRetry, inspectImpact) => <DemoGuide stage={stage} ready={ready} needsReset={needsReset} busy={!!busy || recording} count={data.receipts?.count} outcome={notice}
        onReset={() => void act("reset")} onPublic={() => void act("public")} onAudit={inspectRetry}
        onNext={() => stage === 3 ? inspectImpact() : void act(stage === 1 ? "simulate-policy-change" : "confidential")} /> : undefined} />}
  </main>;
}
