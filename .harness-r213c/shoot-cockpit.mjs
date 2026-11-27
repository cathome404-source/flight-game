// R2-13a cockpit-only harness (own code, adapted from .harness-r212h/shoot4.mjs).
// Usage: node shoot-cockpit.mjs [outdir] [waitMs]
// Shoots only 2-cockpit.jpg from shots.json. Seeded save: 2220 koin +
// Rajawali ENG2/TNK1/FLP0. Prints one JSON line: { name, bytes, consoleErrors }.
import { chromium } from '/home/hatch/workspace/nb3d-tools/node_modules/playwright-core/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const BASE = 'http://localhost:8080/index.html';
const SEED = `(() => { try {
  localStorage.setItem('garuda-skies-save-v1', JSON.stringify({
    coins: 2220, aircraft: 'rajawali', medals: [], best: {}, hull: 100,
    refits: { rajawali: { engine: 2, tank: 1, flaps: 0 } },
  }));
  localStorage.setItem('garuda-skies-unlocked', '11');
} catch (e) {} })();`;

const outDir = process.argv[2] || '.harness-r213c/shots';
const waitMs = parseInt(process.argv[3] || '15000', 10);
mkdirSync(outDir, { recursive: true });
const queries = JSON.parse(readFileSync('shots.json', 'utf8'))
  .filter((q) => q.name === '2-cockpit.jpg');

const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const q of queries) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.addInitScript(SEED);
  await page.goto(BASE + q.query, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__flightGame, null, { timeout: 120000 });
  await page.waitForTimeout(waitMs);
  const buf = await page.screenshot({ type: 'jpeg', quality: 82 });
  const out = outDir + '/' + q.name;
  writeFileSync(out, buf);
  console.log(JSON.stringify({ name: q.name, bytes: buf.length, consoleErrors: errors }));
  await page.close();
}
await browser.close();
