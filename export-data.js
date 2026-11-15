// node export-data.js  ->  writes notifyhub-data.json with every table and view (structure + all rows).
// Uses the same connection settings as the app (DATABASE_URL, or PGPASSWORD etc. for a local install).
// The JSON is turned into an Excel workbook afterwards.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('./config');

// Show tables in a sensible order (parents before children) instead of alphabetically
const ORDER = ['departments', 'users', 'categories', 'subscriptions', 'notifications',
  'notification_recipients', 'user_preferences', 'audit_log',
  'user_inbox', 'category_stats', 'dept_engagement', 'sender_stats'];

(async () => {
  const db = new Client(config);
  await db.connect();
  try {
    const { rows: objects } = await db.query(`
      SELECT table_name AS name, CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind
      FROM information_schema.tables WHERE table_schema = 'public'`);
    objects.sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));

    const out = { exported_at: new Date().toISOString(), objects: [] };
    for (const { name, kind } of objects) {
      const { rows: columns } = await db.query(`
        SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable, column_default AS "default"
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`, [name]);
      // Primary-key columns (tables only) so the data is ordered the natural way
      const { rows: pk } = await db.query(`
        SELECT a.attname AS col FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`, [name]);
      const orderBy = pk.length ? ' ORDER BY ' + pk.map((p) => `"${p.col}"`).join(', ') : '';
      const { rows } = await db.query({ text: `SELECT * FROM "${name}"${orderBy}`, rowMode: 'array' });
      let definition = null;
      if (kind === 'view') {
        definition = (await db.query('SELECT pg_get_viewdef($1::regclass, true) AS d', [name])).rows[0].d;
      }
      out.objects.push({ name, kind, primary_key: pk.map((p) => p.col), columns, definition, rows });
      console.log(`${kind.padEnd(5)} ${name.padEnd(24)} ${rows.length} rows`);
    }
    const file = path.join(__dirname, 'notifyhub-data.json');
    fs.writeFileSync(file, JSON.stringify(out));
    console.log(`\nSaved ${file}`);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error('\nExport failed:', err.message);
  if (/password authentication/i.test(err.message)) {
    console.error('-> Set $env:PGPASSWORD="your-postgres-password" (or $env:DATABASE_URL) and run again.');
  }
  process.exit(1);
});
