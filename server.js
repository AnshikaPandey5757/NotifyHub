// NotifyHub API — thin layer over PostgreSQL.
// All business rules live in the database (triggers, functions, procedures);
// this server just calls them. Who may call what is decided by auth.js.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');
const { buildDatabase, isDatabaseBuilt } = require('./db-setup');
const auth = require('./auth');

const pool = new Pool({ ...config, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
// Hosted Postgres (Neon) closes idle connections when it sleeps.
// Without this handler that would crash the whole server.
pool.on('error', (err) => console.error('Idle DB connection closed:', err.message));

const app = express();
app.set('trust proxy', 1);           // Render sits behind a proxy: needed for HTTPS cookies + real client IPs
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Small helper: wrap async handlers and send DB errors back as JSON
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(400).json({ error: err.message }));

// ---------- Health check (used by Render + uptime pinger; doesn't touch the DB) ----------
app.get('/health', (req, res) => res.send('ok'));

// =====================================================================
// AUTH (public routes)
// =====================================================================
app.post('/api/auth/login', route(async (req, res) => {
  if (auth.tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await pool.query(`
    SELECT u.user_id, u.name, u.email, u.role, d.name AS department
    FROM users u LEFT JOIN departments d USING (dept_id) WHERE lower(u.email) = $1`, [email]);
  const user = rows[0];
  // Same message for "no such email" and "wrong password", so emails can't be probed
  if (!user || !auth.samePassword(req.body.password, auth.ROLE_PASSWORDS[user.role])) {
    auth.recordFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  auth.setSessionCookie(req, res, user.user_id);
  res.json(auth.publicUser(user));
}));

// Departments a new student can join (the ones with their own "<X> Department" category)
app.get('/api/auth/departments', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT d.dept_id, d.name FROM departments d
    JOIN categories c ON c.owner_dept_id = d.dept_id AND c.name ILIKE '% Department'
    ORDER BY d.name`);
  res.json(rows);
}));

// Students only. The student password doubles as the access code, so outsiders can't register.
app.post('/api/auth/signup', route(async (req, res) => {
  if (auth.tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const deptId = Number(req.body.dept_id);
  if (name.length < 2 || name.length > 100) throw new Error('Enter your full name (2–100 characters)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw new Error('Enter a valid email address');
  if (!auth.samePassword(req.body.code, auth.ROLE_PASSWORDS.student)) {
    auth.recordFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect student access code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dept = await client.query(`
      SELECT 1 FROM categories WHERE owner_dept_id = $1 AND name ILIKE '% Department'`, [deptId]);
    if (!dept.rowCount) throw new Error('Pick your department');
    const { rows } = await client.query(
      `INSERT INTO users (name, email, role, dept_id) VALUES ($1, $2, 'student', $3)
       RETURNING user_id`, [name, email, deptId]);
    const userId = rows[0].user_id;
    // Same starting subscriptions the sample students get: their department's category + Exams
    await client.query(`
      INSERT INTO subscriptions (user_id, category_id)
      SELECT $1, category_id FROM categories
      WHERE (owner_dept_id = $2 AND name ILIKE '% Department') OR name = 'Exams'
      ON CONFLICT DO NOTHING`, [userId, deptId]);
    await client.query('COMMIT');
    auth.setSessionCookie(req, res, userId);
    const me = await pool.query(`
      SELECT u.user_id, u.name, u.email, u.role, d.name AS department
      FROM users u LEFT JOIN departments d USING (dept_id) WHERE u.user_id = $1`, [userId]);
    res.json(auth.publicUser(me.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new Error('An account with this email already exists. Sign in instead.');
    throw err;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// Everything below needs a signed-in user
app.use('/api', auth.loadUser(pool));

app.get('/api/auth/me', (req, res) => res.json(auth.publicUser(req.user)));

// =====================================================================
// EVERYONE (students, faculty, admin): their OWN inbox and settings
// The user id always comes from the session, never from the request.
// =====================================================================
app.get('/api/categories', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.category_id, c.name, c.description,
           (SELECT COUNT(*)::INT FROM subscriptions s WHERE s.category_id = c.category_id) AS subscribers
    FROM categories c ORDER BY c.category_id`);
  res.json(rows);
}));

app.get('/api/me/inbox', route(async (req, res) => {
  const id = req.user.user_id;
  const [inbox, unread] = await Promise.all([
    pool.query('SELECT * FROM user_inbox WHERE user_id = $1 ORDER BY delivered_at DESC', [id]),
    pool.query('SELECT unread_count($1) AS unread', [id]),
  ]);
  res.json({ unread: unread.rows[0].unread, items: inbox.rows });
}));

app.post('/api/me/read/:nid', route(async (req, res) => {
  await pool.query(
    `UPDATE notification_recipients SET status = 'read'
     WHERE user_id = $1 AND notification_id = $2`,
    [req.user.user_id, Number(req.params.nid)]);
  res.json({ ok: true });
}));

app.post('/api/me/read-all', route(async (req, res) => {
  await pool.query('CALL mark_all_read($1)', [req.user.user_id]);   // stored procedure
  res.json({ ok: true });
}));

app.get('/api/me/settings', route(async (req, res) => {
  const id = req.user.user_id;
  const subs = await pool.query('SELECT category_id FROM subscriptions WHERE user_id = $1', [id]);
  const pref = await pool.query(
    `SELECT COALESCE((SELECT enabled FROM user_preferences
                      WHERE user_id = $1 AND channel = 'in_app'), TRUE) AS in_app`, [id]);
  res.json({ subscriptions: subs.rows.map((r) => r.category_id), in_app: pref.rows[0].in_app });
}));

app.put('/api/me/subscriptions/:cid', route(async (req, res) => {
  const [uid, cid] = [req.user.user_id, Number(req.params.cid)];
  if (req.body.subscribed) {
    await pool.query(
      'INSERT INTO subscriptions (user_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, cid]);
  } else {
    await pool.query('DELETE FROM subscriptions WHERE user_id = $1 AND category_id = $2', [uid, cid]);
  }
  res.json({ ok: true });
}));

app.put('/api/me/in-app', route(async (req, res) => {
  await pool.query(
    `INSERT INTO user_preferences (user_id, channel, enabled) VALUES ($1, 'in_app', $2)
     ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [req.user.user_id, !!req.body.enabled]);
  res.json({ ok: true });
}));

// =====================================================================
// FACULTY + ADMIN: send (one TRANSACTION across several categories)
// The sender is always the signed-in user, so nobody can post as someone else.
// =====================================================================
app.post('/api/notifications', auth.allow('faculty', 'admin'), route(async (req, res) => {
  const { category_ids, title, body, priority, expires_at } = req.body;
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
        [req.user.user_id, cid, title, body, priority || 'normal', expires_at || null]);
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

// =====================================================================
// ADMIN ONLY: user list, analytics, audit log, SQL playground
// =====================================================================
app.get('/api/users', auth.allow('admin'), route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.user_id, u.name, u.email, u.role, d.name AS department
    FROM users u LEFT JOIN departments d USING (dept_id)
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'faculty' THEN 1 ELSE 2 END, u.user_id`);
  res.json(rows);
}));

app.get('/api/stats', auth.allow('admin'), route(async (req, res) => {
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

app.get('/api/audit', auth.allow('admin'), route(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY log_id DESC LIMIT 100');
  res.json(rows);
}));

// ---------- SQL playground (admin only) ----------
// Read-only by default; "allow writes" commits instead of rolling back.
//  - queryMode 'extended' forces Postgres's extended protocol, which accepts ONE statement only,
//    so tricks like "COMMIT; DROP TABLE users;" are rejected by Postgres itself.
//  - schema-changing / destructive commands are blocked even with writes on.
const BLOCKED = /\b(drop|truncate|alter|create|grant|revoke|copy|do|vacuum|reindex|cluster|comment|security|lock|listen|notify)\b|^\s*(set|reset|discard)\b/i;

app.post('/api/query', auth.allow('admin'), route(async (req, res) => {
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

// Unknown API routes get JSON, not the HTML page
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

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
