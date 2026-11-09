// NotifyHub API — thin layer over PostgreSQL.
// All business rules live in the database (triggers, functions, procedures);
// this server just calls them.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');
const { buildDatabase, isDatabaseBuilt } = require('./db-setup');

const pool = new Pool({ ...config, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
// Hosted Postgres (Neon) closes idle connections when it sleeps.
// Without this handler that would crash the whole server.
pool.on('error', (err) => console.error('Idle DB connection closed:', err.message));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Small helper: wrap async handlers and send DB errors back as JSON
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(400).json({ error: err.message }));

// ---------- Health check (used by Render + uptime pinger; doesn't touch the DB) ----------
app.get('/health', (req, res) => res.send('ok'));

// ---------- Lookups ----------
app.get('/api/users', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.user_id, u.name, u.role, d.name AS department
    FROM users u LEFT JOIN departments d USING (dept_id)
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'faculty' THEN 1 ELSE 2 END, u.user_id`);
  res.json(rows);
}));

app.get('/api/categories', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.category_id, c.name, c.description,
           (SELECT COUNT(*)::INT FROM subscriptions s WHERE s.category_id = c.category_id) AS subscribers
    FROM categories c ORDER BY c.category_id`);
  res.json(rows);
}));

// ---------- Inbox ----------
app.get('/api/users/:id/inbox', route(async (req, res) => {
  const id = Number(req.params.id);
  const [inbox, unread] = await Promise.all([
    pool.query('SELECT * FROM user_inbox WHERE user_id = $1 ORDER BY delivered_at DESC', [id]),
    pool.query('SELECT unread_count($1) AS unread', [id]),
  ]);
  res.json({ unread: unread.rows[0].unread, items: inbox.rows });
}));

app.post('/api/users/:id/read/:nid', route(async (req, res) => {
  await pool.query(
    `UPDATE notification_recipients SET status = 'read'
     WHERE user_id = $1 AND notification_id = $2`,
    [Number(req.params.id), Number(req.params.nid)]);
  res.json({ ok: true });
}));

app.post('/api/users/:id/read-all', route(async (req, res) => {
  await pool.query('CALL mark_all_read($1)', [Number(req.params.id)]);   // stored procedure
  res.json({ ok: true });
}));

// ---------- Subscriptions & preferences ----------
app.get('/api/users/:id/settings', route(async (req, res) => {
  const id = Number(req.params.id);
  const subs = await pool.query('SELECT category_id FROM subscriptions WHERE user_id = $1', [id]);
  const pref = await pool.query(
    `SELECT COALESCE((SELECT enabled FROM user_preferences
                      WHERE user_id = $1 AND channel = 'in_app'), TRUE) AS in_app`, [id]);
  res.json({ subscriptions: subs.rows.map((r) => r.category_id), in_app: pref.rows[0].in_app });
}));

app.put('/api/users/:id/subscriptions/:cid', route(async (req, res) => {
  const [uid, cid] = [Number(req.params.id), Number(req.params.cid)];
  if (req.body.subscribed) {
    await pool.query(
      'INSERT INTO subscriptions (user_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, cid]);
  } else {
    await pool.query('DELETE FROM subscriptions WHERE user_id = $1 AND category_id = $2', [uid, cid]);
  }
  res.json({ ok: true });
}));

app.put('/api/users/:id/in-app', route(async (req, res) => {
  await pool.query(
    `INSERT INTO user_preferences (user_id, channel, enabled) VALUES ($1, 'in_app', $2)
     ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [Number(req.params.id), !!req.body.enabled]);
  res.json({ ok: true });
}));

// ---------- Send (one TRANSACTION across several categories) ----------
app.post('/api/notifications', route(async (req, res) => {
  const { sender_id, category_ids, title, body, priority, expires_at } = req.body;
  if (!Array.isArray(category_ids) || category_ids.length === 0) {
    throw new Error('Pick at least one category');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const cid of category_ids) {
      const { rows } = await client.query(
        'SELECT * FROM send_notification($1, $2, $3, $4, $5, $6)',
        [sender_id, cid, title, body, priority || 'normal', expires_at || null]);
      results.push({ category_id: cid, ...rows[0] });
    }
    await client.query('COMMIT');
    res.json({ results });
  } catch (err) {
    await client.query('ROLLBACK');   // all-or-nothing
    throw new Error(`${err.message} — transaction rolled back, nothing was sent`);
  } finally {
    client.release();
  }
}));

// ---------- Analytics ----------
app.get('/api/stats', route(async (req, res) => {
  const [categories, departments, senders, priority, totals] = await Promise.all([
    pool.query('SELECT * FROM category_stats ORDER BY read_rate_pct DESC NULLS LAST'),
    pool.query('SELECT * FROM dept_engagement ORDER BY read_rate_pct DESC NULLS LAST'),
    pool.query('SELECT * FROM sender_stats ORDER BY posted DESC'),
    pool.query(`
      SELECT n.priority, COUNT(nr.read_at)::INT AS reads,
             ROUND(AVG(EXTRACT(EPOCH FROM nr.read_at - nr.delivered_at) / 3600)::NUMERIC, 1) AS avg_hours
      FROM notifications n JOIN notification_recipients nr USING (notification_id)
      WHERE nr.read_at IS NOT NULL
      GROUP BY n.priority ORDER BY avg_hours`),
    pool.query(`
      SELECT (SELECT COUNT(*) FROM users)::INT                   AS users,
             (SELECT COUNT(*) FROM notifications)::INT           AS notifications,
             (SELECT COUNT(*) FROM notification_recipients)::INT AS deliveries,
             ROUND(100.0 * (SELECT COUNT(*) FROM notification_recipients WHERE read_at IS NOT NULL)
                   / NULLIF((SELECT COUNT(*) FROM notification_recipients), 0), 1) AS read_rate_pct`),
  ]);
  res.json({
    totals: totals.rows[0],
    categories: categories.rows,
    departments: departments.rows,
    senders: senders.rows,
    priority: priority.rows,
  });
}));

app.get('/api/audit', route(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY log_id DESC LIMIT 100');
  res.json(rows);
}));

// ---------- SQL playground (for the live demo) ----------
// Read-only by default; "allow writes" commits instead of rolling back.
// Safety for a public deployment:
//  - queryMode 'extended' forces Postgres's extended protocol, which accepts ONE statement only,
//    so tricks like "COMMIT; DROP TABLE users;" are rejected by Postgres itself.
//  - schema-changing / destructive commands are blocked even with writes on.
const BLOCKED = /\b(drop|truncate|alter|create|grant|revoke|copy|do|vacuum|reindex|cluster|comment|security|lock|listen|notify)\b|^\s*(set|reset|discard)\b/i;

app.post('/api/query', route(async (req, res) => {
  const { sql, allowWrites } = req.body;
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('Type a query first');
  const code = sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");   // ignore comments + string literals
  if (BLOCKED.test(code)) {
    throw new Error('Blocked in the playground: schema changes and admin commands (DROP, ALTER, TRUNCATE, ...)');
  }
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query(allowWrites ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query({ text: sql, queryMode: 'extended', rowMode: 'array' });
    await client.query(allowWrites ? 'COMMIT' : 'ROLLBACK');
    res.json({
      command: result.command,
      rowCount: result.rowCount,
      columns: (result.fields || []).map((f) => f.name),
      rows: result.rows || [],
      ms: Date.now() - started,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (/multiple commands/.test(err.message)) throw new Error('Run one statement at a time');
    throw err;
  } finally {
    client.release();
  }
}));

// ---------- Start: build the database automatically the first time ----------
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    if (!(await isDatabaseBuilt(pool))) {
      console.log('Empty database detected — building tables, logic and sample data...');
      await buildDatabase(config);
    }
  } catch (err) {
    console.error('Could not reach the database:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`NotifyHub running at http://localhost:${PORT}`));
})();
