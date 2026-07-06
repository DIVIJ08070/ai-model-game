# 🕹️ Body Dash → real game bridge

Play a **real** endless runner (Subway Surfers, etc.) with the **same body controls**
as Body Dash. A browser tab can't send input to another app, so this is a small
**desktop program**: it reads your webcam, runs the same MediaPipe pose tracking +
gesture logic, and forwards your moves as **key presses or swipes** the game receives.

```
 step left / right  -> LEFT / RIGHT
 jump               -> UP
 duck / crouch      -> DOWN
```

The lane control is **edge-triggered** here (one swipe per step), which is what a
swipe game wants — not the "hold in a zone" style the web game uses.

---

## Install

Use a **Python 3.9–3.12** virtualenv (MediaPipe has no wheels for 3.13+ yet):

```bash
cd bridge
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

---

## Option A — Android emulator on your PC (easiest, lowest latency) ✅

1. Install **BlueStacks** (or LDPlayer) and Subway Surfers inside it.
2. Open the emulator's **keymapping / controls editor** and bind:
   - **↑ Up arrow → Swipe up**
   - **↓ Down arrow → Swipe down**
   - **← Left arrow → Swipe left**
   - **→ Right arrow → Swipe right**
   (Every emulator has this; it's usually one "swipe" control you drop on the screen
   and assign a key to a direction.)
3. Start the game so it's focused, then run:
   ```bash
   python3 body_dash_bridge.py --backend keys
   ```
4. Stand back until the preview shows your skeleton and says **tracking**, then move!

> `--backend keys` just presses arrow keys, so it also works with any **web** runner
> that accepts arrow keys — focus that browser tab before you start.

---

## Option B — a real phone over USB (ADB)

1. On the phone: **Settings → About phone → tap "Build number" 7×** to unlock
   **Developer options**, then turn on **USB debugging**.
2. Install Android **platform-tools** on the PC (gives you `adb`), plug in USB, and
   **authorize** the computer when the phone asks. Check it's connected:
   ```bash
   adb devices          # your phone should be listed
   ```
3. (Recommended) mirror the phone to your monitor so you can watch while standing
   back — install **scrcpy** and run `scrcpy`. Keep it running in the background.
4. Start Subway Surfers on the phone, then:
   ```bash
   python3 body_dash_bridge.py --backend adb
   ```
   The screen size is auto-detected; override with `--screen 1080x2400` if needed.

> ADB swipes have more latency than the emulator. The script keeps one `adb shell`
> open to cut that down, but at high game speed it can still feel laggy.

---

## Preview window & tuning

- In the preview: **`c`** = re-centre on your current stance, **`q`** = quit.
- The dashed lines are your **lane triggers**; the bright line is your body — step
  past a line to switch lane.
- Flags:
  - `--sensitivity 1.3` — higher = triggers fire more easily (lane + jump/duck).
  - `--cooldown 0.3` — min seconds between jumps/ducks.
  - `--camera 1` — pick a different webcam.
  - `--no-preview` — hide the window (slightly faster).

## Reality check

- Expect ~100–250 ms of total lag (camera → pose → input). Great for casual play,
  harder at very high speeds — start on slower stages.
- A misfire costs a run; tune `--sensitivity` to your room/lighting.
- The pure decision logic is unit-tested (`python3 test_gestures.py`) and is the
  same maths as the verified web game; only the *output* (keys/swipes) is new.
