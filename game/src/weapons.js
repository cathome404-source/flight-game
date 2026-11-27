// Garuda Skies — senjata sederhana: tembak drone pengintai.
// Written fresh from the R2 prose spec (R2-11c). Our own combat, in
// Garuda Skies' style: no lock-on, no missiles, no jet-fighter theme.
// The pilot fires a short tracer burst (Space) from the nose; a ray
// from the nose tests the hit. Drones are slow "drone pengintai" that
// drift in small circles near the chase gates (sortie 6) and inside
// the storm cell (sortie 12 boss). A drone takes 2 hits; dropping one
// scores points and counts toward the sortie's progress. Outside
// those two sorties there are no drones and Space does nothing.

import { WORLD, TUNING } from './config.js';

// Seconds between shots, so holding Space fires a steady burst.
const COOLDOWN = 0.35;
// Longest distance a shot can reach, metres.
const RANGE = 350;
// Lateral tolerance around the shot ray, metres — generous on
// purpose: this is arcade shooting, not a sniper sim.
const HIT_RADIUS = 7;
// Hits a drone survives before it goes down.
const DRONE_HP = 2;
// Seconds a tracer stays visible.
const TRACER_LIFE = 0.12;
// Visible tracer length, metres.
const TRACER_LENGTH = 60;
// Points per drone, from TUNING.scoring.dronePoints when set.
const FALLBACK_POINTS = 300;

// Forward vector of the plane from its yaw/pitch (same convention as
// flight.js / effects.js: nose-first along -Z rotated by yaw).
function forwardOf(state, out) {
  const cp = Math.cos(state.pitch || 0);
  out.set(
    -cp * Math.sin(state.yaw || 0),
    Math.sin(state.pitch || 0),
    -cp * Math.cos(state.yaw || 0)
  );
  return out;
}

export function createWeapons(scene, flight, hooks) {
  const onDroneDown = hooks && hooks.onDroneDown;
  const onHit = hooks && hooks.onHit;
  const onBurst = hooks && hooks.onBurst;
  const points =
    (TUNING.scoring && TUNING.scoring.dronePoints) || FALLBACK_POINTS;

  const tmpForward = new THREE.Vector3();
  const tmpNose = new THREE.Vector3();
  const tmpEnd = new THREE.Vector3();
  const tmpDelta = new THREE.Vector3();

  let sortieId = null;
  let drones = [];
  let cooldown = 0;
  let down = 0;
  let total = 0;

  // --- Tracer pool: thin amber boxes stretched along the shot ray,
  // fading out over TRACER_LIFE. Four is plenty at a 0.35 s cadence.
  const tracers = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.BoxGeometry(0.15, 0.15, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc233,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    if (scene) scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  function spawnTracer(origin, dir) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    tmpEnd.copy(origin).addScaledVector(dir, TRACER_LENGTH);
    t.mesh.position.copy(origin).addScaledVector(dir, TRACER_LENGTH / 2);
    t.mesh.lookAt(tmpEnd);
    t.mesh.scale.set(1, 1, TRACER_LENGTH);
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.95;
    t.life = TRACER_LIFE;
  }

  // --- One drone: a dark scout body with a red eye and an amber
  // ring, so it reads as a target from far away instead of a speck.
  function makeDrone(anchor) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a2e,
      roughness: 0.6,
      metalness: 0.3,
      emissive: 0x30060a,
    });
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), bodyMat);
    group.add(body);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), eyeMat);
    eye.position.set(0, 0, 2.0);
    group.add(eye);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb36b,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.22, 8, 28), ringMat);
    group.add(ring);
    group.position.set(anchor.x, anchor.y, anchor.z);
    if (scene) scene.add(group);
    return {
      group,
      body,
      bodyMat,
      eye,
      eyeMat,
      ring,
      anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
      hp: DRONE_HP,
      alive: true,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
    };
  }

  function clearDrones() {
    for (const d of drones) {
      if (scene) scene.remove(d.group);
      d.body.geometry.dispose();
      d.eye.geometry.dispose();
      d.ring.geometry.dispose();
      d.bodyMat.dispose();
      d.eyeMat.dispose();
      d.ring.material.dispose();
    }
    drones = [];
    down = 0;
    total = 0;
  }

  function spawnDrones(defs) {
    clearDrones();
    for (const def of defs || []) {
      drones.push(makeDrone(def));
    }
    total = drones.length;
  }

  function setSortie(id) {
    if (id === sortieId) return;
    sortieId = id || null;
    // A sortie change ends any shot in flight: hide live tracers so
    // none lingers across the cut.
    for (const t of tracers) {
      t.life = 0;
      t.mesh.visible = false;
      t.mesh.material.opacity = 0;
    }
    if (sortieId === 'chase') {
      spawnDrones((WORLD && WORLD.chaseDrones) || []);
    } else if (sortieId === 'boss') {
      spawnDrones((WORLD && WORLD.bossDrones) || []);
    } else {
      clearDrones();
    }
  }

  // Ray test: the nearest live drone whose centre passes within
  // HIT_RADIUS of the shot ray, inside RANGE.
  function pickHit(origin, dir) {
    let best = null;
    let bestT = Infinity;
    for (const d of drones) {
      if (!d.alive) continue;
      tmpDelta.set(
        d.group.position.x - origin.x,
        d.group.position.y - origin.y,
        d.group.position.z - origin.z
      );
      const t = tmpDelta.dot(dir);
      if (t < 2 || t > RANGE) continue;
      const cx = origin.x + dir.x * t - d.group.position.x;
      const cy = origin.y + dir.y * t - d.group.position.y;
      const cz = origin.z + dir.z * t - d.group.position.z;
      const miss = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (miss < HIT_RADIUS && t < bestT) {
        best = d;
        bestT = t;
      }
    }
    return best;
  }

  function fire() {
    cooldown = COOLDOWN;
    const st = flight && flight.state;
    if (!st || !st.position) return;
    forwardOf(st, tmpForward);
    tmpNose.copy(st.position).addScaledVector(tmpForward, 4.5);
    tmpNose.y += 0.4;
    spawnTracer(tmpNose, tmpForward);
    const hit = pickHit(tmpNose, tmpForward);
    if (!hit) return;
    hit.hp -= 1;
    hit.flash = 0.18;
    if (typeof onHit === 'function') onHit(hit, hit.hp);
    if (hit.hp > 0) return;
    hit.alive = false;
    hit.group.visible = false;
    down += 1;
    if (typeof onBurst === 'function') {
      onBurst({
        x: hit.group.position.x,
        y: hit.group.position.y,
        z: hit.group.position.z,
      });
    }
    if (typeof onDroneDown === 'function') onDroneDown(hit, points);
  }

  return {
    // Live drones (for HUD / tests): each has group.position, hp, alive.
    get drones() {
      return drones;
    },
    get points() {
      return points;
    },

    // One-line HUD state: null when this sortie has no combat.
    status() {
      if (sortieId !== 'chase' && sortieId !== 'boss') return null;
      return {
        active: true,
        ready: cooldown <= 0,
        down,
        total,
      };
    },

    // Called every frame while playing: spawns/clears drones when the
    // sortie changes, drifts live drones, fades tracers, and fires
    // while the trigger is held (cooldown-gated).
    update(dt, firing, id) {
      dt = Math.min(dt || 0.016, 0.05);
      setSortie(id);
      if (cooldown > 0) cooldown -= dt;
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.mesh.visible = false;
          t.mesh.material.opacity = 0;
        } else {
          t.mesh.material.opacity = 0.95 * (t.life / TRACER_LIFE);
        }
      }
      const time = (performance.now() || 0) / 1000;
      for (const d of drones) {
        if (!d.alive) continue;
        // Slow patrol: a small circle around the anchor plus a bob,
        // so the drone is a moving target but never leaves the area.
        const a = d.phase + time * 0.35;
        d.group.position.set(
          d.anchor.x + Math.cos(a) * 10,
          d.anchor.y + Math.sin(time * 0.6 + d.phase) * 3,
          d.anchor.z + Math.sin(a) * 10
        );
        d.ring.rotation.y += dt * 0.8;
        d.ring.rotation.x = Math.sin(time * 0.5 + d.phase) * 0.3;
        if (d.flash > 0) {
          d.flash -= dt;
          const f = Math.max(0, d.flash) / 0.18;
          d.eyeMat.color.setRGB(1, 0.4 + 0.6 * f, 0.4 + 0.6 * f);
          const s = 1 + 0.35 * f;
          d.group.scale.set(s, s, s);
          if (d.flash <= 0) {
            d.eyeMat.color.setHex(0xff3b30);
            d.group.scale.set(1, 1, 1);
          }
        }
      }
      const st = flight && flight.state;
      const canFire =
        firing &&
        (sortieId === 'chase' || sortieId === 'boss') &&
        st &&
        st.status === 'flying' &&
        cooldown <= 0;
      if (canFire) fire();
    },

    // Test hook: fire once immediately, bypassing the trigger check
    // (still respects the cooldown and the flying state).
    testFire() {
      const st = flight && flight.state;
      if (!st || st.status !== 'flying') return false;
      if (cooldown > 0) return false;
      if (sortieId !== 'chase' && sortieId !== 'boss') return false;
      fire();
      return true;
    },

    destroy() {
      clearDrones();
      for (const t of tracers) {
        if (scene) scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
      }
    },
  };
}
