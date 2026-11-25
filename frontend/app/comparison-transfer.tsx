import { useEffect, useState } from "react";

type Snapshot = { running: boolean; queued_files: number; confirmed_files: number };
const path = "/api/rehearsal-comparison";

async function comparison(method: "GET" | "POST" | "DELETE", signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch(path, {
    signal,
    cache: "no-store",
    method,
    headers: method === "GET" ? undefined : { "X-Privora-Comparison": "1" },
  });
  if (!response.ok) throw new Error("Comparison receiver unavailable. Start the local synthetic comparison service.");
  return response.json();
}

export function useComparisonTransfer(enabled: boolean) {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startedHere, setStartedHere] = useState(false);
  const running = state?.running ?? false;

  useEffect(() => {
    if (!enabled || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const snapshot = await comparison("GET", controller.signal);
        if (controller.signal.aborted) return;
        setState(snapshot);
        setError("");
        if (!snapshot.running) return;
      } catch {
        if (!running || controller.signal.aborted) return;
        setError("Comparison updates interrupted. Retrying...");
      }
      timer = setTimeout(poll, 750);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, running, busy]);

  async function change(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      setState(await comparison(method));
      if (method === "POST") setStartedHere(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the comparison transfer.");
    } finally {
      setBusy(false);
    }
  }

  return { state, error, busy, running, startedHere, change };
}

export function ComparisonTransfer({ state, error, startedHere }: { state?: Snapshot; error: string; startedHere: boolean }) {
  const running = state?.running ?? false;
  return <section className="comparison-transfer" aria-label="Unprotected synthetic comparison">
    <p><strong>Unprotected comparison</strong> <span className="muted">· Synthetic files only. Policy changes do not stop this receiver.</span></p>
    {state && (running || startedHere) ? <div role="status">
      <p>{running ? (startedHere ? "Comparison running." : "A comparison started earlier is still running.") : "Comparison ended."}</p>
      <p>{state.confirmed_files} of {state.queued_files} delivered to the comparison receiver</p>
      <progress value={state.confirmed_files} max={state.queued_files} aria-label="Comparison deliveries" />
    </div> : <p className="muted" role="status">Waiting for you to start a transfer.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
