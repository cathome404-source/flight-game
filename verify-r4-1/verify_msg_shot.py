"""Focused probe: HUD 'Barrel Roll!' message + a clean mid-roll screenshot.
Fixes vs the first harness: hud.setScreen('playing') so the menu overlay
is hidden, and render.update() is called synchronously after stepping so
the canvas shows the rolled plane instead of a stale frame.
"""
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
  g.hud.setScreen('playing');
  const s = g.flight.state;
  s.status = 'flying';
  s.speed = 55;
  s.throttle = 0.6;
  s.position.y = 120;
  s.pitch = 0;
  s.roll = 0;
  s.yaw = -Math.PI / 2;
  g.flight.syncAircraft();
  return true;
}
"""

MSG_JS = """
() => {
  const el = document.getElementById('hud-message');
  return { text: el ? el.textContent : null,
           display: el ? getComputedStyle(el).display : null,
           rolling: window.__flightGame.flight.isRolling() };
}
"""

STEP_RENDER_JS = """
(target) => {
  const g = window.__flightGame;
  for (let i = 0; i < 240; i++) {
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
    if (Math.abs(g.flight.state.bankDeg) >= target) break;
  }
  g.render.update(0.016, g.flight.state);
  const s = g.flight.state;
  return { bank: +s.bankDeg.toFixed(1), rolling: g.flight.isRolling() };
}
"""


def main():
    ok_msg = False
    ok_shot = False
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300]))
        page.goto(URL)
        page.wait_for_timeout(2500)
        page.evaluate(SETUP_JS)
        page.keyboard.press("q")
        # Poll the message element: rAF is slow under software GL, so
        # the keypress may take a second or two of wall time to be polled.
        for i in range(20):
            m = page.evaluate(MSG_JS)
            print(f"[msg] t={i * 0.25:.2f}s text={m['text']!r} "
                  f"display={m['display']} rolling={m['rolling']}")
            if m["text"] == "Barrel Roll!" and m["display"] == "block":
                ok_msg = True
                break
            time.sleep(0.25)
        print("[msg]", "PASS" if ok_msg else "FAIL")

        # Fresh setup, trigger again, step to ~90 deg, force a render,
        # screenshot immediately.
        page.evaluate(SETUP_JS)
        page.keyboard.press("q")
        time.sleep(1.0)
        at = page.evaluate(STEP_RENDER_JS, 90)
        print(f"[shot] bank={at['bank']} rolling={at['rolling']}")
        page.screenshot(path=f"{OUT}/mid-roll-left.png")
        ok_shot = abs(at["bank"]) >= 70 and at["rolling"]
        print("[shot]", "PASS" if ok_shot else "FAIL")
        browser.close()
    sys.exit(0 if (ok_msg and ok_shot) else 1)


if __name__ == "__main__":
    main()
