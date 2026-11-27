// Garuda Skies — flight effects: layered-cloud drift + in-cloud fog,
// wingtip contrails and wind streaks.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). Cheap by design: the
// clouds are three InstancedMesh layers (world.js), the contrails are
// two camera-facing ribbon strips, the streaks one LineSegments —
// no textures, no extra draw calls beyond a handful.

import { TUNING } from './config.js';
import { terrainHeightAt } from './flight.js';

const TRAIL_POINTS = 16;
const STREAK_COUNT = 12;

// The horizon colour (warm golden-hour haze): trail and streak colours
// fade toward it, so a dying contrail melts into the sky instead of
// popping out.
const HORIZON = new THREE.Color(0xffb36b);
const FOG_WHITE = new THREE.Color(0xfdf6ec);
const TRAIL_WHITE = new THREE.Color(0xffffff);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Forward vector of the plane from its yaw/pitch (nose-first along -Z
// rotated by yaw, pitched up by pitch).
function forwardOf(state, out) {
  const cp = Math.cos(state.pitch || 0);
  out.set(
    -cp * Math.sin(state.yaw || 0),
    Math.sin(state.pitch || 0),
    -cp * Math.cos(state.yaw || 0)
  );
  return out;
}

// Wrap a drifting x back into the play area, so clouds never pile up
// at the east edge.
function wrapX(x) {
  const w = ((x + 2100) % 4200 + 4200) % 4200;
  return w - 2100;
}

export function createEffects(scene, world) {
  let aircraft = null;

  // The scene fog at boot: the in-cloud effect lerps toward a close
  // white fog and back, so flying through a puff whites the view out.
  const fogBase =
    scene && scene.fog
      ? { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone() }
      : null;

  const dummy = new THREE.Object3D();
  const blobQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpForward = new THREE.Vector3();
  const tmpColor = new THREE.Color();

  let cloudTime = 0;
  let cloudInstances = 0;
  if (world && world.cloudLayers) {
    for (const layer of world.cloudLayers) cloudInstances += layer.count;
  }

  // --- Drift one cloud layer (or the blob layer) east, wrapping at the
  // map edge. Blob shadows re-pin to the ground under their new x.
  function driftLayer(mesh, dt) {
    const drift = mesh.userData.cloudDrift;
    if (!drift) return;
    const isBlob = !!mesh.userData.isBlob;
    const n = drift.speed.length;
    for (let i = 0; i < n; i++) {
      const x = wrapX(drift.base[i * 3] + drift.speed[i] * cloudTime);
      const z = drift.base[i * 3 + 2];
      // Blobs sit just above the taller swell (peaks ~2 m) so waves
      // never swallow them; cloud puffs breathe gently up and down,
      // each with its own phase, so the layers feel alive, not frozen.
      // Amplitude 1.5 m: enough to feel alive, small enough that a
      // posed shot never catches a cluster drifted out of frame.
      const y = isBlob
        ? terrainHeightAt(x, z) + 2.2
        : drift.base[i * 3 + 1] + Math.sin(cloudTime * 0.12 + i * 1.7) * 1.5;
      dummy.position.set(x, y, z);
      dummy.quaternion.copy(isBlob ? blobQuat : dummy.quaternion.identity());
      dummy.scale.set(
        drift.scale[i * 3],
        drift.scale[i * 3 + 1],
        drift.scale[i * 3 + 2]
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // --- One wingtip contrail: a ribbon rebuilt every frame from the
  // last wingtip samples, camera-facing so it always reads as a streak.
  function makeContrail() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_POINTS * 2 * 3);
    const colors = new Float32Array(TRAIL_POINTS * 2 * 3);
    const index = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage)
    );
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    if (scene) scene.add(mesh);
    return { mesh, points: [], timer: 0, opacity: 0 };
  }

  const contrails = [makeContrail(), makeContrail()];
  // Wingtip anchors in the plane's local space (nav-light positions).
  const tipLocal = [
    new THREE.Vector3(-4.7, -0.25, -0.2),
    new THREE.Vector3(4.7, -0.25, -0.2),
  ];

  // --- Wind streaks: short white lines in camera space that spawn
  // ahead and rush past when the plane is fast, selling speed.
  const streakGeo = new THREE.BufferGeometry();
  const streakPos = new Float32Array(STREAK_COUNT * 2 * 3);
  streakGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(streakPos, 3).setUsage(THREE.DynamicDrawUsage)
  );
  const streakMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 2;
  if (scene) scene.add(streaks);
  const streakLocal = [];
  for (let i = 0; i < STREAK_COUNT; i++) {
    streakLocal.push({
      x: (Math.random() - 0.5) * 36,
      y: (Math.random() - 0.5) * 20,
      z: -8 - Math.random() * 62,
    });
  }

  // --- Hit bursts (R2-11c combat): a small pool of amber spheres that
  // expand and fade when a drone pengintai goes down. burst(pos) fires
  // one; update() grows it. Three is plenty — drones fall one at a time.
  const bursts = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb36b,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    if (scene) scene.add(mesh);
    bursts.push({ mesh, life: 0 });
  }
  let burstNext = 0;

  const api = {
    inCloud: 0,
    contrailOpacity: 0,
    streakOpacity: 0,
    cloudInstances,

    // Flash a burst at a world position (drone down, hit feedback).
    burst(pos) {
      if (!pos) return;
      const b = bursts[burstNext];
      burstNext = (burstNext + 1) % bursts.length;
      b.mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
      b.mesh.scale.set(1, 1, 1);
      b.mesh.visible = true;
      b.mesh.material.opacity = 0.9;
      b.life = 0.5;
    },

    setAircraft(ac) {
      aircraft = ac || null;
    },

    update(dt, state, camera) {
      dt = Math.min(dt || 0.016, 0.05);
      const st = state || {};
      const pos = st.position || { x: 0, y: 10, z: 0 };
      const speedRatio = (st.speed || 0) / (st.maxSpeed || TUNING.flight.maxSpeed);
      const banking = Math.abs(st.bankDeg || 0);

      // --- Clouds drift east; blobs follow their clusters on the sea.
      cloudTime += dt;
      if (world && world.cloudLayers) {
        for (const layer of world.cloudLayers) driftLayer(layer, dt);
        if (world.cloudBlobs) driftLayer(world.cloudBlobs, dt);
      }

      // --- Morning mist banks drift east too, slower and lower than
      // the clouds, staying flat on the water (their fixed flat
      // quaternion is kept — driftLayer would stand them upright).
      if (world && world.mist && world.mist.userData.mistDrift) {
        const drift = world.mist.userData.mistDrift;
        for (let i = 0; i < drift.speed.length; i++) {
          const x = wrapX(drift.base[i * 3] + drift.speed[i] * cloudTime);
          dummy.position.set(x, drift.base[i * 3 + 1], drift.base[i * 3 + 2]);
          dummy.quaternion.copy(drift.quat);
          dummy.scale.set(drift.scale[i * 3], drift.scale[i * 3 + 1], 1);
          dummy.updateMatrix();
          world.mist.setMatrixAt(i, dummy.matrix);
        }
        world.mist.instanceMatrix.needsUpdate = true;
      }

      // --- Lighthouse beam sweeps slowly around its tower.
      if (world && world.lighthouseBeam) {
        world.lighthouseBeam.rotation.y += dt * 0.6;
      }

      // --- In-cloud fog: nearest flight-line cluster decides how white
      // the view goes (0 outside, 1 deep inside). The fog eases in and
      // out so entering a puff never snaps. Puffs stay soft from the
      // inside: low opacity, no hard shell, nothing "breaks".
      let inside = 0;
      if (world && world.cloudClusters) {
        let best = Infinity;
        let bestR = 0;
        for (const c of world.cloudClusters) {
          const dx = pos.x - c.x;
          const dy = pos.y - c.y;
          const dz = pos.z - c.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < best) {
            best = d;
            bestR = c.radius;
          }
        }
        if (bestR > 0 && best < bestR) {
          inside = 1 - clamp((best - bestR * 0.55) / (bestR * 0.45), 0, 1);
        }
      }
      api.inCloud += (inside - api.inCloud) * Math.min(1, dt * 2.5);
      if (scene && scene.fog && fogBase) {
        const f = api.inCloud;
        scene.fog.near = lerp(fogBase.near, 8, f);
        scene.fog.far = lerp(fogBase.far, 90, f);
        scene.fog.color.copy(fogBase.color).lerp(FOG_WHITE, f);
      }

      // --- Wingtip contrails: bank past ~25 deg (or fast + banked)
      // sheds a vortex trail from each tip; level flight sheds none.
      forwardOf(st, tmpForward);
      api.contrailOpacity = 0;
      const wantTrail =
        (st.status === 'flying' || st.status === undefined) &&
        (banking > 25 || (speedRatio > 0.8 && banking > 12));
      for (let s = 0; s < 2; s++) {
        const trail = contrails[s];
        trail.timer += dt;
        if (aircraft && aircraft.group && trail.timer >= 0.05) {
          trail.timer = 0;
          aircraft.group.updateMatrixWorld(true);
          tmpVec.copy(tipLocal[s]);
          aircraft.group.localToWorld(tmpVec);
          const last = trail.points[0];
          if (last && last.distanceTo(tmpVec) < 0.5) {
            // Posed / frozen frame: the tip does not move, so stream
            // the stored trail backwards along the flight path at the
            // posed speed — otherwise a still shot shows no trail.
            forwardOf(st, tmpForward);
            const step = (st.speed || 0) * 0.05;
            for (const p of trail.points) p.addScaledVector(tmpForward, -step);
          }
          trail.points.unshift(tmpVec.clone());
          if (trail.points.length > TRAIL_POINTS) trail.points.pop();
        }
        if (!wantTrail && trail.points.length > 0) {
          // Trail decays from the tail when the bank eases off.
          trail.points.pop();
        }
        const n = trail.points.length;
        const targetOpacity = wantTrail && n >= 2 ? 0.85 : 0;
        trail.opacity += (targetOpacity - trail.opacity) * Math.min(1, dt * 3);
        api.contrailOpacity = Math.max(api.contrailOpacity, trail.opacity);
        const mat = trail.mesh.material;
        mat.opacity = trail.opacity;
        trail.mesh.visible = trail.opacity > 0.02 && n >= 2;
        if (trail.mesh.visible && camera) {
          const posAttr = trail.mesh.geometry.attributes.position;
          const colAttr = trail.mesh.geometry.attributes.color;
          for (let i = 0; i < n; i++) {
            const p = trail.points[i];
            const age = n > 1 ? i / (n - 1) : 0;
            // Segment direction (toward the older point) crossed with
            // the view direction gives the camera-facing ribbon edge.
            const q = trail.points[Math.min(i + 1, n - 1)];
            tmpVec.copy(p).sub(q);
            if (tmpVec.lengthSq() < 0.0001) tmpVec.copy(tmpForward);
            tmpVec.normalize();
            tmpVec2.copy(camera.position).sub(p).normalize();
            tmpVec.cross(tmpVec2);
            if (tmpVec.lengthSq() < 0.0001) tmpVec.set(0, 1, 0);
            tmpVec.normalize();
            const half = 0.25 + age * 0.65;
            posAttr.array[i * 6] = p.x + tmpVec.x * half;
            posAttr.array[i * 6 + 1] = p.y + tmpVec.y * half;
            posAttr.array[i * 6 + 2] = p.z + tmpVec.z * half;
            posAttr.array[i * 6 + 3] = p.x - tmpVec.x * half;
            posAttr.array[i * 6 + 4] = p.y - tmpVec.y * half;
            posAttr.array[i * 6 + 5] = p.z - tmpVec.z * half;
            // White at the tip, melting into horizon haze at the tail.
            tmpColor.copy(TRAIL_WHITE).lerp(HORIZON, age * 0.85);
            colAttr.array[i * 6] = tmpColor.r;
            colAttr.array[i * 6 + 1] = tmpColor.g;
            colAttr.array[i * 6 + 2] = tmpColor.b;
            colAttr.array[i * 6 + 3] = tmpColor.r;
            colAttr.array[i * 6 + 4] = tmpColor.g;
            colAttr.array[i * 6 + 5] = tmpColor.b;
          }
          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
          trail.mesh.geometry.setDrawRange(0, (n - 1) * 6);
        }
      }
      // (api.contrailOpacity was reset to 0 before the loop, so it now
      // holds the stronger of the two trails this frame, and decays
      // with them when the bank eases off.)

      // --- Wind streaks: past 70% of max speed, short lines spawn
      // ahead of the camera and rush past it, then respawn.
      const streakTarget =
        speedRatio > 0.7 ? 0.5 * ((speedRatio - 0.7) / 0.3) : 0;
      streakMat.opacity += (streakTarget - streakMat.opacity) * Math.min(1, dt * 4);
      api.streakOpacity = streakMat.opacity;
      if (camera && streakMat.opacity > 0.01) {
        camera.updateMatrixWorld();
        const len = 4 + (st.speed || 0) * 0.08;
        for (let i = 0; i < STREAK_COUNT; i++) {
          const s = streakLocal[i];
          s.z += (st.speed || 0) * dt * 1.15;
          if (s.z > 4) {
            s.z = -55 - Math.random() * 15;
            s.x = (Math.random() - 0.5) * 36;
            s.y = (Math.random() - 0.5) * 20;
          }
          tmpVec.set(s.x, s.y, s.z).applyMatrix4(camera.matrixWorld);
          streakPos[i * 6] = tmpVec.x;
          streakPos[i * 6 + 1] = tmpVec.y;
          streakPos[i * 6 + 2] = tmpVec.z;
          tmpVec.set(s.x, s.y, s.z + len).applyMatrix4(camera.matrixWorld);
          streakPos[i * 6 + 3] = tmpVec.x;
          streakPos[i * 6 + 4] = tmpVec.y;
          streakPos[i * 6 + 5] = tmpVec.z;
        }
        streakGeo.attributes.position.needsUpdate = true;
      }
      streaks.visible = streakMat.opacity > 0.01;

      // --- Hit bursts: grow to ~14 m across and fade out in 0.5 s.
      for (const b of bursts) {
        if (b.life <= 0) continue;
        b.life -= dt;
        if (b.life <= 0) {
          b.mesh.visible = false;
          b.mesh.material.opacity = 0;
        } else {
          const k = 1 - b.life / 0.5;
          const s = 1 + k * 13;
          b.mesh.scale.set(s, s, s);
          b.mesh.material.opacity = 0.9 * (1 - k);
        }
      }
    },
  };
  return api;
}
