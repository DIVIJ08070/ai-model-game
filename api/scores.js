// api/scores.js — serverless leaderboard for Body Dash.
// Works with ANY Postgres via a DATABASE_URL: free Neon (recommended), Supabase, Vercel Postgres.
//
//   GET  /api/scores?diff=normal&range=all|today
//        -> { ok:true, configured:true, scores:[{name,score,diff,dist,ts}, ...] }  (top 20, desc)
//   POST /api/scores { name, score, diff, dist }
//        -> { ok:true, configured:true, rank, best }
//
// Serverless-correctness (all handled here):
//  * ONE pg Pool created at module scope and REUSED across warm invocations (a Pool per
//    request would exhaust DB connections). Cached on `global` to survive re-evaluation.
//  * Parameterized queries only ($1,$2...) — user input is never concatenated into SQL.
//  * Table created lazily (CREATE TABLE IF NOT EXISTS) once; the promise is cached.
//  * No DATABASE_URL -> 503 {configured:false} so the static client cleanly falls back to
//    localStorage instead of hard-failing.
//  * Strict validation/sanitization; request body size-capped.
const { Pool } = require('pg');

const CONNECTION_STRING = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const MAX_SCORE = 10000000;   // sanity cap (game score is Math.floor(G.score))
const NAME_MAX = 20;
const TOP_N = 20;
const DIFFS = ['chill', 'normal', 'intense'];

// --- module-scope singletons (reused across warm invocations) ----------------
let pool = global.__bodyDashPool || null;
if (CONNECTION_STRING && !pool) {
  pool = new Pool({
    connectionString: CONNECTION_STRING,
    // Verify the DB's TLS certificate (Neon/Supabase/Vercel use publicly-trusted CAs) so the
    // connection is encrypted AND authenticated — no silent man-in-the-middle. Set
    // PGSSL_NO_VERIFY=1 only if your provider requires a private/self-signed CA.
    ssl: process.env.PGSSL_NO_VERIFY === '1' ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
    max: 3,                       // keep the per-container pool small on serverless
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));
  global.__bodyDashPool = pool;
}

// Lazy, cached schema init.
let schemaReady = global.__bodyDashSchema || null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(
      `CREATE TABLE IF NOT EXISTS scores (
         id    BIGSERIAL   PRIMARY KEY,
         name  TEXT        NOT NULL,
         score INTEGER     NOT NULL,
         diff  TEXT        NOT NULL DEFAULT 'normal',
         dist  INTEGER,
         ts    TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS scores_diff_score_idx ON scores (diff, score DESC, ts ASC);`
    ).catch((err) => { schemaReady = null; global.__bodyDashSchema = null; throw err; });
    global.__bodyDashSchema = schemaReady;
  }
  return schemaReady;
}

// --- helpers -----------------------------------------------------------------
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (s.length === 0) return null;
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s;
}
function cleanScore(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return (i < 0 || i > MAX_SCORE) ? null : i;
}
function cleanDiff(raw) { return DIFFS.includes(raw) ? raw : 'normal'; }
function cleanDist(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return (i < 0 || i > MAX_SCORE) ? null : i;
}
// Best-effort per-container rate limit on writes. Blunts casual spam / DB-row flooding;
// robust cross-instance limiting would need a shared store (Upstash / Vercel KV).
const RL = global.__bodyDashRL || (global.__bodyDashRL = new Map());
function clientIp(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now(), WINDOW = 60000, MAX = 30;   // 30 writes / minute / ip / container
  const arr = (RL.get(ip) || []).filter((t) => now - t < WINDOW);
  if (arr.length >= MAX) { RL.set(ip, arr); return true; }
  arr.push(now); RL.set(ip, arr);
  if (RL.size > 5000) RL.clear();                      // crude memory cap
  return false;
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024) throw new Error('payload too large'); // 10KB hard cap
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

// --- handler -----------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (!pool) {
    return sendJson(res, 503, { ok: false, configured: false,
      error: 'Leaderboard database is not configured (set DATABASE_URL).' });
  }
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const diffParam = url.searchParams.get('diff');
      const diff = DIFFS.includes(diffParam) ? diffParam : null;   // null = all difficulties
      const today = url.searchParams.get('range') === 'today';
      // One row per player (case-insensitive name), showing their BEST score.
      const { rows } = await pool.query(
        `SELECT name, score, diff, dist, ts FROM (
           SELECT DISTINCT ON (lower(name)) name, score, diff, dist, ts
             FROM scores
            WHERE ($1::text IS NULL OR diff = $1)
              AND ($2::bool = false OR ts >= date_trunc('day', now()))
            ORDER BY lower(name), score DESC, ts ASC
         ) t
         ORDER BY score DESC, ts ASC
         LIMIT $3`,
        [diff, today, TOP_N]
      );
      return sendJson(res, 200, { ok: true, configured: true,
        scores: rows.map((r) => ({ name: r.name, score: r.score, diff: r.diff, dist: r.dist,
          ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts })) });
    }

    if (req.method === 'POST') {
      // Enforce the size cap even when the platform pre-parses the body, and throttle writes.
      const clen = parseInt((req.headers && req.headers['content-length']) || '0', 10);
      if (clen > 10 * 1024) return sendJson(res, 413, { ok: false, error: 'Payload too large.' });
      if (rateLimited(clientIp(req))) return sendJson(res, 429, { ok: false, error: 'Too many submissions — slow down.' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
      const name = cleanName(body.name), score = cleanScore(body.score);
      const diff = cleanDiff(body.diff), dist = cleanDist(body.dist);
      if (name === null) return sendJson(res, 400, { ok: false, error: `name must be a non-empty string up to ${NAME_MAX} characters.` });
      if (score === null) return sendJson(res, 400, { ok: false, error: `score must be an integer between 0 and ${MAX_SCORE}.` });

      await pool.query(`INSERT INTO scores (name, score, diff, dist) VALUES ($1,$2,$3,$4)`, [name, score, diff, dist]);
      // Rank the player's BEST among the deduped board (one best per name).
      const bestRes = await pool.query(`SELECT max(score)::int AS best FROM scores WHERE lower(name) = lower($1) AND diff = $2`, [name, diff]);
      const best = bestRes.rows[0].best;
      const rankRes = await pool.query(
        `SELECT count(*)::int + 1 AS rank FROM (
           SELECT max(score) AS best FROM scores WHERE diff = $2 GROUP BY lower(name)
         ) t WHERE t.best > $1`,
        [best, diff]
      );
      return sendJson(res, 200, { ok: true, configured: true, rank: rankRes.rows[0].rank, best });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    console.error('scores handler error:', err);
    return sendJson(res, 500, { ok: false, error: 'Internal server error.' });
  }
};
