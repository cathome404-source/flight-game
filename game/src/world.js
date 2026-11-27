// Garuda Skies — world: sea, islands, runway, rings, checkpoints, clouds.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). All positions come from WORLD
// in config.js; the seeded rng only dresses the islands (palms, huts,
// hills) so the layout is deterministic.

import { WORLD } from './config.js';
import { terrainHeightAt } from './flight.js';

// Warm golden-hour palette for the whole archipelago.
const PALETTE = {
  sea: 0x1e6f7d,
  seaShallow: 0x26a48d,
  seaDeep: 0x0d4258,
  seaFoam: 0xfdf6dd,
  sand: 0xf2d79e,
  sandWet: 0xcf9f66,
  grass: 0x4e9440,
  grassDry: 0x8aa84f,
  grassDeep: 0x3f8434,
  grassLight: 0x69a24e,
  rock: 0x7a6a58,
  volcano: 0x5c4a3e,
  palmTrunk: 0x8a6b45,
  palmLeaf: 0x2f8f4e,
  hutWall: 0xf2e3c2,
  hutRoof: 0xb4552d,
  asphalt: 0x3a3d42,
  paintWhite: 0xf5f2e8,
  paintYellow: 0xffc93c,
  ringOrange: 0xff7a1a,
  stormRed: 0xd43d2a,
  fuelGreen: 0x35d461,
  beam: 0xffe9a8,
  cloud: 0xfff3e0,
};

function lambert(color, extra) {
  return new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
}

function phong(color, extra) {
  return new THREE.MeshPhongMaterial(Object.assign({ color }, extra || {}));
}

// --- Terrain relief (H1): deterministic value noise + heightmap ---
// A tiny hash-based value noise (no Math.random, so the islands are
// identical every load). Three octaves give rolling hills with
// smaller bumps layered on top; per-island seed offsets keep the
// islands distinct from each other.

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

// Multi-octave rolling noise in [0, 1]: big swells (~220 m) with
// medium (~110 m), small (~55 m) and fine (~28 m) bumps layered on
// top, so the hills read at chase-cam distance instead of only as
// broad swells from far away.
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

// Height of the island's relief surface at local (lx, lz), metres
// above sea level. The base is the island cone from flight.js, so the
// relief never rises above the physics terrain: valleys carve down
// from the cone (up to WORLD.terrain.relief), ridges keep its full
// height, the rim falls steeply to the beach, and the tall volcanic
// island gets a shallow crater at its peak. Outside the island the
// surface drops below the sea so no flat skirt z-fights the water.
function islandHeightAt(def, lx, lz) {
  const R = def.radius;
  const dist = Math.sqrt(lx * lx + lz * lz);
  const t = dist / R;
  if (t >= 1) return -1;
  const relief = (WORLD.terrain && WORLD.terrain.relief) || 0.45;
  const seed = def.x * 0.37 + def.z * 0.61;
  const n = fbmRelief(lx + def.x, lz + def.z, seed);
  let h = def.height * (1 - t) * (1 - relief + relief * n);
  // Crater dip: the volcanic peak sags a little at the very top.
  if (def.height > 120 && t < 0.1) {
    h *= 0.82 + 0.18 * (t / 0.1);
  }
  // Rim cliffs: past rimCliffStart the slope dives to the beach.
  const rim = (WORLD.terrain && WORLD.terrain.rimCliffStart) || 0.88;
  if (t > rim) {
    h *= 1 - smooth01((t - rim) / (1 - rim)) * 0.85;
  }
  return Math.max(h, 2.05);
}

// Colour of one terrain vertex: sand low by the beach, light then
// deep green up the slopes, brown-grey rock on the high peaks and on
// any steep slope (cliffs), with a few percent of noise jitter so the
// surface is not one flat tint.
const _cSand = new THREE.Color(PALETTE.sand);
const _cGrass = new THREE.Color(PALETTE.grass);
const _cGrassDry = new THREE.Color(PALETTE.grassDry);
const _cGrassLight = new THREE.Color(PALETTE.grassLight);
const _cGrassDeep = new THREE.Color(PALETTE.grassDeep);
const _cRock = new THREE.Color(PALETTE.rock);
const _cVolcano = new THREE.Color(PALETTE.volcano);

function terrainVertexColor(def, h, slope, jitter, patch, out) {
  const high = 0.62 * def.height;
  const peak = 0.85 * def.height;
  if (h < 2.5) {
    out.copy(_cSand);
  } else if (h < 7) {
    out.copy(_cSand).lerp(_cGrassLight, smooth01((h - 2.5) / 4.5));
  } else if (h < high) {
    out.copy(_cGrassLight).lerp(_cGrassDeep, smooth01((h - 7) / Math.max(1, high - 7)));
    // R2-12e: patch variation — the old grass band was one flat
    // green because only height and a +-6% jitter drove the colour.
    // A low-frequency patch field (~55-220 m) now splits the slopes
    // into dry yellow-green meadows and lush mid-green groves, so
    // the islands read as varied tropical grass from the air.
    // Kept inside the grass band only: sand, rock and volcano keep
    // their height-driven colours.
    const dry = smooth01((0.40 - patch) / 0.22);
    const lush = smooth01((patch - 0.62) / 0.22);
    out.lerp(_cGrassDry, dry * 0.55);
    out.lerp(_cGrass, lush * 0.5);
  } else if (h < peak) {
    out.copy(_cGrassDeep).lerp(_cRock, smooth01((h - high) / Math.max(1, peak - high)));
  } else {
    out.copy(_cRock).lerp(_cVolcano, smooth01((h - peak) / Math.max(1, def.height - peak)));
  }
  // Steep ground reads as bare rock whatever its height: cliffs.
  if (slope > 0.55) {
    out.lerp(_cRock, smooth01((slope - 0.55) / 0.45) * 0.8);
  }
  // Jitter lightness so facets vary (R2-12e: 0.12 -> 0.16, a touch
  // more relief in the facets now that patches carry the big shapes).
  out.multiplyScalar(1 + (jitter - 0.5) * 0.16);
  return out;
}

// The island as a real heightmap: a grid displaced by islandHeightAt,
// vertex-coloured by height and slope, flat-shaded so every facet
// catches the low sun differently. Hills, valleys and rim cliffs are
// part of the ground now, not cones stuck on top of it.
function makeReliefTerrain(def) {
  const R = def.radius;
  const SEG = 56;
  const size = R * 2;
  const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  const e = 8;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const h = islandHeightAt(def, lx, lz);
    pos.setY(i, h);
    const sx = (islandHeightAt(def, lx + e, lz) - islandHeightAt(def, lx - e, lz)) / (2 * e);
    const sz = (islandHeightAt(def, lx, lz + e) - islandHeightAt(def, lx, lz - e)) / (2 * e);
    const slope = Math.sqrt(sx * sx + sz * sz);
    const jitter = fbmRelief(lx * 2.3 + 40, lz * 2.3 - 17, def.x * 0.11 + def.z * 0.23);
    // R2-12e: low-frequency patch field at raw coordinates (~55-220 m
    // shapes), decorrelated from the relief seed so patches do not
    // follow the hills.
    const patch = fbmRelief(lx + def.z, lz - def.x, def.x * 0.31 + def.z * 0.47 + 91);
    terrainVertexColor(def, h, slope, jitter, patch, tmp);
    colours[i * 3] = tmp.r;
    colours[i * 3 + 1] = tmp.g;
    colours[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  // Normals from the displaced surface, so the low sun lights one
  // side of each hill and leaves the other in shade. Smooth shading
  // (not flat): the flat-shaded facets banded into visible stripes
  // across the grass slopes at chase distance, and the smooth normals
  // keep the relief readable without the striping. A small negative
  // polygon offset lets the terrain win where it meets the beach rim.
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    lambert(0xffffff, {
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  mesh.position.y = 0;
  // R2-4b: tagged so applySurfaceTextures can lay the CC0 grass
  // texture over the vertex colours (map * vertex colour).
  mesh.userData.surfaceTex = 'grass';
  return mesh;
}

// A low-poly hill: a cone with a few radial segments, squashed flat.
function makeHill(radius, height, color, segments) {
  const geo = new THREE.ConeGeometry(radius, height, segments || 7);
  const mesh = new THREE.Mesh(geo, lambert(color, { flatShading: true }));
  mesh.position.y = height / 2 - 1;
  return mesh;
}

// One palm frond as a 3D cross: two flattened cones merged into a
// single shared geometry, so every frond reads as volume from any
// angle instead of a flat billboard. Built lazily once, reused by
// every palm in the scene (no extra draw calls per frond).
let _crossFrondGeo = null;
function getCrossFrondGeo() {
  if (_crossFrondGeo) return _crossFrondGeo;
  function mergeGeos(a, b) {
    const pa = a.attributes.position.array;
    const pb = b.attributes.position.array;
    const na = a.attributes.normal.array;
    const nb = b.attributes.normal.array;
    const ua = a.attributes.uv.array;
    const ub = b.attributes.uv.array;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(pa.length + pb.length);
    pos.set(pa, 0);
    pos.set(pb, pa.length);
    const nor = new Float32Array(na.length + nb.length);
    nor.set(na, 0);
    nor.set(nb, na.length);
    const uv = new Float32Array(ua.length + ub.length);
    uv.set(ua, 0);
    uv.set(ub, ua.length);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }
  const bladeA = new THREE.ConeGeometry(0.9, 5.5, 4).toNonIndexed();
  bladeA.scale(1, 1, 0.42);
  const bladeB = new THREE.ConeGeometry(0.9, 5.5, 4).toNonIndexed();
  bladeB.scale(0.42, 1, 1);
  _crossFrondGeo = mergeGeos(bladeA, bladeB);
  return _crossFrondGeo;
}

// Instanced palms from collected specs: one trunk mesh + one frond
// mesh for the whole archipelago (2 draw calls instead of ~12 per
// palm). Each palm gets one slightly leaning trunk and a two-tier
// crown — 6 wide drooping fronds plus 3 smaller upright ones — so the
// crown is still a volume of crossed fronds from the chase cam.
// A tiny deterministic hash jitters each instance's colour and frond
// length, so no two palms look identical.
function hash01(n) {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function buildInstancedPalms(palmSpecs) {
  const group = new THREE.Group();
  if (!palmSpecs.length) return group;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.6, 9, 5);
  trunkGeo.translate(0, 4.5, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    lambert(PALETTE.palmTrunk, { flatShading: true }),
    palmSpecs.length
  );
  palmSpecs.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, p.lean);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex(PALETTE.palmTrunk).multiplyScalar(0.9 + hash01(i * 3 + 1) * 0.2);
    trunks.setColorAt(i, tmpColor);
  });
  trunks.instanceMatrix.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  group.add(trunks);

  const FRONDS_PER_PALM = 9;
  const frondGeo = getCrossFrondGeo();
  const fronds = new THREE.InstancedMesh(
    frondGeo,
    lambert(PALETTE.palmLeaf, { flatShading: true }),
    palmSpecs.length * FRONDS_PER_PALM
  );
  let fi = 0;
  palmSpecs.forEach((p, i) => {
    const crownY = p.y + 9 * p.s + 0.7 * p.s;
    for (let f = 0; f < FRONDS_PER_PALM; f++) {
      const lower = f < 6;
      const angle = ((f % 6) / 6) * Math.PI * 2 + p.yaw;
      const rad = lower ? 2.0 : 1.1;
      const tilt = lower ? 1.12 : 0.5;
      const len = lower
        ? 0.85 + hash01(i * 17 + f * 5) * 0.4
        : 0.55 + hash01(i * 17 + f * 5) * 0.15;
      dummy.position.set(
        p.x + Math.cos(angle) * rad * p.s,
        crownY + (lower ? 0 : 0.6 * p.s),
        p.z + Math.sin(angle) * rad * p.s
      );
      dummy.rotation.set(-Math.sin(angle) * tilt, hash01(i * 31 + f) * Math.PI, Math.cos(angle) * tilt);
      dummy.scale.setScalar(len * p.s);
      dummy.updateMatrix();
      fronds.setMatrixAt(fi, dummy.matrix);
      tmpColor.setHex(PALETTE.palmLeaf).multiplyScalar(0.88 + hash01(i * 13 + f * 7) * 0.24);
      fronds.setColorAt(fi, tmpColor);
      fi++;
    }
  });
  fronds.instanceMatrix.needsUpdate = true;
  if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
  fronds.castShadow = true;
  fronds.receiveShadow = true;
  group.add(fronds);
  return group;
}

// Instanced bushes: one low-poly blob mesh for every bush on Garuda.
function buildInstancedBushes(bushSpecs) {
  const group = new THREE.Group();
  if (!bushSpecs.length) return group;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const bushes = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1.8, 0),
    lambert(PALETTE.grassDeep, { flatShading: true }),
    bushSpecs.length
  );
  bushSpecs.forEach((b, i) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.yaw, 0);
    dummy.scale.set(b.s * 1.4, b.s * 0.75, b.s * 1.4);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex(PALETTE.grassDeep).multiplyScalar(0.9 + hash01(i * 7 + 2) * 0.2);
    bushes.setColorAt(i, tmpColor);
  });
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  group.add(bushes);
  return group;
}

// A small island hut: whitewashed walls in varied tints, a tall
// pyramid roof in varied terracotta/brown, a door and a dark window
// so the walls read as a building, not a plain box. Overall scale
// varies so no two huts on a shore are the same height.
const HUT_WALLS = [0xf2e3c2, 0xeed9a8, 0xdfe8dd, 0xf0d3b8, 0xe8d8c0];
const HUT_ROOFS = [0xb4552d, 0x8a4a2a, 0x6e3f2a, 0xa03a24, 0x9c5a30];
function makeHut(rng) {
  const hut = new THREE.Group();
  const w = rng.range(5, 8);
  const d = rng.range(5, 7);
  const h = rng.range(3, 5);
  const wallCol = HUT_WALLS[rng.int(0, HUT_WALLS.length - 1)];
  const roofCol = HUT_ROOFS[rng.int(0, HUT_ROOFS.length - 1)];

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(wallCol));
  walls.position.y = h / 2;
  hut.add(walls);

  // Pyramid roof with a real overhang and a tall, varied pitch, so the
  // roof is the hut's loudest shape from the air.
  const roofH = rng.range(2.8, 4.4);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.85, roofH, 4),
    lambert(roofCol, { flatShading: true })
  );
  roof.position.y = h + roofH / 2 - 0.2;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2, 0.2),
    lambert(0x5a3a22)
  );
  door.position.set(-w * 0.18, 1, d / 2 + 0.05);
  hut.add(door);

  // Dark window beside the door: one dark rectangle is enough to stop
  // the wall reading as a blank slab.
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 0.15),
    lambert(0x2e3a44)
  );
  win.position.set(w * 0.22, h * 0.55, d / 2 + 0.05);
  hut.add(win);

  const s = rng.range(0.85, 1.35);
  hut.scale.set(s, s, s);
  return hut;
}

// Coastal rock: one lumpy polyhedron from a shared low-poly geometry,
// squashed at random so no two rocks share a silhouette. Two shared
// materials (grey, brown) keep the whole shoreline cheap.
let _rockGeos = null;
function getRockGeos() {
  if (_rockGeos) return _rockGeos;
  _rockGeos = [1, 1.6, 2.4].map((r) => new THREE.IcosahedronGeometry(r, 0));
  return _rockGeos;
}
const ROCK_MATS = [
  lambert(0x8a8078, { flatShading: true }),
  lambert(0x7a6a58, { flatShading: true }),
];
function makeRockCluster(rng, size) {
  const cluster = new THREE.Group();
  const geos = getRockGeos();
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i++) {
    const rock = new THREE.Mesh(
      geos[rng.int(0, geos.length - 1)],
      ROCK_MATS[rng.int(0, ROCK_MATS.length - 1)]
    );
    const s = size * rng.range(0.6, 1.15);
    rock.scale.set(s * rng.range(0.8, 1.3), s * rng.range(0.55, 0.9), s * rng.range(0.8, 1.3));
    rock.position.set(rng.range(-size, size) * 0.8, s * 0.25, rng.range(-size, size) * 0.8);
    rock.rotation.y = rng.range(0, Math.PI * 2);
    cluster.add(rock);
  }
  return cluster;
}

// One named island: sand rim, grassy cone, extra hills, palms and huts.
// Palms and bushes are NOT built here any more: their world-space
// specs are collected into palmSpecs/bushSpecs and turned into two
// InstancedMeshes by buildWorld (one draw call per part instead of
// ~12 meshes per palm — the old per-palm groups cost hundreds of
// draw calls and made the islands read empty anyway).
// Scalloped surf ring (R2-12e): a flat annulus in the XZ plane whose
// outer edge wobbles with two sine harmonics, so a foam band reads as
// uneven surf tongues instead of a perfect machine circle. Built in
// the XZ plane, so no rotation is needed; MeshBasicMaterial is unlit,
// so the normals are irrelevant. amp is in metres, freq is the lobe
// count around the island, phase decorrelates the islands.
function makeSurfRing(innerR, outerR, seg, amp, freq, phase) {
  const pos = new Float32Array((seg + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const wob =
      Math.sin(a * freq + phase) * 0.6 +
      Math.sin(a * (freq * 2 + 1) + phase * 1.7) * 0.4;
    const ro = outerR + amp * wob;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos[(i * 2) * 3] = c * innerR;
    pos[(i * 2) * 3 + 1] = 0;
    pos[(i * 2) * 3 + 2] = s * innerR;
    pos[(i * 2 + 1) * 3] = c * ro;
    pos[(i * 2 + 1) * 3 + 1] = 0;
    pos[(i * 2 + 1) * 3 + 2] = s * ro;
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function makeIsland(def, rng, palmSpecs, bushSpecs) {
  const island = new THREE.Group();
  island.position.set(def.x, 0, def.z);
  island.userData = { name: def.name, radius: def.radius, height: def.height };

  // Sand rim: a wide flat disc just above the water.
  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(def.radius, def.radius * 1.06, 3, 24),
    lambert(PALETTE.sand)
  );
  beach.position.y = 0.5;
  // R2-4b: CC0 sand texture goes on the beach rim (see
  // applySurfaceTextures at the bottom of this file).
  beach.userData.surfaceTex = 'sand';
  island.add(beach);

  // Wet-sand ring on the beach rim: a warmer, darker band where the
  // waves wash, so the shoreline grades sand -> wet sand -> foam.
  // R2-12e: widened (0.80 inner) so the warm wet band reads from the
  // air instead of hiding under the grass rim.
  const wetSand = new THREE.Mesh(
    new THREE.RingGeometry(def.radius * 0.80, def.radius * 1.0, 28),
    lambert(PALETTE.sandWet, { transparent: true, opacity: 0.85 })
  );
  wetSand.rotation.x = -Math.PI / 2;
  // 2.14 m: above the relief terrain's 2.05 m rim floor, so the wet
  // band never z-fights the grass at the shoreline.
  wetSand.position.y = 2.14;
  island.add(wetSand);

  // Foam fringe: scalloped surf bands on the water just outside the
  // beach, so the shoreline reads as breaking surf, not a hard edge
  // or a perfect circle. The outer edge of each band wobbles with two
  // sine harmonics, so foam tongues reach into the sea unevenly.
  // R2-12e: replaces the old flat RingGeometry bands.
  const foam = new THREE.Mesh(
    makeSurfRing(def.radius * 1.0, def.radius * 1.16, 72, def.radius * 0.045, 7, def.x * 0.13),
    new THREE.MeshBasicMaterial({
      color: PALETTE.seaFoam,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    })
  );
  foam.position.y = 2.2;
  island.add(foam);
  // Bright surf line right at the waterline: the breaking edge where
  // the wash meets the sand.
  const foamEdge = new THREE.Mesh(
    makeSurfRing(def.radius * 0.99, def.radius * 1.045, 72, def.radius * 0.02, 11, def.z * 0.17),
    new THREE.MeshBasicMaterial({
      color: 0xfffbe8,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    })
  );
  foamEdge.position.y = 2.2;
  island.add(foamEdge);
  // Outer wash: a wider, much fainter scalloped ring so the foam
  // edge melts into the sea instead of ending in a hard line.
  const foamOuter = new THREE.Mesh(
    makeSurfRing(def.radius * 1.16, def.radius * 1.6, 72, def.radius * 0.06, 5, def.x * 0.07 + def.z * 0.11),
    new THREE.MeshBasicMaterial({
      color: PALETTE.seaFoam,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    })
  );
  foamOuter.position.y = 2.2;
  island.add(foamOuter);

  // Main landmass: a real heightmap — rolling multi-octave hills,
  // valleys between them, a cratered volcanic peak on the tall island
  // and steep rim cliffs down to the beach — vertex-coloured by
  // height and slope so the relief reads even at a glance.
  const land = makeReliefTerrain(def);
  island.add(land);

  // Palm trees ring the beach; a few more inland on the low islands.
  // Denser than before (radius/38) so the islands read as inhabited
  // tropical shores, not bare cones. Specs only — see buildWorld.
  const palmCount = Math.round(def.radius / 38);
  for (let i = 0; i < palmCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.62, def.radius * 0.9);
    const px = Math.cos(angle) * dist;
    const pz = Math.sin(angle) * dist;
    // Never plant a palm on the runway strip.
    if (
      def.name === 'Garuda' &&
      Math.abs(px - WORLD.runway.x) <= WORLD.runway.length / 2 + 12 &&
      Math.abs(pz - WORLD.runway.z) <= WORLD.runway.width / 2 + 12
    ) {
      continue;
    }
    palmSpecs.push({
      x: def.x + px,
      y: islandHeightAt(def, px, pz),
      z: def.z + pz,
      s: rng.range(0.8, 1.3),
      lean: rng.range(-0.14, 0.14),
      yaw: rng.range(0, Math.PI * 2),
    });
  }

  // Huts cluster near the shore; the runway island gets a few more.
  const hutCount = def.name === 'Garuda' ? 9 : rng.int(2, 5);
  for (let i = 0; i < hutCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.45, def.radius * 0.75);
    const hx = Math.cos(angle) * dist;
    const hz = Math.sin(angle) * dist;
    // Never build a hut on the runway strip.
    if (
      def.name === 'Garuda' &&
      Math.abs(hx - WORLD.runway.x) <= WORLD.runway.length / 2 + 12 &&
      Math.abs(hz - WORLD.runway.z) <= WORLD.runway.width / 2 + 12
    ) {
      continue;
    }
    const hut = makeHut(rng);
    // Huts sit on the relief surface, following the hills.
    hut.position.set(hx, islandHeightAt(def, hx, hz), hz);
    hut.rotation.y = rng.range(0, Math.PI * 2);
    island.add(hut);
  }

  // Rock formations on the shoreline and around the cliffs: clusters
  // of lumpy grey/brown polyhedra, half-buried at the water's edge,
  // so the island rim reads as 3D texture instead of a smooth rim.
  // Batu Karang is the rocky island and gets twice as many.
  const rockCount = Math.round(def.radius / (def.name === 'Batu Karang' ? 45 : 85));
  for (let i = 0; i < rockCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.9, def.radius * 1.08);
    const rx = Math.cos(angle) * dist;
    const rz = Math.sin(angle) * dist;
    const cluster = makeRockCluster(rng, rng.range(2.5, 6));
    cluster.position.set(rx, Math.max(0.5, islandHeightAt(def, rx, rz) - 1.5), rz);
    cluster.rotation.y = rng.range(0, Math.PI * 2);
    island.add(cluster);
  }
  // A few inland boulders on the high ground, for the cliff areas.
  for (let i = 0; i < Math.round(def.radius / 160); i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.4, def.radius * 0.7);
    const rx = Math.cos(angle) * dist;
    const rz = Math.sin(angle) * dist;
    const cluster = makeRockCluster(rng, rng.range(2, 4));
    cluster.position.set(rx, islandHeightAt(def, rx, rz) - 0.5, rz);
    cluster.rotation.y = rng.range(0, Math.PI * 2);
    island.add(cluster);
  }

  // Denser vegetation where the screenshots look: a palm grove north
  // of the runway and along the ring-run line (z = 330), plus low
  // bushes filling the gaps, so the ground near the runway and the
  // mission route never reads as empty grass.
  if (def.name === 'Garuda') {
    for (let i = 0; i < 26; i++) {
      const px = rng.range(-620, 480);
      const pz = rng.range(300, 500);
      if (
        Math.abs(px - WORLD.runway.x) <= WORLD.runway.length / 2 + 12 &&
        Math.abs(pz - WORLD.runway.z) <= WORLD.runway.width / 2 + 12
      ) {
        continue;
      }
      palmSpecs.push({
        x: def.x + px,
        y: islandHeightAt(def, px, pz),
        z: def.z + pz,
        s: rng.range(0.9, 1.4),
        lean: rng.range(-0.14, 0.14),
        yaw: rng.range(0, Math.PI * 2),
      });
    }
    for (let i = 0; i < 34; i++) {
      const bx = rng.range(-650, 500);
      const bz = rng.range(300, 520);
      if (
        Math.abs(bx - WORLD.runway.x) <= WORLD.runway.length / 2 + 12 &&
        Math.abs(bz - WORLD.runway.z) <= WORLD.runway.width / 2 + 12
      ) {
        continue;
      }
      bushSpecs.push({
        x: def.x + bx,
        y: islandHeightAt(def, bx, bz) + 0.6,
        z: def.z + bz,
        s: rng.range(0.7, 1.5),
        yaw: rng.range(0, Math.PI * 2),
      });
    }
  }

  return island;
}

// The coastal runway on Garuda: asphalt strip, centre dashes, edge lights
// and a painted touchdown zone at the west end.
function makeRunway(rw) {
  const runway = new THREE.Group();
  runway.position.set(rw.x, WORLD.runwayAltitude, rw.z);
  runway.rotation.y = THREE.MathUtils.degToRad(rw.heading - 90);
  runway.userData = {
    length: rw.length,
    width: rw.width,
    touchdownZoneStart: rw.touchdownZoneStart,
    touchdownZoneEnd: rw.touchdownZoneEnd,
  };

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(rw.length, 1, rw.width),
    lambert(PALETTE.asphalt)
  );
  strip.position.y = -0.5;
  // R2-4b: CC0 worn-asphalt texture on the strip top.
  strip.userData.surfaceTex = 'asphalt';
  runway.add(strip);

  // White centre dashes down the strip.
  const dashCount = Math.floor(rw.length / 28);
  for (let i = 0; i < dashCount; i++) {
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.2, 1.4),
      lambert(PALETTE.paintWhite)
    );
    dash.position.set(-rw.length / 2 + 14 + i * 28, 0.1, 0);
    runway.add(dash);
  }

  // Touchdown zone: two painted bars across the strip at the west end.
  // The zone bounds in config are absolute x; convert to runway-local
  // coordinates by subtracting the runway centre.
  const zoneCentre = (rw.touchdownZoneStart + rw.touchdownZoneEnd) / 2 - rw.x;
  const zoneWidth = rw.touchdownZoneEnd - rw.touchdownZoneStart;
  const zone = new THREE.Mesh(
    new THREE.BoxGeometry(zoneWidth, 0.2, rw.width * 0.7),
    lambert(PALETTE.paintYellow)
  );
  zone.position.set(zoneCentre, 0.12, 0);
  runway.add(zone);
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.2, 2),
      lambert(PALETTE.paintWhite)
    );
    bar.position.set(zoneCentre, 0.14, side * rw.width * 0.32);
    runway.add(bar);
  }

  // Edge lights: small glowing amber spheres on short posts, both sides.
  // The bulbs are collected so setNightFactor can brighten and enlarge
  // them after dark (R4-3) — they carry the runway at night.
  const edgeBulbs = [];
  const lightGeo = new THREE.SphereGeometry(0.7, 6, 5);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffc23c });
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 4);
  const postMat = lambert(0x222222);
  const lightCount = Math.floor(rw.length / 42);
  for (let i = 0; i <= lightCount; i++) {
    for (const side of [-1, 1]) {
      const x = -rw.length / 2 + (i * rw.length) / lightCount;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.6, side * (rw.width / 2 + 2));
      runway.add(post);
      const bulb = new THREE.Mesh(lightGeo, lightMat);
      bulb.position.set(x, 1.4, side * (rw.width / 2 + 2));
      runway.add(bulb);
      edgeBulbs.push(bulb);
    }
  }
  runway.userData.edgeBulbs = edgeBulbs;
  runway.userData.edgeLightMat = lightMat;

  // Threshold bars at both ends of the strip.
  for (const end of [-1, 1]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.2, rw.width * 0.8),
      lambert(PALETTE.paintWhite)
    );
    bar.position.set(end * (rw.length / 2 - 4), 0.12, 0);
    runway.add(bar);
  }

  // P9 — PAPI lights: four lamps in a row beside the runway near the
  // west threshold, on the pilot's left as they approach eastbound.
  // Two red + two white reads as "on glidepath" from the approach.
  const papiX = -rw.length / 2 + 32;
  const papiBaseZ = -(rw.width / 2 + 6);
  const papiCols = [0xff3b30, 0xff3b30, 0xfff6e0, 0xfff6e0];
  for (let i = 0; i < 4; i++) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(papiX, 0.7, papiBaseZ - i * 9);
    runway.add(post);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.6, 2),
      new THREE.MeshBasicMaterial({ color: papiCols[i] })
    );
    lamp.position.set(papiX, 1.9, papiBaseZ - i * 9);
    runway.add(lamp);
  }

  // P9 — runway number "09" painted past the west threshold, digits
  // built from seven-segment bars (height along the strip, top toward
  // the far end, so an approaching pilot reads it upright).
  function paintDigit(segments, cx, cz) {
    // Segment bars: horizontals span the digit width (z), verticals
    // span half the digit height (x). Digit height 12, width 7.
    const segGeoH = new THREE.BoxGeometry(1.2, 0.2, 7);
    const segGeoV = new THREE.BoxGeometry(6, 0.2, 1.2);
    const segAt = {
      a: [6, 0, segGeoH],
      g: [0, 0, segGeoH],
      d: [-6, 0, segGeoH],
      f: [3, -2.9, segGeoV],
      b: [3, 2.9, segGeoV],
      e: [-3, -2.9, segGeoV],
      c: [-3, 2.9, segGeoV],
    };
    for (const s of segments) {
      const def = segAt[s];
      if (!def) continue;
      const bar = new THREE.Mesh(def[2], lambert(PALETTE.paintWhite));
      bar.position.set(cx + def[0], 0.12, cz + def[1]);
      runway.add(bar);
    }
  }
  const numX = -rw.length / 2 + 52;
  paintDigit(['a', 'b', 'c', 'd', 'e', 'f'], numX, -4.5); // "0"
  paintDigit(['a', 'b', 'c', 'd', 'f', 'g'], numX, 4.5); // "9"

  // R2-12f — stylized-realistic airfield. The hangar shot's foreground
  // was bare terrain reading murky brown and the field was open tarmac
  // with no buildings, so: white edge lines down the strip, a
  // cool-grey concrete apron under the parked plane (west end, where
  // the hangar camera looks), and two low-poly hangars on the north
  // side, sunk onto the island slope via islandHeightAt so they ground
  // instead of floating. Runway layout and the parked-plane spot are
  // untouched; the apron top sits 8 cm under the strip top so no
  // coplanar faces z-fight.

  // White edge lines along both strip edges.
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(rw.length - 8, 0.2, 1.0),
      lambert(PALETTE.paintWhite)
    );
    edge.position.set(0, 0.1, side * (rw.width / 2 - 1.2));
    runway.add(edge);
  }

  // Concrete apron: 160 x 96 m around the parking spot (local x -180,
  // where the plane parks at the west end). Light cool grey — the
  // golden-hour sun warms it toward neutral, and it stays readable
  // even under the blob shadow's brown tint (render.js, out of scope).
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(160, 2.5, 96),
    lambert(0xa8b0b5)
  );
  apron.position.set(-185, -1.33, 0); // top at -0.08, bottom buried in the sand
  runway.add(apron);

  // Apron markings: pale perimeter line + darker expansion joints.
  const apronMark = lambert(0xd8d5cc);
  const jointMat = lambert(0x6e7478);
  for (const side of [-1, 1]) {
    const per = new THREE.Mesh(new THREE.BoxGeometry(156, 0.2, 1.0), apronMark);
    per.position.set(-185, 0.02, side * 46);
    runway.add(per);
  }
  for (const x of [-263, -107]) {
    const per = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 92), apronMark);
    per.position.set(x, 0.02, 0);
    runway.add(per);
  }
  for (const x of [-225, -185, -145]) {
    const joint = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 92), jointMat);
    joint.position.set(x, 0.02, 0);
    runway.add(joint);
  }
  for (const side of [-1, 1]) {
    const joint = new THREE.Mesh(new THREE.BoxGeometry(156, 0.2, 0.6), jointMat);
    joint.position.set(-185, 0.02, side * 24);
    runway.add(joint);
  }

  // Parking stand: white box around the parked plane (local x -180),
  // painted on the strip top where the plane actually sits.
  const standMat = lambert(PALETTE.paintWhite);
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(28, 0.2, 1.0), standMat);
    bar.position.set(-180, 0.1, side * 9);
    runway.add(bar);
  }
  for (const x of [-194, -166]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 18), standMat);
    bar.position.set(x, 0.1, 0);
    runway.add(bar);
  }

  // One low-poly hangar: concrete plinth (a retaining base on the
  // slope), cream walls, curved slate roof, dark sliding door facing
  // the runway (+z) with ribs, an amber header and lit windows.
  function makeHangarBuilding(w, d, wallH, wallColor, roofColor) {
    const g = new THREE.Group();
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(w + 3, 3.9, d + 3),
      lambert(0x7d8287)
    );
    plinth.position.y = 0.45; // spans -1.5..2.4: buried downhill, covers uphill
    g.add(plinth);
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(w, wallH, d),
      lambert(wallColor)
    );
    walls.position.y = 2.4 + wallH / 2;
    g.add(walls);
    // Curved roof: half-cylinder laid along x, open side down.
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(d / 2, d / 2, w, 12, 1, true, 0, Math.PI),
      lambert(roofColor, { side: THREE.DoubleSide })
    );
    roof.rotation.z = Math.PI / 2;
    roof.position.y = 2.4 + wallH;
    g.add(roof);
    // Half-disc end caps so the arch is closed at both ends.
    for (const end of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(d / 2, 12, 0, Math.PI),
        lambert(roofColor, { side: THREE.DoubleSide })
      );
      cap.rotation.y = Math.PI / 2;
      cap.position.set(end * (w / 2), 2.4 + wallH, 0);
      g.add(cap);
    }
    // Sliding door on the runway face (+z), with ribs + amber header.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.55, wallH * 0.72, 0.6),
      lambert(0x37474f)
    );
    door.position.set(0, 2.4 + (wallH * 0.72) / 2, d / 2 + 0.15);
    g.add(door);
    for (let i = -1; i <= 1; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, wallH * 0.72, 0.3),
        lambert(0x546e7a)
      );
      rib.position.set(i * w * 0.16, 2.4 + (wallH * 0.72) / 2, d / 2 + 0.5);
      g.add(rib);
    }
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.55, 0.8, 0.7),
      lambert(0xffc93c)
    );
    header.position.set(0, 2.4 + wallH * 0.72 + 0.4, d / 2 + 0.15);
    g.add(header);
    // Lit windows above the door — warm at dusk, the hangar reads occupied.
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    for (let i = -1; i <= 1; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.3), winMat);
      win.position.set(i * w * 0.22, 2.4 + wallH - 1.4, d / 2 + 0.15);
      g.add(win);
    }
    return g;
  }

  // Sink each hangar onto the slope: group origin 0.3 m under the
  // terrain at its centre, so the plinth grounds on both sides.
  function placeHangar(cx, cz, w, d, wallH, wallColor, roofColor) {
    const terrainH = islandHeightAt(WORLD.islands[0], rw.x + cx, rw.z + cz);
    const g = makeHangarBuilding(w, d, wallH, wallColor, roofColor);
    g.position.set(cx, terrainH - WORLD.runwayAltitude - 0.3, cz);
    runway.add(g);
  }
  // Main hangar, west — big in the hangar shot's left frame.
  // Roof slate darkened (was 0x64707e): the sun-facing slope blew
  // white in pass 1; the darker slate still reads blue-grey in sun.
  placeHangar(-125, -40, 44, 26, 12, 0xeadfc6, 0x4d5a68);
  // Smaller second hangar further east, up the rise.
  placeHangar(-15, -44, 30, 20, 9, 0xd8dcc0, 0x4d5a68);

  // Apron props, kept small: fuel tank, cones, windsock, floodlights.
  const tank = new THREE.Group();
  const tankBody = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 9, 12),
    lambert(0xf2ede4)
  );
  tankBody.rotation.z = Math.PI / 2;
  tankBody.position.y = 3.7;
  tank.add(tankBody);
  const tankBand = new THREE.Mesh(
    new THREE.CylinderGeometry(2.65, 2.65, 1.2, 12),
    lambert(0xc23b2e)
  );
  tankBand.rotation.z = Math.PI / 2;
  tankBand.position.y = 3.7;
  tank.add(tankBand);
  for (const dx of [-3, 3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 1.2), lambert(0x3a3d42));
    leg.position.set(dx, 0.5, 0);
    tank.add(leg);
  }
  tank.position.set(-140, -0.08, 36);
  runway.add(tank);

  const coneMat = lambert(0xff7a1a);
  for (const [cx, cz, cy] of [[-196, 12, 0.55], [-164, 12, 0.55], [-140, 30, 0.47]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 8), coneMat);
    cone.position.set(cx, cy, cz);
    runway.add(cone);
  }

  // Windsock on the apron's north-east corner.
  const sockPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 7, 6),
    lambert(0x3a3d42)
  );
  sockPole.position.set(-108, 3.42, -42);
  runway.add(sockPole);
  const sock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.9, 3.2, 8),
    lambert(0xff7a1a)
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(-106.4, 6.7, -42);
  runway.add(sock);

  // Floodlight poles on the apron's west corners.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 6, 6),
      lambert(0x3a3d42)
    );
    pole.position.set(-260, 2.92, side * 44);
    runway.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), lampMat);
    lamp.position.set(-260, 5.95, side * 44);
    runway.add(lamp);
  }

  return runway;
}

// Number board: a dark plate with a big gold number, hung above the
// ring so the pilot can read which gate it is from far away. One
// canvas texture per ring, drawn once at build time.
function makeNumberBoard(num) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#ffc93c';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 128, 70);
  const tex = new THREE.CanvasTexture(canvas);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 6.5),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  return board;
}

// A big 3D gold ring: a fat metallic torus (standard material, so the
// low sun glints along its rim) with a thin bright emissive rim ring
// outside it and a number board above, readable from far away. The
// torus colour follows the ring set (orange / red / teal / amber /
// white / violet) so each sortie line keeps its colour, but every
// ring now has real metal and a lit rim instead of a flat outline.
function makeRing(def, color, tilt, num) {
  const ring = new THREE.Group();
  ring.position.set(def.x, def.y, def.z);
  ring.userData = { radius: def.radius, passed: false };

  // R2-12b — gold that reads GOLD, not pale white. Passes 1–3 tuned
  // the standard material, pass 4 switched to Lambert (no specular)
  // — yet the near ring STILL rendered cream while a runtime probe
  // proved the pipeline keeps hue (pure-blue Lambert tube reads
  // saturated blue; distant face-on rings read amber). The remaining
  // mechanism is brightness: the near ring is sun-blasted, and the
  // ACES shoulder desaturates bright warm colours toward white.
  // Pass 5, still inside this function only: darken the hue hard
  // (×0.5) so the lit tube stays on the linear part of the curve
  // where hue survives, and lean on the emissive (0.6) for the dusk
  // glow instead of brightness. Hue family per sortie unchanged;
  // geometry (radius/tube) untouched.
  const deep = new THREE.Color(color).multiplyScalar(0.5);
  const gold = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius, 1.7, 10, 36),
    lambert(deep, { emissive: deep, emissiveIntensity: 0.6 })
  );
  ring.add(gold);

  // Emissive rim: a thin bright torus just outside the main tube, so
  // the ring's edge glows even against a bright sky. R2-12b — deeper
  // amber (was pale cream 0xffe9a8, which read white at distance).
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius + 1.9, 0.32, 6, 36),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b })
  );
  ring.add(rim);

  // Inner glow disc, faint, so the hole reads from far away.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(def.radius * 0.92, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
    })
  );
  ring.add(glow);

  // Number board above the ring, facing along the flight line.
  if (typeof num === 'number') {
    const board = makeNumberBoard(num);
    board.position.y = def.radius + 9;
    ring.add(board);
  }

  // Small pylons under the ring so it looks anchored in the sky.
  const pylon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 6, 5),
    lambert(0x555555)
  );
  pylon.position.y = -def.radius - 2;
  ring.add(pylon);

  ring.rotation.y = rngAngle(def);
  if (tilt) ring.rotation.x = tilt;
  return ring;
}

// Rings face roughly along the line to the next ring; this gives a
// deterministic facing from the ring's own coordinates.
function rngAngle(def) {
  return Math.atan2(def.x, def.z);
}

// A tour checkpoint: a tall pillar of golden light over the island.
function makeCheckpoint(def) {
  const cp = new THREE.Group();
  cp.position.set(def.x, 0, def.z);
  cp.userData = { name: def.name, radius: def.radius, y: def.y, visited: false };

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(def.radius * 0.5, def.radius * 0.5, def.y + 120, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: PALETTE.beam,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  beam.position.y = (def.y + 120) / 2;
  cp.add(beam);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius, 1.4, 8, 28),
    new THREE.MeshBasicMaterial({ color: PALETTE.beam })
  );
  halo.position.y = def.y;
  cp.add(halo);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff6c9 })
  );
  beacon.position.y = def.y;
  cp.add(beacon);
  return cp;
}

// A fuel ring: green torus with a floating fuel drum at its centre.
function makeFuelRing(def) {
  const ring = makeRing(def, PALETTE.fuelGreen, 0);
  const drum = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 5, 10),
    phong(PALETTE.fuelGreen, { shininess: 60, flatShading: true })
  );
  drum.add(body);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.2, 0.6, 10),
    lambert(0x1d7a33)
  );
  cap.position.y = 2.7;
  drum.add(cap);
  drum.position.y = -def.radius * 0.55;
  ring.add(drum);
  ring.userData.fuel = true;
  return ring;
}

// Three cloud layers as InstancedMesh: high thin bright cirrus, thick
// pale cumulus in the middle, shaded low cloud. Every cloud is near-
// white / pale cream — barely warm, no yellow — with a denser core puff
// wrapped in a larger, fainter halo puff, so the edge melts into the
// sky instead of ending in a hard faceted shell. Puffs cluster
// along the ring flight line (z = 330) so the cover/cockpit/rings shots
// fly past them, with the rest scattered over the archipelago. Faint
// shadow blobs on the sea under the flight-line clusters anchor the
// clouds to the world instead of floating decals.
function buildLayeredClouds(rng) {
  // Soft puff geometry: a subdivided icosahedron (detail 1) with a
  // baked vertical gradient — bright white on top, pale warm grey
  // underneath — so every puff reads as a lit cloud. R2-12d: smooth
  // shading (r149 averages the icosahedron normals, verified in the
  // vendored three) — flatShading was what cut every puff into
  // visible yellow facets. The gradient is per-vertex, so the
  // sun-side shading comes from the geometry, not the layer tint.
  const geo = new THREE.IcosahedronGeometry(1, 1);
  {
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0xffffff);
    const bottom = new THREE.Color(0xe4d8c2);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.pow((pos.getY(i) + 1) / 2, 0.7);
      c.copy(bottom).lerp(top, t);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // Flight-line clusters: the plane's route, where clouds must read in
  // the screenshots and where flying through one fogs the view.
  // Kept clear of the posed shot planes (cover -650,120; cockpit
  // -350,85; rings -60,60) so no screenshot starts inside a fog bank:
  // cumulus sits high (180–225) and offset in x, low cloud stays at
  // least ~100 m from every posed plane.
  const lineClusters = [];
  for (const x of [-800, -420, -40, 340, 720, 1080]) {
    lineClusters.push({
      x,
      z: 330 + rng.range(-40, 40),
      y: rng.range(180, 225),
      radius: 75,
      layer: 'cumulus',
    });
  }
  for (const x of [-450, -150, 250, 600, 950]) {
    lineClusters.push({
      x,
      z: 330 + rng.range(-50, 50),
      y: rng.range(95, 125),
      radius: 60,
      layer: 'low',
    });
  }

  const layerDefs = [
    { key: 'cirrus', yMin: 300, yMax: 380, count: 80, rMin: 14, rMax: 26, flat: 0.3, color: 0xeef2fb, opacity: 0.72, driftMin: 1.5, driftMax: 3.0 },
    { key: 'cumulus', yMin: 150, yMax: 230, count: 140, rMin: 16, rMax: 30, flat: 0.8, color: 0xfbf4e8, opacity: 0.92, driftMin: 1.2, driftMax: 2.6 },
    { key: 'low', yMin: 80, yMax: 130, count: 70, rMin: 12, rMax: 22, flat: 0.75, color: 0xefe3d0, opacity: 0.95, driftMin: 1.8, driftMax: 3.2 },
  ];

  // H5: every puff is a cluster of 3 balls (core + 2 smaller caps
  // stacked on top, varied sizes) instead of one flattened disc, so
  // clouds read as round cumulus, not beige plates. The halo shell
  // follows the same tripled instances. R2-12d: caps sit lower
  // (0.30/0.26, was 0.38/0.32) so clustered puffs stop piling into
  // tall yellow towers in the cockpit frame.
  const SUBS = 3;
  const SUB_OFF = [
    [0, 0, 0, 1.0],
    [-0.55, 0.30, 0.15, 0.62],
    [0.5, 0.26, -0.2, 0.48],
  ];

  const layers = {};
  for (const def of layerDefs) {
    const total = def.count * SUBS;
    const mat = lambert(def.color, {
      flatShading: false,
      vertexColors: true,
      transparent: true,
      opacity: def.opacity,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new Float32Array(total * 3);
    const scale = new Float32Array(total * 3);
    const speed = new Float32Array(total);
    const ownClusters = lineClusters.filter((c) => c.layer === def.key);
    for (let p = 0; p < def.count; p++) {
      let x, y, z;
      if (ownClusters.length > 0 && rng.range(0, 1) < 0.6) {
        const c = ownClusters[rng.int(0, ownClusters.length - 1)];
        x = c.x + rng.range(-55, 55);
        y = c.y + rng.range(-12, 12);
        z = c.z + rng.range(-35, 35);
      } else {
        x = rng.range(-1800, 1800);
        y = rng.range(def.yMin, def.yMax);
        z = rng.range(-1800, 1800);
      }
      const r = rng.range(def.rMin, def.rMax);
      const puffSpeed = rng.range(def.driftMin, def.driftMax);
      for (let s = 0; s < SUBS; s++) {
        const i = p * SUBS + s;
        const sub = SUB_OFF[s];
        const sr = r * sub[3];
        const bx = x + sub[0] * r;
        const by = y + sub[1] * r;
        const bz = z + sub[2] * r;
        base[i * 3] = bx;
        base[i * 3 + 1] = by;
        base[i * 3 + 2] = bz;
        scale[i * 3] = sr;
        scale[i * 3 + 1] = sr * def.flat;
        scale[i * 3 + 2] = sr;
        speed[i] = puffSpeed;
        dummy.position.set(bx, by, bz);
        dummy.scale.set(sr, sr * def.flat, sr);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Jitter each ball's colour a few percent so the layer is not
        // one flat tint: the warm top / shaded bottom read comes from
        // the baked vertex gradient (bright cirrus, warm cumulus,
        // warm low). Caps run a touch brighter than the core.
        const jitter = rng.range(0.9, 1.08) * (s === 0 ? 1 : 1.05);
        tmpColor.setHex(def.color).multiplyScalar(jitter);
        mesh.setColorAt(i, tmpColor);
      }
    }
    mesh.userData.cloudDrift = { base, scale, speed };
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    layers[def.key] = mesh;

    // Halo shell: the same balls blown up ~1.35x and much fainter, so
    // each cloud has a dense core and a soft transparent edge that
    // melts into the sky. R2-12d pass 2: the 1.7x halo read as a
    // separate giant disc around near-camera puffs (cover shot) —
    // the halo must be nearly invisible, only softening the edge.
    const haloScale = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      haloScale[i * 3] = scale[i * 3] * 1.35;
      haloScale[i * 3 + 1] = scale[i * 3 + 1] * 1.35;
      haloScale[i * 3 + 2] = scale[i * 3 + 2] * 1.35;
    }
    const haloMat = lambert(def.color, {
      flatShading: false,
      vertexColors: true,
      transparent: true,
      opacity: def.opacity * 0.22,
    });
    const halo = new THREE.InstancedMesh(geo, haloMat, total);
    halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < total; i++) {
      dummy.position.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
      dummy.scale.set(haloScale[i * 3], haloScale[i * 3 + 1], haloScale[i * 3 + 2]);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      halo.setMatrixAt(i, dummy.matrix);
      const jitter = rng.range(0.9, 1.08);
      tmpColor.setHex(def.color).multiplyScalar(jitter);
      halo.setColorAt(i, tmpColor);
    }
    halo.userData.cloudDrift = { base, scale: haloScale, speed };
    halo.instanceMatrix.needsUpdate = true;
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    layers[def.key + 'Halo'] = halo;
  }

  // Shadow blobs under the flight-line clusters, drifting with them.
  const blobGeo = new THREE.CircleGeometry(1, 20);
  const blobMat = new THREE.MeshBasicMaterial({
    color: 0x241a12,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
  });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, lineClusters.length);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const blobBase = new Float32Array(lineClusters.length * 3);
  const blobScale = new Float32Array(lineClusters.length * 3);
  const blobSpeed = new Float32Array(lineClusters.length);
  const blobQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );
  lineClusters.forEach((c, i) => {
    const y = terrainHeightAt(c.x, c.z) + 2.2;
    blobBase[i * 3] = c.x;
    blobBase[i * 3 + 1] = y;
    blobBase[i * 3 + 2] = c.z;
    blobScale[i * 3] = c.radius * 1.5;
    blobScale[i * 3 + 1] = c.radius * 1.1;
    blobScale[i * 3 + 2] = 1;
    blobSpeed[i] = rng.range(1.2, 2.6);
    dummy.position.set(c.x, y, c.z);
    dummy.quaternion.copy(blobQuat);
    dummy.scale.set(c.radius * 1.5, c.radius * 1.1, 1);
    dummy.updateMatrix();
    blobs.setMatrixAt(i, dummy.matrix);
  });
  blobs.userData.cloudDrift = { base: blobBase, scale: blobScale, speed: blobSpeed };
  blobs.userData.isBlob = true;
  blobs.instanceMatrix.needsUpdate = true;
  blobs.renderOrder = 1;

  return {
    cirrus: layers.cirrus,
    cumulus: layers.cumulus,
    low: layers.low,
    cirrusHalo: layers.cirrusHalo,
    cumulusHalo: layers.cumulusHalo,
    lowHalo: layers.lowHalo,
    blobs,
    clusters: lineClusters,
  };
}

// The sun-glint streak: a long additive band on the sea, aligned with
// the sun's azimuth, fading out at both ends and both edges. The
// texture is drawn on a canvas — no image file needed.
function makeGlintStreak() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // Bright in the middle of the streak's length, fading to nothing at
  // the horizon end and the camera end.
  const along = ctx.createLinearGradient(0, 0, 512, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  along.addColorStop(0.6, 'rgba(255,255,255,1)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 512, 128);
  // Wide and soft across the streak: a broad bright spine with long
  // transparent falloffs, so the glint reads as a wide golden path,
  // not a thin sharp line.
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 0, 128);
  across.addColorStop(0, 'rgba(255,255,255,0)');
  across.addColorStop(0.22, 'rgba(255,255,255,1)');
  across.addColorStop(0.78, 'rgba(255,255,255,1)');
  across.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 512, 128);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(2600, 360);
  geo.rotateX(-Math.PI / 2);
  // Lay the streak's long axis along the sun azimuth: rotateY maps +X
  // to (cos a, 0, -sin a), so a = atan2(-dirZ, dirX) lines it up.
  const az = ((WORLD.sun.azimuth || 262) * Math.PI) / 180;
  const dirX = Math.sin(az);
  const dirZ = Math.cos(az);
  geo.rotateY(Math.atan2(-dirZ, dirX));
  const streak = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  // Centred on the flight line (z = 330) so the cover/rings shots fly
  // along it; just above the swell peaks (+2.0 m) so waves never hide it.
  streak.position.set(-350, 2.2, 330);
  streak.renderOrder = 2;
  return streak;
}

// --- Small life on the water: fishing boats, a ferry, a coastal
// village with warm windows, a lighthouse, and morning mist banks.
// All built from the same cheap lambert materials as the islands.

// One fishing boat: wooden hull, pointed bow, a mast and two bamboo
// outrigger poles — the classic perahu, readable from the air.
function makeFishingBoat() {
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(7, 1.4, 2.6),
    lambert(0x7a4a28, { flatShading: true })
  );
  hull.position.y = 0.7;
  boat.add(hull);
  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(1.3, 2.6, 4),
    lambert(0x8a5a30, { flatShading: true })
  );
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(4.6, 0.7, 0);
  boat.add(bow);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 5, 5),
    lambert(0x5a3a22)
  );
  mast.position.set(0.5, 3.6, 0);
  boat.add(mast);
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 4),
      lambert(0x6b4a2a)
    );
    pole.rotation.x = Math.PI / 2;
    pole.position.set(0.5, 0.5, side * 2.2);
    boat.add(pole);
    const float = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 3.2, 5),
      lambert(0xd8c49a)
    );
    float.rotation.x = Math.PI / 2;
    float.position.set(0.5, 0.15, side * 3.8);
    boat.add(float);
  }
  return boat;
}

// One ferry: a bigger white hull with a lit window strip, crossing
// between the islands.
function makeFerry() {
  const ferry = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(26, 3.2, 8),
    lambert(0x27435e, { flatShading: true })
  );
  hull.position.y = 1.6;
  ferry.add(hull);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(22, 3.4, 6.8),
    lambert(0xf2ede4)
  );
  deck.position.y = 4.8;
  ferry.add(deck);
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(20, 1.1, 7),
    new THREE.MeshBasicMaterial({ color: 0xffc36a })
  );
  windows.position.y = 5.2;
  ferry.add(windows);
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.3, 3.4, 8),
    lambert(0xc23b2e)
  );
  funnel.position.set(-6, 8, 0);
  ferry.add(funnel);
  return ferry;
}

// Coastal village: a cluster of huts on one shore, each with a small
// warm window quad that glows at dusk and night (setNightFactor
// drives the shared window material).
function makeVillage(rng, def) {
  const village = new THREE.Group();
  const windowMat = new THREE.MeshBasicMaterial({
    color: 0xffc36a, transparent: true, opacity: 0.25,
  });
  const baseAngle = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 9; i++) {
    const angle = baseAngle + (i / 9) * 1.1 - 0.55 + rng.range(-0.08, 0.08);
    const dist = def.radius * rng.range(0.55, 0.72);
    const hx = Math.cos(angle) * dist;
    const hz = Math.sin(angle) * dist;
    const hut = makeHut(rng);
    hut.position.set(def.x + hx, islandHeightAt(def, hx, hz), def.z + hz);
    hut.rotation.y = angle + Math.PI / 2 + rng.range(-0.3, 0.3);
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.2),
      windowMat
    );
    win.position.set(0, 1.8, 3.6);
    hut.add(win);
    village.add(hut);
  }
  return { group: village, windowMat };
}

// Lighthouse on the rocky island: white tower with red bands, a lamp
// room, and a long additive beam that sweeps around (rotated by
// effects.js). The beam is the night-run landmark.
function makeLighthouse(x, z, groundY) {
  const group = new THREE.Group();
  group.position.set(x, groundY, z);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3.4, 24, 10),
    lambert(0xf2ede4, { flatShading: true })
  );
  tower.position.y = 12;
  group.add(tower);
  for (const y of [7, 15]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.8, 3, 10),
      lambert(0xc23b2e, { flatShading: true })
    );
    band.position.y = y;
    group.add(band);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), lampMat);
  lamp.position.y = 25.5;
  group.add(lamp);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.4, 2.6, 8),
    lambert(0x2b2f36, { flatShading: true })
  );
  roof.position.y = 28;
  group.add(roof);
  // Beam pivot at the lamp: a long horizontal cone, additive, so the
  // sweep reads as light in the dark, not as a solid object.
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 25.5;
  const beamGeo = new THREE.ConeGeometry(7, 130, 10, 1, true);
  beamGeo.rotateZ(-Math.PI / 2);
  beamGeo.translate(65, 0, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beamPivot.add(beam);
  group.add(beamPivot);
  return { group, beamPivot, beamMat, lampMat };
}

// Morning mist: flat soft ellipses hugging the water near the shores
// and along the flight line — the second fog layer (distance haze is
// the scene fog; these are the low banks you fly over). One
// InstancedMesh, drifting slowly east in effects.js.
function makeMist(rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const COUNT = 16;
  const geo = new THREE.CircleGeometry(1, 20);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: 0xffe8d0, transparent: true, opacity: 0.16,
    depthWrite: false,
  });
  const mist = new THREE.InstancedMesh(geo, mat, COUNT);
  mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const base = new Float32Array(COUNT * 3);
  const scale = new Float32Array(COUNT * 3);
  const speed = new Float32Array(COUNT);
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < COUNT; i++) {
    // Half along the flight line (z = 330), half hugging island
    // shores — the mist you actually fly through on a sortie.
    let x, z;
    if (i % 2 === 0) {
      x = rng.range(-1400, 1400);
      z = 330 + rng.range(-120, 120);
    } else {
      const isl = WORLD.islands[rng.int(0, WORLD.islands.length - 1)];
      const a = rng.range(0, Math.PI * 2);
      x = isl.x + Math.cos(a) * (isl.radius + rng.range(30, 120));
      z = isl.z + Math.sin(a) * (isl.radius + rng.range(30, 120));
    }
    const y = rng.range(6, 16);
    const sx = rng.range(70, 140);
    const sz = rng.range(40, 70);
    base[i * 3] = x;
    base[i * 3 + 1] = y;
    base[i * 3 + 2] = z;
    scale[i * 3] = sx;
    scale[i * 3 + 1] = sz;
    scale[i * 3 + 2] = 1;
    speed[i] = rng.range(1.0, 2.2);
    dummy.position.set(x, y, z);
    dummy.quaternion.copy(flatQuat);
    dummy.scale.set(sx, sz, 1);
    dummy.updateMatrix();
    mist.setMatrixAt(i, dummy.matrix);
  }
  mist.instanceMatrix.needsUpdate = true;
  mist.userData.mistDrift = { base, scale, speed, quat: flatQuat };
  mist.renderOrder = 1;
  return mist;
}

// Build the whole archipelago and return every piece the game needs.
export function buildWorld(rng) {
  const group = new THREE.Group();
  group.name = 'world';

  // Sea: one big plane, glossy so the low sun glints on it — a
  // brighter specular and higher shininess make the sun's path on the
  // water read clearly at golden hour. Its colour is baked per vertex
  // (turquoise shallow near shore, deep blue out at sea) and the
  // material is white, so the gradient is the water colour.
  // Segmented (60x60) so the swell animation can move its vertices
  // smoothly — 70 units between vertices against a ~300-unit swell.
  // A small shader patch (onBeforeCompile) adds two things the plain
  // Phong material cannot do: a fresnel term, so the sea is dark when
  // looked down on and bright, sky-reflecting at grazing angles near
  // the horizon; and a fine normal ripple, so the specular sparkle
  // shimmers instead of sitting frozen on the swell.
  // R2-12e: shininess 55 -> 85 and a warm sun specular (0xffd9a8),
  // so the low sun's path on the water reads as a live glittering
  // highlight instead of a dull sheen. envMapIntensity 0.4: the
  // scene environment was washing the sea pale mint (R2-12c showed
  // the same wash on the aircraft); the sea keeps some sky
  // reflection, but the vertex-colour turquoise now survives it.
  const seaMat = phong(0xffffff, { vertexColors: true, shininess: 85, specular: 0xffd9a8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  seaMat.envMapIntensity = 0.4;
  // polygonOffset: at grazing angles the sea plane (y = 0) and the
  // beach top (y = 2) are only ~0.2 m apart along the view ray, below
  // the depth buffer's resolution at 1 km, so the sea showed through
  // the beach in moire stripes. Pushing the sea's depth back lets the
  // beach and terrain win wherever they overlap on screen.
  seaMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uFresnelColor = { value: new THREE.Color(0xffc98a) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vG3WorldPos;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvG3WorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vG3WorldPos;\nuniform float uTime;\nuniform vec3 uFresnelColor;'
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        // Fine ripple: two crossing sines at a much shorter wavelength
        // than the swell, so the sun's specular breaks into sparkle.
        // R2-12e: amplitude 0.008 -> 0.032 and frequencies raised, so
        // the shimmer is actually visible on the near sea at chase
        // distance (the old ripple was too faint to read in a still).
        // Still faded out with distance: a stronger, high-frequency
        // ripple aliased into stiff parallel stripes (moire) on the
        // far sea and sand in the cover shot.
        float rippleFade = 1.0 - smoothstep(120.0, 450.0, length(vViewPosition));
        normal = normalize(normal + rippleFade * vec3(
          sin(vG3WorldPos.x * 0.11 + uTime * 1.3) * 0.032 +
          sin(vG3WorldPos.z * 0.09 - uTime * 1.1) * 0.028,
          sin(vG3WorldPos.x * 0.075 - uTime * 0.8) * 0.028,
          cos(vG3WorldPos.z * 0.10 + uTime * 1.5) * 0.032
        ));`
      )
      .replace(
        '#include <output_fragment>',
        `#include <output_fragment>
        // Fresnel: only at true grazing angles (right at the horizon)
        // does the water turn toward the warm sky colour; seen from
        // above it stays deep. pow 4 (was 5) widens the bright band a
        // little, so the sun's path on the water reads as a broad soft
        // glow instead of a thin sharp line. R2-12e: mix 0.25 -> 0.35,
        // so the horizon sea carries the golden-hour warmth instead
        // of reading flat pale mint. Faded out with distance:
        // past ~1 km the swell normals + fresnel compressed into dense
        // parallel stripes at the horizon, so the far sea keeps only a
        // whisper of the warm tint instead of banding.
        {
          float fresDist = 1.0 - smoothstep(900.0, 2200.0, length(vViewPosition));
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 4.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uFresnelColor, fres * 0.35 * fresDist);
        }`
      );
    sea.userData.shader = shader;
  };
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.seaSize, WORLD.seaSize, 60, 60),
    seaMat
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  // The sea catches the plane's and islands' shadows.
  sea.receiveShadow = true;
  // Depth gradient baked per vertex: turquoise shallow water near
  // every shore, fading to deep blue out at sea. Computed from the
  // nearest island rim (world x = local x, world z = -local y after
  // the mesh's -90 deg rotation), so the turquoise ring hugs each
  // beach instead of sitting at one fixed radius.
  {
    const pos = sea.geometry.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const shallow = new THREE.Color(PALETTE.seaShallow);
    const deep = new THREE.Color(PALETTE.seaDeep);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = -pos.getY(i);
      let shore = Infinity;
      for (const isl of WORLD.islands) {
        const d = Math.hypot(wx - isl.x, wz - isl.z) - isl.radius;
        if (d < shore) shore = d;
      }
      const t = Math.min(1, Math.max(0, (shore - 40) / 340));
      c.copy(shallow).lerp(deep, t * t * (3 - 2 * t));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    sea.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  // Flat copy of the rest positions: the swell writes heights from these.
  sea.userData.basePositions = sea.geometry.attributes.position.array.slice();
  group.add(sea);

  // Sun-glint streak: a long additive band on the water along the sun's
  // azimuth, from the western horizon across the flight line — the path
  // of sunlight on the sea at golden hour. The gradient texture fades
  // the streak out at both ends and both edges, and it sits just above
  // the swell peaks so the waves never swallow it.
  const glint = makeGlintStreak();
  group.add(glint);

  // No separate deep-water disc under the sea: a disc 0.4 m below the
  // sea plane z-fought with it at grazing angles (the cover shot's
  // moire stripes on the open sea). The sea's own baked vertex-colour
  // gradient already darkens deep water, so the disc added nothing.

// Every opaque mesh in a group casts and receives shadows: terrain
// shades terrain, palms and huts shade the sand, the runway catches
// the plane. Transparent meshes (foam, wet sand) are skipped — a
// translucent ring must not cast a solid shadow.
function shadowify(group) {
  group.traverse((obj) => {
    if (obj.isMesh && !(obj.material && obj.material.transparent)) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

  // The five named islands.
  const palmSpecs = [];
  const bushSpecs = [];
  const islands = WORLD.islands.map((def) => {
    const island = makeIsland(def, rng, palmSpecs, bushSpecs);
    shadowify(island);
    group.add(island);
    return island;
  });
  // Instanced vegetation: all palms and bushes in 3 draw calls.
  group.add(buildInstancedPalms(palmSpecs));
  group.add(buildInstancedBushes(bushSpecs));

  // Coastal runway on Garuda.
  const runway = makeRunway(WORLD.runway);
  shadowify(runway);
  group.add(runway);

  // 8 orange target rings, 6 red storm rings, 3 green fuel rings.
  const rings = WORLD.rings.map((def, i) => {
    const ring = makeRing(def, PALETTE.ringOrange, 0, i + 1);
    group.add(ring);
    return ring;
  });
  const stormRings = WORLD.stormRings.map((def, i) => {
    const ring = makeRing(def, PALETTE.stormRed, 0.08, i + 1);
    group.add(ring);
    return ring;
  });
  // R2 campaign rings, one colour per sortie so the pilot can tell
  // at a glance which line is theirs: teal for the crosswind strait,
  // amber for the canyon, white for the time trial, violet for the
  // intercept gates.
  const crosswindRings = (WORLD.crosswindRings || []).map((def, i) => {
    const ring = makeRing(def, 0x2fb3a0, 0, i + 1);
    group.add(ring);
    return ring;
  });
  const canyonRings = (WORLD.canyonRings || []).map((def, i) => {
    const ring = makeRing(def, 0xffc93c, 0, i + 1);
    group.add(ring);
    return ring;
  });
  const timeTrialRings = (WORLD.timeTrialRings || []).map((def, i) => {
    const ring = makeRing(def, 0xf5f2e8, 0, i + 1);
    group.add(ring);
    return ring;
  });
  const chaseGates = (WORLD.chaseGates || []).map((def, i) => {
    const ring = makeRing(def, 0xb07bff, 0, i + 1);
    group.add(ring);
    return ring;
  });
  const fuelRings = WORLD.fuelRings.map((def) => {
    const ring = makeFuelRing(def);
    group.add(ring);
    return ring;
  });

  // 3 checkpoint light pillars.
  const checkpoints = WORLD.checkpoints.map((def) => {
    const cp = makeCheckpoint(def);
    group.add(cp);
    return cp;
  });
  // R2: night checkpoints (same light pillars) plus a green marker
  // pillar over the stranded boat, so the rescue target is findable.
  const nightCheckpoints = (WORLD.nightCheckpoints || []).map((def) => {
    const cp = makeCheckpoint(def);
    group.add(cp);
    return cp;
  });
  let rescueMarker = null;
  if (WORLD.rescueBoat) {
    rescueMarker = makeCheckpoint({
      name: 'Kapal Terdampar',
      x: WORLD.rescueBoat.x,
      z: WORLD.rescueBoat.z,
      y: 40,
      radius: 30,
    });
    group.add(rescueMarker);
  }

  // Layered clouds: cirrus high, cumulus mid, low warm — three
  // InstancedMesh layers plus faint shadow blobs on the sea below.
  const cloudSet = buildLayeredClouds(rng);
  group.add(cloudSet.cirrus);
  group.add(cloudSet.cumulus);
  group.add(cloudSet.low);
  group.add(cloudSet.cirrusHalo);
  group.add(cloudSet.cumulusHalo);
  group.add(cloudSet.lowHalo);
  group.add(cloudSet.blobs);

  // Small life on the water: fishing boats scattered between the
  // islands, one ferry crossing off Garuda's south shore.
  const boatSpots = [
    [-500, 820, 0.6], [300, 950, -0.4], [950, 250, 1.8],
    [-1250, -650, 2.6], [650, -1450, -1.2], [1550, 650, 0.9],
  ];
  for (const [bx, bz, heading] of boatSpots) {
    const boat = makeFishingBoat();
    boat.position.set(bx + rng.range(-40, 40), 0.4, bz + rng.range(-40, 40));
    boat.rotation.y = heading + rng.range(-0.3, 0.3);
    shadowify(boat);
    group.add(boat);
  }
  const ferry = makeFerry();
  ferry.position.set(-120, 0.6, 980);
  ferry.rotation.y = -0.5;
  shadowify(ferry);
  group.add(ferry);

  // Coastal village on Garuda's shore, windows warm at dusk/night.
  const garudaDef = WORLD.islands.find((d) => d.name === 'Garuda');
  const village = garudaDef ? makeVillage(rng, garudaDef) : null;
  if (village) group.add(village.group);

  // Lighthouse on the rocky island, beam sweeping at night.
  const karangDef = WORLD.islands.find((d) => d.name === 'Batu Karang');
  let lighthouse = null;
  if (karangDef) {
    const lx = karangDef.x + 40;
    const lz = karangDef.z - 30;
    lighthouse = makeLighthouse(lx, lz, Math.max(2, islandHeightAt(karangDef, 40, -30)));
    shadowify(lighthouse.group);
    group.add(lighthouse.group);
  }

  // Morning mist banks: the second fog layer, low over the water.
  const mist = makeMist(rng);
  group.add(mist);

  const world = {
    group,
    islands,
    runway,
    rings,
    stormRings,
    crosswindRings,
    canyonRings,
    timeTrialRings,
    chaseGates,
    checkpoints,
    nightCheckpoints,
    rescueMarker,
    fuelRings,
    clouds: [cloudSet.cirrus, cloudSet.cumulus, cloudSet.low],
    cloudLayers: [
      cloudSet.cirrus,
      cloudSet.cumulus,
      cloudSet.low,
      cloudSet.cirrusHalo,
      cloudSet.cumulusHalo,
      cloudSet.lowHalo,
    ],
    cloudClusters: cloudSet.clusters,
    cloudBlobs: cloudSet.blobs,
    sea,
    glint,
    mist,
    lighthouseBeam: lighthouse ? lighthouse.beamPivot : null,
    // R4-3: runway edge lights carry the runway at night — brighter
    // (colour pushed past 1) and bigger as the night factor rises.
    // MeshBasicMaterial is unlit, so the colour scale reads as glow.
    // R2-3: the village windows warm up and the lighthouse beam
    // strengthens with the same factor.
    setNightFactor(f) {
      const nf = Math.max(0, Math.min(1, f || 0));
      const mat = runway.userData.edgeLightMat;
      if (mat) {
        mat.color.setHex(0xffc23c).multiplyScalar(1 + nf * 1.6);
      }
      const bulbs = runway.userData.edgeBulbs || [];
      for (const b of bulbs) b.scale.setScalar(1 + nf * 0.9);
      if (village) village.windowMat.opacity = 0.25 + nf * 0.75;
      if (lighthouse) {
        lighthouse.beamMat.opacity = 0.1 + nf * 0.5;
        lighthouse.lampMat.color.setHex(0xfff2b0).multiplyScalar(1 + nf * 1.5);
      }
    },
    // The nth target ring (0-based), or undefined past the end.
    ringAt(i) {
      return rings[i];
    },
    // The nth storm ring (0-based), or undefined past the end.
    stormRingAt(i) {
      return stormRings[i];
    },
    // The nth checkpoint (0-based), or undefined past the end.
    checkpointAt(i) {
      return checkpoints[i];
    },
    // The nth fuel ring (0-based), or undefined past the end.
    fuelRingAt(i) {
      return fuelRings[i];
    },
    // Island group by its name from WORLD, or undefined.
    islandNamed(name) {
      return islands.find((island) => island.userData.name === name);
    },
  };
  // R2-4b: lay the curated CC0 surface textures over the tagged
  // meshes (terrain grass, beach sand, runway asphalt). Loads are
  // async; a missing file leaves the flat colour in place, so the
  // game never breaks on a texture failure.
  applySurfaceTextures(group);
  return world;
}

// --- R2-4b: CC0 surface textures (Poly Haven, CC0 — see
// game/assets/SOURCES.md). Vendored as 512x512 JPEGs (~40–60 KiB
// each); the 1K originals are NOT in the repo. The map multiplies the
// existing vertex/flat colour, so the palette stays the game's own
// and the texture only adds grain. Repeats are tuned per surface:
// the terrain UVs span the whole island, so grass tiles ~18x across
// it; the beach cylinder and runway strip tile along their length.
const SURFACE_TEXTURES = {
  grass: { file: 'assets/grass.jpg', repeat: [18, 18] },
  sand: { file: 'assets/sand.jpg', repeat: [6, 6] },
  asphalt: { file: 'assets/asphalt.jpg', repeat: [10, 1] },
};

function applySurfaceTextures(group) {
  const loader = new THREE.TextureLoader();
  const tagged = [];
  group.traverse((obj) => {
    if (obj.isMesh && obj.userData.surfaceTex) tagged.push(obj);
  });
  if (!tagged.length) return;
  for (const [key, spec] of Object.entries(SURFACE_TEXTURES)) {
    loader.load(
      spec.file,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(spec.repeat[0], spec.repeat[1]);
        if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        for (const mesh of tagged) {
          if (mesh.userData.surfaceTex !== key) continue;
          mesh.material.map = tex;
          mesh.material.needsUpdate = true;
        }
      },
      undefined,
      () => {
        // Texture failed to load: keep the flat colour, game unaffected.
      }
    );
  }
}
