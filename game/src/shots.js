// Garuda Skies — screenshot camera presets (?shot=cover|cockpit|rings|landing).
// Written fresh from the prose spec. Each preset poses the plane in the
// air (or on approach) in front of what the shot is about, starts the
// matching mission so the HUD shows a real objective, and picks the
// matching camera. The seed in the URL is read here too and reported back;
// main.js owns the RNG itself, from the same query string.

import { WORLD } from './config.js';

const DEG = Math.PI / 180;

export const SHOT_NAMES = ['cover', 'cockpit', 'rings', 'landing'];

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
    if (typeof missions.unlocked === 'number') {
      missions.unlocked = Math.max(missions.unlocked, 4);
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
      // H3 — dramatic cover: east of Garuda over open sea, heading
      // WNW (yaw 62, bearing ~298) so the frame holds the low sun and
      // its glint path on the left, Merapi Kecil looming on the right,
      // and rings 2 and 3 in the middle distance. Lower (100 m) at
      // 70 m/s. Banked 0 deg on purpose: a banked pose turns the plane
      // while the screenshot waits, and the turn walks the sun out of
      // the frame; wings-level locks the sun/Merapi composition.
      startForShot(1, 'free');
      pose(1650, 100, 100, 62, 0, 70, 0.7, 0);
      render.setView('chase');
    } else if (name === 'cockpit') {
      // Cockpit view on the same approach, lower, instruments lit.
      startForShot(1, 'free');
      pose(-350, 85, ringZ, -90, 0, 55, 0.65);
      render.setView('cockpit');
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
      // Close enough (340 m out) that the asphalt strip reads clearly.
      // Posed at 30 m (was 38 m) so the plane's shadow falls close
      // enough to read in the frame instead of far down the beach.
      startForShot(3, 'free');
      pose(-560, 30, rw.z, -90, -3, 46, 0.35);
      render.setView('chase');
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
