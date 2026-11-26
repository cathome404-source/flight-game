// Garuda Skies — HUD and cockpit instrument panel.
// Written fresh from the prose spec. Reads the DOM built by index.html
// (S1) and the flight/mission state (S3); it never touches the 3D scene.
// Every write is guarded (missing elements are skipped) and cached
// (the DOM is only touched when a value actually changes).

import { TUNING } from './config.js';

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
  '.compass-strip .tick{position:absolute;top:0;transform:translateX(-50%);font-size:12px;color:#ffd9a0;white-space:nowrap}',
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
  '.gauge-label{position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:10px;letter-spacing:2px;color:#ffd9a0;z-index:2}',
  '.gauge-digital{position:absolute;left:0;right:0;top:12px;text-align:center;font-size:15px;font-weight:bold;color:#fff3e0;z-index:2}',
  '.cockpit-lamps{display:flex;flex-direction:column;gap:10px;padding-bottom:8px}',
  '.lamp-row{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:2px;color:#ffd9a0}',
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
  // P8 — objective and score fade to a whisper after 3 s without a
  // change; any new objective or score change brings them back.
  '#hud-objective,#hud-timer-score{transition:opacity .8s ease}',
  '#hud-objective.hud-faded,#hud-timer-score.hud-faded{opacity:.38}',
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

  // name: 'menu' | 'playing' | 'paused' | 'crashed' | 'complete'
  function setScreen(name) {
    const hudOn = name === 'playing' || name === 'paused';
    setClass(el.hud, 'on', hudOn);
    setClass(el.menu, 'on', name === 'menu');
    setClass(el.pause, 'on', name === 'paused');
    setClass(el.end, 'on', name === 'crashed' || name === 'complete');
    if (name === 'menu') setCockpit(false);
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
      if (w > 0.5) {
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
  }

  return {
    update,
    showMessage,
    showBanner,
    showStall,
    setObjective,
    setScreen,
    setEnd,
    setCockpit,
  };
}
