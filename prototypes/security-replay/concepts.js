const icons = {
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  file: '<path d="M13 2H5v20h14V8Zm0 0v6h6M8 13h8m-8 4h6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  play: '<path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>',
  stop: '<path d="M8 5v14m8-14v14"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 5v6h6"/>',
  inbox: '<path d="M4 4h16l2 10v6H2v-6l2-10Zm-2 10h6l2 3h4l2-3h6"/>',
  branch: '<path d="M6 4v16m0-6c8 0 11-3 11-8m-4 0h8"/><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/>',
  alert: '<path d="M12 4 2 21h20L12 4Zm0 7v4m0 2v1"/>',
};
const icon = (name, size=18) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;

const frames = [
  { name:"Approved transfer", short:"Initial transfer", heading:"Transfer delivered", flag:"Allow / Received", tone:"allow", copy:"The approved analyzer received the confidential document under policy v1.", version:1, receipts:1, request:"demo-7fa2", reason:"POLICY_APPROVED", time:"14:08:12" },
  { name:"Policy observed", short:"Policy change", heading:"Terms changed", flag:"Policy v2 observed", tone:"observe", copy:"The monitored terms now allow submitted documents to be used for model improvement unless an opt-out applies.", version:2, receipts:1, request:"", reason:"POLICY_CHANGE_OBSERVED", time:"14:08:31" },
  { name:"Approval suspended", short:"Rule enforced", heading:"Approval suspended", flag:"Review required", tone:"review", copy:"The no-training rule requires a current approval for confidential transfers. The new terms invalidate the prior approval.", version:2, receipts:1, request:"", reason:"AI_TRAINING_CONFLICT", time:"14:08:31" },
  { name:"Retry intercepted", short:"Retry intercepted", heading:"Transfer intercepted", flag:"Review required / Not sent", tone:"deny", copy:"The identical confidential request stopped at the gateway. The analyzer received no additional request.", version:2, receipts:1, request:"demo-92ce", reason:"AI_TRAINING_CONFLICT", time:"14:08:43" },
  { name:"Impact traced", short:"Impact & audit", heading:"Impact traced", flag:"1 restricted workflow", tone:"review", copy:"The confidential workflow requires review. One earlier confirmed delivery is a historical review candidate.", version:2, receipts:1, request:"demo-92ce", reason:"AI_TRAINING_CONFLICT", time:"14:08:43" },
];
const header = name => `<header class="shellbar"><span class="brand">${icon("shield",21)} privora</span><span class="shell-divider"></span><span class="shell-title">${name}</span><span class="synthetic"><i></i> Synthetic design preview</span></header>`;
const controls = () => `<div class="transport"><button class="play" data-play>${icon("play",17)} Play sequence</button><button class="reset" data-reset aria-label="Reset sequence">${icon("reset",17)}</button></div>`;
const step = (f,i,kind="") => `<button type="button" class="step ${kind}" data-step="${i}" aria-pressed="false"><span class="step-count">${String(i+1).padStart(2,"0")}</span><span>${f.short}</span></button>`;
const diff = (full=false) => `<div class="diff ${full?'diff-full':''}">
  <div class="old"><span class="clause-label"><b>−</b> Previous terms <code>v1</code></span><p>Customer-submitted documents <del>are not used for AI model training.</del></p></div>
  <div class="new"><span class="clause-label"><b>+</b> Observed terms <code>v2</code></span><p>Customer-submitted documents <ins>may be used to improve AI models unless an applicable opt-out is enabled.</ins></p></div>
</div>`;
const evidence = () => `<div class="receipt"><span>${icon("inbox",16)} Analyzer receipts</span><div><strong data-receipt>1</strong><small data-delta>No additional receipt</small></div></div>`;
const impact = () => `<div class="impact-info" hidden><span><b>1</b> restricted workflow</span><span><b>1</b> unaffected workflow</span><span><b>1</b> historical review candidate</span></div>`;
const audit = () => `<div class="audit-line"><span data-time></span><code data-reason></code><span data-request></span></div>`;

function commandVisual() {
  return `<svg class="command-art" viewBox="0 0 800 365" role="img" aria-label="A confidential request approaches the Privora enforcement gate">
    <defs>
      <linearGradient id="gateface" x1="0" x2="1" y1="1" y2="0" gradientUnits="objectBoundingBox"><stop stop-color="#102654"/><stop offset="1" stop-color="#315de0"/></linearGradient>
      <linearGradient id="gateedge"><stop stop-color="#162c86"/><stop offset="1" stop-color="#8caaff"/></linearGradient>
      <linearGradient id="runway" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#2458e7" stop-opacity=".15"/><stop offset="1" stop-color="#090f22" stop-opacity=".1"/></linearGradient>
      <linearGradient id="gatebeam"><stop stop-color="var(--state)" stop-opacity="0"/><stop offset=".68" stop-color="var(--state)" stop-opacity=".14"/><stop offset="1" stop-color="var(--state)" stop-opacity=".42"/></linearGradient>
      <pattern id="commandgrid" width="27" height="27" patternUnits="userSpaceOnUse"><path d="M27 0H0v27" fill="none" stroke="#4368c5" stroke-opacity=".17"/></pattern>
      <clipPath id="floor"><path d="M122 267h592l80 98H44z"/></clipPath>
    </defs>
    <path d="M122 267h592l80 98H44z" fill="url(#runway)"/><path d="M0 0h800v365H0z" fill="url(#commandgrid)" clip-path="url(#floor)"/>
    <path d="M0 267h800" stroke="#294773" stroke-opacity=".65"/>
    <g fill="none" stroke="#1f3d74" opacity=".62"><path d="M55 304h703M32 333h749"/><path d="m301 267-38 98m237-98 35 98"/></g>
    <path class="request-beam" d="M112 209 395 191v46L112 218z" fill="url(#gatebeam)"/>
    <path d="M70 214h630" stroke="#536a9c" stroke-width="1.4" stroke-dasharray="4 7"/>
    <path class="command-after" d="M432 214h268" stroke="#5af1d1" stroke-width="2"/>
    <g transform="translate(395 45)">
      <path d="M0 18 25 0l109 40v218l-28 16-106-39z" fill="#131e52" stroke="#5779ec"/>
      <path d="M0 18 25 0l109 40-28 16z" fill="#7790ff" opacity=".7"/>
      <path d="M106 56l28-16v218l-28 16z" fill="url(#gateedge)"/>
      <path d="M0 18l106 38v218L0 235z" fill="url(#gateface)" stroke="#7795ff"/>
      <path d="M12 39l82 29v183l-82-30z" fill="none" stroke="#7c9aff" opacity=".45"/>
      <path class="gate-status-edge" d="M0 32v183l11 15" fill="none" stroke="var(--state)" stroke-width="3"/>
      <path d="M32 111l40 14v25c0 23-20 30-20 30s-20-18-20-41zm11 33 7 8 13-11" stroke="#d6e3ff" stroke-width="2.5" fill="none"/>
    </g>
    <path d="M402 214h-287" stroke="var(--state)" stroke-width="2"/>
    <g transform="translate(378 214)"><g class="command-packet"><circle r="14" fill="none" stroke="var(--state)" opacity=".45"/><circle r="5" fill="var(--state)"/></g></g>
    <g class="command-stop" fill="none" stroke="#ff8f8b" stroke-width="2"><circle cx="395" cy="214" r="22"/><path d="m388 207 14 14m0-14-14 14"/></g>
    <g transform="translate(395 214)"><circle class="command-ring" r="24" fill="none" stroke="var(--state)" stroke-width="1.5"/></g>
    <g class="policy-injection">
      <path d="M235 81h85l75 85" fill="none" stroke="var(--state)" stroke-dasharray="3 6"/>
      <g transform="translate(235 81)"><circle class="policy-signal" r="4" fill="var(--state)"/></g>
      <rect x="124" y="65" width="112" height="32" rx="3" fill="#182544" stroke="var(--state)"/>
      <text x="139" y="85" fill="#e3ebff" font-family="monospace" font-size="11">TERMS UPDATE</text>
    </g>
    <g fill="#a6b8db" font-family="monospace" font-size="11" letter-spacing="1"><text x="70" y="243">CONFIDENTIAL REQUEST</text><text x="577" y="243">EXTERNAL ANALYZER</text></g>
    <rect x="689" y="199" width="30" height="30" rx="4" fill="#151f38" stroke="#58759b"/><path d="M696 209h16l2 7v6h-20v-6l2-7Zm-2 7h6l2 3h4l2-3h6" stroke="#adc2e1" fill="none"/>
  </svg>`;
}

function command() {
  return `<article class="concept command" data-tone="deny">
  ${header("Security Command Center")}
  <div class="command-main">
    <div class="command-title"><p class="caseid">ENFORCEMENT REPLAY / SYNTHETIC CASE 07</p><h1 data-heading></h1><p data-copy></p><span class="state" data-flag></span></div>
    <figure class="command-figure">${commandVisual()}<figcaption><span class="gate-caption"><i></i> Privora enforcement gate</span><span class="gate-meta"><code data-version></code><code data-visual-stage></code></span></figcaption></figure>
  </div>
  <div class="command-evidence">
    <section class="command-diff"><h2>Policy change</h2>${diff()}</section>
    <section class="command-proof"><h2>Transfer evidence</h2>${evidence()}${audit()}${impact()}</section>
  </div>
  <footer class="command-playback"><div class="command-film">${frames.map((f,i)=>step(f,i)).join("")}</div>${controls()}</footer>
  </article>`;
}

function evidenceDesk() {
  const eventGlyphs = ["inbox","file","shield","alert","branch"];
  return `<article class="concept evidence" data-tone="deny">
  ${header("Policy Investigation")}
  <div class="desk">
    <aside class="case-rail"><span class="caseid">SYNTHETIC CASE 07</span><h2>Chain of evidence</h2><div class="causal">${frames.map((f,i)=>`<button data-step="${i}" aria-pressed="false"><i>${icon(eventGlyphs[i],15)}</i><span><strong>${f.name}</strong><code>${f.time}</code></span></button>`).join("")}</div>${controls()}</aside>
    <section class="paper">
      <div class="paper-top"><span>${icon("file",16)} Observed policy evidence</span><span>EXTERNAL ANALYZER</span></div>
      <div class="paper-heading"><h1>Model training</h1><p>Confidential document handling</p></div>
      <div class="paper-source"><code>fixture://analyzer/privacy</code><span>v1 ${icon("arrow",13)} v2</span></div>
      ${diff(true)}
      <div class="rule"><span>${icon("shield",22)}</span><div><h3>Organization rule</h3><p>No AI training on confidential documents.</p></div></div>
      <details class="provenance"><summary>Observation record</summary><p>Policy v2 observed at 14:08:31 in this synthetic case. Applicability is subject to review.</p></details>
    </section>
    <aside class="finding"><p class="caseid">SELECTED EVENT</p><h2 data-heading></h2><span class="state" data-flag></span><p data-copy></p>${evidence()}${audit()}${impact()}</aside>
  </div></article>`;
}

function journeyVisual() {
  return `<svg class="journey-art" viewBox="0 0 670 500" role="img" aria-label="Isometric request journey through intake, policy check, and analyzer handoff">
    <defs>
      <pattern id="journeygrid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0v36" fill="none" stroke="#6378ce" stroke-opacity=".18"/></pattern>
      <linearGradient id="journeyface" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#182865"/><stop offset="1" stop-color="#263eaf"/></linearGradient>
      <linearGradient id="plane"><stop stop-color="#2b4aa1" stop-opacity=".7"/><stop offset="1" stop-color="#131c49" stop-opacity=".75"/></linearGradient>
    </defs>
    <path d="M0 0h670v500H0z" fill="url(#journeygrid)"/>
    <g stroke="#596ea8" fill="none" opacity=".5" stroke-dasharray="3 6"><path d="M110 232v216M338 89v354m227-211v208M110 402l227-132 228 132m-455 0 227 86 228-86"/></g>
    <g class="journey-plane journey-third"><path d="m119 343 211-118 227 112-216 120Z" fill="url(#plane)" stroke="#4b68b5"/><path d="m119 343 222 114v12L119 355Zm222 114 216-120v12L341 469" fill="#151f4d" stroke="#445e9e"/></g>
    <g class="journey-plane journey-second"><path d="m119 244 211-118 227 112-216 120Z" fill="url(#journeyface)" stroke="#849bfa"/><path d="m119 244 222 114v12L119 256Zm222 114 216-120v12L341 370" fill="#253779" stroke="#7085d7"/></g>
    <g class="journey-plane journey-first"><path d="m119 147 211-118 227 112-216 120Z" fill="url(#plane)" stroke="#647dbf"/><path d="m119 147 222 114v12L119 159Zm222 114 216-120v12L341 273" fill="#151f4d" stroke="#5069a9"/></g>
    <path d="M337 138v222" stroke="#a5bdfa" stroke-width="2" stroke-dasharray="5 7"/>
    <path class="journey-through" d="M337 138v222" stroke="#63eed2" stroke-width="3"/>
    <g transform="translate(337 241)"><g class="journey-signal"><circle r="18" fill="#151c3b" stroke="var(--state)" stroke-width="2"/><circle r="5" fill="var(--state)"/></g></g>
    <g class="journey-intercept" fill="none" stroke="#fda2a0" stroke-width="1.5"><circle cx="337" cy="241" r="27"/><path d="m331 235 12 12m0-12-12 12"/></g>
  </svg>`;
}

function journey() {
  return `<article class="concept journey" data-tone="deny">
  ${header("Enforcement Journey")}
  <div class="journey-layout">
    <aside class="journey-steps"><p class="caseid">SYNTHETIC CASE 07</p><h1>Follow the<br>request.</h1><div class="journey-progress">${frames.map((f,i)=>step(f,i)).join("")}</div>${controls()}</aside>
    <section class="journey-space" aria-label="Request journey visualization">${journeyVisual()}
      <button class="plane-label intake" data-step="0"><b>01</b> Request intake</button>
      <button class="plane-label boundary" data-step="3"><b>02</b> Enforcement boundary</button>
      <button class="plane-label handoff" data-step="4"><b>03</b> Analyzer handoff</button>
      <div class="journey-caption" data-flag></div>
    </section>
    <aside class="journey-info"><p class="caseid">REQUEST STATE</p><h2 data-heading></h2><p data-copy></p>${evidence()}
      <details class="journey-clause" open><summary>Changed clause <code>v1 → v2</code></summary>${diff()}</details>${audit()}${impact()}
    </aside>
  </div></article>`;
}

const variants = [command,evidenceDesk,journey];
let timer;
function mountScenario(variant, autoplay=false) {
  clearTimeout(timer);
  const root = document.querySelector(".concept");
  if (!root) return;
  const play = root.querySelector("[data-play]");
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const intervals = variant === 1 ? [1650,2400,1800,1900] : [1550,2050,1500,1900];
  let index = 3;
  let playing = false;
  let paused = false;
  function draw(animate=true) {
    const frame = frames[index];
    root.dataset.tone = frame.tone;
    root.dataset.stage = index;
    root.querySelector("[data-heading]").textContent = frame.heading;
    root.querySelector("[data-copy]").textContent = frame.copy;
    root.querySelector("[data-flag]").textContent = frame.flag;
    root.querySelector("[data-receipt]").textContent = frame.receipts;
    root.querySelector("[data-delta]").textContent = index === 0 ? "First delivery confirmed" : "No additional receipt";
    root.querySelector("[data-time]").textContent = frame.time;
    root.querySelector("[data-reason]").textContent = frame.reason;
    root.querySelector("[data-request]").textContent = frame.request || "Policy event";
    const version = root.querySelector("[data-version]");
    if (version) version.textContent = "POLICY v" + frame.version;
    const gateStage = root.querySelector("[data-visual-stage]");
    if (gateStage) {
      gateStage.textContent = ["HANDOFF CONFIRMED","TERMS OBSERVED","APPROVAL INVALIDATED","RETRY HELD","IMPACT TRACED"][index];
      root.querySelectorAll(".command-ring, .policy-signal, .request-beam, .new").forEach(element =>
        element.getAnimations().forEach(animation => animation.cancel()));
      if (animate && !motionPreference.matches) {
        const ring = root.querySelector(".command-ring");
        if (index === 0 || index === 3) {
          ring.animate([{transform:"scale(.85)",opacity:.85},{transform:"scale(1.75)",opacity:0}],
            {delay:index === 3 ? 300 : 160,duration:270,easing:"cubic-bezier(.23,1,.32,1)"});
          root.querySelector(".request-beam").animate([{opacity:.14},{opacity:.85}],{duration:270,easing:"ease-out"});
        }
        if (index === 1) {
          root.querySelector(".policy-signal").animate([
            {transform:"translate(0,0)",opacity:1},{transform:"translate(85px,0)",opacity:1,offset:.48},
            {transform:"translate(160px,85px)",opacity:0}],{duration:460,easing:"linear"});
        }
        if (index === 1 || index === 2) {
          root.querySelector(".command-diff .new").animate([{opacity:.54},{opacity:1}],{duration:230,easing:"ease-out"});
        }
      }
    }
    root.querySelector(".impact-info").hidden = index !== 4;
    root.querySelectorAll("[data-step]").forEach(button => {
      button.setAttribute("aria-pressed",Number(button.dataset.step)===index?"true":"false");
    });
    const packet = root.querySelector(".command-packet, .journey-signal");
    if (packet) {
      packet.getAnimations().forEach(animation => animation.cancel());
      if (animate && !motionPreference.matches && (index === 0 || index === 3)) {
        const distance = variant === 0 ? (index === 0 ? -550 : -240) : (index === 0 ? -221 : -102);
        const transform = variant === 0 ? `translateX(${distance}px)` : `translateY(${distance}px)`;
        packet.animate([{transform,opacity:.2},{transform:"translate(0,0)",opacity:1}],{duration:420,easing:"cubic-bezier(.23,1,.32,1)"});
      }
    }
  }

  function setPlaying(value) {
    playing = value;
    play.innerHTML = value ? icon("stop",17) + " Pause" : icon("play",17) + (paused ? " Resume" : " Play sequence");
  }
  function advance() {
    clearTimeout(timer);
    if (!playing || index >= frames.length-1) { setPlaying(false); return; }
    timer = setTimeout(() => { index++; draw(); advance(); },intervals[index]);
  }
  function start() {
    index = 0;
    paused = false;
    setPlaying(true);
    draw();
    advance();
  }
  root.addEventListener("click",event => {
    const control = event.target.closest("button");
    if (!control) return;
    if (control === play) {
      if (playing) { paused = true; setPlaying(false); clearTimeout(timer); }
      else if (paused) { paused = false; setPlaying(true); advance(); }
      else start();
    } else if (control.hasAttribute("data-reset") || control.hasAttribute("data-step")) {
      paused = false;
      setPlaying(false);
      clearTimeout(timer);
      index = control.hasAttribute("data-reset") ? 0 : Number(control.dataset.step);
      draw();
    }
  });
  root.querySelector("[data-heading]").setAttribute("aria-live","polite");
  if (autoplay) start();
  else draw(false);
}
