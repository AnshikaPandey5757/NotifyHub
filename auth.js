// Sign-in, sessions and role checks. No database changes: accounts are the existing rows
// in `users`, and each ROLE shares one password (kept simple on purpose for the demo).
//
// Passwords come from environment variables, with demo defaults:
//   STUDENT_PASSWORD (default student123)  FACULTY_PASSWORD (default faculty123)
//   ADMIN_PASSWORD   (default admin123)    SESSION_SECRET   (random if unset)
const crypto = require('crypto');

const ROLE_PASSWORDS = {
  student: process.env.STUDENT_PASSWORD || 'student123',
  faculty: process.env.FACULTY_PASSWORD || 'faculty123',
  admin: process.env.ADMIN_PASSWORD || 'admin123',
};

// Which pages each role may open. The server enforces the same rules on every API route.
const ROLE_VIEWS = {
  student: ['inbox'],
  faculty: ['inbox', 'send'],
  admin: ['inbox', 'send', 'stats', 'sqltab', 'audit'],
};

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one, so everyone is logged out when the server restarts.');
}
const COOKIE = 'nh_session';
const SESSION_HOURS = 12;

// Compare without leaking timing information (hash first so lengths always match)
function samePassword(given, expected) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Session token = base64url(JSON payload) + "." + HMAC signature. Tampering breaks the signature.
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}
function setSessionCookie(req, res, userId) {
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(userId)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Slow down password guessing: max 10 failed attempts per IP per 15 minutes
const failures = new Map();
function tooManyAttempts(ip) {
  const f = failures.get(ip);
  if (!f || f.reset < Date.now()) return false;
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.reset < Date.now()) failures.set(ip, { count: 1, reset: Date.now() + 15 * 60e3 });
  else f.count += 1;
}

// Middleware: attach req.user (fresh from the DB, so a role change applies immediately)
function loadUser(pool) {
  return async (req, res, next) => {
    const session = readToken(getCookie(req, COOKIE));
    if (!session) return res.status(401).json({ error: 'Please sign in' });
    try {
      const { rows } = await pool.query(`
        SELECT u.user_id, u.name, u.email, u.role, d.name AS department
        FROM users u LEFT JOIN departments d USING (dept_id) WHERE u.user_id = $1`, [session.uid]);
      if (!rows[0]) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Your account no longer exists' });
      }
      req.user = rows[0];
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

// Middleware: only let the listed roles through
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to this' });

const publicUser = (u) => ({ ...u, views: ROLE_VIEWS[u.role] || [] });

module.exports = {
  ROLE_PASSWORDS, samePassword, setSessionCookie, clearSessionCookie,
  tooManyAttempts, recordFailure, loadUser, allow, publicUser,
};
