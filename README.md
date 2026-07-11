# 🏃 Body Dash — a neon motion runner

A 3-lane endless runner down a synthwave highway. Play it **three ways**:

- **📷 Camera** — your webcam tracks your whole body (MediaPipe Pose). Step to change
  lane, jump to hop, crouch to slide, throw a punch to smash crates, run in place to boost.
- **⌨ Keyboard** — arrow keys / WASD, Space, F, Shift.
- **☝ Touch** — swipe to move/jump/slide, tap to punch, hold BOOST.

Dodge **pink walls**, jump **yellow barriers**, slide under **purple bars**, punch **orange
crates**, grab coins, and climb the **leaderboard**. Pure vanilla HTML/Canvas/JS + a tiny
serverless leaderboard API. Original art and code — no sprites, no game engine.

---

## Controls

| Action | 📷 Camera | ⌨ Keyboard | ☝ Touch |
|---|---|---|---|
| Change lane | Step left / right | ◄ ► or A D | Swipe ◄ ► |
| Jump (yellow) | Jump up | ▲ / W / Space | Swipe up |
| Slide (purple) | Crouch down | ▼ / S | Swipe down |
| Punch (orange) | Throw a punch | F / J | Tap |
| Boost | Run in place | Hold Shift | Hold **BOOST** |
| Dodge (pink wall) | Step aside | ◄ ► | Swipe aside |
| Start / restart | ✌️ peace / 🧍 T‑pose | Space / Enter | Tap the button |

Pick **Chill / Normal / Intense** on the title screen. Difficulty is **provably fair** — a
corridor spawner guarantees every pattern is solvable (there's always a safe path, never two
actions at once, never a 2‑lane dodge) and a hard speed cap keeps the reaction budget humane.

---

## Run it locally

Camera access needs a **secure context** (localhost counts), so serve the folder:

```bash
cd ai-model-game
python3 -m http.server 8000
# open http://localhost:8000 in Chrome/Edge
```

The game is fully playable offline this way — keyboard/touch need nothing, camera downloads
the MediaPipe models once (needs internet the first time), and scores are saved locally. The
**shared leaderboard** only lights up once you deploy with a database (below).

---

## Deploy to Vercel (with a free leaderboard database)

The repo is Vercel‑ready: a static `index.html` plus a serverless function at
[`api/scores.js`](api/scores.js). It works with **any Postgres** — a free **Neon** database is
recommended. Until a DB is connected the game still works everywhere and shows an *"offline —
saved on this device"* leaderboard; connect the DB and it upgrades to a shared board.

**1 — Create a free Postgres (Neon):**
1. Sign in at **https://neon.tech** → **Create project** (pick a region near your users).
2. Open **Connection Details**, select **Pooled connection**, and copy the connection string
   (looks like `postgres://user:pass@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`).
   *(Supabase or Vercel Postgres work too — just copy their pooled connection string.)*

**2 — Deploy on Vercel:**
1. Push this repo to GitHub and, at **https://vercel.com**, **Add New → Project** → import
   `DIVIJ08070/ai-model-game`. Leave the **Root Directory** at the default (`./`) — `index.html`
   and `api/` are already at the repo root. Accept the defaults — no build step needed.
2. In the project: **Settings → Environment Variables → Add**
   - **Name:** `DATABASE_URL`  **Value:** your Neon connection string  **Environments:** all three.
3. **Redeploy** so the env var is baked in.

**3 — Verify:**
```bash
# a fresh DB auto-creates its table on first hit:
curl https://YOUR-APP.vercel.app/api/scores          # -> {"ok":true,"configured":true,"scores":[]}
curl -X POST https://YOUR-APP.vercel.app/api/scores \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","score":1234,"diff":"normal"}'  # -> {"ok":true,"rank":1,"best":1234}
```
If you see `{"configured":false}`, the `DATABASE_URL` env var is missing or misspelled.

**Leaderboard API** — `GET /api/scores?diff=normal&range=all|today` returns the top 20;
`POST /api/scores {name,score,diff,dist}` inserts and returns your rank. It uses a reused
connection pool, parameterized queries (no SQL injection), input validation/sanitization, and
returns a clean `503 {configured:false}` when no DB is set so the client falls back to
localStorage. Table schema: [`db/schema.sql`](db/schema.sql) (also auto-created lazily).

---

## How it works

- **Pose → intent** (camera): MediaPipe returns 33 body landmarks; the game reduces them to
  lane (shoulder centre vs. your calibrated neutral), jump/duck (vertical motion past an
  adaptive, per‑player threshold), punch (a fast raised wrist jab), and boost (leg motion). A
  quick **guided calibration** (stand still → jump → step → duck) personalises the thresholds.
- **Pseudo‑3D road** via a `focal/(focal+z)` projection; obstacles spawn at the horizon and
  grow as they approach.
- **Fair spawner** — a corridor state machine (ACTION / DODGE / FREE steps) guarantees a
  continuous survivable path; speed and spawn rate are capped so it never becomes impossible.
- **Character** — an original articulated runner drawn with 2‑bone inverse kinematics: a run
  cycle, jump/land squash‑spring, slide, punch, lane **banking**, a flowing scarf, boost
  afterimages, and a face that reacts to what you're doing.
- **Leaderboard** — client posts to `/api/scores`; degrades gracefully to local scores.

---

## 🦜 Sky Dash — a body-controlled flying game

Flap your **arms like wings** in front of the webcam to fly a procedural low-poly **bird** over
low-poly terrain, collecting **16 apples** and dodging the mountains, trees, and rocks before a
**90-second** timer runs out. The whole game is self-contained in
[`sky-dash.html`](sky-dash.html) — [three.js](https://threejs.org) **0.160.0** + MediaPipe Pose
loaded from a CDN, no build step. Camera frames are processed **entirely in your browser** —
nothing is uploaded. Your best score is saved locally (`localStorage["skydash_best"]`).

### Controls

| Action | 📷 Camera | ⌨ Keyboard |
|---|---|---|
| Flap (lift) | Wings down-stroke | Space / ▲ / W |
| Glide | Arms wide & level | (auto when level) |
| Climb / dive | Arms up = climb · arms tucked = dive | ▼ / S = dive |
| Bank right | Raise **left** / lower **right** hand (`raiseL > raiseR`) | ► / D |
| Bank left | Raise **right** / lower **left** hand | ◄ / A |
| Start / restart | 🧍 T‑pose (hold 0.6 s) | Space / Enter |

**Bank = lean into the turn:** raise your left hand / lower your right (`raiseL > raiseR`) and the
bird steers **► RIGHT**. The camera is optional — keyboard mode plays the full game (flight,
apples, timer, win / crash / time‑up) with no webcam.

### Run it locally

Camera access needs a **secure context** (localhost counts), so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000/sky-dash.html in Chrome/Edge
```

Keyboard mode needs nothing. Camera mode downloads the MediaPipe Pose model once (needs internet
the first time) and requires `localhost` or HTTPS.

---

## 🧱 Pose Wall — a body pose-matching "hole in the wall" game

A wall with a **human-shaped hole** cut into it slides toward you — **contort your body to match
the silhouette** and fit through the hole before the wall reaches you. Match well enough and you
pass through (**+1**, your streak grows, the wall shatters past); miss and you **lose a life** and
the wall bursts red. Walls come **faster** and poses get **harder** as your score climbs. **Win at
20 walls cleared**; **game over at 0 lives** (final score = walls cleared). The whole game is
self-contained in [`pose-wall.html`](pose-wall.html) — [three.js](https://threejs.org) **0.160.0**
+ MediaPipe Pose loaded from a CDN, no build step, built as an **Engine** (game logic) / **View**
(three.js) split. Camera frames are processed **entirely in your browser** — nothing is uploaded.
Your best score and best streak are saved locally (`localStorage["posewall_best"]` /
`["posewall_beststreak"]`).

### Controls

| Action | 📷 Camera | ⌨ Keyboard |
|---|---|---|
| Match the wall's shape | Contort to match the glowing silhouette — the **match %** meter fills **green** as you lock in | Number keys **1–8** commit the library poses |
| Lock it in | (auto at the impact plane) | **Enter / Space** commits the selected pose |
| Start / restart | 🧍 T‑pose (hold 0.6 s) | Enter / Space |

Poses are **directional** — a shape with your **left** arm up needs your **left** arm. The camera
view is mirrored, so it reads like a mirror. The camera is optional — keyboard mode plays the full
game (walls, lives, streak, win / game‑over) with no webcam.

### Run it locally

Camera access needs a **secure context** (localhost counts), so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000/pose-wall.html in Chrome/Edge
```

Keyboard mode needs nothing. Camera mode downloads the MediaPipe Pose model once (needs internet
the first time) and requires `localhost` or HTTPS.

---

## Tests

Pure logic + headless runtime + API, no browser or DB needed:

```bash
node tests/logic.test.js      # lane/jump/duck/punch signals, calibrated thresholds, detector routing
node tests/runtime.smoke.js   # boots the whole game in a DOM/pose shim; drives camera AND keyboard runs
node tests/api.test.js        # leaderboard handler with a mocked Postgres (validation, ranking, offline)
node tests/sky-dash.logic.test.js  # Sky Dash flight math: flap/glide/bank/pitch, collision, isTpose
node tests/sky-dash.smoke.js       # boots the Sky Dash engine in a DOM/pose shim; camera AND keyboard runs
node tests/pose-wall.logic.test.js # Pose Wall pose-match math: self-match, directional poses, isTpose, difficulty ramp
node tests/pose-wall.smoke.js      # boots the Pose Wall engine in a DOM/pose shim; camera + keyboard, win + game-over
# or: npm test
```

Made from scratch — original name, art and code.
