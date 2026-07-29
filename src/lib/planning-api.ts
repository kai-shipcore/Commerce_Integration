/**
 * Code Guide:
 * Shared proxy helper for the planning endpoints (/api/planning/*).
 *
 * The forecast routes each repeat the same base-URL resolution, token header,
 * timeout, status passthrough and error shape. That was tolerable at one route
 * and is not at fifteen, so the planning routes share one implementation. The
 * behaviour is deliberately identical to those routes: same env vars, same
 * error envelope, same 503 when the upstream is unreachable, so a client cannot
 * tell which family of route it called.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

function forecastApiBase(): string {
  return (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

export async function proxyPlanning(
  path: string,
  search: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
) {
  const { NextResponse } = await import("next/server");
  const url = `${forecastApiBase()}${path}${search ? `?${search}` : ""}`;

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" },
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      // The status is passed through rather than flattened to 500. A 404 from
      // the planning endpoints is meaningful: it distinguishes a SKU that is
      // not forecastable from one that does not exist, and the page words those
      // differently.
      return NextResponse.json(
        { error: `Forecast server error (${upstream.status})`, detail: body },
        { status: upstream.status },
      );
    }

    return NextResponse.json(JSON.parse(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach forecast server", detail: message },
      { status: 503 },
    );
  }
}
