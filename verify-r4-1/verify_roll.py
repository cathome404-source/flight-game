"""Headless verification for R4-1 barrel roll (Garuda Skies).

Headless Chromium here renders WebGL in software, so rAF advances game
time far slower than wall time. Sampling over wall time therefore cannot
track a 1.5 s roll. Instead: trigger the roll through the real keydown
path (main.js polls takePressed), then step flight.update() synchronously
in fixed 1/60 s steps inside one evaluate() and record the trace. That is
deterministic game time. The mid-roll screenshot is taken after stepping
the live flight to ~90 deg bank and letting the renderer present a frame.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/?seed=1"
OUT = "/home/hatch/workspace/makefun/flight-game-01/verify-r4-1"

SETUP_JS = """
() => {
  const g = window.__flightGame;
  g.flight.reset();
  g.state.screen = 'playing';
  const s = g.flight.state;
  s.status = 'flying';
  s.speed = 55;
  s.throttle = 0.6;
  s.position.y = 120;
  s.pitch = 0;
  s.roll = 0;
  s.yaw = -Math.PI / 2;
  g.flight.syncAircraft();
  return { speed: s.speed, status: s.status, bank: s.bankDeg,
           heading: s.heading, rolling: g.flight.isRolling() };
}
"""

STEP_TRACE_JS = """
() => {
  const g = window.__flightGame;
  const trace = [];
  for (let i = 0; i < 240; i++) {
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
    const s = g.flight.state;
    trace.push({ bank: +s.bankDeg.toFixed(2), speed: +s.speed.toFixed(2),
                 status: s.status, rolling: g.flight.isRolling(),
                 heading: +s.heading.toFixed(2) });
    if (!g.flight.isRolling() && i > 10) break;
  }
  return trace;
}
"""

STEP_TO_BANK_JS = """
(target) => {
  const g = window.__flightGame;
  for (let i = 0; i < 240; i++) {
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
    const b = g.flight.state.bankDeg;
    if (Math.abs(b) >= target) return { bank: +b.toFixed(1),
                                        rolling: g.flight.isRolling() };
  }
  return { bank: +g.flight.state.bankDeg.toFixed(1),
           rolling: g.flight.isRolling() };
}
"""


def hud_has_roll_message(page):
    return page.evaluate(
        "() => document.body.innerText.includes('Barrel Roll!')")


def check_trace(trace, pre, label):
    banks = [t["bank"] for t in trace]
    speeds = [t["speed"] for t in trace]
    statuses = set(t["status"] for t in trace)
    sweep = max(banks) - min(banks)
    final = trace[-1]
    print(f"[{label}] steps={len(trace)} bank range "
          f"[{min(banks):.1f}, {max(banks):.1f}] sweep={sweep:.1f} deg")
    print(f"[{label}] final: bank={final['bank']:.2f} status={final['status']} "
          f"speed={final['speed']:.1f} heading={final['heading']:.1f} "
          f"(pre heading {pre['heading']:.1f})")
    print(f"[{label}] speed: start {speeds[0]:.1f} min {min(speeds):.1f} "
          f"end {speeds[-1]:.1f}; statuses: {statuses}")
    ok = True
    if sweep < 330:
        print(f"[{label}] FAIL: sweep {sweep:.1f} < 330"); ok = False
    if abs(final["bank"] - pre["bank"]) > 8:
        print(f"[{label}] FAIL: final bank {final['bank']:.1f} not near "
              f"pre-roll {pre['bank']:.1f}"); ok = False
    if final["status"] != "flying":
        print(f"[{label}] FAIL: status {final['status']}"); ok = False
    if min(speeds) <= 28:
        print(f"[{label}] FAIL: speed dipped to {min(speeds):.1f} (stall 28)")
        ok = False
    if abs(final["heading"] - pre["heading"]) > 25:
        print(f"[{label}] FAIL: heading drifted "
              f"{final['heading'] - pre['heading']:.1f} deg"); ok = False
    print(f"[{label}] {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300]))
        page.goto(URL)
        page.wait_for_timeout(2500)

        for key, label in (("q", "left-Q"), ("e", "right-E")):
            pre = page.evaluate(SETUP_JS)
            print(f"[{label}] pre-roll: speed={pre['speed']:.1f} "
                  f"status={pre['status']} bank={pre['bank']:.1f} "
                  f"heading={pre['heading']:.1f}")
            page.keyboard.press(key)
            page.wait_for_timeout(300)
            print(f"[{label}] HUD 'Barrel Roll!' visible: "
                  f"{hud_has_roll_message(page)}")
            trace = page.evaluate(STEP_TRACE_JS)
            results[f"roll-{label}"] = check_trace(trace, pre, label)

        # Double-press during a roll is ignored (real key path): press Q,
        # wait a little wall time (game time barely advances), press Q
        # again, then step the trace — must be a single 0..-360 sweep.
        pre = page.evaluate(SETUP_JS)
        page.keyboard.press("q")
        page.wait_for_timeout(300)
        page.keyboard.press("q")
        page.wait_for_timeout(300)
        trace = page.evaluate(STEP_TRACE_JS)
        results["double-press-ignored"] = check_trace(
            trace, pre, "double-press")

        # Ground rejection via the API.
        ground = page.evaluate("""
        () => {
          const g = window.__flightGame;
          g.flight.reset();
          return { status: g.flight.state.status,
                   started: g.flight.startBarrelRoll(1),
                   rolling: g.flight.isRolling() };
        }""")
        print(f"[ground] status={ground['status']} started={ground['started']} "
              f"rolling={ground['rolling']}")
        results["ground-rejected"] = (
            ground["status"] == "onGround" and not ground["started"]
            and not ground["rolling"])
        print("[ground]", "PASS" if results["ground-rejected"] else "FAIL")

        # Mid-roll screenshot: trigger left roll, step live flight to
        # ~90 deg bank, let the renderer present, screenshot.
        pre = page.evaluate(SETUP_JS)
        page.keyboard.press("q")
        page.wait_for_timeout(300)
        at = page.evaluate(STEP_TO_BANK_JS, 90)
        print(f"[shot] stepped to bank={at['bank']} rolling={at['rolling']}")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/mid-roll-left.png")
        print("[shot] saved mid-roll-left.png")
        results["mid-roll-shot"] = abs(at["bank"]) >= 70 and at["rolling"]
        print("[shot]", "PASS" if results["mid-roll-shot"] else "FAIL")
        browser.close()
    print("RESULTS:", json.dumps(results))
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
