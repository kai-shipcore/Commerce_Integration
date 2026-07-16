// Code Guide: POST /api/forecast/chat
// Proxies the user's chat history to the FastAPI /chat endpoint, which runs an
// agentic loop against Gemini (or any OpenAI-compat LLM) with tools that query
// the forecast server. Returns { reply: string, tool_calls: [...] }.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const FORECAST_API = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const upstream = await fetch(`${FORECAST_API}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Forecast server error (${upstream.status})`, detail: text },
        { status: upstream.status },
      );
    }
    // Forward the SSE stream directly
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach forecast server", detail: message },
      { status: 503 },
    );
  }
}
