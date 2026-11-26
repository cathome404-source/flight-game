// Garuda Skies — the player's single-propeller plane.
// Written fresh from the prose spec. Uses the global THREE loaded by
// index.html as a classic script (no import). The plane flies nose-first
// along -Z in its local space; the propeller spins around the Z axis.

const PAINT = {
  cream: 0xf3e2c0,
  orange: 0xe8702a,
  orangeDark: 0xb34d14,
  red: 0xc23b2e,
  metal: 0x8f969e,
  dark: 0x2b2f36,
  glass: 0x1c2f42,
  tire: 0x1e1e1e,
  lightRed: 0xff2a1a,
  lightGreen: 0x2aff5a,
  lightWhite: 0xfff6d8,
};

function lambert(color, extra) {
  return new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
}

function phong(color, extra) {
  return new THREE.MeshPhongMaterial(Object.assign({ color }, extra || {}));
}

// A thin box used for wings, tailplanes and propeller blades.
function slab(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

// Build the plane. Returns the group plus the moving parts the game
// animates every frame: the propeller and the control surfaces.
export function makeAircraft() {
  const group = new THREE.Group();
  group.name = 'aircraft';

  // Fuselage/wing paint: a glossy phong finish with a warm specular
  // highlight, so the cream reads as painted metal, not flat card.
  const cream = phong(PAINT.cream, { shininess: 60, specular: 0x8a7a55 });
  const orange = phong(PAINT.orange, { shininess: 45, specular: 0x7a3a18 });
  const orangeDark = lambert(PAINT.orangeDark);
  const metal = phong(PAINT.metal, { shininess: 70 });
  const dark = lambert(PAINT.dark);
  // Propeller blades get their own material (never shared with the
  // canopy mullions): darker and transparent, so the blades can fade
  // out with RPM — a fast-spinning prop reads as a blur disc, not as
  // a solid bar sweeping the frame.
  const bladeMat = lambert(0x23272e, { transparent: true });
  const glass = phong(PAINT.glass, { shininess: 220, specular: 0xffe9b0, flatShading: true, transparent: true, opacity: 0.88 });

  // --- Fuselage: a tapered body, nose cone up front, tail cone at the back.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.62, 4.6, 10), cream);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.3;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.4, 10), orange);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.7;
  group.add(nose);

  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.6, 10), orangeDark);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = 3.4;
  group.add(tailCone);

  // Orange cheatline stripe along each side of the fuselage.
  for (const side of [-1, 1]) {
    const stripe = slab(0.06, 0.35, 4.2, orange);
    stripe.position.set(side * 0.82, -0.05, 0.3);
    group.add(stripe);
  }

  // Red tail band: a painted ring around the rear fuselage, the second
  // accent colour of the livery so the tail is never one flat orange.
  // The fuselage tapers 0.62 (nose) to 0.85 (tail), so at z = 2.2 the
  // skin radius is ~0.83 — the band matches it instead of floating.
  const tailBand = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.35, 10), lambert(PAINT.red));
  tailBand.rotation.x = Math.PI / 2;
  tailBand.position.z = 2.2;
  group.add(tailBand);

  // Panel lines: thin dark seams along the fuselage — a top centreline,
  // two side seams, and two circumferential rings where the skin panels
  // join. They sit a hair proud of the skin so they read in close shots.
  // (Skin radius at the rings: ~0.66 at z = -1.2, ~0.79 at z = 1.2.)
  const panelDark = lambert(0x3a2e22);
  const topSeam = slab(0.05, 0.04, 4.4, panelDark);
  topSeam.position.set(0, 0.72, 0.3);
  group.add(topSeam);
  for (const side of [-1, 1]) {
    const sideSeam = slab(0.04, 0.05, 4.4, panelDark);
    sideSeam.position.set(side * 0.6, 0.42, 0.3);
    group.add(sideSeam);
  }
  for (const ringDef of [{ z: -1.2, r: 0.67 }, { z: 1.2, r: 0.8 }]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringDef.r, 0.025, 4, 18), panelDark);
    ring.position.z = ringDef.z;
    group.add(ring);
  }

  // --- Cockpit canopy: a dark faceted bubble over the front seats.
  // Few segments + flat shading on purpose: the facets catch the low
  // sun as separate glints instead of one smooth sheen.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 8, 6), glass);
  canopy.scale.set(0.95, 0.75, 1.7);
  canopy.position.set(0, 0.62, -0.7);
  group.add(canopy);

  // Canopy frame: a thin orange rim around the bubble's base.
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.07, 6, 12), orange);
  frame.rotation.x = Math.PI / 2;
  frame.scale.set(1, 1.7, 1);
  frame.position.set(0, 0.45, -0.7);
  group.add(frame);

  // Canopy mullions: two dark bars across the bubble so the glass reads
  // as framed panels, their edges catching the sun like the real thing.
  for (const zoff of [-1.15, -0.25]) {
    const bar = slab(1.28, 0.05, 0.08, dark);
    bar.position.set(0, 0.95, zoff);
    bar.rotation.x = 0.35;
    group.add(bar);
  }

  // --- Main wing: low wing, slightly swept, with orange tips.
  const wing = slab(9.2, 0.18, 1.7, cream);
  wing.position.set(0, -0.25, -0.2);
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = slab(0.5, 0.2, 1.7, orange);
    tip.position.set(side * 4.45, -0.25, -0.2);
    group.add(tip);
  }

  // Red leading edge: a thin red strip along the wing's front edge, the
  // livery's second accent carried across the whole span.
  const leadingEdge = slab(9.2, 0.2, 0.12, lambert(PAINT.red));
  leadingEdge.position.set(0, -0.25, -1.06);
  group.add(leadingEdge);

  // Wing panel lines: chordwise seams on the upper skin plus one
  // spanwise seam just ahead of the flaps and ailerons.
  const wingPanel = lambert(0x3a2e22);
  for (const x of [-3.0, -1.5, 1.5, 3.0]) {
    const seam = slab(0.04, 0.02, 1.6, wingPanel);
    seam.position.set(x, -0.15, -0.2);
    group.add(seam);
  }
  const spanSeam = slab(8.6, 0.02, 0.04, wingPanel);
  spanSeam.position.set(0, -0.15, 0.3);
  group.add(spanSeam);

  // Flaps: inboard trailing-edge panels that drop at low speed for
  // lift on approach; the flight model drives their deflection.
  const flaps = {};
  for (const side of [-1, 1]) {
    const flap = slab(1.6, 0.12, 0.6, orangeDark);
    flap.position.set(side * 1.35, -0.25, 0.85);
    group.add(flap);
    flaps[side < 0 ? 'left' : 'right'] = flap;
  }

  // Ailerons: separate trailing-edge panels that deflect with roll input.
  const ailerons = {};
  for (const side of [-1, 1]) {
    const aileron = slab(1.9, 0.12, 0.55, orangeDark);
    aileron.position.set(side * 3.3, -0.25, 0.85);
    group.add(aileron);
    ailerons[side < 0 ? 'left' : 'right'] = aileron;
  }

  // --- Tail: horizontal stabiliser, elevator, and a tall vertical fin.
  const stabiliser = slab(3.2, 0.14, 1.1, cream);
  stabiliser.position.set(0, 0.15, 3.6);
  group.add(stabiliser);

  const elevator = slab(3.0, 0.1, 0.5, orangeDark);
  elevator.position.set(0, 0.15, 4.35);
  group.add(elevator);

  const fin = slab(0.16, 1.7, 1.4, orange);
  fin.position.set(0, 0.85, 3.7);
  fin.rotation.x = -0.18;
  group.add(fin);

  // White Garuda-style flash on the fin.
  const flash = slab(0.18, 0.5, 0.9, lambert(0xf5f2e8));
  flash.position.set(0, 0.85, 3.72);
  flash.rotation.x = -0.18;
  group.add(flash);

  // Rudder: a separate panel hinged on the fin's trailing edge. It
  // swings with the yaw input (coordinated with the bank), so the tail
  // visibly works the turn instead of sitting frozen.
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, 0.85, 4.15);
  const rudder = slab(0.14, 1.55, 0.6, orangeDark);
  rudder.position.set(0, 0, 0.32);
  rudder.rotation.x = -0.18;
  rudderPivot.add(rudder);
  group.add(rudderPivot);

  // --- Propeller: spinner hub plus two blades, spins around the Z axis.
  const propeller = new THREE.Group();
  propeller.position.set(0, 0, -3.55);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 8), metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.3;
  propeller.add(spinner);
  const blades = [];
  for (let i = 0; i < 2; i++) {
    // H5: narrower (0.34 -> 0.22) and thinner (0.1 -> 0.07) so a blade
    // caught mid-spin never reads as a thick grey pillar or diagonal
    // bar across the frame.
    const blade = slab(0.22, 2.9, 0.07, bladeMat);
    blade.position.y = i === 0 ? 1.45 : -1.45;
    // A slight twist so the blades read as an airfoil, not a flat bar.
    blade.rotation.z = i === 0 ? 0.12 : -0.12;
    propeller.add(blade);
    blades.push(blade);
  }
  // Yellow blade tips, visible while spinning.
  const tips = [];
  for (const side of [-1, 1]) {
    const tip = slab(0.24, 0.5, 0.09, lambert(0xffc93c));
    tip.position.y = side * 2.7;
    propeller.add(tip);
    tips.push(tip);
  }
  group.add(propeller);

  // Propeller blur disc: a translucent disc in front of the blades that
  // fades in with RPM, so a fast spin reads as smooth motion instead of
  // flickering blades. H5: lighter grey (0x3a3f45 -> 0x6b7178) so the
  // disc reads as haze against a bright sky, not a solid grey bubble.
  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.95, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6b7178,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  blurDisc.position.set(0, 0, -3.72);
  group.add(blurDisc);

  // --- Landing gear: retractable — two main gear (strut + wheel +
  // hubcap per side) folding inward into the fuselage, plus a tail
  // wheel that slides up-forward into the tail cone. Each main gear
  // hangs from a pivot at the wing root; the pivot rotates about the
  // forward (Z) axis so the leg swings inboard and up. gear 1 = fully
  // down, 0 = fully up (set via setGear, driven by flight each frame).
  const gearPivots = {};
  const GEAR_FOLD = (100 * Math.PI) / 180; // how far a pivot swings, up
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.9, -0.25, -0.4);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), metal);
    strut.position.set(0, -0.65, 0);
    strut.rotation.z = side * 0.25;
    pivot.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10), lambert(PAINT.tire));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.15, -1.1, 0);
    pivot.add(wheel);
    const hubcap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), orange);
    hubcap.rotation.z = Math.PI / 2;
    hubcap.position.set(side * 0.15, -1.1, 0);
    pivot.add(hubcap);
    group.add(pivot);
    gearPivots[side < 0 ? 'left' : 'right'] = pivot;
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), lambert(PAINT.tire));
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 3.9);
  group.add(tailWheel);

  // --- Weathering: exhaust soot on the fuselage sides behind the
  // engine, and worn dark trailing edges on the wingtips. Light touches
  // only — the plane is loved, not wrecked.
  const soot = new THREE.MeshBasicMaterial({
    color: 0x2a2018,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    // Skin radius near the nose (z = -1.5) is ~0.64, so the stain hugs
    // the fuselage instead of floating beside it.
    const stain = slab(0.05, 0.5, 1.3, soot);
    stain.position.set(side * 0.65, -0.1, -1.5);
    group.add(stain);
    const tipWear = slab(0.52, 0.03, 0.3, soot);
    tipWear.position.set(side * 4.45, -0.14, 0.55);
    group.add(tipWear);
  }

  // --- Navigation lights: red port, green starboard, white tail.
  const navLights = {};
  const lightDefs = [
    { key: 'left', color: PAINT.lightRed, pos: [-4.7, -0.25, -0.2] },
    { key: 'right', color: PAINT.lightGreen, pos: [4.7, -0.25, -0.2] },
    { key: 'tail', color: PAINT.lightWhite, pos: [0, 0.35, 4.25] },
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

  // The plane casts its shadow on the terrain, runway and sea below.
  // The translucent prop blur disc and the glass canopy are skipped —
  // neither should throw a solid shadow.
  group.traverse((obj) => {
    if (obj.isMesh && obj !== blurDisc && obj !== canopy) {
      obj.castShadow = true;
      // The wings shade the fuselage and vice versa in the low sun.
      obj.receiveShadow = true;
    }
  });

  // The plane's own state: throttle 0..1 drives the propeller speed.
  const plane = {
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
    // Landing gear position: 1 = fully down, 0 = fully up. Flight
    // drives it every frame (state.gear); setGear sets it directly
    // for resets and posed shots.
    gear: 1,
    throttle: 0,
    propAngle: 0,
    navTime: 0,
    // Cockpit view: the renderer sets this via setCockpit; the prop
    // is hidden from the pilot's own eye (from a real cockpit a prop
    // is only a faint peripheral blur, never a pillar in the middle
    // of the windscreen).
    cockpit: false,

    // Hide or show the spinning prop parts for the cockpit view.
    // The spinner hub stays: it is part of the nose the pilot sees.
    setCockpit(v) {
      plane.cockpit = !!v;
    },

    // Set the landing gear position directly (0 = up, 1 = down).
    setGear(v) {
      plane.gear = Math.max(0, Math.min(1, v));
    },

    // Set the throttle (0..1). The propeller spins faster as it rises.
    setThrottle(v) {
      plane.throttle = Math.max(0, Math.min(1, v));
    },

    // Per-frame update. state may carry { roll, pitch, yaw } in -1..1
    // for the control surfaces and { gear } 0..1 for the landing gear;
    // without it the surfaces sit neutral and the gear holds position.
    update(dt, state) {
      const input = state || {};
      // Propeller speed: a fast idle even at zero throttle, up to a blur
      // at full throttle. Angle wraps so it never grows without bound.
      const speed = 6 + plane.throttle * 55;
      plane.propAngle = (plane.propAngle + speed * dt) % (Math.PI * 2);
      propeller.rotation.z = plane.propAngle;

      // Blur disc fades in with RPM: invisible at idle, a soft grey disc
      // at full throttle, eased so the fade itself never pops. H3: the
      // closer chase camera made the old 0.35-max disc read as a big
      // grey bubble around the plane; the ceiling is 0.12 now, verified
      // in the rings re-shot (a faint haze, no bubble edge).
      const targetBlur = 0.02 + plane.throttle * 0.10;
      blurDisc.material.opacity +=
        (targetBlur - blurDisc.material.opacity) * Math.min(1, dt * 4);

      // H5: the prop never shows in the cockpit view — blades, tips
      // and disc all hidden (the spinner hub stays, it is the nose).
      // In chase view the blades fade out fast with RPM, so at flying
      // throttle only the soft disc remains: a solid blade sweeping
      // the frame read as a grey pillar / diagonal bar in H4.
      const showProp = !plane.cockpit;
      blurDisc.visible = showProp;
      for (const b of blades) b.visible = showProp;
      for (const t of tips) t.visible = showProp;
      bladeMat.opacity = Math.max(0.12, 1.15 - plane.throttle * 2.2);

      // Ailerons deflect opposite each other with the roll input.
      const roll = input.roll || 0;
      const pitch = input.pitch || 0;
      ailerons.left.rotation.x = roll * 0.45;
      ailerons.right.rotation.x = -roll * 0.45;
      // Elevator deflects with the pitch input.
      elevator.rotation.x = pitch * 0.4;
      // Rudder swings with the yaw input (coordinated with the bank):
      // left rudder for a left turn, right rudder for a right turn.
      rudderPivot.rotation.y = (input.yaw || 0) * 0.5;
      // Flaps drop together with the approach setting (0..1): trailing
      // edge down for lift at low speed, flush again when fast.
      const flapDeflect = input.flaps || 0;
      flaps.left.rotation.x = flapDeflect * 0.55;
      flaps.right.rotation.x = flapDeflect * 0.55;

      // Landing gear: flight feeds the animated position (0..1) as
      // state.gear each frame; without it the last setGear value holds.
      // Main gear pivots swing inboard and up into the fuselage; the
      // tail wheel slides up-forward into the tail cone.
      if (typeof input.gear === 'number') {
        plane.gear = Math.max(0, Math.min(1, input.gear));
      }
      const gearUp = 1 - plane.gear;
      gearPivots.left.rotation.z = gearUp * GEAR_FOLD;
      gearPivots.right.rotation.z = -gearUp * GEAR_FOLD;
      tailWheel.position.set(0, -0.25 - 0.5 * plane.gear, 3.0 + 0.9 * plane.gear);

      // Navigation lights blink on a periodic strobe pattern at any
      // throttle: the red/green wingtip lights flash once a second,
      // the white tail light double-strobes — never a flat steady dot.
      // The wingtip on-phase is long enough (0.35 s) that a screenshot
      // still has a fair chance of catching them lit.
      plane.navTime += dt;
      const t = plane.navTime;
      const wingOn = (t % 1.0) < 0.35;
      const tailPhase = t % 1.2;
      const tailOn = tailPhase < 0.07 || (tailPhase > 0.18 && tailPhase < 0.25);
      const lit = { left: wingOn, right: wingOn, tail: tailOn };
      for (const key of Object.keys(navLights)) {
        const on = lit[key];
        const base = key === 'left' ? PAINT.lightRed : key === 'right' ? PAINT.lightGreen : PAINT.lightWhite;
        const dim = key === 'left' ? 0x4a0d06 : key === 'right' ? 0x0a3d18 : 0x6b6250;
        navLights[key].material.color.setHex(on ? base : dim);
        navLights[key].scale.setScalar(on ? 1 : 0.7);
      }
    },
  };
  return plane;
}
