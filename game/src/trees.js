// Garuda Skies — trees: clustered broadleaf trees for the islands.
// R2-14d (POHON). Self-contained module: NO other game file is edited
// by this session, and this module does not touch gameplay, sorties or
// the HUD. The integration session wires it in (import + one
// initTrees call in main.js) and verifies the result in-game.
//
// What it builds — a step up from the old single-cone/ball palms in
// world.js, toward the real-world look the user asked for:
//   * Trunk with a real bark texture (CC0 Poly Haven `bark_brown_01`,
//     vendored as game/assets/bark.jpg, 512x512 q75 — see SOURCES.md).
//     If the texture file is missing at runtime the trunk falls back
//     to a flat bark-brown colour instead of rendering black.
//   * Layered canopy: 2-4 stacked, flattened foliage blobs per tree
//     (not one cone or one ball), each blob jittered in position,
//     size and green, with the top layer sunlit-lighter — so the crown
//     reads as a volume of leaves from the chase cam and from above.
//     Blobs carry the CC0 `forest_leaves_03` texture
//     (game/assets/foliage.jpg, 512x512 q75) as mottled leaf noise;
//     per-instance colour tint gives the real variation.
//   * Per-tree variation: height 6-14 m, scale 0.7-1.6, random yaw,
//     a slight lean, and three growth forms (tall broadleaf, round
//     medium, slim young) so no two trees match.
//   * Natural clustering: groves hug the shore (near the water, where
//     real island trees grow) and forest patches sit inland on the
//     big islands — never a uniform grid. The runway strip stays
//     clear, and nothing is planted on steep upper slopes or in the sea.
//
// Performance: everything is instanced — ONE draw call for all trunks
// and ONE for all canopy blobs, whatever the tree count. Shadows on,
// like the palms in world.js.
//
// Usage (integration session):
//   import { initTrees } from './trees.js';
//   import { WORLD } from './config.js';
//   import { terrainHeightAt } from './flight.js';
//   const trees = initTrees(scene, {
//     islands: WORLD.islands,        // [{ name, x, z, radius, height }]
//     heightAt: terrainHeightAt,     // (x, z) => ground height in metres
//     runway: WORLD.runway,          // kept clear (+30 m margin)
//     seed: 1407,                    // deterministic layout, same every load
//     textureBase: './assets/',      // folder holding bark.jpg + foliage.jpg
//     count: 260,                    // target tree count (default 260)
//   });
//   // trees = { group, count, clusters, dispose }
//   // scene.add(trees.group);  — group is already positioned at origin.
//   // trees.dispose() removes the group and frees the two geometries
//   // and materials (call it before rebuilding, e.g. on a reload).
//
// terrainInfo fields are all optional except `islands`:
//   * heightAt missing -> cone height is computed from the island defs.
//   * runway missing -> nothing is excluded except the sea.
//   * textureBase missing -> textures are skipped, flat colours used.

const DEFAULTS = {
  seed: 1407,
  textureBase: './assets/',
  count: 260,
  // Shore groves sit on this band of the island radius (0.72-0.95 =
  // low ground near the water, where the grass is, not the sand rim).
  shoreBand: [0.72, 0.95],
  // Inland forest patches only below this fraction of island height.
  maxSlopeFraction: 0.55,
  // Minimum spacing between two trees, metres.
  minSpacing: 7,
  // Runway exclusion margin around the strip, metres.
  runwayMargin: 30,
};

// Foliage greens: deep shade at the bottom of the crown, sunlit light
// green at the top. Per-instance tint multiplies these, so the actual
// spread is wider than the three stops below. Kept deliberately on the
// bright side: the foliage.jpg map is dark leaf litter, and a dark map
// times a dark tint came out muddy-olive in the R2-14d smoke shot.
const LEAF_DARK = 0x3f8a36;
const LEAF_MID = 0x5da84e;
const LEAF_LIGHT = 0x93c46e;
const TRUNK_BROWN = 0x7a5a38;

// Three growth forms, picked per tree by hash. trunkH / crownR are
// metres at scale 1; `layers` is the number of stacked canopy blobs.
const FORMS = [
  { name: 'broadleaf', trunkH: 8.5, trunkR: 0.55, crownR: 5.2, layers: 4, y: 0.62 },
  { name: 'round', trunkH: 6.0, trunkR: 0.45, crownR: 4.4, layers: 3, y: 0.66 },
  { name: 'slim', trunkH: 9.5, trunkR: 0.32, crownR: 3.2, layers: 2, y: 0.7 },
];

// Deterministic hash -> [0, 1). Same seed, same trees, every load.
function hash01(n) {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function makeRng(seed) {
  let s = seed * 2654435761 % 4294967296;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Cone height of one island at (x, z), 0 outside it. Mirrors the
// terrain model in flight.js (terrainHeightAt) for the fallback path.
function coneHeight(island, x, z) {
  const dx = x - island.x;
  const dz = z - island.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist >= island.radius) return 0;
  return island.height * (1 - dist / island.radius);
}

function onRunwayRect(runway, margin, x, z) {
  if (!runway) return false;
  return (
    Math.abs(x - runway.x) <= runway.length / 2 + margin &&
    Math.abs(z - runway.z) <= runway.width / 2 + margin
  );
}

// --- Placement: clusters, not a grid -------------------------------------
// Each island gets shore groves (arcs along the beach) plus, on the big
// islands, 2-4 inland forest patches. Trees scatter gaussian around a
// cluster centre; a minimum-spacing check rejects crowding. The target
// count is a budget: placement stops when it is reached.
function planClusters(islands, rng, target) {
  const clusters = [];
  for (const island of islands) {
    const big = island.radius >= 300;
    // Shore groves: 2 arcs on big islands, 1 on small ones. Each arc
    // is centred on a random bearing and spans ~70 degrees of shore.
    const groveCount = big ? 2 : 1;
    for (let g = 0; g < groveCount; g++) {
      const bearing = rng() * Math.PI * 2;
      const span = (55 + rng() * 35) * Math.PI / 180;
      const rFrac = DEFAULTS.shoreBand[0] + rng() * (DEFAULTS.shoreBand[1] - DEFAULTS.shoreBand[0]);
      clusters.push({
        kind: 'shore',
        island,
        cx: island.x + Math.cos(bearing) * island.radius * rFrac,
        cz: island.z + Math.sin(bearing) * island.radius * rFrac,
        sigma: island.radius * 0.16,
        arc: { bearing, span },
        weight: big ? 0.34 : 0.5,
      });
    }
    // Inland forest patches on the big islands only.
    if (big) {
      const patches = 2 + Math.floor(rng() * 3);
      for (let p = 0; p < patches; p++) {
        const bearing = rng() * Math.PI * 2;
        const rFrac = 0.22 + rng() * 0.33;
        clusters.push({
          kind: 'forest',
          island,
          cx: island.x + Math.cos(bearing) * island.radius * rFrac,
          cz: island.z + Math.sin(bearing) * island.radius * rFrac,
          sigma: 42 + rng() * 30,
          arc: null,
          weight: 0.22,
        });
      }
    }
  }
  // Normalise weights into per-cluster tree budgets.
  const totalWeight = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  for (const c of clusters) c.budget = Math.max(4, Math.round(target * c.weight / totalWeight));
  return clusters;
}

function planTrees(islands, heightAt, runway, rng, target) {
  const clusters = planClusters(islands, rng, target);
  const trees = [];
  const placed = []; // [x, z] for the spacing check
  for (const c of clusters) {
    let made = 0;
    let tries = 0;
    while (made < c.budget && tries < c.budget * 12) {
      tries++;
      // Gaussian scatter around the cluster centre (Box-Muller).
      const u1 = Math.max(rng(), 1e-6);
      const u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const gauss2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      let x = c.cx + gauss * c.sigma;
      let z = c.cz + gauss2 * c.sigma;
      // Shore groves stay on their arc of beach: reject points that
      // drift too far around the island from the grove bearing.
      if (c.arc) {
        const b = Math.atan2(z - c.island.z, x - c.island.x);
        let d = Math.abs(b - c.arc.bearing);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > c.arc.span / 2) continue;
      }
      const dx = x - c.island.x;
      const dz = z - c.island.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= c.island.radius * 0.97) continue; // in the sea
      const groundY = heightAt(x, z);
      if (groundY < 1.2) continue; // sand rim / waterline, not soil
      // Keep trees off the steep upper slopes: forest stops where the
      // cone gets tall, so the volcano keeps its bare rock crown.
      if (groundY > c.island.height * DEFAULTS.maxSlopeFraction) continue;
      if (onRunwayRect(runway, DEFAULTS.runwayMargin, x, z)) continue;
      // Minimum spacing: cheap O(n) check, n is a few hundred.
      let crowded = false;
      for (let i = 0; i < placed.length; i++) {
        const px = placed[i][0] - x;
        const pz = placed[i][1] - z;
        if (px * px + pz * pz < DEFAULTS.minSpacing * DEFAULTS.minSpacing) { crowded = true; break; }
      }
      if (crowded) continue;
      placed.push([x, z]);
      const formIdx = Math.floor(rng() * FORMS.length);
      trees.push({
        x, z, y: groundY,
        form: FORMS[formIdx],
        // Scale 0.7-1.6, biased so most trees sit near 1.0-1.25.
        s: 0.7 + rng() * 0.9,
        yaw: rng() * Math.PI * 2,
        lean: (rng() - 0.5) * 0.12,
        tint: 0.95 + rng() * 0.3,
        seed: Math.floor(rng() * 1e9),
      });
      made++;
      if (trees.length >= target) return { trees, clusters };
    }
  }
  return { trees, clusters };
}

// --- Build: two InstancedMeshes ------------------------------------------
function buildTrunkMaterial(textureBase) {
  const mat = new THREE.MeshLambertMaterial({ color: TRUNK_BROWN });
  if (!textureBase) return mat;
  const loader = new THREE.TextureLoader();
  const tex = loader.load(
    textureBase + 'bark.jpg',
    (t) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 1);
      t.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    },
    undefined,
    () => { mat.map = null; mat.needsUpdate = true; } // missing file: flat colour
  );
  mat.map = tex;
  return mat;
}

function buildFoliageMaterial(textureBase) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  if (!textureBase) return mat;
  const loader = new THREE.TextureLoader();
  const tex = loader.load(
    textureBase + 'foliage.jpg',
    (t) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2);
      t.colorSpace = THREE.SRGBColorSpace;
      mat.needsUpdate = true;
    },
    undefined,
    () => { mat.map = null; mat.needsUpdate = true; }
  );
  mat.map = tex;
  return mat;
}

// One canopy blob geometry, shared by every layer of every tree:
// a slightly squashed icosahedron (detail 1) — faceted, so the
// flatShading foliage reads as leafy volume instead of a smooth ball.
let _blobGeo = null;
function getBlobGeo() {
  if (_blobGeo) return _blobGeo;
  _blobGeo = new THREE.IcosahedronGeometry(1, 1);
  _blobGeo.scale(1, 0.72, 1);
  return _blobGeo;
}

export function initTrees(scene, terrainInfo) {
  const info = terrainInfo || {};
  const islands = info.islands || [];
  const opts = Object.assign({}, DEFAULTS, info.options || {});
  const seed = info.seed !== undefined ? info.seed : opts.seed;
  const textureBase = info.textureBase !== undefined ? info.textureBase : opts.textureBase;
  const target = info.count !== undefined ? info.count : opts.count;
  const rng = makeRng(seed);
  const heightAt = info.heightAt || ((x, z) => {
    let h = 0;
    for (const island of islands) h = Math.max(h, coneHeight(island, x, z));
    return h;
  });

  const group = new THREE.Group();
  group.name = 'trees';
  if (!islands.length || target <= 0) {
    if (scene) scene.add(group);
    return { group, count: 0, clusters: [], dispose: () => { if (scene) scene.remove(group); } };
  }

  const { trees, clusters } = planTrees(islands, heightAt, info.runway || null, rng, target);
  if (!trees.length) {
    if (scene) scene.add(group);
    return { group, count: 0, clusters: [], dispose: () => { if (scene) scene.remove(group); } };
  }
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const disposables = [];

  // Trunks: one slightly tapered, 7-sided cylinder per tree, leaning
  // a touch, with a per-instance brown tint jitter.
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.58, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  disposables.push(trunkGeo);
  const trunkMat = buildTrunkMaterial(textureBase);
  disposables.push(trunkMat);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trees.forEach((t, i) => {
    const h = t.form.trunkH * t.s;
    // Base radius of the unit trunk geometry is 0.58 at the bottom, so
    // scaling by trunkR / 0.58 makes the planted radius exactly trunkR.
    const radial = t.s * (t.form.trunkR / 0.58) * (0.9 + hash01(t.seed + 1) * 0.2);
    dummy.position.set(t.x, t.y - 0.2, t.z);
    dummy.rotation.set(0, t.yaw, t.lean);
    dummy.scale.set(radial, h, radial);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex(TRUNK_BROWN).multiplyScalar(0.85 + hash01(t.seed + 3) * 0.3);
    trunks.setColorAt(i, tmpColor);
  });
  trunks.instanceMatrix.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  group.add(trunks);

  // Canopy: stacked blobs, one InstancedMesh for every layer of every
  // tree. Each layer sits higher and a little off-centre from the one
  // below, shrinks toward the top, and steps from dark shade green at
  // the bottom to sunlit light green at the crown — the layered look
  // that separates a tree from a single ball on a stick.
  const blobGeo = getBlobGeo();
  const blobCount = trees.reduce((s, t) => s + t.form.layers, 0);
  const foliageMat = buildFoliageMaterial(textureBase);
  disposables.push(foliageMat);
  const canopy = new THREE.InstancedMesh(blobGeo, foliageMat, blobCount);
  const leafStops = [LEAF_DARK, LEAF_MID, LEAF_LIGHT];
  let bi = 0;
  trees.forEach((t) => {
    const crownBaseY = t.y + t.form.trunkH * t.s * t.form.y;
    const crownR = t.form.crownR * t.s;
    for (let l = 0; l < t.form.layers; l++) {
      const f = t.form.layers === 1 ? 1 : l / (t.form.layers - 1);
      // Higher layers: smaller, and offset sideways so the crown is
      // lopsided like a real tree, not a stacked wedding cake.
      const r = crownR * (1 - f * 0.42) * (0.9 + hash01(t.seed + 10 + l) * 0.2);
      const ox = (hash01(t.seed + 20 + l) - 0.5) * crownR * 0.55;
      const oz = (hash01(t.seed + 30 + l) - 0.5) * crownR * 0.55;
      const oy = crownBaseY + l * crownR * 0.52;
      dummy.position.set(t.x + ox, oy, t.z + oz);
      dummy.rotation.set(0, hash01(t.seed + 40 + l) * Math.PI * 2, 0);
      dummy.scale.set(r, r * (0.8 + hash01(t.seed + 50 + l) * 0.25), r);
      dummy.updateMatrix();
      canopy.setMatrixAt(bi, dummy.matrix);
      const stop = leafStops[Math.min(leafStops.length - 1, Math.floor(f * leafStops.length))];
      tmpColor.setHex(stop).multiplyScalar(t.tint * (0.9 + hash01(t.seed + 60 + l) * 0.2));
      canopy.setColorAt(bi, tmpColor);
      bi++;
    }
  });
  canopy.instanceMatrix.needsUpdate = true;
  if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  group.add(canopy);

  if (scene) scene.add(group);
  return {
    group,
    count: trees.length,
    clusters: clusters.map((c) => ({ kind: c.kind, island: c.island.name, x: c.cx, z: c.cz, budget: c.budget })),
    dispose: () => {
      if (scene) scene.remove(group);
      disposables.forEach((d) => d.dispose && d.dispose());
      trunks.dispose();
      canopy.dispose();
    },
  };
}
