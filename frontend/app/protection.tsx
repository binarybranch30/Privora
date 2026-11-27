import { ArrowRight, Copy, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { changedWords, instant, label, time, version, type Service } from "./investigation-data";
import { RehearsalLanes, rehearsalAnalyzers, rehearsalFile, rehearsalLaneName } from "./rehearsal-lanes";
import { CommandVisual } from "./command-visual";
import { ComparisonTransfer, useComparisonTransfer } from "./comparison-transfer";
import { Status } from "./status";
import "./protection.css";

type ProtectionStatus = {
  enabled: boolean;
  demo_enabled?: boolean;
  three_lanes?: boolean;
  incident?: { id: number; service: string; observed_at: string; previous_version: number | null; current_version: number;
    rule: string; held: number; denied: number; public_confirmed: number; analyzer_b_confirmed: number; analyzer_b_public_confirmed?: number } | null;
  rehearsal_policy?: "APPROVED" | "PAUSED" | "RESTORED" | null;
  session: { id: string; destination: string; starting_version: number; current_version: number | null;
    approval: string; observation_status: string; last_attempt: string | null; stopped_at: string | null } | null;
  jobs: { id: string; lane?: string | null; enforcement?: string | null; confirmed_files: number; confirmed_bytes: number; items: {
    request_id: string; position: number; resource_id: string; status: string; classification: string | null;
    decision: string | null; reason: string | null; delivery: string | null; policy_version: number | null;
    started_at: string | null; finished_at: string | null; receipt_at: string | null; received_bytes: number | null;
  }[] }[];
  policy_change?: { id: number; version: number; observed_at: string; rule: string; reason: string;
    passages: { old: string; new: string }[] } | null;
};

function receivedFiles(snapshot?: ProtectionStatus) {
  return snapshot?.jobs.reduce((total, job) => total + job.confirmed_files, 0) ?? 0;
}

type LaneFocus = {
  lane: string;
  phase: "receipt" | "processing" | "withheld";
  item: ProtectionStatus["jobs"][number]["items"][number];
  receipt?: number;
};
type TransferView = { snapshot?: ProtectionStatus; deliveryEvent?: number; laneReceipts?: Record<string, number>; focus?: LaneFocus };

function updateView(previous: TransferView, next: ProtectionStatus): TransferView {
  const sameRun = !!next.session && previous.snapshot?.session?.id === next.session.id;
  const current = { ...next, demo_enabled: next.demo_enabled ?? previous.snapshot?.demo_enabled };
  const count = receivedFiles(current);
  const laneReceipts: Record<string, number> = {};
  let latestReceipt: LaneFocus | undefined;
  let processing: LaneFocus | undefined;
  let withheld: LaneFocus | undefined;
  if (next.session?.stopped_at === null) {
    for (const job of next.jobs) {
      if (!job.lane) continue;
      const lane = job.lane;
      const running = job.items.find(item => item.status === "RUNNING" && !item.delivery);
      const waiting = job.items.find(item => item.status === "QUEUED");
      if (job.enforcement === "PAUSED") {
        if (waiting && !withheld) withheld = { lane, phase: "withheld", item: waiting };
        continue;
      }
      if (running && !processing) processing = { lane, phase: "processing", item: running };
      const prior = sameRun ? previous.snapshot?.jobs.find(item => item.id === job.id) : undefined;
      if (!prior) continue;
      if (job.confirmed_files > prior.confirmed_files) {
        laneReceipts[lane] = job.confirmed_files;
        for (const item of job.items) {
          if (!item.receipt_at || prior.items.some(old => old.request_id === item.request_id && old.receipt_at)) continue;
          if (!latestReceipt?.item.receipt_at || instant(item.receipt_at) > instant(latestReceipt.item.receipt_at)) {
            latestReceipt = { lane, phase: "receipt", item, receipt: job.confirmed_files };
          }
        }
      } else if (previous.laneReceipts?.[lane] != null) {
        laneReceipts[lane] = previous.laneReceipts[lane];
      }
    }
  }
  const previousReceipt = sameRun && next.session?.stopped_at === null && previous.focus?.phase === "receipt"
    ? previous.focus : undefined;
  return {
    snapshot: current,
    laneReceipts,
    focus: latestReceipt ?? processing ?? withheld ?? previousReceipt,
    deliveryEvent: sameRun && next.session?.stopped_at === null && (next.session.approval === "APPROVED" || next.rehearsal_policy === "RESTORED")
      ? count > receivedFiles(previous.snapshot) ? count : previous.deliveryEvent
      : undefined,
  };
}

type StartingTerms = { service: Service; content: string };

export function ProtectionPanel({ fetchStatus, mutate, investigate, analyzer, analyzerTerms, busyReview, review, openReview, observeSavedPolicy, approveStartingPolicy, refreshReadiness }: {
  fetchStatus: (signal?: AbortSignal) => Promise<ProtectionStatus>;
  mutate: (method: "POST" | "DELETE", launchDemo: boolean) => Promise<ProtectionStatus>;
  investigate: (change: number) => void;
  analyzer?: Service;
  analyzerTerms?: string;
  busyReview: boolean;
  review: ReactNode;
  openReview: (service: Service) => void;
  observeSavedPolicy: () => Promise<StartingTerms | undefined>;
  approveStartingPolicy: (terms: StartingTerms) => Promise<void>;
  refreshReadiness: () => Promise<void>;
}) {
  const [{ snapshot: state, deliveryEvent, laneReceipts, focus }, setView] = useState<TransferView>({});
  const [busy, setBusy] = useState(false);
  const [watchError, setWatchError] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [startingTerms, setStartingTerms] = useState<StartingTerms>();

  useEffect(() => {
    if (busy) return;
    let active = true;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      controller = new AbortController();
      try {
        const snapshot = await fetchStatus(controller.signal);
        if (!active) return;
        setView(previous => updateView(previous, snapshot));
        setWatchError(false);
        if (snapshot.enabled) timer = setTimeout(() => void refresh(), snapshot.session?.stopped_at === null ? 1000 : 5000);
      } catch {
        if (active) { setWatchError(true); timer = setTimeout(() => void refresh(), 5000); }
      }
    }
    void refresh();
    return () => { active = false; controller?.abort(); clearTimeout(timer); };
  }, [fetchStatus, busy]);

  const session = state?.session;
  const jobs = state?.jobs ?? [];
  const evidence = state?.policy_change;
  const active = session?.stopped_at === null;
  const threeLanes = !!state?.three_lanes;
  const comparisonEnabled = !threeLanes && process.env.NEXT_PUBLIC_PRIVORA_COMPARISON === "1";
  const comparison = useComparisonTransfer(comparisonEnabled && !active);

  const items = jobs.flatMap(job => job.items);
  const received = receivedFiles(state);
  const bytes = jobs.reduce((total, job) => total + job.confirmed_bytes, 0);
  const withheld = items.filter(item => item.delivery === "NOT_SENT" && (item.decision === "BLOCK" || item.decision === "REVIEW_REQUIRED")).length;
  const awaitingOutcome = items.filter(item => !item.delivery && !item.receipt_at);
  const pending = awaitingOutcome.filter(item => item.status === "QUEUED" || item.status === "RUNNING").length;
  const running = awaitingOutcome.some(item => item.status === "RUNNING");
  const unknown = items.filter(item => item.delivery === "UNKNOWN").length;

  async function sessionAction(action: "start" | "transfer" | "stop") {
    setBusy(true);
    setError("");
    try {
      const snapshot = await mutate(action === "stop" ? "DELETE" : "POST", action === "transfer");
      setView(previous => updateView(previous, snapshot));
    }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : "Unable to update monitoring.";
      setError(message.includes("needs a fresh, approved policy")
        ? "Monitoring did not start. Check the saved terms and review the current version before trying again."
        : message);
      await refreshReadiness().catch(() => undefined);
    }
    finally { setBusy(false); }
  }

  const resumed = active && state?.rehearsal_policy === "RESTORED";
  const paused = active && state?.rehearsal_policy === "PAUSED" && pending > 0;
  const temporarilyWithheld = paused ? pending : 0;
  const restricted = active && !resumed && (session.approval === "REVIEW_REQUIRED" || paused);
  const restored = restricted && (
    (session.current_version === analyzer?.current_version && noTrainingTerms(analyzerTerms)) ||
    (evidence?.version === session.current_version && evidence.passages.some(passage => noTrainingTerms(passage.new)))
  );
  const headline = !active ? "Protect every AI-agent transfer." : threeLanes ? "Live transfer protection" : resumed ? "Approved terms restored." : paused ? "Files withheld for now." : restored ? "No-training terms restored." : restricted ? "Confidential transfers restricted." : pending ? "Protecting files in transit." : received ? "Transfer results are ready." : "Monitoring is active.";
  async function startPrivora(restoredReview = false) {
    setError("");
    if (!state?.enabled || !analyzer?.enabled) {
      setError("The protected queue or analyzer is unavailable. Check the rehearsal Live service.");
      return;
    }
    setBusy(true);
    try {
      const current = await observeSavedPolicy();
      if (!current?.service.enabled || !current.service.current_version) {
        setError("The analyzer has no observed terms to review.");
      } else if (restoredReview) {
        openReview(current.service);
      } else {
        setStartingTerms(current);
        requestAnimationFrame(() => document.getElementById("starting-policy-confirmation")?.focus());
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to check the saved terms.");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndStart() {
    if (!startingTerms || !noTrainingTerms(startingTerms.content)) return;
    setError("");
    setBusy(true);
    try {
      await approveStartingPolicy(startingTerms);
      setStartingTerms(undefined);
      await sessionAction(threeLanes ? "transfer" : "start");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to approve the starting terms.");
    } finally {
      setBusy(false);
    }
  }
  const flow = restricted ? "withheld" : !active ? "idle" : running ? "processing" : pending ? "queued" : jobs.length ? "finished" : "idle";
  const flowText = {
    idle: "Ready to send a synthetic file for review",
    processing: "Privora is processing a file for the review agent",
    queued: "Files are waiting in the queue",
    finished: "Batch finished. See the confirmed totals below.",
    withheld: paused ? "Waiting files withheld at the gateway" : "Confidential files held at the gateway",
  }[flow];
  const observation = active ? session.observation_status : analyzer?.fetch_status;
  const focusedFile = focus && rehearsalFile(focus.lane, focus.item);
  const laneFlow = focus?.phase === "receipt" ? "finished" : focus?.phase ?? "idle";
  const recordGroups = threeLanes && jobs.length ? rehearsalAnalyzers.map(analyzer => ({
    id: analyzer.prefix,
    title: analyzer.name,
    jobs: jobs.filter(job => (job.lane ?? "a_").startsWith(analyzer.prefix)),
  })) : jobs.toReversed().map(job => ({ id: job.id, title: "File results", jobs: [job] }));
  return <section className="protection-panel transfer-stage" aria-labelledby="protection-title" data-restricted={threeLanes ? focus?.phase === "withheld" : restricted} data-flow={threeLanes ? laneFlow : flow}>
    <div className="transfer-controls">
      <span><ShieldCheck size={16} aria-hidden="true" /> {active ? "Privora monitoring" : "Privora"}</span>
      {(!active || (threeLanes && !jobs.length)) && !startingTerms && <button className="primary" disabled={busy || busyReview || comparison.running || comparison.busy} onClick={() => void startPrivora()}>
        {busy ? "Starting..." : "Start Privora"} <ArrowRight size={16} />
      </button>}
      {active && <button className="ghost" disabled={busy} onClick={() => void sessionAction("stop")}>Stop Privora</button>}
    </div>
    <div className="transfer-stage-main">
      <div className="transfer-stage-copy">
        <p className="transfer-health"><ShieldCheck size={15} /> {watchError ? "Connection interrupted" : observation === "OK" ? "Analyzer policy reachable" : observation ? "Analyzer policy could not be verified" : "Checking analyzer policy"}</p>
        <h1 id="protection-title">{headline}</h1>
        <p className="transfer-lead">{threeLanes ? "13 confidential and 7 public files per analyzer. Edit privacy.txt to change Analyzer A’s terms." : !active ? "Privora monitors external AI terms and checks each confidential file before it leaves your organization."
          : resumed ? "The observed terms match the approved starting policy. Waiting files can continue through the gateway."
          : paused ? session.observation_status !== "OK"
            ? "Privora could not verify the saved terms. Waiting files stay at the gateway until verification succeeds."
            : "The updated terms need review. Restore the exact approved starting terms in privacy.txt and waiting files will continue automatically."
          : restored ? pending
            ? "Approve the restored terms to let files still in the queue proceed. Files already withheld keep their recorded outcome."
            : "This batch has no files waiting. Approve the restored terms, then stop this run and start a new batch."
          : restricted ? "The analyzer's current terms require review. Privora withholds subsequent confidential files that fail the policy check."
          : received && pending ? "Once the first receipt appears, edit and save the analyzer's external privacy.txt to see Privora respond."
          : jobs.length ? "Delivery totals are confirmed by the analyzer." : state?.demo_enabled ? "Privora is ready. Start the file transfer to send synthetic documents to the review agent." : "Waiting for a protected batch from the MCP client."}</p>
        {!active && <div className="protection-next">
      {!state ? <p role="status">{watchError ? "Unable to read protection status. Check that Live is running." : "Checking Live protection..."}</p>
        : !state.enabled ? <p>The synthetic transfer queue is disabled for this Live service. Use the isolated rehearsal configuration.</p>
        : !analyzer?.enabled ? <p>The fictional analyzer must be configured and enabled before this test can run.</p>
        : null}
    </div>}
        {startingTerms && <section className="section panel live-panel" id="starting-policy-confirmation" tabIndex={-1}>
          <h2>Approve the starting terms?</h2>
          <p className="muted">Current terms served by Analyzer A</p>
          <div className="policy-review-terms"><pre>{startingTerms.content}</pre></div>
          {noTrainingTerms(startingTerms.content)
            ? <button className="primary" disabled={busy} onClick={() => void approveAndStart()}>{busy ? "Starting..." : "Approve and start Privora"}</button>
            : <p role="status">Restore the approved no-training sentence in privacy.txt, then click Start Privora again.</p>}
          <button type="button" className="ghost" disabled={busy} onClick={() => { setStartingTerms(undefined); setError(""); }}>Cancel</button>
        </section>}
        {restored && !paused && (review || <button className="primary" disabled={busy || busyReview}
          onClick={() => void startPrivora(true)}>Review restored terms</button>)}
        {!active && comparisonEnabled && <ComparisonTransfer state={comparison.state} error={comparison.error} startedHere={comparison.startedHere} />}
        {!threeLanes && (active ? state?.demo_enabled && !jobs.length : comparisonEnabled) &&
          <button className="primary" disabled={!state || busy || comparison.busy}
            onClick={() => active ? void sessionAction("transfer") : void comparison.change(comparison.running ? "DELETE" : "POST")}>
            {busy || comparison.busy ? "Working..." : !active && comparison.running ? "Stop file transfer" : "Start file transfer"} <ArrowRight size={16} />
          </button>}
        {error && <p className="message error" role="alert">{error}</p>}
      </div>
      <figure className="transfer-stage-visual">
        <CommandVisual key={threeLanes ? focus?.lane ?? "idle" : "single"} showFile receiptSignal={threeLanes ? focus?.receipt : deliveryEvent}
          description="File requests pass through the Privora enforcement boundary before reaching the controlled analyzer."
          requestLabel={focusedFile ? focusedFile.classification.toUpperCase() + " FILES" : "SYNTHETIC FILES"}
          destinationLabel={threeLanes ? "ANALYZER A" : "AI REVIEW AGENT"} branch={threeLanes ? focus?.lane.startsWith("b_") ? "b" : "a" : undefined} />
        {threeLanes ? focus && focusedFile && <figcaption role="status">
          <strong>{focus.phase === "receipt" ? "Delivered " : focus.phase === "processing" ? "Processing " : "Held "}{focusedFile.name}</strong>
          <span>{rehearsalLaneName(focus.lane)}</span>
        </figcaption> : <figcaption><strong role="status">{flowText}</strong><span>External AI review agent / controlled test analyzer</span></figcaption>}
      </figure>
    </div>
    {threeLanes && <RehearsalLanes jobs={active ? jobs : []} incident={active ? state.incident : null} investigate={investigate} receipts={laneReceipts} />}
    {session ? <>
      {active && !state?.demo_enabled && <p className="protection-submit">Send the synthetic files from your MCP client using session ID <code>{session.id}</code>
        <button className="ghost" aria-label="Copy session ID" onClick={() => void navigator.clipboard.writeText(session.id)
          .then(() => setCopyStatus("Session ID copied."), () => setCopyStatus("Select the session ID to copy it."))}><Copy size={15} /></button>
        <span role="status">{copyStatus}</span></p>}

      {!threeLanes && active && items.length > 0 && <div className="transfer-outcomes" aria-hidden="true">
        <span className="outcome-delivered" style={{ flexGrow: received }} />
        <span className="outcome-denied" style={{ flexGrow: withheld }} />
        <span className="outcome-held" style={{ flexGrow: temporarilyWithheld }} />
        <span style={{ flexGrow: items.length - received - withheld - temporarilyWithheld }} />
      </div>}
      {!threeLanes && active && <dl className="protection-counts">
        <div><dt>Delivered</dt><dd>{received}</dd></div>

        {paused ? <div className="count-held"><dt>Withheld for now</dt><dd>{temporarilyWithheld}</dd></div>
          : <div><dt>Remaining</dt><dd>{pending}</dd></div>}
        {withheld > 0 && <div className="count-denied"><dt>Denied</dt><dd>{withheld}</dd></div>}
        {unknown > 0 && <div><dt>Delivery unknown</dt><dd>{unknown}</dd></div>}
      </dl>}

      <details className="protection-change">
        <summary>{active ? threeLanes ? "Transfer records" : "View evidence" : "View previous run"}</summary>
        {paused && <p>{temporarilyWithheld} waiting files have not been sent. {session.observation_status === "OK" && evidence?.version === session.current_version && evidence.rule}</p>}
        <p className="muted">{bytes.toLocaleString()} bytes confirmed at receiver. Latest observation attempt {time(session.last_attempt)} ({label(session.observation_status)}).</p>
        {evidence && <>
        <h3>Analyzer terms changed</h3>
        <p className="muted">{time(evidence.observed_at)} / {evidence.rule}</p>
        {evidence.passages.map((entry, index) => <div className="cc-diff" key={index}>
          {changedWords(entry.old, entry.new).map((side, column) => <div className={column ? "cc-new" : "cc-old"} key={column}>
            <span>{column ? "Observed" : "Previous"}</span><p>{side.map((part, i) => part.changed
              ? column ? <ins key={i}>{part.text}</ins> : <del key={i}>{part.text}</del> : part.text)}</p>
          </div>)}
        </div>)}
        <button className="ghost" onClick={() => investigate(evidence.id)}>Inspect policy impact</button>
        </>}
      <div className="protection-jobs">{recordGroups.map(group => {
        const records = group.jobs.flatMap(job => job.items.map(item => ({ job, item })));
        return <details key={group.id}>
        <summary>{group.title} ({records.filter(({ item }) => item.finished_at).length} of {records.length} processed)</summary>
        {!threeLanes && <p className="muted">Job ID <code>{group.id}</code></p>}
        <ol>{records.map(({ job, item }) => {
          const file = job.lane ? rehearsalFile(job.lane, item) : null;
          return <li key={item.request_id}>
          <span><strong>{file?.name ?? item.resource_id}</strong> {file && <span className="file-class" data-classification={file.classification}>{file.classification}</span>}<small>{!file && item.classification && label(item.classification)} {item.policy_version != null && version(item.policy_version)} / <code>{item.request_id}</code></small></span>
          <span>{item.decision ? <Status value={item.decision} /> : (job.enforcement === "PAUSED" || (!job.lane && paused)) && item.status === "QUEUED" ? "Withheld for now" : label(item.status)} {item.delivery && <Status value={item.delivery} />}</span>
          <span>{item.received_bytes != null ? item.received_bytes.toLocaleString() + " bytes received" : item.reason ? label(item.reason) : ""}
            {item.receipt_at && <small>{time(item.receipt_at)}</small>}</span>
        </li>;})}</ol>
      </details>;})}{!jobs.length && <p className="muted">Waiting for an external MCP client to submit a job.</p>}</div>
      </details>
    </> : null}
  </section>;
}

function noTrainingTerms(content?: string) {
  return content?.trim() === "Customer-submitted documents are not used for AI model training.";
}

export type { ProtectionStatus };
