// Garuda Skies — world: sea, islands, runway, rings, checkpoints, clouds.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). All positions come from WORLD
// in config.js; the seeded rng only dresses the islands (palms, huts,
// hills) so the layout is deterministic.

import { WORLD } from './config.js';

// Warm golden-hour palette for the whole archipelago.
const PALETTE = {
  sea: 0x1e6f7d,
  seaDeep: 0x14586b,
  sand: 0xe8cf9a,
  grass: 0x5da24a,
  grassDry: 0x8aa84f,
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

  // Main landmass: a low-poly cone, greener on small islands.
  const mainColor = def.height > 120 ? PALETTE.volcano : PALETTE.grass;
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
      rng.chance(0.5) ? PALETTE.grass : PALETTE.grassDry,
      6
    );
    hill.position.set(Math.cos(angle) * dist, 1, Math.sin(angle) * dist);
    island.add(hill);
  }

  // Palm trees ring the beach; a few more inland on the low islands.
  const palmCount = Math.round(def.radius / 55);
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
  const hutCount = def.name === 'Garuda' ? 6 : rng.int(1, 3);
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

// A low-poly cloud: a few flattened white blobs drifting in the sky.
function makeCloud(rng, x, y, z) {
  const cloud = new THREE.Group();
  cloud.position.set(x, y, z);
  const puffs = rng.int(3, 5);
  for (let i = 0; i < puffs; i++) {
    const r = rng.range(9, 18);
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      lambert(PALETTE.cloud, { flatShading: true, transparent: true, opacity: 0.92 })
    );
    puff.position.set(rng.range(-16, 16), rng.range(-2, 3), rng.range(-8, 8));
    puff.scale.y = 0.55;
    cloud.add(puff);
  }
  cloud.userData.driftSpeed = rng.range(1.5, 3.5);
  return cloud;
}

// Build the whole archipelago and return every piece the game needs.
export function buildWorld(rng) {
  const group = new THREE.Group();
  group.name = 'world';

  // Sea: one big plane, slightly glossy so the low sun glints on it.
  // Segmented (60x60) so the swell animation can move its vertices
  // smoothly — 70 units between vertices against a ~300-unit swell.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.seaSize, WORLD.seaSize, 60, 60),
    phong(PALETTE.sea, { shininess: 90, specular: 0x557788 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  // Flat copy of the rest positions: the swell writes heights from these.
  sea.userData.basePositions = sea.geometry.attributes.position.array.slice();
  group.add(sea);

  // A darker deep-water disc in the middle of the sea, for depth at range.
  // Kept inside the sea plane so it never pokes out past the edges.
  const deep = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD.seaSize * 0.45, 32),
    lambert(PALETTE.seaDeep)
  );
  deep.rotation.x = -Math.PI / 2;
  deep.position.y = -0.4;
  group.add(deep);

  // The five named islands.
  const islands = WORLD.islands.map((def) => {
    const island = makeIsland(def, rng);
    group.add(island);
    return island;
  });

  // Coastal runway on Garuda.
  const runway = makeRunway(WORLD.runway);
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

  // Drifting clouds high above the sea, clear of the rings.
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const cloud = makeCloud(
      rng,
      rng.range(-1800, 1800),
      rng.range(240, 380),
      rng.range(-1800, 1800)
    );
    group.add(cloud);
    clouds.push(cloud);
  }

  const world = {
    group,
    islands,
    runway,
    rings,
    stormRings,
    checkpoints,
    fuelRings,
    clouds,
    sea,
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
