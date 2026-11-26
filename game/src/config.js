// Garuda Skies — tuning, world layout and mission list.
// Written fresh from the prose spec. All speeds in m/s, distances in metres,
// altitudes in metres above sea level, angles in degrees unless noted.

export const TUNING = {
  flight: {
    // Lift only holds the plane up above this airspeed; below it the nose drops.
    stallSpeed: 28,
    // Airspeed where the wing flies cleanly with no buffet.
    cruiseSpeed: 55,
    // Hard cap the engine can reach in level flight.
    maxSpeed: 88,
    // Acceleration from full throttle, m/s per second.
    throttleAccel: 9,
    // Drag deceleration when the throttle is idle, m/s per second.
    idleDrag: 4.5,
    // Extra drag while banked hard (turns bleed speed).
    turnDrag: 2.2,
    // How fast the nose follows a pitch input, degrees per second.
    pitchRate: 42,
    // How fast the plane rolls into a bank, degrees per second.
    rollRate: 95,
    // Steepest bank the controls allow, degrees.
    maxBank: 65,
    // Turn rate at full bank and cruise speed, degrees per second.
    turnRate: 26,
    // How strongly the nose drops below stall speed, degrees per second.
    stallDropRate: 18,
    // Climb rate at full throttle and cruise speed, m/s.
    climbRate: 7,
    // Sink rate while gliding with no fuel, m/s.
    glideSink: 3.5,
    // Wind gusts in the storm mission, m/s of sideways push at peak.
    stormGust: 14,
  },
  fuel: {
    // Fuel units in a full tank (100 = full).
    capacity: 100,
    // Units burned per second at full throttle.
    drainFullThrottle: 1.1,
    // Units burned per second at idle.
    drainIdle: 0.25,
    // Units restored per second while parked on the runway.
    refuelRate: 25,
    // Units restored by flying through a fuel ring.
    fuelRingBonus: 30,
    // Warning level where the HUD fuel gauge turns red.
    lowFuelWarning: 20,
  },
  damage: {
    // Touchdown vertical speed (m/s) below which a landing is gentle and safe.
    gentleTouchdown: 3,
    // Touchdown vertical speed above which the landing is hard and damages the plane.
    hardTouchdown: 7,
    // Damage points added by a hard landing.
    hardLandingDamage: 25,
    // Damage points added by clipping terrain or a building.
    terrainHitDamage: 40,
    // Damage at which the plane is wrecked.
    maxDamage: 100,
    // Screen-shake strength (pixels) on a hard landing.
    hardLandingShake: 14,
  },
  scoring: {
    // Points per ring flown through.
    ringPoints: 250,
    // Points per checkpoint visited.
    checkpointPoints: 400,
    // Points for a gentle touchdown inside the zone.
    landingPoints: 500,
    // Bonus points per second under the mission par time.
    timeBonusPerSecond: 10,
  },
  camera: {
    // Chase camera: metres behind and above the plane.
    chaseDistance: 14,
    chaseHeight: 4.5,
    // How fast the chase camera catches up to the plane (0..1 per frame at 60fps).
    chaseLerp: 0.12,
    // Cockpit eye position relative to the plane centre, metres.
    cockpitEye: { x: 0, y: 1.1, z: 1.6 },
    // Degrees of view turned per pixel of mouse drag.
    lookSensitivity: 0.25,
    // Field of view for both cameras, degrees.
    fov: 68,
  },
  hud: {
    // Airspeed below which the stall warning flashes even before the nose drops.
    stallWarnSpeed: 32,
    // Seconds a centre-screen message stays visible.
    messageHoldSeconds: 2.5,
  },
};

export const WORLD = {
  // Square of open sea the game takes place on, metres across.
  seaSize: 4200,
  // Sea level is y = 0; the runway sits slightly above it.
  runwayAltitude: 4,
  islands: [
    // Home island: the runway island, long and flat on its south shore.
    { name: 'Garuda', x: 0, z: 0, radius: 620, height: 46 },
    // Tall volcanic island to the north-east, the tour's high checkpoint.
    { name: 'Merapi Kecil', x: 1150, z: -950, radius: 480, height: 210 },
    // Low palm island to the west, ring run passes over it.
    { name: 'Kelapa', x: -1250, z: -350, radius: 380, height: 38 },
    // Rocky island to the south-east with a lighthouse hill.
    { name: 'Batu Karang', x: 950, z: 1150, radius: 340, height: 96 },
    // Small sandbar island to the north-west, barely above the waves.
    { name: 'Pasir Putih', x: -850, z: -1250, radius: 210, height: 14 },
  ],
  runway: {
    // Centred on the south shore of Garuda island, pointing east-west.
    // z = 560 puts the strip on the beach rim: the island cone is under
    // 2 m high there, so the asphalt sits on the sand instead of being
    // buried inside the grass cone (which covers z = 330).
    x: -80,
    z: 560,
    heading: 90,
    length: 420,
    width: 26,
    // Touchdown zone: the first third of the runway from the west end.
    touchdownZoneStart: -290,
    touchdownZoneEnd: -150,
  },
  // Eight rings for the Ring Run, in flying order, looping the archipelago.
  rings: [
    { x: 120, z: 330, y: 60, radius: 18 },
    { x: 620, z: -120, y: 80, radius: 18 },
    { x: 1150, z: -950, y: 150, radius: 18 },
    { x: 350, z: -1250, y: 110, radius: 18 },
    { x: -850, z: -1250, y: 70, radius: 18 },
    { x: -1250, z: -350, y: 60, radius: 18 },
    { x: -500, z: 650, y: 80, radius: 18 },
    { x: 950, z: 1150, y: 120, radius: 18 },
  ],
  // Six storm rings, a tighter line flown against the clock.
  stormRings: [
    { x: 300, z: 200, y: 70, radius: 16 },
    { x: 900, z: -400, y: 100, radius: 16 },
    { x: 1150, z: -950, y: 170, radius: 16 },
    { x: 200, z: -1100, y: 120, radius: 16 },
    { x: -900, z: -900, y: 90, radius: 16 },
    { x: -1250, z: -350, y: 60, radius: 16 },
  ],
  // Three tour checkpoints, one over each far island.
  checkpoints: [
    { name: 'Merapi Kecil', x: 1150, z: -950, y: 230, radius: 40 },
    { name: 'Kelapa', x: -1250, z: -350, y: 90, radius: 40 },
    { name: 'Batu Karang', x: 950, z: 1150, y: 140, radius: 40 },
  ],
  // Fuel rings hover over the sea between islands; flying through one refuels.
  fuelRings: [
    { x: 500, z: 700, y: 80, radius: 16 },
    { x: -700, z: -800, y: 90, radius: 16 },
    { x: 100, z: -600, y: 100, radius: 16 },
  ],
  // Golden-hour sun direction (low in the west) and sky colours.
  sun: { azimuth: 262, elevation: 14 },
  sky: {
    horizon: 0xffb36b,
    zenith: 0x2e4a7a,
    sun: 0xffd27a,
  },
};

export const MISSIONS = [
  {
    id: 'takeoff',
    name: 'Takeoff',
    short: 'Lepas landas',
    objective: 'Take off from the runway and climb past 100 m.',
    targetAltitude: 100,
    timeLimit: 120,
    parTime: 45,
    wind: 0,
  },
  {
    id: 'rings',
    name: 'Ring Run',
    short: 'Terbang melewati ring',
    objective: 'Fly through all 8 target rings in order.',
    ringCount: 8,
    timeLimit: 300,
    parTime: 150,
    wind: 2,
  },
  {
    id: 'tour',
    name: 'Island Tour',
    short: 'Keliling pulau',
    objective: 'Visit the 3 checkpoints over Merapi Kecil, Kelapa and Batu Karang.',
    checkpointCount: 3,
    timeLimit: 420,
    parTime: 240,
    wind: 4,
  },
  {
    id: 'landing',
    name: 'Precision Landing',
    short: 'Mendarat presisi',
    objective: 'Land gently inside the marked touchdown zone on the runway.',
    timeLimit: 300,
    parTime: 120,
    wind: 3,
  },
  {
    id: 'storm',
    name: 'Storm Run',
    short: 'Terbang di badai',
    objective: 'Fly through 6 rings against the clock as the wind picks up.',
    ringCount: 6,
    timeLimit: 180,
    parTime: 110,
    wind: 12,
  },
];

export const FREE_FLIGHT = {
  id: 'free',
  name: 'Free Flight',
  short: 'Terbang bebas',
  objective: 'No objective — explore the archipelago at golden hour.',
  timeLimit: 0,
  wind: 3,
};
