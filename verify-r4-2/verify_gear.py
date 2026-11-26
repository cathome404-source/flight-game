"""Headless verification for R4-2 retractable landing gear (Garuda Skies).

Headless Chromium renders WebGL in software, so rAF advances game time
far slower than wall time. Physics is therefore stepped synchronously in
fixed 1/60 s steps inside one evaluate() (deterministic game time), and
screenshots are taken after letting the renderer present a few frames.
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/?seed=1"
OUT = "/home/hatch/workspace/makefun/flight-game-01/verify-r4-2"

SETUP_FLYING_JS = """
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
  return { gearDown: s.gearDown, gearDeploy: s.gearDeploy,
           aircraftGear: g.aircraft.gear, status: s.status };
}
"""

# Step N fixed frames; optionally toggle gear first. Returns the trace of
# gearDeploy plus end state.
STEP_JS = """
({steps, toggle}) => {
  const g = window.__flightGame;
  if (toggle) g.flight.toggleGear();
  const trace = [];
  for (let i = 0; i < steps; i++) {
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
    trace.push(+g.flight.state.gearDeploy.toFixed(3));
    if (g.flight.state.status !== 'flying') break;
  }
  const s = g.flight.state;
  return { trace, gearDown: s.gearDown, gearDeploy: s.gearDeploy,
           aircraftGear: g.aircraft.gear, status: s.status,
           speed: +s.speed.toFixed(2), damage: s.damage };
}
"""

# Land on the runway from just above it with a gentle sink rate.
# gearUp: retract first (stepped), then reposition and descend.
# Pitch -6 deg: vy ~ -4.2 + ground effect ~+2.4 = ~-1.8 (gentle, <= 3).
LAND_JS = """
({gearUp}) => {
  const g = window.__flightGame;
  const s = g.flight.state;
  g.flight.reset();
  g.state.screen = 'playing';
  s.status = 'flying';
  s.speed = 40;
  s.throttle = 0.35;
  s.position.set(-220, 120, 560);
  s.pitch = 0; s.roll = 0; s.yaw = -Math.PI / 2;
  if (gearUp) {
    g.flight.toggleGear();
    for (let i = 0; i < 70; i++)
      g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
  }
  const deployBefore = s.gearDeploy;
  // Reposition just above the strip with a gentle nose-down attitude.
  s.position.set(-220, 4.7, 560);
  s.pitch = -6 * Math.PI / 180;
  s.speed = 40;
  let snap = null;
  for (let i = 0; i < 600; i++) {
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
    if (s.status !== 'flying' || s.damage > 0) {
      snap = { steps: i + 1, status: s.status, damage: s.damage,
               speed: +s.speed.toFixed(2), y: +s.position.y.toFixed(2),
               vs: +s.verticalSpeed.toFixed(2),
               msg: document.getElementById('hud-message').textContent };
      break;
    }
  }
  return { deployBefore: +deployBefore.toFixed(3),
           touchdown: snap, endStatus: s.status, endDamage: s.damage,
           gearDeploy: +s.gearDeploy.toFixed(3) };
}
"""

# Level-flight drag comparison: same throttle, settle 120 s game time.
DRAG_JS = """
({gearUp}) => {
  const g = window.__flightGame;
  const s = g.flight.state;
  g.flight.reset();
  g.state.screen = 'playing';
  s.status = 'flying';
  s.speed = 55;
  s.throttle = 0.3;
  s.position.set(-220, 200, 560);
  s.pitch = 0; s.roll = 0; s.yaw = -Math.PI / 2;
  s.fuel = 100;
  if (gearUp) {
    g.flight.toggleGear();
    for (let i = 0; i < 70; i++)
      g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
  }
  for (let i = 0; i < 7200; i++)
    g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
  return { speed: +s.speed.toFixed(2), status: s.status,
           alt: +s.position.y.toFixed(1), fuel: +s.fuel.toFixed(1),
           gearDeploy: +s.gearDeploy.toFixed(3) };
}
"""

HUD_GEAR_JS = """
(deploy) => {
  const g = window.__flightGame;
  const s = g.flight.state;
  g.hud.update({ alt: s.altitude, speed: s.speed, heading: s.heading,
    throttle: s.throttle, fuel: s.fuel, vspeed: s.verticalSpeed,
    score: 0, time: 0, objective: '', target: null, stalled: false,
    damage: 0, wind: 0, pitchDeg: 0, bankDeg: 0,
    gearDown: deploy >= 0.99, gearDeploy: deploy });
  const el = document.getElementById('hud-gear-value');
  return { text: el.textContent, color: el.style.color };
}
"""


def main():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300]))
        page.goto(URL)
        page.wait_for_timeout(2500)

        # --- 0. Gear starts DOWN on reset / mission start.
        pre = page.evaluate(SETUP_FLYING_JS)
        print(f"[start] gearDown={pre['gearDown']} deploy={pre['gearDeploy']} "
              f"aircraft.gear={pre['aircraftGear']} status={pre['status']}")
        results["starts-down"] = (
            pre["gearDown"] is True and pre["gearDeploy"] == 1
            and pre["aircraftGear"] == 1)
        print("[start]", "PASS" if results["starts-down"] else "FAIL")

        # --- 1a. Gear-down screenshot (chase view, flying).
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/gear-down.png")
        print("[shot] saved gear-down.png")

        # --- 1b. Toggle G in flight (real key path) -> retracts over ~1 s.
        # The live rAF loop also advances game time between the keypress
        # and the trace, so the trace only proves it reaches 0; the exact
        # 1.0 s timing is measured deterministically below (toggle in-page).
        page.keyboard.press("g")
        page.wait_for_timeout(300)
        up = page.evaluate(STEP_JS, {"steps": 90, "toggle": False})
        hud_after = page.evaluate(
            "() => document.getElementById('hud-gear-value').textContent")
        print(f"[retract] deploy 1 -> {up['gearDeploy']} "
              f"(key path); HUD after toggle: {hud_after!r}")
        results["retract-animates"] = (
            up["gearDeploy"] == 0 and hud_after == "GEAR UP")
        print("[retract]", "PASS" if results["retract-animates"] else "FAIL")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/gear-up.png")
        print("[shot] saved gear-up.png")

        # --- 1b2. Exact deploy time: toggle inside one synchronous
        # evaluate (no live-loop advance), 60 steps = 1.00 s at 1/60 s.
        timing = page.evaluate("""
        () => {
          const g = window.__flightGame;
          g.flight.reset();
          g.state.screen = 'playing';
          const s = g.flight.state;
          s.status = 'flying'; s.speed = 55; s.throttle = 0.6;
          s.position.y = 120; s.pitch = 0; s.roll = 0; s.yaw = -Math.PI / 2;
          g.flight.toggleGear();
          const tr = [];
          for (let i = 0; i < 90; i++) {
            g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
            tr.push(+s.gearDeploy.toFixed(3));
          }
          const firstZero = tr.findIndex(v => v === 0);
          g.flight.toggleGear();
          const tr2 = [];
          for (let i = 0; i < 90; i++) {
            g.flight.update(1 / 60, { pitch: 0, roll: 0, throttle: 0 });
            tr2.push(+s.gearDeploy.toFixed(3));
          }
          const firstOne = tr2.findIndex(v => v === 1);
          return { firstZero, firstOne, deploy: s.gearDeploy };
        }""")
        print(f"[timing] retract first 0 at step {timing['firstZero']} "
              f"(= {(timing['firstZero'] + 1) / 60:.3f} s), extend first 1 at "
              f"step {timing['firstOne']} (= {(timing['firstOne'] + 1) / 60:.3f} s)")
        results["deploy-time-1s"] = (
            timing["firstZero"] == 59 and timing["firstOne"] == 59)
        print("[timing]", "PASS" if results["deploy-time-1s"] else "FAIL")

        # --- 1d. HUD indicator states (direct hud.update with deploy values).
        hud_states = {}
        for deploy, want in ((1, "GEAR DOWN"), (0, "GEAR UP"), (0.5, "GEAR…")):
            got = page.evaluate(HUD_GEAR_JS, deploy)
            hud_states[deploy] = got
            print(f"[hud] deploy={deploy} -> {got['text']!r} color={got['color']}")
        results["hud-indicator"] = (
            hud_states[1]["text"] == "GEAR DOWN"
            and hud_states[0]["text"] == "GEAR UP"
            and hud_states[0.5]["text"] == "GEAR…")
        print("[hud]", "PASS" if results["hud-indicator"] else "FAIL")

        # --- 2. Belly landing: gear up, gentle vertical speed on runway.
        belly = page.evaluate(LAND_JS, {"gearUp": True})
        td = belly["touchdown"] or {}
        print(f"[belly] deployBefore={belly['deployBefore']} touchdown after "
              f"{td.get('steps')} steps: status={td.get('status')} "
              f"damage={td.get('damage')} vs={td.get('vs')} "
              f"msg={td.get('msg')!r}")
        results["belly-landing"] = (
            belly["deployBefore"] == 0 and td.get("damage") == 25
            and td.get("status") == "flying"
            and td.get("msg") == "Belly landing!")
        print("[belly]", "PASS" if results["belly-landing"] else "FAIL")

        # --- 3. Gentle gear-down landing: no damage, landed.
        gentle = page.evaluate(LAND_JS, {"gearUp": False})
        td2 = gentle["touchdown"] or {}
        print(f"[gentle] deployBefore={gentle['deployBefore']} touchdown after "
              f"{td2.get('steps')} steps: status={td2.get('status')} "
              f"damage={td2.get('damage')} vs={td2.get('vs')} "
              f"msg={td2.get('msg')!r}")
        results["gentle-landing"] = (
            gentle["deployBefore"] == 1 and td2.get("damage") == 0
            and td2.get("status") == "landed"
            and "Smooth landing" in (td2.get("msg") or ""))
        print("[gentle]", "PASS" if results["gentle-landing"] else "FAIL")

        # --- 4. Drag: gear-down level flight measurably slower, same throttle.
        spd_down = page.evaluate(DRAG_JS, {"gearUp": False})
        spd_up = page.evaluate(DRAG_JS, {"gearUp": True})
        print(f"[drag] gear-down settled {spd_down['speed']} m/s "
              f"(alt {spd_down['alt']} fuel {spd_down['fuel']})")
        print(f"[drag] gear-up   settled {spd_up['speed']} m/s "
              f"(alt {spd_up['alt']} fuel {spd_up['fuel']})")
        diff = spd_up["speed"] - spd_down["speed"]
        print(f"[drag] difference {diff:.2f} m/s")
        results["gear-drag"] = (
            spd_down["status"] == "flying" and spd_up["status"] == "flying"
            and diff > 3)
        print("[drag]", "PASS" if results["gear-drag"] else "FAIL")

        # --- 5. Toggle ignored on the ground and when crashed.
        ground = page.evaluate("""
        () => {
          const g = window.__flightGame;
          g.flight.reset();
          const onGround = g.flight.toggleGear();
          g.flight.crash('test');
          const crashed = g.flight.toggleGear();
          const s = g.flight.state;
          g.flight.reset();
          return { onGround, crashed, gearDown: s.gearDown,
                   deploy: s.gearDeploy };
        }""")
        print(f"[guards] onGround toggle={ground['onGround']} "
              f"crashed toggle={ground['crashed']} gearDown={ground['gearDown']} "
              f"deploy={ground['deploy']}")
        results["toggle-guards"] = (
            ground["onGround"] is False and ground["crashed"] is False
            and ground["gearDown"] is True and ground["deploy"] == 1)
        print("[guards]", "PASS" if results["toggle-guards"] else "FAIL")

        browser.close()
    print("RESULTS:", json.dumps(results))
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
