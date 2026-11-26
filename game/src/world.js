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
  seaDeep: 0x14586b,
  seaFoam: 0xfdf6dd,
  sand: 0xe8cf9a,
  sandWet: 0xd9b47c,
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

// A low-poly hill: a cone with a few radial segments, squashed flat.
function makeHill(radius, height, color, segments) {
  const geo = new THREE.ConeGeometry(radius, height, segments || 7);
  const mesh = new THREE.Mesh(geo, lambert(color, { flatShading: true }));
  mesh.position.y = height / 2 - 1;
  return mesh;
}

// One palm tree: a leaning trunk and a crown of flat fronds.
function makePalm(rng) {
  const palm = new THREE.Group();
  const lean = rng.range(-0.12, 0.12);
  const trunkH = rng.range(7, 11);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.6, trunkH, 5),
    lambert(PALETTE.palmTrunk, { flatShading: true })
  );
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = lean;
  palm.add(trunk);

  const fronds = rng.int(5, 7);
  for (let i = 0; i < fronds; i++) {
    const frond = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, rng.range(4.5, 6.5), 4),
      lambert(PALETTE.palmLeaf, { flatShading: true })
    );
    const angle = (i / fronds) * Math.PI * 2;
    frond.position.set(Math.cos(angle) * 2.2, trunkH + 0.6, Math.sin(angle) * 2.2);
    frond.rotation.z = Math.cos(angle) * 1.15;
    frond.rotation.x = -Math.sin(angle) * 1.15;
    frond.scale.set(1, 1, 0.35);
    palm.add(frond);
  }

  const nuts = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 6, 5),
    lambert(0x6b4a2a, { flatShading: true })
  );
  nuts.position.y = trunkH - 0.4;
  palm.add(nuts);
  return palm;
}

// A small island hut: whitewashed walls, a steep terracotta roof.
function makeHut(rng) {
  const hut = new THREE.Group();
  const w = rng.range(5, 8);
  const d = rng.range(5, 7);
  const h = rng.range(3, 4.5);

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(PALETTE.hutWall));
  walls.position.y = h / 2;
  hut.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.78, rng.range(2.5, 3.5), 4),
    lambert(PALETTE.hutRoof, { flatShading: true })
  );
  roof.position.y = h + 1.4;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2, 0.2),
    lambert(0x5a3a22)
  );
  door.position.set(0, 1, d / 2 + 0.05);
  hut.add(door);
  return hut;
}

// One named island: sand rim, grassy cone, extra hills, palms and huts.
function makeIsland(def, rng) {
  const island = new THREE.Group();
  island.position.set(def.x, 0, def.z);
  island.userData = { name: def.name, radius: def.radius, height: def.height };

  // Sand rim: a wide flat disc just above the water.
  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(def.radius, def.radius * 1.06, 3, 24),
    lambert(PALETTE.sand)
  );
  beach.position.y = 0.5;
  island.add(beach);

  // Wet-sand ring on the beach rim: a warmer, darker band where the
  // waves wash, so the shoreline grades sand -> wet sand -> foam.
  const wetSand = new THREE.Mesh(
    new THREE.RingGeometry(def.radius * 0.86, def.radius * 1.0, 28),
    lambert(PALETTE.sandWet, { transparent: true, opacity: 0.85 })
  );
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.y = 2.06;
  island.add(wetSand);

  // Foam fringe: a pale, semi-transparent band on the water just
  // outside the beach, so the shoreline reads as surf, not a hard edge.
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(def.radius * 1.0, def.radius * 1.16, 28),
    new THREE.MeshBasicMaterial({
      color: PALETTE.seaFoam,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
    })
  );
  foam.rotation.x = -Math.PI / 2;
  // Above the swell peaks (~1.0 m) so the surf band is never
  // swallowed by a wave crest.
  foam.position.y = 1.3;
  island.add(foam);

  // Main landmass: a low-poly cone; low islands vary between three
  // greens so the hills read as mixed vegetation, not one flat colour.
  const greens = [PALETTE.grass, PALETTE.grassDeep, PALETTE.grassLight];
  const mainColor =
    def.height > 120
      ? PALETTE.volcano
      : greens[rng.int(0, greens.length - 1)];
  const land = makeHill(def.radius * 0.92, def.height, mainColor, 9);
  land.position.y = def.height / 2 + 1;
  island.add(land);

  // Grassy cap on the tall volcanic island.
  if (def.height > 120) {
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(def.radius * 0.3, def.height * 0.35, 7),
      lambert(PALETTE.grassDry, { flatShading: true })
    );
    cap.position.y = def.height * 0.82;
    island.add(cap);
  }

  // A couple of smaller hills scattered on the bigger islands.
  const extraHills = def.radius > 400 ? 3 : 1;
  for (let i = 0; i < extraHills; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.25, def.radius * 0.6);
    const hill = makeHill(
      rng.range(def.radius * 0.18, def.radius * 0.3),
      rng.range(def.height * 0.25, def.height * 0.5),
      rng.pick([PALETTE.grass, PALETTE.grassDry, PALETTE.grassDeep, PALETTE.grassLight]),
      6
    );
    hill.position.set(Math.cos(angle) * dist, 1, Math.sin(angle) * dist);
    island.add(hill);
  }

  // Palm trees ring the beach; a few more inland on the low islands.
  // Denser than before (radius/38) so the islands read as inhabited
  // tropical shores, not bare cones.
  const palmCount = Math.round(def.radius / 38);
  for (let i = 0; i < palmCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.62, def.radius * 0.9);
    const palm = makePalm(rng);
    palm.position.set(Math.cos(angle) * dist, 1.5, Math.sin(angle) * dist);
    palm.rotation.y = rng.range(0, Math.PI * 2);
    const s = rng.range(0.8, 1.3);
    palm.scale.set(s, s, s);
    island.add(palm);
  }

  // Huts cluster near the shore; the runway island gets a few more.
  const hutCount = def.name === 'Garuda' ? 9 : rng.int(2, 5);
  for (let i = 0; i < hutCount; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(def.radius * 0.45, def.radius * 0.75);
    const hut = makeHut(rng);
    hut.position.set(Math.cos(angle) * dist, 1.5, Math.sin(angle) * dist);
    hut.rotation.y = rng.range(0, Math.PI * 2);
    island.add(hut);
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
    }
  }

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

  return runway;
}

// A glowing torus ring, standing upright and facing the flight line.
function makeRing(def, color, tilt) {
  const ring = new THREE.Group();
  ring.position.set(def.x, def.y, def.z);
  ring.userData = { radius: def.radius, passed: false };

  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(def.radius, 1.1, 8, 28),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.add(torus);

  // Inner glow disc, faint, so the hole reads from far away.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(def.radius * 0.92, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    })
  );
  ring.add(glow);

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
// warm cumulus in the middle, dark purple low cloud. Puffs cluster
// along the ring flight line (z = 330) so the cover/cockpit/rings shots
// fly past them, with the rest scattered over the archipelago. Faint
// shadow blobs on the sea under the flight-line clusters anchor the
// clouds to the world instead of floating decals.
function buildLayeredClouds(rng) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
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
    { key: 'cirrus', yMin: 300, yMax: 380, count: 80, rMin: 14, rMax: 26, flat: 0.3, color: 0xffe6bf, opacity: 0.8, driftMin: 1.5, driftMax: 3.0 },
    { key: 'cumulus', yMin: 150, yMax: 230, count: 140, rMin: 16, rMax: 30, flat: 0.55, color: 0xfff3e0, opacity: 0.92, driftMin: 1.2, driftMax: 2.6 },
    { key: 'low', yMin: 80, yMax: 130, count: 70, rMin: 12, rMax: 22, flat: 0.5, color: 0x8f7ba6, opacity: 0.95, driftMin: 1.8, driftMax: 3.2 },
  ];

  const layers = {};
  for (const def of layerDefs) {
    const mat = lambert(def.color, {
      flatShading: true,
      transparent: true,
      opacity: def.opacity,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, def.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new Float32Array(def.count * 3);
    const scale = new Float32Array(def.count * 3);
    const speed = new Float32Array(def.count);
    const ownClusters = lineClusters.filter((c) => c.layer === def.key);
    for (let i = 0; i < def.count; i++) {
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
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
      scale[i * 3] = r;
      scale[i * 3 + 1] = r * def.flat;
      scale[i * 3 + 2] = r;
      speed[i] = rng.range(def.driftMin, def.driftMax);
      dummy.position.set(x, y, z);
      dummy.scale.set(r, r * def.flat, r);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Jitter each puff's colour a few percent so the layer is not one
      // flat tint: the warm top / dark bottom read comes from the layer
      // colours themselves (bright cirrus, warm cumulus, purple low).
      const jitter = rng.range(0.9, 1.08);
      tmpColor.setHex(def.color).multiplyScalar(jitter);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.userData.cloudDrift = { base, scale, speed };
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    layers[def.key] = mesh;
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
    const y = terrainHeightAt(c.x, c.z) + 1.2;
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
  // Narrow across the streak: bright spine, soft transparent edges.
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 0, 128);
  across.addColorStop(0, 'rgba(255,255,255,0)');
  across.addColorStop(0.35, 'rgba(255,255,255,1)');
  across.addColorStop(0.65, 'rgba(255,255,255,1)');
  across.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 512, 128);

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(2600, 170);
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
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  // Centred on the flight line (z = 330) so the cover/rings shots fly
  // along it; just above the swell peaks (+1.0 m) so waves never hide it.
  streak.position.set(-350, 1.2, 330);
  streak.renderOrder = 2;
  return streak;
}

// Build the whole archipelago and return every piece the game needs.
export function buildWorld(rng) {
  const group = new THREE.Group();
  group.name = 'world';

  // Sea: one big plane, glossy so the low sun glints on it — a
  // brighter specular and higher shininess make the sun's path on the
  // water read clearly at golden hour.
  // Segmented (60x60) so the swell animation can move its vertices
  // smoothly — 70 units between vertices against a ~300-unit swell.
  // A small shader patch (onBeforeCompile) adds two things the plain
  // Phong material cannot do: a fresnel term, so the sea is dark when
  // looked down on and bright, sky-reflecting at grazing angles near
  // the horizon; and a fine normal ripple, so the specular sparkle
  // shimmers instead of sitting frozen on the swell.
  const seaMat = phong(PALETTE.sea, { shininess: 140, specular: 0xaaccdd });
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
        // Kept small (0.03): a stronger ripple bands the whole sea.
        normal = normalize(normal + vec3(
          sin(vG3WorldPos.x * 0.35 + uTime * 1.3) * 0.03 +
          sin(vG3WorldPos.z * 0.29 - uTime * 1.1) * 0.025,
          sin(vG3WorldPos.x * 0.21 - uTime * 0.8) * 0.025,
          cos(vG3WorldPos.z * 0.33 + uTime * 1.5) * 0.03
        ));`
      )
      .replace(
        '#include <output_fragment>',
        `#include <output_fragment>
        // Fresnel: only at true grazing angles (right at the horizon)
        // does the water turn toward the warm sky colour; seen from
        // above it stays deep. pow 5 keeps the bright band narrow —
        // pow 3 washed the whole sea white.
        {
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uFresnelColor, fres * 0.28);
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

  // A darker deep-water disc in the middle of the sea, for depth at range.
  // Kept inside the sea plane so it never pokes out past the edges.
  const deep = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD.seaSize * 0.45, 32),
    lambert(PALETTE.seaDeep)
  );
  deep.rotation.x = -Math.PI / 2;
  deep.position.y = -0.4;
  group.add(deep);

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
  const islands = WORLD.islands.map((def) => {
    const island = makeIsland(def, rng);
    shadowify(island);
    group.add(island);
    return island;
  });

  // Coastal runway on Garuda.
  const runway = makeRunway(WORLD.runway);
  shadowify(runway);
  group.add(runway);

  // 8 orange target rings, 6 red storm rings, 3 green fuel rings.
  const rings = WORLD.rings.map((def) => {
    const ring = makeRing(def, PALETTE.ringOrange, 0);
    group.add(ring);
    return ring;
  });
  const stormRings = WORLD.stormRings.map((def) => {
    const ring = makeRing(def, PALETTE.stormRed, 0.08);
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

  // Layered clouds: cirrus high, cumulus mid, low purple — three
  // InstancedMesh layers plus faint shadow blobs on the sea below.
  const cloudSet = buildLayeredClouds(rng);
  group.add(cloudSet.cirrus);
  group.add(cloudSet.cumulus);
  group.add(cloudSet.low);
  group.add(cloudSet.blobs);

  const world = {
    group,
    islands,
    runway,
    rings,
    stormRings,
    checkpoints,
    fuelRings,
    clouds: [cloudSet.cirrus, cloudSet.cumulus, cloudSet.low],
    cloudLayers: [cloudSet.cirrus, cloudSet.cumulus, cloudSet.low],
    cloudClusters: cloudSet.clusters,
    cloudBlobs: cloudSet.blobs,
    sea,
    glint,
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
  return world;
}
