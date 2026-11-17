// Server-only HTTP client for the Coverland Workbench API.
//
// Demand Pilot calls Workbench as one service account (demand-pilot@workbench.invalid),
// authenticated by an API key sent as `X-Api-Key`. Not `Authorization: Bearer`:
// Workbench's CloudFront strips that header from GET requests, so a Bearer GET
// arrives unauthenticated and answers 401. A key request needs no cookie, CSRF
// header, or Origin.
//
// Who clicked in DP is recorded on the DP side (the refresh job row);
// Workbench's own audit trail only ever shows the service account.
//
// Never import this from client components: the key must stay on the server.

export type WorkbenchConfig = {
  baseUrl: string;
  apiKey: string;
};

/** Reads `WORKBENCH_API_URL` and `WORKBENCH_API_KEY`; null when either is unset. */
export function workbenchConfig(): WorkbenchConfig | null {
  const apiKey = process.env.WORKBENCH_API_KEY?.trim();
  const baseUrl = process.env.WORKBENCH_API_URL?.trim().replace(/\/+$/, "");
  if (!apiKey || !baseUrl) return null;
  return { baseUrl, apiKey };
}

/** A non-2xx answer, or a body that is not Workbench's JSON envelope. */
export class WorkbenchApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the request never got an answer (network, timeout). */
    readonly status: number,
    /** Workbench's stable `error.code`, when the body carried one. */
    readonly code: number | null = null,
    /**
     * Workbench's own `error.message`, whole. `message` is shortened for logs;
     * this keeps every problem a 422 lists, for callers that read them.
     */
    readonly apiMessage: string | null = null,
  ) {
    super(message);
    this.name = "WorkbenchApiError";
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ERROR_TEXT = 1_000;

type Envelope<T> =
  | { success: true; data: T; meta?: unknown }
  | { success: false; error?: { code?: number; message?: string; details?: string[] } };

export async function workbenchRequest<T>(
  config: WorkbenchConfig,
  method: "GET" | "POST",
  path: string,
  options: {
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    /** Sent as `x-request-id`; Workbench logs it as the request's correlation id. */
    requestId?: string | null;
  } = {},
): Promise<{ data: T; meta?: unknown }> {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    "X-Api-Key": config.apiKey,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.requestId) headers["x-request-id"] = options.requestId;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkbenchApiError(`Workbench ${method} ${path} did not answer: ${reason}`, 0);
  }

  const text = await response.text();
  let envelope: Envelope<T> | null = null;
  try {
    envelope = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    envelope = null;
  }

  if (response.ok && envelope && envelope.success === true) {
    return { data: envelope.data, meta: envelope.meta };
  }

  const apiError = envelope && envelope.success === false ? envelope.error : undefined;
  const message = apiError?.message
    ? [apiError.message, ...(apiError.details ?? [])].join(" ")
    : `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
  throw new WorkbenchApiError(
    `Workbench ${method} ${path} → ${response.status}: ${message}`.slice(0, MAX_ERROR_TEXT),
    response.status,
    typeof apiError?.code === "number" ? apiError.code : null,
    typeof apiError?.message === "string" ? apiError.message : null,
  );
}

/** Host only, for logs and job results; never the key. */
export function workbenchTarget(config: WorkbenchConfig): string {
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}
