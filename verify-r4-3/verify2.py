import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
OUT = "/home/hatch/workspace/makefun/flight-game-01/verify-r4-3"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        for label, hour in [("morning-06", 6), ("midday-12", 12), ("night-22", 22)]:
            await page.goto(f"{BASE}/?shot=landing&seed=1&time={hour}")
            await page.wait_for_timeout(4000)
            clock = await page.evaluate("() => document.getElementById('hud-clock').textContent")
            gh = await page.evaluate("() => window.__flightGame.gameHour")
            print(label, "hud-clock:", clock, "gameHour:", gh)
            await page.screenshot(path=f"{OUT}/{label}.png")
        print("errors:", errors[:5])
        await browser.close()

asyncio.run(main())
