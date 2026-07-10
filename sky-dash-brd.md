# Build Brief — "Sky Dash" (body-controlled flying game)

> **For the coding agent:** Build a new game and add it to this existing Motion Arcade
> website. Work **on a new branch in THIS repo** (do not create a separate repo, do not
> commit to `main`). Open a PR when done. Everything below is the spec.

---

## 0. Context — the repo you're working in

This repo is a **static, zero-build website** (deployed on Vercel) that hosts multiple
webcam/motion-controlled browser games. Key existing files:

- `index.html` — the arcade homepage (cinematic hero + a "The Games" card grid).
- `game3d.html` — **Body Dash 3D**. Study this file first. It already contains the exact
  stack you must reuse: three.js + MediaPipe Pose + webcam panel + T-pose restart gesture.
- `body-dash-2d.html` — the older 2D game (MediaPipe Pose).
- `api/scores.js` — a Vercel serverless leaderboard (Postgres). Optional to use.
- `tests/` — Node test scripts (`logic.test.js`, `runtime.smoke.js`, `api.test.js`).
- `package.json` — `npm test` runs all tests. No bundler, no framework.

**Golden rule:** the new game must be **one self-contained static HTML file** (like
`game3d.html`) with everything inline, loading libraries from CDN. No build step, no npm
dependencies added, no framework.

## 1. The game

**Working title:** Sky Dash · **Filename:** `sky-dash.html` (repo root, so relative asset
paths resolve like `game3d.html`). *(Name is a placeholder — keep it consistent across the
file, the arcade card, and the tests.)*

A **body-controlled flying game**: the player flaps and tilts their **arms like wings** in
front of their webcam to make a low-poly **bird** fly over a 3D landscape, collecting apples
and dodging obstacles. Think "Body Dash, but airborne." Inspired by flap-to-fly pose games.

### Core loop
1. Lobby: show webcam + pose skeleton; player strikes the **start gesture** to begin
   (reuse the T-pose/peace-sign gesture pattern already in the codebase).
2. Bird auto-flies forward over low-poly terrain; a third-person camera trails behind/above.
3. Player controls flight **only with body movement** (see control mapping below).
4. Collect **16 apples** scattered through the world (HUD shows `0/16`).
5. Avoid crashing into the ground, mountains, trees, or rocks.
6. Run ends on: all apples collected (win), crash, or the timer running out.
7. **T-pose to restart** (reuse `isTpose(lm)` from `game3d.html`).

## 2. Controls — pose → flight (the heart of the game)

Use **MediaPipe Pose** exactly as `game3d.html` does (33 landmarks; key points: shoulders
11/12, elbows 13/14, wrists 15/16, hips 23/24). All control is derived from arm/torso pose.
Everything runs **locally in the browser** — no frames uploaded.

- **Flap → lift/thrust:** track vertical velocity of both wrists relative to shoulders. A
  fast **downstroke** (wrists moving down) gives an upward impulse (like real wing flap).
  Bigger/faster flap = bigger lift. No flapping = gentle descent (gravity).
- **Glide:** arms held out wide near shoulder height = stable glide, slow descent, keeps
  forward speed. Reward smooth gliding.
- **Bank / turn:** arm asymmetry or torso lean. Left wrist higher than right → bank/turn
  one way; right higher → the other. Map the height difference (and/or shoulder-line tilt)
  to a turn rate. Pick whichever direction feels intuitive and document it.
- **Pitch (climb/dive):** average wrist height vs shoulders — arms up = climb (slower),
  arms tucked/low = dive (faster, loses altitude).
- Keep it **forgiving and readable**: smooth/damp the signals, show clear on-screen feedback
  of what the body is doing. Add a short calibration or dead-zone so a resting pose = level
  flight. Prioritise "feels good and controllable" over realism.

Also support a **keyboard fallback** for testing without a camera (arrows/space), mirroring
how the existing games degrade gracefully.

## 3. World, bird, camera, UI

- **World:** low-poly terrain with hills/mountains, scattered trees/rocks, a simple sky.
  Floating **apple** collectibles with a subtle glow/spin. Keep poly counts low for mobile.
- **Bird:** a low-poly bird built from three.js primitives (body + two wings). Animate the
  wings to match the player's flapping. (Procedural is preferred over shipping a big model;
  if you add a model file keep it small, < ~1 MB.)
- **Camera:** third-person, trailing behind and slightly above the bird, smoothly following.
- **Webcam panel:** small live preview with the **cyan skeleton + yellow joint** overlay,
  same visual language as `game3d.html` / `body-dash-2d.html`.
- **HUD:** apple counter `0/16`, a timer, and a simple speed/altitude indicator.
- **Screens:** start lobby (gesture to begin), in-game HUD, game-over/win screen with score
  and a T-pose-to-restart prompt.

## 4. Tech stack (reuse — do not introduce new frameworks)

- **three.js `0.160.0`** via the same importmap approach as `game3d.html`
  (`three.module.js` + `examples/jsm/`).
- **MediaPipe Pose** via `https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js`, loaded the
  same way `game3d.html` does (`new window.Pose({locateFile: ...})`).
- Vanilla JS only. Everything inline in `sky-dash.html`.

## 5. Integrate into the website

1. **Add a game card** to the "The Games" grid in `index.html` — copy an existing `<a
   class="card ...">` card and set: emoji 🦜 (or 🕊️), title **Sky Dash**, `href="sky-dash.html"`,
   a **"New"** badge, tags like `3D · Flight · Full-body`, and a one-line description. Make
   Sky Dash the featured/new game (you can drop the "New" badge on Body Dash 3D).
2. **Back link:** add a small fixed **"← Arcade"** link (top-left) inside `sky-dash.html`
   that goes to `/`, so players can return home. *(Nice-to-have: add the same to
   `game3d.html` and `body-dash-2d.html` for consistency.)*
3. Match the arcade's dark/cinematic visual style (fonts, colors) where it's cheap to do so.
4. **Optional (can be a follow-up):** save high scores via the existing `POST /api/scores`
   the way Body Dash does. Don't block the PR on this.

## 6. Testing (match the repo's existing pattern)

- Add a **logic test** for the pure control math (flap-impulse, bank/turn, pitch mapping) —
  pure functions with deterministic inputs → expected outputs, like `tests/logic.test.js`.
- Add a **runtime smoke test** modeled on `tests/runtime.smoke.js`: shim the DOM, a fake
  `getUserMedia`, and a stub MediaPipe `Pose`, then drive boot → start gesture → a few flap
  poses → collect an apple → game over, asserting no thrown errors / `console.error`.
- Wire the new smoke test into the `test` script in `package.json`.
- `npm test` must pass before opening the PR.

## 7. Constraints / acceptance criteria

- ✅ One self-contained `sky-dash.html`, no build step, no new npm deps.
- ✅ Runs on desktop **and** mobile browsers; front-facing camera; secure-context friendly.
- ✅ Camera processing stays client-side; nothing uploaded.
- ✅ Playable with body only, plus a keyboard fallback for camera-less testing.
- ✅ Reuses three.js 0.160.0 + MediaPipe Pose exactly as `game3d.html`.
- ✅ Linked from `index.html` and has a back-to-arcade link.
- ✅ `npm test` green.
- ✅ Reasonable performance (aim ~30–60 fps; keep geometry light).

## 8. Git workflow (IMPORTANT)

1. Branch from `main`: `git checkout -b game/sky-dash`
2. Build the game + tests; run `npm test` until green.
3. Commit in logical chunks with clear messages.
4. Push the branch: `git push -u origin game/sky-dash`
5. Open a **PR into `main`** (`gh pr create`) with a short description and a testing
   checklist. **Do not merge to `main` yourself.**
6. In the PR, note that Vercel will publish a **preview deployment** — include the preview
   URL if available so it can be tested on a phone before merge.

Do **not** touch unrelated files, and keep the existing games working.
