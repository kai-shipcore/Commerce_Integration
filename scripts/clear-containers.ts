import { getPrimaryPool } from "../src/lib/db/primary-db";

async function main() {
  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM shipcore.fc_containers`);
    await client.query("COMMIT");
    console.log("Done — all container data cleared.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
