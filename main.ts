// Garuda Skies — entry builder.
// Reads MAKEFUN_OUTPUT_DIR (default '/output'), copies game/ and
// screenshots/ into it, then writes /output/dossier.json with buildDossier
// from the make.fun kit library. Runs as-is under `node main.ts`, no flags,
// no build step, Node standard library only.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const rootDir = new URL('.', import.meta.url).pathname;

mkdirSync(outDir, { recursive: true });

// Fresh copies: drop any stale game/ or screenshots/ from an earlier run.
rmSync(join(outDir, 'game'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
cpSync(join(rootDir, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(rootDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});

writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`Garuda Skies: wrote ${join(outDir, 'dossier.json')}`);
