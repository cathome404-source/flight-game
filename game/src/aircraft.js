// Garuda Skies — three flyable aircraft, one builder, visibly different
// models, liveries and shapes. Written fresh for R2-2 from the prose spec.
// The plane flies nose-first along -Z in its local space; the propeller
// spins around the Z axis. THREE arrives as a global from index.html.

import { AIRCRAFT, AIRCRAFT_IDS } from './config.js';

// Livery + shape per aircraft. The differences are structural, not just
// paint: the interceptor has a slim body, swept wings and a tall fin;
// the heavy has a fat body, a high wing on struts and big wheels; the
// trainer sits in the middle with a straight low wing.
const LIVERY = {
  cendrawasih: {
    skin: 0xf3e2c0, accent: 0x2e8b8b, accentDark: 0x1f5f5f,
    band: 0xe8702a, tip: 0x2e8b8b, flash: 0xf5f2e8,
  },
  rajawali: {
    skin: 0xf2ede4, accent: 0xc23b2e, accentDark: 0x7e2318,
    band: 0xc23b2e, tip: 0xc23b2e, flash: 0xc23b2e,
  },
  komodo: {
    skin: 0xd8c49a, accent: 0x6b7a3a, accentDark: 0x46511f,
    band: 0x8a7a4a, tip: 0x6b7a3a, flash: 0xd8c49a,
  },
};

const SHAPE = {
  cendrawasih: {
    fusR: 0.85, fusLen: 4.6, noseLen: 1.4, wingSpan: 9.2, wingChord: 1.7,
    wingY: -0.25, wingSweep: 0, tailSpan: 3.2, finH: 1.7,
    wheelR: 0.42, blades: 2, canopy: 1.0, struts: false,
  },
  rajawali: {
    fusR: 0.7, fusLen: 4.9, noseLen: 1.8, wingSpan: 8.0, wingChord: 1.5,
    wingY: -0.2, wingSweep: 22, tailSpan: 2.8, finH: 2.1,
    wheelR: 0.36, blades: 3, canopy: 0.9, struts: false,
  },
  komodo: {
    fusR: 1.02, fusLen: 4.4, noseLen: 1.1, wingSpan: 10.8, wingChord: 2.0,
    wingY: 0.55, wingSweep: 0, tailSpan: 3.8, finH: 1.9,
    wheelR: 0.55, blades: 2, canopy: 1.1, struts: true,
  },
};

// R2-3: all aircraft materials are MeshStandardMaterial now — real
// roughness/metalness under the low sun, so the skin glints, the
// metal spinner shines and the canopy glass reads as glass, instead
// of the flat Lambert/Phong look. Same livery colours, PBR response.
function standard(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color }, extra || {}));
}

function lambert(color, extra) {
  return standard(color, extra);
}

function phong(color, extra) {
  return standard(color, extra);
}

function slab(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

// Soft radial glow texture (canvas, no image file) for the
// afterburner halo.
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 210, 120, 1)');
  grad.addColorStop(0.35, 'rgba(255, 150, 50, 0.55)');
  grad.addColorStop(1, 'rgba(255, 120, 30, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// Build one aircraft by id ('cendrawasih' | 'rajawali' | 'komodo').
// Returns the group plus the moving parts the game animates every frame.
export function makeAircraft(id) {
  const key = AIRCRAFT_IDS.includes(id) ? id : 'cendrawasih';
  const stats = AIRCRAFT[key];
  const liv = LIVERY[key];
  const sh = SHAPE[key];

  const group = new THREE.Group();
  group.name = 'aircraft-' + key;

  // Low metalness on the painted skin (0.15): at dusk the first
  // 0.35 value washed the livery out to grey-purple under the violet
  // sky light — paint is dielectric, the shine comes from the metal
  // parts (spinner, struts) and the glass, not the fuselage.
  const skin = standard(liv.skin, { roughness: 0.45, metalness: 0.15 });
  const accent = standard(liv.accent, { roughness: 0.5, metalness: 0.15 });
  const accentDark = standard(liv.accentDark, { roughness: 0.6, metalness: 0.1 });
  const band = standard(liv.band, { roughness: 0.5, metalness: 0.15 });
  const metal = standard(0x8f969e, { roughness: 0.32, metalness: 0.85 });
  const dark = standard(0x2b2f36, { roughness: 0.75, metalness: 0.2 });
  const bladeMat = standard(0x23272e, { roughness: 0.6, metalness: 0.4, transparent: true });
  const glass = standard(0x1c2f42, {
    roughness: 0.12, metalness: 0.15, flatShading: true,
    transparent: true, opacity: 0.88,
  });
  // R2-11a — cockpit glass state: false = dark faceted bubble (chase
  // view), true = near-invisible glass (cockpit view). Toggled in
  // update() when plane.cockpit changes; the material swap needs one
  // recompile (needsUpdate) per switch, never per frame.
  const panelDark = standard(0x3a2e22, { roughness: 0.85, metalness: 0.1 });
  let glassCockpit = false;

  const fusFront = -sh.fusLen / 2;
  const fusBack = sh.fusLen / 2;

  // --- Fuselage: tapered body, nose cone up front, tail cone at back.
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(sh.fusR, sh.fusR * 0.74, sh.fusLen, 10), skin);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.3;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(sh.fusR, sh.noseLen, 10), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = fusFront + 0.3 - sh.noseLen / 2;
  group.add(nose);

  const tailCone = new THREE.Mesh(
    new THREE.ConeGeometry(sh.fusR * 0.74, 1.6, 10), accentDark);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = fusBack + 0.3 + 0.8;
  group.add(tailCone);

  // Accent cheatline along each side of the fuselage.
  for (const side of [-1, 1]) {
    const stripe = slab(0.06, 0.35, sh.fusLen - 0.4, accent);
    stripe.position.set(side * (sh.fusR - 0.03), -0.05, 0.3);
    group.add(stripe);
  }

  // Painted band around the rear fuselage, the livery's second accent.
  const tailBand = new THREE.Mesh(
    new THREE.CylinderGeometry(sh.fusR + 0.01, sh.fusR + 0.01, 0.35, 10), band);
  tailBand.rotation.x = Math.PI / 2;
  tailBand.position.z = 2.2;
  group.add(tailBand);

  // Panel lines: top centreline, two side seams, two skin-join rings.
  const topSeam = slab(0.05, 0.04, sh.fusLen - 0.2, panelDark);
  topSeam.position.set(0, sh.fusR - 0.13, 0.3);
  group.add(topSeam);
  for (const side of [-1, 1]) {
    const sideSeam = slab(0.04, 0.05, sh.fusLen - 0.2, panelDark);
    sideSeam.position.set(side * (sh.fusR - 0.25), sh.fusR * 0.5, 0.3);
    group.add(sideSeam);
  }
  for (const ringDef of [{ z: -1.2, r: sh.fusR * 0.8 }, { z: 1.2, r: sh.fusR * 0.95 }]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringDef.r, 0.025, 4, 18), panelDark);
    ring.position.z = ringDef.z;
    group.add(ring);
  }

  // --- Canopy: dark faceted bubble over the front seats.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 8, 6), glass);
  canopy.scale.set(0.95 * sh.canopy, 0.75 * sh.canopy, 1.7 * sh.canopy);
  canopy.position.set(0, 0.62, -0.7);
  group.add(canopy);

  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.07, 6, 12), accent);
  frame.rotation.x = Math.PI / 2;
  frame.scale.set(1, 1.7, 1);
  frame.position.set(0, 0.45, -0.7);
  group.add(frame);

  for (const zoff of [-1.15, -0.25]) {
    const bar = slab(1.28 * sh.canopy, 0.05, 0.08, dark);
    bar.position.set(0, 0.95, zoff);
    bar.rotation.x = 0.35;
    group.add(bar);
  }

  // --- Main wing: two half-slabs so a swept wing is a real sweep, not a
  // texture. Tips and leading edge carry the accent colour.
  const halfSpan = sh.wingSpan / 2;
  const sweepRad = (sh.wingSweep * Math.PI) / 180;
  for (const side of [-1, 1]) {
    const half = slab(halfSpan, 0.18, sh.wingChord, skin);
    half.position.set(side * halfSpan / 2, sh.wingY, -0.2 + Math.tan(sweepRad) * halfSpan / 2);
    half.rotation.y = -side * sweepRad;
    group.add(half);
    const tip = slab(0.5, 0.2, sh.wingChord, accent);
    tip.position.set(
      side * (halfSpan - 0.25),
      sh.wingY,
      -0.2 + Math.tan(sweepRad) * (halfSpan - 0.25));
    tip.rotation.y = -side * sweepRad;
    group.add(tip);
  }
  // Leading edge: two angled strips following the wing halves, so a
  // swept wing's red edge sweeps with it instead of floating ahead
  // of the tips as a straight bar.
  for (const side of [-1, 1]) {
    const edge = slab(halfSpan, 0.2, 0.12, band);
    edge.position.set(
      side * halfSpan / 2,
      sh.wingY,
      -0.2 - sh.wingChord / 2 - 0.02 + Math.tan(sweepRad) * halfSpan / 2);
    edge.rotation.y = -side * sweepRad;
    group.add(edge);
  }

  // High-wing struts on the heavy: one diagonal brace per side.
  if (sh.struts) {
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6), metal);
      strut.position.set(side * 1.6, 0.1, -0.2);
      strut.rotation.z = side * 0.7;
      group.add(strut);
    }
  }

  // Wing panel seams on the upper skin.
  for (const x of [-3.0, -1.5, 1.5, 3.0]) {
    if (Math.abs(x) > halfSpan - 0.6) continue;
    const seam = slab(0.04, 0.02, sh.wingChord - 0.1, panelDark);
    seam.position.set(x, sh.wingY + 0.1, -0.2);
    group.add(seam);
  }

  // Flaps (inboard) and ailerons (outboard), driven by the flight model.
  const flaps = {};
  for (const side of [-1, 1]) {
    const flap = slab(1.6, 0.12, 0.6, accentDark);
    flap.position.set(side * 1.35, sh.wingY, 0.85);
    group.add(flap);
    flaps[side < 0 ? 'left' : 'right'] = flap;
  }
  const ailerons = {};
  for (const side of [-1, 1]) {
    const aileron = slab(1.9, 0.12, 0.55, accentDark);
    aileron.position.set(side * 3.3, sh.wingY, 0.85);
    group.add(aileron);
    ailerons[side < 0 ? 'left' : 'right'] = aileron;
  }

  // --- Tail: stabiliser, elevator, tall fin with a flash, hinged rudder.
  const stabiliser = slab(sh.tailSpan, 0.14, 1.1, skin);
  stabiliser.position.set(0, 0.15, 3.6);
  group.add(stabiliser);

  const elevator = slab(sh.tailSpan - 0.2, 0.1, 0.5, accentDark);
  elevator.position.set(0, 0.15, 4.35);
  group.add(elevator);

  const fin = slab(0.16, sh.finH, 1.4, accent);
  fin.position.set(0, sh.finH / 2, 3.7);
  fin.rotation.x = -0.18;
  group.add(fin);

  const flash = slab(0.18, 0.5, 0.9, lambert(liv.flash));
  flash.position.set(0, sh.finH / 2, 3.72);
  flash.rotation.x = -0.18;
  group.add(flash);

  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, sh.finH / 2, 4.15);
  const rudder = slab(0.14, sh.finH - 0.15, 0.6, accentDark);
  rudder.position.set(0, 0, 0.32);
  rudder.rotation.x = -0.18;
  rudderPivot.add(rudder);
  group.add(rudderPivot);

  // --- Propeller: spinner hub plus blades (2, or 3 on the interceptor),
  // spinning around the Z axis at the nose.
  const propZ = fusFront + 0.3 - sh.noseLen - 0.15;
  const propeller = new THREE.Group();
  propeller.position.set(0, 0, propZ);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 8), metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.3;
  propeller.add(spinner);
  const blades = [];
  const tips = [];
  for (let i = 0; i < sh.blades; i++) {
    const angle = (i / sh.blades) * Math.PI * 2;
    const blade = slab(0.22, 2.9, 0.07, bladeMat);
    blade.position.set(Math.sin(angle) * 1.45, Math.cos(angle) * 1.45, 0);
    blade.rotation.z = -angle + 0.12;
    propeller.add(blade);
    blades.push(blade);
    const tip = slab(0.24, 0.5, 0.09, lambert(0xffc93c));
    tip.position.set(Math.sin(angle) * 2.7, Math.cos(angle) * 2.7, 0);
    tip.rotation.z = -angle;
    propeller.add(tip);
    tips.push(tip);
  }
  group.add(propeller);

  // Propeller blur disc: fades in with RPM so a fast spin reads as
  // smooth motion instead of flickering blades.
  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.95, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6b7178, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  blurDisc.position.set(0, 0, propZ - 0.17);
  group.add(blurDisc);

  // --- Landing gear: retractable mains folding inward, tail wheel
  // sliding up-forward. gear 1 = fully down, 0 = fully up.
  const gearPivots = {};
  const GEAR_FOLD = (100 * Math.PI) / 180;
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.9, -0.25, -0.4);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), metal);
    strut.position.set(0, -0.65, 0);
    strut.rotation.z = side * 0.25;
    pivot.add(strut);
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(sh.wheelR, sh.wheelR, 0.28, 10), lambert(0x1e1e1e));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.15, -1.1, 0);
    pivot.add(wheel);
    const hubcap = new THREE.Mesh(
      new THREE.CylinderGeometry(sh.wheelR * 0.45, sh.wheelR * 0.45, 0.3, 8), accent);
    hubcap.rotation.z = Math.PI / 2;
    hubcap.position.set(side * 0.15, -1.1, 0);
    pivot.add(hubcap);
    group.add(pivot);
    gearPivots[side < 0 ? 'left' : 'right'] = pivot;
  }
  const tailWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), lambert(0x1e1e1e));
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 3.9);
  group.add(tailWheel);

  // --- Weathering: exhaust soot behind the engine, worn wingtips.
  const soot = new THREE.MeshBasicMaterial({
    color: 0x2a2018, transparent: true, opacity: 0.38, depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const stain = slab(0.05, 0.5, 1.3, soot);
    stain.position.set(side * (sh.fusR - 0.2), -0.1, -1.5);
    group.add(stain);
    const tipWear = slab(0.52, 0.03, 0.3, soot);
    tipWear.position.set(side * (halfSpan - 0.25), sh.wingY + 0.11, 0.55);
    group.add(tipWear);
  }

  // --- Navigation lights: red port, green starboard, white tail.
  const navLights = {};
  const lightDefs = [
    { key: 'left', color: 0xff2a1a, pos: [-halfSpan, sh.wingY, -0.2] },
    { key: 'right', color: 0x2aff5a, pos: [halfSpan, sh.wingY, -0.2] },
    { key: 'tail', color: 0xfff6d8, pos: [0, 0.35, 4.25] },
  ];
  for (const def of lightDefs) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: def.color })
    );
    bulb.position.set(def.pos[0], def.pos[1], def.pos[2]);
    group.add(bulb);
    navLights[def.key] = bulb;
  }

  // --- Afterburner (Rajawali only): a flickering flame tongue + hot
  // core + glow halo + point light at the tail, driven by throttle
  // in update(). Fully off below 80% throttle, full blast at 100%.
  let afterburner = null;
  if (key === 'rajawali') {
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff8a2a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 10), flameMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(0, 0.1, 5.3);
    flame.visible = false;
    group.add(flame);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffd76a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.8, 8), coreMat);
    core.rotation.x = Math.PI / 2;
    core.position.set(0, 0.1, 4.9);
    core.visible = false;
    group.add(core);
    const glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xffa63c, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(0, 0.1, 5.0);
    glow.scale.set(4, 4, 1);
    glow.visible = false;
    group.add(glow);
    const light = new THREE.PointLight(0xff8a2a, 0, 45, 2);
    light.position.set(0, 0.1, 5.5);
    group.add(light);
    afterburner = { flame, flameMat, core, coreMat, glow, glowMat, light };
  }

  // Shadows on, except the translucent blur disc and the glass canopy
  // — and except any transparent part (afterburner flame/core, soot):
  // a transparent additive cone must never cast a solid shadow.
  group.traverse((obj) => {
    if (obj.isMesh && obj !== blurDisc && obj !== canopy
      && !(obj.material && obj.material.transparent)) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const plane = {
    id: key,
    stats,
    group,
    propeller,
    blades,
    tips,
    blurDisc,
    ailerons,
    flaps,
    elevator,
    rudder: rudderPivot,
    navLights,
    gearPivots,
    tailWheel,
    afterburner,
    gear: 1,
    throttle: 0,
    propAngle: 0,
    navTime: 0,
    cockpit: false,

    setCockpit(v) {
      plane.cockpit = !!v;
    },

    setGear(v) {
      plane.gear = Math.max(0, Math.min(1, v));
    },

    setThrottle(v) {
      plane.throttle = Math.max(0, Math.min(1, v));
    },

    // Per-frame update. state may carry { roll, pitch, yaw } in -1..1
    // for the control surfaces and { gear } 0..1 for the landing gear.
    update(dt, state) {
      const input = state || {};
      const speed = 6 + plane.throttle * 55;
      plane.propAngle = (plane.propAngle + speed * dt) % (Math.PI * 2);
      propeller.rotation.z = plane.propAngle;

      const targetBlur = 0.02 + plane.throttle * 0.10;
      blurDisc.material.opacity +=
        (targetBlur - blurDisc.material.opacity) * Math.min(1, dt * 4);

      // The prop never shows in the cockpit view; in chase view the
      // blades fade out fast with RPM so only the soft disc remains.
      const showProp = !plane.cockpit;
      blurDisc.visible = showProp;
      for (const b of blades) b.visible = showProp;
      for (const t of tips) t.visible = showProp;
      bladeMat.opacity = Math.max(0.12, 1.15 - plane.throttle * 2.2);

      // R2-11a — cockpit glass: from the pilot's eye the canopy bubble
      // sits right ahead, and the dark faceted glass (opacity 0.88)
      // reads as a grey slab dominating the centre of the frame. In
      // cockpit view the same bubble becomes near-invisible glass —
      // faint sky tint, smooth shading, no facets — so the ring and
      // the terrain ahead stay clear; the frame torus and the two
      // crossbars still outline the canopy. Chase view restores the
      // dark faceted bubble untouched.
      if (plane.cockpit !== glassCockpit) {
        glassCockpit = plane.cockpit;
        if (glassCockpit) {
          glass.color.setHex(0x9fc8e8);
          glass.opacity = 0.10;
          glass.roughness = 0.06;
          glass.metalness = 0;
          glass.flatShading = false;
        } else {
          glass.color.setHex(0x1c2f42);
          glass.opacity = 0.88;
          glass.roughness = 0.12;
          glass.metalness = 0.15;
          glass.flatShading = true;
        }
        glass.needsUpdate = true;
      }

      const roll = input.roll || 0;
      const pitch = input.pitch || 0;
      ailerons.left.rotation.x = roll * 0.45;
      ailerons.right.rotation.x = -roll * 0.45;
      elevator.rotation.x = pitch * 0.4;
      rudderPivot.rotation.y = (input.yaw || 0) * 0.5;
      const flapDeflect = input.flaps || 0;
      flaps.left.rotation.x = flapDeflect * 0.55;
      flaps.right.rotation.x = flapDeflect * 0.55;

      if (typeof input.gear === 'number') {
        plane.gear = Math.max(0, Math.min(1, input.gear));
      }
      const gearUp = 1 - plane.gear;
      gearPivots.left.rotation.z = gearUp * GEAR_FOLD;
      gearPivots.right.rotation.z = -gearUp * GEAR_FOLD;
      tailWheel.position.set(0, -0.25 - 0.5 * plane.gear, 3.0 + 0.9 * plane.gear);

      // Navigation lights: wingtips flash once a second, tail double-strobes.
      plane.navTime += dt;
      const t = plane.navTime;
      const wingOn = (t % 1.0) < 0.35;
      const tailPhase = t % 1.2;
      const tailOn = tailPhase < 0.07 || (tailPhase > 0.18 && tailPhase < 0.25);
      const lit = { left: wingOn, right: wingOn, tail: tailOn };
      for (const k of Object.keys(navLights)) {
        const on = lit[k];
        const base = k === 'left' ? 0xff2a1a : k === 'right' ? 0x2aff5a : 0xfff6d8;
        const dim = k === 'left' ? 0x4a0d06 : k === 'right' ? 0x0a3d18 : 0x6b6250;
        navLights[k].material.color.setHex(on ? base : dim);
        navLights[k].scale.setScalar(on ? 1 : 0.7);
      }

      // Afterburner (Rajawali only): wakes past 80% throttle and
      // flickers like a real flame tongue — the cone's length axis is
      // local Y (rotated to point backwards), so scale.y stretches
      // the flame while the glow sprite and point light pulse with it.
      if (afterburner) {
        const ab = Math.max(0, Math.min(1, (plane.throttle - 0.8) / 0.2));
        const flick = 0.85 + 0.22 * Math.sin(t * 47) + 0.12 * Math.sin(t * 31 + 1.7);
        const on = ab > 0.02;
        afterburner.flame.visible = on;
        afterburner.core.visible = on;
        afterburner.glow.visible = on;
        if (on) {
          afterburner.flame.scale.set(1, ab * flick, 1);
          afterburner.flameMat.opacity = ab * 0.85;
          afterburner.core.scale.set(1, ab * flick * 0.9, 1);
          afterburner.coreMat.opacity = ab * 0.95;
          afterburner.glowMat.opacity = ab * 0.7;
          afterburner.glow.scale.set(4 * flick, 4 * flick, 1);
          afterburner.light.intensity = ab * 7 * flick;
        } else {
          afterburner.light.intensity = 0;
        }
      }
    },
  };
  return plane;
}
