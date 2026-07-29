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
  /** Query string without the leading "?". Optional: several planning endpoints
   *  take no parameters, and requiring an empty string at those call sites adds
   *  an argument that carries no meaning. */
  search: string = "",
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
) {
  const { NextResponse } = await import("next/server");
  const url = `${forecastApiBase()}${path}${search ? `?${search}` : ""}`;

  const attempt = () =>
    fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" },
    });

  let upstream: Response;
  try {
    upstream = await attempt();
  } catch {
    // Unreachable rather than erroring. On a developer machine the forecast
    // server is a process someone has to remember to start, and forgetting is
    // the single most common way these pages appear broken. Start it and retry
    // once, so opening the page is enough.
    //
    // Deliberately not a general retry: this runs only when the connection
    // itself failed, never on a response the server actually produced.
    const { ensureForecastServer } = await import("@/lib/forecast-server");
    const ensured = await ensureForecastServer();
    if (!ensured.ok) {
      return NextResponse.json(
        { error: "Could not reach forecast server", detail: ensured.message },
        { status: 503 },
      );
    }
    try {
      upstream = await attempt();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Could not reach forecast server",
          detail: `The server started but did not answer: ${message}`,
        },
        { status: 503 },
      );
    }
  }

  const body = await upstream.text();

  if (!upstream.ok) {
    // A 404 on a planning path means the server is running an older revision
    // that predates these endpoints, which is a different problem from a
    // missing SKU and has a different fix. Saying so here saves the reader
    // debugging their data when the answer is git pull.
    const outdated = upstream.status === 404 && !path.startsWith("/planning/sku/");
    if (outdated) {
      return NextResponse.json(
        {
          error: "Forecast server is out of date",
          detail:
            `The forecast server does not have the ${path} endpoint. It is running an older ` +
            `revision of Time_Series_Forecasting. Pull the latest there and restart it.`,
        },
        { status: 404 },
      );
    }

    // Otherwise the status is passed through rather than flattened to 500. A
    // 404 from the SKU endpoint is meaningful: it distinguishes a SKU that is
    // not forecastable from one that does not exist, and the page words those
    // differently.
    return NextResponse.json(
      { error: `Forecast server error (${upstream.status})`, detail: body },
      { status: upstream.status },
    );
  }

  try {
    return NextResponse.json(JSON.parse(body));
  } catch {
    return NextResponse.json(
      {
        error: "Forecast server returned a malformed response",
        detail: body.slice(0, 500),
      },
      { status: 502 },
    );
  }
}
