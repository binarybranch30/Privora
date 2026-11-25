import { Activity, ArrowRight, FileText, FileStack, GitFork, Inbox, LockKeyhole, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { label, names, version, type Result, type Service, type Workflow } from "./investigation-data";
import { Status } from "./status";

type Point = { x: number; y: number };
type Phase = "ready" | "incoming" | "decision" | "outgoing" | "complete";
type Pulse = { key: number | string; service: string; workflows: ReadonlySet<number> };
type Evidence = { name: string; service: string; select: () => void };
const WIDTH = 1000;
const timings = { approach: 300, decision: 240, departure: 300 };

function distribute(ids: string[], x: number, height: number, bias: number) {
  return new Map(ids.map((id, i) => [id, {
    x, y: ids.length === 1 ? height / 2 + bias : 78 + i * (height - 156) / (ids.length - 1),
  }]));
}

function curve(start: Point, end: Point) {
  const bend = (end.x - start.x) * .52;
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

function tone(decision?: string) {
  return decision === "ALLOW" ? "allowed" : decision === "REVIEW_REQUIRED" ? "held" : decision === "BLOCK" ? "blocked" : "unknown";
}

function travel(dot: SVGCircleElement, path: SVGPathElement, duration: number, fade: boolean) {
  const length = path.getTotalLength();
  const points = Array.from({ length: 25 }, (_, i) => {
    const point = path.getPointAtLength(length * i / 24);
    return { transform: `translate(${point.x}px, ${point.y}px)`, opacity: fade ? 1 - Math.max(0, i - 21) / 3 : 1 };
  });
  return dot.animate(points, { duration, easing: "linear", fill: "forwards" });
}

function ImpactPulse({ route }: { route: string }) {
  const trace = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!trace.current || !dot.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = travel(dot.current, trace.current, 740, true);
    return () => animation.cancel();
  }, [route]);
  return <g className="impact-propagation"><path ref={trace} className="impact-wash" d={route} /><circle ref={dot} r="4" /></g>;
}

function PacketReplay({ incoming, outgoing, event, onPhase }: {
  incoming: string; outgoing: string; event: Result; onPhase: (phase: Phase) => void;
}) {
  const marker = useRef<SVGCircleElement>(null);
  const inbound = useRef<SVGPathElement>(null);
  const outbound = useRef<SVGPathElement>(null);
  const received = event.decision === "ALLOW" && event.delivery === "RECEIVED";

  useEffect(() => {
    const dot = marker.current;
    const first = inbound.current;
    const second = outbound.current;
    if (!dot || !first || !second) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    let cancelled = false;
    let animation: Animation | undefined;
    function stop() {
      cancelled = true;
      animation?.cancel();
    }
    function reduceMotion() {
      if (!preference.matches) return;
      stop();
      onPhase("complete");
    }
    preference.addEventListener("change", reduceMotion);
    async function play() {
      if (!dot || !first || !second) return;
      try {
        onPhase("incoming");
        animation = travel(dot, first, timings.approach, false);
        await animation.finished;
        if (cancelled) return;
        onPhase("decision");
        const stopPoint = first.getPointAtLength(first.getTotalLength());
        animation.cancel();
        const position = `translate(${stopPoint.x}px, ${stopPoint.y}px)`;
        animation = dot.animate([{ transform: position, opacity: 1 }, { transform: position, opacity: received ? 1 : 0 }], {
          duration: timings.decision, easing: "ease-out", fill: "forwards",
        });
        await animation.finished;
        if (cancelled) return;
        if (received) {
          onPhase("outgoing");
          animation.cancel();
          animation = travel(dot, second, timings.departure, true);
          await animation.finished;
        }
        if (!cancelled) onPhase("complete");
      } catch {
        if (!cancelled) onPhase("complete");
      }
    }
    void play();
    return () => { stop(); preference.removeEventListener("change", reduceMotion); };
  }, [incoming, outgoing, onPhase, received]);

  return <><path ref={inbound} d={incoming} fill="none" stroke="none" /><path ref={outbound} d={outgoing} fill="none" stroke="none" /><circle className="transfer-packet" ref={marker} r="5" /></>;
}

function gatewayShape(x: number, y: number, size = 1) {
  const points = [[-72, -86], [72, -86], [96, -57], [96, 25], [66, 70], [0, 97], [-66, 70], [-96, 25], [-96, -57]];
  return points.map(([dx, dy]) => `${x + dx * size},${y + dy * size}`).join(" ");
}

export function Network({ workflows, services, selected, service, choose, chooseService, event, evidence, affected, playback, pending, pulse }: {
  workflows: Workflow[]; services: Service[]; selected?: number; service?: string;
  choose: (id: number) => void; chooseService: (id: string) => void;
  event?: Result; evidence?: Evidence; affected?: ReadonlySet<number>; playback?: number | string; pending?: number;
  pulse?: Pulse;
}) {
  const markerId = useId();
  const [frame, setFrame] = useState<{ key: number | string; phase: Phase }>();
  const [filter, setFilter] = useState("");
  const sourceIds = [...new Set(workflows.map(path => path.source_service))];
  const destinationIds = [...new Set(workflows.map(path => path.destination))];
  const activePath = workflows.find(path => path.id === (pending ?? selected));
  const effectiveFilter = activePath && filter && ![activePath.source_service, activePath.destination].includes(filter) ? "" : filter;
  const visible = effectiveFilter ? workflows.filter(path => [path.source_service, path.destination].includes(effectiveFilter)) : workflows;
  const visibleSources = [...new Set(visible.map(path => path.source_service))];
  const visibleDestinations = [...new Set(visible.map(path => path.destination))];
  const height = Math.max(428, Math.max(visibleSources.length, visibleDestinations.length) * 94 + 62);
  const center = { x: 500, y: height / 2 - 8 };
  const sources = distribute(visibleSources, 130, height, -42);
  const destinations = distribute(visibleDestinations, 870, height, 40);
  const evidenceNode = evidence && (destinations.get(evidence.service) ?? sources.get(evidence.service));
  const policyPosition = evidenceNode && { x: evidenceNode.x > WIDTH / 2 ? 770 : 230, y: evidenceNode.y < height / 2 ? evidenceNode.y + 65 : evidenceNode.y - 65 };
  const replayPhase = frame?.key === playback ? frame?.phase ?? "ready" : "ready";
  const showOutcome = playback == null || replayPhase === "ready" || replayPhase === "complete" || replayPhase === "decision" || replayPhase === "outgoing";
  const playing = playback != null && (replayPhase === "incoming" || replayPhase === "decision" || replayPhase === "outgoing");
  const paths = visible.map((workflow, index) => {
    const source = sources.get(workflow.source_service)!;
    const destination = destinations.get(workflow.destination)!;
    const offset = visible.length > 1 ? -48 + 96 * index / (visible.length - 1) : 0;
    const port = center.y + offset;
    const inbound = { x: 422, y: port };
    const outbound = { x: 578, y: port };
    return { workflow, source, destination, inbound, outbound,
      incoming: curve({ x: source.x + 32, y: source.y }, inbound),
      outgoing: curve(outbound, { x: destination.x - 33, y: destination.y }),
    };
  });
  const active = paths.find(path => path.workflow.id === activePath?.id);
  const currentEvent = pending == null ? event : undefined;
  const decisionTone = currentEvent && showOutcome ? tone(currentEvent.decision) : "unknown";
  const sourceActive = pending != null || (playing && replayPhase === "incoming");
  const targetActive = currentEvent?.delivery === "RECEIVED" && currentEvent.decision === "ALLOW" && (replayPhase === "outgoing" || replayPhase === "complete");
  const message = pending != null ? "Waiting for gateway response"
    : replayPhase === "incoming" ? "Request approaching the gateway"
    : replayPhase === "decision" ? "Gateway decision: " + (currentEvent ? label(currentEvent.decision) : "Unavailable")
    : replayPhase === "outgoing" ? "Confirmed route to analyzer"
    : currentEvent ? label(currentEvent.decision) + " / " + (currentEvent.delivery === "UNKNOWN" ? "Delivery unconfirmed" : label(currentEvent.delivery))
    : evidence && pulse ? "Observed change / Affected paths highlighted" : "Select a connection to inspect its evidence";

  const phaseCallback = useCallback((phase: Phase) => {
    if (playback != null) setFrame({ key: playback, phase });
  }, [playback]);

  function position(point: Point) {
    return { left: `${point.x / WIDTH * 100}%`, top: `${point.y / height * 100}%` };
  }
  function serviceNode(id: string, point: Point, isSource: boolean) {
    const Icon = isSource ? id === "demo_documents" ? FileStack : GitFork : Inbox;
    return <button key={(isSource ? "source:" : "destination:") + id} className={"topology-node " + (isSource ? "topology-source" : "topology-destination")}
      title={id === "demo_documents" ? "Synthetic documents" : names(services, id)} style={position(point)} aria-pressed={service === id}
      data-active={pulse?.service === id || (isSource ? sourceActive && activePath?.source_service === id : targetActive && activePath?.destination === id)}
      onClick={() => chooseService(id)}>
      <span className="service-symbol"><Icon size={22} aria-hidden="true" /></span>
      <strong>{id === "demo_documents" ? "Synthetic documents" : names(services, id)}</strong>
    </button>;
  }

  if (!workflows.length) return <p className="empty topology-empty">No configured workflow paths are available.</p>;
  return <div className="topology" data-phase={replayPhase} data-outcome={decisionTone}>
    {workflows.length > 8 && <label className="topology-filter">Focus service <select aria-label="Focus service" value={effectiveFilter}
      onChange={e => { const id = e.target.value; setFilter(id); if (id) chooseService(id); }}>
      <option value="">All services</option>{[...new Set([...sourceIds, ...destinationIds])].map(id => <option value={id} key={id}>{names(services, id)}</option>)}
    </select></label>}
    <div className="topology-scroll"><div className="topology-canvas" style={{ height }} data-compact={height === 428}>
      <div className="topology-axis" aria-hidden="true"><span>Sources</span><span>Enforcement boundary</span><span>Destinations</span></div>
      <svg className="topology-art" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-label="Directional workflow routes">
        <defs>
          <linearGradient id={markerId + "-shield"} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#203a52" /><stop offset="1" stopColor="#102033" /></linearGradient>
          <marker id={markerId + "-arrow"} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 1 L 6 4 L 0 7" fill="none" stroke="#a7b8ca" strokeWidth="1.3" /></marker>
        </defs>
        <line className="boundary-axis" x1={center.x} x2={center.x} y1="42" y2={height - 40} />
        <polygon className="gateway-outline" points={gatewayShape(center.x, center.y, 1.22)} />
        <polygon className="gateway-shell" points={gatewayShape(center.x, center.y)} fill={`url(#${markerId}-shield)`} />
        {paths.map(({ workflow, incoming, outgoing, inbound, outbound, destination, source }) => {
          const activeRoute = workflow.id === activePath?.id;
          const related = service === workflow.source_service || service === workflow.destination;
          const recorded = activeRoute && currentEvent;
          const decision = recorded && showOutcome ? recorded.decision : recorded ? undefined : workflow.decision;
          const withheld = decision === "REVIEW_REQUIRED" || decision === "BLOCK" || (!decision && affected?.has(workflow.id))
            || (recorded && showOutcome && recorded.delivery !== "RECEIVED");
          const changed = pulse?.workflows.has(workflow.id);
          const impactRoute = pulse?.service === workflow.source_service ? incoming : curve({ x: destination.x - 33, y: destination.y }, outbound);
          return <g key={workflow.id} className="topology-route" data-tone={tone(decision)} data-selected={activeRoute} data-related={related} data-affected={affected?.has(workflow.id)} data-withheld={!!withheld}>
            <path className="route-in" d={incoming} markerEnd={`url(#${markerId}-arrow)`} />
            <path className="route-out" d={outgoing} markerEnd={withheld ? undefined : `url(#${markerId}-arrow)`} />
            <circle className="route-port" cx={inbound.x} cy={inbound.y} r="3" />
            <circle className="route-port route-port-out" cx={outbound.x} cy={outbound.y} r="3" />
            <path className="route-hit" d={incoming + " " + outgoing} aria-hidden="true" onClick={() => choose(workflow.id)} />
            {changed && pulse && <ImpactPulse key={pulse.key} route={impactRoute} />}
            <title>{workflow.resource_id} / {label(workflow.classification)} / {decision ? label(decision) : "No current evaluation"}</title>
            {activeRoute && <circle className="route-source-port" cx={source.x + 32} cy={source.y} r="3" />}
          </g>;
        })}
        {policyPosition && evidenceNode && <path className="policy-tether" d={curve(evidenceNode, policyPosition)} />}
        {pulse && <polygon key={pulse.key} className="gateway-impact-ring" points={gatewayShape(center.x, center.y, 1.16)} />}
        {replayPhase === "decision" && currentEvent && <polygon className="gateway-decision-ring" points={gatewayShape(center.x, center.y, 1.14)} />}
        {playback != null && active && currentEvent && <PacketReplay key={playback} event={currentEvent}
          incoming={active.incoming} outgoing={`M ${active.inbound.x} ${active.inbound.y} L ${active.outbound.x} ${active.outbound.y} ${active.outgoing.slice(active.outgoing.indexOf("C"))}`} onPhase={phaseCallback} />}
      </svg>
      {visibleSources.map(id => serviceNode(id, sources.get(id)!, true))}
      {visibleDestinations.map(id => serviceNode(id, destinations.get(id)!, false))}
      <div className="gateway-caption" style={position(center)}>
        <ShieldCheck size={31} aria-hidden="true" /><strong>PRIVORA</strong><small>MCP Gateway</small>
        <div className="gateway-indicators" aria-hidden="true"><i /><i /><i /></div>
      </div>
      {evidence && policyPosition && <button className="topology-policy" style={position(policyPosition)} onClick={evidence.select} data-changed={!!pulse}>
        <FileText size={15} aria-hidden="true" />{evidence.name}
      </button>}
    </div></div>
    <div className="topology-readout">
      <span className="readout-label"><Activity size={15} aria-hidden="true" /> {playback != null ? "Recorded replay" : pending != null ? "Request pending" : evidence && affected ? "Change impact" : "Route inspection"}</span>
      <span className="readout-message" role="status">{message}</span>
      {activePath && <span className="readout-classification"><LockKeyhole size={13} aria-hidden="true" /> {label(activePath.classification)}</span>}
    </div>
    <div className="route-register" aria-label="Selectable workflow paths">
      {visible.map(path => <button key={path.id} type="button" aria-pressed={path.id === activePath?.id} onClick={() => choose(path.id)}>
        <span>{label(path.classification)} <ArrowRight size={13} aria-hidden="true" /> {names(services, path.destination)}</span>
        {path.id === activePath?.id && currentEvent && showOutcome ? <Status value={currentEvent.decision} />
          : path.decision ? <Status value={path.decision} /> : <small>{path.resource_id}</small>}
        {affected && <small>{affected.has(path.id) ? "Affected by change" : "Unaffected by change"}</small>}
      </button>)}
    </div>
  </div>;
}

export function networkEvidence(service: Service, select: () => void): Evidence {
  return { name: service.current_version == null ? "Policy evidence" : "Policy " + version(service.current_version), service: service.id, select };
}
