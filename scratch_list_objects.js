require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'shipcore' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  console.log('=== TABLES ===');
  console.log(tables.rows.map(r => r.table_name).join('\n'));

  const views = await client.query(`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'shipcore'
    ORDER BY table_name;
  `);
  console.log('=== VIEWS ===');
  console.log(views.rows.map(r => r.table_name).join('\n'));

  const types = await client.query(`
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'shipcore' AND t.typtype = 'e'
    ORDER BY t.typname;
  `);
  console.log('=== ENUM TYPES ===');
  console.log(types.rows.map(r => r.typname).join('\n'));

  const funcs = await client.query(`
    SELECT p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'shipcore'
    ORDER BY p.proname;
  `);
  console.log('=== FUNCTIONS ===');
  console.log(funcs.rows.map(r => r.proname).join('\n'));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
