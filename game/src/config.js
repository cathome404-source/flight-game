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
    // Barrel roll: full 360-degree roll rate (degrees per second) and
    // the airspeed it costs (m/s) when triggered. At 240 deg/s a roll
    // takes 1.5 s.
    barrelRollRate: 240,
    barrelRollSpeedCost: 4,
    // Turn rate at full bank and cruise speed, degrees per second.
    turnRate: 26,
    // How strongly the nose drops below stall speed, degrees per second.
    stallDropRate: 18,
    // Climb rate at full throttle and cruise speed, m/s.
    climbRate: 7,
    // Sink rate while gliding with no fuel, m/s.
    glideSink: 3.5,
    // Lift boost (m/s) from ground effect right over the runway, fading
    // out by ~12 m above the strip.
    groundEffect: 2.5,
    // Wind gusts in the storm mission, m/s of sideways push at peak.
    stormGust: 14,
  },
  gear: {
    // Seconds for the gear to travel fully up or down (animated, not a pop).
    deployTime: 1.0,
    // Extra drag (m/s per second) with the gear down in flight.
    dragDown: 0.2,
    // Damage points from a belly landing (gear up on the runway).
    bellyDamage: 25,
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
    // Points for shooting down one drone pengintai (R2-11c combat).
    dronePoints: 300,
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

// ---- Three aircraft (R2-2): one stat block each. Handling must feel
// different in play, so the gaps are wide, not cosmetic: the
// interceptor is ~23% faster and nearly twice as thirsty as the
// trainer, the heavy is ~16% slower with a 40% bigger tank and
// takes roughly half damage. turn is the roll rate (deg/s) —
// bank + speed set the actual turn radius in flight.js.
export const AIRCRAFT = {
  cendrawasih: {
    id: 'cendrawasih',
    name: 'Cendrawasih',
    role: 'Trainer — seimbang & pemaaf',
    maxSpeed: 88,
    cruiseSpeed: 55,
    stallSpeed: 28,
    pitchRate: 42,
    rollRate: 95,
    maxBank: 65,
    throttleAccel: 9,
    drainFullThrottle: 1.1,
    drainIdle: 0.25,
    capacity: 100,
    damageScale: 1.0,
    // Bars shown in the hangar (0..100), derived from the numbers above.
    bars: { speed: 55, turn: 55, economy: 55, tank: 50, tough: 50 },
  },
  rajawali: {
    id: 'rajawali',
    name: 'Rajawali',
    role: 'Interceptor — cepat, lincah, boros',
    maxSpeed: 108,
    cruiseSpeed: 68,
    stallSpeed: 34,
    pitchRate: 52,
    rollRate: 125,
    maxBank: 75,
    throttleAccel: 12,
    drainFullThrottle: 1.9,
    drainIdle: 0.35,
    capacity: 85,
    damageScale: 1.0,
    bars: { speed: 92, turn: 90, economy: 25, tank: 35, tough: 45 },
  },
  komodo: {
    id: 'komodo',
    name: 'Komodo',
    role: 'Heavy — mantap, tahan banting, tangki besar',
    maxSpeed: 74,
    cruiseSpeed: 48,
    stallSpeed: 22,
    pitchRate: 34,
    rollRate: 70,
    maxBank: 55,
    throttleAccel: 7,
    drainFullThrottle: 0.7,
    drainIdle: 0.18,
    capacity: 140,
    damageScale: 0.55,
    bars: { speed: 38, turn: 35, economy: 90, tank: 95, tough: 95 },
  },
};

export const AIRCRAFT_IDS = ['cendrawasih', 'rajawali', 'komodo'];

// ---- Hangar refits (R2-5): three upgrade tracks, 3 levels each.
// Prices rise per level; level 1 is cheap so the first upgrade lands
// after two or three sorties (~2220 coins for a full campaign).
// engine: +6 m/s top speed, +0.8 throttle accel per level.
// tank:   +20 fuel capacity per level.
// flaps:  -2 m/s stall speed, +5 deg/s roll rate per level.
export const REFIT_TRACKS = {
  engine: {
    name: 'Mesin',
    desc: '+6 m/s top speed / level',
    effectText: '+6 m/s top speed',
    prices: [150, 300, 500],
  },
  tank: {
    name: 'Tangki',
    desc: '+20 kapasitas bahan bakar / level',
    effectText: '+20 tangki',
    prices: [120, 250, 400],
  },
  flaps: {
    name: 'Flap',
    desc: '-2 m/s stall, +5°/dtk roll / level',
    effectText: '-2 m/s stall',
    prices: [120, 250, 400],
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
    { x: 1150, z: -950, y: 230, radius: 18 },
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
    { x: 1150, z: -950, y: 230, radius: 16 },
    { x: 200, z: -1100, y: 120, radius: 16 },
    { x: -900, z: -900, y: 90, radius: 16 },
    { x: -1250, z: -350, y: 60, radius: 16 },
  ],
  // R2 campaign ring sets. Crosswind: a strait crossing flown against a
  // steady sideways push. Canyon: a low line hugging the volcanic
  // island's slopes — every ring sits ~20 m above the cone, so cutting
  // a corner clips real terrain. Time trial: a fast 10-ring loop home.
  crosswindRings: [
    { x: -1000, z: 500, y: 70, radius: 18 },
    { x: -600, z: 150, y: 80, radius: 18 },
    { x: -100, z: -100, y: 70, radius: 18 },
    { x: 400, z: -300, y: 85, radius: 18 },
    { x: 800, z: -650, y: 100, radius: 18 },
    { x: 900, z: -600, y: 110, radius: 18 },
  ],
  canyonRings: [
    { x: 1450, z: -950, y: 95, radius: 16 },
    { x: 1350, z: -700, y: 88, radius: 16 },
    { x: 1150, z: -620, y: 84, radius: 16 },
    { x: 850, z: -750, y: 72, radius: 16 },
    { x: 820, z: -1000, y: 84, radius: 16 },
    { x: 1000, z: -1250, y: 82, radius: 16 },
  ],
  timeTrialRings: [
    { x: 120, z: 330, y: 60, radius: 18 },
    { x: 620, z: -120, y: 80, radius: 18 },
    { x: 1150, z: -950, y: 230, radius: 18 },
    { x: 350, z: -1250, y: 110, radius: 18 },
    { x: -850, z: -1250, y: 70, radius: 18 },
    { x: -1250, z: -350, y: 60, radius: 18 },
    { x: -500, z: 650, y: 80, radius: 18 },
    { x: 950, z: 1150, y: 120, radius: 18 },
    { x: 300, z: 900, y: 70, radius: 18 },
    { x: -80, z: 560, y: 45, radius: 18 },
  ],
  // Five intercept gates on the line from the runway to Batu Karang —
  // the fleeing target plane's route. The pilot must clear each gate
  // before the target reaches the far island (the sortie time limit).
  chaseGates: [
    { x: 150, z: 650, y: 70, radius: 18 },
    { x: 450, z: 850, y: 90, radius: 18 },
    { x: 650, z: 1000, y: 110, radius: 18 },
    { x: 850, z: 1120, y: 130, radius: 18 },
    { x: 950, z: 1150, y: 150, radius: 18 },
  ],
  // R2-11c combat — drone pengintai: slow scout drones that drift in
  // small circles around their anchor. Chase sortie: two of them sit
  // ~25 m above gates 2 and 4, right on the intercept line, so the
  // pilot meets them while chasing the gates. Boss sortie: three of
  // them inside the storm cell near boss rings 3, 5 and 7.
  chaseDrones: [
    { x: 450, z: 850, y: 115 },
    { x: 850, z: 1120, y: 155 },
  ],
  bossDrones: [
    { x: 600, z: -1100, y: 145 },
    { x: -700, z: -1300, y: 115 },
    { x: -900, z: -400, y: 95 },
  ],
  // Boss finale rings: a loop over the open sea inside the storm cell,
  // 8 rings in order. The route flows out of the takeoff heading
  // (east, then curving north and back west) so the first ring is a
  // gentle turn, not a 95-degree snap right after rotation — the
  // storm is the challenge, not the route. Heights 70–120 m keep
  // every ring well above the water and clear of every island cone.
  bossRings: [
    { x: 300, z: 300, y: 80, radius: 18 },
    { x: 600, z: -200, y: 100, radius: 18 },
    { x: 600, z: -1100, y: 120, radius: 18 },
    { x: 0, z: -1400, y: 110, radius: 18 },
    { x: -700, z: -1300, y: 90, radius: 18 },
    { x: -1100, z: -900, y: 80, radius: 18 },
    { x: -900, z: -400, y: 70, radius: 18 },
    { x: -300, z: -100, y: 90, radius: 18 },
  ],
  // The storm cell itself: centre + radius of the dark cloud mass
  // (weather.js) and the arena the boss rings loop through.
  stormCell: { x: -300, z: -800, radius: 900 },
  // Stranded boat for the rescue sortie: open sea between Garuda and
  // Kelapa, so the low pass happens over water, not over land.
  rescueBoat: { x: -650, z: 250 },
  // Three tour checkpoints, one over each far island.
  checkpoints: [
    { name: 'Merapi Kecil', x: 1150, z: -950, y: 230, radius: 40 },
    { name: 'Kelapa', x: -1250, z: -350, y: 90, radius: 40 },
    { name: 'Batu Karang', x: 950, z: 1150, y: 140, radius: 40 },
  ],
  // Four night checkpoints for the night sortie: sea crossings first,
  // then the volcano, then a low final over the runway approach. At
  // night the light pillars and runway lights are the guide.
  nightCheckpoints: [
    { name: 'Teluk Senja', x: 600, z: 700, y: 110, radius: 40 },
    { name: 'Laut Kelapa', x: -700, z: -700, y: 130, radius: 40 },
    { name: 'Merapi Kecil', x: 1150, z: -950, y: 240, radius: 40 },
    { name: 'Pulang', x: 200, z: 560, y: 60, radius: 40 },
  ],
  // Fuel rings hover over the sea between islands; flying through one refuels.
  fuelRings: [
    { x: 500, z: 700, y: 80, radius: 16 },
    { x: -700, z: -800, y: 90, radius: 16 },
    { x: 100, z: -600, y: 100, radius: 16 },
  ],
  // Golden-hour sun direction (low in the west) and sky colours.
  // Elevation 10.5 deg, lowered from 11.5: shadows stretch longer
  // and the low light rakes across the terrain relief, so one side
  // of each hill lights up and the other falls into shade.
  sun: { azimuth: 262, elevation: 10.5 },
  sky: {
    horizon: 0xffb36b,
    zenith: 0x2e4a7a,
    sun: 0xffd27a,
  },
  // Day-night cycle (R4-3): a game clock drives the time of day.
  // A full cycle takes cycleMinutes of play (10 min default, so the
  // player sees the mood change inside one mission). The menu and
  // the screenshot poses start at startHour (golden hour, today's
  // look). Each keyframe is one stop: sun azimuth/elevation, sky
  // colours, light levels, exposure, glow strength and night 0..1
  // (1 = full night: runway/nav lights carry the scene). Night
  // keyframes reuse the sun light as dim blue moonlight.
  dayNight: {
    cycleMinutes: 10,
    startHour: 17.5,
    keyframes: [
      { hour: 0, azimuth: 150, elevation: 40, horizon: 0x0b1830, zenith: 0x03070f, sun: 0x9db8ff, sunIntensity: 0.30, hemi: 0.20, ambient: 0.20, exposure: 0.95, glow: 0.12, night: 1 },
      { hour: 3, azimuth: 170, elevation: 45, horizon: 0x0b1830, zenith: 0x03070f, sun: 0x9db8ff, sunIntensity: 0.30, hemi: 0.20, ambient: 0.20, exposure: 0.95, glow: 0.12, night: 1 },
      { hour: 6, azimuth: 100, elevation: 25, horizon: 0xbcd9ea, zenith: 0x5f9bd5, sun: 0xffe9b0, sunIntensity: 1.5, hemi: 0.7, ambient: 0.28, exposure: 1.0, glow: 0.7, night: 0 },
      { hour: 12, azimuth: 180, elevation: 68, horizon: 0xa8d4f0, zenith: 0x2a6fc0, sun: 0xfff2cc, sunIntensity: 1.4, hemi: 0.65, ambient: 0.25, exposure: 0.9, glow: 0.5, night: 0 },
      { hour: 17.5, azimuth: 262, elevation: 10.5, horizon: 0xffb36b, zenith: 0x2e4a7a, sun: 0xffd27a, sunIntensity: 1.9, hemi: 0.72, ambient: 0.22, exposure: 1.05, glow: 1.0, night: 0 },
      { hour: 19, azimuth: 272, elevation: 3, horizon: 0xff7a3c, zenith: 0x352a5e, sun: 0xff8a3c, sunIntensity: 1.1, hemi: 0.5, ambient: 0.18, exposure: 1.0, glow: 0.9, night: 0.25 },
      { hour: 21, azimuth: 120, elevation: 30, horizon: 0x0e1e38, zenith: 0x040814, sun: 0x9db8ff, sunIntensity: 0.32, hemi: 0.22, ambient: 0.20, exposure: 0.95, glow: 0.15, night: 1 },
    ],
  },
  // Terrain relief (H1): how deep the valleys cut into each island's
  // cone, where the rim cliffs start, and how far the haze reaches.
  terrain: {
    // Valleys cut to (1 - relief) of the island cone height; ridges
    // keep the full cone height. 0.5 = up to ~105 m of relief on the
    // volcanic island, ~23 m on the home island.
    relief: 0.5,
    // Past this fraction of the island radius the slope falls steeply
    // to the beach — the rim cliffs.
    rimCliffStart: 0.88,
  },
  atmosphere: {
    // Distance fog: nearer and shorter than before, so far islands
    // melt into the warm haze while the foreground stays sharp.
    fogNear: 650,
    fogFar: 2600,
  },
};

// R2 campaign sorties 1–12 (sortie 12 is the boss finale — its storm
// mechanics live in weather.js, wired in R2-4). Fields: kind drives
// the mission logic in missions.js; ringSet / checkpointSet name the
// WORLD list the sortie flies; coins is the campaign reward; targetScore
// is the score to beat; startHour pins the time of day (night sortie);
// startFuel starts the tank part-full (rescue); allowRefuel false means
// fuel rings give nothing (time trial).
export const MISSIONS = [
  {
    id: 'takeoff', kind: 'takeoff',
    name: 'Lepas Landas',
    short: 'Lepas landas',
    objective: 'Lepas landas dari runway dan naik melewati 100 m.',
    targetAltitude: 100,
    timeLimit: 120, parTime: 45, wind: 0,
    coins: 100, targetScore: 300,
  },
  {
    id: 'rings', kind: 'rings', ringSet: 'rings',
    name: 'Lingkaran Pertama',
    short: 'Terbang melewati ring',
    objective: 'Terbang melewati 8 ring sesuai urutan.',
    ringCount: 8,
    timeLimit: 300, parTime: 150, wind: 2,
    coins: 120, targetScore: 2200,
  },
  {
    id: 'tour', kind: 'tour', checkpointSet: 'checkpoints',
    name: 'Tur Keliling Pulau',
    short: 'Keliling pulau',
    objective: 'Kunjungi 3 checkpoint di atas Merapi Kecil, Kelapa, dan Batu Karang.',
    checkpointCount: 3,
    timeLimit: 420, parTime: 240, wind: 4,
    coins: 150, targetScore: 1500,
  },
  {
    id: 'landing', kind: 'landing',
    name: 'Mendarat Presisi',
    short: 'Mendarat presisi',
    objective: 'Mendarat dengan lembut di dalam zona touchdown kuning di runway.',
    timeLimit: 300, parTime: 120, wind: 3,
    coins: 150, targetScore: 600,
  },
  {
    id: 'crosswind', kind: 'rings', ringSet: 'crosswindRings',
    name: 'Selat Berangin',
    short: 'Ring melawan angin samping',
    objective: 'Terbang melewati 6 ring di selat — angin samping mendorong pesawat ke timur, lawan terus.',
    ringCount: 6,
    timeLimit: 300, parTime: 150, wind: 10,
    coins: 150, targetScore: 1800,
  },
  {
    id: 'chase', kind: 'rings', ringSet: 'chaseGates',
    name: 'Kejar Bayangan',
    short: 'Kejar pesawat target',
    objective: 'Kejar pesawat target melewati 5 gate sebelum ia sampai di pulau jauh.',
    ringCount: 5,
    timeLimit: 120, parTime: 60, wind: 4,
    coins: 200, targetScore: 1600,
  },
  {
    id: 'canyon', kind: 'rings', ringSet: 'canyonRings',
    name: 'Ngarai Sempit',
    short: 'Rute rendah di ngarai',
    objective: 'Terbang rendah di antara punggung gunung Merapi Kecil melewati 6 ring — jangan senggol lereng.',
    ringCount: 6,
    timeLimit: 300, parTime: 170, wind: 6,
    coins: 200, targetScore: 1800,
  },
  {
    id: 'night', kind: 'tour', checkpointSet: 'nightCheckpoints',
    name: 'Malam di Atas Laut',
    short: 'Checkpoint di malam hari',
    objective: 'Kunjungi 4 checkpoint di malam hari — lampu runway dan mercusuar jadi panduan.',
    checkpointCount: 4,
    timeLimit: 420, parTime: 260, wind: 3, startHour: 21.5,
    coins: 250, targetScore: 1900,
  },
  {
    id: 'storm', kind: 'rings', ringSet: 'stormRings',
    name: 'Badai Datang',
    short: 'Terbang di badai',
    objective: 'Terbang melewati 6 ring melawan waktu selagi angin makin kencang.',
    ringCount: 6,
    timeLimit: 180, parTime: 110, wind: 12,
    coins: 250, targetScore: 1800,
  },
  {
    id: 'rescue', kind: 'rescue',
    name: 'Penyelamatan',
    short: 'Selamatkan kapal terdampar',
    objective: 'Lewat pelan di atas kapal terdampar (di bawah 120 kt, di bawah 60 m), lalu mendarat sebelum bahan bakar habis.',
    timeLimit: 300, parTime: 200, wind: 4, startFuel: 55,
    coins: 300, targetScore: 1200,
  },
  {
    id: 'timetrial', kind: 'rings', ringSet: 'timeTrialRings',
    name: 'Ujian Waktu',
    short: 'Time trial 10 ring',
    objective: 'Terbang melewati 10 ring secepat mungkin — jam ketat, tanpa isi bahan bakar.',
    ringCount: 10,
    timeLimit: 180, parTime: 140, wind: 2, allowRefuel: false,
    coins: 350, targetScore: 2800,
  },
  {
    id: 'boss', kind: 'rings', ringSet: 'bossRings',
    name: 'Badai Leviathan',
    short: 'Finale: 8 ring badai',
    objective: 'Finale: terbang melewati 8 ring badai di tengah sel badai — hujan deras, petir, hembusan kuat mendorong pesawat.',
    ringCount: 8,
    timeLimit: 240, parTime: 170, wind: 12, startHour: 19.0,
    coins: 500, targetScore: 3500,
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
