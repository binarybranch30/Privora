import { useId } from "react";

export function CommandVisual({ description, requestLabel, destinationLabel, showFile = false, receiptSignal, branch }: {
  description: string; requestLabel: string; destinationLabel: string; showFile?: boolean; receiptSignal?: number; branch?: "a" | "b";
}) {
  const id = useId();
  return <svg className="command-art" viewBox="0 0 800 365" role="img" aria-label={description}>
    <defs>
      <linearGradient id={id + "-gateface"} x1="0" x2="1" y1="1" y2="0" gradientUnits="objectBoundingBox"><stop stopColor="#102654"/><stop offset="1" stopColor="#315de0"/></linearGradient>
      <linearGradient id={id + "-gateedge"}><stop stopColor="#162c86"/><stop offset="1" stopColor="#8caaff"/></linearGradient>
      <linearGradient id={id + "-runway"} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#2458e7" stopOpacity=".15"/><stop offset="1" stopColor="#090f22" stopOpacity=".1"/></linearGradient>
      <linearGradient id={id + "-gatebeam"}><stop stopColor="var(--state)" stopOpacity="0"/><stop offset=".68" stopColor="var(--state)" stopOpacity=".14"/><stop offset="1" stopColor="var(--state)" stopOpacity=".42"/></linearGradient>
      <pattern id={id + "-commandgrid"} width="27" height="27" patternUnits="userSpaceOnUse"><path d="M27 0H0v27" fill="none" stroke="#4368c5" strokeOpacity=".17"/></pattern>
      <clipPath id={id + "-floor"}><path d="M122 267h592l80 98H44z"/></clipPath>
    </defs>
    <path d="M122 267h592l80 98H44z" fill={"url(#" + id + "-runway)"}/><path d="M0 0h800v365H0z" fill={"url(#" + id + "-commandgrid)"} clipPath={"url(#" + id + "-floor)"}/>
    <path d="M0 267h800" stroke="#294773" strokeOpacity=".65"/>
    <g fill="none" stroke="#1f3d74" opacity=".62"><path d="M55 304h703M32 333h749"/><path d="m301 267-38 98m237-98 35 98"/></g>
    <path className="request-beam" d="M112 209 395 191v46L112 218z" fill={"url(#" + id + "-gatebeam)"}/>
    <path d="M70 214h630" stroke="#536a9c" strokeWidth="1.4" strokeDasharray="4 7"/>
    {branch && <path data-analyzer-branch="b" d="M505 214h30q18 0 36-20l38-36q17-18 38-18h53" fill="none"
      stroke={branch === "b" ? "var(--state)" : "#536a9c"} strokeWidth="1.6" strokeDasharray="4 7" />}
    <path className="command-after" d="M432 214h268" stroke="#5af1d1" strokeWidth="2"/>
    <g transform="translate(395 45)">
      <path d="M0 18 25 0l109 40v218l-28 16-106-39z" fill="#131e52" stroke="#5779ec"/>
      <path d="M0 18 25 0l109 40-28 16z" fill="#7790ff" opacity=".7"/>
      <path d="M106 56l28-16v218l-28 16z" fill={"url(#" + id + "-gateedge)"}/>
      <path d="M0 18l106 38v218L0 235z" fill={"url(#" + id + "-gateface)"} stroke="#7795ff"/>
      <path d="M12 39l82 29v183l-82-30z" fill="none" stroke="#7c9aff" opacity=".45"/>
      <path className="gate-status-edge" d="M0 32v183l11 15" fill="none" stroke="var(--state)" strokeWidth="3"/>
      <path d="M32 111l40 14v25c0 23-20 30-20 30s-20-18-20-41zm11 33 7 8 13-11" stroke="#d6e3ff" strokeWidth="2.5" fill="none"/>
    </g>
    <path d="M402 214h-287" stroke="var(--state)" strokeWidth="2"/>
    <g transform="translate(378 214)"><g className="command-packet"><circle r="14" fill="none" stroke="var(--state)" opacity=".45"/><circle r="5" fill="var(--state)"/></g></g>
    {showFile && <g transform="translate(126 214)">
      <TransferFile className="transfer-file" />
      {receiptSignal != null && <TransferFile key={receiptSignal} className={branch === "b" ? "transfer-file-receipt transfer-file-receipt-b" : "transfer-file-receipt"} />}
    </g>}
    <g className="command-stop" fill="none" stroke="#ff8f8b" strokeWidth="2"><circle cx="395" cy="214" r="22"/><path d="m388 207 14 14m0-14-14 14"/></g>
    <g transform="translate(395 214)"><circle className="command-ring" r="24" fill="none" stroke="var(--state)" strokeWidth="1.5"/></g>
    <g className="policy-injection">
      <path d="M235 81h85l75 85" fill="none" stroke="var(--state)" strokeDasharray="3 6"/>
      <g transform="translate(235 81)"><circle className="policy-signal" r="4" fill="var(--state)"/></g>
      <rect x="124" y="65" width="112" height="32" rx="3" fill="#182544" stroke="var(--state)"/>
      <text x="139" y="85" fill="#e3ebff" fontFamily="monospace" fontSize="11">TERMS UPDATE</text>
    </g>
    <g fill="#a6b8db" fontFamily="monospace" fontSize="11" letterSpacing="1"><text x="70" y="243">{requestLabel}</text><text x="704" y="243" textAnchor="end">{destinationLabel}</text></g>
    <rect x="689" y="199" width="30" height="30" rx="4" fill="#151f38" stroke="#58759b"/><path d="M696 209h16l2 7v6h-20v-6l2-7Zm-2 7h6l2 3h4l2-3h6" stroke="#adc2e1" fill="none"/>
    {branch && <g transform="translate(0 -74)">
      <rect x="689" y="199" width="30" height="30" rx="4" fill="#151f38" stroke={branch === "b" ? "var(--state)" : "#58759b"} />
      <path d="M696 209h16l2 7v6h-20v-6l2-7Zm-2 7h6l2 3h4l2-3h6" stroke="#adc2e1" fill="none" />
      <text x="704" y="243" textAnchor="end" fill="#a6b8db" fontFamily="monospace" fontSize="11" letterSpacing="1">ANALYZER B</text>
    </g>}
  </svg>;
}


function TransferFile({ className }: { className: string }) {
  return <g className={className} fill="#101e37" stroke="currentColor" strokeWidth="2">
    <path d="M-12-16H4l8 8V16h-24Z" />
    <path d="M4-16v8h8M-6 0H6M-6 6H6" fill="none" />
  </g>;
}
