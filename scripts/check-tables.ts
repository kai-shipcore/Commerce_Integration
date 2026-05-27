import { getPrimaryPool } from "../src/lib/db/primary-db";

async function main() {
  const client = await getPrimaryPool().connect();
  try {
    const result = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE tablename LIKE 'fc_%'
      ORDER BY schemaname, tablename
    `);
    console.log("fc_* tables via pg_tables:");
    for (const row of result.rows) {
      console.log(`  ${row.schemaname}.${row.tablename}`);
    }

    const whoami = await client.query(`SELECT current_user, current_database(), current_schemas(true) AS search_path`);
    console.log("\nConnection context:");
    console.log(`  user: ${whoami.rows[0].current_user}`);
    console.log(`  db:   ${whoami.rows[0].current_database}`);
    console.log(`  search_path: ${whoami.rows[0].search_path}`);
  } finally {
    client.release();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
