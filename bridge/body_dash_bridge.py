#!/usr/bin/env python3
"""
Body Dash -> real game bridge.

Watches your webcam, runs the SAME Body Dash body-tracking (MediaPipe Pose) and
gesture logic, and turns your moves into input for a real endless runner
(Subway Surfers etc.):

    step left / right  -> LEFT / RIGHT   (swipe / arrow)
    jump               -> UP
    duck / crouch      -> DOWN

Two output backends:
  --backend keys   press arrow keys (for an Android EMULATOR like BlueStacks/LDPlayer,
                   with its keymapping set so Up/Down/Left/Right = swipe up/down/left/right).
                   Also works for the web version if it accepts arrow keys.
  --backend adb    send `adb shell input swipe` to a real phone over USB
                   (enable USB debugging first; `adb devices` must list it).

A preview window shows your skeleton, the lane trigger lines and a live marker so
you can calibrate. Keys in that window:  c = recentre,  q = quit.

Run:  python3 body_dash_bridge.py --backend keys
"""

import argparse
import subprocess
import sys
import time

from gestures import (pick_lane_offset, lane_step, jump_threshold,
                      is_jump, is_duck, clamp, lerp)

# ----- heavy deps loaded lazily with a friendly message if missing -----
try:
    import cv2
    import mediapipe as mp
except ImportError:
    sys.exit(
        "\nMissing dependencies. Install them first:\n"
        "    pip install mediapipe opencv-python pynput\n"
        "(use a Python 3.9-3.12 virtualenv; MediaPipe wheels may not exist on 3.13+)\n"
    )


# ============================ output backends ============================
class PrintOutput:
    """No game needed: just prints what it *would* send. Great first test —
    checks the whole webcam -> pose -> gesture pipeline with zero permissions."""

    def send(self, action):
        arrow = {'left': '← LEFT', 'right': '→ RIGHT', 'up': '↑ JUMP', 'down': '↓ DUCK'}[action]
        print("  " + arrow, flush=True)

    def describe(self):
        return "console (test mode - prints actions, sends nothing)"


class KeyOutput:
    """Presses arrow keys (BlueStacks/LDPlayer keymapping, or an arrow-key web game)."""

    def __init__(self):
        try:
            from pynput.keyboard import Controller, Key
        except ImportError:
            sys.exit("Missing pynput. Install with:  pip install pynput")
        self.kb = Controller()
        self.keys = {'left': Key.left, 'right': Key.right, 'up': Key.up, 'down': Key.down}

    def send(self, action):
        k = self.keys[action]
        self.kb.press(k)
        self.kb.release(k)

    def describe(self):
        return "arrow keys (map Up/Down/Left/Right to swipes in your emulator)"


class AdbOutput:
    """Sends `adb shell input swipe` to a connected Android phone."""

    def __init__(self, duration=55, screen=None):
        self.d = duration
        w, h = screen if screen else self._detect_size()
        self.w, self.h = w, h
        self.cx, self.cy = w // 2, h // 2
        self.dx, self.dy = int(w * 0.28), int(h * 0.18)
        # keep one shell open -> far lower latency than a fresh `adb` per swipe
        try:
            self.proc = subprocess.Popen(
                ["adb", "shell"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, text=True)
        except FileNotFoundError:
            sys.exit("`adb` not found. Install Android platform-tools and ensure adb is on PATH.")

    def _detect_size(self):
        try:
            out = subprocess.check_output(["adb", "shell", "wm", "size"], text=True)
            # "Physical size: 1080x2400"
            wh = out.strip().split(":")[-1].strip().split("x")
            return int(wh[0]), int(wh[1])
        except Exception:
            print("Could not read screen size via adb; defaulting to 1080x2400.")
            return 1080, 2400

    def send(self, action):
        cx, cy = self.cx, self.cy
        moves = {
            'left':  (cx, cy, cx - self.dx, cy),
            'right': (cx, cy, cx + self.dx, cy),
            'up':    (cx, cy, cx, cy - self.dy),
            'down':  (cx, cy, cx, cy + self.dy),
        }
        x1, y1, x2, y2 = moves[action]
        try:
            self.proc.stdin.write(f"input swipe {x1} {y1} {x2} {y2} {self.d}\n")
            self.proc.stdin.flush()
        except Exception:
            subprocess.Popen(["adb", "shell", "input", "swipe",
                              str(x1), str(y1), str(x2), str(y2), str(self.d)])

    def describe(self):
        return f"adb swipes on a {self.w}x{self.h} phone"


# ============================ main loop ============================
L = {  # landmark indices we use (BlazePose)
    'sh_l': 11, 'sh_r': 12, 'hip_l': 23, 'hip_r': 24,
}
POSE_CONNECTIONS = [(11, 12), (11, 23), (12, 24), (23, 24), (11, 13), (13, 15),
                    (12, 14), (14, 16), (23, 25), (25, 27), (24, 26), (26, 28), (0, 11), (0, 12)]


def visible(lm, i, thr=0.5):
    return lm[i].visibility > thr


def main():
    ap = argparse.ArgumentParser(description="Body Dash -> real game bridge")
    ap.add_argument("--backend", choices=["print", "keys", "adb"], default="print",
                    help="print = test mode (no game); keys = emulator/web arrows; adb = real phone")
    ap.add_argument("--camera", type=int, default=0, help="webcam index")
    ap.add_argument("--screen", help="phone WxH for adb (else auto-detected), e.g. 1080x2400")
    ap.add_argument("--cooldown", type=float, default=0.35, help="min seconds between jump/duck")
    ap.add_argument("--sensitivity", type=float, default=1.0,
                    help=">1 = triggers fire more easily (scales the step & jump thresholds down)")
    ap.add_argument("--no-preview", action="store_true", help="hide the preview window")
    args = ap.parse_args()

    scr = None
    if args.screen:
        w, h = args.screen.lower().split("x")
        scr = (int(w), int(h))
    if args.backend == "adb":
        out = AdbOutput(screen=scr)
    elif args.backend == "keys":
        out = KeyOutput()
    else:
        out = PrintOutput()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        sys.exit(f"Could not open camera #{args.camera}. Try a different --camera index.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    pose = mp.solutions.pose.Pose(model_complexity=1, smooth_landmarks=True,
                                  min_detection_confidence=0.5, min_tracking_confidence=0.5)

    # ---- control state (mirrors the game) ----
    sens = clamp(args.sensitivity, 0.4, 2.5)
    body_x = 0.5
    base_x = None
    base_y = 0.5
    prev_y = 0.5
    cur_lane = 1
    jump_cd = 0.0
    duck_cd = 0.0
    warm_until = time.time() + 1.0  # ignore triggers for the first second (settle)
    last_t = time.time()

    print(f"\nBody Dash bridge running -> {out.describe()}")
    print("Stand back so your shoulders are clearly in view. Preview: c=recentre  q=quit.\n")

    while True:
        okf, frame = cap.read()
        if not okf:
            break
        now = time.time()
        dt = min(0.05, now - last_t)
        last_t = now
        jump_cd = max(0.0, jump_cd - dt)
        duck_cd = max(0.0, duck_cd - dt)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)
        disp = cv2.flip(frame, 1)  # mirror for a natural selfie view
        H, W = disp.shape[:2]
        status, seen = "step back - show your shoulders", False

        if res.pose_landmarks:
            lm = res.pose_landmarks.landmark
            if visible(lm, L['sh_l']) and visible(lm, L['sh_r']):
                seen = True
                sh_x = (lm[L['sh_l']].x + lm[L['sh_r']].x) / 2
                sh_y = (lm[L['sh_l']].y + lm[L['sh_r']].y) / 2
                shoulder_w = max(0.04, abs(lm[L['sh_l']].x - lm[L['sh_r']].x))
                mir_x = 1.0 - sh_x
                body_x = lerp(body_x, mir_x, 0.6)
                hips_ok = visible(lm, L['hip_l']) and visible(lm, L['hip_r'])
                anchor_y = (lm[L['hip_l']].y + lm[L['hip_r']].y) / 2 if hips_ok else sh_y
                torso = abs(anchor_y - sh_y) if hips_ok else shoulder_w * 1.6

                step = lane_step(shoulder_w) / sens
                if base_x is None:
                    base_x = body_x
                if cur_lane == 1:
                    base_x = lerp(base_x, body_x, 0.08)

                new_lane = pick_lane_offset(body_x - base_x, cur_lane, step, step * 0.35)
                if new_lane != cur_lane and now > warm_until:
                    d = new_lane - cur_lane
                    key = 'right' if d > 0 else 'left'
                    for _ in range(abs(d)):
                        out.send(key)
                    cur_lane = new_lane
                elif new_lane != cur_lane:
                    cur_lane = new_lane  # sync silently during warm-up

                grounded = jump_cd <= 0 and duck_cd <= 0
                th_torso = torso * sens
                if now > warm_until and grounded and is_jump(anchor_y, prev_y, base_y, th_torso):
                    out.send('up'); jump_cd = args.cooldown
                elif now > warm_until and grounded and is_duck(anchor_y, prev_y, base_y, th_torso):
                    out.send('down'); duck_cd = args.cooldown
                if grounded:
                    base_y = lerp(base_y, anchor_y, 0.06)
                prev_y = anchor_y
                status = ["LEFT", "CENTRE", "RIGHT"][cur_lane] + "  (tracking)"

                if not args.no_preview:
                    draw_overlay(disp, lm, W, H, base_x, step, body_x, cur_lane)

        if not args.no_preview:
            banner(disp, status, seen)
            cv2.imshow("Body Dash bridge  (c=recentre  q=quit)", disp)
            k = cv2.waitKey(1) & 0xFF
            if k == ord('q'):
                break
            if k == ord('c'):
                base_x = body_x  # recentre on your current stance

    cap.release()
    cv2.destroyAllWindows()


def draw_overlay(img, lm, W, H, base_x, step, body_x, cur_lane):
    def px(i):
        return int((1 - lm[i].x) * W), int(lm[i].y * H)
    # trigger lines at base_x +/- step (mirrored coords -> pixels)
    for bx in (base_x - step, base_x + step):
        x = int(clamp(bx, 0, 1) * W)
        for y in range(0, H, 16):
            cv2.line(img, (x, y), (x, y + 8), (255, 224, 94), 1)
    # skeleton
    for a, b in POSE_CONNECTIONS:
        if lm[a].visibility > 0.4 and lm[b].visibility > 0.4:
            cv2.line(img, px(a), px(b), (162, 93, 255), 3)
    for i in (0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28):
        cv2.circle(img, px(i), 4, (255, 224, 94), -1)
    # live body-position marker
    mx = int(clamp(body_x, 0, 1) * W)
    col = (255, 224, 94) if cur_lane == 1 else (160, 240, 62)
    cv2.line(img, (mx, 20), (mx, H - 40), col, 3)


def banner(img, text, seen):
    H, W = img.shape[:2]
    cv2.rectangle(img, (0, H - 34), (W, H), (20, 12, 8), -1)
    color = (159, 232, 201) if seen else (63, 211, 255)
    cv2.putText(img, text, (12, H - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)


if __name__ == "__main__":
    main()
