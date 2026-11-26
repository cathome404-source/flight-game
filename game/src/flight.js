// Garuda Skies — flight physics: lift, stall, turns, drag, fuel, damage.
// Written fresh from the prose spec. The plane flies nose-first along -Z in
// its own space; yaw/pitch/roll are tracked as plain angles and turned into
// a quaternion for the aircraft group. THREE is used only when the global
// is present (browser); a tiny fallback vector covers headless runs.

import { TUNING, WORLD } from './config.js';

const DEG = Math.PI / 180;
const GRAVITY_TURN = 9.81;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Minimal stand-in for THREE.Vector3, used only when the global is absent.
class FallbackVec3 {
  constructor(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone() {
    return new FallbackVec3(this.x, this.y, this.z);
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
}

const Vec3 =
  typeof THREE !== 'undefined' && THREE.Vector3 ? THREE.Vector3 : FallbackVec3;

// Quaternion from YXZ euler angles (yaw about Y, pitch about X, roll about Z).
// Standard composition; roll is applied last around the forward axis.
function eulerYXZToQuat(yaw, pitch, roll) {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cx = Math.cos(pitch / 2);
  const sx = Math.sin(pitch / 2);
  const cz = Math.cos(roll / 2);
  const sz = Math.sin(roll / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

// Ground height at a map position: the runway strip wins over the island
// cone beneath it, otherwise the tallest island cone, otherwise the sea.
// Exported: render.js pins the plane's blob shadow to this height, so
// the disc always sits on the ground instead of floating in the air.
export function terrainHeightAt(x, z) {
  const rw = WORLD.runway;
  const halfLen = rw.length / 2;
  const halfWid = rw.width / 2;
  if (Math.abs(x - rw.x) <= halfLen && Math.abs(z - rw.z) <= halfWid) {
    return WORLD.runwayAltitude;
  }
  let height = 0;
  for (const island of WORLD.islands) {
    const dx = x - island.x;
    const dz = z - island.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < island.radius) {
      const h = island.height * (1 - dist / island.radius);
      if (h > height) height = h;
    }
  }
  return height;
}

function onRunwayRect(x, z) {
  const rw = WORLD.runway;
  return (
    Math.abs(x - rw.x) <= rw.length / 2 && Math.abs(z - rw.z) <= rw.width / 2
  );
}

function inTouchdownZone(x, z) {
  const rw = WORLD.runway;
  return (
    onRunwayRect(x, z) && x >= rw.touchdownZoneStart && x <= rw.touchdownZoneEnd
  );
}

export function createFlight(world, aircraft, config) {
  const tune = (config && config.TUNING) || TUNING;
  const cfgWorld = (config && config.WORLD) || WORLD;
  const fly = tune.flight;
  const fuelCfg = tune.fuel;
  const dmgCfg = tune.damage;
  const gearCfg = tune.gear || { deployTime: 1, dragDown: 0.2, bellyDamage: 25 };

  // Ring / checkpoint / fuel-ring positions come from the built world when
  // available, so the physics never duplicates the layout constants.
  const ringDefs = cfgWorld.rings;
  const stormDefs = cfgWorld.stormRings;
  const checkpointDefs = cfgWorld.checkpoints;
  const fuelRingDefs = cfgWorld.fuelRings;

  const startX = cfgWorld.runway.x - cfgWorld.runway.length / 2 + 30;
  const startZ = cfgWorld.runway.z;
  // Runway heading 90 means flying east (+X). Forward -Z rotated by yaw
  // gives +X when yaw is -90 degrees.
  const startYaw = -90 * DEG;

  const state = {
    position: new Vec3(startX, cfgWorld.runwayAltitude, startZ),
    yaw: startYaw,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: fuelCfg.capacity,
    damage: 0,
    status: 'onGround', // onGround | flying | landed | crashed
    stalled: false,
    gliding: false,
    verticalSpeed: 0,
    altitude: cfgWorld.runwayAltitude,
    heading: 90,
    bankDeg: 0,
    pitchDeg: 0,
    wind: 0,
    time: 0,
    // Landing gear: down on the ground, retractable in flight.
    // gearDown is the commanded position; gearDeploy 0..1 is the
    // animated position (1 = fully down, 0 = fully up).
    gearDown: true,
    gearDeploy: 1,
  };

  // Proximity re-arm flags: a ring only fires again after the plane has
  // left its neighbourhood, so one pass is exactly one event.
  const ringArmed = ringDefs.map(() => true);
  const stormArmed = stormDefs.map(() => true);
  const checkpointArmed = checkpointDefs.map(() => true);
  const fuelArmed = fuelRingDefs.map(() => true);

  let wasStalled = false;

  // Smoothed stick: the controls lag the player's input a touch, so the
  // plane responds with a slight delay and keeps a little momentum
  // instead of snapping to the stick position.
  let stickPitch = 0;
  let stickRoll = 0;

  // Barrel roll state: one roll at a time, sweeping 360 degrees from the
  // bank the plane had when the roll started, then settling back to it.
  let rolling = false;
  let rollDir = 1; // +1 right (E), -1 left (Q)
  let rollProgress = 0; // degrees swept so far, 0..360
  let baseRoll = 0; // state.roll (radians) when the roll started

  const flight = {
    state,

    // Event hooks. Missions and the HUD assign these; defaults are no-ops.
    onEvent: {
      onRing: null,
      onStormRing: null,
      onCheckpoint: null,
      onFuelRing: null,
      onTouchdown: null,
      onTerrainHit: null,
      onCrash: null,
      onStall: null,
    },

    setWind(mps) {
      state.wind = Math.max(0, mps || 0);
    },

    // Ground height under a map position (runway strip, island cone or
    // sea). Render and HUD use it for ground clearance and camera work.
    groundHeightAt(x, z) {
      return terrainHeightAt(x, z);
    },

    refuel() {
      state.fuel = fuelCfg.capacity;
    },

    // Barrel roll trigger: Q rolls left (dir -1), E rolls right (dir +1).
    // Only while flying, one roll at a time, and only with enough speed
    // to pay the speed cost without dropping below stall speed.
    // Returns true when a roll actually starts.
    startBarrelRoll(dir) {
      if (state.status !== 'flying' || rolling) return false;
      if (state.speed <= fly.stallSpeed + fly.barrelRollSpeedCost + 2) {
        return false;
      }
      rolling = true;
      rollDir = dir >= 0 ? 1 : -1;
      rollProgress = 0;
      baseRoll = state.roll;
      state.speed = Math.max(
        fly.stallSpeed + 1,
        state.speed - fly.barrelRollSpeedCost
      );
      return true;
    },

    isRolling() {
      return rolling;
    },

    // Landing-gear toggle (G): only in flight — on the ground the
    // plane sits on its wheels, and a crashed plane stays as it is.
    // Returns true when the gear actually starts moving.
    toggleGear() {
      if (state.status !== 'flying') return false;
      state.gearDown = !state.gearDown;
      return true;
    },

    addDamage(v) {
      if (state.status === 'crashed') return;
      state.damage = clamp(state.damage + v, 0, dmgCfg.maxDamage);
      if (state.damage >= dmgCfg.maxDamage) {
        flight.crash('damage');
      }
    },

    crash(reason) {
      if (state.status === 'crashed') return;
      state.status = 'crashed';
      state.speed = 0;
      state.throttle = 0;
      rolling = false;
      rollProgress = 0;
      if (aircraft && aircraft.setThrottle) aircraft.setThrottle(0);
      if (flight.onEvent.onCrash) {
        flight.onEvent.onCrash({ reason: reason || 'crash', damage: state.damage });
      }
    },

    reset() {
      state.position.set(startX, cfgWorld.runwayAltitude, startZ);
      state.yaw = startYaw;
      state.pitch = 0;
      state.roll = 0;
      state.speed = 0;
      state.throttle = 0;
      state.fuel = fuelCfg.capacity;
      state.damage = 0;
      state.status = 'onGround';
      state.stalled = false;
      state.gliding = false;
      state.verticalSpeed = 0;
      state.altitude = cfgWorld.runwayAltitude;
      state.heading = 90;
      state.bankDeg = 0;
      state.pitchDeg = 0;
      state.wind = 0;
      state.time = 0;
      state.gearDown = true;
      state.gearDeploy = 1;
      wasStalled = false;
      stickPitch = 0;
      stickRoll = 0;
      rolling = false;
      rollProgress = 0;
      baseRoll = 0;
      for (let i = 0; i < ringArmed.length; i++) ringArmed[i] = true;
      for (let i = 0; i < stormArmed.length; i++) stormArmed[i] = true;
      for (let i = 0; i < checkpointArmed.length; i++) checkpointArmed[i] = true;
      for (let i = 0; i < fuelArmed.length; i++) fuelArmed[i] = true;
      if (aircraft && aircraft.setThrottle) aircraft.setThrottle(0);
      if (aircraft && aircraft.setGear) aircraft.setGear(1);
      flight.syncAircraft();
    },

    // Push the physics state into the visible aircraft model.
    syncAircraft() {
      if (!aircraft || !aircraft.group) return;
      aircraft.group.position.copy(state.position);
      const q = eulerYXZToQuat(state.yaw, state.pitch, state.roll);
      if (aircraft.group.quaternion && aircraft.group.quaternion.set) {
        aircraft.group.quaternion.set(q.x, q.y, q.z, q.w);
      } else {
        aircraft.group.quaternion = q;
      }
    },

    // One simulation step. input is either the object from createInput
    // (with axes()) or a plain { pitch, roll, throttle } axes object.
    update(dt, input) {
      if (state.status === 'crashed') return;
      dt = Math.min(dt, 0.05);
      state.time += dt;

      const axes =
        input && typeof input.axes === 'function'
          ? input.axes(dt)
          : input || { pitch: 0, roll: 0, throttle: 0 };
      const pitchIn = clamp(axes.pitch || 0, -1, 1);
      const rollIn = clamp(axes.roll || 0, -1, 1);
      const throttleIn = clamp(axes.throttle || 0, -1, 1);

      // Inertia: ease the stick toward the commanded input (time constant
      // ~0.16 s). A quick stick flick moves the plane late and soft; when
      // the stick is released the attitude keeps drifting briefly before
      // the level-off catches it.
      const stickRate = Math.min(1, dt / 0.16);
      stickPitch += (pitchIn - stickPitch) * stickRate;
      stickRoll += (rollIn - stickRoll) * stickRate;

      const flying = state.status === 'flying';

      // --- Throttle: Shift/W nudges it up, Ctrl/S down, 0.55 per second.
      state.throttle = clamp(state.throttle + throttleIn * 0.55 * dt, 0, 1);

      // --- Fuel burn follows the throttle; empty tank means gliding.
      const burn =
        fuelCfg.drainIdle +
        (fuelCfg.drainFullThrottle - fuelCfg.drainIdle) * state.throttle;
      state.fuel = Math.max(0, state.fuel - burn * dt);
      state.gliding = state.fuel <= 0;
      const effectiveThrottle = state.gliding ? 0 : state.throttle;

      // --- Gear travel: the animated position chases the commanded
      // one over the configured deploy time (up or down, ~1 s).
      const gearTarget = state.gearDown ? 1 : 0;
      const gearStep = dt / (gearCfg.deployTime || 1);
      if (state.gearDeploy < gearTarget) {
        state.gearDeploy = Math.min(gearTarget, state.gearDeploy + gearStep);
      } else if (state.gearDeploy > gearTarget) {
        state.gearDeploy = Math.max(gearTarget, state.gearDeploy - gearStep);
      }

      // --- Airspeed: engine push against drag; banked turns bleed speed.
      const speedRatio = state.speed / fly.maxSpeed;
      const drag =
        fly.idleDrag * (1 - effectiveThrottle) * (0.35 + 0.65 * speedRatio) +
        fly.turnDrag * Math.abs(Math.sin(state.roll)) * speedRatio +
        (flying ? gearCfg.dragDown * state.gearDeploy : 0);
      state.speed += (fly.throttleAccel * effectiveThrottle - drag) * dt;
      state.speed = clamp(state.speed, 0, fly.maxSpeed);

      // --- Stall: below stall speed the wing stops lifting.
      state.stalled = flying && state.speed < fly.stallSpeed;
      if (state.stalled && !wasStalled && flight.onEvent.onStall) {
        flight.onEvent.onStall({ speed: state.speed });
      }
      wasStalled = state.stalled;

      if (flying) {
        // --- Light turbulence: slow gusts move the level-flight target
        // itself a degree or two, so the plane sways gently instead of
        // fighting the auto-level spring.
        const gustRollT = (1.2 * Math.sin(state.time * 0.9) + 0.7 * Math.sin(state.time * 1.7 + 1.3)) * DEG;
        const gustPitchT = (0.9 * Math.sin(state.time * 0.7 + 2.1) + 0.6 * Math.sin(state.time * 1.3 + 0.4)) * DEG;
        const gustPitchRate = (1.0 * Math.sin(state.time * 0.7 + 2.1) + 0.6 * Math.sin(state.time * 1.3 + 0.4)) * DEG;

        // --- Pitch and roll follow the smoothed stick; roll auto-levels
        // when free.
        state.pitch = clamp(
          state.pitch + (stickPitch * fly.pitchRate * DEG + gustPitchRate) * dt,
          -55 * DEG,
          55 * DEG
        );
        // Hands off the pitch stick: ease back toward level flight
        // instead of holding the last attitude.
        if (Math.abs(stickPitch) < 0.02 && !state.stalled) {
          const pitchLevelRate = 7 * DEG;
          const diff = gustPitchT - state.pitch;
          if (Math.abs(diff) <= pitchLevelRate * dt) state.pitch = gustPitchT;
          else state.pitch += Math.sign(diff) * pitchLevelRate * dt;
        }
        // --- Barrel roll: while rolling, the roll angle sweeps a full
        // 360 degrees from the pre-roll bank at the configured rate,
        // ignoring the stick's bank target and the gusts. Pitch still
        // answers the stick (handled above); the turn is suppressed so
        // the heading holds roughly through the roll.
        if (rolling) {
          rollProgress += fly.barrelRollRate * dt;
          if (rollProgress >= 360) {
            rolling = false;
            rollProgress = 0;
            state.roll = baseRoll;
          } else {
            state.roll = baseRoll + rollDir * rollProgress * DEG;
          }
        } else {
          // --- Roll chases its target exponentially (time constant ~0.22 s)
          // instead of snapping at full rate: the bank builds up soft and
          // settles soft — that lag IS the inertia. The old rate cap stays
          // only as a guard for huge deflections.
          const targetRoll = stickRoll * fly.maxBank * DEG + gustRollT;
          const rollRate = fly.rollRate * DEG;
          const rollStep = (targetRoll - state.roll) * Math.min(1, dt / 0.22);
          state.roll += clamp(rollStep, -rollRate * dt, rollRate * dt);
        }

        // --- Turns: bank + speed set the turn rate. Slow + steep bank
        // turns tight, fast + shallow bank turns wide (coordinated turn).
        // Suppressed mid-roll: a bank near 90 degrees would otherwise
        // whip the heading around (tan of the roll blows up).
        if (state.speed > 1 && !rolling) {
          const turnRate = (GRAVITY_TURN * Math.tan(state.roll)) / state.speed;
          state.yaw -= turnRate * dt;
        }

        // --- Nose drop in a stall; the plane sinks while the wing is dead.
        if (state.stalled) {
          state.pitch = Math.max(state.pitch - fly.stallDropRate * DEG * dt, -28 * DEG);
        }

        // --- Vertical speed comes from the pitch attitude; a stall or a
        // dead engine adds sink on top, and the gusts breathe a little.
        let vy = state.speed * Math.sin(state.pitch);
        if (state.stalled) vy -= 4;
        if (state.gliding) vy -= fly.glideSink;
        vy += 0.5 * Math.sin(state.time * 1.1 + 0.6);
        // --- Ground effect: low over the runway the wing rides its own
        // cushion of air — a lift boost that fades out by ~12 m up.
        if (onRunwayRect(state.position.x, state.position.z)) {
          const agl = state.position.y - terrainHeightAt(state.position.x, state.position.z);
          if (agl < 12) {
            vy += fly.groundEffect * (1 - agl / 12);
          }
        }
        vy = clamp(vy, -26, 26);
        state.verticalSpeed = vy;

        // --- Move along the forward vector, plus wind drift sideways.
        const cp = Math.cos(state.pitch);
        const fx = -cp * Math.sin(state.yaw);
        const fz = -cp * Math.cos(state.yaw);
        state.position.x += fx * state.speed * dt;
        state.position.y += vy * dt;
        state.position.z += fz * state.speed * dt;
        if (state.wind > 0) {
          const gust = 0.6 + 0.4 * Math.sin(state.time * 1.7);
          state.position.x += state.wind * gust * dt;
          state.position.z += state.wind * 0.3 * Math.sin(state.time * 0.9) * dt;
        }
      } else {
        // --- On the ground: roll along the runway heading, nose level.
        state.pitch = 0;
        state.roll = 0;
        state.verticalSpeed = 0;
        const fx = -Math.sin(state.yaw);
        const fz = -Math.cos(state.yaw);
        state.position.x += fx * state.speed * dt;
        state.position.z += fz * state.speed * dt;
        state.position.y = terrainHeightAt(state.position.x, state.position.z);
        // Brakes: rolling resistance bleeds speed when the throttle is low.
        if (effectiveThrottle < 0.2) {
          state.speed = Math.max(0, state.speed - 10 * dt);
        }
        // Refuel while parked on the runway strip.
        if (onRunwayRect(state.position.x, state.position.z)) {
          state.fuel = Math.min(
            fuelCfg.capacity,
            state.fuel + fuelCfg.refuelRate * dt
          );
        }
        // --- Liftoff: past stall speed with the stick pulled, or once the
        // plane is simply going fast enough to rotate on its own.
        if (
          state.speed > fly.stallSpeed * 1.02 &&
          (pitchIn > 0.15 || state.speed > fly.cruiseSpeed)
        ) {
          state.status = 'flying';
          state.pitch = Math.max(state.pitch, 6 * DEG);
          state.position.y = terrainHeightAt(state.position.x, state.position.z) + 0.5;
        }
      }

      // --- Derived readouts for the HUD.
      state.altitude = state.position.y;
      state.bankDeg = state.roll / DEG;
      state.pitchDeg = state.pitch / DEG;
      const hx = -Math.cos(state.pitch) * Math.sin(state.yaw);
      const hz = Math.cos(state.pitch) * Math.cos(state.yaw);
      state.heading = (Math.atan2(hx, hz) * 180) / Math.PI;
      if (state.heading < 0) state.heading += 360;

      // --- Ground contact while airborne: touchdown or terrain hit.
      if (flying) {
        const groundY = terrainHeightAt(state.position.x, state.position.z);
        if (state.position.y <= groundY + 0.6) {
          flight.handleTouchdown(groundY);
        }
      }

      // --- A touchdown (or terrain hit) ends any roll in progress: the
      // plane is on the ground now, so the roll must not resume on the
      // next takeoff from a frozen mid-roll angle.
      if (rolling && state.status !== 'flying') {
        rolling = false;
        rollProgress = 0;
      }

      // --- Rings, checkpoints and fuel rings, only while airborne.
      if (state.status === 'flying') {
        flight.checkProximity(ringDefs, ringArmed, 'ring');
        flight.checkProximity(stormDefs, stormArmed, 'storm');
        flight.checkProximity(checkpointDefs, checkpointArmed, 'checkpoint');
        flight.checkProximity(fuelRingDefs, fuelArmed, 'fuel');
      }

      // --- Keep the visible model in step with the physics. Flaps drop
      // automatically at low speed (approach configuration) and retract
      // as the plane accelerates past 1.35x stall speed; on the ground
      // they sit flush.
      const flapDeploy = state.status === 'flying'
        ? clamp((fly.stallSpeed * 1.35 - state.speed) / (fly.stallSpeed * 0.35), 0, 1)
        : 0;
      if (aircraft) {
        if (aircraft.setThrottle) aircraft.setThrottle(state.throttle);
        // Yaw input is the bank itself: a coordinated turn carries the
        // rudder with it, so the tail works visibly in every turn.
        if (aircraft.update) aircraft.update(dt, { roll: stickRoll, pitch: stickPitch, flaps: flapDeploy, yaw: stickRoll, gear: state.gearDeploy });
      }
      flight.syncAircraft();
    },

    // Distance test against one list of ring/checkpoint definitions.
    checkProximity(defs, armed, kind) {
      const p = state.position;
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const dx = p.x - def.x;
        const dy = p.y - def.y;
        const dz = p.z - def.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < def.radius) {
          if (armed[i]) {
            armed[i] = false;
            if (kind === 'ring' && flight.onEvent.onRing) {
              flight.onEvent.onRing(i);
            } else if (kind === 'storm' && flight.onEvent.onStormRing) {
              flight.onEvent.onStormRing(i);
            } else if (kind === 'checkpoint' && flight.onEvent.onCheckpoint) {
              flight.onEvent.onCheckpoint(i);
            } else if (kind === 'fuel') {
              state.fuel = Math.min(
                fuelCfg.capacity,
                state.fuel + fuelCfg.fuelRingBonus
              );
              if (flight.onEvent.onFuelRing) flight.onEvent.onFuelRing(i);
            }
          }
        } else if (dist > def.radius * 2.5) {
          armed[i] = true;
        }
      }
    },

    // Called the moment the wheels (or belly) meet the ground in the air.
    handleTouchdown(groundY) {
      const p = state.position;
      const vs = Math.abs(state.verticalSpeed);
      const onStrip = onRunwayRect(p.x, p.z);
      const zone = inTouchdownZone(p.x, p.z);
      p.y = groundY + 0.6;

      if (onStrip) {
        // Belly landing: a gentle touchdown with the gear up still
        // damages the plane (gearDeploy < 0.5 = mostly retracted) —
        // treated as hard: damage, bounce, "Belly landing!" message.
        const belly =
          vs <= dmgCfg.gentleTouchdown && state.gearDeploy < 0.5;
        if (!belly && vs <= dmgCfg.gentleTouchdown) {
          // Gentle touchdown: safe landing, speed bleeds off on the strip.
          state.status = 'landed';
          state.speed *= 0.35;
          state.pitch = 0;
          state.roll = 0;
          if (flight.onEvent.onTouchdown) {
            flight.onEvent.onTouchdown({
              gentle: true,
              belly: false,
              inZone: zone,
              verticalSpeed: state.verticalSpeed,
              x: p.x,
              z: p.z,
            });
          }
          return;
        }
        // Hard or belly touchdown on the strip: damage, then bounce back up.
        const touchdownDamage = belly
          ? gearCfg.bellyDamage
          : dmgCfg.hardLandingDamage;
        state.damage = clamp(state.damage + touchdownDamage, 0, dmgCfg.maxDamage);
        if (flight.onEvent.onTouchdown) {
          flight.onEvent.onTouchdown({
            gentle: false,
            belly,
            inZone: zone,
            verticalSpeed: state.verticalSpeed,
            x: p.x,
            z: p.z,
          });
        }
        if (state.damage >= dmgCfg.maxDamage) {
          flight.crash('hard-landing');
          return;
        }
        state.position.y = groundY + 4;
        state.pitch = 10 * DEG;
        state.speed *= 0.55;
        return;
      }

      // Off the strip: terrain or water. A glancing clip costs damage and
      // bounces the plane back into the air; a wrecked plane crashes.
      state.damage = clamp(state.damage + dmgCfg.terrainHitDamage, 0, dmgCfg.maxDamage);
      if (flight.onEvent.onTerrainHit) {
        flight.onEvent.onTerrainHit({
          damage: state.damage,
          x: p.x,
          z: p.z,
          height: groundY,
        });
      }
      if (state.damage >= dmgCfg.maxDamage) {
        flight.crash('terrain');
        return;
      }
      state.position.y = groundY + 3;
      state.pitch = 12 * DEG;
      state.speed *= 0.5;
    },
  };

  flight.syncAircraft();
  return flight;
}
