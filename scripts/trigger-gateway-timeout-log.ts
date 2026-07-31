/**
 * Manual integration check for the API error log pipeline.
 * This intentionally inserts one HTTP 504 row into shipcore.fc_api_error_logs.
 */
import { withErrorHandler } from "@/lib/api-response";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { GatewayTimeoutError } from "@/lib/errors";

async function main() {
  const handler = withErrorHandler(async (request: Request) => {
    void request;
    throw new GatewayTimeoutError("Manual test: upstream forecast server timed out");
  });

  const response = await handler(new Request(
    "http://localhost/api/manual-tests/gateway-timeout",
    { method: "POST" },
  ));
  const body = await response.json() as {
    success: boolean;
    error: string;
    requestId?: string;
  };

  if (response.status !== 504 || !body.requestId) {
    throw new Error(`Unexpected response: ${response.status} ${JSON.stringify(body)}`);
  }

  const pool = getPrimaryPool();
  let savedRow: Record<string, unknown> | undefined;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT request_id, occurred_at, method, pathname, status_code,
              error_code, error_name, message, duration_ms
         FROM shipcore.fc_api_error_logs
        WHERE request_id = $1::uuid`,
      [body.requestId],
    );
    savedRow = result.rows[0];
    if (savedRow) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await pool.end();

  if (!savedRow) {
    throw new Error(`Error log was not saved for request ID ${body.requestId}`);
  }

  console.log(JSON.stringify({ response: { status: response.status, ...body }, savedRow }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
