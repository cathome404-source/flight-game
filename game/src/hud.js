// Garuda Skies — HUD and cockpit instrument panel.
// Written fresh from the prose spec. Reads the DOM built by index.html
// (S1) and the flight/mission state (S3); it never touches the 3D scene.
// Every write is guarded (missing elements are skipped) and cached
// (the DOM is only touched when a value actually changes).

import { TUNING, WORLD } from './config.js';

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const CARDINALS = ['N', 'E', 'S', 'W'];
const PX_PER_DEG = 2; // compass strip: pixels per degree of heading
const STRIP_HALF = 360; // strip covers -360..+720 degrees so it wraps
const STRIP_HALF_PX = 160; // fallback: half of the 320px compass panel;
// the live width is used when the browser reports one (see update).

// CSS injected once for the elements this module builds itself
// (compass strip, cockpit panel, banner, target/wind lines).
const PANEL_CSS = [
  '.compass-strip{position:relative;height:20px;overflow:hidden;margin-bottom:2px}',
  '.compass-strip-inner{position:absolute;top:0;left:0;height:100%;will-change:transform}',
  '.compass-strip .tick{position:absolute;top:0;transform:translateX(-50%);font-size:12px;color:#ffd9a0;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.75)}',
  '.compass-strip .tick.cardinal{font-weight:bold;color:#ffb36b;font-size:14px}',
  '#cockpit-panel{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);display:none;gap:16px;align-items:flex-end;z-index:5;pointer-events:none}',
  '#cockpit-panel.on{display:flex}',
  '.cockpit-gauge{position:relative;width:120px;height:120px;border-radius:50%;background:#160d05;border:3px solid rgba(255,179,107,.65);box-shadow:0 0 20px rgba(255,150,60,.3),inset 0 0 24px rgba(0,0,0,.85);overflow:hidden;flex:none}',
  '.horizon-move{position:absolute;left:-40%;top:-40%;width:180%;height:180%}',
  '.horizon-sky{position:absolute;left:0;top:0;width:100%;height:50%;background:linear-gradient(180deg,#7fb2e8,#cfe8ff)}',
  '.horizon-ground{position:absolute;left:0;top:50%;width:100%;height:50%;background:linear-gradient(180deg,#8a5a2b,#4a2c12)}',
  '.horizon-fixed{position:absolute;left:50%;top:50%;width:64px;height:4px;margin:-2px 0 0 -32px;background:#ffb36b;box-shadow:0 0 6px #ffb36b;border-radius:2px;z-index:2}',
  '.horizon-fixed::after{content:"";position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#ffb36b}',
  '.gauge-needle{position:absolute;left:50%;bottom:50%;width:3px;height:44%;margin-left:-1.5px;background:#ffb36b;box-shadow:0 0 6px #ffb36b;transform-origin:50% 100%;z-index:2}',
  '.gauge-hub{position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#ffb36b;z-index:3}',
  '.gauge-label{position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:10px;letter-spacing:2px;color:#ffd9a0;z-index:2;text-shadow:0 1px 3px rgba(0,0,0,.9)}',
  '.gauge-digital{position:absolute;left:0;right:0;top:12px;text-align:center;font-size:15px;font-weight:bold;color:#fff3e0;z-index:2}',
  '.cockpit-lamps{display:flex;flex-direction:column;gap:10px;padding-bottom:8px}',
  // R2-11a2 — warning-lamp labels sat pale (#ffd9a0, no shadow) on the
  // bright pink nose / sunlit terrain, so STALL/FUEL washed out. A dark
  // halo shadow plus a small dark pill behind each label keeps them
  // readable anywhere without moving the HUD layout.
  '.lamp-row{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2px;color:#ffd9a0;font-weight:500;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.85)}',
  '.lamp-row span{background:rgba(8,14,22,.55);padding:2px 7px;border-radius:999px}',
  '.lamp{width:16px;height:16px;border-radius:50%;background:#3a2a1a;border:2px solid rgba(255,179,107,.45);flex:none}',
  '.lamp.lit-red{background:#ff5252;border-color:#ff8a8a;box-shadow:0 0 14px #ff5252}',
  '.lamp.lit-amber{background:#ffc233;border-color:#ffe08a;box-shadow:0 0 14px #ffc233}',
  '#hud-banner{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}',
  '.hud-banner-title{font-size:52px;font-weight:bold;letter-spacing:3px;color:#fff3e0;text-shadow:0 4px 0 rgba(120,40,0,.55),0 8px 28px rgba(0,0,0,.7)}',
  '.hud-banner-sub{font-size:20px;color:#ffd9a0;margin-top:8px;text-shadow:0 2px 10px rgba(0,0,0,.7)}',
  // P8 — glassmorphism: thin translucent panels, not thick boxes.
  // The HUD reads light (font-weight 300) over a dark glass wash, so
  // the terrain behind it stays visible through the edges.
  '#hud .panel{background:rgba(8,14,22,.32);border:1px solid rgba(255,255,255,.16);border-radius:10px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:none}',
  '#hud{font-weight:300}',
  '#hud .label{font-weight:300;letter-spacing:2px}',
  '#hud .value{font-weight:400}',
  // P8 — speed / altitude tapes: a moving strip of numbers down each
  // screen edge, the live value held in a glass centre band.
  '.hud-tape{position:absolute;top:50%;transform:translateY(-50%);width:66px;height:280px;overflow:hidden;pointer-events:none;z-index:4}',
  '.hud-tape.left{left:14px}',
  '.hud-tape.right{right:14px}',
  '.hud-tape-inner{position:absolute;left:0;top:0;width:100%;will-change:transform}',
  '.hud-tape .tape-tick{position:absolute;left:0;width:100%;text-align:center;font-size:12px;color:#ffe9c4;text-shadow:0 1px 4px rgba(0,0,0,.8);white-space:nowrap}',
  '.hud-tape .tape-tick.major{font-size:15px;font-weight:500;color:#fff3e0}',
  '.hud-tape-centre{position:absolute;left:0;right:0;top:50%;height:26px;margin-top:-13px;border-top:1px solid rgba(255,179,107,.7);border-bottom:1px solid rgba(255,179,107,.7);background:rgba(8,14,22,.35);z-index:2}',
  '.hud-tape-value{position:absolute;left:0;right:0;top:50%;height:26px;margin-top:-13px;line-height:26px;text-align:center;font-size:16px;font-weight:500;color:#fff3e0;z-index:3;text-shadow:0 1px 4px rgba(0,0,0,.8)}',
  '.hud-tape-unit{position:absolute;left:0;right:0;top:50%;margin-top:16px;text-align:center;font-size:10px;letter-spacing:2px;color:#ffd9a0;z-index:3;text-shadow:0 1px 4px rgba(0,0,0,.8)}',
  // P8 — waypoint arrow: a single chevron under the compass, rotated
  // toward the next target, so the centre of the screen stays clear.
  '#hud-waypoint{position:absolute;top:118px;left:50%;transform:translateX(-50%);z-index:4;pointer-events:none;text-align:center;display:none}',
  '#hud-waypoint .wp-arrow{font-size:26px;line-height:1;color:#ffb36b;text-shadow:0 0 10px rgba(255,150,60,.7);display:inline-block;will-change:transform}',
  '#hud-waypoint .wp-label{font-size:11px;letter-spacing:2px;color:#ffd9a0;text-shadow:0 1px 4px rgba(0,0,0,.8)}',
  // R2-4 — rain on the cockpit glass: diagonal streaks sliding down
  // the whole frame, only in cockpit view during a storm. Two
  // layers at different speeds so the fall never reads as one flat
  // sheet; low opacity, pointer-transparent, above the 3D canvas.
  '#cockpit-rain{position:absolute;inset:0;pointer-events:none;display:none;z-index:6;overflow:hidden}',
  '#cockpit-rain.on{display:block}',
  '#cockpit-rain .rain-a,#cockpit-rain .rain-b{position:absolute;inset:0}',
  // Seamless loops: the vertical travel is exactly one pattern period
  // along the gradient axis (105 deg / 34 px -> 131 px; 100 deg /
  // 52 px -> 299 px), so the streaks never jump at the loop point.
  '#cockpit-rain .rain-a{background-image:repeating-linear-gradient(105deg,transparent 0 18px,rgba(205,225,255,.30) 18px 19px,transparent 19px 34px);animation:rainfall-a .55s linear infinite}',
  '#cockpit-rain .rain-b{background-image:repeating-linear-gradient(100deg,transparent 0 26px,rgba(205,225,255,.20) 26px 27px,transparent 27px 52px);animation:rainfall-b .9s linear infinite}',
  '@keyframes rainfall-a{from{background-position:0 0}to{background-position:0 131px}}',
  '@keyframes rainfall-b{from{background-position:0 0}to{background-position:0 299px}}',
  // P8 — objective and score fade to a whisper after 3 s without a
  // change; any new objective or score change brings them back.
  '#hud-objective,#hud-timer-score{transition:opacity .8s ease}',
  '#hud-objective.hud-faded,#hud-timer-score.hud-faded{opacity:.38}',
  // R2-5b — TAWS radar mini-map: one small canvas, bottom-right corner.
  '#taws-map{position:absolute;right:14px;bottom:14px;width:140px;height:140px;z-index:4;pointer-events:none;border-radius:10px;border:1px solid rgba(255,255,255,.16)}',
  // R2-5b — debrief inside the end screen: trace canvas, stat grid,
  // grade badge, medal line, score breakdown, crash causes.
  '#end-debrief{width:min(560px,92vw);margin-top:10px;text-align:left}',
  '.debrief-title{font-size:19px;letter-spacing:1px;color:#ffb36b;margin:2px 0 8px;text-align:center}',
  '.debrief-title.bad{color:#ff5252}',
  '.debrief-trace{width:100%;height:auto;display:block;border-radius:8px;border:1px solid rgba(255,179,107,.35);background:rgba(8,14,22,.5)}',
  '.debrief-legend{font-size:12px;color:#ffd9a0;margin:4px 0 8px;text-align:center}',
  '.debrief-legend .lg-flown{color:#ffb36b;margin-right:14px}',
  '.debrief-legend .lg-ideal{color:#8dff9e}',
  '.debrief-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}',
  '.debrief-stat{background:rgba(8,14,22,.45);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 10px;font-size:14px}',
  '.debrief-stat b{float:right;color:#fff3e0}',
  '.debrief-stat span{color:#ffd9a0}',
  '.debrief-grade{display:inline-block;font-size:26px;font-weight:bold;padding:4px 18px;border-radius:999px;margin:4px 0}',
  '.debrief-grade.grade-S{background:#ffd27a;color:#3a1c05}',
  '.debrief-grade.grade-A{background:#8dff9e;color:#12300f}',
  '.debrief-grade.grade-B{background:#ffc233;color:#3a2c05}',
  '.debrief-grade.grade-C{background:rgba(255,255,255,.2);color:#fff3e0}',
  '.debrief-medal{font-size:16px;margin:4px 0;color:#ffd27a}',
  '.debrief-medal.dim{color:#ffd9a0}',
  '.debrief-breakdown{margin:8px 0;font-size:15px;line-height:1.7}',
  '.debrief-breakdown .row{display:flex;justify-content:space-between;border-bottom:1px dashed rgba(255,255,255,.14);padding:1px 0}',
  '.debrief-breakdown .row.total{border-bottom:none;font-weight:bold;color:#ffb36b;font-size:17px}',
  '.debrief-causes{margin:4px 0 8px;padding-left:22px;font-size:15px;line-height:1.6;color:#ffb0a0}',
  '.debrief-hull{font-size:14px;color:#ffd9a0;margin-top:4px}',
].join('\n');

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function normHeading(heading) {
  return (((heading || 0) % 360) + 360) % 360;
}

function compassPoint(heading) {
  const idx = Math.round(normHeading(heading) / 45) % 8;
  return COMPASS_POINTS[idx];
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function formatVspeed(v) {
  const n = v || 0;
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

// ---- R2-5b debrief helpers (pure, exported for main.js) ----

// Grade a touchdown from sink rate (m/s) and lateral offset from the
// runway centerline (m). S needs a soft kiss on the centreline; C is a
// landing that survived but was sloppy.
export function gradeTouchdown(td) {
  if (!td) return null;
  const sink = Math.abs(td.verticalSpeed || 0);
  const rwZ = WORLD.runway ? WORLD.runway.z : 560;
  const offset = Math.abs((td.z || 0) - rwZ);
  let grade = 'C';
  if (sink <= 2 && offset <= 5) grade = 'S';
  else if (sink <= 3 && offset <= 10) grade = 'A';
  else if (sink <= 5 && offset <= 20) grade = 'B';
  return {
    sink,
    offset,
    speed: td.speed || 0,
    bankDeg: td.bankDeg || 0,
    grade,
    gentle: !!td.gentle,
    inZone: !!td.inZone,
    belly: !!td.belly,
  };
}

// Pilot medal for a grade: S and A earn one, B and C do not.
export function medalForGrade(grade) {
  if (grade === 'S') return { id: 'pendaratan-sempurna', name: 'Pendaratan Sempurna' };
  if (grade === 'A') return { id: 'pendaratan-halus', name: 'Pendaratan Halus' };
  return null;
}

// Crash cause analysis: each cause is detected from the impact
// snapshot (flight.crash) and the last touchdown, never generic text.
// At least one cause is always returned.
export function crashCauses(info, touchdown, stallSpeed) {
  const causes = [];
  if (!info) return causes;
  const hardMax = (TUNING.damage && TUNING.damage.hardTouchdown) || 7;
  const sink = Math.abs(info.verticalSpeed || 0);
  if (sink > hardMax) {
    causes.push(
      'Sink rate ' + sink.toFixed(1) + ' m/s melebihi batas keras ' + hardMax +
      ' m/s — hantaman terlalu keras untuk roda pendarat.'
    );
  }
  if (Math.abs(info.bankDeg || 0) > 20) {
    causes.push(
      'Bank ' + Math.abs(info.bankDeg).toFixed(0) +
      '° saat menghantam tanah — sayap menyentuh tanah duluan.'
    );
  }
  const stall = stallSpeed || 28;
  if (info.stalled || (typeof info.speed === 'number' && info.speed < stall)) {
    causes.push(
      'Kecepatan ' + (info.speed || 0).toFixed(0) + ' m/s di bawah stall ' +
      stall.toFixed(0) + ' m/s — sayap kehilangan angkat (stall).'
    );
  }
  if ((info.fuel || 0) <= 0.5) {
    causes.push('Bahan bakar habis — mesin mati sebelum sempat mendarat.');
  }
  if (touchdown && touchdown.belly) {
    causes.push('Roda pendarat terlipat — pesawat mendarat dengan perut (belly landing).');
  }
  if (info.reason === 'terrain') {
    causes.push('Menabrak terrain — terbang terlalu rendah di luar runway.');
  }
  if (causes.length === 0) {
    causes.push('Damage mencapai 100% — benturan beruntun merusak lambung sampai hancur.');
  }
  return causes;
}

export function createHud(document) {
  const doc = document;
  const $ = (id) => (doc && doc.getElementById ? doc.getElementById(id) : null);

  const el = {
    hud: $('hud'),
    alt: $('hud-alt'),
    speed: $('hud-speed'),
    vspeed: $('hud-vspeed'),
    heading: $('hud-heading'),
    throttle: $('hud-throttle'),
    throttleFill: $('hud-throttle-fill'),
    fuel: $('hud-fuel'),
    fuelFill: $('hud-fuel-fill'),
    objectiveText: $('hud-objective-text'),
    objectivePanel: $('hud-objective'),
    timer: $('hud-timer'),
    score: $('hud-score'),
    timerScore: $('hud-timer-score'),
    message: $('hud-message'),
    stall: $('hud-stall'),
    compass: $('compass'),
    hudRight: $('hud-right'),
    menu: $('screen-menu'),
    pause: $('screen-pause'),
    end: $('screen-end'),
    endTitle: $('end-title'),
    endText: $('end-text'),
    endStats: $('end-stats'),
  };

  // Last-written values, so unchanged numbers never touch the DOM.
  const last = new Map();

  function writeText(node, key, value) {
    if (!node) return;
    if (last.get(key) !== value) {
      last.set(key, value);
      node.textContent = value;
    }
  }

  function writeStyle(node, key, prop, value) {
    if (!node || !node.style) return;
    if (last.get(key) !== value) {
      last.set(key, value);
      node.style[prop] = value;
    }
  }

  function setClass(node, cls, on) {
    if (!node || !node.classList) return;
    if (on) node.classList.add(cls);
    else node.classList.remove(cls);
  }

  function mk(tag, cls, parent) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (parent && parent.appendChild) parent.appendChild(n);
    return n;
  }

  // One injected <style> for everything this module builds itself.
  if (doc && doc.createElement && doc.head && doc.head.appendChild) {
    const style = doc.createElement('style');
    style.textContent = PANEL_CSS;
    doc.head.appendChild(style);
  }

  // ---- Sliding compass strip (replaces the static tick row) ----
  let stripInner = null;
  if (el.compass && doc.createElement) {
    const ticks = el.compass.querySelector
      ? el.compass.querySelector('.ticks')
      : null;
    if (ticks && ticks.style) ticks.style.display = 'none';
    const wrap = mk('div', 'compass-strip', null);
    stripInner = mk('div', 'compass-strip-inner', wrap);
    for (let deg = -STRIP_HALF; deg <= 720; deg += 15) {
      const tick = mk('span', '', stripInner);
      const norm = normHeading(deg);
      if (deg % 90 === 0) {
        tick.textContent = CARDINALS[norm / 90];
        tick.className = 'tick cardinal';
      } else if (deg % 30 === 0) {
        tick.textContent = String(norm).padStart(3, '0');
        tick.className = 'tick';
      } else {
        tick.textContent = '·';
        tick.className = 'tick';
      }
      tick.style.left = (deg + STRIP_HALF) * PX_PER_DEG + 'px';
    }
    if (el.compass.insertBefore && el.compass.firstChild) {
      el.compass.insertBefore(wrap, el.compass.firstChild);
    } else if (el.compass.appendChild) {
      el.compass.appendChild(wrap);
    }
  }

  // ---- Wind readout under the compass ----
  let windLine = null;
  if (doc.createElement && el.compass) {
    windLine = mk('div', '', el.compass);
    windLine.id = 'hud-wind';
    windLine.style.display = 'none';
    windLine.style.fontSize = '12px';
    windLine.style.color = '#ffd9a0';
  }

  // ---- P8 — speed tape (left edge) + altitude tape (right edge).
  // Each tape is a strip of tick labels that slides so the live value
  // stays in the centre band; the static Altitude/Airspeed panels in
  // index.html are hidden once the tapes exist, so the number is shown
  // exactly once, moving, instead of twice and static.
  const TAPE_HALF = 140; // half the 280px tape height
  function makeTape(side, max, step, majorStep, pxPerUnit, unit) {
    if (!doc.createElement || !el.hud) return null;
    const tape = mk('div', 'hud-tape ' + side, el.hud);
    const inner = mk('div', 'hud-tape-inner', tape);
    for (let v = 0; v <= max; v += step) {
      const tick = mk('span', 'tape-tick', inner);
      tick.textContent = String(v);
      if (v % majorStep === 0) tick.className = 'tape-tick major';
      tick.style.top = (TAPE_HALF - v * pxPerUnit - 7) + 'px';
    }
    mk('div', 'hud-tape-centre', tape);
    const val = mk('div', 'hud-tape-value', tape);
    const un = mk('div', 'hud-tape-unit', tape);
    un.textContent = unit;
    return { tape, inner, val, pxPerUnit };
  }
  const speedTape = makeTape('left', 120, 10, 20, 2, 'm/s');
  const altTape = makeTape('right', 600, 50, 100, 0.5, 'm');
  function hidePanelOf(node) {
    let p = node;
    while (p && !(p.classList && p.classList.contains('panel'))) {
      p = p.parentNode;
    }
    if (p && p.style) p.style.display = 'none';
  }
  if (speedTape) hidePanelOf(el.speed);
  if (altTape) hidePanelOf(el.alt);

  // ---- P8 — waypoint arrow under the compass strip.
  let waypoint = null;
  let waypointArrow = null;
  let waypointLabel = null;
  if (doc.createElement && el.hud) {
    waypoint = mk('div', '', el.hud);
    waypoint.id = 'hud-waypoint';
    waypointArrow = mk('div', 'wp-arrow', waypoint);
    waypointArrow.textContent = '➤';
    waypointLabel = mk('div', 'wp-label', waypoint);
  }

  // ---- Next-target line inside the objective panel ----
  let targetLine = null;
  if (doc.createElement && el.objectivePanel) {
    targetLine = mk('div', '', el.objectivePanel);
    targetLine.id = 'hud-target';
    targetLine.style.display = 'none';
    targetLine.style.marginTop = '4px';
    targetLine.style.color = '#ffb36b';
    targetLine.style.fontWeight = 'bold';
  }

  // ---- R2-11c — weapon line: one small line under the target line,
  // only while a combat sortie (chase / boss) is active. Shows the
  // fire key, ready/reloading state and drones down — nothing else,
  // so the HUD stays clean.
  let weaponLine = null;
  if (doc.createElement && el.objectivePanel) {
    weaponLine = mk('div', '', el.objectivePanel);
    weaponLine.id = 'hud-weapon';
    weaponLine.style.display = 'none';
    weaponLine.style.marginTop = '2px';
    weaponLine.style.color = '#ffd9a0';
    weaponLine.style.fontWeight = 'bold';
  }

  // ---- Day-night clock (R4-3): small "Time of day" panel next to
  // the mission timer, so the game hour is always visible. The HUD
  // panels are dark glass with light text, so it stays legible at
  // every hour, day or night.
  let clockValue = null;
  if (doc.createElement && el.timerScore) {
    const clockPanel = mk('div', 'panel', el.timerScore);
    clockPanel.id = 'hud-clock-panel';
    const lab = mk('div', 'label', clockPanel);
    lab.textContent = 'Time of day';
    const val = mk('div', 'value', clockPanel);
    clockValue = mk('span', '', val);
    clockValue.id = 'hud-clock';
    clockValue.textContent = '17:30';
  }

  // ---- Damage readout (hidden while the plane is undamaged) ----
  let damagePanel = null;
  let damageValue = null;
  if (doc.createElement && el.hudRight) {
    damagePanel = mk('div', 'panel', el.hudRight);
    damagePanel.id = 'hud-damage';
    const lab = mk('div', 'label', damagePanel);
    lab.textContent = 'Damage';
    const val = mk('div', 'value', damagePanel);
    damageValue = mk('span', '', val);
    damageValue.id = 'hud-damage-value';
    const unit = mk('span', 'unit', val);
    unit.textContent = '%';
    damagePanel.style.display = 'none';
  }

  // ---- Landing-gear indicator: GEAR DOWN (green) / GEAR UP (amber) /
  // moving (GEAR… in amber). Lives in the right-hand HUD row.
  let gearValue = null;
  if (doc.createElement && el.hudRight) {
    const gearPanel = mk('div', 'panel', el.hudRight);
    gearPanel.id = 'hud-gear';
    const lab = mk('div', 'label', gearPanel);
    lab.textContent = 'Gear';
    const val = mk('div', 'value', gearPanel);
    gearValue = mk('span', '', val);
    gearValue.id = 'hud-gear-value';
    gearValue.textContent = 'GEAR DOWN';
  }

  // ---- Cockpit instrument panel (DOM/CSS, lit gauges) ----
  const cockpit = {
    panel: null,
    horizon: null,
    altNeedle: null,
    speedNeedle: null,
    altText: null,
    speedText: null,
    stallLamp: null,
    fuelLamp: null,
  };
  if (doc.createElement && el.hud) {
    const panel = mk('div', '', el.hud);
    panel.id = 'cockpit-panel';
    cockpit.panel = panel;

    // Artificial horizon: sky/ground block that rolls and slides
    // with the plane, under a fixed aircraft marker.
    const horizonGauge = mk('div', 'cockpit-gauge', panel);
    const move = mk('div', 'horizon-move', horizonGauge);
    cockpit.horizon = move;
    mk('div', 'horizon-sky', move);
    mk('div', 'horizon-ground', move);
    mk('div', 'horizon-fixed', horizonGauge);
    const attLabel = mk('div', 'gauge-label', horizonGauge);
    attLabel.textContent = 'ATTITUDE';

    // Altimeter: one needle, a full turn per 1000 m, plus digital readout.
    const altGauge = mk('div', 'cockpit-gauge', panel);
    cockpit.altNeedle = mk('div', 'gauge-needle', altGauge);
    mk('div', 'gauge-hub', altGauge);
    cockpit.altText = mk('div', 'gauge-digital', altGauge);
    const altLabel = mk('div', 'gauge-label', altGauge);
    altLabel.textContent = 'ALT m';

    // Airspeed: needle sweeps -135..+135 degrees over 0..100 m/s.
    const speedGauge = mk('div', 'cockpit-gauge', panel);
    cockpit.speedNeedle = mk('div', 'gauge-needle', speedGauge);
    mk('div', 'gauge-hub', speedGauge);
    cockpit.speedText = mk('div', 'gauge-digital', speedGauge);
    const speedLabel = mk('div', 'gauge-label', speedGauge);
    speedLabel.textContent = 'AIRSPEED';

    // Warning lamps: stall (red) and low fuel (amber).
    const lamps = mk('div', 'cockpit-lamps', panel);
    const stallRow = mk('div', 'lamp-row', lamps);
    cockpit.stallLamp = mk('div', 'lamp', stallRow);
    const stallLab = mk('span', '', stallRow);
    stallLab.textContent = 'STALL';
    const fuelRow = mk('div', 'lamp-row', lamps);
    cockpit.fuelLamp = mk('div', 'lamp', fuelRow);
    const fuelLab = mk('span', '', fuelRow);
    fuelLab.textContent = 'FUEL';
  }

  // ---- Big centre banner (mission complete / failed) ----
  let banner = null;
  let bannerTitle = null;
  let bannerSub = null;
  if (doc.createElement && el.hud) {
    banner = mk('div', '', el.hud);
    banner.id = 'hud-banner';
    bannerTitle = mk('div', 'hud-banner-title', banner);
    bannerSub = mk('div', 'hud-banner-sub', banner);
    banner.style.display = 'none';
  }

  // ---- R2-4 — rain on the cockpit glass (two streak layers) ----
  let rainOverlay = null;
  if (doc.createElement && el.hud) {
    rainOverlay = mk('div', '', el.hud);
    rainOverlay.id = 'cockpit-rain';
    mk('div', 'rain-a', rainOverlay);
    mk('div', 'rain-b', rainOverlay);
  }

  // ---- R2-5b — TAWS radar mini-map: one 140x140 canvas, bottom-right.
  // Top-down schematic of the archipelago: sea, islands, the runway
  // strip, the next target (amber diamond) and the plane (white
  // triangle, rotated to its heading). Redrawn every HUD update.
  const TAWS_SIZE = 140;
  const TAWS_HALF = (WORLD.seaSize || 4200) / 2;
  const TAWS_SCALE = TAWS_SIZE / (WORLD.seaSize || 4200);
  let tawsCanvas = null;
  let tawsCtx = null;
  if (doc.createElement && el.hud) {
    tawsCanvas = mk('canvas', '', el.hud);
    tawsCanvas.id = 'taws-map';
    tawsCanvas.width = TAWS_SIZE;
    tawsCanvas.height = TAWS_SIZE;
  }
  function drawTaws(state) {
    if (!tawsCanvas || !tawsCanvas.getContext) return;
    if (!tawsCtx) {
      tawsCtx = tawsCanvas.getContext('2d');
      if (!tawsCtx) return;
    }
    const ctx = tawsCtx;
    const S = TAWS_SIZE;
    const sc = TAWS_SCALE;
    const toX = (x) => (x + TAWS_HALF) * sc;
    const toY = (z) => (z + TAWS_HALF) * sc;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(23,52,84,0.88)';
    ctx.fillRect(0, 0, S, S);
    for (const isl of WORLD.islands || []) {
      ctx.beginPath();
      ctx.arc(toX(isl.x), toY(isl.z), Math.max(3, isl.radius * sc), 0, Math.PI * 2);
      ctx.fillStyle = '#c9a86a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(138,111,63,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const rw = WORLD.runway;
    if (rw) {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(toX(rw.x - rw.length / 2), toY(rw.z) - 2, rw.length * sc, 4);
    }
    const t = state.target;
    if (t && typeof t.x === 'number' && typeof t.z === 'number') {
      ctx.save();
      ctx.translate(toX(t.x), toY(t.z));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffb36b';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    // Plane triangle, nose pointing along the heading (0 = north = up).
    const hdg = ((state.heading || 0) * Math.PI) / 180;
    ctx.save();
    ctx.translate(toX(state.x || 0), toY(state.z || 0));
    ctx.rotate(hdg);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#ff7a3c';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffd9a0';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('TAWS', 5, 12);
  }

  let messageTimer = null;
  let bannerTimer = null;
  // P8 — fade clock: objective + score dim 3 s after their last change.
  let hudChangeAt = Date.now();
  let lastFadeObjective = null;
  let lastFadeScore = null;
  const lowFuelAt =
    (TUNING.fuel && TUNING.fuel.lowFuelWarning) || 20;

  function showMessage(text, ms) {
    if (!el.message) return;
    writeText(el.message, 'message', text || '');
    writeStyle(el.message, 'message-display', 'display', 'block');
    if (messageTimer) clearTimeout(messageTimer);
    const hold =
      typeof ms === 'number'
        ? ms
        : (TUNING.hud.messageHoldSeconds || 2.5) * 1000;
    messageTimer = setTimeout(() => {
      writeStyle(el.message, 'message-display', 'display', 'none');
    }, hold);
  }

  function showBanner(title, sub) {
    if (!banner) return;
    writeText(bannerTitle, 'banner-title', title || '');
    writeText(bannerSub, 'banner-sub', sub || '');
    writeStyle(banner, 'banner-display', 'display', 'block');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      writeStyle(banner, 'banner-display', 'display', 'none');
    }, 3500);
  }

  function showStall(on) {
    if (el.stall) {
      writeStyle(el.stall, 'stall-display', 'display', on ? 'block' : 'none');
    }
    setClass(cockpit.stallLamp, 'lit-red', !!on);
  }

  function setObjective(text) {
    writeText(el.objectiveText, 'objective', text || '—');
  }

  function setCockpit(on) {
    if (!cockpit.panel) return;
    setClass(cockpit.panel, 'on', !!on);
  }

  // Rain streaks on the cockpit glass (R2-4): on only in cockpit view
  // during a storm — main.js drives it every frame while playing.
  function setRain(on) {
    if (!rainOverlay) return;
    setClass(rainOverlay, 'on', !!on);
  }

  // name: 'menu' | 'playing' | 'paused' | 'crashed' | 'complete'
  function setScreen(name) {
    const hudOn = name === 'playing' || name === 'paused';
    setClass(el.hud, 'on', hudOn);
    setClass(el.menu, 'on', name === 'menu');
    setClass(el.pause, 'on', name === 'paused');
    setClass(el.end, 'on', name === 'crashed' || name === 'complete');
    if (name === 'menu') setCockpit(false);
  }

  // R2-5b — debrief panel inside the end screen. data:
  // { kind: 'complete'|'crashed'|'failed-time', trace: [{d,h}],
  //   touchdown: gradeTouchdown() result, grade, medal: {name}|null,
  //   breakdown: {rings,checkpoints,landing,takeoff,timeBonus},
  //   causes: [strings], hull } — every field optional except kind.
  function setDebrief(data) {
    const box = $('end-debrief');
    if (!box) return;
    if (!data) {
      box.innerHTML = '';
      return;
    }
    let html = '<div class="debrief">';
    if (data.kind === 'crashed') {
      html += '<h3 class="debrief-title bad">Analisis Penyebab Crash</h3>';
      html += '<ul class="debrief-causes">';
      for (const c of data.causes || []) html += '<li>' + c + '</li>';
      html += '</ul>';
    } else {
      html += '<h3 class="debrief-title">Debrief Sortie</h3>';
    }
    if (data.trace && data.trace.length >= 3) {
      html += '<canvas id="debrief-trace" class="debrief-trace" width="520" height="200"></canvas>';
      html += '<div class="debrief-legend"><span class="lg-flown">— Jalur diterbangkan</span>' +
        '<span class="lg-ideal">┄ Glide ideal 3°</span></div>';
    }
    const td = data.touchdown;
    if (td) {
      html += '<div class="debrief-grid">' +
        '<div class="debrief-stat"><span>Sink rate</span><b>' + td.sink.toFixed(1) + ' m/s</b></div>' +
        '<div class="debrief-stat"><span>Offset centerline</span><b>' + td.offset.toFixed(0) + ' m</b></div>' +
        '<div class="debrief-stat"><span>Kecepatan touchdown</span><b>' + td.speed.toFixed(0) + ' m/s</b></div>' +
        '<div class="debrief-stat"><span>Bank saat touchdown</span><b>' + Math.abs(td.bankDeg).toFixed(0) + '°</b></div>' +
        '</div>';
      if (data.grade) {
        html += '<div style="text-align:center"><div class="debrief-grade grade-' + data.grade + '">Grade ' + data.grade + '</div></div>';
      }
      if (data.medal) {
        html += '<div class="debrief-medal" style="text-align:center">★ ' +
          (data.medalNew ? 'Medali diraih: <b>' : 'Medali: <b>') + data.medal.name + '</b>' +
          (data.medalNew ? '' : ' (sudah dimiliki)') + '</div>';
      } else if (data.grade) {
        html += '<div class="debrief-medal dim" style="text-align:center">Medali: belum — raih grade A atau lebih untuk medali pilot.</div>';
      }
    }
    const bd = data.breakdown;
    if (bd) {
      const row = (label, pts) =>
        pts > 0 ? '<div class="row"><span>' + label + '</span><span><b>' + pts + '</b></span></div>' : '';
      const total = (bd.rings || 0) + (bd.checkpoints || 0) + (bd.landing || 0) +
        (bd.takeoff || 0) + (bd.timeBonus || 0) + (bd.drones || 0);
      html += '<div class="debrief-breakdown">' +
        row('Ring', bd.rings) + row('Checkpoint', bd.checkpoints) +
        row('Pendaratan', bd.landing) + row('Lepas landas', bd.takeoff) +
        row('Drone', bd.drones) + row('Bonus waktu', bd.timeBonus) +
        '<div class="row total"><span>Total skor</span><span>' + total + '</span></div></div>';
    }
    if (typeof data.hull === 'number') {
      html += '<div class="debrief-hull">Lambung setelah sortie: <b>' + Math.round(data.hull) + '%</b> (kerusakan tercatat di hangar)</div>';
    }
    html += '</div>';
    box.innerHTML = html;
    const cv = $('debrief-trace');
    if (cv && data.trace && data.trace.length >= 3) drawTrace(cv, data.trace);
  }

  // Approach-trace chart: height above the runway vs distance to the
  // touchdown zone, flown line against the ideal 3-degree glide.
  // Distance runs right-to-left: the plane approaches from the left
  // and touches down at the right edge (d = 0).
  function drawTrace(cv, trace) {
    const ctx = cv.getContext ? cv.getContext('2d') : null;
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    const padL = 36;
    const padR = 10;
    const padT = 12;
    const padB = 22;
    let maxD = 200;
    let maxH = 30;
    for (const p of trace) {
      if (p.d > maxD) maxD = p.d;
      if (p.h > maxH) maxH = p.h;
    }
    maxD = Math.ceil(maxD * 1.1);
    maxH = Math.ceil(maxH * 1.15);
    const X = (d) => padL + (1 - d / maxD) * (W - padL - padR);
    const Y = (h) => H - padB - (h / maxH) * (H - padT - padB);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.fillStyle = '#ffd9a0';
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    // Grid + height labels.
    for (let f = 0; f <= 1; f += 0.5) {
      const y = Y(maxH * f);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(Math.round(maxH * f) + ' m', 2, y + 4);
    }
    ctx.fillText('0 m', 2, H - padB + 4);
    ctx.fillText('Jarak ke runway (m)', W - padR - 128, H - 6);
    ctx.fillText('Ketinggian (m)', padL, 10);
    // Ideal 3-degree glide, dashed green.
    const glide = Math.tan((3 * Math.PI) / 180);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#8dff9e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(maxD), Y(Math.min(maxH, glide * maxD)));
    ctx.lineTo(X(0), Y(0));
    ctx.stroke();
    ctx.restore();
    // Flown path, amber.
    ctx.strokeStyle = '#ffb36b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    trace.forEach((p, i) => {
      const x = X(Math.max(0, Math.min(maxD, p.d)));
      const y = Y(Math.max(0, Math.min(maxH, p.h)));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Touchdown dot at the end of the flown path.
    const last = trace[trace.length - 1];
    ctx.beginPath();
    ctx.arc(X(Math.max(0, last.d)), Y(Math.max(0, last.h)), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd27a';
    ctx.fill();
  }

  // lines: array of stat lines ("Score 1250", "Time 2:05") or one string.
  function setEnd(title, lines) {
    writeText(el.endTitle, 'end-title', title || '');
    if (Array.isArray(lines)) {
      if (el.endStats) {
        const html = lines.join('<br>');
        if (last.get('end-stats') !== html) {
          last.set('end-stats', html);
          el.endStats.innerHTML = html;
        }
      }
      writeText(el.endText, 'end-text', '');
    } else if (typeof lines === 'string') {
      writeText(el.endText, 'end-text', lines);
    }
  }

  // state: { alt, speed, heading, throttle, fuel, vspeed, score, time,
  //   objective, target {label, dist}, stalled, damage, missionIndex, wind,
  //   pitchDeg, bankDeg, gearDown, gearDeploy } — pitch/bank feed the
  //   artificial horizon; gearDeploy 0..1 feeds the gear indicator.
  function update(state) {
    if (!state) return;

    const alt = Math.round(state.alt || 0);
    writeText(el.alt, 'alt', String(alt));

    const speed = state.speed || 0;
    writeText(el.speed, 'speed', String(Math.round(speed)));
    // P8 — the tapes slide so the live value stays in the centre band.
    if (speedTape) {
      writeStyle(
        speedTape.inner,
        'speed-tape',
        'transform',
        'translateY(' + (speed * speedTape.pxPerUnit).toFixed(1) + 'px)'
      );
      writeText(speedTape.val, 'speed-tape-val', String(Math.round(speed)));
    }
    if (altTape) {
      writeStyle(
        altTape.inner,
        'alt-tape',
        'transform',
        'translateY(' + (alt * altTape.pxPerUnit).toFixed(1) + 'px)'
      );
      writeText(altTape.val, 'alt-tape-val', String(alt));
    }
    const speedUnit =
      el.speed && el.speed.nextElementSibling ? el.speed.nextElementSibling : null;
    writeText(
      speedUnit,
      'speed-unit',
      'm/s · ' + Math.round(speed * 3.6) + ' km/h'
    );

    writeText(el.vspeed, 'vspeed', formatVspeed(state.vspeed || 0));

    const heading = normHeading(state.heading || 0);
    writeText(
      el.heading,
      'heading',
      String(Math.round(heading)).padStart(3, '0') +
        '° ' +
        compassPoint(heading)
    );
    if (stripInner) {
      // Centre the strip on the current heading; use the live panel
      // width when the browser reports one, so a resized window (or a
      // narrower screen) still keeps the heading dead centre.
      const halfW =
        el.compass && el.compass.clientWidth
          ? el.compass.clientWidth / 2
          : STRIP_HALF_PX;
      const x = halfW - (heading + STRIP_HALF) * PX_PER_DEG;
      writeStyle(
        stripInner,
        'strip-x',
        'transform',
        'translateX(' + x.toFixed(1) + 'px)'
      );
    }

    const throttlePct = Math.round((state.throttle || 0) * 100);
    writeText(el.throttle, 'throttle', String(throttlePct));
    writeStyle(el.throttleFill, 'throttle-fill', 'width', throttlePct + '%');

    const fuelPct = Math.round(state.fuel || 0);
    writeText(el.fuel, 'fuel', String(fuelPct));
    writeStyle(
      el.fuelFill,
      'fuel-fill',
      'width',
      clamp(fuelPct, 0, 100) + '%'
    );
    const lowFuel = fuelPct <= lowFuelAt;
    setClass(el.fuelFill, 'low', lowFuel);
    setClass(cockpit.fuelLamp, 'lit-amber', lowFuel);

    if (state.objective !== undefined) setObjective(state.objective);

    // P8 — objective + score fade out 3 s after their last change and
    // come back the moment either changes again.
    const nowMs = Date.now();
    const scoreNow = Math.round(state.score || 0);
    if (
      state.objective !== lastFadeObjective ||
      scoreNow !== lastFadeScore
    ) {
      lastFadeObjective = state.objective;
      lastFadeScore = scoreNow;
      hudChangeAt = nowMs;
    }
    const hudFaded = nowMs - hudChangeAt > 3000;
    setClass(el.objectivePanel, 'hud-faded', hudFaded);
    setClass(el.timerScore, 'hud-faded', hudFaded);

    writeText(el.timer, 'timer', formatClock(state.time || 0));
    if (state.clock !== undefined) {
      writeText(clockValue, 'clock', state.clock);
    }
    writeText(
      el.score,
      'score',
      Math.round(state.score || 0).toLocaleString('en-US')
    );

    if (targetLine) {
      const t = state.target;
      if (t && t.label) {
        writeText(
          targetLine,
          'target',
          '▸ ' + t.label + ' · ' + Math.round(t.dist || 0) + ' m'
        );
        writeStyle(targetLine, 'target-display', 'display', 'block');
      } else {
        writeStyle(targetLine, 'target-display', 'display', 'none');
      }
    }

    // R2-11c weapon line: only in combat sorties (state.weapon is
    // null elsewhere, so the line never shows in other sorties).
    if (weaponLine) {
      const w = state.weapon;
      if (w && w.active) {
        writeText(
          weaponLine,
          'weapon',
          'Tembak [Space] — ' +
            (w.ready ? 'siap' : 'isi ulang…') +
            ' · Drone jatuh ' + (w.down || 0) + '/' + (w.total || 0)
        );
        writeStyle(weaponLine, 'weapon-display', 'display', 'block');
      } else {
        writeStyle(weaponLine, 'weapon-display', 'display', 'none');
      }
    }

    // P8 — waypoint arrow: points toward the next target relative to
    // the nose (0 = dead ahead). The chevron glyph points right, so
    // -90 deg centres it on straight ahead.
    if (waypoint) {
      const t = state.target;
      if (t && t.label) {
        writeStyle(waypoint, 'wp-display', 'display', 'block');
        writeStyle(
          waypointArrow,
          'wp-rot',
          'transform',
          'rotate(' + (((t.bearing || 0) - 90).toFixed(0)) + 'deg)'
        );
        writeText(waypointLabel, 'wp-label', t.label);
      } else {
        writeStyle(waypoint, 'wp-display', 'display', 'none');
      }
    }

    showStall(!!state.stalled);

    const dmg = Math.round(state.damage || 0);
    if (damagePanel) {
      writeText(damageValue, 'damage', String(dmg));
      writeStyle(
        damagePanel,
        'damage-display',
        'display',
        dmg > 0 ? 'block' : 'none'
      );
      writeStyle(
        damagePanel,
        'damage-color',
        'color',
        dmg >= 75 ? '#ff5252' : dmg >= 40 ? '#ffc233' : '#8dff9e'
      );
    }

    // Landing-gear indicator: down is green, up and moving are amber.
    if (gearValue) {
      const deploy =
        typeof state.gearDeploy === 'number'
          ? state.gearDeploy
          : state.gearDown === false
            ? 0
            : 1;
      const down = deploy >= 0.99;
      const text = down ? 'GEAR DOWN' : deploy <= 0.01 ? 'GEAR UP' : 'GEAR…';
      writeText(gearValue, 'gear', text);
      writeStyle(gearValue, 'gear-size', 'fontSize', '20px');
      writeStyle(
        gearValue,
        'gear-color',
        'color',
        down ? '#8dff9e' : '#ffc233'
      );
    }

    if (windLine) {
      const w = state.wind || 0;
      const g = state.gust || null;
      const gStr = g ? g.strength || 0 : 0;
      if (gStr > 3) {
        // Storm gust: 8-way arrow for the push direction (world xz:
        // +x east, -z north) plus its strength, so the pilot can see
        // the shove coming and fly against it.
        const deg = Math.atan2(-(g.z || 0), g.x || 0) * 180 / Math.PI;
        const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
        const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
        writeText(
          windLine,
          'wind',
          '💨 Hembusan ' + Math.round(gStr) + ' m/s ' + arrows[idx]
        );
        writeStyle(windLine, 'wind-display', 'display', 'block');
      } else if (w > 0.5) {
        writeText(windLine, 'wind', 'Wind ' + Math.round(w) + ' m/s');
        writeStyle(windLine, 'wind-display', 'display', 'block');
      } else {
        writeStyle(windLine, 'wind-display', 'display', 'none');
      }
    }

    // Cockpit gauges: horizon rolls with bank and slides with pitch,
    // needles track altitude and airspeed.
    if (cockpit.horizon) {
      const pitch = clamp(state.pitchDeg || 0, -60, 60);
      const roll = state.bankDeg || 0;
      writeStyle(
        cockpit.horizon,
        'horizon',
        'transform',
        'rotate(' +
          (-roll).toFixed(1) +
          'deg) translateY(' +
          (pitch * 1.6).toFixed(1) +
          'px)'
      );
    }
    if (cockpit.altNeedle) {
      const a = ((((alt % 1000) + 1000) % 1000) / 1000) * 360;
      writeStyle(
        cockpit.altNeedle,
        'alt-needle',
        'transform',
        'rotate(' + a.toFixed(1) + 'deg)'
      );
    }
    if (cockpit.speedNeedle) {
      const a = -135 + (clamp(speed, 0, 100) / 100) * 270;
      writeStyle(
        cockpit.speedNeedle,
        'speed-needle',
        'transform',
        'rotate(' + a.toFixed(1) + 'deg)'
      );
    }
    writeText(cockpit.altText, 'cockpit-alt', String(alt));
    writeText(cockpit.speedText, 'cockpit-speed', String(Math.round(speed)));

    // R2-5b — TAWS radar mini-map follows the plane and its target.
    drawTaws(state);
  }

  return {
    update,
    showMessage,
    showBanner,
    showStall,
    setObjective,
    setScreen,
    setEnd,
    setDebrief,
    setCockpit,
    setRain,
  };
}
