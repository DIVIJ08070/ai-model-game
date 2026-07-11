// api/signal.js — WebRTC signaling relay for Spell Caster's live 1v1 duel.
// Mirrors api/scores.js: ONE reused pg Pool, lazy CREATE TABLE, parameterized queries,
// size caps, rate limiting, 503 when DATABASE_URL is unset (client shows a friendly error).
//
// It only relays the ONE-SHOT WebRTC handshake blob per side (non-trickle ICE: each peer
// gathers all candidates, then posts its complete offer/answer SDP). No media, no game
// traffic — once the DataChannel opens the two PCs talk peer-to-peer and never touch this.
//
//   POST /api/signal { room, role:'host'|'guest', sdp:{...} }
//        -> { ok:true } (upsert this side's blob)
//   GET  /api/signal?room=CODE&role=host|guest
//        -> { ok:true, sdp:{...} }            (the OTHER side is ready)
//        -> { ok:true, waiting:true }         (not posted yet — poll again)
//
// Rooms auto-expire: rows older than ROOM_TTL_MIN are ignored and swept lazily.
const { Pool } = require('pg');

const CONNECTION_STRING = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const ROLES = ['host', 'guest'];
const ROOM_RE = /^[A-Za-z0-9]{4,8}$/;
const SDP_MAX = 24 * 1024;        // a bundled offer/answer with ICE is a few KB; 24KB is generous
const ROOM_TTL_MIN = 15;          // handshake blobs live at most 15 minutes

// --- module-scope singletons (reused across warm invocations) ----------------
let pool = global.__spellSignalPool || null;
if (CONNECTION_STRING && !pool) {
  pool = new Pool({
    connectionString: CONNECTION_STRING,
    ssl: process.env.PGSSL_NO_VERIFY === '1' ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));
  global.__spellSignalPool = pool;
}

let schemaReady = global.__spellSignalSchema || null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(
      `CREATE TABLE IF NOT EXISTS signals (
         room       TEXT        NOT NULL,
         role       TEXT        NOT NULL,
         payload    JSONB       NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (room, role)
       );
       CREATE INDEX IF NOT EXISTS signals_updated_idx ON signals (updated_at);`
    ).catch((err) => { schemaReady = null; global.__spellSignalSchema = null; throw err; });
    global.__spellSignalSchema = schemaReady;
  }
  return schemaReady;
}

// --- helpers -----------------------------------------------------------------
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function cleanRoom(raw) { return (typeof raw === 'string' && ROOM_RE.test(raw)) ? raw : null; }
function cleanRole(raw) { return ROLES.includes(raw) ? raw : null; }
function otherRole(role) { return role === 'host' ? 'guest' : 'host'; }
// Accept only a plausible RTCSessionDescriptionInit ({type, sdp}); reject anything oversized/weird.
function cleanSdp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== 'offer' && raw.type !== 'answer') return null;
  if (typeof raw.sdp !== 'string' || raw.sdp.length === 0) return null;
  const json = JSON.stringify(raw);
  if (json.length > SDP_MAX) return null;
  return { type: raw.type, sdp: raw.sdp };
}

const RL = global.__spellSignalRL || (global.__spellSignalRL = new Map());
function clientIp(req) {
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now(), WINDOW = 60000, MAX = 120;   // polling is chatty; allow 120 hits / min / ip / container
  const arr = (RL.get(ip) || []).filter((t) => now - t < WINDOW);
  if (arr.length >= MAX) { RL.set(ip, arr); return true; }
  arr.push(now); RL.set(ip, arr);
  if (RL.size > 5000) RL.clear();
  return false;
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > SDP_MAX + 1024) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

// --- handler -----------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (!pool) {
    return sendJson(res, 503, { ok: false, configured: false,
      error: 'Multiplayer signaling is not configured (set DATABASE_URL).' });
  }
  try {
    await ensureSchema();
    if (rateLimited(clientIp(req))) return sendJson(res, 429, { ok: false, error: 'Too many requests — slow down.' });

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const room = cleanRoom(url.searchParams.get('room'));
      const role = cleanRole(url.searchParams.get('role'));   // the role the CALLER wants to read
      if (!room || !role) return sendJson(res, 400, { ok: false, error: 'room (4-8 alphanumeric) and role (host|guest) are required.' });
      const { rows } = await pool.query(
        `SELECT payload FROM signals
          WHERE room = $1 AND role = $2 AND updated_at > now() - ($3 || ' minutes')::interval`,
        [room, role, String(ROOM_TTL_MIN)]
      );
      if (!rows.length) return sendJson(res, 200, { ok: true, waiting: true });
      return sendJson(res, 200, { ok: true, sdp: rows[0].payload });
    }

    if (req.method === 'POST') {
      const clen = parseInt((req.headers && req.headers['content-length']) || '0', 10);
      if (clen > SDP_MAX + 1024) return sendJson(res, 413, { ok: false, error: 'Payload too large.' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
      const room = cleanRoom(body.room), role = cleanRole(body.role), sdp = cleanSdp(body.sdp);
      if (!room) return sendJson(res, 400, { ok: false, error: 'room must be 4-8 alphanumeric characters.' });
      if (!role) return sendJson(res, 400, { ok: false, error: 'role must be "host" or "guest".' });
      if (!sdp)  return sendJson(res, 400, { ok: false, error: 'sdp must be a valid {type,sdp} offer/answer.' });
      await pool.query(
        `INSERT INTO signals (room, role, payload, updated_at) VALUES ($1,$2,$3, now())
           ON CONFLICT (room, role) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [room, role, sdp]
      );
      // opportunistic sweep of expired rooms (cheap; keeps the table tiny)
      pool.query(`DELETE FROM signals WHERE updated_at < now() - ($1 || ' minutes')::interval`, [String(ROOM_TTL_MIN)]).catch(() => {});
      return sendJson(res, 200, { ok: true, otherRole: otherRole(role) });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    console.error('signal handler error:', err);
    return sendJson(res, 500, { ok: false, error: 'Internal server error.' });
  }
};
