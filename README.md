# 🏃 Body Dash — a webcam motion runner

A Subway-Surfers-style **3-lane endless runner that you control with your whole
body**. Your webcam tracks a full-body skeleton (MediaPipe Pose) and turns your
real movements into the game:

- **Step left / right** → your runner switches lane.
- **Jump in real life** → the runner hops over low barriers.
- **Run in place** → fills a boost bar for extra speed & score (your runner turns green).
- **Tall blocks can't be jumped** → you have to *dodge* them into another lane.
- **Start hands-free** → in the lobby, hold up a ✌️ **peace sign** for ~0.6s to begin
  (or just press the **▶ Start** button).

The camera panel (top-right) shows your live video with your **skeleton drawn on
you**, a **body box**, and **two lane-divider lines** with your current lane
highlighted — so you always know where you are and how to move.

Pure vanilla HTML/Canvas/JS. The only dependency is **MediaPipe Pose**, loaded
from a CDN, which does the real skeleton tracking.

---

## Requirements

- A **webcam**.
- A modern browser (**Chrome/Edge recommended**).
- **Internet on first load** — MediaPipe downloads two small models the first time
  (Pose for the body + Hands for the ✌️ start gesture); both are then browser-cached.
- A bit of **space**: stand back ~2–3 m so the camera can see you head-to-toe.

---

## Run it

Camera access is only allowed on a **secure context**, which includes
`http://localhost`. So serve the folder and open it via **localhost** (opening the
`index.html` file directly with `file://` will *not* get camera permission in most
browsers):

```bash
cd ~/Desktop/body-runner
python3 -m http.server 8000
```

Then open **http://localhost:8000** in Chrome, click **“ENABLE CAMERA”**, and
**allow the camera** when prompted. You land in a short lobby — flash a ✌️ **peace
sign** (hold it ~0.6s) or press **▶ Start** to begin.

> **Playing on a phone instead?** Phone browsers also require a secure context and
> block the camera over a plain `http://<ip>` address — you'd need HTTPS (a
> self-signed local certificate) or a tunnel. This build is set up for your
> **computer's webcam over localhost**, which needs no certificate.

### First-time setup for a good session
1. Prop your laptop/webcam so it can see your **whole body**, and step back until
   the camera panel shows the green box around all of you (status reads
   **“tracking ✓”**). If it says **“step back”**, move further away.
2. Good, even **lighting** in front of you helps tracking a lot.
3. Pick **Chill / Normal / Intense** and press play.

---

## How it works (the pose → game mapping)

Each webcam frame, MediaPipe returns 33 body landmarks. The game reduces them to a
few stable signals (all in `tests/logic.test.js`):

- **Lane** — the horizontal centre of your shoulders+hips (mirrored to match the
  selfie view) is split into thirds, with a **dead-zone (hysteresis)** around the
  boundaries so small wobbles don't flip lanes.
- **Jump** — a jump fires when your hips rise above an **auto-calibrated baseline**
  by more than a threshold that **scales with your torso size**, so it works
  whether you're close to or far from the camera.
- **Run boost** — vertical motion energy of your knees/ankles, normalised by torso
  length, fills the boost bar.

Difficulty (and each moment you survive) ramps the world speed and spawn rate.

---

## Tests

Pure logic, no dependencies:

```bash
node tests/logic.test.js      # lane hysteresis, adaptive jump threshold, run cadence, ✌️ detector
node tests/runtime.smoke.js   # boots the whole game in a DOM/pose shim and drives a
                              # full round (camera init → lane → jump → boost → crash)
```

---

## Tech notes

- One canvas (`#game`). The camera panel — mirrored video frame, skeleton, lane
  lines, labels, status — is **painted onto the main game canvas** so it always
  composites reliably; the `<video>` element is just a hidden frame source.
- Pseudo-3D road via a simple `focal / (focal + z)` projection; obstacles spawn at
  the horizon and grow as they approach.
- `localStorage` stores your best score; WebAudio blips with a mute toggle;
  `navigator.vibrate` on crash; `prefers-reduced-motion` respected.
- Everything is drawn procedurally — no image assets.

Made from scratch — original name, art and code.
