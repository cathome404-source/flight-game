// Garuda Skies — renderer: golden-hour sky, sun, chase + cockpit cameras.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). The world group is added to
// the scene here; the aircraft group is added by main.js. One real render
// camera is lerped toward the active virtual camera (chase or cockpit),
// so toggling C glides instead of snapping.

import { TUNING, WORLD } from './config.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
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

// Sun direction from the config azimuth/elevation (low in the west).
function sunDirection() {
  const az = (WORLD.sun.azimuth || 262) * DEG;
  const el = (WORLD.sun.elevation || 14) * DEG;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: Math.cos(el) * Math.cos(az),
  };
}

// A soft radial glow texture drawn on a canvas — no image file needed.
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 225, 160, 1)');
  grad.addColorStop(0.25, 'rgba(255, 190, 110, 0.55)');
  grad.addColorStop(0.6, 'rgba(255, 140, 60, 0.18)');
  grad.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

// Sky dome: a big backside sphere whose vertex colours blend from the
// warm horizon to the deep zenith, so the sky reads as a gradient.
function makeSkyDome() {
  const geo = new THREE.SphereGeometry(3600, 28, 18);
  const horizon = new THREE.Color(WORLD.sky.horizon);
  const zenith = new THREE.Color(WORLD.sky.zenith);
  const below = new THREE.Color(0x8a5a3a);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 3600;
    if (y >= 0) {
      tmp.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    } else {
      tmp.copy(horizon).lerp(below, Math.min(1, -y * 3));
    }
    colours[i * 3] = tmp.r;
    colours[i * 3 + 1] = tmp.g;
    colours[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'sky-dome';
  return dome;
}

export function createRenderer(canvas, world) {
  const camCfg = TUNING.camera;
  const fov = camCfg.fov || 68;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(WORLD.sky.horizon, 900, 3400);
  scene.add(makeSkyDome());
  if (world && world.group) scene.add(world.group);

  // --- Golden-hour lighting: low warm sun, sky bounce, soft fill.
  const sunDir = sunDirection();
  const sun = new THREE.DirectionalLight(WORLD.sky.sun, 1.7);
  sun.position.set(sunDir.x * 900, sunDir.y * 900, sunDir.z * 900);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(WORLD.sky.zenith, 0xe8cf9a, 0.85);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffe0b3, 0.28);
  scene.add(ambient);

  // --- Lens glow: one bright sprite at the sun plus two faint ghosts.
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sunGlow = new THREE.Sprite(glowMat);
  sunGlow.position.set(sunDir.x * 3200, sunDir.y * 3200, sunDir.z * 3200);
  sunGlow.scale.set(1100, 1100, 1);
  scene.add(sunGlow);
  const ghosts = [];
  for (let i = 0; i < 2; i++) {
    const ghost = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.28 - i * 0.1,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    ghost.position.set(
      sunDir.x * 3200 + (i === 0 ? 260 : -420),
      sunDir.y * 3200 + (i === 0 ? -120 : 180),
      sunDir.z * 3200
    );
    const s = 260 - i * 90;
    ghost.scale.set(s, s, 1);
    scene.add(ghost);
    ghosts.push(ghost);
  }

  // --- Landing / headlight: a spotlight at the nose, aimed ahead-down.
  // It brightens as the plane gets low and close to the runway.
  const landingLight = new THREE.SpotLight(0xffe9a8, 0, 420, 0.55, 0.45, 1.1);
  scene.add(landingLight);
  scene.add(landingLight.target);

  // --- Cameras: two virtual cameras plus the one real camera that the
  // renderer draws with. The real camera chases the active virtual one.
  const aspect = 16 / 10;
  const chaseCamera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 8000);
  const cockpitCamera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 8000);
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 8000);
  camera.position.set(-40, 30, 360);
  camera.lookAt(0, 10, 330);

  let view = 'chase';
  let lookYaw = 0;
  let lookPitch = 0;
  let shakeAmp = 0;
  let prevDamage = 0;
  let crashShakeDone = false;
  // True until the first frame (or after snap()): the camera jumps
  // straight to the active view instead of gliding across the map.
  // Headless screenshots only render a handful of frames, so without
  // this the shot would catch the camera mid-glide.
  let snapNext = true;

  const tmpForward = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function resize() {
    const w = (canvas && canvas.clientWidth) || window.innerWidth || 1280;
    const h = (canvas && canvas.clientHeight) || window.innerHeight || 800;
    renderer.setSize(w, h, false);
    const a = w / Math.max(1, h);
    camera.aspect = a;
    chaseCamera.aspect = a;
    cockpitCamera.aspect = a;
    camera.updateProjectionMatrix();
    chaseCamera.updateProjectionMatrix();
    cockpitCamera.updateProjectionMatrix();
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', resize);
  }
  resize();

  // Where the chase camera wants to be: behind and above the plane,
  // swung by the mouse-look offsets, never fighting the pilot's heading.
  function updateChaseCamera(state) {
    const yawEff = (state.yaw || 0) + lookYaw;
    const pitchEff = clamp((state.pitch || 0) + lookPitch * 0.5, -0.6, 0.6);
    const back = new THREE.Vector3(
      Math.sin(yawEff) * Math.cos(pitchEff),
      -Math.sin(pitchEff),
      Math.cos(yawEff) * Math.cos(pitchEff)
    );
    chaseCamera.position
      .copy(state.position)
      .addScaledVector(back, camCfg.chaseDistance);
    chaseCamera.position.y += camCfg.chaseHeight;
    forwardOf(state, tmpForward);
    tmpTarget
      .copy(state.position)
      .addScaledVector(tmpForward, 14);
    tmpTarget.y += 1.2;
    chaseCamera.lookAt(tmpTarget);
  }

  // Where the cockpit camera wants to be: the pilot's eye, looking
  // forward through the canopy with the plane's own bank and pitch.
  function updateCockpitCamera(state) {
    tmpEuler.set(
      (state.pitch || 0) + lookPitch * 0.6,
      (state.yaw || 0) + lookYaw * 0.6,
      state.roll || 0
    );
    tmpEye.set(camCfg.cockpitEye.x, camCfg.cockpitEye.y, camCfg.cockpitEye.z);
    tmpEye.applyEuler(tmpEuler);
    cockpitCamera.position.copy(state.position).add(tmpEye);
    cockpitCamera.quaternion.setFromEuler(tmpEuler);
  }

  function triggerShake(amount) {
    shakeAmp = Math.min(1.4, shakeAmp + amount);
  }

  const api = {
    scene,
    camera,
    chaseCamera,
    cockpitCamera,

    setView(name) {
      if (name !== 'cockpit' && name !== 'chase') return;
      if (name !== view) {
        view = name;
        // Fresh look direction on a view change, so the pilot is never
        // left staring sideways after toggling.
        lookYaw = 0;
        lookPitch = 0;
      }
    },

    // Mouse-look drag, in pixels; scaled by the config sensitivity.
    addLook(dx, dy) {
      lookYaw = clamp(
        lookYaw - dx * (camCfg.lookSensitivity || 0.25) * DEG,
        -1.25,
        1.25
      );
      lookPitch = clamp(
        lookPitch - dy * (camCfg.lookSensitivity || 0.25) * DEG,
        -0.55,
        0.55
      );
    },

    shake(amount) {
      triggerShake(amount || 0.5);
    },

    // Jump the render camera straight to the active view on the next
    // frame (used after teleporting the plane: mission start, shots).
    snap() {
      snapNext = true;
    },

    resize,

    update(dt, state) {
      dt = Math.min(dt || 0.016, 0.05);
      const st = state || {};
      const pos = st.position || { x: 0, y: 10, z: 0 };

      // Damage jumps (hard landing, terrain clip) kick the camera.
      const dmg = st.damage || 0;
      if (dmg > prevDamage) {
        triggerShake(0.25 + (dmg - prevDamage) / 55);
      }
      prevDamage = dmg;
      // One big jolt at the moment of the crash, then it decays away —
      // boosting every frame here would shake the camera forever.
      if (st.status === 'crashed') {
        if (!crashShakeDone) {
          shakeAmp = Math.max(shakeAmp, 1.2);
          crashShakeDone = true;
        }
      } else {
        crashShakeDone = false;
      }

      // Clouds drift slowly east and wrap around the play area.
      if (world && world.clouds) {
        for (const cloud of world.clouds) {
          cloud.position.x += (cloud.userData.driftSpeed || 2) * dt;
          if (cloud.position.x > 2000) cloud.position.x = -2000;
        }
      }

      // Landing light: bright low over the runway, a dim glow elsewhere.
      const rdx = pos.x - WORLD.runway.x;
      const rdz = pos.z - WORLD.runway.z;
      const runwayDist = Math.sqrt(rdx * rdx + rdz * rdz);
      const nearRunway = runwayDist < 700 && (st.altitude || 0) < 130;
      const targetIntensity = nearRunway ? 1.7 : 0.22;
      landingLight.intensity += (targetIntensity - landingLight.intensity) * Math.min(1, dt * 3);
      forwardOf(st, tmpForward);
      landingLight.position
        .copy(pos)
        .addScaledVector(tmpForward, 3.5);
      landingLight.position.y -= 0.3;
      landingLight.target.position
        .copy(pos)
        .addScaledVector(tmpForward, 70);
      landingLight.target.position.y = Math.max(0, pos.y - 30);
      landingLight.target.updateMatrixWorld();

      // Sun glow breathes almost imperceptibly with the light.
      const pulse = 1 + Math.sin((st.time || 0) * 0.4) * 0.02;
      sunGlow.scale.set(1100 * pulse, 1100 * pulse, 1);

      // Aim both virtual cameras, then glide the real camera toward the
      // active one: position lerp + quaternion slerp, frame-rate safe.
      // On the first frame (or after snap()) jump straight there.
      updateChaseCamera(st);
      updateCockpitCamera(st);
      const active = view === 'cockpit' ? cockpitCamera : chaseCamera;
      if (snapNext) {
        camera.position.copy(active.position);
        camera.quaternion.copy(active.quaternion);
        snapNext = false;
      } else {
        const k = 1 - Math.exp(-dt * 7);
        camera.position.lerp(active.position, k);
        camera.quaternion.slerp(active.quaternion, k);
      }

      // Shake: a decaying random offset on top of the smoothed camera.
      if (shakeAmp > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shakeAmp * 1.4;
        camera.position.y += (Math.random() - 0.5) * shakeAmp * 1.4;
        camera.position.z += (Math.random() - 0.5) * shakeAmp * 1.4;
        shakeAmp *= Math.exp(-dt * 2.6);
      } else {
        shakeAmp = 0;
      }

      renderer.render(scene, camera);
    },
  };
  return api;
}
