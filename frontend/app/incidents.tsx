import { ArrowRight, FileText, Play, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CommandCenter } from "./command-center";
import { investigationFrames } from "./command-data";
import { CommandVisual } from "./command-visual";
import { confirmsVerification, linkedTransfers, verificationCandidate, type VerificationCandidate } from "./incident-data";
import { names, time, type Audit, type Change, type Impact, type Snapshot } from "./investigation-data";
import { Status } from "./status";
import "./incidents.css";

export type IncidentSelection = { data: Snapshot; change?: Change; focus?: Audit; verified?: VerificationCandidate; impact?: Impact; receiptCount?: number };

function useImpact(id?: number, load?: (id: number) => Promise<Impact>, stored?: Impact) {
  const [result, setResult] = useState<{ id: number; impact?: Impact }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (id == null || stored || !load) return;
    let active = true;
    load(id).then(impact => { if (active) setResult({ id, impact }); }, () => { if (active) setResult({ id }); });
    return () => { active = false; };
  }, [id, load, stored, attempt]);
  return { impact: stored ?? (result?.id === id ? result?.impact : undefined),
    loading: id != null && !!load && !stored && result?.id !== id,
    retry: () => { setResult(undefined); setAttempt(value => value + 1); } };
}

export function IncidentOverview({ data, live, open, loadImpact, demoAction }: {
  data: Snapshot; live: boolean; open: (change?: Change, focus?: Audit, verified?: VerificationCandidate, impact?: Impact) => void;
  loadImpact?: (id: number) => Promise<Impact>; demoAction?: ReactNode;
}) {
  const changes = data.changes.filter(change => change.previous_id != null);
  const items = changes.length ? changes : data.changes;
  const featured = items.find(change => linkedTransfers(data, change, live).some(row => row.delivery === "NOT_SENT")) ?? items[0];
  const linked = featured ? linkedTransfers(data, featured, live) : [];
  const candidate = live ? verificationCandidate(data) : undefined;
  const verification = useImpact(candidate?.change.id, loadImpact);
  const verified = candidate && verification.impact && confirmsVerification(candidate, verification.impact) ? candidate : undefined;
  return <>
    <section className="incident-feature" aria-labelledby="incident-feature-title">
      <div>
        <p className="cc-environment">{featured ? "FEATURED INVESTIGATION" : live ? "LIVE MONITORING" : "DEMO SANDBOX"}</p>
        <h2 id="incident-feature-title">{featured ? names(data.services, featured.service_id) : "Waiting for incident evidence"}</h2>
        {featured ? <>
          <p className="incident-feature-meta"><Status value={featured.enforcement} /> <span>{time(featured.observed_at)}</span></p>
          <p>{linked.length ? "Follow the observed policy change through the gateway decision and its delivery evidence."
            : "The policy observation is available. The dashboard has no linked gateway decision for this change yet."}</p>
          <button className="primary" onClick={() => open(featured)}><Play size={16} /> Watch investigation</button>
        </> : <>
          <p>{live ? "Observed changes will appear here as the dashboard refreshes. Recent transfers remain available in Audit."
            : "Record the synthetic transfer and policy change once, then replay the resulting evidence anytime."}</p>
          {demoAction}
        </>}
      </div>
      <CommandVisual description="Privora enforcement gateway" requestLabel="MCP REQUEST"
        destinationLabel={featured ? names(data.services, featured.service_id).slice(0, 28).toUpperCase() : "DESTINATION"} />
    </section>
    <div className="incident-overview-grid">
      <section aria-labelledby="recent-incidents-title"><h2 id="recent-incidents-title">Recent policy incidents</h2>
        {items.length ? <ul className="incident-list">{items.slice(0, 8).map(change => {
          const decisions = linkedTransfers(data, change, live);
          return <li key={change.id}><button className="incident-row" onClick={() => open(change)}>
            <span><strong>{names(data.services, change.service_id)}</strong><small>{time(change.observed_at)} / {decisions.length} linked {decisions.length === 1 ? "decision" : "decisions"}</small></span>
            <span><Status value={change.enforcement} /></span><ArrowRight size={16} />
          </button></li>;
        })}</ul> : <p className="muted">No policy observations are available in this environment.</p>}
      </section>
      {live && <section className="verified-case" aria-labelledby="verified-case-title">
        <h2 id="verified-case-title"><ShieldCheck size={19} /> Verified Live integration replay</h2>
        <p>Recorded GitHub MCP requests used synthetic documents and a controlled HTTPS endpoint serving fictional analyzer terms.</p>
        {verified ? <button className="primary" onClick={() => open(verified.change, verified.withheld, verified, verification.impact)}><Play size={16} /> Replay verified Live run</button>
          : <p className="muted" role="status">{verification.loading ? "Checking the linked records and impact evidence…"
            : "Unavailable in this Live snapshot. Open the Live database that retains the verified run's original audit, policy and impact records."}</p>}
        {candidate && !verification.loading && !verification.impact && <button className="ghost" onClick={verification.retry}>Retry evidence check</button>}
      </section>}
    </div>
  </>;
}

export function IncidentWalkthrough({ selection, live, loadImpact, overview, openPolicy, openAudit, openImpact }: {
  selection: IncidentSelection; live: boolean; loadImpact?: (id: number) => Promise<Impact>;
  overview: () => void; openPolicy: (id: number) => void; openAudit: (row?: Audit) => void; openImpact: (id: number) => void;
}) {
  const { data, change, focus, verified, receiptCount } = selection;
  const state = useImpact(change?.id, loadImpact, selection.impact);
  const frames = useMemo(() => investigationFrames(data, live, change, focus, state.impact, verified),
    [data, live, change, focus, state.impact, verified]);
  return <>
    <div className="incident-breadcrumb"><button className="ghost" onClick={overview}>Back to incidents</button>
      <span>{verified ? "Verified Live integration run" : change ? names(data.services, change.service_id) : "Recorded transfer"}</span>
      {change && <span>{time(change.observed_at)}</span>}
    </div>
    {verified && <p className="incident-fixture-note"><FileText size={16} /> Real GitHub MCP read, synthetic documents, fictional terms on a controlled HTTPS endpoint. Read-only replay.</p>}
    {state.loading ? <p className="message" role="status">Loading linked policy, workflow and delivery evidence…</p>
      : <CommandCenter data={data} live={live} pending={false} receiptCount={receiptCount} incidentFrames={frames} incidentImpact={state.impact}
        autoplay openPolicy={openPolicy} openAudit={openAudit} openImpact={openImpact} />}
  </>;
}
