/* Unit tests for the serverless leaderboard handler (api/scores.js).
   Mocks the `pg` module with an in-memory store so it runs with NO deps installed
   and NO real database. Run: node tests/api.test.js */
const path = require('path');
const Module = require('module');

// ---- in-memory Postgres emulation -----------------------------------------
let store = [];
let seq = 0;
function fakeQuery(sql, params) {
  params = params || [];
  if (/CREATE TABLE|CREATE INDEX/.test(sql)) return Promise.resolve({ rows: [] });
  if (/INSERT INTO scores/.test(sql)) {
    const [name, score, diff, dist] = params;
    const row = { id: ++seq, name, score, diff, dist, ts: new Date(1700000000000 + seq) };
    store.push(row);
    return Promise.resolve({ rows: [{ id: row.id }] });
  }
  if (/AS rank/.test(sql)) {
    const [score, newId, diff] = params;
    const count = store.filter(r => r.diff === diff && (r.score > score || (r.score === score && r.id < newId))).length;
    return Promise.resolve({ rows: [{ rank: count + 1 }] });
  }
  if (/AS best/.test(sql)) {
    const [name, diff] = params;
    const mine = store.filter(r => r.name === name && r.diff === diff).map(r => r.score);
    return Promise.resolve({ rows: [{ best: mine.length ? Math.max.apply(null, mine) : null }] });
  }
  if (/FROM scores/.test(sql)) { // the GET list query
    const [diff, today, limit] = params;
    const startToday = 1700000000000; // everything in-store is "today" for the test
    let rows = store.filter(r => (diff === null || r.diff === diff) && (!today || r.ts.getTime() >= startToday));
    rows.sort((a, b) => (b.score - a.score) || (a.ts - b.ts));
    return Promise.resolve({ rows: rows.slice(0, limit) });
  }
  return Promise.resolve({ rows: [] });
}
class FakePool { constructor() {} query(sql, params) { return fakeQuery(sql, params); } on() {} }

// Intercept require('pg') everywhere (pg is not installed in this test env).
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: FakePool };
  return origLoad.call(this, request, parent, isMain);
};

const SCORES = path.join(__dirname, '..', 'api', 'scores.js');
function loadHandler() {
  delete require.cache[require.resolve(SCORES)];
  return require(SCORES);
}
function freshDbState() { store = []; seq = 0; global.__bodyDashPool = null; global.__bodyDashSchema = null; }

function mkRes() {
  return { statusCode: 0, _headers: {}, body: null,
    setHeader(k, v) { this._headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
}
async function call(handler, req) { const res = mkRes(); await handler(req, res); return res; }

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + '  — ' + (d || ''))); };

(async () => {
  console.log('Body Dash — leaderboard API\n');

  // ---- unconfigured (no DATABASE_URL) -> 503 configured:false ----
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  freshDbState();
  let h = loadHandler();
  let r = await call(h, { method: 'GET', url: '/api/scores' });
  ok('no DATABASE_URL -> 503 {configured:false}', r.statusCode === 503 && r.body.configured === false);

  // ---- configured ----
  process.env.DATABASE_URL = 'postgres://fake:fake@localhost/fake';
  freshDbState();
  h = loadHandler();

  r = await call(h, { method: 'GET', url: '/api/scores' });
  ok('GET on empty DB -> ok, empty list', r.statusCode === 200 && r.body.ok === true && r.body.scores.length === 0);

  r = await call(h, { method: 'POST', body: { name: 'Ann', score: 100, diff: 'normal' } });
  ok('POST valid -> rank 1, best 100', r.statusCode === 200 && r.body.rank === 1 && r.body.best === 100);

  r = await call(h, { method: 'POST', body: { name: 'Bob', score: 250, diff: 'normal' } });
  ok('higher score -> rank 1', r.body.rank === 1);

  r = await call(h, { method: 'POST', body: { name: 'Ann', score: 50, diff: 'normal' } });
  ok('lower score -> rank 3 (Bob250, Ann100, Ann50)', r.body.rank === 3);
  ok("personal best stays 100 for Ann", r.body.best === 100);

  r = await call(h, { method: 'GET', url: '/api/scores?diff=normal' });
  ok('GET sorted desc', r.body.scores.map(s => s.score).join(',') === '250,100,50');

  // ---- validation ----
  r = await call(h, { method: 'POST', body: { name: '', score: 10 } });
  ok('empty name -> 400', r.statusCode === 400);
  r = await call(h, { method: 'POST', body: { name: 'X', score: -5 } });
  ok('negative score -> 400', r.statusCode === 400);
  r = await call(h, { method: 'POST', body: { name: 'X', score: 1e12 } });
  ok('absurd score -> 400', r.statusCode === 400);
  r = await call(h, { method: 'POST', body: { name: 'X', score: 'not-a-number' } });
  ok('non-numeric score -> 400', r.statusCode === 400);
  r = await call(h, { method: 'POST', body: { name: 'Str', score: '321' } });
  ok('numeric-string score is coerced -> ok', r.statusCode === 200 && r.body.ok === true);

  // ---- sanitization: long name is clamped to 20 chars ----
  const longName = 'A'.repeat(50);
  r = await call(h, { method: 'POST', body: { name: longName, score: 5 } });
  ok('POST with 50-char name succeeds (server clamps)', r.statusCode === 200);
  const listed = (await call(h, { method: 'GET', url: '/api/scores' })).body.scores.find(s => s.score === 5);
  ok('stored name clamped to 20 chars', listed && listed.name.length === 20, listed && String(listed.name.length));

  // ---- difficulty is isolated ----
  r = await call(h, { method: 'POST', body: { name: 'Cee', score: 9999, diff: 'chill' } });
  ok('chill score ranks #1 within chill', r.body.rank === 1);
  r = await call(h, { method: 'GET', url: '/api/scores?diff=chill' });
  ok('GET ?diff=chill returns only chill rows', r.body.scores.length === 1 && r.body.scores[0].name === 'Cee');
  r = await call(h, { method: 'GET', url: '/api/scores?diff=normal' });
  ok('normal leaderboard unaffected by the chill row', r.body.scores.every(s => s.diff === 'normal'));

  // ---- method + invalid diff fallback ----
  r = await call(h, { method: 'PUT', url: '/api/scores' });
  ok('PUT -> 405', r.statusCode === 405);
  r = await call(h, { method: 'POST', body: { name: 'D', score: 1, diff: 'hacker' } });
  ok('unknown diff falls back to normal', r.statusCode === 200);

  Module._load = origLoad;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
