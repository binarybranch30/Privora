import { ArrowRight, FileText, Inbox, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { commandFrames, type CommandFrame } from "./command-data";
import { explainDecision } from "./audit-timeline";
import { CommandVisual } from "./command-visual";
import { changedWords, isWebUrl, label, names, time, version, type Audit, type Change, type Impact, type Result, type Snapshot } from "./investigation-data";
import "./command-center.css";

export function CommandCenter({ data, live, pending, focus, observed, preferred, replayKey, receiptCount, openPolicy, openAudit, openImpact, loadImpact, incidentFrames, incidentImpact, autoplay }: {
  data: Snapshot; live: boolean; pending: boolean; focus?: Result; observed?: Change; preferred?: Change; replayKey?: number | string;
  receiptCount?: number; openPolicy: (id: number) => void; openAudit: (row?: Audit) => void;
  openImpact: (id: number) => void; loadImpact?: (id: number) => Promise<Impact>;
  incidentFrames?: CommandFrame[]; incidentImpact?: Impact; autoplay?: boolean;
}) {
  const frames = incidentFrames ?? commandFrames(data, focus, observed, preferred, live);
  const scope = [focus?.request_id, observed?.id, preferred?.id, pending, replayKey, ...frames.map(frame => frame.id)].join("/");
  const [selection, setSelection] = useState<{ scope: string; index: number; revision: number } | undefined>(
    () => autoplay && frames.length ? { scope, index: 0, revision: 0 } : undefined,
  );
  const [runScope, setRunScope] = useState<string | undefined>(() => autoplay && frames.length > 1 ? scope : undefined);
  const [paused, setPaused] = useState<string>();
  const running = runScope === scope && !pending;
  const selected = selection?.scope === scope && !pending ? selection : undefined;
  const observedIndex = observed ? frames.findIndex(frame => frame.id === "policy:" + observed.id) : -1;
  const focusedIndex = focus ? frames.findIndex(frame => frame.id === focus.request_id) : -1;
  const latestRecorded = frames.findLastIndex(frame => frame.kind === "event" && frame.change != null);
  const defaultIndex = focusedIndex >= 0 ? focusedIndex : observedIndex >= 0 ? observedIndex
    : latestRecorded >= 0 ? latestRecorded : frames.findLastIndex(frame => frame.kind !== "impact" && frame.kind !== "audit");
  const index = selected?.index ?? defaultIndex;
  const frame = pending ? undefined : frames[index];
  const decision = frame?.event;
  const change = frame?.change;
  const previous = data.versions.find(item => item.id === change?.previous_id);
  const next = data.versions.find(item => item.id === change?.version_id);
  const passage = change?.passages[0];
  const words = passage && changedWords(passage.old, passage.new);
  const demoService = live ? undefined : data.services.find(item => item.id === "external_analyzer");
  const destination = frame?.audit?.destination ?? change?.service_id ?? demoService?.id;
  const received = decision?.decision === "ALLOW" && decision.delivery === "RECEIVED";
  const withheld = decision?.delivery === "NOT_SENT" && (decision.decision === "BLOCK" || decision.decision === "REVIEW_REQUIRED");
  const decisionText = decision ? label(decision.decision) + " / " + (decision.delivery === "UNKNOWN" ? "Delivery unconfirmed" : label(decision.delivery)) : undefined;
  const heading = pending ? "Transfer requested" : received ? "Transfer delivered" : withheld ? "Transfer intercepted"
    : decision ? "Transfer evaluated" : frame?.kind === "policy" ? change?.previous_id == null ? "Policy observed" : "Terms changed"
      : frame?.kind === "rule" ? change?.enforcement === "REVIEW_REQUIRED" ? "Approval held" : ["BLOCK", "RESTRICTED"].includes(change?.enforcement ?? "") ? "Rule enforced" : "Organization rule"
      : frame?.kind === "impact" ? "Trace the impact" : frame?.kind === "audit" ? "Evidence recorded"
        : frame?.kind === "gap" ? "Evidence unavailable" : "Enforcement replay";
  const tone = pending ? "observe" : received ? "allow" : withheld ? "deny" : frame?.kind === "rule" || frame?.kind === "impact" ? "review" : "observe";
  const environment = live ? "LIVE / RECORDED EVIDENCE" : "DEMO / SYNTHETIC FIXTURES";
  const description = pending ? "Waiting for the gateway response."
    : received ? "The analyzer confirmed receipt. " + explainDecision(decision)
    : withheld ? explainDecision(decision) + " The gateway did not send this request to the analyzer."
    : decision ? explainDecision(decision)
    : frame?.kind === "policy" ? "Privora recorded this version of the monitored provider policy."
    : frame?.kind === "rule" ? change?.rule
    : frame?.kind === "impact" ? "Follow the observed change to its configured workflows and earlier deliveries."
    : frame?.kind === "audit" ? "Inspect the gateway decision and delivery state for this recorded request."
    : frame?.kind === "gap" ? frame.detail
    : demoService ? "Run the first transfer in the walkthrough above to see the gateway decision here."
      : "Inspect a transfer or policy observation as evidence becomes available.";
  const animate = !pending && (selected != null || replayKey != null || !!observed);
  const recordedVersion = decision?.policy_version ?? next?.number;
  const currentVersion = !frame ? demoService?.current_version : undefined;

  useEffect(() => {
    if (!running) return;
    const nextIndex = index + 1;
    const timer = window.setTimeout(() => {
      if (nextIndex >= frames.length) setRunScope(undefined);
      else setSelection(previous => ({ scope, index: nextIndex, revision: (previous?.revision ?? 0) + 1 }));
    }, incidentFrames ? frame?.kind === "policy" ? 4800 : frame?.kind === "impact" ? 4500 : 3400
      : frame?.kind === "policy" ? 2400 : 1800);
    return () => window.clearTimeout(timer);
  }, [running, index, frames.length, scope, frame?.kind, incidentFrames]);

  function show(i: number, seek = false) {
    setRunScope(undefined);
    setPaused(seek && incidentFrames ? scope : undefined);
    setSelection(previous => ({ scope, index: i, revision: (previous?.revision ?? 0) + 1 }));
  }

  const transport = <div className={incidentFrames ? "cc-playback incident-transport" : "cc-playback"}>
      {incidentFrames && frame && <p className="incident-progress" role="status">Stage {index + 1} of {frames.length} / {running ? "Playing recorded evidence" : paused === scope ? "Paused" : "Recorded evidence"}</p>}
      <ol className="cc-film" aria-label="Recorded replay stages">{frames.map((item, i) => <li key={item.id}><button aria-pressed={i === index && !pending} disabled={pending} onClick={() => show(i, true)}>
        <span>{String(i + 1).padStart(2, "0")}</span>{item.title}
      </button></li>)}</ol>
      {frames.length > 0 && <div className="actions"><button className="primary" disabled={pending} onClick={() => {
        if (running) { setRunScope(undefined); setPaused(scope); }
        else if (paused === scope) { setPaused(undefined); setRunScope(scope); }
        else { show(0); setRunScope(scope); }
      }}>{running ? <Pause size={16} /> : <Play size={16} />}{running ? "Pause" : paused === scope ? "Resume" : "Replay recorded sequence"}</button>
        <button className="ghost" aria-label={incidentFrames ? "Replay from the beginning" : "Return to first recorded stage"} disabled={pending}
          onClick={() => { show(0); if (incidentFrames) setRunScope(scope); }}><RotateCcw size={16} /></button></div>}
    </div>;

  return <section className="command-center" aria-label="Security event replay" data-tone={tone} data-stage={pending ? "pending" : frame?.kind ?? "base"}>
    {incidentFrames && transport}
    <div className="cc-hero">
      <div className="cc-title">
        <p className="cc-environment">{environment}</p>
        <h2 aria-live="polite">{heading}</h2>
        <p className="cc-description">{description}</p>
        <p className="cc-state">{pending ? "Request pending" : decisionText ?? (frame?.kind === "rule" && change ? label(change.enforcement) : frame?.title ?? "Awaiting recorded evidence")}</p>
      </div>
      <figure className="cc-figure" data-animate={animate} key={(frame?.id ?? "idle") + ":" + (selected?.revision ?? replayKey ?? "")}>
        <CommandVisual description={heading + ". " + (decisionText ?? "")}
          requestLabel={decision?.classification ? label(decision.classification).toUpperCase() + " REQUEST" : "MCP REQUEST"}
          destinationLabel={destination ? names(data.services, destination).slice(0, 32).toUpperCase() : "DESTINATION"} />
        <figcaption><span><i /> Privora enforcement gate</span><span>
          {recordedVersion != null && <code>RECORDED POLICY {version(recordedVersion)}</code>}
          {currentVersion != null && <code>CURRENT POLICY {version(currentVersion)}</code>}
          <code>{frame?.title.toUpperCase() ?? (pending ? "AWAITING RESPONSE" : "ENFORCEMENT BOUNDARY")}</code>
        </span></figcaption>
      </figure>
    </div>
    <div className="cc-evidence">
      <section className="cc-policy">
        <div className="cc-section-heading"><h3><FileText size={16} /> Policy evidence</h3>{change && <button className="ghost" onClick={() => openPolicy(change.id)}>Compare versions <ArrowRight size={14} /></button>}</div>
        {words ? <div className="cc-diff">
          {words.map((side, i) => <div key={i} className={i === 0 ? "cc-old" : "cc-new"}>
            <span>{i === 0 ? "Previous terms" : "Observed terms"} <code>{version(i === 0 ? previous?.number : next?.number)}</code></span>
            <p>{side.length ? side.map((word, n) => word.changed ? i === 0 ? <del key={n}>{word.text}</del> : <ins key={n}>{word.text}</ins> : word.text)
              : i === 0 ? "No earlier passage" : "Passage removed"}</p>
          </div>)}
        </div> : <p className="cc-empty">{change ? "No changed passage is available for this observation."
          : demoService && !frame ? "The comparison appears after the policy-change step."
            : "Select a policy observation or a transfer linked to policy evidence."}</p>}
        {change && <p className="cc-rule">{change.rule}{next && isWebUrl(next.source) && <> <a href={next.source} target="_blank" rel="noreferrer">Policy source</a></>}</p>}
      </section>
      <section>
        <div className="cc-section-heading"><h3><Inbox size={16} /> Transfer evidence</h3>{frame?.audit && <button className="ghost" onClick={() => openAudit(frame.audit)}>Inspect audit <ArrowRight size={14} /></button>}</div>
        {receiptCount != null && <div className="cc-receipt"><strong>{receiptCount}</strong><span>Current Demo analyzer receipts</span></div>}
        {decision && <p className="cc-delivery">{received ? "Receipt confirmed" : decision.delivery === "NOT_SENT" ? "No receipt for this request" : "Delivery unconfirmed"}</p>}
        {frame?.kind === "impact" && change && (incidentFrames ? <IncidentImpact impact={incidentImpact} data={data}
          open={() => openImpact(change.id)} openAudit={openAudit} /> : loadImpact &&
          <CommandImpact id={change.id} load={loadImpact} open={() => openImpact(change.id)} />)}
        {(frame?.audit || change) && <p className="cc-audit"><span>{time(frame?.audit?.timestamp ?? change?.observed_at)}</span>
          {frame?.audit && <code>{frame.audit.operation}</code>}
          <code>{decision?.reason ?? frame?.audit?.reason ?? change?.reason}</code>{(decision ?? frame?.audit) && <code>{(decision ?? frame?.audit)?.request_id}</code>}</p>}
        {!decision && !change && receiptCount == null && <p className="cc-empty">No transfer selected.</p>}
      </section>
    </div>
    {!incidentFrames && transport}
  </section>;
}

function IncidentImpact({ impact, data, open, openAudit }: { impact?: Impact; data: Snapshot; open: () => void; openAudit: (row: Audit) => void }) {
  if (!impact) return <><p className="muted">Impact evidence was unavailable when this replay started.</p><button className="ghost" onClick={open}>Open Blast Radius</button></>;
  return <div className="incident-impact-results">
    <p>{impact.restricted_workflows} currently restricted / {impact.unaffected_workflows} unaffected / {impact.historical_review_candidates} historical review candidates</p>
    <ul>{impact.workflows.slice(0, 5).map(path => <li key={path.id}>
      {label(path.classification)} to {names(data.services, path.destination)} / {path.affected ? label(path.decision ?? "UNKNOWN") : "Unaffected by change"}
    </li>)}</ul>
    {!!impact.historical_review_candidates && <p className="muted">Candidates are earlier confirmed deliveries that warrant review.</p>}
    {impact.workflows.flatMap(path => path.historical.events).slice(0, 3).map(event => {
      const row = data.audit.find(item => item.request_id === event.request_id);
      return row ? <button className="ghost" key={event.request_id} onClick={() => openAudit(row)}>Earlier delivery / {time(event.timestamp)}</button>
        : <p key={event.request_id}><code>{event.request_id}</code> / {time(event.timestamp)}</p>;
    })}
    <button className="ghost" onClick={open}>Open Blast Radius <ArrowRight size={14} /></button>
  </div>;
}

function CommandImpact({ id, load, open }: { id: number; load: (id: number) => Promise<Impact>; open: () => void }) {
  const [result, setResult] = useState<{ id: number; impact?: Impact }>();
  useEffect(() => {
    let active = true;
    load(id).then(impact => { if (active) setResult({ id, impact }); }, () => { if (active) setResult({ id }); });
    return () => { active = false; };
  }, [id, load]);
  const impact = result?.id === id ? result.impact : undefined;
  return <>
    {impact ? <p className="cc-delivery">{impact.restricted_workflows} restricted / {impact.unaffected_workflows} unaffected / {impact.historical_review_candidates} historical review candidates</p>
      : <p role="status">{result?.id === id ? "Impact could not be loaded." : "Loading impact evidence…"}</p>}
    <button className="ghost" onClick={open}>Open Blast Radius <ArrowRight size={14} /></button>
  </>;
}
