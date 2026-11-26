// Garuda Skies — main loop: menu, playing, paused, crashed, complete.
// Written fresh from the prose spec. Wires the S1–S4 modules together:
// input -> flight -> missions -> aircraft -> render -> hud -> audio.
// Pitch convention is arcade: ArrowUp/W is nose up. input.js already maps
// it that way (pitch +1 = nose up, matching flight.js), so the input is
// passed to flight.update untouched — no inversion anywhere in this file.

import { MISSIONS, TUNING } from './config.js';
import { createRandom } from './random.js';
import { createInput } from './input.js';
import { buildWorld } from './world.js';
import { makeAircraft } from './aircraft.js';
import { createFlight } from './flight.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createRenderer } from './render.js';
import { createShots } from './shots.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function queryParams() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      return new URLSearchParams(window.location.search || '');
    }
  } catch (err) {
    // No window: defaults.
  }
  return new URLSearchParams('');
}

// ---- Boot: seed, world, plane, physics, missions, HUD, audio, render.
const params = queryParams();
const seedRaw = params.get('seed');
const seed = seedRaw !== null && seedRaw !== ''
  ? parseInt(seedRaw, 10) >>> 0
  : (Math.random() * 0x7fffffff) | 0;
const rng = createRandom(seed);

const canvas = document.getElementById('game');
const input = createInput(window);
const world = buildWorld(rng);
const aircraft = makeAircraft();
const flight = createFlight(world, aircraft);
const missions = createMissions(flight, world);
const hud = createHud(document);
const audio = createAudio();
const render = createRenderer(canvas, world);
render.scene.add(aircraft.group);
render.setAircraft(aircraft);

const state = {
  screen: 'menu', // menu | playing | paused | crashed | complete
  view: 'chase', // chase | cockpit
  seed,
  muted: false,
  shot: null,
  posed: false, // screenshot staging: plane stays posed, physics frozen
};

window.__flightGame = {
  flight,
  missions,
  world,
  state,
  render,
  aircraft,
  hud,
  audio,
  effects: render.effects,
};

// ---- Live score for the HUD: missions.score is only finalised on
// completion, so the running total is rebuilt from what was collected.
function liveScore() {
  if (missions.status === 'complete') return missions.score;
  const s = TUNING.scoring;
  return (
    missions.ringsPassed * s.ringPoints +
    missions.stormPassed * s.ringPoints +
    missions.checkpointsVisited * s.checkpointPoints
  );
}

function combinedHudState() {
  const fs = flight.state;
  // missions.targetMarker() reports `distance`; the HUD reads `dist` —
  // normalise here so the target line shows the real range.
  const tm = missions.targetMarker();
  // P8 — waypoint bearing: degrees from the nose to the next target,
  // -180..180 (0 = dead ahead). Heading is 0 = north (-z), 90 = east
  // (+x), so the target's absolute bearing is atan2(dx, -dz).
  let targetBearing = 0;
  if (tm && typeof tm.x === 'number' && typeof tm.z === 'number') {
    const dx = tm.x - fs.position.x;
    const dz = tm.z - fs.position.z;
    const absBearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    targetBearing =
      (((absBearing - (fs.heading || 0) + 540) % 360) + 360) % 360 - 180;
  }
  return {
    alt: fs.altitude,
    speed: fs.speed,
    heading: fs.heading,
    throttle: fs.throttle,
    fuel: fs.fuel,
    vspeed: fs.verticalSpeed,
    score: liveScore(),
    time: missions.elapsed,
    objective: missions.objectiveText(),
    target: tm
      ? { label: tm.label, dist: tm.distance, bearing: targetBearing }
      : null,
    stalled: fs.stalled,
    damage: fs.damage,
    wind: fs.wind,
    pitchDeg: fs.pitchDeg,
    bankDeg: fs.bankDeg,
  };
}

// ---- Flight events: missions owns the scoring handlers, so each one is
// wrapped (not replaced) to add the HUD message, the sound and the shake.
function wrapEvent(key, extra) {
  const prev = flight.onEvent[key];
  flight.onEvent[key] = function (info) {
    if (typeof prev === 'function') prev(info);
    if (typeof extra === 'function') extra(info);
  };
}

wrapEvent('onRing', (i) => {
  hud.showMessage('Ring ' + (i + 1) + '!  +250');
  audio.ring();
});
wrapEvent('onStormRing', (i) => {
  hud.showMessage('Storm ring ' + (i + 1) + '!  +250');
  audio.ring();
});
wrapEvent('onCheckpoint', (i) => {
  hud.showMessage('Checkpoint reached!  +400');
  audio.checkpoint();
});
wrapEvent('onFuelRing', () => {
  hud.showMessage('Fuel +30');
  audio.ring();
});
wrapEvent('onTouchdown', (info) => {
  audio.touchdown(!info.gentle);
  if (info.gentle) {
    hud.showMessage(info.inZone ? 'Smooth landing in the zone!' : 'Smooth landing!');
  } else {
    hud.showMessage('Hard landing!');
    render.shake(0.7);
  }
});
wrapEvent('onTerrainHit', (info) => {
  hud.showMessage('Terrain hit! Damage ' + Math.round(info.damage) + '%');
  audio.touchdown(true);
  render.shake(0.9);
});
wrapEvent('onCrash', (info) => {
  audio.crash();
  audio.engine(false);
  render.shake(1.2);
  // A crash outside an active mission (free flight) still ends the run.
  if (missions.status !== 'active') {
    setTimeout(() => {
      if (state.screen === 'playing') showEnd('Crashed', crashLines(info), 'crashed');
    }, 1200);
  }
});
wrapEvent('onStall', () => {
  hud.showMessage('STALL — nose down, add throttle!');
});

function crashLines(info) {
  return [
    'The plane is wrecked' + (info && info.reason ? ' (' + info.reason + ')' : '') + '.',
    'Score <b>' + liveScore() + '</b>',
    'Time ' + formatClock(missions.elapsed),
  ];
}

// ---- Mission end: banner first, then the end screen with the score.
missions.onComplete = (info) => {
  audio.success();
  audio.engine(false);
  hud.showBanner('Mission Complete!', info.mission.name + ' — Score ' + info.score);
  setTimeout(() => {
    if (state.screen !== 'playing') return;
    showEnd('Mission Complete', [
      info.mission.name + ' complete!',
      'Score <b>' + info.score + '</b>' + (info.newBest ? ' — new best!' : ''),
      'Time ' + formatClock(info.time) + '  ·  Best <b>' + info.best + '</b>',
    ], 'complete');
  }, 1800);
};

missions.onFail = (info) => {
  audio.engine(false);
  const why = info.reason === 'time' ? 'Time ran out.' : 'The plane crashed.';
  hud.showBanner('Mission Failed', why);
  setTimeout(() => {
    if (state.screen !== 'playing') return;
    showEnd('Mission Failed', [
      why,
      'Score <b>' + liveScore() + '</b>',
      'Time ' + formatClock(info.time),
      'Press R to retry.',
    ], 'crashed');
  }, 1800);
};

function showEnd(title, lines, screenName) {
  state.screen = screenName;
  hud.setEnd(title, lines);
  hud.setScreen(screenName);
}

// ---- View, screens and mission flow.
function setView(name) {
  state.view = name;
  render.setView(name);
  hud.setCockpit(name === 'cockpit');
}

function startMission(i) {
  const ok = missions.start(i);
  if (!ok) {
    hud.showMessage('Finish the previous mission to unlock this one.');
    return false;
  }
  audio.resume();
  audio.engine(true);
  setView('chase');
  render.snap();
  state.screen = 'playing';
  hud.setScreen('playing');
  return true;
}

function restartMission() {
  if (!missions.current) return false;
  const ok = missions.restart();
  if (!ok) return false;
  audio.resume();
  audio.engine(true);
  setView('chase');
  render.snap();
  state.screen = 'playing';
  hud.setScreen('playing');
  return true;
}

function toMenu() {
  state.screen = 'menu';
  state.posed = false;
  audio.engine(false);
  audio.setSpeed(0);
  audio.setWind(0);
  hud.setCockpit(false);
  flight.reset();
  setView('chase');
  hud.setScreen('menu');
  buildMenu();
}

function togglePause() {
  if (state.screen === 'playing') {
    state.screen = 'paused';
    audio.engine(false);
    audio.setSpeed(0);
    audio.setWind(0);
    hud.setScreen('paused');
  } else if (state.screen === 'paused') {
    state.screen = 'playing';
    audio.resume();
    audio.engine(true);
    hud.setScreen('playing');
  }
}

function toggleMute() {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  hud.showMessage(state.muted ? 'Muted' : 'Sound on');
}

// ---- Menu: one row per mission (locked until the previous is done),
// with the best score, plus the Free Flight button from index.html.
function buildMenu() {
  const list = document.getElementById('mission-list');
  if (!list) return;
  list.innerHTML = '';
  MISSIONS.forEach((def, i) => {
    const li = document.createElement('li');
    const unlocked = missions.isUnlocked(i);
    if (!unlocked) li.className = 'locked';
    const best = missions.bestScore(def.id);
    li.innerHTML =
      '<span class="num">' + (i + 1) + '.</span> ' +
      def.name + ' — ' + def.objective +
      (best > 0 ? ' <span class="lock">Best ' + best + '</span>' : '') +
      (unlocked ? '' : ' <span class="lock">🔒</span>');
    if (unlocked) {
      li.addEventListener('click', () => startMission(i));
    }
    list.appendChild(li);
  });
  const freeBtn = document.getElementById('btn-free');
  if (freeBtn) {
    freeBtn.onclick = () => startMission('free');
  }
}

const resumeBtn = document.getElementById('btn-resume');
if (resumeBtn) resumeBtn.addEventListener('click', togglePause);
const quitPauseBtn = document.getElementById('btn-quit-pause');
if (quitPauseBtn) quitPauseBtn.addEventListener('click', toMenu);
const retryBtn = document.getElementById('btn-retry');
if (retryBtn) retryBtn.addEventListener('click', restartMission);
const quitEndBtn = document.getElementById('btn-quit-end');
if (quitEndBtn) quitEndBtn.addEventListener('click', toMenu);

// ---- Screenshot staging: ?shot= poses the plane and freezes physics
// so the composition holds while the renderer keeps drawing frames.
const shots = createShots(render, flight, world, missions);
if (shots.shotName) {
  state.shot = shots.shotName;
  state.posed = true;
  state.screen = 'playing';
  hud.setScreen('playing');
  hud.setCockpit(shots.shotName === 'cockpit');
  if (shots.shotName !== 'cockpit') setView('chase');
} else {
  buildMenu();
  hud.setScreen('menu');
}

// ---- Main loop.
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  // One-shot keys, every frame, in every screen where they apply.
  if (input.takePressed('KeyM')) toggleMute();
  if (input.takePressed('KeyP') || input.takePressed('Escape')) togglePause();
  if (input.takePressed('KeyR')) {
    if (state.screen === 'playing' || state.screen === 'paused' ||
        state.screen === 'crashed' || state.screen === 'complete') {
      restartMission();
    }
  }
  if (input.takePressed('KeyC') && state.screen === 'playing' && !state.posed) {
    setView(state.view === 'cockpit' ? 'chase' : 'cockpit');
  }
  // Barrel roll: Q rolls left, E rolls right — one full 360-degree roll
  // while flying. flight.startBarrelRoll guards the rest (flying only,
  // one roll at a time, enough speed); a press mid-roll is ignored and
  // shows no message.
  if (input.takePressed('KeyQ') && state.screen === 'playing' && !state.posed) {
    if (flight.startBarrelRoll(-1)) hud.showMessage('Barrel Roll!');
  }
  if (input.takePressed('KeyE') && state.screen === 'playing' && !state.posed) {
    if (flight.startBarrelRoll(1)) hud.showMessage('Barrel Roll!');
  }

  // Mouse-look drag feeds the renderer (chase orbit / cockpit glance).
  const look = input.consumeLook();
  if (look.dx !== 0 || look.dy !== 0) render.addLook(look.dx, look.dy);

  if (state.screen === 'playing' && !state.posed) {
    // Arcade pitch: input.js already maps ArrowUp/W to nose up (+1),
    // the same sign flight.js expects — passed through untouched.
    flight.update(dt, input);
    missions.update(dt);
  } else if (state.screen === 'playing' && state.posed) {
    // Posed for a screenshot: propeller spins, plane never moves.
    aircraft.setThrottle(flight.state.throttle);
    aircraft.update(dt, { roll: 0, pitch: 0 });
  } else if (state.screen === 'menu') {
    // Parked on the runway behind the menu: idle propeller.
    aircraft.setThrottle(0);
    aircraft.update(dt, {});
  }

  render.update(dt, flight.state);

  if (state.screen === 'playing') {
    hud.update(combinedHudState());
    audio.setThrottle(flight.state.throttle);
    audio.setSpeed(flight.state.speed);
    // Inside a cloud the wind roars at full strength (inCloud 0..1
    // adds up to a 14 m/s wind equivalent — the wind gain saturates).
    audio.setWind(
      flight.state.wind + (render.effects ? render.effects.inCloud * 14 : 0)
    );
    // Engine load from the climb: climbing strains the engine (up to 1),
    // level cruise sits near 0.35, a descent unloads it toward 0.
    audio.setLoad(Math.max(0, Math.min(1, 0.35 + flight.state.verticalSpeed / 10)));
  }
}

requestAnimationFrame(frame);
