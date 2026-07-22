require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cols = await client.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale,
           is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'shipcore' AND table_name = 'fc_products'
    ORDER BY ordinal_position;
  `);
  console.log('=== COLUMNS ===');
  console.log(JSON.stringify(cols.rows, null, 2));

  const constraints = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'shipcore.fc_products'::regclass;
  `);
  console.log('=== CONSTRAINTS ===');
  console.log(JSON.stringify(constraints.rows, null, 2));

  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'shipcore' AND tablename = 'fc_products';
  `);
  console.log('=== INDEXES ===');
  console.log(JSON.stringify(indexes.rows, null, 2));

  const triggers = await client.query(`
    SELECT tgname, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgrelid = 'shipcore.fc_products'::regclass AND NOT tgisinternal;
  `);
  console.log('=== TRIGGERS ===');
  console.log(JSON.stringify(triggers.rows, null, 2));

  // Check migrations table for any resolved/applied entry mentioning fc_products creation
  const migRow = await client.query(`
    SELECT migration_name, finished_at, applied_steps_count
    FROM shipcore._prisma_migrations
    ORDER BY started_at ASC
    LIMIT 5;
  `).catch(e => ({ error: e.message }));
  console.log('=== FIRST 5 MIGRATIONS RECORDED ===');
  console.log(JSON.stringify(migRow.rows || migRow, null, 2));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
