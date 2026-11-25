import { ArrowRight, Check, RotateCcw } from "lucide-react";

const steps = ["Approved transfer", "Policy change", "Identical retry", "Blast radius"];
const instructions = [
  "Send the sample confidential document under the approved policy. The analyzer should record a receipt.",
  "Change the fictional analyzer's terms to allow model improvement unless an opt-out applies.",
  "Send the same confidential document again. Check that it stops at the gateway and the receipt count stays the same.",
  "Follow the changed clause to the confidential route, the unaffected public route, and the earlier delivery to review.",
];
const actions = ["Run confidential transfer", "Simulate policy change", "Retry confidential transfer", "Investigate blast radius"];

export function DemoGuide({ stage, ready, needsReset, busy, count, outcome, onNext, onReset, onPublic, onAudit }: {
  stage: number; ready: boolean; needsReset: boolean; busy: boolean; count?: number; outcome: string;
  onNext: () => void; onReset: () => void; onPublic: () => void; onAudit: () => void;
}) {
  const setup = !ready || needsReset;
  return <section className="demo-guide" aria-labelledby="demo-guide-title">
    <div className="demo-guide-heading"><div><h2 id="demo-guide-title">See privacy enforcement in four steps</h2><p className="muted">The Demo uses synthetic documents and provider terms.</p></div>
      {ready && !needsReset && <button className="ghost" disabled={busy} onClick={onReset}><RotateCcw size={15} /> Restart demo</button>}
    </div>
    <ol className="demo-steps" aria-label="Walkthrough progress">{steps.map((name, index) =>
      <li key={name} aria-current={index === stage && !setup ? "step" : undefined} data-complete={index < stage && !setup}>
        <span aria-hidden="true">{index < stage && !setup ? <Check size={14} /> : index + 1}</span>{name}
      </li>)}</ol>
    <div className="demo-next">
      <div>
        <h3>{setup ? needsReset ? "Start from the approved policy" : "Start the demo" : steps[stage]}</h3>
        <p>{setup ? needsReset ? "This session is past the starting state. Reset Demo to restore v1 and clear its audit and receipts." : "Load the synthetic document and approved v1 policy." : instructions[stage]}</p>
      </div>
      <button className="primary" disabled={busy} onClick={setup ? onReset : onNext}>{busy ? "Working…" : setup ? needsReset ? "Reset to approved v1" : "Start demo" : actions[stage]} <ArrowRight size={16} /></button>
    </div>
    <div className="demo-guide-evidence">
      {count != null && <span><strong>{count}</strong> analyzer {count === 1 ? "receipt" : "receipts"}</span>}
      <span role="status">{outcome}</span>
      {stage === 3 && !setup && <div className="actions"><button className="ghost" disabled={busy} onClick={onAudit}>Inspect retry in Audit</button>
        <button className="ghost" disabled={busy} onClick={onPublic}>Run public transfer</button></div>}
    </div>
  </section>;
}
