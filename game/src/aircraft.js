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

  const cream = lambert(PAINT.cream);
  const orange = lambert(PAINT.orange);
  const orangeDark = lambert(PAINT.orangeDark);
  const metal = phong(PAINT.metal, { shininess: 70 });
  const dark = lambert(PAINT.dark);
  const glass = phong(PAINT.glass, { shininess: 120, transparent: true, opacity: 0.85 });

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

  // --- Cockpit canopy: a dark glossy bubble over the front seats.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), glass);
  canopy.scale.set(0.95, 0.75, 1.7);
  canopy.position.set(0, 0.62, -0.7);
  group.add(canopy);

  // Canopy frame: a thin orange rim around the bubble's base.
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.07, 6, 12), orange);
  frame.rotation.x = Math.PI / 2;
  frame.scale.set(1, 1.7, 1);
  frame.position.set(0, 0.45, -0.7);
  group.add(frame);

  // --- Main wing: low wing, slightly swept, with orange tips.
  const wing = slab(9.2, 0.18, 1.7, cream);
  wing.position.set(0, -0.25, -0.2);
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = slab(0.5, 0.2, 1.7, orange);
    tip.position.set(side * 4.45, -0.25, -0.2);
    group.add(tip);
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

  // --- Propeller: spinner hub plus two blades, spins around the Z axis.
  const propeller = new THREE.Group();
  propeller.position.set(0, 0, -3.55);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 8), metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.3;
  propeller.add(spinner);
  const blades = [];
  for (let i = 0; i < 2; i++) {
    const blade = slab(0.34, 2.9, 0.1, dark);
    blade.position.y = i === 0 ? 1.45 : -1.45;
    // A slight twist so the blades read as an airfoil, not a flat bar.
    blade.rotation.z = i === 0 ? 0.12 : -0.12;
    propeller.add(blade);
    blades.push(blade);
  }
  // Yellow blade tips, visible while spinning.
  for (const side of [-1, 1]) {
    const tip = slab(0.36, 0.5, 0.12, lambert(0xffc93c));
    tip.position.y = side * 2.7;
    propeller.add(tip);
  }
  group.add(propeller);

  // --- Landing gear: two fixed wheels with fairings, plus a tail wheel.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), metal);
    strut.position.set(side * 0.9, -0.9, -0.4);
    strut.rotation.z = side * 0.25;
    group.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10), lambert(PAINT.tire));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.05, -1.35, -0.4);
    group.add(wheel);
    const hubcap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), orange);
    hubcap.rotation.z = Math.PI / 2;
    hubcap.position.set(side * 1.05, -1.35, -0.4);
    group.add(hubcap);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), lambert(PAINT.tire));
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 3.9);
  group.add(tailWheel);

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

  // The plane's own state: throttle 0..1 drives the propeller speed.
  const plane = {
    group,
    propeller,
    blades,
    ailerons,
    elevator,
    navLights,
    throttle: 0,
    propAngle: 0,

    // Set the throttle (0..1). The propeller spins faster as it rises.
    setThrottle(v) {
      plane.throttle = Math.max(0, Math.min(1, v));
    },

    // Per-frame update. state may carry { roll, pitch } in -1..1 for the
    // control surfaces; without it the surfaces sit neutral.
    update(dt, state) {
      const input = state || {};
      // Propeller speed: a fast idle even at zero throttle, up to a blur
      // at full throttle. Angle wraps so it never grows without bound.
      const speed = 6 + plane.throttle * 55;
      plane.propAngle = (plane.propAngle + speed * dt) % (Math.PI * 2);
      propeller.rotation.z = plane.propAngle;

      // Ailerons deflect opposite each other with the roll input.
      const roll = input.roll || 0;
      const pitch = input.pitch || 0;
      ailerons.left.rotation.x = roll * 0.45;
      ailerons.right.rotation.x = -roll * 0.45;
      // Elevator deflects with the pitch input.
      elevator.rotation.x = pitch * 0.4;

      // Navigation lights blink gently at low throttle, steady at speed.
      const blink = plane.throttle < 0.15
        ? (Math.sin(plane.propAngle * 2) > 0 ? 1 : 0.25)
        : 1;
      for (const key of Object.keys(navLights)) {
        navLights[key].material.color.setHex(
          key === 'left' ? PAINT.lightRed : key === 'right' ? PAINT.lightGreen : PAINT.lightWhite
        );
        navLights[key].scale.setScalar(blink);
      }
    },
  };
  return plane;
}
