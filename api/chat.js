// api/chat.js — the Momo bot's brain for Motion Arcade.
//
//   POST /api/chat  { messages:[{role:'user'|'assistant', content}], page?:{url,title,context} }
//        -> { ok:true, reply:"..." }
//
// Calls an OpenAI-compatible LLM API SERVER-SIDE (default: Groq — free tier, very fast), so the key
// is NEVER exposed to visitors (same pattern as api/scores.js with DATABASE_URL). The bot knows the
// whole arcade via the SYSTEM_PROMPT below, so it answers "how do I play Sky Dash?" instantly.
//
// Provider is env-configurable (all OpenAI chat/completions compatible):
//  * Key:   GROQ_API_KEY  (also reads XAI_API_KEY / LLM_API_KEY for back-compat)
//  * URL:   LLM_API_URL   (default https://api.groq.com/openai/v1/chat/completions)
//  * Model: LLM_MODEL     (default llama-3.3-70b-versatile — a strong free Groq model)
//    To use xAI Grok instead: LLM_API_URL=https://api.x.ai/v1/chat/completions, LLM_MODEL=grok-4.5.
//
// Safety / cost:
//  * No key -> 503 {configured:false} so the client cleanly hides AI and the mascot still roams.
//  * Best-effort in-memory per-IP rate limit; message/history/context length-capped.

const API_KEY = process.env.GROQ_API_KEY || process.env.XAI_API_KEY || process.env.LLM_API_KEY || process.env.GROK_API_KEY || '';
const API_URL = process.env.LLM_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || process.env.XAI_MODEL || 'llama-3.3-70b-versatile';

const MAX_MSG_CHARS = 1200;      // per user message
const MAX_CONTEXT_CHARS = 4000;  // page context
const MAX_HISTORY = 8;           // last N turns kept
const MAX_TOKENS = 400;          // reply cap (short, friendly answers)

// --- soft per-IP rate limit (best-effort, module-scope, survives warm invocations) ---
const RL_WINDOW_MS = 60_000;
const RL_MAX = 12; // requests / IP / minute
const hits = global.__momoChatHits || (global.__momoChatHits = new Map());
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // crude memory bound
  return arr.length > RL_MAX;
}

const SYSTEM_PROMPT = `You are Momo, a friendly mascot guide living on **Motion Arcade** — a website of \
free, browser-based games you play with your BODY via your webcam (no downloads, no gamepad). You help \
visitors understand the site and the games, in a warm, upbeat, concise voice. Keep replies short \
(1-3 sentences), encouraging, and specific. If asked something unrelated to the site, gently steer back \
to the games. Never invent games that aren't listed below.

MOTION ARCADE — the games:
1. Body Dash — a 3-lane neon endless runner. Camera: step to change lane, jump to hop yellow barriers, \
crouch to slide under purple bars, throw a punch to smash orange crates, dodge pink walls, run in place \
to boost. Also playable on keyboard (arrows/WASD, Space, F, Shift) or touch (swipe/tap/hold BOOST). \
Pick Chill/Normal/Intense; there's a shared leaderboard.
2. Sky Dash — flap your ARMS like wings to fly a low-poly bird over terrain, collect 16 apples, dodge \
mountains/trees/rocks before a 90-second timer. Arms up = climb, tucked = dive; raise one hand to bank \
that way. Keyboard: Space/W flap, arrows to steer.
3. Pose Wall — a wall with a human-shaped hole slides at you; contort your body to MATCH the silhouette \
and fit through before it hits. Win at 20 walls; poses are directional (left arm up needs your left arm). \
Keyboard: number keys 1-8 pick a pose, Enter/Space commit.
4. Spell Caster — a battle-mage arena: lean left/right to strafe-dodge, crouch to duck, and DRAW glyphs \
in the air with your index finger to cast — line=Bolt, triangle=Fireball, circle=Shield, zigzag=Lightning. \
Clear 5 waves to win. Keyboard: A/D dodge, S duck, 1-4 cast.

Facts: All games run 100% in the browser; camera frames are processed locally and never uploaded. \
Camera needs a secure context (https/localhost) and downloads a small pose model on first use. Every \
game also has a full keyboard mode with no webcam. Most games start by holding a T-pose (or pressing \
Space/Enter). Scores save locally; Body Dash has a shared online leaderboard.

To start playing: on the home page click PLAY NOW / a game card, allow the camera (or use keyboard), and \
hold a T-pose to begin. Be helpful and get them into a game fast.`;

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(typeof req.body === 'string' ? safeParse(req.body) : req.body);
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20000) req.destroy();
    });
    req.on('end', () => resolve(safeParse(data)));
    req.on('error', () => resolve(null));
  });
}
function safeParse(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return null;
  }
}
function clip(s, n) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }
  if (!API_KEY) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, configured: false, error: 'AI not configured' }));
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (rateLimited(ip)) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ ok: false, error: 'Slow down a sec — too many messages.' }));
  }

  const body = await readBody(req);
  if (!body || !Array.isArray(body.messages)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'messages[] required' }));
  }

  // Build the chat payload: system + optional page context + last N sanitized turns.
  const turns = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: clip(m.content, MAX_MSG_CHARS) }));
  if (!turns.length) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'no valid message' }));
  }
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  const ctx = clip(body.page && body.page.context, MAX_CONTEXT_CHARS);
  if (ctx) messages.push({ role: 'system', content: `Context from the page the visitor is on:\n${ctx}` });
  messages.push(...turns);

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: MAX_TOKENS, temperature: 0.6, stream: false }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: 'AI upstream error', status: r.status, detail: detail.slice(0, 300) }));
    }
    const data = await r.json();
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, reply: reply.trim() || "Hmm, I blanked — ask me again?" }));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: 'AI request failed', detail: String(e && e.message).slice(0, 200) }));
  }
};
