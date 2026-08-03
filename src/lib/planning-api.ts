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
  /** Almost every planning endpoint is a GET. The one exception kicks off a
   *  background job, and giving it its own proxy would have duplicated the
   *  base-URL resolution, token header, auto-start and error mapping below,
   *  which is what this helper exists to stop happening. */
  method: "GET" | "POST" = "GET",
) {
  const { NextResponse } = await import("next/server");
  const url = `${forecastApiBase()}${path}${search ? `?${search}` : ""}`;

  const attempt = () =>
    fetch(url, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-forecast-token": process.env.FORECAST_API_TOKEN ?? "" },
    });

  let upstream: Response;
  try {
    upstream = await attempt();
  } catch {
    // Unreachable rather than erroring. Two different situations reach here and
    // they need different handling.
    //
    // A local server is a process someone has to remember to start, and
    // forgetting is the most common way these pages look broken, so it is
    // started and the request retried.
    //
    // A remote one is not this app's to start, but it is also the normal
    // production arrangement rather than a fault: AI_SERVICE_URL pointing at
    // the box that runs the service is how the deployed app and any developer
    // working against it are configured. A single dropped connection over a
    // network is not evidence that the host is down, and giving up on the first
    // one turned an ordinary blip into an error card. So it retries once here
    // too, after a short pause.
    //
    // Deliberately not a general retry: this runs only when the connection
    // itself failed, never on a response the server actually produced.
    const { ensureForecastServer } = await import("@/lib/forecast-server");
    const ensured = await ensureForecastServer();
    if (!ensured.ok) {
      if (ensured.reason === "remote") {
        await new Promise((r) => setTimeout(r, 750));
        try {
          upstream = await attempt();
          return await finish(upstream);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json(
            {
              kind: "unreachable",
              error: "Could not reach forecast server",
              detail:
                `${forecastApiBase()} did not answer, after two attempts. ` +
                `This app does not manage that host, so check the service is up there ` +
                `and that AI_SERVICE_URL and FORECAST_API_TOKEN match it. (${message})`,
            },
            { status: 503 },
          );
        }
      }
      return NextResponse.json(
        { kind: "unreachable", error: "Could not reach forecast server", detail: ensured.message },
        { status: 503 },
      );
    }
    try {
      upstream = await attempt();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          kind: "unreachable",
          error: "Could not reach forecast server",
          detail: `The server started but did not answer: ${message}`,
        },
        { status: 503 },
      );
    }
  }

  return finish(upstream);

  // Response handling, shared by the first attempt and the remote retry above.
  // A nested function rather than a module-level one so it closes over `path`,
  // which the outdated-revision check needs; hoisting is what lets the retry
  // call it before this point in the source.
  async function finish(res: Response) {
  const body = await res.text();

  if (!res.ok) {
    // A 404 on a planning path means the server is running an older revision
    // that predates these endpoints, which is a different problem from a
    // missing SKU and has a different fix. Saying so here saves the reader
    // debugging their data when the answer is git pull.
    const outdated = res.status === 404 && !path.startsWith("/planning/sku/");
    if (outdated) {
      return NextResponse.json(
        {
          kind: "outdated",
          error: "Forecast server is out of date",
          detail:
            `The forecast server does not have the ${path} endpoint. It is running an older ` +
            `revision of Time_Series_Forecasting. Pull the latest there and restart it.`,
        },
        { status: 404 },
      );
    }

    // A 500 from a server that answers /health is nearly always missing data
    // rather than a bug: data/processed and outputs/reports are gitignored, so
    // a fresh clone serves health and raises everywhere else. Ask before
    // reporting, because "Internal Server Error" on its own sends the reader
    // looking in the wrong place. Only on the error path, so the healthy case
    // pays nothing.
    if (res.status >= 500) {
      const { forecastHealth } = await import("@/lib/forecast-server");
      const health = await forecastHealth();
      if (health.ready === false) {
        return NextResponse.json(
          {
            kind: "no_data",
            error: "Forecast server has no data to read",
            detail:
              `The server is running but is missing ${health.missingRequired.join(", ")}. ` +
              `data/processed and outputs/reports are gitignored, so a fresh checkout has the ` +
              `code and none of the files.`,
            missingRequired: health.missingRequired,
            files: health.files.filter((f) => !f.exists && f.required),
            repoRoot: health.repoRoot,
          },
          { status: 503 },
        );
      }
    }

    // Otherwise the status is passed through rather than flattened to 500. A
    // 404 from the SKU endpoint is meaningful: it distinguishes a SKU that is
    // not forecastable from one that does not exist, and the page words those
    // differently.
    return NextResponse.json(
      { kind: "error", error: `Forecast server error (${res.status})`, detail: body },
      { status: res.status },
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
}
