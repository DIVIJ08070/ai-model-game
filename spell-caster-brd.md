# Build Brief — "Spell Caster" (real-time 1v1 spell duel: lean to dodge, draw to cast)

> **For the coding agent:** Build a new game and add it to this existing Motion Arcade
> website. Work **on a new branch in THIS repo** (do not create a separate repo, do not
> commit to `main`). Open a PR when done. Everything below is the spec.
>
> **Headline feature: real-time online multiplayer.** Two players on **two different PCs**
> duel live over the internet — each dodges the other's spells with body-lean and casts by
> air-drawing glyphs. A solo **Practice mode** (vs AI) exists but the **live duel is the core**.

---

## 0. Context — the repo you're working in

This repo is a **static, zero-build website** (deployed on Vercel) that hosts multiple
webcam/motion-controlled browser games. Key existing files:

- `index.html` — the arcade homepage (cinematic hero + a "The Games" card grid).
- `game3d.html` — **Body Dash 3D**. Study this file first. It has most of the stack you must
  reuse: three.js + MediaPipe **Pose** + webcam PIP panel + `isTpose` T-pose gesture +
  `startGame()` single (re)start entry point.
- `body-dash-2d.html` — study for the **MediaPipe Hands** init, the `detectorFor(screen)`
  frame-routing pump, and the cyan-skeleton (`#5ee0ff`) + yellow-joint (`#ffd23f`) overlay.
- `pose-wall.html`, `sky-dash.html` — other 3D Pose games; good lobby/HUD references.
- `api/scores.js` + `db/schema.sql` — a Vercel **serverless + Postgres** pattern (via the `pg`
  dep, already installed). **You will reuse exactly this pattern for the multiplayer signaling
  endpoint** — no new server, no new npm deps.
- `tests/` — Node test scripts (`logic.test.js`, `runtime.smoke.js`, `api.test.js`).
- `package.json` — `npm test` runs all tests. No bundler, no framework.

**Golden rule:** the game itself must be **one self-contained static HTML file**
(`spell-caster.html`, like `game3d.html`) — everything inline, libraries from the exact CDNs
below, **no build step, no npm dependencies added, no framework.** The multiplayer networking
uses **native browser WebRTC** (no library) plus **one new serverless function** for signaling
that mirrors `api/scores.js` (uses the already-present `pg` dep — nothing new added).

**Naming / concept check (done):** `spell-caster.html`, `spell-caster-brd.md`, the card `href`,
and branch `game/spell-caster` don't collide with anything in the repo. The mechanic (torso-lean
dodge + finger-drawn glyph casting, **live 1v1**) is distinct from every current game (Body Dash
3D runner, Body Dash 2D, Sky Dash arm-flap flyer, Pose Wall pose-match).

## 1. The game

**Working title:** Spell Caster · **Filename:** `spell-caster.html` (repo root, so relative
asset paths resolve like `game3d.html`). *(Keep the name consistent across the file, the arcade
card, the signaling endpoint, and the tests.)*

A **real-time online spell duel** for **two players on two different PCs**. Each player stands
in front of their webcam as a battle-mage. You **lean your whole body** to dodge the spells your
opponent throws at you, and you **air-draw glyph shapes with your index finger** to cast spells
back at them. First mage reduced to 0 HP loses. A solo **Practice mode** (dodge/cast against AI
enemy waves) lets you warm up and is the camera-less/testable path — but the game is built
around the **live 1v1**.

### Modes
- **Duel (core):** create or join a room by short code; connect peer-to-peer; duel live.
- **Practice (solo):** the same controls against AI enemy waves (no network) — also used as the
  fully-headless test path and a warm-up.

### Core loop — Duel
1. **Lobby:** webcam PIP + fingertip/pose readout, plus **Create Room** / **Join Room** (enter a
   4–5 char code). See §5-Net for the connection flow.
2. **Connected → per-player prep:** each side runs the **tutorial** (first time) and a quick
   **calibration**, then signals **Ready** (T-pose). When both are ready, a synchronized
   **3-2-1 countdown** starts the match (see netcode handshake in §Net).
3. **Duel:** both mages face off across the arena. You **dodge** the opponent's incoming spells
   (lean/duck, §2) and **cast** spells at them by air-drawing glyphs (§2).
4. **Win/Lose:** first mage to 0 HP loses; the other wins. A **Rematch** (both T-pose) restarts;
   **Leave** returns to lobby. Handle opponent disconnect gracefully (see §Net).

### Core loop — Practice (solo)
Same lobby, choose **Practice** → tutorial/calibration → AI enemies spawn in waves, telegraph,
and fire projectiles you dodge while casting back. **Win:** clear the set waves (e.g. 5).
**Lose:** HP hits 0. **T-pose to restart.**

### First-run tutorial (interactive, skippable)
Before a player's first match (either mode), run a short **guided onboarding**. It **auto-shows
once** (persist a `spellcaster_tutorial_seen` flag in `localStorage`) and is always re-openable
from a **"?" / How-to-play** button in the lobby. Each step waits for the player to perform the
action (live skeleton/fingertip feedback) and advances on success; a **"Skip" button** (and
keyboard `S`) jumps to the lobby. Steps:
1. **Framing:** "Step back so we can see your torso and one hand." Advance when a Pose body **and**
   a Hand are detected for ~1s.
2. **Calibrate neutral:** "Stand relaxed and centered." Capture lean center + standing height
   (same calibration the match uses — §2).
3. **Dodge drill:** "Lean **left**… now **right**… now **duck**." A ghost projectile lobs each
   time; ✓ when dodged.
4. **Cast drill:** "Raise your index finger and **draw a line**" → practice **Bolt** at a dummy;
   then **triangle → Fireball**, **circle → Shield**. Show the glyph legend inline.
5. **Go:** "Strike a **T-pose** when you're ready." → signals Ready (duel) or `startGame()`
   (practice).

Keyboard-only players get the same tutorial with fallback keys, so it's fully drivable without a
camera.

## 2. Controls — pose + hand → dodge & cast (the heart of the game)

Two detectors at once: **MediaPipe Pose** for body lean/dodge and **MediaPipe Hands** for
fingertip glyph drawing. Route frames with a **`detectorFor`-style pump** like
`body-dash-2d.html`, but **alternate by frame during play** (even → Pose, odd → Hands) so each
runs ~15 fps. On `lobby`/`over` screens, send frames to **Pose only** so the T-pose gesture
works. All processing runs **locally in each player's browser** — camera frames are never
uploaded and are **never sent to the peer** (only tiny game-state messages are — see §Net).

**Dodge — MediaPipe Pose** (33 landmarks; shoulders **11/12**, hips **23/24**):
- **Lean left/right → strafe:** horizontal offset of shoulder midpoint (avg 11 & 12), or
  shoulder-vs-hip lean, vs a **calibrated center**. Map to continuous strafe (or 3 slots
  left/center/right) with **smoothing + dead-zone** so a resting stance = centered.
- **Duck → dodge high shots:** shoulder-height (avg 11/12 `y`) drop below a calibrated threshold.
- Short **calibration** at prep (stand neutral ~1s → capture center & standing height). Forgiving
  and readable; show what the body is doing on-screen.

**Cast — MediaPipe Hands** (21 landmarks, `maxNumHands:1`; index tip **8**, index PIP **6**,
index MCP **5**, thumb tip **4**, wrist **0**):
- **Arm the stroke:** "index extended" via tip **8** clearly above PIP **6** (`isIndexExtended`);
  optionally begin on **pinch** (thumb **4** ↔ index **8** close, `isPinch`) and end on release —
  document whichever feels cleaner.
- **Draw:** while armed, sample index-tip **8** each frame into a normalized point list.
- **Recognize → cast:** on stroke end, `recognizeGlyph(points)` classifies the normalized stroke
  by simple shape features (bbox aspect, corner count, closedness, net turning):
  - **line / slash → Bolt** (fast, low dmg)
  - **triangle → Fireball** (slow, high dmg)
  - **circle / loop → Shield** (blocks the **next** incoming spell)
  - **zigzag / V → Lightning** (fast, medium, hard to dodge)
  A recognized glyph casts at the opponent (duel) or nearest enemy (practice); an unrecognized
  stroke fizzles. Keep the library to 4 glyphs, thresholds forgiving.

**Keyboard fallback** (fully playable with **no camera**; drawing-by-key isn't feasible so spells
map to keys):
- `←`/`→` strafe-dodge, `↓` duck.
- `1` Bolt · `2` Fireball · `3` Shield · `4` Lightning (or `Space` = Bolt).
- `Enter` = Ready / start / rematch trigger in fallback mode.

## 3. World, mages, camera, UI

- **Arena:** low-poly ground + fog + a dark "mana" sky (procedural). Cheap and readable so
  projectiles pop.
- **Mages:** each player's avatar from **three.js primitives** (robed cylinder body + head sphere
  + glowing staff). **Your** mage front-and-center; the **opponent** mage stands downrange facing
  you. Both strafe/duck to mirror their player. **Procedural only — no model file.**
- **Opponent rendering:** drive the remote mage from the peer's `pos`/`duck` messages, **smoothly
  interpolated** between updates so it doesn't jitter at ~15 Hz.
- **Spells:** glowing procedural projectiles (emissive spheres/beams), colored per element;
  **Shield** = a translucent hemisphere in front of the mage. Your casts fly downrange at the
  opponent; their casts fly toward you — dodge those.
- **Practice enemies:** low-poly floating foes (icosahedron/cone) that telegraph then fire — only
  in Practice mode.
- **Camera:** third-person just behind/above your mage looking downrange, so incoming spells read
  with depth; smoothly follows your strafe.
- **Webcam panel:** small **raw mirrored PIP** `<video>` bottom-right (≈132×99,
  `transform:scaleX(-1)`, cyan border), like `game3d.html` (no full skeleton overlay needed in 3D).
- **Casting overlay (signature UI):** a transparent canvas showing the **fingertip cursor** and
  the **live glowing glyph stroke** as you draw, plus a flash of the recognized glyph name — arcade
  accent language (cyan `#5ee0ff` stroke, yellow `#ffd23f` cursor, confirm green `#3ef0a0`).
- **HUD:** **your HP bar + opponent HP bar** (both names/labels), the **room code**, a small
  **connection indicator** (connecting / connected / ping), wave counter (practice only), score,
  the **glyph legend**, and the last-cast readout.
- **Screens:** first-run **tutorial** (§1), **lobby** (Create/Join room + Practice + a "?"
  how-to-play button), **connecting** (room code + copyable share link + status), in-duel HUD, and
  a **result** screen (You Win / You Lose, both HP, Rematch = T-pose, Leave).

## Net — Multiplayer architecture (the core feature)

**Transport: native browser WebRTC `RTCPeerConnection` + one `RTCDataChannel`.** No library, no
game server — once connected the two PCs exchange game state **peer-to-peer**. Camera frames are
NEVER sent; only tiny JSON state messages.

**Signaling (how the two PCs find each other):** add **one serverless function `api/signal.js`**
that mirrors `api/scores.js` (same `pg` Postgres client, no new deps). It stores/returns the
WebRTC handshake blobs keyed by a **short room code**:
- Add a table to `db/schema.sql`, e.g. `signals(room text, role text, payload jsonb, updated_at
  timestamptz, primary key(room, role))`, with a TTL cleanup of rows older than a few minutes.
- `POST /api/signal` `{room, role:'host'|'guest', sdp?, candidates?}` upserts that side's offer/
  answer + ICE candidates. `GET /api/signal?room=..&role=host|guest` returns the **other** side's
  blob (short-poll every ~1s until the DataChannel opens). `Cache-Control: no-store` (vercel.json
  already sets this on `/api/(.*)`).
- **Host** = Create Room (generates code, creates offer, polls for the guest's answer + ICE).
  **Guest** = Join Room (enters code, fetches offer, replies with answer + ICE). After
  `datachannel.onopen`, **signaling is done** — gameplay is pure P2P.
- **ICE servers:** free public **STUN** (`stun:stun.l.google.com:19302`). **TURN caveat:** strict/
  symmetric NATs may fail to connect P2P without a TURN relay; make the TURN URL/creds an optional
  config (env or a constant) and, if unset, show a friendly "couldn't connect — you may need a
  TURN server / try another network" message. STUN-only works for most home networks. Don't block
  the PR on TURN.

**Authority model (keep it simple & fair):** each client is **authoritative over its own mage's
position and its own HP**. This avoids lag disputes — you always control your own dodge outcome.
- Each PC sends **`pos`** (`{t:'pos', x, duck}`) ~15 Hz from its own live Pose.
- On cast, the caster sends **`cast`** (`{t:'cast', id, spell, at}`, reliable). Both clients spawn
  the projectile visual and animate it toward the **target mage**.
- The **victim's** client simulates each incoming projectile against **its own live mage position**
  (`spellHits(...)`); on a hit it applies damage to **its own** HP and broadcasts **`hp`**
  (`{t:'hp', hp}`). The caster just renders the opponent HP from `hp` messages.
- **Shield**: the victim blocks the next incoming spell locally and sends **`block`**
  (`{t:'block', id}`) so the caster removes that projectile.
- **Handshake/flow messages:** `ready`, `start` (`{t:'start', at}` → synchronized countdown),
  `end` (`{t:'end', loser}`), `bye` (clean disconnect). Reconnect not required for v1; on peer
  loss show "Opponent left" and offer Leave/Rematch.
- Keep messages tiny JSON; interpolate remote `pos`; send `pos` unreliably-ordered if you split
  channels, but a single reliable-ordered channel at 15 Hz is fine for v1. Use `performance.now()`
  for timing.

## 4. Tech stack (reuse — do not introduce new frameworks)

- **three.js `0.160.0`** via the same importmap as `game3d.html`:
  ```html
  <script type="importmap">{"imports":{
    "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }}</script>
  ```
  (Geometry is procedural — `GLTFLoader`/`FBXLoader` available but not needed.)
- **MediaPipe Pose** — lazy-loaded like `game3d.html`:
  ```js
  const pose = new window.Pose({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`});
  pose.setOptions({modelComplexity:0,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
  pose.onResults(onPoseResults);
  ```
- **MediaPipe Hands** — like `body-dash-2d.html`:
  ```js
  const hands = new Hands({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`});
  hands.setOptions({maxNumHands:1,modelComplexity:0,minDetectionConfidence:0.6,minTrackingConfidence:0.5});
  hands.onResults(onHandResults);
  ```
  (from `https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js` + the pose tag. Tuning
  `setOptions` is allowed — not a new framework.)
- **WebRTC:** native `RTCPeerConnection` / `RTCDataChannel` — **no library.**
- **Signaling:** one new `api/signal.js` (Vercel serverless) reusing the existing `pg` dep + a
  new table in `db/schema.sql`. **No new npm deps.**
- Vanilla JS only; game logic all inline in `spell-caster.html`. **Do not introduce new
  frameworks.**

## 5. Integrate into the website  *(homepage read live — 4 Games Live, `New` badge on Pose Wall)*

1. **Add the featured game card** as the **FIRST child** of the `<div class="grid gap-6
   md:grid-cols-3">` in `index.html` (copy an existing card `<a class="…">` and swap: emoji **🪄**,
   title **Spell Caster**, `href="spell-caster.html"`, tag line `3D · Live 1v1 duel · Body +
   Hands`, description e.g. *"Duel a friend live on two PCs — lean to dodge their spells and draw
   glyphs in the air to cast your own."*). Give the **new card the single `New` badge** and
   **remove the `New` badge line from the Pose Wall card** (it currently holds it).
2. **Increment the hero stat** `Games Live` from **4 → 5** (the live value read from `index.html`;
   re-check if it changed).
3. **Back link:** add a small fixed **"← Arcade"** link (`href="/"`, top-left) inside
   `spell-caster.html`.
4. Match the arcade's dark/cinematic Tailwind + **"PODIUM Sharp"** style where cheap.
5. **Optional (follow-up, don't block PR):** save duel win/score via `POST /api/scores` like Body
   Dash.

## 6. Testing (match the repo's existing pattern)

- **`tests/spell-caster.logic.test.js`** (plain Node, no deps): copy the game's **pure** functions
  **verbatim** from `spell-caster.html`; assert deterministic input→output with a tiny
  `ok(name,cond,detail)` helper, ending `console.log(pass+' passed, '+fail+' failed');
  process.exit(fail?1:0)`. Cover at least:
  - `leanOffset(lm)` / `pickDodge(lean)`; `isDuck(lm)`; `isIndexExtended(hand)`; `isPinch(hand)`;
    `isTpose(lm)`.
  - `recognizeGlyph(points)` — canned **line→'bolt'**, **triangle→'fireball'**, **circle→'shield'**,
    **zigzag→'lightning'**, scribble→`null`.
  - **Netcode pure helpers:** `spellHits(mageX, duck, proj)` (geometry → bool),
    `applyHit(hp, spell)` (→ new hp), and message `encode/decode` round-trip (e.g.
    `decodeMsg(encodeMsg(m))` deep-equals `m` for each `t`).
- **`tests/spell-caster.smoke.js`** (Node `fs`+`vm`+`path`, modeled on `tests/runtime.smoke.js`):
  `fs.readFileSync` `spell-caster.html`, extract inline scripts via
  `[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]`, take the **last** non-empty
  one, append `;try{globalThis.__api={G:G};}catch(e){}`, run in a `vm.createContext` sandbox that
  shims the DOM (canvas `getContext` Proxy, `getBoundingClientRect`, `addEventListener`/`_fire`), a
  **fake webcam** (`getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})`), and **stub MediaPipe**
  `Pose` **and** `Hands`. Also stub `fetch` and `RTCPeerConnection`/`RTCDataChannel` so nothing
  hits the network. **Drive the fully-local PRACTICE mode** end-to-end: boot → enable camera →
  **step through (or Skip) the tutorial** → choose **Practice** → calibration → a **lean-dodge**
  pose + a **draw-glyph** cast that hits a practice enemy → **forced lose** (let AI spells hit until
  HP 0) → result screen → **T-pose restart** → keyboard fallback. **Any thrown error or
  `console.error` fails the run** (`process.exit(1)`).
- **`tests/spell-caster.net.test.js`** (plain Node): unit-test the P2P message handlers with a
  **loopback fake channel** — feed player A's `cast` into player B's message handler and assert B
  takes damage / emits `hp`, that `Shield` produces a `block` that cancels a projectile, and that
  the `ready`→`start` handshake reaches "countdown". No real WebRTC/network. (Live cross-PC
  connectivity is validated manually on the Vercel preview per §7.)
- **Wire all three** into the `test` script in `package.json` (append `&& node
  tests/spell-caster.logic.test.js && node tests/spell-caster.net.test.js && node
  tests/spell-caster.smoke.js`).
- `npm test` must be **green** before opening the PR.

## 7. Constraints / acceptance criteria

- ✅ One self-contained `spell-caster.html`, **no build step, no new npm deps** (WebRTC is native;
   signaling reuses the existing `pg` serverless pattern).
- ✅ **Two players on two different PCs can connect via a room code and duel live**, dodging each
   other's spells and casting in real time (validated on the Vercel preview across two devices).
- ✅ **Practice (solo) mode** works fully with no network / no second player.
- ✅ Graceful handling of connect failure (STUN/NAT message) and opponent disconnect ("Opponent
   left" → Leave/Rematch).
- ✅ Runs on desktop **and** mobile browsers; front-facing camera; secure-context friendly
   (WebRTC + getUserMedia both require HTTPS — Vercel provides it).
- ✅ Camera processing stays client-side; **only tiny game-state messages** cross the P2P channel —
   no video/frames.
- ✅ Playable with body + hand, **plus** a keyboard fallback for camera-less testing.
- ✅ First-run interactive **tutorial** (auto-shows once, skippable, reopenable from a "?" button).
- ✅ Reuses three.js `0.160.0` + MediaPipe Pose **and** Hands exactly as the reference files (only
   `setOptions` tuned) — no new frameworks.
- ✅ Linked from `index.html` as the featured card (`New` badge moved off Pose Wall, stat 4 → 5)
   and has a back-to-arcade link.
- ✅ `npm test` green (logic + net + smoke).
- ✅ Reasonable performance (aim ~30–60 fps; light geometry; Pose/Hands at `modelComplexity:0`;
   15 Hz netcode with interpolation).

## 8. Git workflow (IMPORTANT)

1. Branch from `main`: `git checkout -b game/spell-caster`
2. Build the game + signaling endpoint + tests; run `npm test` until green.
3. **Test the live duel on two devices** via the Vercel preview URL before finalizing.
4. Commit in logical chunks with clear messages.
5. Push the branch: `git push -u origin game/spell-caster`
6. Open a **PR into `main`** (`gh pr create`) with a short description + a testing checklist +
   the **Vercel preview URL**, noting the two-device duel test and the STUN/TURN caveat. **Do not
   merge to `main` yourself.**

Do **not** touch unrelated files, and keep the existing games working. New files you add:
`spell-caster.html`, `api/signal.js`, a `signals` table in `db/schema.sql`, and the three test
files above.
