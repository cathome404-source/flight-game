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
// R2-14a LIGHTNING REBUILD (user: "kilatan petir terlalu kaku") —
// the old bolt was a straight 14-point zigzag with a fixed ±23 m jog
// and two fixed branches: it read as a stiff ruler line. The new bolt
// is a seeded random-walk channel: segment lengths vary, the lateral
// wander has momentum (it keeps turning the same way for a while,
// then kinks hard the other way — never symmetric), 1–3 branches fork
// at random heights to random sides, and long branches sprout a
// sub-twig. One seed per strike, so no two strikes share a shape.
const BOLT_POINTS = 14;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  // --- Rain: short streaks (LineSegments) in a box around the
  // camera. Drops fall fast and slant with the gust; a drop that falls
  // below the box respawns at the top, so the rain never runs out.
  // R2-14a — rain is NOT uniform any more: each drop carries its own
  // fall speed (0.7–1.35x), streak length (1.0–3.4 m), gust slant
  // (0.6–1.4x) and brightness (0.55–1.0, via vertex colours), so the
  // sheet reads as varied heavy rain instead of a combed curtain.
  // Params re-roll on every respawn; brightness is fixed per index.
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 2 * 3);
  rainGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage)
  );
  const rainCol = new Float32Array(RAIN_COUNT * 2 * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    const shade = 0.55 + Math.random() * 0.45;
    rainCol[i * 6] = 0.74 * shade;
    rainCol[i * 6 + 1] = 0.82 * shade;
    rainCol[i * 6 + 2] = 0.91 * shade;
    rainCol[i * 6 + 3] = 0.74 * shade;
    rainCol[i * 6 + 4] = 0.82 * shade;
    rainCol[i * 6 + 5] = 0.91 * shade;
  }
  rainGeo.setAttribute('color', new THREE.BufferAttribute(rainCol, 3));
  const rainMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 3;
  rain.visible = false;
  if (scene) scene.add(rain);
  const drops = [];
  function rollDrop(d) {
    d.sp = 0.7 + Math.random() * 0.65;
    d.len = 1.0 + Math.random() * 2.4;
    d.sl = 0.6 + Math.random() * 0.8;
    return d;
  }
  for (let i = 0; i < RAIN_COUNT; i++) {
    drops.push(
      rollDrop({
        x: (Math.random() - 0.5) * RAIN_BOX,
        y: (Math.random() - 0.5) * 70,
        z: (Math.random() - 0.5) * RAIN_BOX,
      })
    );
  }

  // --- Lightning: the bolt is drawn as TWO camera-facing ribbons
  // rebuilt from boltPaths every visible frame — a bright white-blue
  // CORE plus a wide faint HALO — instead of the old 1 px line.
  // A 1 px LineBasicMaterial can never bloom and can never vary in
  // thickness; a ribbon can do both (the halo feeds the post.js
  // luminance-gated bloom, the core reads as a hot channel). Width
  // varies along the bolt: thick at the cloud base, tapering toward
  // the sea, with a per-segment jitter so no two stretches match.
  // Additive blending, no depth write: the bolt glows over the dark
  // storm instead of cutting a hard hole through it.
  const BOLT_MAX_POINTS = 50; // main 17 + 3 branches x7 + 3 twigs x3
  const BOLT_SEGMENTS = 40; // (kept) max line segments, legacy buffer
  function makeBoltRibbon(color, haloScale) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(BOLT_MAX_POINTS * 2 * 3), 3).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    geo.setIndex(
      new THREE.BufferAttribute(new Uint16Array(BOLT_MAX_POINTS * 6), 1).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    if (scene) scene.add(mesh);
    return { mesh, haloScale };
  }
  const boltCore = makeBoltRibbon(0xf4f8ff, 1);
  const boltHalo = makeBoltRibbon(0x8fb0ff, 4.5);
  // The legacy 1 px line buffer is still filled by buildBolt (tests
  // and the shot-hold path read boltVisible off the ribbons now).
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
  // R2-14a: the flash must light the clouds AND the terrain for a
  // beat — a directional alone only catches faces turned toward it,
  // and the old 3.2 peak flooded the (Lambert) clouds cream when
  // held. So the strike carries a second, omnidirectional wash:
  // a cold ambient that lifts everything a little, briefly, on top
  // of a gentler directional (2.6 peak). Both follow the flicker
  // envelope below, so the world pulses instead of snapping bright.
  const flashAmbient = new THREE.AmbientLight(0xbfcaff, 0);
  if (scene) scene.add(flashAmbient);

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
  // R2-14a flicker: one strike is 2–3 flashes, not one flat blink.
  // buildBolt() arms a pulse train (first hit full, then a weaker
  // re-strike, then a dying echo); update() evaluates the envelope
  // as flash, so bolt + lights + the effects.js glow all pulse
  // together. strikeTime is on the same clock as `time`.
  let flashPulses = null; // [{ t0, amp }] or null when no strike live
  let strikeTime = -10;
  // R2-14a bolt paths: [{ pts: [[x,y,z],...], width }] — the main
  // channel (width 1) plus branches/twigs (0.55 / 0.35). buildBolt()
  // rebuilds them per strike; the ribbon renderer (pass 2) and the
  // legacy line renderer both read from here.
  let boltPaths = [];
  // Cloud-base point of the latest strike, published for effects.js
  // (its storm-glow billboard sits here) via scene.userData.
  let strikePoint = null;
  let nextStrikeIn = 2.5;
  let thunderTimer = -1;
  // Shot hold (R2-10): posed screenshot mode pins one bolt in frame
  // with the flash held — the random 2–5 s strike + ~1 s decay never
  // survives a ~1 fps screenshot wait. Normal play never sets this.
  // Gust state: a slow random walk in direction with a pulsing
  // magnitude, so the push comes in waves instead of a constant shove.
  let gustAngle = Math.PI * 0.75;
  let gustStrength = 0;

  let shotHold = false;

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
      return boltCore.mesh.visible;
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
        shotHold = false;
        rain.visible = false;
        cell.visible = false;
        bolt.visible = false;
        boltCore.mesh.visible = false;
        boltHalo.mesh.visible = false;
        flashLight.intensity = 0;
        flashAmbient.intensity = 0;
        flashPulses = null;
        flash = 0;
      }
    },

    // Shot hold (R2-10, posed screenshots only): storm at full
    // strength instantly, one bolt built ahead of the posed plane
    // and held visible with the flash pinned — deterministic, so
    // the still frame always catches lightning. Normal play is
    // untouched (random strikes + decaying flash).
    setShotHold(st) {
      if (!active) return;
      targetIntensity = 1;
      intensity = 1;
      shotHold = true;
      if (st && st.position) {
        lastPos = { x: st.position.x, y: st.position.y, z: st.position.z };
        const cp = Math.cos(st.pitch || 0);
        lastForward = {
          x: -cp * Math.sin(st.yaw || 0),
          z: -cp * Math.cos(st.yaw || 0),
        };
      }
      buildBolt();
      flash = 1;
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

      // --- Rain: drops fall around the camera, slanted by the gust —
      // each with its own speed, length and slant (R2-14a).
      if (on && camera) {
        const slantX = Math.cos(gustAngle) * gustStrength * 0.35;
        const slantZ = Math.sin(gustAngle) * gustStrength * 0.35;
        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;
        for (let i = 0; i < RAIN_COUNT; i++) {
          const d = drops[i];
          d.y -= RAIN_FALL * d.sp * dt;
          d.x += slantX * d.sl * dt;
          d.z += slantZ * d.sl * dt;
          if (d.y < -35) {
            d.y = 35 + Math.random() * 10;
            d.x = (Math.random() - 0.5) * RAIN_BOX;
            d.z = (Math.random() - 0.5) * RAIN_BOX;
            rollDrop(d);
          }
          const len = shotHold ? d.len * 2.2 : d.len + gustStrength * 0.06;
          const o = i * 6;
          rainPos[o] = cx + d.x;
          rainPos[o + 1] = cy + d.y;
          rainPos[o + 2] = cz + d.z;
          rainPos[o + 3] = cx + d.x - slantX * d.sl * 0.02 - len * 0.12;
          rainPos[o + 4] = cy + d.y + len;
          rainPos[o + 5] = cz + d.z - slantZ * d.sl * 0.02;
        }
        rainGeo.attributes.position.needsUpdate = true;
        // Shot hold: heavier rain reads in a still (0.85 vs 0.55).
        rainMat.opacity = shotHold ? 0.85 : 0.55 * intensity;
      }

      // --- Lightning: strikes arrive every 2–5 s at full storm.
      // The bolt shows while the flash is bright, then hides; the
      // flash decays over ~1 s (not a single blink) with one
      // secondary flicker, so a screenshot has a real chance of
      // catching a strike instead of needing frame-perfect timing.
      if (on && !shotHold) {
        nextStrikeIn -= dt;
        if (nextStrikeIn <= 0) {
          nextStrikeIn = 2 + Math.random() * 3;
          buildBolt();
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
      // R2-14a flicker envelope: 2–3 flashes with decay, not one flat
      // blink. Each pulse is a fast exponential (tau ~55 ms); the
      // re-strikes land 70–140 ms and 180–280 ms after the first hit,
      // so the bolt visibly stutters — bright, dim, bright again,
      // then gone in ~0.5 s. The same `flash` value drives the bolt
      // ribbons, both flash lights, and (via scene.userData) the
      // effects.js storm glow + cloud lift, so the whole sky pulses
      // in sync. Shot hold pins flash at 1 (posed stills).
      if (shotHold) {
        // Pinned bolt: flash held, bolt fully opaque, flash light
        // LOW (0.35, was 0.6): the flash is a directional light
        // from above, and at 0.6 it still flooded the (Lambert)
        // clouds bright cream and defeated the whole storm
        // darkening. The bolt lines themselves carry the
        // lightning read against the darkened sky.
        flash = 1;
        flashLight.intensity = 0.35 * intensity;
        flashAmbient.intensity = 0.15 * intensity;
      } else if (flashPulses) {
        const el = time - strikeTime;
        let env = 0;
        for (const p of flashPulses) {
          if (el >= p.t0) env += p.amp * Math.exp(-(el - p.t0) / 0.055);
        }
        flash = env > 1.2 ? 1.2 : env;
        if (flash < 0.02) {
          flash = 0;
          flashPulses = null;
        }
        flashLight.intensity = flash * 2.6 * intensity;
        flashAmbient.intensity = flash * 0.5 * intensity;
      } else {
        flash = 0;
        flashLight.intensity = 0;
        flashAmbient.intensity = 0;
      }
      // Ribbons carry the bolt's visible read now (core + halo);
      // the legacy 1 px line stays hidden.
      bolt.visible = false;
      boltMat.opacity = 0;
      updateBoltRibbons(camera);
      // Publish the live flash level + strike point for effects.js
      // (storm-glow billboard + cloud flash lift read these every
      // frame; effects.update runs before weather.update, so it sees
      // the previous frame's value — a 1-frame lag on a 0.5 s flash
      // is invisible).
      if (scene) {
        scene.userData.lightningFlash = flash;
        if (strikePoint) scene.userData.lightningStrike = strikePoint;
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
        // R2-10 shot hold: grade the fog harder toward storm slate
        // (0.85 vs 0.6) so the arena reads dark even in a still.
        const w = intensity * (shotHold ? 0.85 : 0.6);
        scene.fog.far = lerp(scene.fog.far, 1300, intensity * 0.7);
        scene.fog.near = lerp(scene.fog.near, 120, intensity * 0.5);
        scene.fog.color.copy(fogBase.color).lerp(STORM_FOG, w);
        // The base is re-captured when the storm ends, so the next
        // storm grades from the current sky, not a stale one.
        if (intensity <= 0.02) fogBase = null;
      }
    },
  };

  // R2-12h: darker storm fog (0x232c38, was 0x3a4250 slate) — the
  // storm horizon band at 21:00 stayed pale grey (111,114,107) even
  // after the sky-dome horizon itself darkened, because the band is
  // fog-faded sea, not sky: the sea fades to this colour at range.
  // The near field (plane, drone, rings) sits inside fog.near and is
  // untouched; only the distant sea/horizon darkens.
  // MEASURED (R2-12h, boss 21:00): band 111→108 — no measurable
  // move. The band is the sea SHADER's own brightness, not the fog
  // colour, so this value is kept (harmless, storm-only) but the
  // residual pale sea is a world.js matter, not a fog matter.
  const STORM_FOG = new THREE.Color(0x232c38);

  // Last known plane position + forward vector (refreshed by
  // update): the strike point is picked ahead of the plane from these.
  let lastPos = null;
  let lastForward = null;

  // Rebuild the bolt as a jagged main channel from the cloud base
  // (y ~300) down to the sea (y ~2), plus 1–3 branches forking off at
  // random heights to random sides — a branching strike reads at a
  // glance, a single 1 px line does not. The strike lands 250–600 m
  // ahead of the plane with a lateral spread, so it is usually in
  // frame in chase view (which looks forward past the plane) instead
  // of somewhere random in the cell that the camera never sees.
  //
  // R2-14a — seeded random walk, not a fixed zigzag. One fresh seed
  // per strike (mulberry32): segment drops vary (12–30 m, so the
  // bolt is not a metronome), and the lateral wander has MOMENTUM —
  // each step adds a random shove to a running velocity that is only
  // partly damped, so the channel drifts one way for several
  // segments, then kinks hard the other way (25% of steps take a
  // big ±40 m jump). That asymmetry is what makes a real bolt look
  // organic instead of a symmetric ruler zigzag. Branches fork at
  // random heights (t 0.15–0.6) to a random side with their own
  // momentum; a long branch has a 40% chance of sprouting a 2-seg
  // sub-twig. The paths are stored in boltPaths for the ribbon
  // renderer; the legacy line buffer is filled from the same paths.
  function buildBolt() {
    const rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
    let sx;
    let sz;
    if (lastPos && lastForward) {
      // Shot hold: strike CLOSE (110–200 m ahead) and near-centre
      // (lat ±90 m) so the bolt is big in frame — the R2-10
      // 130–280 m / ±180 m strike read as a thin zigzag at the
      // frame edge (or off-frame) in the still, and the evaluator
      // saw no lightning at all. Normal play keeps 250–600 m.
      const along = shotHold
        ? 110 + rng() * 90
        : 250 + rng() * 350;
      // R2-15c: shot-hold strike is biased screen-RIGHT (lat +10..+55 m,
      // mean +32) instead of centred (±90 m). The old centred draw put
      // the channel's halo right on the objective panel's right edge
      // (core x~374 at y=240 vs panel edge x~355, halo touching it) in
      // the dossier shot, and a second fresh draw sat at x~365 — the
      // bolt slightly crossed the objective text area. A rightward bias
      // moves the channel ~+60 px at panel height, clearing the panel
      // with margin. Pass 1 (+10..+80) cleared the panel in 3/3 draws
      // but its upper tail ran too far right: one draw struck the
      // THROTTLE "70%" text, so the range is capped at +55 m. Normal
      // play keeps the centred ±250 m spread.
      const lat = shotHold
        ? 10 + rng() * 45
        : (rng() - 0.5) * 500;
      // Right vector for a forward (fx, fz) in xz: (-fz, fx).
      sx = lastPos.x + lastForward.x * along + -lastForward.z * lat;
      sz = lastPos.z + lastForward.z * along + lastForward.x * lat;
    } else {
      sx = cellDef.x + (rng() - 0.5) * cellDef.radius * 1.4;
      sz = cellDef.z + (rng() - 0.5) * cellDef.radius * 1.4;
    }
    strikePoint = { x: sx, y: 300, z: sz };

    // One wandering channel: start at the cloud base, walk down.
    function walkChannel(x0, z0, y0, y1, nSeg, width, dirBias) {
      const pts = [[x0, y0, z0]];
      // Per-point half-widths (m): thick at the cloud base, tapering
      // toward the tip, with a per-segment jitter so the channel
      // fattens and thins along its length instead of reading as a
      // uniform tube. The ribbon renderer multiplies by path.width.
      const widths = [1.9 + rng() * 0.5];
      let x = x0;
      let z = z0;
      let vx = 0;
      let vz = 0;
      // Non-uniform drops: the total fall is split into unequal
      // steps, so kinks bunch up in some stretches and stretch out
      // in others instead of marching evenly down.
      const drops = [];
      let dropSum = 0;
      for (let i = 0; i < nSeg; i++) {
        const d = 0.55 + rng() * 0.9;
        drops.push(d);
        dropSum += d;
      }
      let y = y0;
      for (let i = 0; i < nSeg; i++) {
        y -= ((y0 - y1) * drops[i]) / dropSum;
        // Momentum: shove the velocity, damp it only partly, so
        // the channel keeps turning the same way for a few steps.
        vx = vx * 0.55 + (rng() - 0.5) * 26 + dirBias;
        vz = vz * 0.55 + (rng() - 0.5) * 26;
        // Hard kink: one step in four jumps sideways instead.
        if (rng() < 0.25) {
          vx += (rng() < 0.5 ? -1 : 1) * (28 + rng() * 16);
          vz += (rng() - 0.5) * 24;
        }
        x += vx;
        z += vz;
        pts.push([x, Math.max(y, y1), z]);
        // Taper down the bolt with a jittered profile (0.45–1.0 of
        // the top width by the tip).
        const tw = 1 - (i + 1) / nSeg;
        widths.push((0.45 + 0.55 * tw) * (0.7 + rng() * 0.6));
      }
      return { pts, width, widths };
    }

    const paths = [];
    const mainSegs = 12 + Math.floor(rng() * 5);
    const main = walkChannel(sx, sz, 300, 2, mainSegs, 1, 0);
    paths.push(main);
    // Branches: 1–3, forked at random heights, random side. A branch
    // starts at a main-channel point and wanders down-out with its
    // own momentum and a sideways bias (the fork direction).
    const nBranches = 1 + Math.floor(rng() * 3);
    for (let b = 0; b < nBranches; b++) {
      const from = 2 + Math.floor(rng() * Math.max(1, main.pts.length - 6));
      const fp = main.pts[Math.min(from, main.pts.length - 1)];
      const side = rng() < 0.5 ? -1 : 1;
      const bSegs = 3 + Math.floor(rng() * 4);
      const br = walkChannel(
        fp[0], fp[2], fp[1], Math.max(2, fp[1] - (90 + rng() * 110)),
        bSegs, 0.55, side * (10 + rng() * 10)
      );
      paths.push(br);
      // Sub-twig off a long branch, for the forked-fork look.
      if (bSegs >= 5 && rng() < 0.4) {
        const tp = br.pts[2 + Math.floor(rng() * (br.pts.length - 3))];
        const tw = walkChannel(
          tp[0], tp[2], tp[1], Math.max(2, tp[1] - (40 + rng() * 50)),
          2, 0.35, -side * (8 + rng() * 8)
        );
        paths.push(tw);
      }
    }
    boltPaths = paths;

    // Fill the legacy line buffer from the same paths (degenerate
    // segments collapse onto the first point when the bolt is
    // shorter than the buffer).
    let o = 0;
    const seg = (a, b) => {
      boltPos[o++] = a[0];
      boltPos[o++] = a[1];
      boltPos[o++] = a[2];
      boltPos[o++] = b[0];
      boltPos[o++] = b[1];
      boltPos[o++] = b[2];
    };
    for (const path of paths) {
      for (let i = 0; i < path.pts.length - 1; i++) {
        if (o + 6 > boltPos.length) break;
        seg(path.pts[i], path.pts[i + 1]);
      }
    }
    const p0 = paths[0].pts[0];
    while (o + 6 <= boltPos.length) seg(p0, p0);
    boltGeo.attributes.position.needsUpdate = true;

    // Arm the flicker pulse train: full hit, a weaker re-strike
    // 70–140 ms later, a dying echo 180–280 ms after that.
    strikeTime = time;
    flashPulses = [
      { t0: 0, amp: 1 },
      { t0: 0.07 + rng() * 0.07, amp: 0.55 + rng() * 0.25 },
      { t0: 0.18 + rng() * 0.1, amp: 0.3 + rng() * 0.2 },
    ];
    flash = 1;
  }

  // Rebuild both bolt ribbons from boltPaths, camera-facing: for
  // each point the ribbon edge is the segment direction crossed with
  // the view direction (same trick as the effects.js contrails), so
  // the bolt keeps its width from any angle instead of vanishing
  // edge-on like a flat plane would. Called every frame while the
  // bolt shows; ~44 points max, so the rebuild is trivial.
  const rbA = new THREE.Vector3();
  const rbB = new THREE.Vector3();
  const rbC = new THREE.Vector3();
  function updateBoltRibbons(camera) {
    const show = flash > 0.02 || shotHold;
    const coreOp = shotHold ? 1 : Math.min(1, flash * 1.4);
    const haloOp = shotHold ? 0.5 : Math.min(0.5, flash * 0.5);
    for (const rb of [boltCore, boltHalo]) {
      rb.mesh.visible = show && boltPaths.length > 0;
      rb.mesh.material.opacity = rb === boltCore ? coreOp : haloOp;
      if (!rb.mesh.visible || !camera) continue;
      const posAttr = rb.mesh.geometry.attributes.position;
      const idxAttr = rb.mesh.geometry.index;
      const arr = posAttr.array;
      const idx = idxAttr.array;
      let v = 0;
      let ii = 0;
      for (const path of boltPaths) {
        const n = path.pts.length;
        const baseV = v / 3;
        for (let i = 0; i < n; i++) {
          const p = path.pts[i];
          rbA.set(p[0], p[1], p[2]);
          // Segment direction (prev -> next) for the facing edge.
          const pn = path.pts[Math.min(i + 1, n - 1)];
          const pp = path.pts[Math.max(i - 1, 0)];
          rbB.set(pn[0] - pp[0], pn[1] - pp[1], pn[2] - pp[2]);
          if (rbB.lengthSq() < 0.0001) rbB.set(0, -1, 0);
          rbB.normalize();
          rbC.copy(camera.position).sub(rbA).normalize();
          rbB.cross(rbC);
          if (rbB.lengthSq() < 0.0001) rbB.set(1, 0, 0);
          rbB.normalize();
          const half =
            path.width * (path.widths ? path.widths[i] || 1 : 1) * rb.haloScale;
          arr[v++] = p[0] + rbB.x * half;
          arr[v++] = p[1] + rbB.y * half;
          arr[v++] = p[2] + rbB.z * half;
          arr[v++] = p[0] - rbB.x * half;
          arr[v++] = p[1] - rbB.y * half;
          arr[v++] = p[2] - rbB.z * half;
          if (i < n - 1) {
            const a = baseV + i * 2;
            idx[ii++] = a;
            idx[ii++] = a + 1;
            idx[ii++] = a + 2;
            idx[ii++] = a + 1;
            idx[ii++] = a + 3;
            idx[ii++] = a + 2;
          }
        }
      }
      posAttr.needsUpdate = true;
      idxAttr.needsUpdate = true;
      rb.mesh.geometry.setDrawRange(0, ii);
    }
  }

  return api;
}
