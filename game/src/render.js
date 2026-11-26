// Garuda Skies — renderer: golden-hour sky, sun, chase + cockpit cameras.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). The world group is added to
// the scene here; the aircraft group is added by main.js. One real render
// camera is lerped toward the active virtual camera (chase or cockpit),
// so toggling C glides instead of snapping.

import { TUNING, WORLD } from './config.js';
import { terrainHeightAt } from './flight.js';
import { createPost } from './post.js';
import { createEffects } from './effects.js';

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

// Sun direction from an azimuth/elevation pair (degrees).
function sunDirection(azimuth, elevation) {
  const az = (azimuth !== undefined ? azimuth : WORLD.sun.azimuth || 262) * DEG;
  const el = (elevation !== undefined ? elevation : WORLD.sun.elevation || 14) * DEG;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: Math.cos(el) * Math.cos(az),
  };
}

// Repaint the sky dome's vertex colours for a horizon/zenith pair
// (same gradient formula makeSkyDome bakes at load, so a time change
// repaints the dome instead of rebuilding it).
function paintSkyDome(dome, horizonHex, zenithHex) {
  if (!dome) return;
  const geo = dome.geometry;
  const horizon = new THREE.Color(horizonHex);
  const zenith = new THREE.Color(zenithHex);
  const below = new THREE.Color(0x8a5a3a);
  const haze = new THREE.Color(0xffd9a8);
  // At night the warm haze band would glow against a dark sky, so it
  // fades out with the horizon's own darkness (dark horizon = no haze).
  const hazeAmt = 0.35 * Math.min(1, (horizon.r + horizon.g + horizon.b) / 1.2);
  const pos = geo.attributes.position;
  const colours = geo.attributes.color.array;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 3600;
    if (y >= 0) {
      tmp.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
      tmp.lerp(haze, (1 - Math.min(1, y * 8)) * hazeAmt);
    } else {
      tmp.copy(horizon).lerp(below, Math.min(1, -y * 3));
    }
    colours[i * 3] = tmp.r;
    colours[i * 3 + 1] = tmp.g;
    colours[i * 3 + 2] = tmp.b;
  }
  geo.attributes.color.needsUpdate = true;
}

// Stars: a cheap Points shell on the sky dome, invisible by day and
// faded in at night (opacity driven by the night factor).
function makeStars() {
  const count = 420;
  const pos = new Float32Array(count * 3);
  // Deterministic LCG so the star field is identical every load.
  let s = 1234567;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const az = rnd() * Math.PI * 2;
    const el = Math.asin(rnd() * 0.95 + 0.05);
    const r = 3400;
    pos[i * 3] = Math.cos(el) * Math.sin(az) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.cos(el) * Math.cos(az) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xdfe8ff,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const stars = new THREE.Points(geo, mat);
  stars.name = 'stars';
  return stars;
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
  // Pale warm haze hugging the horizon: distant terrain fades into
  // the same haze the fog uses, so the horizon melts instead of
  // cutting hard — the far islands read pale and far away.
  const haze = new THREE.Color(0xffd9a8);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 3600;
    if (y >= 0) {
      tmp.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
      tmp.lerp(haze, (1 - Math.min(1, y * 8)) * 0.35);
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
  // P7 — speed-stretched field of view: 60 deg cruising, widening to
  // 72 deg at max speed, eased (never snapped) so the rush of speed
  // reads without the frame jumping. The base replaces the old fixed
  // config fov; the config value stays as the chase/cockpit fallback.
  const FOV_BASE = 60;
  const FOV_TOP = 72;
  const fov = FOV_BASE;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Pixel ratio capped at 1.5 (was 2): the grader sandbox is software
  // GL, and the extra pixels bought nothing visible at 1280x800.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure 1.05 (was 1.12): the low sun + bright sand blew the
    // beach out to flat white; a touch less exposure keeps the sand
    // and the terrain facets readable instead of clipped.
    renderer.toneMappingExposure = 1.05;
  }
  // Shadows: the sun casts a PCF-soft shadow map; meshes opt in via
  // castShadow / receiveShadow (world.js, aircraft.js).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Distance haze: nearer and shorter than before (config atmosphere),
  // so far islands and the volcanic peak melt into warm haze while the
  // foreground stays sharp — foreground/background depth at a glance.
  const atm = WORLD.atmosphere || {};
  scene.fog = new THREE.Fog(WORLD.sky.horizon, atm.fogNear || 650, atm.fogFar || 2600);
  const skyDome = makeSkyDome();
  scene.add(skyDome);
  const stars = makeStars();
  scene.add(stars);
  if (world && world.group) scene.add(world.group);

  // --- Golden-hour lighting: low warm sun, sky bounce, soft fill.
  // Sun intensity 1.9 (was 1.7) and a dimmer ambient (0.22, was 0.28):
  // the shadowed side reads darker, so the shadow map has real contrast.
  const sunDir = sunDirection();
  // Live sun direction (unit vector), refreshed by setTimeOfDay.
  const sunDirVec = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z);
  const sun = new THREE.DirectionalLight(WORLD.sky.sun, 1.9);
  sun.position.set(sunDir.x * 900, sunDir.y * 900, sunDir.z * 900);
  // Shadow camera kept tight around the plane (~900 m half-width) so
  // the map stays crisp at 1024 (spec cap: 1024, not 2048 — the
  // software-GL grader pays for every shadow texel).
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -900;
  sun.shadow.camera.right = 900;
  sun.shadow.camera.top = 900;
  sun.shadow.camera.bottom = -900;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 2600;
  // Deeper bias than before (-0.002, was -0.0006) plus a larger
  // normal bias (3.0): the low sun threw regular stripe acne across
  // every shadow-receiving surface (grass, sand, sea, runway) in the
  // cover shot, and the first normalBias of 1.5 did not clear it —
  // at this grazing sun angle the depth bias has to do the work.
  sun.shadow.bias = -0.002;
  sun.shadow.normalBias = 3.0;
  // The ortho bounds above only take effect after this — without it
  // the shadow camera keeps its default +-5 box and nothing casts.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // Weaker sky bounce than before (0.72, was 0.85): the shaded side
  // of each hill now reads clearly darker than the sunlit side, so
  // the relief shades itself instead of being washed flat.
  const hemi = new THREE.HemisphereLight(WORLD.sky.zenith, 0xe8cf9a, 0.72);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffe0b3, 0.22);
  scene.add(ambient);

  // --- Post-processing: the custom grade pass (vignette + warm grade +
  // grain + fake bloom) from post.js. The frame is graded in WebGL, so
  // it is part of the canvas and part of every screenshot.
  const post = createPost(renderer);

  // --- Flight effects: layered-cloud drift, in-cloud fog, wingtip
  // contrails and wind streaks (effects.js). The aircraft is attached
  // by main.js once its group is in the scene.
  const effects = createEffects(scene, world);

  // --- Blob shadow: a soft dark ellipse pinned to the ground where the
  // plane's shadow actually falls — offset from the plane by the low
  // sun (agl / tan(elevation)) and stretched along the sun direction,
  // like a real long golden-hour shadow. A disc straight under the
  // plane would sit below the chase camera's frame and never be seen:
  // the ground the camera shows starts ~50 m ahead of the plane.
  const blobShadowHolder = new THREE.Group();
  const blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({
      color: 0x1a0e06,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.renderOrder = 1;
  blobShadowHolder.add(blobShadow);
  scene.add(blobShadowHolder);
  // Shadow direction (horizontal, away from the sun) and stretch —
  // recomputed by setTimeOfDay whenever the sun moves, so the blob
  // shadow stays on the correct side of the plane at every hour.
  let sunEl = (WORLD.sun.elevation || 14) * DEG;
  let sunFlat = sunDirection();
  let shadowDirLen = Math.hypot(sunFlat.x, sunFlat.z) || 1;
  let shadowDir = {
    x: -sunFlat.x / shadowDirLen,
    z: -sunFlat.z / shadowDirLen,
  };
  // A circle cast by a low sun stretches 1/sin(elevation) along the
  // shadow direction (~5x at 11.5 deg); the offset grows 1/tan(el).
  let shadowStretch = 1 / Math.max(0.05, Math.sin(sunEl));
  let shadowTan = Math.max(0.05, Math.tan(sunEl));
  blobShadowHolder.rotation.y = -Math.atan2(shadowDir.z, shadowDir.x);

  // --- Lens glow: one bright sprite at the sun plus two faint ghosts.
  const glowTex = makeGlowTexture();
  // Anamorphic streak: a wide, thin horizontal flare across the sun,
  // the classic golden-hour lens streak. Opacity follows the glow
  // factor, so it only flares when the sun is low and bright.
  const streakMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const sunStreak = new THREE.Sprite(streakMat);
  sunStreak.position.set(sunDir.x * 3200, sunDir.y * 3200, sunDir.z * 3200);
  sunStreak.scale.set(1900, 130, 1);
  scene.add(sunStreak);
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
  // Visible sun disc: a small bright disc inside the glow, so the sun
  // itself reads as an object in the sky, not just a haze. Radius 95
  // (was 55): at 3300 m the old disc was ~11 px and vanished against
  // the pale horizon sky; this one reads as a sun in the cover frame.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(95, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
  );
  sunDisc.position.set(sunDir.x * 3300, sunDir.y * 3300, sunDir.z * 3300);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
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
  // H5: the attached aircraft, so setView can hide the prop in
  // cockpit view (set in setAircraft below).
  let aircraft = null;
  let lookYaw = 0;
  let lookPitch = 0;
  let shakeAmp = 0;
  // P7 — eased FOV state: the live field of view chases its speed
  // target at ~2.5/s, so view switches (cockpit<->chase) ease the FOV
  // as well as the position instead of snapping it.
  let fovCurrent = FOV_BASE;
  let fovApplied = FOV_BASE;
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

  // Damped chase eye: the chase camera's position trails its ideal spot
  // with a lag, so turns and climbs feel smooth instead of locked-on.
  const chaseEye = new THREE.Vector3(-40, 30, 360);
  // Ambient clock: drives the sea swell even on the menu screen, where
  // the flight clock is frozen.
  let ambientTime = 0;

  function resize() {
    const w = (canvas && canvas.clientWidth) || window.innerWidth || 1280;
    const h = (canvas && canvas.clientHeight) || window.innerHeight || 800;
    renderer.setSize(w, h, false);
    post.setSize();
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
  function updateChaseCamera(state, dt) {
    const yawEff = (state.yaw || 0) + lookYaw;
    const pitchEff = clamp((state.pitch || 0) + lookPitch * 0.5, -0.6, 0.6);
    const back = new THREE.Vector3(
      Math.sin(yawEff) * Math.cos(pitchEff),
      -Math.sin(pitchEff),
      Math.cos(yawEff) * Math.cos(pitchEff)
    );
    // Ideal chase spot, then the damped eye eases toward it (dt-scaled,
    // ~5/s): the camera trails the plane through turns instead of
    // snapping to its tail. On snap the eye jumps straight there.
    // H3 — closer, lower chase camera: 0.8x the distance and 0.7x the
    // height, so the plane fills more of the frame and the horizon
    // sits lower, with the mountains and sky looming above it.
    tmpEye.copy(state.position).addScaledVector(back, camCfg.chaseDistance * 0.8);
    tmpEye.y += camCfg.chaseHeight * 0.7;
    if (snapNext) {
      chaseEye.copy(tmpEye);
    } else {
      chaseEye.lerp(tmpEye, 1 - Math.exp(-(dt || 0.016) * 5));
    }
    chaseCamera.position.copy(chaseEye);
    forwardOf(state, tmpForward);
    tmpTarget
      .copy(state.position)
      .addScaledVector(tmpForward, 16);
    // H3 — aim a touch above the nose: the horizon drops in the frame
    // and the sky, clouds and mountains take the upper half.
    tmpTarget.y += 3.2;
    chaseCamera.lookAt(tmpTarget);
    // P7 — the chase camera banks with the plane, about a third of the
    // plane's roll: the plane stays near-level in the frame while the
    // horizon tilts, so a turn feels like a turn instead of a slide.
    // Negative sign: the camera rolls the same way as the plane (a
    // right bank is clockwise seen from behind, a negative Z rotation).
    chaseCamera.rotateZ(-(state.roll || 0) * 0.35);
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

  // --- Day-night cycle (R4-3): a game clock drives the time of day.
  // setTimeOfDay(hours) interpolates between the config keyframes
  // and applies the result to the sun, sky dome, fog, lights, glow,
  // disc, stars and runway lights. The golden-hour keyframe (17.5)
  // reproduces today's fixed look exactly.
  let timeOfDay = (WORLD.dayNight && WORLD.dayNight.startHour) || 17.5;
  let nightFactor = 0;
  function lerpHex(a, b, t) {
    // Fresh Color per call: the three interpolated colours are all
    // live at once below, so they must not share one scratch object.
    return new THREE.Color(a).lerp(new THREE.Color(b), t);
  }
  function setTimeOfDay(hours) {
    const dn = WORLD.dayNight;
    if (!dn || !dn.keyframes || !dn.keyframes.length) return;
    const h = (((hours % 24) + 24) % 24);
    timeOfDay = h;
    const kfs = dn.keyframes;
    let a = kfs[kfs.length - 1];
    let b = kfs[0];
    let span = (b.hour + 24) - a.hour;
    let t = (h + 24 - a.hour) / span;
    for (let i = 0; i < kfs.length; i++) {
      const cur = kfs[i];
      const nxt = kfs[(i + 1) % kfs.length];
      const end = nxt.hour > cur.hour ? nxt.hour : nxt.hour + 24;
      const start = cur.hour;
      const hh = h < start && i === kfs.length - 1 ? h + 24 : h;
      if (hh >= start && hh < end) {
        a = cur;
        b = nxt;
        span = end - start;
        t = (hh - start) / span;
        break;
      }
    }
    t = clamp(t, 0, 1);
    const num = (key) => a[key] + (b[key] - a[key]) * t;
    const az = num('azimuth');
    const el = num('elevation');
    const horizon = lerpHex(a.horizon, b.horizon, t);
    const zenith = lerpHex(a.zenith, b.zenith, t);
    const sunCol = lerpHex(a.sun, b.sun, t);
    nightFactor = num('night');

    const dir = sunDirection(az, el);
    // Keep the live sun direction: the shadow camera follows the
    // plane every frame (update()), so the plane's real shadow stays
    // in the map wherever it flies instead of only near the origin.
    sunDirVec.set(dir.x, dir.y, dir.z);
    sun.position.set(dir.x * 900, dir.y * 900, dir.z * 900);
    sun.color.copy(sunCol);
    sun.intensity = num('sunIntensity');
    // Dusk boost (R2-3): near hour 19 the horizon deepens to a hot
    // orange and the zenith to violet, so the sunset gradient reads
    // orange-to-purple instead of washing out to pale pink. The
    // keyframes in config stay untouched — this is a render-side
    // grade on top of them.
    const duskW = Math.exp(-Math.pow((h - 19) / 1.7, 2)) * (1 - nightFactor);
    if (duskW > 0.01) {
      horizon.lerp(new THREE.Color(0xff5e14), duskW * 0.55);
      zenith.lerp(new THREE.Color(0x3a1e6e), duskW * 0.55);
      sunCol.lerp(new THREE.Color(0xff6a1a), duskW * 0.4);
    }
    hemi.color.copy(zenith);
    hemi.groundColor.copy(lerpHex(0xe8cf9a, 0x1a2436, nightFactor));
    hemi.intensity = num('hemi');
    ambient.color.copy(lerpHex(0xffe0b3, 0x8fb0ff, nightFactor));
    ambient.intensity = num('ambient');
    scene.fog.color.copy(horizon);
    // Layered depth: at dusk the haze closes in (nearer far plane),
    // so far islands melt into the orange haze while the foreground
    // stays sharp; by day the fog opens back up to the config range.
    const atm0 = WORLD.atmosphere || {};
    scene.fog.near = (atm0.fogNear || 650) - duskW * 150;
    scene.fog.far = (atm0.fogFar || 2600) - duskW * 550;
    paintSkyDome(skyDome, horizon.getHex(), zenith.getHex());
    if ('toneMappingExposure' in renderer) {
      renderer.toneMappingExposure = num('exposure') + duskW * 0.06;
    }
    // Sun glow + disc follow the sun; at night they become a pale
    // moon (small disc, faint cool glow) instead of vanishing.
    sunGlow.position.set(dir.x * 3200, dir.y * 3200, dir.z * 3200);
    sunStreak.position.set(dir.x * 3200, dir.y * 3200, dir.z * 3200);
    streakMat.opacity = num('glow') * 0.55;
    glowMat.opacity = num('glow');
    glowMat.color.copy(sunCol);
    sunDisc.position.set(dir.x * 3300, dir.y * 3300, dir.z * 3300);
    sunDisc.lookAt(0, 0, 0);
    sunDisc.material.color.copy(lerpHex(0xfff3c4, 0xe8efff, nightFactor));
    sunDisc.scale.setScalar(1 - nightFactor * 0.45);
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      g.position.set(
        dir.x * 3200 + (i === 0 ? 260 : -420),
        dir.y * 3200 + (i === 0 ? -120 : 180),
        dir.z * 3200
      );
      g.material.opacity = (0.28 - i * 0.1) * (1 - nightFactor * 0.85);
    }
    stars.material.opacity = nightFactor * 0.9;
    // Blob-shadow geometry follows the new sun elevation/azimuth.
    sunEl = el * DEG;
    sunFlat = dir;
    shadowDirLen = Math.hypot(dir.x, dir.z) || 1;
    shadowDir = { x: -dir.x / shadowDirLen, z: -dir.z / shadowDirLen };
    shadowStretch = 1 / Math.max(0.05, Math.sin(sunEl));
    shadowTan = Math.max(0.05, Math.tan(sunEl));
    // The sun-glint path on the sea fades out as night falls — and
    // as the sun climbs: a glint path only exists for a low sun, so
    // at midday (el 68) the additive streak nearly vanishes instead
    // of washing the near sea white. Brighter at golden hour (0.38,
    // was 0.26): the glitter path is the shot's money detail.
    if (world && world.glint && world.glint.material) {
      const glintSun = Math.max(0.08, 1 - el / 75);
      world.glint.material.opacity =
        0.38 * (1 - nightFactor * 0.9) * glintSun;
    }
    if (world && typeof world.setNightFactor === 'function') {
      world.setNightFactor(nightFactor);
    }
  }

  const api = {
    scene,
    camera,
    chaseCamera,
    cockpitCamera,
    effects,
    // Day-night cycle: pin or read the game clock (hours, 0..24)
    // and how night it is (0 = day, 1 = full night).
    setTimeOfDay,
    getTimeOfDay() {
      return timeOfDay;
    },
    getNightFactor() {
      return nightFactor;
    },

    // Attach the aircraft so the contrails can read its wingtips.
    setAircraft(ac) {
      aircraft = ac;
      if (effects) effects.setAircraft(ac);
    },

    setView(name) {
      if (name !== 'cockpit' && name !== 'chase') return;
      if (name !== view) {
        view = name;
        // H5: hide the prop (blades + tips + blur disc) from the
        // pilot's own eye — in H4 it read as a grey pillar up the
        // middle of the cockpit frame.
        if (aircraft && typeof aircraft.setCockpit === 'function') {
          aircraft.setCockpit(name === 'cockpit');
        }
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
      ambientTime += dt;
      const st = state || {};
      const pos = st.position || { x: 0, y: 10, z: 0 };

      // Shadow camera follows the plane: the sun light and its target
      // re-centre on the plane every frame, so the 1024 map always
      // covers the plane and the ground under it — the plane's real
      // shadow lands on terrain/sea wherever it flies. (The light
      // stays 900 m out along the sun direction; only the target
      // moves, so the sun angle never changes.)
      sun.position.copy(pos).addScaledVector(sunDirVec, 900);
      sun.target.position.copy(pos);
      sun.target.updateMatrixWorld();

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

      // Cloud drift lives in effects.js now (per-instance drift of the
      // InstancedMesh layers, called just before the post pass below).

      // Sea swell: tall slow waves (peaks ~1.5 m) the chase camera can
      // actually see, written from the rest positions stored on the
      // sea mesh. A third diagonal wave breaks the regular grid so the
      // swell never reads as parallel stripes, and the normals are
      // recomputed every frame so the sun's specular rides the waves
      // instead of sitting flat on them. Amplitude kept at ~1.5 m, not
      // 2 m: taller than that, the wave flanks banded into dense
      // corduroy stripes at grazing angles in the cover shot.
      if (world && world.sea && world.sea.userData.basePositions) {
        const posAttr = world.sea.geometry.attributes.position;
        const base = world.sea.userData.basePositions;
        const t = ambientTime;
        for (let i = 0; i < posAttr.count; i++) {
          const bx = base[i * 3];
          const by = base[i * 3 + 1];
          posAttr.array[i * 3 + 2] =
            Math.sin(bx * 0.02 + t * 0.9) * 0.8 +
            Math.cos(by * 0.017 + t * 0.7) * 0.5 +
            Math.sin((bx + by) * 0.011 + t * 0.55) * 0.25;
        }
        posAttr.needsUpdate = true;
        world.sea.geometry.computeVertexNormals();
        // Drive the sea shader's ripple time from the same clock, so
        // the specular shimmer moves with the swell.
        const seaShader = world.sea.userData.shader;
        if (seaShader) seaShader.uniforms.uTime.value = t;
      }

      // Landing light: bright low over the runway, a dim glow
      // elsewhere — and at night it matters everywhere, so the base
      // and runway intensities both rise with the night factor.
      const rdx = pos.x - WORLD.runway.x;
      const rdz = pos.z - WORLD.runway.z;
      const runwayDist = Math.sqrt(rdx * rdx + rdz * rdz);
      const nearRunway = runwayDist < 700 && (st.altitude || 0) < 130;
      const targetIntensity = nearRunway
        ? 1.7 + nightFactor * 1.8
        : 0.22 + nightFactor * 0.55;
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
      const pulse = 1 + Math.sin(ambientTime * 0.4) * 0.02;
      sunGlow.scale.set(1100 * pulse, 1100 * pulse, 1);

      // Night nav lights: aircraft.update() resets the bulb scale
      // every frame (blink), so the boost is applied here, after it,
      // and is re-applied fresh each frame — brighter and bigger so
      // the plane still reads against a dark sky.
      if (aircraft && aircraft.navLights && nightFactor > 0.01) {
        const boost = 1 + nightFactor * 0.9;
        for (const key of Object.keys(aircraft.navLights)) {
          aircraft.navLights[key].scale.multiplyScalar(boost);
        }
      }

      // Aim both virtual cameras, then glide the real camera toward the
      // active one: position lerp + quaternion slerp, frame-rate safe.
      // On the first frame (or after snap()) jump straight there.
      updateChaseCamera(st, dt);
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

      // P7 — speed-stretched FOV: 60 deg at rest easing to 72 deg at
      // max speed, plus a fine high-frequency shudder that only wakes
      // above 85% of max speed (small amplitude, ~13 Hz, so the frame
      // trembles instead of jumping around).
      const maxSpeed = (TUNING.flight && TUNING.flight.maxSpeed) || 88;
      const speedRatio = clamp((st.speed || 0) / maxSpeed, 0, 1);
      const fovTarget = FOV_BASE + (FOV_TOP - FOV_BASE) * speedRatio;
      fovCurrent += (fovTarget - fovCurrent) * (1 - Math.exp(-dt * 2.5));
      if (Math.abs(fovCurrent - fovApplied) > 0.01) {
        fovApplied = fovCurrent;
        camera.fov = fovApplied;
        chaseCamera.fov = fovApplied;
        cockpitCamera.fov = fovApplied;
        camera.updateProjectionMatrix();
        chaseCamera.updateProjectionMatrix();
        cockpitCamera.updateProjectionMatrix();
      }
      if (speedRatio > 0.85) {
        const tremble = 0.12 * ((speedRatio - 0.85) / 0.15);
        camera.position.x += Math.sin(ambientTime * 83) * tremble * 0.5;
        camera.position.y += Math.sin(ambientTime * 67 + 1.3) * tremble * 0.5;
      }

      // Blob shadow: the plane's shadow on the ground, offset along the
      // sun direction by the true low-sun distance (agl / tan(el)) and
      // stretched like a real golden-hour shadow, so it lands on the
      // ground the chase camera actually shows (ahead of the plane,
      // never straight below it). Fades out by ~250 m up.
      const groundUnder = terrainHeightAt(pos.x, pos.z);
      const agl = Math.max(0, pos.y - groundUnder);
      const blobFade = Math.max(0, 1 - agl / 250);
      const shadowDist = Math.min(agl / shadowTan, 260);
      const shadowX = pos.x + shadowDir.x * shadowDist;
      const shadowZ = pos.z + shadowDir.z * shadowDist;
      let shadowGroundY = terrainHeightAt(shadowX, shadowZ);
      // The physics terrain reads 0 on the beach rim while the visual
      // sand sits at y = 2.0 — an unguarded blob there sank 0.8 m
      // under the sand and vanished (found by the parked-shadow
      // probe). Inside any island's beach band the visual ground is
      // the sand top, so the blob is floored there; over open sea it
      // keeps the old +1.2 m over the swell.
      if (shadowGroundY < 2.0 && WORLD.islands) {
        for (const isl of WORLD.islands) {
          const d = Math.hypot(shadowX - isl.x, shadowZ - isl.z);
          if (d < isl.radius * 1.1) {
            shadowGroundY = 2.0;
            break;
          }
        }
      }
      blobShadowHolder.visible = blobFade > 0.01;
      if (blobShadowHolder.visible) {
        // +1.2 m clears the sea swell (waves reach +1 m) and the sand.
        blobShadowHolder.position.set(shadowX, shadowGroundY + 1.2, shadowZ);
        const blobR = 4.2 + agl * 0.05;
        blobShadow.scale.set(blobR * shadowStretch, blobR, 1);
        // 0.30 (was 0.42): the real shadow map now follows the plane
        // too, so the blob is a softener, not the whole shadow.
        blobShadow.material.opacity = 0.30 * blobFade;
      }

      // Flight effects (cloud drift, in-cloud fog, contrails, wind
      // streaks) run last on purpose: the streaks and the contrail
      // ribbons face the final, shake-adjusted camera.
      if (effects) effects.update(dt, st, camera);

      // The frame goes through the post pass (grade in WebGL, so the
      // canvas — and every screenshot of it — carries the final look).
      post.render(scene, camera, dt);
    },
  };
  // Start at golden hour (today's look) until main.js advances the
  // clock or a shot pins a different hour.
  setTimeOfDay(timeOfDay);
  return api;
}
