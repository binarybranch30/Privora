export async function POST(request: Request) {
  const origin = process.env.PRIVORA_LOCAL_DEMO_ORIGIN;
  const secret = process.env.PRIVORA_LOCAL_DEMO_SECRET;
  if (!origin || !secret || process.env.NEXT_PUBLIC_PRIVORA_LOCAL_DEMO !== "1") {
    return Response.json({ error: "Local demo sign-in is disabled." }, { status: 404 });
  }
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin)
      || request.headers.get("host") !== origin.slice("http://".length)
      || request.headers.get("origin") !== origin
      || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("x-privora-local-demo") !== "1") {
    return Response.json({ error: "Local demo sign-in requires the configured loopback origin." }, { status: 403 });
  }
  const livePort = Number(process.env.PRIVORA_LIVE_API_PORT ?? 8001);
  if (!Number.isInteger(livePort) || livePort < 1024 || livePort > 65535) {
    return Response.json({ error: "Invalid Live backend port." }, { status: 503 });
  }
  try {
    const response = await fetch("http://127.0.0.1:" + livePort + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Privora-Live": "1" },
      body: JSON.stringify({ secret }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const cookie = response.headers.get("set-cookie");
    if (response.ok && cookie) {
      return Response.json({ authenticated: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
    }
  } catch {
    // The backend may still be starting.
  }
  return Response.json({ error: "Could not open the local demo session. Check the Live backend and demo settings." }, { status: 503 });
}
