import { ArrowRight, GitFork, History, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AuditTimeline, EventDetails, EventRows } from "./audit-timeline";
import { CommandCenter } from "./command-center";
import { IncidentOverview, IncidentWalkthrough, type IncidentSelection } from "./incidents";
import { changeForInvestigation, type VerificationCandidate } from "./incident-data";
import { changedWords, demoWorkflow, instant, isWebUrl, label, names, policyForEvent, time, version, type Audit, type Impact, type Result, type Snapshot, type View, type Workflow } from "./investigation-data";
import { Network, networkEvidence } from "./network";
import { Policies } from "./policies";
import { Status } from "./status";

const titles: Record<View, string> = { overview: "Security Command Center", investigation: "Incident investigation", policies: "Policy Intelligence", impact: "Privacy Blast Radius", audit: "Transfer audit", configuration: "Service setup" };

function WorkflowFacts({ workflow }: { workflow: Workflow }) {
  return <>
    {workflow.decision && <p>Current evaluation <Status value={workflow.decision} /></p>}
    <dl className="facts">
      <dt>Resource</dt><dd><code>{workflow.resource_id}</code></dd>
      <dt>Operation</dt><dd><code>{workflow.operation}</code></dd>
      <dt>Classification</dt><dd>{label(workflow.classification)}</dd>
      {workflow.source_version != null && <><dt>Source policy</dt><dd>{version(workflow.source_version)}</dd></>}
      {workflow.policy_version != null && <><dt>Destination policy</dt><dd>{version(workflow.policy_version)}</dd></>}
      {workflow.reason && <><dt>Reason</dt><dd><code>{workflow.reason}</code></dd></>}
      {workflow.account_scope && <><dt>Account scope</dt><dd>{workflow.account_scope}</dd></>}
      {workflow.rule_id && <><dt>Organization rule</dt><dd><code>{workflow.rule_id}</code>{workflow.no_training ? " / No AI training on confidential documents" : ""}{workflow.allow_public ? " / Public transfers allowed" : " / Public transfers prohibited"}</dd></>}
      {workflow.evaluated_at && <><dt>Evaluated</dt><dd>{time(workflow.evaluated_at)}</dd></>}
    </dl>
  </>;
}

export function Workspace({ view, navigate, data, live, toolbar, demoControls, configuration, playback, observedChange, pending, receiptCount, guidedChangeId, guidedRetryId, loadImpact, serviceActions, reviewService, connectorConfigured, recordDemo, recording, protection, transferDemo }: {
  view: View; navigate: (view: View) => void; data: Snapshot; live: boolean; toolbar?: ReactNode;
  demoControls?: (inspectRetry: () => void, inspectImpact: () => void) => ReactNode;
  configuration?: ReactNode; playback?: Result; observedChange?: number; pending?: number; receiptCount?: number; guidedChangeId?: number; guidedRetryId?: string; loadImpact?: (id: number) => Promise<Impact>;
  serviceActions?: (id: string) => ReactNode;
  reviewService?: (id: string) => void; connectorConfigured?: boolean;
  recordDemo?: () => Promise<(IncidentSelection & { change: NonNullable<IncidentSelection["change"]> }) | undefined>;
  recording?: boolean;
  transferDemo?: boolean;
  protection?: (open: (change: number) => void) => ReactNode;
}) {
  const [incident, setIncident] = useState<IncidentSelection>();
  const [lookingUp, setLookingUp] = useState<string>();
  const lookupSequence = useRef(0);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [changeId, setChangeId] = useState<number>();
  const [protectedChangeId, setProtectedChangeId] = useState<number>();
  const [workflowId, setWorkflowId] = useState<number>();
  const [serviceId, setServiceId] = useState<string>();
  const [eventId, setEventId] = useState<string>();
  useEffect(() => () => { lookupSequence.current++; }, [view, eventId]);
  useEffect(() => {
    if (view === "investigation") document.getElementById("workspace-title")?.focus({ preventScroll: true });
  }, [view]);
  const [manualSelection, setManualSelection] = useState<string>();
  const [dismissedChange, setDismissedChange] = useState<number>();
  const [impactWorkflow, setImpactWorkflow] = useState<number>();
  const [impactService, setImpactService] = useState<string>();
  const change = data.changes.find(item => item.id === (changeId ?? guidedChangeId)) ?? data.changes[0];
  const guidedRetry = data.audit.find(item => item.request_id === guidedRetryId);
  const replay = playback && playback.request_id !== manualSelection ? playback : undefined;
  const observed = data.changes.find(item => item.id === observedChange && item.id !== dismissedChange);
  const event = pending == null && !observed ? data.audit.find(item => item.request_id === (replay?.request_id ?? eventId)) : undefined;
  const defaultWorkflow = data.workflows.find(item => item.decision === "BLOCK" || item.decision === "REVIEW_REQUIRED") ?? data.workflows[0];
  const demoAffected = observed && observed.enforcement === "REVIEW_REQUIRED" ? data.workflows.filter(item =>
    item.destination === observed.service_id && item.classification === "CONFIDENTIAL") : [];
  const selectedId = pending ?? (replay ? demoWorkflow(replay) : event ? event.workflow_id ?? undefined : demoAffected[0]?.id ?? workflowId ?? defaultWorkflow?.id);
  const workflow = data.workflows.find(item => item.id === selectedId);
  const service = replay ? undefined : data.services.find(item => item.id === serviceId);
  const review = data.services.filter(item => item.status === "REVIEW_REQUIRED" || item.status === "UNKNOWN" || item.fetch_status === "FETCH_FAILED");
  const restricted = data.workflows.filter(item => item.decision === "BLOCK" || item.decision === "REVIEW_REQUIRED");

  function clearReplay() {
    setManualSelection(playback?.request_id);
    setDismissedChange(observedChange);
  }
  function selectWorkflow(id: number) { clearReplay(); setWorkflowId(id); setServiceId(undefined); setEventId(undefined); }
  function selectService(id: string) { clearReplay(); setServiceId(id); setEventId(undefined); }
  function revealNetwork() {
    setNetworkOpen(true);
    requestAnimationFrame(() => {
      const network = document.getElementById("workspace-network");
      network?.querySelector("summary")?.focus({ preventScroll: true });
      network?.scrollIntoView({ block: "start" });
    });
  }
  function selectEvent(row: Audit, target: View) {
    clearReplay();
    setWorkflowId(row.workflow_id ?? undefined);
    setServiceId(undefined);
    setEventId(row.request_id);
    navigate(target);
  }
  function openChange(id: number, target: View = "policies") {
    clearReplay();
    setChangeId(id);
    setImpactWorkflow(undefined);
    setImpactService(undefined);
    navigate(target);
  }
  const inspectedService = !replay && pending == null && data.services.some(item => item.id === serviceId) ? serviceId : workflow?.destination;
  const policyService = data.services.find(item => item.id === (observed?.service_id ?? inspectedService));
  const policyChange = data.changes.find(item => item.service_id === policyService?.id &&
    data.versions.some(record => record.id === item.version_id && record.number === policyService?.current_version));
  const latestTransfer = data.audit.find(item => item.workflow_id === workflow?.id && workflow != null);
  const replayKey = replay?.request_id;
  const previousVersion = data.versions.find(item => item.id === observed?.previous_id);
  const observedVersion = data.versions.find(item => item.id === observed?.version_id);
  const passage = observed?.passages[0];
  const diff = passage && changedWords(passage.old, passage.new);

  function beginIncident(change?: IncidentSelection["change"], focus?: Audit, verified?: VerificationCandidate, impact?: Impact) {
    setIncident({ data, change, focus, verified, impact, receiptCount });
    navigate("investigation");
    window.scrollTo(0, 0);
  }

  async function investigateTransfer(row: Audit) {
    const direct = changeForInvestigation(data, row, live);
    if (direct) { beginIncident(direct, row); return; }
    // Earlier receipts are linked through impact by their request ID, not by timing alone.
    const possible = row.delivery === "RECEIVED" && row.classification === "CONFIDENTIAL" && data.changes.find(change => {
      const previous = data.versions.find(item => item.id === change.previous_id);
      const matches = previous && (row.destination === change.service_id && row.policy_version === previous.number
        || row.source_service === change.service_id && row.source_version === previous.number);
      return matches && instant(row.timestamp).getTime() < instant(change.observed_at).getTime();
    });
    if (!possible || !loadImpact) { beginIncident(undefined, row); return; }
    const sequence = ++lookupSequence.current;
    setLookingUp(row.request_id);
    try {
      const impact = await loadImpact(possible.id);
      if (sequence !== lookupSequence.current) return;
      const linked = impact.workflows.some(path => (!live || path.id === row.workflow_id)
        && path.historical.events.some(item => item.request_id === row.request_id));
      if (linked) beginIncident(possible, row, undefined, impact);
      else beginIncident(undefined, row);
    } catch {
      if (sequence === lookupSequence.current) beginIncident(undefined, row);
    } finally {
      setLookingUp(current => current === row.request_id ? undefined : current);
    }
  }

  function eventInfo(row: Audit) {
    const evidence = policyForEvent(data, row);
    const linked = data.workflows.some(item => item.id === row.workflow_id);
    return <>
      <p className="context-route">{row.source_service === "demo_documents" ? "Synthetic documents" : names(data.services, row.source_service)} <ArrowRight size={14} /> {names(data.services, row.destination)}</p>
      <EventDetails key={row.request_id} event={row} />
      <div className="actions">
        <button className="primary" disabled={lookingUp === row.request_id} onClick={() => void investigateTransfer(row)}>
          {lookingUp === row.request_id ? "Finding linked evidence..." : "Open transfer investigation"}
        </button>
        {linked && view !== "overview" && <button className="ghost" onClick={() => { selectEvent(row, "overview"); revealNetwork(); }}>Show network path</button>}
        {evidence && <button className="ghost" onClick={() => openChange(evidence.id)}>Open policy evidence</button>}
      </div>
    </>;
  }

  return <>
    <div className={transferDemo && view === "overview" ? "workspace-heading transfer-toolbar" : "workspace-heading"}>
      <div hidden={transferDemo && view === "overview"}><h1 id="workspace-title" tabIndex={-1}>{transferDemo && view === "overview" ? "Transfer protection demo" : titles[view]}</h1><p>{transferDemo ? "Live monitoring with fictional terms and synthetic files" : live ? "Live environment / Observed policy and audit data" : "Demo environment / Synthetic fixtures"}</p></div>
      <div className="actions">{toolbar}</div>
    </div>
    {view === "overview" && <>
      {protection?.(id => { setProtectedChangeId(id); openChange(id, "impact"); })}
      {!transferDemo && <>
      {live && <section className="live-operational" aria-labelledby="live-operations-title">
        <div><h2 id="live-operations-title">Operations at a glance</h2>
          <p className="muted">GitHub MCP {connectorConfigured ? "configured" : "not configured"} / {data.workflows.length} configured routes</p></div>
        <dl>
          <div><dt>Monitored policies</dt><dd>{data.services.filter(item => item.fetch_status && item.fetch_status !== "LOCAL_PROFILE").length}</dd></div>
          <div><dt>Services needing attention</dt><dd>{review.length}</dd></div>
          <div><dt>Restricted routes</dt><dd>{restricted.length}</dd></div>
        </dl>
        <div className="actions">
          {review[0]?.status === "REVIEW_REQUIRED" && review[0].fetch_status !== "FETCH_FAILED" && review[0].current_version && reviewService
            ? <button className="primary" onClick={() => reviewService(review[0].id)}>Review {review[0].name}</button>
            : review.length ? <button className="primary" onClick={() => { selectService(review[0].id); revealNetwork(); }}>Inspect {review[0].name}</button>
            : <button className="ghost" onClick={() => navigate("configuration")}>View integrations and policies</button>}
          {restricted.length > 0 && <button className="ghost" onClick={() => { selectWorkflow(restricted[0].id); revealNetwork(); }}>Inspect restricted routes</button>}
        </div>
      </section>}
      <IncidentOverview data={data} live={live} open={beginIncident} loadImpact={loadImpact}
        demoAction={recordDemo && <button className="primary" disabled={recording} onClick={() => {
          const sequence = ++lookupSequence.current;
          void recordDemo().then(record => {
            if (!record || sequence !== lookupSequence.current) return;
            setIncident(record);
            navigate("investigation");
            window.scrollTo(0, 0);
          });
        }}>{recording ? "Recording the Demo incident..." : "Record a Demo incident"}</button>} />
      {demoControls && <details className="incident-demo-tools">
        <summary>Manual Demo tools</summary>
        {demoControls?.(() => guidedRetry ? selectEvent(guidedRetry, "audit") : navigate("audit"),
        () => guidedChangeId != null ? openChange(guidedChangeId, "impact") : navigate("impact"))}
        <CommandCenter data={data} live={live} focus={replay ?? event} observed={observed} preferred={changeId != null ? change : undefined}
        pending={pending != null} receiptCount={receiptCount} replayKey={replayKey}
        openPolicy={id => openChange(id)} openAudit={row => row ? selectEvent(row, "audit") : navigate("audit")}
        openImpact={id => openChange(id, "impact")} loadImpact={loadImpact} />
      </details>}
      <details className="command-network" id="workspace-network" open={networkOpen} onToggle={e => setNetworkOpen(e.currentTarget.open)}>
        <summary><GitFork size={17} /> MCP network and service inspector</summary>
        <div className="investigation-grid network-layout">
        <section className="map-surface" aria-label="Interactive MCP network">
          <div className="map-toolbar"><span><GitFork size={16} /> {data.workflows.length} configured {data.workflows.length === 1 ? "workflow" : "workflows"}</span><span>{live ? "Observed environment" : "Synthetic environment"}</span></div>
          <Network workflows={data.workflows} services={data.services} selected={serviceId && !replay && !observed && pending == null ? undefined : selectedId}
            service={replay || observed || pending != null ? undefined : serviceId} choose={selectWorkflow} chooseService={selectService}
            event={event?.workflow_id === selectedId ? event : replay} playback={replayKey} pending={pending}
            evidence={policyService ? networkEvidence(policyService, () => policyChange ? openChange(policyChange.id) : navigate("policies")) : undefined}
            affected={observed ? new Set(demoAffected.map(item => item.id)) : undefined}
            pulse={observed ? { key: observed.id, service: observed.service_id, workflows: new Set(demoAffected.map(item => item.id)) } : undefined} />
          <details className="workflow-list"><summary>Browse workflow list</summary>
            {data.workflows.map(item => <button className="ghost" key={item.id} onClick={() => selectWorkflow(item.id)}>{item.resource_id} / {label(item.classification)}</button>)}
            {!data.workflows.length && <p className="muted">No workflow bindings available.</p>}
          </details>
        </section>
        <aside className="inspector network-inspector" aria-label="Network inspector">
          <h2>{observed ? "Policy change" : event ? "Transfer details" : service?.name ?? (serviceId === "demo_documents" ? "Synthetic documents" : "Workflow details")}</h2>
          {observed ? <div className="change-inspection" key={observed.id}>
            <p className="version-transition"><code>{version(previousVersion?.number)}</code><ArrowRight size={16} /><code>{version(observedVersion?.number)}</code><Status value={observed.enforcement} /></p>
            {diff && <div className="inline-evidence">
              <p aria-label="Previous clause">{diff[0].map((item, i) => item.changed ? <del key={i}>{item.text}</del> : item.text)}</p>
              <p aria-label="Observed clause">{diff[1].map((item, i) => item.changed ? <ins key={i}>{item.text}</ins> : item.text)}</p>
            </div>}
            <h3>Organization rule</h3><p>{observed.rule}</p><code>{observed.reason}</code>
            <p className="muted">Public is outside this confidential rule. Its next transfer records the outcome.</p>
            <button className="ghost" onClick={() => openChange(observed.id)}>Compare policy versions</button>
          </div> : event ? eventInfo(event) : serviceId && !replay && pending == null ? <>
            {service && <><Status value={service.status} /><dl className="facts"><dt>Current policy</dt><dd>{version(service.current_version)}</dd><dt>Last checked</dt><dd>{time(service.last_checked)}</dd><dt>Monitoring</dt><dd>{label(service.fetch_status ?? (live ? "UNKNOWN" : "DEMO_FIXTURE"))}</dd></dl>
              <p>{isWebUrl(service.source) ? <a href={service.source}>Policy source</a> : <code>{service.source}</code>}</p></>}
            <h3>Related workflows</h3>
            {data.workflows.filter(item => [item.source_service, item.destination].includes(serviceId)).map(item =>
              <button key={item.id} className="ghost" onClick={() => selectWorkflow(item.id)}>{item.resource_id} / {item.operation}</button>)}
            {data.audit.some(item => [item.source_service, item.destination].includes(serviceId)) && <><h3>Recent transfers</h3><EventRows events={data.audit.filter(item => [item.source_service, item.destination].includes(serviceId)).slice(0, 3)} data={data} onSelect={row => selectEvent(row, "audit")} /></>}
            {serviceActions?.(serviceId)}
          </> : workflow ? <>
            <p className="context-route">{workflow.source_service === "demo_documents" ? "Synthetic documents" : names(data.services, workflow.source_service)} <ArrowRight size={14} /> {names(data.services, workflow.destination)}</p>
            <WorkflowFacts workflow={workflow} />
            {policyService && <p>Current service policy / {version(policyService.current_version)} <Status value={policyService.status} /></p>}
            {latestTransfer && <><h3>Latest recorded transfer</h3><p><Status value={latestTransfer.decision} /> <Status value={latestTransfer.delivery} /> / {version(latestTransfer.policy_version)}</p>
              <button className="ghost" onClick={() => selectEvent(latestTransfer, "audit")}>Inspect recorded event</button></>}
            {!workflow.decision && <p className="muted">{live ? "No current workflow evaluation was returned." : "Demo reports decisions when you run a transfer."}</p>}
            {workflow.decision_change_id != null && <button className="ghost" onClick={() => openChange(workflow.decision_change_id!)}>Open policy evidence</button>}
            {data.audit.some(item => item.workflow_id === workflow.id) && <><h3>Recent transfers</h3><EventRows events={data.audit.filter(item => item.workflow_id === workflow.id).slice(0, 3)} data={data} onSelect={row => selectEvent(row, "audit")} /></>}
          </> : <p className="muted">Select a service or workflow to inspect the policy and transfer evidence.</p>}
        </aside>
        </div>
      </details>
      <div className="investigation-grid overview-lower">
        <section className="timeline-summary"><div className="section-bar"><h2><History size={17} /> Recent activity</h2><button className="ghost" onClick={() => navigate("audit")}>Open audit <ArrowRight size={15} /></button></div>
          {data.audit.length ? <EventRows events={data.audit.slice(0, 3)} data={data} selected={event?.request_id} onSelect={row => selectEvent(row, "overview")} /> : <p className="empty">No MCP transfers recorded.</p>}
        </section>
        <section className="review-queue"><h2><ShieldAlert size={17} /> Needs attention</h2>
          {review.length ? review.map(item => <button className="queue-row" key={item.id} onClick={() => { selectService(item.id); revealNetwork(); }}><span>{item.name}</span><Status value={item.fetch_status === "FETCH_FAILED" ? item.fetch_status : item.status} /></button>) : <p className="empty">No services flagged for review in this snapshot.</p>}
          {data.changes[0] && <button className="ghost" onClick={() => openChange(data.changes[0].id)}>Latest policy change <ArrowRight size={15} /></button>}
          {data.services.filter(item => !data.workflows.some(path => path.source_service === item.id || path.destination === item.id)).map(item =>
            <button className="queue-row" key={"service:" + item.id} onClick={() => { selectService(item.id); revealNetwork(); }}><span>{item.name}</span><small>No workflow binding</small></button>)}
        </section>
      </div>
      </>}
    </>}
    {view === "investigation" && (incident ? <IncidentWalkthrough selection={incident} live={live} loadImpact={loadImpact}
      overview={() => navigate("overview")} openPolicy={id => openChange(id)}
      openImpact={id => openChange(id, "impact")}
      openAudit={row => row ? selectEvent(row, "audit") : navigate("audit")} />
      : <p className="empty">Select a recorded incident from Overview.</p>)}
    {view === "policies" && <Policies key={change?.id} data={data} live={live} impactAvailable={!!loadImpact} reviewService={reviewService} change={change} select={id => openChange(id)} openInvestigation={() => change && beginIncident(change)} openImpact={() => change && openChange(change.id, "impact")}
      openNetwork={() => { if (change) selectService(change.service_id); navigate("overview"); revealNetwork(); }} />}
    {transferDemo && view !== "overview" && <button className="ghost" onClick={() => navigate("overview")}>Back to transfer demo</button>}
    {view === "impact" && changeId != null && changeId === protectedChangeId && !data.changes.some(item => item.id === changeId)
      ? <p role="status" className="message">Waiting for the dashboard to receive this policy observation...</p>
      : view === "impact" && (change && loadImpact ? <>
      {!live && <div className="impact-intro">
        <div><h2>{guidedRetry ? "Step 4 of 4 / Investigate blast radius" : "Demo impact"}</h2>
          <p>Trace the changed clause to the affected confidential route and the unaffected public route. Earlier receipts are candidates for review.</p></div>
        <div className="actions">{guidedRetry && <button className="primary" onClick={() => selectEvent(guidedRetry, "audit")}>Inspect retry in Audit <ArrowRight size={15} /></button>}
          <button className="ghost" onClick={() => navigate("overview")}>Back to walkthrough</button></div>
      </div>}
      <div className="actions"><button className="ghost" onClick={() => beginIncident(change)}>Watch this investigation <ArrowRight size={15} /></button></div>
      <label className="impact-select">Policy change<select value={change.id} onChange={e => openChange(Number(e.target.value), "impact")}>
        {data.changes.map(item => <option value={item.id} key={item.id}>{names(data.services, item.service_id)} / {time(item.observed_at)}</option>)}
      </select></label>
      <ImpactExplorer key={change.id} id={change.id} data={data} load={loadImpact} selection={impactWorkflow} select={id => { setImpactWorkflow(id); setImpactService(undefined); }} service={impactService} selectService={setImpactService}
        demo={!live} openPolicy={() => openChange(change.id)} openEvent={row => selectEvent(row, "audit")} />
    </> : <div className="empty"><p>{live ? "No observed policy change is available to investigate." : "No Demo policy change yet. Complete the policy-change step to see its impact."}</p>
      {!live && <button className="ghost" onClick={() => navigate("overview")}>Back to walkthrough</button>}</div>)}
    {view === "audit" && <AuditTimeline data={data} selected={event?.request_id} choose={row => selectEvent(row, "audit")} inspect={eventInfo} />}
    {view === "configuration" && configuration}
  </>;
}

function ImpactExplorer({ id, data, load, selection, select, service, selectService, openPolicy, openEvent, demo }: {
  id: number; data: Snapshot; demo: boolean; load: (id: number) => Promise<Impact>; selection?: number; select: (id: number) => void;
  service?: string; selectService: (id: string) => void; openPolicy: () => void; openEvent: (event: Audit) => void;
}) {
  const [impact, setImpact] = useState<Impact>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    let active = true;
    load(id).then(result => { if (active) setImpact(result); }).catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [id, load, attempt]);
  if (error) return <div role="alert" className="message error">{error} <button className="ghost" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button></div>;
  if (!impact) return <p role="status" className="message">Calculating workflow impact...</p>;
  const change = data.changes.find(item => item.id === id);
  const paths = service ? impact.workflows.filter(item => [item.source_service, item.destination].includes(service)) : impact.workflows;
  const workflow = paths.find(item => item.id === selection) ?? paths.find(item => item.affected && item.decision !== "ALLOW") ?? paths[0];
  const affectedPaths = new Set(impact.workflows.filter(item => item.affected).map(item => item.id));
  const recentWorkflowEvents = workflow && change ? data.audit.filter(item =>
    item.workflow_id === workflow.id && (item.policy_change_id === id || instant(item.timestamp) >= instant(change.observed_at)),
  ).slice(0, 5) : [];
  return <>
    <dl className="impact-summary">
      <div><dt>Restricted</dt><dd>{impact.restricted_workflows}</dd></div>
      <div><dt>Unaffected</dt><dd>{impact.unaffected_workflows}</dd></div>
      <div><dt>Impacted classifications</dt><dd>{impact.impacted_classifications.map(label).join(", ") || "None"}</dd></div>
      <div><dt>Historical review candidates</dt><dd>{impact.historical_review_candidates}</dd></div>
    </dl>
    <div className="investigation-grid network-layout">
      <section className="map-surface" aria-label="Interactive privacy impact graph">
        <div className="map-toolbar"><span>Policy v{impact.observed.version}{impact.previous && " / Previous v" + impact.previous.version}</span>
          {isWebUrl(impact.observed.url) && <a href={impact.observed.url}>Observed source</a>}
          {affectedPaths.size > 0 && <button className="ghost" onClick={() => setPulseKey(value => value + 1)}>Replay impact</button>}</div>
        <Network workflows={impact.workflows} services={data.services} selected={workflow?.id} service={service} choose={select} chooseService={selectService}
          affected={affectedPaths} pulse={affectedPaths.size && change ? { key: pulseKey, workflows: affectedPaths, service: change.service_id } : undefined}
          evidence={{ name: "Policy v" + impact.observed.version, service: change?.service_id ?? "", select: openPolicy }} />
      </section>
      <aside className="inspector"><h2>Impact details</h2>
        {workflow ? <>
          <p>{workflow.affected ? "Affected by this change" : "Unaffected by this change"}</p>
          <p className="context-route">{names(data.services, workflow.source_service)} <ArrowRight size={14} /> {names(data.services, workflow.destination)}</p>
          <WorkflowFacts workflow={workflow} />
          {data.services.find(item => item.id === workflow.destination) && <p>Destination approval <Status value={data.services.find(item => item.id === workflow.destination)!.status} /></p>}
          <p>{workflow.next_action}</p>
          {change?.passages[0]?.new && <div className="cc-diff">
            <div className="cc-old"><span>Previous clause</span><p>{change.passages[0].old || "No previous text"}</p></div>
            <div className="cc-new"><span>Observed clause</span><p>{change.passages[0].new}</p></div>
          </div>}
          <button className="ghost" onClick={openPolicy}>Compare policy versions <ArrowRight size={15} /></button>
          {!demo && <><h3>Workflow activity since observation</h3>
            {recentWorkflowEvents.length ? <EventRows events={recentWorkflowEvents} data={data} onSelect={openEvent} />
              : <p className="muted">No matching request records in the current audit snapshot.</p>}</>}
          <h3>Historical review candidates</h3>
          {demo && <p className="muted">Demo links receipts by classification and destination. Audit records do not include a document ID.</p>}
          <p>{workflow.historical.count} earlier confidential {workflow.historical.count === 1 ? "delivery" : "deliveries"} to review against the applicable terms.</p>
          {workflow.historical.events.map(item => {
            const row = data.audit.find(record => record.request_id === item.request_id);
            return <div className="historical-event" key={item.request_id}><small>{time(item.timestamp)} / {label(item.delivery)}</small>
              {row ? <button className="ghost" onClick={() => openEvent(row)}><code>{item.request_id}</code></button> : <code>{item.request_id}</code>}
            </div>;
          })}
        </> : <p className="muted">No configured workflows use this policy service.</p>}
      </aside>
    </div>
  </>;
}
