import { time } from "./investigation-data";
import type { ProtectionStatus } from "./protection";

export const rehearsalAnalyzers = [{ prefix: "a_", name: "Analyzer A" }, { prefix: "b_", name: "Analyzer B" }];

export function rehearsalLaneName(lane: string) {
  return (lane.startsWith("a_") ? "Analyzer A" : "Analyzer B") +
    (lane.endsWith("_public") ? " / Public" : " / Confidential");
}

export function rehearsalFile(lane: string, item: ProtectionStatus["jobs"][number]["items"][number]) {
  const classification = item.classification === "PUBLIC" || (!item.classification && lane.endsWith("_public"))
    ? "Public" : "Confidential";
  const kind = classification === "Public" ? "Public brief" : "Confidential memo";
  return { name: kind + " " + String(item.position).padStart(2, "0") + ".txt", classification };
}

export function RehearsalLanes({ jobs, incident, investigate, receipts }: {
  jobs: ProtectionStatus["jobs"];
  incident: ProtectionStatus["incident"];
  investigate: (id: number) => void;
  receipts?: Record<string, number>;
}) {
  return <>
    <div className="rehearsal-lanes" aria-label="Live transfer streams">
      {rehearsalAnalyzers.map(analyzer => {
        const jobsForAnalyzer = jobs.filter(job => job.lane?.startsWith(analyzer.prefix));
        const items = jobsForAnalyzer.flatMap(job => job.items);
        const denied = items.filter(item => item.delivery === "NOT_SENT" && ["BLOCK", "REVIEW_REQUIRED"].includes(item.decision ?? "")).length;
        const held = jobsForAnalyzer.reduce((total, job) => total + (job.enforcement === "PAUSED"
          ? job.items.filter(item => item.status === "QUEUED").length : 0), 0);
        const delivered = jobsForAnalyzer.reduce((total, job) => total + job.confirmed_files, 0);
        const remaining = items.filter(item => !item.delivery && ["QUEUED", "RUNNING"].includes(item.status)).length - held;
        const runningJob = jobsForAnalyzer.find(job => job.items.some(item => item.status === "RUNNING" && !item.delivery));
        const running = runningJob?.items.find(item => item.status === "RUNNING" && !item.delivery);
        const file = running && runningJob?.lane ? rehearsalFile(runningJob.lane, running) : null;
        const hasReceipt = jobsForAnalyzer.some(job => job.lane && receipts?.[job.lane] != null);
        return <section className="rehearsal-lane" key={analyzer.prefix} data-held={held > 0} aria-label={analyzer.name}>
          <h2>{analyzer.name}</h2>
          {file ? <p className="lane-current"><span>Processing</span> <strong>{file.name}</strong> <span className="file-class" data-classification={file.classification}>{file.classification}</span></p>
            : <p className="lane-current">{!items.length ? "Awaiting launch" : remaining > 0 ? "Waiting for the next file" : held ? "Waiting files on hold" : "Batch complete"}</p>}
          {items.length > 0 && <>
            <div className="transfer-outcomes" aria-hidden="true">
              <span className="outcome-delivered" style={{ flexGrow: delivered }} />
              <span className="outcome-held" style={{ flexGrow: held }} />
              <span className="outcome-denied" style={{ flexGrow: denied }} />
              <span style={{ flexGrow: Math.max(0, items.length - delivered - held - denied) }} />
            </div>
            <p className="lane-totals"><span key={delivered} className={hasReceipt ? "lane-new-receipt" : undefined}><strong>{delivered}</strong> delivered</span><span><strong>{remaining}</strong> remaining</span>
              {held > 0 && <span><strong>{held}</strong> held</span>}{denied > 0 && <span><strong>{denied}</strong> denied</span>}</p>
          </>}
        </section>;
      })}
    </div>
    {incident && <aside className="rehearsal-incident" aria-label="Policy incident summary">
      <div>
        <h2>Analyzer A policy change</h2>
        <p>{time(incident.observed_at)} · Revision {incident.previous_version ?? "unknown"} → {incident.current_version}. The observed terms triggered review under “{incident.rule}”.</p>
        <p>Analyzer A: {incident.held} confidential files held, {incident.denied} denied, and {incident.public_confirmed} public deliveries confirmed since observation.</p>
        <p>Analyzer B: {incident.analyzer_b_confirmed + (incident.analyzer_b_public_confirmed ?? 0)} deliveries confirmed since observation.</p>
      </div>
      <button className="ghost" onClick={() => investigate(incident.id)}>View evidence</button>
    </aside>}
  </>;
}
