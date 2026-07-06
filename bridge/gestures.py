"""
Pure gesture-decision logic for the Body Dash desktop bridge.

These functions are a 1:1 port of the ones in ../index.html (the web game),
so the feel is identical. They have NO heavy dependencies (no OpenCV/MediaPipe),
so they can be unit-tested on their own with plain `python3 test_gestures.py`.

All inputs are MediaPipe-style normalised coordinates in 0..1, where the
`x`/`y` values below are already MIRRORED (selfie view): mir_x = 1 - raw_x.
"""


def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def pick_lane_offset(off, cur, step=0.11, h=0.035):
    """Which lane (0=left,1=centre,2=right) your body sits in, measured as a
    signed offset from your own neutral centre, with a hysteresis band so small
    wobbles don't flip lanes."""
    if off <= -step:
        return 0
    if off >= step:
        return 2
    if -(step - h) < off < (step - h):
        return 1
    return cur


def lane_step(shoulder_w):
    """How far (in mirrored-x) you must move off centre to switch lane. Scales
    with shoulder width so one real side-step works whether near or far."""
    return clamp(shoulder_w * 0.7, 0.055, 0.16)


def jump_threshold(torso):
    """Adaptive vertical threshold for jump/duck, scaled by torso length."""
    return clamp(0.34 * torso, 0.045, 0.13)


def is_jump(cur_y, prev_y, base_y, torso):
    """Body rose above its baseline (smaller y) and is still rising."""
    th = jump_threshold(torso)
    return (base_y - cur_y) > th and cur_y < prev_y


def is_duck(cur_y, prev_y, base_y, torso):
    """Mirror of a jump: body dropped below its baseline (bigger y), still dropping."""
    th = jump_threshold(torso)
    return (cur_y - base_y) > th and cur_y > prev_y
