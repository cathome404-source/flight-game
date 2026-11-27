// Garuda Skies — grass: textured near-field ground + instanced wind-blown
// grass tufts (R2-14c). NEW module, self-contained: no other file is edited
// to use it, and it edits nothing itself — the integration session wires it
// in. Written fresh from the prose spec (no code copied from any repo).
//
// What it does, in two layers:
//
//   (1) TEXTURED GROUND — a terrain-following "meadow carpet": a displaced
//       grid hugging the relief surface around the runway, wearing the
//       vendored CC0 grass.jpg (Poly Haven leafy_grass, see
//       game/assets/SOURCES.md) tiled densely, with a procedurally baked
//       alpha mask so it only shows where real grass grows (never over the
//       sea, the sand rim, the runway, or the rock peaks). The base terrain
//       already wears the same texture at 18x (world.js R2-4b); this carpet
//       adds close-up grain in the foreground the cockpit and cover shots
//       actually rest on.
//   (2) INSTANCED GRASS — one InstancedMesh of crossed-blade tufts (a few
//       thousand instances, one draw call). Each tuft gets its own colour
//       (lush green / dry yellow-green, following the same low-frequency
//       patch field that colours the terrain, so blades match the ground
//       under them), scale and yaw. Wind sway is a vertex-shader bend
//       (no per-frame CPU matrix work): the blade tips lean with a
//       travelling sine, driven by the uTime uniform advanced in update().
//
// Density is NOT a uniform grid: it is densest near the focus point
// (default: the runway centre, where the cockpit and hangar shots sit)
// and thins out with distance, so the foreground reads as real meadow
// and the far slopes stay cheap.
//
// Grounding problem this module solves: the physics terrain
// (flight.js terrainHeightAt) is a smooth cone, but the VISIBLE terrain
// (world.js islandHeightAt) carves valleys up to 50% deep into that cone.
// Blades placed on the cone would float metres above the valley floor.
// So this module re-implements the relief height function locally
// (same hash / value-noise / fbm as world.js, same WORLD.terrain
// parameters) and plants every blade and every carpet vertex on the
// RELIEF surface — blades sit on the ground you actually see.
//
// Usage (integration session):
//
//   import { initGrass } from './grass.js';
//   const grass = initGrass(scene, {
//     focus: { x: WORLD.runway.x, z: WORLD.runway.z }, // optional
//     heightAt(x, z) { ... },                          // optional override
//     bladeCount: 6000,                                // optional
//     windStrength: 1,                                 // optional
//   });
//   // ...every frame:
//   grass.update(dt);
//   // ...on teardown:
//   grass.dispose();
//
// terrainInfo is optional entirely: initGrass(scene) works, using the
// runway as focus and the built-in relief height. heightAt, when given,
// replaces the built-in relief function (use it if the integrator can
// hand over world.js's own islandHeightAt — same result, one less copy).
// The module uses the global THREE loaded by index.html as a classic
// script (no import), like every other src/ module in this game.

import { WORLD } from './config.js';

export const GRASS_DEFAULTS = {
  // Focus point: density is highest here (runway = cockpit/hangar shots).
  focus: null, // defaults to { x: WORLD.runway.x, z: WORLD.runway.z }
  bladeCount: 6000, // instanced tufts (9 tris each -> ~54k tris, 1 draw call)
  carpetRadius: 480, // metres; carpet disc around the focus
  carpetSegments: 96, // grid resolution of the carpet (96x96 -> ~18k tris)
  textureUrl: 'assets/grass.jpg', // vendored CC0 Poly Haven leafy_grass
  seed: 20261127, // deterministic layout: identical every load
  windStrength: 1, // 0 = still, 1 = normal breeze, 2 = strong
  // Density falloff with distance from the focus (metres -> keep chance).
  densityNear: 150, // full density inside this radius
  densityFar: 720, // nothing planted past this radius
};

// --- Deterministic noise (same construction as world.js) ------------------
// Kept local so this module stays self-contained and plants blades on
// exactly the relief surface world.js renders. Any drift here would show
// as floating or buried grass, so the constants mirror world.js exactly.

function hash2(ix, iz, seed) {
  const h = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbmRelief(x, z, seed) {
  return (
    valueNoise(x * 0.0045, z * 0.0045, seed) * 0.5 +
    valueNoise(x * 0.009, z * 0.009, seed + 13) * 0.28 +
    valueNoise(x * 0.018, z * 0.018, seed + 29) * 0.14 +
    valueNoise(x * 0.036, z * 0.036, seed + 47) * 0.08
  );
}

function smooth01(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// Seeded RNG (mulberry32): the layout must be identical every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Relief ground height (mirror of world.js islandHeightAt) ------------
// Returns the height of the VISIBLE terrain at world (x, z): the tallest
// island cone at that point, carved by the relief noise, rim cliffs and
// (on the volcano) the crater dip. -1 outside every island (open sea).
// Exported so the integrator / tests can probe the same surface.

export function groundHeightAt(x, z) {
  const terrain = WORLD.terrain || {};
  const relief = terrain.relief !== undefined ? terrain.relief : 0.5;
  const rim = terrain.rimCliffStart !== undefined ? terrain.rimCliffStart : 0.88;
  let best = -1;
  for (const def of WORLD.islands) {
    const lx = x - def.x;
    const lz = z - def.z;
    const dist = Math.sqrt(lx * lx + lz * lz);
    const t = dist / def.radius;
    if (t >= 1) continue;
    const seed = def.x * 0.37 + def.z * 0.61;
    const n = fbmRelief(lx + def.x, lz + def.z, seed);
    let h = def.height * (1 - t) * (1 - relief + relief * n);
    if (def.height > 120 && t < 0.1) h *= 0.82 + 0.18 * (t / 0.1);
    if (t > rim) h *= 1 - smooth01((t - rim) / (1 - rim)) * 0.85;
    if (h > best) best = Math.max(h, 2.05);
  }
  return best;
}

// Island that owns the tallest cone at (x, z), or null over the sea.
function islandAt(x, z) {
  let best = null;
  let bestH = 0;
  for (const def of WORLD.islands) {
    const dx = x - def.x;
    const dz = z - def.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= def.radius) continue;
    const h = def.height * (1 - dist / def.radius);
    if (h > bestH) {
      bestH = h;
      best = def;
    }
  }
  return best;
}

// Low-frequency patch field (same seed recipe as terrainVertexColor):
// <0.4 = dry yellow-green meadow, >0.62 = lush grove.
function patchAt(def, lx, lz) {
  return fbmRelief(lx + def.z, lz - def.x, def.x * 0.31 + def.z * 0.47 + 91);
}

function onRunway(x, z, margin) {
  const rw = WORLD.runway;
  const m = margin || 0;
  return (
    Math.abs(x - rw.x) <= rw.length / 2 + m && Math.abs(z - rw.z) <= rw.width / 2 + m
  );
}

// True when (x, z) grows grass: on land, above the sand rim, below the
// rock line, on a gentle enough slope, and clear of the runway.
function growsGrass(heightAt, x, z) {
  if (onRunway(x, z, 6)) return false;
  const h = heightAt(x, z);
  if (h < 2.6) return false; // sand rim / beach / sea
  const def = islandAt(x, z);
  if (!def) return false;
  if (h > 0.62 * def.height) return false; // rock / volcano peak
  const e = 2;
  const slope =
    Math.max(
      Math.abs(heightAt(x + e, z) - heightAt(x - e, z)),
      Math.abs(heightAt(x, z + e) - heightAt(x, z - e))
    ) /
    (2 * e);
  return slope < 0.55; // cliffs stay bare rock
}

// Keep chance for a blade at distance d from the focus: 1.0 up close,
// fading to ~0 at densityFar. This is what makes the foreground read
// as meadow while the far slopes stay cheap.
function densityAt(d, opts) {
  if (d <= opts.densityNear) return 1;
  if (d >= opts.densityFar) return 0;
  const t = (d - opts.densityNear) / (opts.densityFar - opts.densityNear);
  return 1 - t * t * (0.55 + 0.45 * t); // 1 -> ~0.45 mid-field -> 0 far
}

// --- Blade geometry -------------------------------------------------------
// One tuft = 3 crossed blades, each a tapered, slightly bent quad strip:
// base (sway 0) -> mid (sway 0.55) -> tip (sway 1). Vertex colours shade
// dark at the root to pale at the tip; the instance colour multiplies
// the whole tuft. Double-sided so a tuft reads from every angle.

function buildTuftGeometry() {
  const positions = [];
  const colors = [];
  const sway = [];
  const indices = [];
  const w = 0.55; // blade base width, metres
  const h = 0.85; // blade height, metres
  const bend = 0.16; // tip lean, metres
  // Per-vertex brightness: root dark, tip sunlit.
  const shade = [0.55, 0.55, 0.85, 0.85, 1.18];
  for (let b = 0; b < 3; b++) {
    const a = (b * Math.PI) / 3; // 0, 60, 120 degrees
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = positions.length / 3;
    // Local blade profile in (u = across, v = up, w = lean), rotated by a.
    const prof = [
      [-w / 2, 0, 0, 0],
      [w / 2, 0, 0, 0],
      [-w * 0.32, h * 0.55, bend * 0.4, 0.55],
      [w * 0.32, h * 0.55, bend * 0.4, 0.55],
      [0, h, bend, 1],
    ];
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i];
      const x = p[0] * ca + p[2] * sa;
      const z = -p[0] * sa + p[2] * ca;
      positions.push(x, p[1], z);
      colors.push(shade[i], shade[i], shade[i]);
      sway.push(p[3]);
    }
    indices.push(
      base, base + 1, base + 3,
      base, base + 3, base + 2,
      base + 2, base + 3, base + 4
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Wind sway as a vertex-shader bend. The phase comes from world position
// so neighbouring tufts ripple instead of waving in lockstep; the bend
// is scaled by the per-vertex aSway (0 at the root, 1 at the tip), so
// tufts stay planted. uTime is advanced by the controller's update().
function makeWindMaterial() {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    // Elapsed time / wind may already have been set before the first
    // render compiled this program — pick them up from userData so an
    // early update()/setWindStrength() is not silently lost.
    shader.uniforms.uTime = { value: mat.userData.elapsed || 0 };
    shader.uniforms.uWindStrength = {
      value: mat.userData.windStrength !== undefined ? mat.userData.windStrength : 1,
    };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nattribute float aSway;'
      )
      .replace(
        '#include <begin_vertex>',
        [
          'vec3 transformed = vec3( position );',
          'vec4 gwp = vec4( transformed, 1.0 );',
          '#ifdef USE_INSTANCING',
          '  gwp = instanceMatrix * gwp;',
          '#endif',
          'gwp = modelMatrix * gwp;',
          'float swayPhase = gwp.x * 0.055 + gwp.z * 0.071;',
          'float swayAmt = aSway * uWindStrength * (0.06 + 0.05 * sin(uTime * 0.9 + swayPhase * 2.0));',
          'transformed.x += sin(uTime * 1.35 + swayPhase) * swayAmt;',
          'transformed.z += cos(uTime * 1.12 + swayPhase * 1.3) * swayAmt * 0.7;',
        ].join('\n')
      );
  };
  return mat;
}

// --- Textured ground carpet -----------------------------------------------
// A grid displaced onto the relief surface around the focus, wearing
// grass.jpg tiled densely. Its alpha mask is baked on a canvas by
// sampling growsGrass() per texel, so the carpet only exists where grass
// grows — the sea, sand, runway and rock simply show the terrain under
// it. The carpet sits 0.12 m above the relief surface with a polygon
// offset, so it never z-fights the terrain.

function buildCarpet(heightAt, focus, opts) {
  const R = opts.carpetRadius;
  const seg = opts.carpetSegments;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = focus.x + pos.getX(i);
    const z = focus.z + pos.getZ(i);
    pos.setY(i, heightAt(x, z) + 0.12);
  }
  geo.computeVertexNormals();
  // Bake the land mask into a canvas: white where grass grows, black
  // elsewhere, with a radial fade at the disc edge. 128x128 samples of
  // growsGrass() is fast (~16k height probes) and exact — the mask
  // follows the real shoreline, not a circle.
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = focus.x - R + (px / (S - 1)) * R * 2;
      const z = focus.z - R + (py / (S - 1)) * R * 2;
      const d = Math.sqrt((x - focus.x) * (x - focus.x) + (z - focus.z) * (z - focus.z));
      const radial = 1 - smooth01((d - R * 0.82) / (R * 0.18));
      const land = growsGrass(heightAt, x, z) ? 1 : 0;
      const a = Math.round(255 * radial * land);
      const o = (py * S + px) * 4;
      img.data[o] = a;
      img.data[o + 1] = a;
      img.data[o + 2] = a;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const alphaTex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x5d9c46, // flat fallback if grass.jpg fails to load
    transparent: true,
    alphaMap: alphaTex,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(focus.x, 0, focus.z);
  mesh.receiveShadow = true;
  mesh.userData.grassCarpet = true;
  // Dense tiling: the base terrain tiles grass.jpg 18x per island; the
  // carpet tiles it ~40x across its 960 m span for close-up grain.
  const loader = new THREE.TextureLoader();
  loader.load(
    opts.textureUrl,
    (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(40, 40);
      if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
      mat.map = tex;
      mat.needsUpdate = true;
    },
    undefined,
    () => {
      // Texture failed: keep the flat green fallback, game unaffected.
    }
  );
  return mesh;
}

// --- Instanced blades -----------------------------------------------------

const C_LUSH = { r: 0x4e, g: 0x94, b: 0x40 };
const C_DRY = { r: 0x8a, g: 0xa8, b: 0x4f };
const C_DEEP = { r: 0x3f, g: 0x84, b: 0x34 };

function buildBlades(heightAt, focus, opts) {
  const rng = mulberry32(opts.seed);
  const geo = buildTuftGeometry();
  const mat = makeWindMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, opts.bladeCount);
  // Matrices are planted once at init and never change per frame
  // (sway is a shader bend), so the default static usage is correct.
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const cLush = new THREE.Color(C_LUSH.r / 255, C_LUSH.g / 255, C_LUSH.b / 255);
  const cDry = new THREE.Color(C_DRY.r / 255, C_DRY.g / 255, C_DRY.b / 255);
  const cDeep = new THREE.Color(C_DEEP.r / 255, C_DEEP.g / 255, C_DEEP.b / 255);
  let placed = 0;
  let attempts = 0;
  const maxAttempts = opts.bladeCount * 40;
  while (placed < opts.bladeCount && attempts < maxAttempts) {
    attempts++;
    // Uniform in the disc, then density-thinned by distance from focus.
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * opts.densityFar;
    const x = focus.x + Math.cos(ang) * rad;
    const z = focus.z + Math.sin(ang) * rad;
    const d = Math.sqrt((x - focus.x) * (x - focus.x) + (z - focus.z) * (z - focus.z));
    if (rng() > densityAt(d, opts)) continue;
    if (!growsGrass(heightAt, x, z)) continue;
    const y = heightAt(x, z);
    // Sink the roots 0.15 m so no tuft floats on a faceted slope.
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    const s = 0.6 + rng() * 0.9; // 0.6x - 1.5x tall
    dummy.scale.set(s * (0.85 + rng() * 0.3), s, s * (0.85 + rng() * 0.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    // Colour follows the terrain patch field: dry meadows get dry
    // blades, lush groves get lush blades, plus a little jitter.
    const def = islandAt(x, z);
    const patch = def ? patchAt(def, x - def.x, z - def.z) : 0.5;
    const dry = smooth01((0.4 - patch) / 0.22);
    const lush = smooth01((patch - 0.62) / 0.22);
    color.copy(cDeep).lerp(cLush, 0.35 + lush * 0.55);
    color.lerp(cDry, dry * 0.6);
    color.multiplyScalar(0.9 + rng() * 0.2);
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false; // thousands of tiny casters would trash the 1024 shadow map
  mesh.receiveShadow = true;
  mesh.userData.grassBlades = true;
  mesh.frustumCulled = false; // one mesh spanning the whole meadow; cull per-instance is not available
  return { mesh, placed, attempts };
}

// --- Entry point ----------------------------------------------------------

export function initGrass(scene, terrainInfo) {
  if (typeof THREE === 'undefined') {
    throw new Error('initGrass: global THREE is not loaded (index.html classic script).');
  }
  const info = terrainInfo || {};
  const opts = Object.assign({}, GRASS_DEFAULTS, info);
  const focus = info.focus || {
    x: WORLD.runway.x,
    z: WORLD.runway.z,
  };
  opts.focus = focus;
  const heightAt = info.heightAt || groundHeightAt;

  const group = new THREE.Group();
  group.name = 'grass';
  const carpet = buildCarpet(heightAt, focus, opts);
  group.add(carpet);
  const blades = buildBlades(heightAt, focus, opts);
  group.add(blades.mesh);
  scene.add(group);

  let time = 0;
  const controller = {
    group,
    carpetMesh: carpet,
    bladeMesh: blades.mesh,
    counts: {
      blades: blades.placed,
      bladeAttempts: blades.attempts,
      carpetSegments: opts.carpetSegments,
    },
    // Advance the wind sway. Call every frame with the frame dt (seconds).
    // If never called, the grass simply stands still — nothing breaks.
    update(dt) {
      time += dt || 0;
      blades.mesh.material.userData.elapsed = time;
      const shader = blades.mesh.material.userData.shader;
      if (shader) shader.uniforms.uTime.value = time;
    },
    setWindStrength(s) {
      blades.mesh.material.userData.windStrength = s;
      const shader = blades.mesh.material.userData.shader;
      if (shader) shader.uniforms.uWindStrength.value = s;
    },
    dispose() {
      scene.remove(group);
      group.traverse((obj) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            if (obj.material.alphaMap) obj.material.alphaMap.dispose();
            obj.material.dispose();
          }
        }
      });
    },
  };
  return controller;
}
