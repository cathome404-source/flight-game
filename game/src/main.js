// Garuda Skies — main loop: menu, playing, paused, crashed, complete.
// Written fresh from the prose spec. Wires the S1–S4 modules together:
// input -> flight -> missions -> aircraft -> render -> hud -> audio.
// Pitch convention is arcade: ArrowUp/W is nose up. input.js already maps
// it that way (pitch +1 = nose up, matching flight.js), so the input is
// passed to flight.update untouched — no inversion anywhere in this file.

import { TUNING, WORLD } from './config.js';
import { createCampaign, missionIndexForSortie, selectedAircraftId } from './campaign.js';
import { createHangar } from './hangar.js';
import { createRandom } from './random.js';
import { createInput } from './input.js';
import { buildWorld, reliefHeightAt } from './world.js';
import { initGrass } from './grass.js';
import { initTrees } from './trees.js';
import { makeAircraft } from './aircraft.js';
import { createFlight } from './flight.js';
import { createMissions } from './missions.js';
import { createWeapons } from './weapons.js';
import { createHud, gradeTouchdown, medalForGrade, crashCauses } from './hud.js';
import { createAudio } from './audio.js';
import { createRenderer } from './render.js';
import { createShots } from './shots.js';
import { refitLevels } from './store.js';

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
let aircraft = makeAircraft(selectedAircraftId());
const flight = createFlight(world, aircraft);
const missions = createMissions(flight, world);
const campaign = createCampaign(missions);
const hud = createHud(document);
const audio = createAudio();
const render = createRenderer(canvas, world);
render.scene.add(aircraft.group);
render.setAircraft(aircraft);

// R2-14g: wire the R2-14 vegetation modules. Both plant on the
// VISIBLE relief surface (world.js reliefHeightAt — ridged +
// terraced, R2-14b), not the smooth physics cone, so blades and
// trees sit on the ground the camera actually sees. Grass sways
// via grass.update(dt) in the frame loop below; trees are static.
const grass = initGrass(render.scene, { heightAt: reliefHeightAt });
const trees = initTrees(render.scene, {
  islands: WORLD.islands,
  heightAt: reliefHeightAt,
  runway: WORLD.runway,
});

// R2-11c combat: Space fires a tracer at drone pengintai in sorties
// 6 (chase) and 12 (boss). A drone takes 2 hits; dropping one scores
// +300 through missions.droneDown(), flashes an effects burst and
// shakes the camera a touch. No drones anywhere else.
const weapons = createWeapons(render.scene, flight, {
  onDroneDown: (drone, points) => {
    missions.droneDown();
    hud.showMessage('Drone pengintai jatuh!  +' + points);
    audio.ring();
    render.shake(0.3);
  },
  onBurst: (pos) => {
    if (render.effects && typeof render.effects.burst === 'function') {
      render.effects.burst(pos);
    }
  },
});

// ---- Hangar: pick the aircraft. Swapping rebuilds the 3D model, retunes
// the flight model from the new plane's stats, resets the parked plane
// (full tank of the new size) and persists the choice in the save.
const hangar = createHangar({
  document,
  campaign,
  onSelect: selectAircraft,
  fuelPercent: () => (flight.state.fuel / (flight.state.fuelCapacity || 100)) * 100,
  onRefit: (track) => {
    const paid = campaign.buyRefit(track);
    if (paid === null) {
      hud.showMessage('Tidak bisa beli — koin kurang atau sudah MAX.');
      return;
    }
    flight.setRefits(refitLevels(campaign.save.refits, campaign.aircraft));
    flight.reset();
    hud.showMessage('Refit dibeli! −' + paid + ' koin.');
    if (hangar) hangar.refresh();
  },
  onRepair: () => {
    const res = campaign.repair();
    if (res.restored > 0) {
      hud.showMessage('Lambung diperbaiki +' + res.restored + '% (−' + res.cost + ' koin).');
    }
    if (hangar) hangar.refresh();
  },
  onRefuel: () => {
    flight.refuel();
    hud.showMessage('Tangki penuh — gratis di hangar.');
    if (hangar) hangar.refresh();
  },
});

// Refit levels + hull from the save, applied to the flight model at
// boot (before the first frame): a bought engine actually flies faster.
flight.setRefits(refitLevels(campaign.save.refits, campaign.aircraft));
flight.setHull(campaign.hull);

function selectAircraft(id) {
  if (!campaign.setAircraft(id)) {
    if (hangar) hangar.refresh();
    return false;
  }
  render.scene.remove(aircraft.group);
  aircraft = makeAircraft(id);
  render.scene.add(aircraft.group);
  render.setAircraft(aircraft);
  window.__flightGame.aircraft = aircraft;
  flight.setAircraft(aircraft);
  flight.setRefits(refitLevels(campaign.save.refits, id));
  flight.setHull(campaign.hull);
  flight.reset();
  render.snap();
  if (hangar) hangar.refresh();
  return true;
}

function openHangar() {
  const menuEl = document.getElementById('screen-menu');
  if (menuEl) menuEl.classList.remove('on');
  if (hangar) hangar.show();
  render.snap();
}

function closeHangar() {
  if (hangar) hangar.hide();
  buildMenu();
  const menuEl = document.getElementById('screen-menu');
  if (menuEl) menuEl.classList.add('on');
}

const hangarBtn = document.getElementById('btn-hangar');
if (hangarBtn) hangarBtn.addEventListener('click', openHangar);
const hangarCloseBtn = document.getElementById('btn-hangar-close');
if (hangarCloseBtn) hangarCloseBtn.addEventListener('click', closeHangar);

const state = {
  screen: 'menu', // menu | playing | paused | crashed | complete
  view: 'chase', // chase | cockpit | deck
  seed,
  muted: false,
  shot: null,
  posed: false, // screenshot staging: plane stays posed, physics frozen
};

// ---- R2-5b approach trace: height vs distance to the touchdown
// zone, sampled ~4x per second while playing, last ~60 s. The
// debrief draws the flown path against the ideal 3-degree glide.
// Declared before window.__flightGame below, which exposes the
// recorder — a const declared after it would throw a TDZ error.
const TRACE_MAX = 240;
const trace = [];
let traceAccum = 0;
function recordTraceSample() {
  const fs = flight.state;
  if (!fs || !fs.position) return;
  const rw = WORLD.runway;
  const cx = (rw.touchdownZoneStart + rw.touchdownZoneEnd) / 2;
  const dx = fs.position.x - cx;
  const dz = fs.position.z - rw.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 2500) return;
  const h = Math.max(0, fs.position.y - WORLD.runwayAltitude);
  trace.push({ d: Math.round(d), h: Math.round(h * 10) / 10 });
  if (trace.length > TRACE_MAX) trace.shift();
}
function resetTrace() {
  trace.length = 0;
  traceAccum = 0;
}

// Last crash snapshot from the flight event (free-flight path, where
// missions may not be active). Missions keeps its own copy too.
let lastCrashInfo = null;

// Build the debrief payload for the end screen from what missions and
// flight recorded: approach trace, touchdown grade, score breakdown,
// crash causes. Called from showEnd, AFTER the hull is banked, so the
// hull figure in the debrief is the post-sortie one.
function buildDebrief(kind) {
  const td = missions.touchdown ? gradeTouchdown(missions.touchdown) : null;
  const data = {
    kind,
    trace: trace.slice(),
    touchdown: td,
    grade: td ? td.grade : null,
    medal: null,
    medalNew: false,
    breakdown: missions.breakdown || null,
    causes: null,
    hull: campaign.hull,
  };
  if (kind === 'crashed') {
    const info = missions.crashInfo || lastCrashInfo;
    data.causes = crashCauses(
      info,
      missions.touchdown,
      flight.stallSpeed ? flight.stallSpeed() : 28
    );
  }
  if (kind === 'complete' && td) {
    const medal = medalForGrade(td.grade);
    if (medal) {
      data.medal = medal;
      data.medalNew = campaign.awardMedal({
        ...medal,
        sortie: missions.current ? missions.current.id : null,
      });
    }
  }
  return data;
}

window.__flightGame = {
  flight,
  missions,
  campaign,
  world,
  state,
  render,
  aircraft,
  hud,
  audio,
  hangar,
  weapons,
  selectAircraft,
  effects: render.effects,
  // R2-5b test hooks: the approach-trace recorder and its samples, so
  // a fast-forwarded play-through records the same trace real play does.
  recordTrace: recordTraceSample,
  trace,
  // Day-night clock (hours, 0..24) — headless tests drive it here.
  get gameHour() {
    return gameHour;
  },
  set gameHour(h) {
    gameHour = ((h % 24) + 24) % 24;
    render.setTimeOfDay(gameHour);
  },
};

// ---- Day-night clock (R4-3): starts at golden hour (the menu look),
// advances with play time — one full cycle per cycleMinutes — and is
// pinned by screenshot poses (shots.js) instead of advancing.
const dayNightCfg = (WORLD.dayNight || {});
const CYCLE_MINUTES = dayNightCfg.cycleMinutes || 10;
const START_HOUR = dayNightCfg.startHour || 17.5;
let gameHour = START_HOUR;

function formatGameHour(h) {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((((h % 24) + 24) % 24 - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ---- Storm wiring: weather.js fires thunder a beat after each
// lightning flash; the frame loop (below) feeds the gust vector into
// the flight model while the boss sortie is active.
if (render.weather) {
  render.weather.onThunder = () => audio.thunder();
}

// True while the boss finale is being flown: the storm (rain,
// lightning, gusts) is on only then — never in other sorties or
// free flight.
function stormActive() {
  return !!(
    missions.current &&
    missions.current.id === 'boss' &&
    missions.status === 'active'
  );
}

// ---- Live score for the HUD: missions.score is only finalised on
// completion, so the running total is rebuilt from what was collected.
function liveScore() {
  if (missions.status === 'complete') return missions.score;
  const s = TUNING.scoring;
  return (
    missions.ringsPassed * s.ringPoints +
    missions.checkpointsVisited * s.checkpointPoints +
    (missions.dronesDown || 0) * (s.dronePoints || 0)
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
    // TAWS mini-map: map position plus the target's map position.
    x: fs.position.x,
    z: fs.position.z,
    throttle: fs.throttle,
    // Fuel as a percent of the selected plane's tank (tanks differ:
    // the heavy carries 140, the interceptor 85), not raw units.
    fuel: (fs.fuel / (fs.fuelCapacity || 100)) * 100,
    vspeed: fs.verticalSpeed,
    score: liveScore(),
    time: missions.elapsed,
    objective: missions.objectiveText(),
    target: tm
      ? { label: tm.label, dist: tm.distance, bearing: targetBearing, x: tm.x, z: tm.z }
      : null,
    stalled: fs.stalled,
    damage: fs.damage,
    wind: fs.wind,
    // R2-11c combat: null outside chase/boss, so the HUD weapon line
    // only appears in the two combat sorties.
    weapon: weapons ? weapons.status() : null,
    // Storm gust for the HUD wind arrow (0 outside the boss sortie).
    gust: fs.gust,
    storm: stormActive(),
    pitchDeg: fs.pitchDeg,
    bankDeg: fs.bankDeg,
    gearDown: fs.gearDown,
    gearDeploy: fs.gearDeploy,
    // The HUD clock shows the renderer's hour, not the advancing
    // gameHour: a pinned shot (golden hour by default, or ?time=)
    // sets the renderer directly, and the clock must match the sky
    // the player actually sees.
    clock: formatGameHour(render.getTimeOfDay()),
  };
}

// ---- Flight events: missions owns the scoring handlers, so each one is
// wrapped (not replaced) to add the HUD message, the sound and the shake.
function wrapEvent(key, extra) {
  const prev = flight.onEvent[key];
  flight.onEvent[key] = function (...args) {
    if (typeof prev === 'function') prev(...args);
    if (typeof extra === 'function') extra(...args);
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
wrapEvent('onRingSet', (setName, i) => {
  hud.showMessage('Ring ' + (i + 1) + '!  +250');
  audio.ring();
});
wrapEvent('onCheckpointSet', (setName, i) => {
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
  } else if (info.belly) {
    hud.showMessage('Belly landing!');
    render.shake(0.7);
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
  lastCrashInfo = info || null;
  // A crash outside an active mission (free flight) still ends the run.
  // When missions already failed the sortie (status 'failed') its own
  // onFail path shows the end screen, and when the sortie already
  // completed the completion screen owns the ending — a post-completion
  // crash must never overwrite it. Only a mission-less ('idle') crash
  // gets its own screen from here.
  if (missions.status === 'idle') {
    const run = runId;
    setTimeout(() => {
      if (state.screen === 'playing' && runId === run) showEnd('Crashed', crashLines(info), 'crashed', 'crashed');
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
missions.onBoatPass = () => {
  hud.showMessage('Kapal ditemukan! Mendarat di runway.');
  audio.checkpoint();
};

// Sortie run id: every start/restart bumps it. The delayed end-screen
// timeouts (onComplete/onFail/onCrash) capture the run they belong to
// and refuse to fire once a newer run has started — otherwise a stale
// timeout shows the previous sortie's end screen over the new one.
let runId = 0;

missions.onComplete = (info) => {
  audio.success();
  audio.engine(false);
  const coins = campaign.award(info);
  const coinText = coins > 0 ? '  ·  +' + coins + ' koin' : '';
  // Boss finale: completing sortie 12 closes the whole campaign.
  const isBoss = info.mission.id === 'boss';
  hud.showBanner(
    isBoss ? 'Kampanye Selesai!' : 'Mission Complete!',
    isBoss
      ? 'Badai Leviathan ditaklukkan — 8 ring badai di tengah badai!' + coinText
      : info.mission.name + ' — Score ' + info.score + coinText
  );
  const run = runId;
  setTimeout(() => {
    if (state.screen !== 'playing' || runId !== run) return;
    const lines = [
      info.mission.name + ' complete!',
      'Score <b>' + info.score + '</b>' + (info.newBest ? ' — new best!' : '') +
        (coins > 0 ? '  ·  <b>+' + coins + ' koin</b> (saldo ' + campaign.coins + ')' : ''),
      'Time ' + formatClock(info.time) + '  ·  Best <b>' + info.best + '</b>',
    ];
    if (isBoss) {
      lines.push('🏆 Kampanye Garuda Skies selesai — semua 12 sortie ditaklukkan!');
    }
    showEnd(isBoss ? 'Kampanye Selesai!' : 'Mission Complete', lines, 'complete', 'complete');
  }, 1800);
};

missions.onFail = (info) => {
  audio.engine(false);
  const why = info.reason === 'time' ? 'Time ran out.' : 'The plane crashed.';
  hud.showBanner('Mission Failed', why);
  const run = runId;
  setTimeout(() => {
    if (state.screen !== 'playing' || runId !== run) return;
    showEnd('Mission Failed', [
      why,
      'Score <b>' + liveScore() + '</b>',
      'Time ' + formatClock(info.time),
      'Press R to retry.',
    ], 'crashed', info.reason === 'time' ? 'failed-time' : 'crashed');
  }, 1800);
};

function showEnd(title, lines, screenName, debriefKind) {
  // Hull ledger: sortie damage leaves the plane battered until it is
  // repaired in the hangar — bank it into the save before the flight
  // state is reset for the next run.
  if (flight.state.damage > 0) {
    campaign.applyHullDamage(flight.state.damage);
    flight.state.damage = 0; // banked once — toMenu must not bank it again
  }
  state.screen = screenName;
  hud.setEnd(title, lines);
  // The debrief is built here (after hull banking) and rendered into
  // the same end screen — no second screen, no extra navigation.
  hud.setDebrief(debriefKind ? buildDebrief(debriefKind) : null);
  hud.setScreen(screenName);
}

// ---- View, screens and mission flow.
function setView(name) {
  state.view = name;
  render.setView(name);
  hud.setCockpit(name === 'cockpit');
}

function startMission(i) {
  // Re-apply the save's refits + hull fragility BEFORE missions.start:
  // start() resets the flight state, and reset() fills the tank to the
  // CURRENT capacity — applying refits after it left a refitted tank
  // starting at the old (smaller) capacity instead of full.
  flight.setRefits(refitLevels(campaign.save.refits, campaign.aircraft));
  flight.setHull(campaign.hull);
  const ok = missions.start(i);
  if (!ok) {
    hud.showMessage('Finish the previous mission to unlock this one.');
    return false;
  }
  runId += 1;
  resetTrace();
  // Most sorties start at golden hour; a sortie may pin its own hour
  // (the night sortie starts at 21:30).
  gameHour = missions.current && missions.current.startHour
    ? missions.current.startHour
    : START_HOUR;
  render.setTimeOfDay(gameHour);
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
  runId += 1;
  resetTrace();
  gameHour = missions.current && missions.current.startHour
    ? missions.current.startHour
    : START_HOUR;
  render.setTimeOfDay(gameHour);
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
  if (hangar) hangar.hide();
  gameHour = START_HOUR;
  render.setTimeOfDay(gameHour);
  render.setStorm(false);
  audio.engine(false);
  audio.setSpeed(0);
  audio.setWind(0);
  audio.setRain(0);
  hud.setRain(false);
  hud.setCockpit(false);
  hud.setDebrief(null); // a stale debrief must never greet the next run
  if (flight.state.damage > 0) campaign.applyHullDamage(flight.state.damage);
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

// ---- Menu: the campaign — 12 sorties in 3 acts, each row showing its
// name, short objective, best score/time and lock state, plus the coin
// balance — with Free Flight still available from index.html.
function buildMenu() {
  const list = document.getElementById('mission-list');
  if (!list) return;
  list.innerHTML = '';
  const coinsEl = document.getElementById('campaign-coins');
  if (coinsEl) {
    coinsEl.textContent =
      '🪙 ' + campaign.coins + ' koin  ·  ' + campaign.completedCount + '/12 sortie selesai';
  }
  campaign.acts.forEach((act, actIdx) => {
    const head = document.createElement('li');
    head.className = 'act-head';
    head.textContent = 'Babak ' + (actIdx + 1) + ' — ' + act.name + ' · ' + act.note;
    list.appendChild(head);
    campaign.sorties
      .filter((s) => s.act === actIdx)
      .forEach((sortie) => {
        const li = document.createElement('li');
        const unlocked = campaign.isUnlocked(sortie.n);
        if (!unlocked) li.className = 'locked';
        const best = campaign.bestFor(sortie.n);
        const missionIdx = missionIndexForSortie(sortie.n);
        const bestText = best.score > 0
          ? ' <span class="lock">Best ' + best.score +
            (best.time > 0 ? ' · ' + formatClock(best.time) : '') + '</span>'
          : '';
        li.innerHTML =
          '<span class="num">' + sortie.n + '.</span> ' +
          sortie.name + ' — ' + sortie.objective +
          ' <span class="lock">+' + sortie.coins + ' koin</span>' +
          bestText +
          (unlocked ? '' : ' <span class="lock">🔒</span>');
        if (unlocked && missionIdx >= 0) {
          li.addEventListener('click', () => startMission(missionIdx));
        }
        list.appendChild(li);
      });
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
// ?plane= picks the aircraft for the shot (e.g. Rajawali cover) —
// applied before the shot poses, so the posed model is the right one.
try {
  const planeRaw = new URLSearchParams(window.location.search || '').get('plane');
  if (planeRaw && ['cendrawasih', 'rajawali', 'komodo'].indexOf(planeRaw) !== -1 &&
      planeRaw !== campaign.aircraft) {
    selectAircraft(planeRaw);
  }
} catch (err) { /* no window / bad query: keep the saved aircraft */ }
const shots = createShots(render, flight, world, missions);
if (shots.shotName === 'hangar') {
  // Hangar/dispatch shot: menu screen + hangar panel open, the 3D
  // tarmac (parked plane) visible on the left of the panel.
  state.shot = 'hangar';
  state.posed = true;
  state.screen = 'menu';
  hud.setScreen('menu');
  hud.setCockpit(false);
  openHangar();
  // R2-11b: panel to the RIGHT (the .screen column flex was dropping
  // it on the left, so justify-content never pushed it right), orbit
  // the chase camera ~22 deg so the parked plane reads as a big 3/4
  // rear view centred in the open left half instead of a small
  // tail-on speck at the panel edge, and compact the panel so the
  // refit shop + ledger + dispatch map + medals all fit one frame.
  // Shot-only: normal hangar play keeps its own layout and camera.
  const hangarScreen = document.getElementById('screen-hangar');
  if (hangarScreen) hangarScreen.style.flexDirection = 'row';
  render.snap();
  // addLook(dx, dy): lookYaw -= dx * 0.25 deg, so dx -120 orbits the
  // camera +30 deg around the plane and swings the plane left in
  // frame, into the open half. (Try 1 used +35 deg: the tail filled
  // the frame, the nose slid behind the panel and the tail fin cropped
  // at the left edge — the parked plane is too long for the 700 px
  // open half at that angle. +22 deg foreshortens the fuselage so
  // the whole plane fits.) R2-12h try 1: +30 deg — the middle step
  // between the +22 deg slab (fuselage unreadable, R2-12g) and the
  // +35 deg crop, so the fuselage + nose read as a plane while the
  // whole aircraft still fits the open half. R2-12h try 2 (dy -40)
  // REVERTED: it lifted the plane but the tail fin ballooned to fill
  // the whole left edge (cropped left + bottom) and hid the fuselage
  // behind it — worse than try 1. Try 1's dy +30 stands as the best
  // hangar frame; the remaining yellow is pale noon paint, not olive.
  // R2-13b FINAL: try 3 FAILED (a) — at the +71.6 deg clamp the
  // plane slides off the left edge (only the tail cone + a wing
  // sliver stay in frame); the lookAt target sits 16 m east of the
  // plane, so the max orbit over-swings it. Revert to try 1's
  // working angles (+55 deg, dy 0) with scale 1.75 — the midpoint
  // between try 1 (whole but small at 2.0) and try 2's distance
  // (1.5, whose failure was dy, not scale). Lower-half colour
  // measured: baseline (171,158,140) -> try 1 (150,146,135), i.e.
  // the side-on view already pulls the yellow cast toward neutral
  // grey; the remaining pale-cream extent is the paint itself,
  // which is gameplay and stays.
  if (render && typeof render.setShotChaseScale === 'function') render.setShotChaseScale(1.75);
  if (render && typeof render.addLook === 'function') render.addLook(-220, 0);
  if (hangar && typeof hangar.compactForShot === 'function') hangar.compactForShot();
  const hp = document.querySelector('.hangar-panel');
  if (hp) hp.scrollTop = 0;
} else if (shots.shotName) {
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
    // C toggles chase <-> cockpit; from the deck-cam it returns to chase.
    setView(state.view === 'deck' ? 'chase' : state.view === 'cockpit' ? 'chase' : 'cockpit');
  }
  // Deck-cam (V): a low camera by the runway threshold watching the
  // plane come in (LSO-style). V again returns to the chase camera.
  // Works in every sortie, not just the boss.
  if (input.takePressed('KeyV') && state.screen === 'playing' && !state.posed) {
    setView(state.view === 'deck' ? 'chase' : 'deck');
    hud.showMessage(state.view === 'deck' ? 'Deck-cam' : 'Chase cam');
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
  // Retractable landing gear: G toggles up/down in flight only.
  // flight.toggleGear guards the rest (ignored on the ground and
  // when crashed); a press that does nothing shows no message.
  if (input.takePressed('KeyG') && state.screen === 'playing' && !state.posed) {
    if (flight.toggleGear()) {
      hud.showMessage(flight.state.gearDown ? 'Gear Down' : 'Gear Up');
    }
  }

  // Mouse-look drag feeds the renderer (chase orbit / cockpit glance).
  const look = input.consumeLook();
  if (look.dx !== 0 || look.dy !== 0) render.addLook(look.dx, look.dy);

  if (state.screen === 'playing' && !state.posed) {
    // Storm (boss finale only): turn the weather on, feed its gust
    // vector into the flight model before the physics step, and run
    // the rain audio. Outside the boss sortie everything is off.
    const storm = stormActive();
    render.setStorm(storm);
    if (storm && render.weather) {
      const g = render.weather.gust();
      flight.setGust(g.x, g.z, g.strength);
      audio.setRain(0.85);
    } else {
      flight.setGust(0, 0, 0);
      audio.setRain(0);
    }
    // Rain on the cockpit glass: only in cockpit view, only in the storm.
    hud.setRain(storm && state.view === 'cockpit');
    // Arcade pitch: input.js already maps ArrowUp/W to nose up (+1),
    // the same sign flight.js expects — passed through untouched.
    flight.update(dt, input);
    missions.update(dt);
    // R2-11c combat: Space fires while held (cooldown-gated inside
    // weapons); drones only exist in the chase and boss sorties.
    weapons.update(
      dt,
      input.isDown('Space'),
      missions.current && missions.status === 'active'
        ? missions.current.id
        : null
    );
    // Approach trace: one sample every ~0.25 s of play.
    traceAccum += dt;
    if (traceAccum >= 0.25) {
      traceAccum = 0;
      recordTraceSample();
    }
    // Day-night clock: advances with play time only (frozen while
    // paused, posed or on the menu). A full 24 h cycle takes
    // CYCLE_MINUTES of play, so the mood visibly changes in a mission.
    gameHour = (gameHour + (dt * 24) / (CYCLE_MINUTES * 60)) % 24;
    render.setTimeOfDay(gameHour);
  } else if (state.screen === 'playing' && state.posed) {
    // Posed for a screenshot: propeller spins, plane never moves.
    // Keep the clock in sync with the pinned render hour.
    // R2-10: re-apply the grade every frame — the boss storm grade
    // reads weather.intensity inside setTimeOfDay, and the storm
    // only reaches full strength after the shot is posed, so a
    // single call at pose time graded a clear sky.
    gameHour = render.getTimeOfDay();
    render.setTimeOfDay(gameHour);
    aircraft.setThrottle(flight.state.throttle);
    aircraft.update(dt, { roll: 0, pitch: 0 });
  } else if (state.screen === 'menu') {
    // Parked on the runway behind the menu: idle propeller.
    aircraft.setThrottle(0);
    aircraft.update(dt, {});
  }

  render.update(dt, flight.state);

  // R2-14g: advance the grass wind sway (no-op safe if the module
  // is ever skipped — the blades simply stand still).
  if (grass && typeof grass.update === 'function') grass.update(dt);

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
