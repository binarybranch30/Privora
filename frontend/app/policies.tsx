import { ArrowRight, FileText } from "lucide-react";
import { useState } from "react";
import { changedWords, isWebUrl, names, time, type Change, type Snapshot, type Version } from "./investigation-data";
import { Status } from "./status";

function VersionDetails({ record }: { record?: Version }) {
  if (!record) return <p className="muted">Version metadata unavailable in this snapshot.</p>;
  return <>
    <p className="version-meta"><strong>v{record.number}</strong> <time dateTime={record.observed_at}>{time(record.observed_at)}</time></p>
    {isWebUrl(record.source) ? <a href={record.source} target="_blank" rel="noreferrer">{record.source}</a> : <code>{record.source}</code>}
    <details><summary>Digest and full policy</summary><code>{record.digest}</code><pre>{record.content}</pre></details>
  </>;
}

export function Policies({ data, change, select, openImpact, openNetwork, openInvestigation, live, impactAvailable, reviewService }: {
  data: Snapshot; change?: Change; select: (id: number) => void; openImpact: () => void; openNetwork: () => void; openInvestigation: () => void; live: boolean; impactAvailable: boolean; reviewService?: (id: string) => void;
}) {
  const [passage, setPassage] = useState(0);
  const selected = change?.passages[passage] ?? change?.passages[0];
  const comparison = selected && changedWords(selected.old, selected.new);
  const previous = data.versions.find(item => item.id === change?.previous_id);
  const observed = data.versions.find(item => item.id === change?.version_id);
  const provider = data.services.find(item => item.id === change?.service_id);
  return <>
    <div className="investigation-grid policy-layout">
      <aside className="record-list" aria-label="Policy changes">
        <h2>{live ? "Observed changes" : "Demo changes"}</h2>
        {data.changes.map(item => <button key={item.id} aria-pressed={item.id === change?.id} onClick={() => { select(item.id); setPassage(0); }}>
          <FileText size={16} /><span><strong>{names(data.services, item.service_id)}</strong><small>{time(item.observed_at)}</small></span>
        </button>)}
        {!data.changes.length && <p className="empty">No policy changes recorded.</p>}
      </aside>
      <section className="comparison">
        <h2>{change ? names(data.services, change.service_id) : "Policy versions"}</h2>
        {change && <>
          <div className="clause-picker" role="group" aria-label="Changed passages">{change.passages.map((_, index) =>
            <button className="ghost" aria-pressed={selected === change.passages[index]} key={index} onClick={() => setPassage(index)}>Passage {index + 1}</button>)}</div>
          <div className="diff-grid">{[previous, observed].map((record, side) => <article className="diff-side" key={side}>
            <h3>{side ? "Observed" : "Previous"}</h3>
            <VersionDetails record={record} />
            {comparison && <p className="diff-text">{comparison[side].length ? comparison[side].map((token, index) => token.changed
              ? side ? <ins key={index}>{token.text}</ins> : <del key={index}>{token.text}</del>
              : token.text) : side ? "Passage removed" : "No previous passage"}</p>}
          </article>)}</div>
        </>}
        <details className="version-history" open={!change}>
          <summary>Policy version history</summary>
          {data.versions.map(item => <details key={item.id}><summary>{names(data.services, item.service_id)} / v{item.number}</summary><VersionDetails record={item} /></details>)}
          {!data.versions.length && <p className="muted">No policy versions recorded.</p>}
          {data.archive?.map(item => <details key={item.release + item.service_id + item.archived_at}>
            <summary>{item.service_id} / Archive / {time(item.archived_at)}</summary>
            <p>Imported {time(item.imported_at)}. Historical archive evidence.</p>
            {item.policy_url && isWebUrl(item.policy_url) && <a href={item.policy_url}>Original policy source</a>}
            {isWebUrl(item.release) && <p><a href={item.release}>Dataset release</a></p>}
            {item.passages.map((entry, index) => <div className="diff-grid" key={index}><p><del>{entry.old}</del></p><p><ins>{entry.new}</ins></p></div>)}
            <pre>{item.content}</pre>
          </details>)}
        </details>
      </section>
      <aside className="inspector" aria-label="Policy evidence">
        <h2>Why this change matters</h2>
        {change ? <>
          <p><strong>Affected service</strong> {provider?.name ?? change.service_id}</p>
          <p><strong>Organization rule</strong> {change.rule}</p>
          <p><strong>At observation</strong> <Status value={change.enforcement} /></p>
          {provider && <p><strong>Current approval</strong> <Status value={provider.status} /></p>}
          <details><summary>Technical reason</summary><code>{change.reason}</code></details>
          {change.clauses.map((clause, index) => <div className="evidence-note" key={index}><h3>{clause.topic}</h3><p>{clause.new_interpretation} {clause.reason}</p><p className="muted">{clause.uncertainty} {clause.review_action}</p></div>)}
          <p className="muted">Extraction: {change.analysis_status.toLowerCase()}. Applicability requires human verification.</p>
          <button className="primary" onClick={openInvestigation}>Watch incident walkthrough <ArrowRight size={15} /></button>
          {impactAvailable && <button className="ghost" onClick={openImpact}>View impacted workflows <ArrowRight size={15} /></button>}
          {live && reviewService && provider?.current_version && provider.status === "REVIEW_REQUIRED" &&
            <button className="ghost" onClick={() => reviewService(provider.id)}>Open policy review <ArrowRight size={15} /></button>}
          <button className="ghost" onClick={openNetwork}>Show service in network <ArrowRight size={15} /></button>
        </> : <p className="muted">Select a policy change to inspect the evidence.</p>}
      </aside>
    </div>
  </>;
}
