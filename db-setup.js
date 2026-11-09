// Builds (or rebuilds) the NotifyHub database: reset, tables, logic, views, sample data.
// Used by `npm run setup` and automatically by server.js on first start.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const FILES = ['00_reset.sql', '01_schema.sql', '02_logic.sql', '03_views_indexes.sql', '04_seed.sql'];

async function createDatabaseIfMissing(config) {
  // Only for a local install configured with host/user/password fields
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
  if (rowCount === 0) {
    await admin.query(`CREATE DATABASE "${config.database}"`);
    console.log(`Created database ${config.database}`);
  }
  await admin.end();
}

async function buildDatabase(config) {
  if (!config.usesUrl) await createDatabaseIfMissing(config);
  const db = new Client(config);
  await db.connect();
  try {
    for (const file of FILES) {
      await db.query(fs.readFileSync(path.join(__dirname, 'db', file), 'utf8'));
      console.log(`Loaded ${file}`);
    }
    const { rows } = await db.query(`
      SELECT (SELECT COUNT(*) FROM users)::INT                   AS users,
             (SELECT COUNT(*) FROM notifications)::INT           AS notifications,
             (SELECT COUNT(*) FROM notification_recipients)::INT AS deliveries`);
    console.log('Database ready:', rows[0]);
  } finally {
    await db.end();
  }
}

async function isDatabaseBuilt(pool) {
  const { rows } = await pool.query("SELECT to_regclass('public.notification_recipients') IS NOT NULL AS ok");
  return rows[0].ok;
}

module.exports = { buildDatabase, isDatabaseBuilt };
