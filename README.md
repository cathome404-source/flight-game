# Garuda Skies

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/cathome404-source/flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/cathome404-source/flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A low-poly 3D flight game set over a tropical island archipelago at golden hour.
Pilot a small single-propeller plane past beaches, palm trees and volcanic hills,
thread target rings, and bring her home gently on the coastal runway.

Built for the make.fun bounty
[best-flight-game-20261126-0057](https://make.fun/bounty/best-flight-game-20261126-0057).

## How to play

Open `game/index.html` in desktop Chrome. No build step, no network request —
every script, sound and image is a file under `game/`.

### Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Pitch and roll (bank to turn) |
| W / S or Shift / Ctrl | Throttle up / down |
| C | Toggle chase / cockpit camera |
| Mouse drag | Look around in chase view |
| R | Restart the current mission |
| P or Esc | Pause |
| M | Mute |

### Flying

Lift depends on airspeed: below the stall speed the nose drops and a stall
warning flashes — add throttle and lower the nose to recover. Turns tighten
with a steep bank at low speed and widen when fast and shallow, so turning
well is a skill. Fuel drains with throttle use; fly through green fuel rings
or land on the runway to refuel. A gentle touchdown is safe, a hard one
damages the plane, and 100% damage is a crash.

## Missions

Completing a mission unlocks the next. Free Flight is always available.

1. **Takeoff** — get airborne from the runway and climb past 100 m.
2. **Ring Run** — fly through 8 target rings in order around the islands.
3. **Island Tour** — visit 3 checkpoints over Merapi Kecil, Kelapa and Batu Karang.
4. **Precision Landing** — land gently inside the marked touchdown zone.
5. **Storm Run** — fly through 6 rings against the clock as the wind picks up.

## Tech

- Three.js r149, vendored as `game/vendor/three.min.js`.
- ES modules under `game/src/`, one clear job per file.
- Procedural WebAudio: engine hum, wind, ring chimes, touchdown thud, crash
  sound and a mission-complete jingle. No audio files.
- `main.ts` copies `game/` and `screenshots/` to the output directory and
  writes `dossier.json` with the make.fun kit's `buildDossier`.

## License

MIT — see [LICENSE](LICENSE).
