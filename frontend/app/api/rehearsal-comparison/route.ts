const receiver = "http://127.0.0.1:8444/api/comparison";

async function requestReceiver(method: "GET" | "POST" | "DELETE") {
  if (process.env.NEXT_PUBLIC_PRIVORA_COMPARISON !== "1") {
    return Response.json({ error: "Comparison disabled." }, { status: 404 });
  }
  try {
    const response = await fetch(receiver, {
      method,
      headers: method === "GET" ? undefined : { "X-Privora-Comparison": "1" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) return Response.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    // This independent receiver may be off even when Privora is running.
  }
  return Response.json({ error: "Comparison receiver unavailable." }, { status: 503 });
}

export function GET() {
  return requestReceiver("GET");
}

export function POST(request: Request) {
  return mutate(request, "POST");
}

export function DELETE(request: Request) {
  return mutate(request, "DELETE");
}

function mutate(request: Request, method: "POST" | "DELETE") {
  if (request.headers.get("X-Privora-Comparison") !== "1") {
    return Response.json({ error: "Invalid comparison request." }, { status: 403 });
  }
  return requestReceiver(method);
}
