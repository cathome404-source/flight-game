// Garuda Skies — screenshot camera presets (?shot=cover|cockpit|rings|landing).
// Written fresh from the prose spec. Each preset poses the plane in the
// air (or on approach) in front of what the shot is about, starts the
// matching mission so the HUD shows a real objective, and picks the
// matching camera. The seed in the URL is read here too and reported back;
// main.js owns the RNG itself, from the same query string.

import { WORLD } from './config.js';

const DEG = Math.PI / 180;

export const SHOT_NAMES = ['cover', 'cockpit', 'rings', 'landing', 'boss', 'hangar'];

function readQuery() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      return new URLSearchParams(window.location.search || '');
    }
  } catch (err) {
    // No window (headless test): no preset from the URL.
  }
  return new URLSearchParams('');
}

export function createShots(render, flight, world, missions) {
  let current = null;
  // R4-3: shots pin the time of day — golden hour by default (today's
  // look), or the ?time= URL parameter (hours, e.g. ?time=18.5) when
  // given. Set from the query string below, before any shot applies.
  let shotHour =
    (WORLD.dayNight && WORLD.dayNight.startHour) || 17.5;

  // Put the plane at one posed spot: eastbound (yaw -90) along the
  // runway line z = 330, flying, with the throttle already set.
  function pose(x, y, z, yawDeg, pitchDeg, speed, throttle, bankDeg) {
    const st = flight.state;
    st.position.set(x, y, z);
    st.yaw = yawDeg * DEG;
    st.pitch = pitchDeg * DEG;
    st.roll = (bankDeg || 0) * DEG;
    st.speed = speed;
    st.throttle = throttle;
    st.fuel = 100;
    st.damage = 0;
    st.gearDown = false;
    st.gearDeploy = 0;
    st.status = 'flying';
    st.stalled = false;
    st.gliding = false;
    st.verticalSpeed = speed * Math.sin(pitchDeg * DEG);
    st.altitude = y;
    st.heading = 90;
    st.bankDeg = bankDeg || 0;
    st.pitchDeg = pitchDeg;
    if (flight.syncAircraft) flight.syncAircraft();
  }

  // Start a mission for the shot's HUD. Screenshot staging unlocks all
  // missions in memory only (no completion happens in posed mode, so
  // nothing is ever written to storage from here).
  function startForShot(index, freeFallback) {
    if (!missions || typeof missions.start !== 'function') return false;
    if (typeof missions.unlocked === 'number' && index >= 0) {
      missions.unlocked = Math.max(missions.unlocked, index);
    }
    if (index >= 0 && missions.start(index)) return true;
    return missions.start(freeFallback || 'free');
  }

  function applyShot(name) {
    if (SHOT_NAMES.indexOf(name) === -1) return false;
    const rw = WORLD.runway;
    // Rings fly the z = 330 line; the runway sits on the south beach
    // at rw.z, so the landing shot uses the runway line instead.
    const ringZ = WORLD.rings[0].z;

    if (name === 'cover') {
      // H3 — dramatic cover: ~300 m short of ring 2 (620, 80, -120)
      // over open sea east of Garuda, heading NNW (yaw 26) so the
      // low WSW sun sits ~75 deg off the nose — out of frame —
      // instead of dead ahead blowing the plane white. Try 1
      // (eastbound on the ring line, -230/330) failed: ring 1 sits
      // over the Garuda island cone, so the frame was land + a wall
      // of cream cloud, not sea. This pose keeps the old frame's
      // money (open sea below, sunlit tail, volcano ahead) with the
      // ring now BIG ahead and Merapi Kecil looming beyond it.
      // Throttle 0.7 keeps the afterburner off; shot glare 0.15.
      startForShot(1, 'free');
      pose(750, 90, 150, 26, 0, 70, 0.7, 0);
      render.setView('chase');
      if (render && typeof render.setShotGlare === 'function') render.setShotGlare(0.15);
    } else if (name === 'cockpit') {
      // Cockpit view, ~150 m short of ring 1 (120, 60, 330) so the
      // gold ring + number board fill the view ahead instead of
      // reading as a distant speck; instruments lit, tapes + TAWS live.
      // R2-10: a small right glance (addLook -60) swings the far
      // white ring off the right altitude tape — the first try (+60)
      // swung it ONTO the tape instead. Verified visually, not by
      // sign reasoning.
      startForShot(1, 'free');
      pose(-30, 65, ringZ, -90, 0, 55, 0.65);
      render.setView('cockpit');
      if (render && typeof render.addLook === 'function') render.addLook(-60, 0);
    } else if (name === 'boss') {
      // Boss finale (sortie 12): storm on, dusk pinned via ?time=.
      // Rajawali banked 15 deg at 80 m/s, ~90 m short of storm ring 7
      // (-900, 70, -400) so the gold storm ring reads big ahead, with
      // drone 3 on the same spot in frame. (A northbound pose inside
      // the cell was tried and reverted: at ~1 fps the chase camera
      // never settles on the new yaw in the screenshot window and
      // storm ring 4 never entered the frame.)
      // R2-11g: pose at boss ring 7, not ring 1 — drone 3 sits ON
      // ring 7 (-900, -400, 95), so a ~90 m approach from the SE
      // puts the drone BETWEEN the chase camera and the big gold
      // ring with the dark storm cell (-300, -800) as the backdrop,
      // instead of the ring-1 pose where all three drones sit
      // hundreds of metres off-frame. R2-11d proved a ring-3 pose
      // costs the composition (green hill, ring out of frame at
      // 60 m); ring 7 is over open sea inside the cell, so the
      // closer approach keeps sea + dark cloud behind the drone
      // instead of a hill. HUD still names ring 1 (posed staging —
      // the mission's current ring never advances in a still).
      // Storm is switched on here (posed frames never run the live
      // storm branch in main.js) so setTimeOfDay below picks the
      // overcast env map.
      // R2-10: pin the storm — setShotHold forces intensity 1 at
      // once (posed frames never re-run setTimeOfDay, so the old
      // eased ramp never darkened the sky), builds one bolt ahead
      // of the plane and holds it + heavy rain in frame. Throttle
      // 0.7 keeps the afterburner off so the livery is not blown
      // out a second time. Normal-play lightning is untouched.
      startForShot(11, 'free');
      // R2-11d: spawn the boss drones in the posed frame too —
      // weapons.update only runs in live play, so a posed boss
      // shot would otherwise never arm the weapon HUD line. One
      // tick spawns them at their anchors (setSortie 'boss'); the
      // posed frame freezes them there. At this ring-7 pose drone 3
      // sits ~72 m ahead of the camera, in frame by design.
      if (typeof window !== 'undefined' && window.__flightGame
          && window.__flightGame.weapons
          && typeof window.__flightGame.weapons.update === 'function') {
        window.__flightGame.weapons.update(0.016, false, 'boss');
      }
      // R2-11g try 2: plane at ring height (y 72 vs ring 70) and
      // 120 m short — try 1 (y 95, 90 m) put the ring's centre at
      // screen (656, 570), low and hidden behind the plane/terrain
      // while the drone sat at (604, 432). At ring height the gold
      // torus should sit at frame centre with the drone above it.
      pose(-815, 72, -315, 45, 0, 80, 0.7, 15);
      render.setView('chase');
      if (render && typeof render.setStorm === 'function') render.setStorm(true);
      if (render && render.weather && typeof render.weather.setShotHold === 'function') {
        render.weather.setShotHold(flight.state);
      }
    } else if (name === 'hangar') {
      // Hangar/dispatch screen: no flight pose — the plane stays
      // parked on the runway behind the hangar panel; main.js opens
      // the hangar screen for this shot name. Time pin still applies
      // (golden-hour tarmac behind the panel).
    } else if (name === 'rings') {
      // Just short of the first ring (120, 60, 330): the orange ring
      // fills the view ahead, the plane about to fly through it.
      // Banked 32 deg at 70 m/s: contrails streaming + wind streaks
      // at the frame edges as the plane dives for the ring.
      startForShot(1, 'free');
      pose(-60, 60, ringZ, -90, 0, 70, 0.75, 32);
      render.setView('chase');
    } else if (name === 'landing') {
      // Final approach from the west, nose slightly down, throttle
      // back: the lit runway and the yellow touchdown zone ahead.
      // R4-4 retake: 150 m out from the touchdown-zone start (-290)
      // and 36 m up, so the asphalt strip, the yellow zone and the
      // lit threshold fill the frame instead of reading as a thin
      // distant strip. Gear down for the shot (R4-2).
      startForShot(3, 'free');
      pose(-440, 36, rw.z, -90, -3, 46, 0.35);
      flight.state.gearDown = true;
      flight.state.gearDeploy = 1;
      render.setView('chase');
      // Slight 3/4 rear orbit: straight chase hides the main wheels
      // edge-on behind the wing, so the gear never reads. A small
      // offset shows both main wheels as discs + the tail wheel
      // while the runway stays in frame. (snap() below keeps it.)
      if (render && typeof render.addLook === 'function') {
        render.addLook(-70, -40);
      }
    }

    // Teleporting the plane leaves the camera far behind: snap it to
    // the posed view so the very next frame already shows the shot.
    if (render && typeof render.snap === 'function') render.snap();

    // Pin the time of day for the shot (golden hour unless ?time=
    // was given): posed shots freeze physics, so the clock never
    // advances them away from the pinned hour.
    if (render && typeof render.setTimeOfDay === 'function') {
      render.setTimeOfDay(shotHour);
    }

    current = name;
    return true;
  }

  // Apply the ?shot= preset from the URL at load, if one was given.
  const query = readQuery();
  const wanted = query.get('shot');
  // ?time= pins the shot's hour (e.g. ?shot=landing&time=18.5);
  // without it the shot stays at golden hour.
  const timeRaw = query.get('time');
  const timeParsed =
    timeRaw !== null && timeRaw !== '' ? parseFloat(timeRaw) : NaN;
  if (Number.isFinite(timeParsed)) {
    shotHour = ((timeParsed % 24) + 24) % 24;
  }
  let shotName = null;
  if (wanted && SHOT_NAMES.indexOf(wanted) !== -1) {
    if (applyShot(wanted)) shotName = wanted;
  }
  const seedRaw = query.get('seed');
  const seed = seedRaw !== null && seedRaw !== '' ? parseInt(seedRaw, 10) : null;

  return {
    SHOT_NAMES,
    applyShot,
    shotName,
    shotHour,
    seed: Number.isFinite(seed) ? seed : null,
    current() {
      return current;
    },
  };
}
