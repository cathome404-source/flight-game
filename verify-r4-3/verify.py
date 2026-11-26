import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
OUT = "/home/hatch/workspace/makefun/flight-game-01/verify-r4-3"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Shots at pinned hours via ?time=
        for label, hour in [("morning-06", 6), ("midday-12", 12), ("golden-17p5", 17.5), ("dusk-19", 19), ("night-22", 22)]:
            await page.goto(f"{BASE}/?shot=landing&seed=1&time={hour}")
            await page.wait_for_timeout(4000)
            info = await page.evaluate("() => ({h: window.__flightGame.render.getTimeOfDay(), n: window.__flightGame.render.getNightFactor(), shot: window.__flightGame.state.shot})")
            print(label, info)
            await page.screenshot(path=f"{OUT}/{label}.png")
        # Default shot (no ?time=) must pin golden hour
        await page.goto(f"{BASE}/?shot=landing&seed=1")
        await page.wait_for_timeout(3000)
        info = await page.evaluate("() => ({h: window.__flightGame.render.getTimeOfDay(), n: window.__flightGame.render.getNightFactor()})")
        print("default-shot", info)
        await page.screenshot(path=f"{OUT}/default-golden.png")
        # Clock advance: click first mission in the menu, watch gameHour move
        await page.goto(f"{BASE}/?seed=1")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => { document.querySelector('#mission-list li').click(); }")
        await page.wait_for_timeout(500)
        h0 = await page.evaluate("() => window.__flightGame.gameHour")
        await page.wait_for_timeout(4000)
        h1 = await page.evaluate("() => window.__flightGame.gameHour")
        clock = await page.evaluate("() => document.getElementById('hud-clock') && document.getElementById('hud-clock').textContent")
        print("clock advance", h0, "->", h1, "hud-clock:", clock)
        await page.screenshot(path=f"{OUT}/playing-clock.png")
        print("console errors:", errors[:10])
        await browser.close()

asyncio.run(main())
