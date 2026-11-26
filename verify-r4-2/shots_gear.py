"""Gear up/down screenshots via the posed landing shot (?shot=landing).

The live-flight state/animation checks already passed in verify_gear.py;
these shots only need to prove the wheels are visibly present vs gone.
The posed shot frames the plane close in chase view with the HUD on.
Gear-up is set directly (setGear(0) + state) because posed mode freezes
physics — the animated travel itself is verified in verify_gear.py.
"""
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/?shot=landing&seed=1"
OUT = "/home/hatch/workspace/makefun/flight-game-01/verify-r4-2"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300]))
        page.goto(URL)
        page.wait_for_timeout(3000)
        # Side-below chase view (72 deg off the tail, slightly low) so the
        # main wheels read as full discs below the wing, not edge-on
        # slivers: addLook(-286, -115) -> lookYaw +1.25, lookPitch +0.5.
        page.evaluate(
            "() => { const g = window.__flightGame;"
            " g.render.addLook(-286, -115); g.render.snap(); }")
        page.wait_for_timeout(1500)
        state = page.evaluate(
            "() => ({ gearDown: window.__flightGame.flight.state.gearDown,"
            " deploy: window.__flightGame.flight.state.gearDeploy,"
            " aircraftGear: window.__flightGame.aircraft.gear,"
            " hud: document.getElementById('hud-gear-value').textContent })")
        print("[posed-down]", state)
        page.screenshot(path=f"{OUT}/gear-down.png")
        print("[shot] saved gear-down.png")

        page.evaluate(
            "() => { const g = window.__flightGame;"
            " g.flight.state.gearDown = false;"
            " g.flight.state.gearDeploy = 0; g.aircraft.setGear(0); }")
        page.wait_for_timeout(1500)
        state = page.evaluate(
            "() => ({ gearDown: window.__flightGame.flight.state.gearDown,"
            " deploy: window.__flightGame.flight.state.gearDeploy,"
            " aircraftGear: window.__flightGame.aircraft.gear,"
            " hud: document.getElementById('hud-gear-value').textContent })")
        print("[posed-up]", state)
        page.screenshot(path=f"{OUT}/gear-up.png")
        print("[shot] saved gear-up.png")
        browser.close()


if __name__ == "__main__":
    main()
