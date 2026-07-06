"""Pure-logic tests for the bridge — mirror the web game's tests.
Run: python3 test_gestures.py    (no OpenCV/MediaPipe needed)"""
from gestures import (pick_lane_offset, lane_step, jump_threshold,
                      is_jump, is_duck)

passed = failed = 0


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -- " + detail if detail else ""))


print("Body Dash bridge -- gesture logic\n")

# lane: symmetric, self-centred, with hysteresis
ok("step left -> lane 0", pick_lane_offset(-0.12, 1) == 0)
ok("step right -> lane 2", pick_lane_offset(0.12, 1) == 2)
ok("left/right are symmetric", pick_lane_offset(-0.12, 1) == 0 and pick_lane_offset(0.12, 1) == 2)
ok("small drift holds centre", pick_lane_offset(-0.05, 1) == 1)
ok("returning past hysteresis re-centres", pick_lane_offset(-0.05, 0) == 1)
ok("still-out-there holds the side lane", pick_lane_offset(-0.09, 0) == 0)
# right-of-camera neutral still reaches left with the same step
bx = 0.62
ok("left reachable when standing right-of-centre", pick_lane_offset(0.50 - bx, 1) == 0)
ok("right reachable from the same neutral", pick_lane_offset(0.74 - bx, 1) == 2)

# lane step scales with body size, clamped
ok("step scales up when close", lane_step(0.30) > lane_step(0.12))
ok("step clamped low when far", lane_step(0.02) == 0.055)
ok("step clamped high when very close", lane_step(0.5) == 0.16)

# jump / duck thresholds & triggers
ok("threshold clamps low when close", jump_threshold(0.6) == 0.13)
ok("threshold clamps floor when far", jump_threshold(0.05) == 0.045)
t = 0.25  # threshold ~0.085
ok("rising body triggers a jump", is_jump(0.40, 0.46, 0.50, t))
ok("small bob does NOT jump", not is_jump(0.47, 0.49, 0.50, t))
ok("body moving down never jumps", not is_jump(0.40, 0.34, 0.50, t))
ok("dropping body triggers a duck", is_duck(0.62, 0.55, 0.50, t))
ok("small dip does NOT duck", not is_duck(0.55, 0.53, 0.50, t))
ok("body moving up never ducks", not is_duck(0.40, 0.46, 0.50, t))

print("\n%d passed, %d failed" % (passed, failed))
raise SystemExit(1 if failed else 0)
