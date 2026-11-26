// Garuda Skies — storm weather: rain streaks, lightning, gusts, storm cell.
// Written fresh from the R2 prose spec (§4 boss finale, §7 rain pattern).
// Owns the boss storm's look and feel: a dark cloud cell over the sea,
// heavy rain around the camera, lightning bolts + flash + thunder, and
// slow-wandering gusts that push the plane. The flight module reads the
// gust vector each frame; render.js calls update() after the cloud fog.

import { WORLD } from './config.js';

const RAIN_COUNT = 520;
const RAIN_FALL = 95; // m/s the drops fall (heavy storm rain)
const RAIN_BOX = 90; // rain lives in a box this wide around the camera
const BOLT_POINTS = 14;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function createWeather(scene) {
  // --- Storm cell: a cluster of big dark cloud masses over the sea,
  // centred on the boss arena. Flat-shaded dark standard material so
  // the cell reads as a heavy thunderhead, not golden-hour cotton.
  const cellDef = (WORLD && WORLD.stormCell) || { x: -300, z: -800, radius: 900 };
  const cell = new THREE.Group();
  cell.name = 'storm-cell';
  const cellMat = new THREE.MeshStandardMaterial({
    color: 0x232833,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const cellGeo = new THREE.SphereGeometry(1, 10, 8);
  // Deterministic layout so the cell looks the same every load.
  let s = 987654321;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(cellGeo, cellMat);
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * cellDef.radius * 0.85;
    m.position.set(
      cellDef.x + Math.cos(ang) * rad,
      250 + rnd() * 130,
      cellDef.z + Math.sin(ang) * rad
    );
    m.scale.set(130 + rnd() * 130, 34 + rnd() * 30, 110 + rnd() * 110);
    m.rotation.y = rnd() * Math.PI;
    cell.add(m);
  }
  cell.visible = false;
  if (scene) scene.add(cell);

  // --- Rain: short vertical streaks (LineSegments) in a box around the
  // camera. Drops fall fast and slant with the gust; a drop that falls
  // below the box respawns at the top, so the rain never runs out.
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 2 * 3);
  rainGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage)
  );
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xbdd2e8,
    transparent: true,
    opacity: 0,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 3;
  rain.visible = false;
  if (scene) scene.add(rain);
  const drops = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    drops.push({
      x: (Math.random() - 0.5) * RAIN_BOX,
      y: (Math.random() - 0.5) * 70,
      z: (Math.random() - 0.5) * RAIN_BOX,
    });
  }

  // --- Lightning: a jagged bolt (LineSegments: one main channel plus
  // two branches, so it reads as a branching strike instead of a
  // single 1 px line) from the cloud base to the sea, rebuilt on every
  // strike, plus a cold flash light that floods the scene for a
  // fraction of a second. The bolt is hidden between strikes; the
  // flash decays so the light never snaps.
  const BOLT_SEGMENTS = 13 + 5 + 4;
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(BOLT_SEGMENTS * 2 * 3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
  const boltMat = new THREE.LineBasicMaterial({
    color: 0xe8f0ff,
    transparent: true,
    opacity: 0,
  });
  const bolt = new THREE.LineSegments(boltGeo, boltMat);
  bolt.frustumCulled = false;
  bolt.renderOrder = 3;
  bolt.visible = false;
  if (scene) scene.add(bolt);
  const flashLight = new THREE.DirectionalLight(0xcfd8ff, 0);
  flashLight.position.set(cellDef.x, 600, cellDef.z);
  if (scene) scene.add(flashLight);
  if (scene) scene.add(flashLight.target);

  // --- Fog memory: the storm darkens and closes the fog in while it
  // is active. The base is captured lazily on the first storm frame
  // (render.setTimeOfDay repaints the fog every frame, so the storm
  // re-applies its grade after it, every frame).
  let fogBase = null;
  let active = false;
  let intensity = 0; // 0..1, eases toward the target
  let targetIntensity = 0;
  let time = 0;
  let flash = 0;
  let nextStrikeIn = 2.5;
  let thunderTimer = -1;
  // Gust state: a slow random walk in direction with a pulsing
  // magnitude, so the push comes in waves instead of a constant shove.
  let gustAngle = Math.PI * 0.75;
  let gustStrength = 0;

  const api = {
    onThunder: null,
    get active() {
      return active;
    },
    get flash() {
      return flash;
    },
    // Bolt visibility for tests: true while a strike is showing.
    get boltVisible() {
      return bolt.visible;
    },
    // Storm strength 0..1 (eases toward the target): render.js reads
    // it to darken the sky, sun and exposure while the storm is on.
    get intensity() {
      return intensity;
    },

    setActive(on, level) {
      active = !!on;
      targetIntensity = active ? clamp(level === undefined ? 1 : level, 0, 1) : 0;
      if (!active) {
        rain.visible = false;
        cell.visible = false;
        bolt.visible = false;
        flashLight.intensity = 0;
      }
    },

    // Current gust vector (m/s, world xz) plus its strength, for the
    // flight model and the HUD wind arrow.
    gust() {
      return {
        x: Math.cos(gustAngle) * gustStrength,
        z: Math.sin(gustAngle) * gustStrength,
        strength: gustStrength,
        angleDeg: (gustAngle * 180) / Math.PI,
      };
    },

    // Force a bolt right now (screenshot staging / tests).
    strike() {
      if (!active) return;
      buildBolt();
      flash = 1;
      if (api.onThunder) {
        thunderTimer = 0.15 + Math.random() * 0.5;
      }
    },

    update(dt, state, camera) {
      dt = Math.min(dt || 0.016, 0.05);
      time += dt;
      intensity += (targetIntensity - intensity) * Math.min(1, dt * 1.5);
      const on = intensity > 0.02;
      cell.visible = on;
      rain.visible = on;

      // Remember where the plane is and where it points, so the next
      // bolt can strike ahead of it (in frame) instead of somewhere
      // random in the cell that the camera never sees.
      if (state && state.position) {
        lastPos = { x: state.position.x, y: state.position.y, z: state.position.z };
        const cp = Math.cos(state.pitch || 0);
        lastForward = {
          x: -cp * Math.sin(state.yaw || 0),
          z: -cp * Math.cos(state.yaw || 0),
        };
      }

      // --- Gusts: direction wanders slowly, magnitude pulses on two
      // slow sines so the push arrives in waves (calm gaps, then a
      // hard shove). Peak ~14 m/s at full intensity — clearly felt
      // against a 55–88 m/s plane, and still flyable next to the
      // mission's steady wind instead of overwhelming it.
      const pulse =
        0.5 +
        0.3 * Math.sin(time * 0.7) +
        0.2 * Math.sin(time * 1.9 + 1.7);
      gustAngle += (Math.sin(time * 0.23) * 0.6 + Math.sin(time * 0.11 + 2.0) * 0.4) * dt * 0.35;
      gustStrength = intensity * (4 + 10 * Math.max(0, pulse));

      // --- Rain: drops fall around the camera, slanted by the gust.
      if (on && camera) {
        const slantX = Math.cos(gustAngle) * gustStrength * 0.35;
        const slantZ = Math.sin(gustAngle) * gustStrength * 0.35;
        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;
        const len = 2.2 + gustStrength * 0.06;
        for (let i = 0; i < RAIN_COUNT; i++) {
          const d = drops[i];
          d.y -= RAIN_FALL * dt;
          d.x += slantX * dt;
          d.z += slantZ * dt;
          if (d.y < -35) {
            d.y = 35 + Math.random() * 10;
            d.x = (Math.random() - 0.5) * RAIN_BOX;
            d.z = (Math.random() - 0.5) * RAIN_BOX;
          }
          const o = i * 6;
          rainPos[o] = cx + d.x;
          rainPos[o + 1] = cy + d.y;
          rainPos[o + 2] = cz + d.z;
          rainPos[o + 3] = cx + d.x - slantX * 0.02 - len * 0.12;
          rainPos[o + 4] = cy + d.y + len;
          rainPos[o + 5] = cz + d.z - slantZ * 0.02;
        }
        rainGeo.attributes.position.needsUpdate = true;
        rainMat.opacity = 0.55 * intensity;
      }

      // --- Lightning: strikes arrive every 2–5 s at full storm.
      // The bolt shows while the flash is bright, then hides; the
      // flash decays over ~1 s (not a single blink) with one
      // secondary flicker, so a screenshot has a real chance of
      // catching a strike instead of needing frame-perfect timing.
      if (on) {
        nextStrikeIn -= dt;
        if (nextStrikeIn <= 0) {
          nextStrikeIn = 2 + Math.random() * 3;
          buildBolt();
          flash = 1;
          if (api.onThunder) thunderTimer = 0.15 + Math.random() * 0.6;
        }
      }
      if (thunderTimer >= 0) {
        thunderTimer -= dt;
        if (thunderTimer <= 0) {
          thunderTimer = -1;
          if (api.onThunder) api.onThunder();
        }
      }
      if (flash > 0) {
        flash *= Math.exp(-dt * 4);
        if (flash < 0.02) flash = 0;
        // Secondary flicker: a brief re-brightening mid-decay.
        const flicker = flash > 0.45 && flash < 0.75 ? 0.25 : 0;
        flashLight.intensity = (flash + flicker) * 3.2 * intensity;
        boltMat.opacity = Math.min(1, flash * 1.6);
        bolt.visible = flash > 0.12;
      } else {
        flashLight.intensity = 0;
        bolt.visible = false;
      }

      // --- Storm grade on the fog: darker and closer than the
      // golden-hour haze, so the arena reads as a storm, not dusk.
      // Applied after setTimeOfDay / in-cloud fog each frame.
      if (scene && scene.fog) {
        if (!fogBase) {
          fogBase = {
            near: scene.fog.near,
            far: scene.fog.far,
            color: scene.fog.color.clone(),
          };
        }
        const w = intensity * 0.6;
        scene.fog.far = lerp(scene.fog.far, 1300, intensity * 0.7);
        scene.fog.near = lerp(scene.fog.near, 120, intensity * 0.5);
        scene.fog.color.copy(fogBase.color).lerp(STORM_FOG, w);
        // The base is re-captured when the storm ends, so the next
        // storm grades from the current sky, not a stale one.
        if (intensity <= 0.02) fogBase = null;
      }
    },
  };

  const STORM_FOG = new THREE.Color(0x3a4250);

  // Last known plane position + forward vector (refreshed by
  // update): the strike point is picked ahead of the plane from these.
  let lastPos = null;
  let lastForward = null;

  // Rebuild the bolt as a jagged main channel from the cloud base
  // (y ~300) down to the sea (y ~2), plus two short branches forking
  // off the upper third — a branching strike reads at a glance, a
  // single 1 px line does not. The strike lands 250–600 m ahead of
  // the plane with a lateral spread, so it is usually in frame in
  // chase view (which looks forward past the plane) instead of
  // somewhere random in the cell that the camera never sees.
  function buildBolt() {
    let sx;
    let sz;
    if (lastPos && lastForward) {
      const along = 250 + Math.random() * 350;
      const lat = (Math.random() - 0.5) * 500;
      // Right vector for a forward (fx, fz) in xz: (-fz, fx).
      sx = lastPos.x + lastForward.x * along + -lastForward.z * lat;
      sz = lastPos.z + lastForward.z * along + lastForward.x * lat;
    } else {
      sx = cellDef.x + (Math.random() - 0.5) * cellDef.radius * 1.4;
      sz = cellDef.z + (Math.random() - 0.5) * cellDef.radius * 1.4;
    }
    // Main channel: 14 points, each jogged sideways.
    const pts = [];
    let x = sx;
    let z = sz;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const t = i / (BOLT_POINTS - 1);
      pts.push([x, lerp(300, 2, t), z]);
      x += (Math.random() - 0.5) * 46;
      z += (Math.random() - 0.5) * 46;
    }
    // Two branches forking off the main channel at 1/3 and 1/2 down.
    const branches = [
      { from: 4, n: 5, dir: 1 },
      { from: 7, n: 4, dir: -1 },
    ];
    let o = 0;
    const seg = (a, b) => {
      boltPos[o++] = a[0];
      boltPos[o++] = a[1];
      boltPos[o++] = a[2];
      boltPos[o++] = b[0];
      boltPos[o++] = b[1];
      boltPos[o++] = b[2];
    };
    for (let i = 0; i < pts.length - 1; i++) seg(pts[i], pts[i + 1]);
    for (const br of branches) {
      let bx = pts[br.from][0];
      let by = pts[br.from][1];
      let bz = pts[br.from][2];
      let px = bx;
      let py = by;
      let pz = bz;
      for (let i = 0; i < br.n; i++) {
        bx += br.dir * (18 + Math.random() * 22);
        by -= 28 + Math.random() * 20;
        bz += (Math.random() - 0.5) * 36;
        seg([px, py, pz], [bx, by, bz]);
        px = bx;
        py = by;
        pz = bz;
      }
    }
    boltGeo.attributes.position.needsUpdate = true;
  }

  return api;
}
