// Garuda Skies — mission state machine: objectives, progress, score.
// Written fresh from the prose spec. Wires into the flight events
// (rings, checkpoints, touchdowns) and reports the next target for the
// HUD arrow. Best scores and unlock progress persist in localStorage
// when it exists and fall back to memory otherwise.

import { MISSIONS, FREE_FLIGHT, TUNING, WORLD } from './config.js';

const BEST_KEY = 'garuda-skies-best-scores';
const UNLOCK_KEY = 'garuda-skies-unlocked';

// Flat points for finishing the Takeoff mission, which has no rings or
// checkpoints to count; every other mission scores from what it collects.
const TAKEOFF_POINTS = 300;

let memoryBest = {};
let memoryUnlocked = 0;

function readStore(key, fallback) {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw);
    }
  } catch (err) {
    // Storage unavailable or corrupt: fall back to memory.
  }
  return fallback;
}

function writeStore(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (err) {
    // Storage unavailable: the memory copy still holds the value.
  }
}

function loadBest() {
  const stored = readStore(BEST_KEY, null);
  return stored && typeof stored === 'object' ? stored : memoryBest;
}

function loadUnlocked() {
  const stored = readStore(UNLOCK_KEY, null);
  if (typeof stored === 'number') return stored;
  return memoryUnlocked;
}

export function createMissions(flight, world, config) {
  const missionList = (config && config.MISSIONS) || MISSIONS;
  const freeFlight = (config && config.FREE_FLIGHT) || FREE_FLIGHT;
  const tune = (config && config.TUNING) || TUNING;
  const cfgWorld = (config && config.WORLD) || WORLD;
  const scoreCfg = tune.scoring;

  const api = {
    current: null,
    index: -1,
    status: 'idle', // idle | active | complete | failed
    elapsed: 0,
    score: 0,
    ringsPassed: 0,
    stormPassed: 0,
    checkpointsVisited: 0,
    visitedNames: [],
    landedGently: false,
    landedInZone: false,
    unlocked: loadUnlocked(),
    best: loadBest(),
    failReason: null,

    // Completion / failure hooks; the game loop assigns these.
    onComplete: null,
    onFail: null,

    // Start mission i (0..4) or 'free' for free flight. Locked missions
    // refuse to start until the previous one is finished.
    start(i) {
      let def;
      let idx;
      if (i === 'free' || i === freeFlight.id) {
        def = freeFlight;
        idx = -1;
      } else {
        idx = i;
        def = missionList[idx];
        if (!def) return false;
        if (idx > api.unlocked) return false;
      }
      api.current = def;
      api.index = idx;
      api.status = 'active';
      api.elapsed = 0;
      api.score = 0;
      api.ringsPassed = 0;
      api.stormPassed = 0;
      api.checkpointsVisited = 0;
      api.visitedNames = [];
      api.landedGently = false;
      api.landedInZone = false;
      api.failReason = null;
      if (flight && flight.reset) flight.reset();
      if (flight && flight.setWind) flight.setWind(def.wind || 0);
      return true;
    },

    // Restart the mission that is currently selected.
    restart() {
      if (api.index >= 0) return api.start(api.index);
      if (api.current && api.current.id === freeFlight.id) return api.start('free');
      return false;
    },

    update(dt) {
      if (api.status !== 'active' || !api.current) return;
      dt = Math.min(dt, 0.05);
      api.elapsed += dt;
      const def = api.current;

      // Storm Run: the wind keeps building until the time limit.
      if (def.id === 'storm' && flight && flight.setWind) {
        const ramp = def.timeLimit > 0 ? clamp01(api.elapsed / def.timeLimit) : 1;
        flight.setWind((def.wind || 0) * (0.4 + 0.6 * ramp));
      }

      // Takeoff completes the moment the plane climbs past the target.
      if (def.id === 'takeoff' && flight && flight.state) {
        if (flight.state.altitude >= def.targetAltitude) {
          api.complete('climbed');
          return;
        }
      }

      // A crash ends any mission in failure.
      if (flight && flight.state && flight.state.status === 'crashed') {
        api.fail('crashed');
        return;
      }

      // Running out of time ends the mission in failure.
      if (def.timeLimit > 0 && api.elapsed >= def.timeLimit) {
        api.fail('time');
      }
    },

    // Score the finished mission, save the best, unlock the next one.
    complete(reason) {
      if (api.status !== 'active') return;
      const def = api.current;
      let points = 0;
      if (def.id === 'takeoff') {
        points += TAKEOFF_POINTS;
      } else if (def.id === 'rings') {
        points += api.ringsPassed * scoreCfg.ringPoints;
      } else if (def.id === 'tour') {
        points += api.checkpointsVisited * scoreCfg.checkpointPoints;
      } else if (def.id === 'landing') {
        if (api.landedGently) points += scoreCfg.landingPoints;
      } else if (def.id === 'storm') {
        points += api.stormPassed * scoreCfg.ringPoints;
      }
      if (def.parTime) {
        const under = def.parTime - api.elapsed;
        if (under > 0) points += Math.round(under * scoreCfg.timeBonusPerSecond);
      }
      api.score = points;
      api.status = 'complete';

      let newBest = false;
      if (def.id !== freeFlight.id) {
        const prev = api.best[def.id] || 0;
        if (points > prev) {
          api.best[def.id] = points;
          memoryBest = api.best;
          writeStore(BEST_KEY, api.best);
          newBest = true;
        }
        if (api.index >= 0 && api.index + 1 > api.unlocked) {
          api.unlocked = Math.min(api.index + 1, missionList.length - 1);
          memoryUnlocked = api.unlocked;
          writeStore(UNLOCK_KEY, api.unlocked);
        }
      }

      if (api.onComplete) {
        api.onComplete({
          mission: def,
          reason: reason || 'done',
          score: points,
          time: api.elapsed,
          best: api.best[def.id] || points,
          newBest,
          unlocked: api.unlocked,
        });
      }
    },

    fail(reason) {
      if (api.status !== 'active') return;
      api.status = 'failed';
      api.failReason = reason || 'failed';
      if (api.onFail) {
        api.onFail({
          mission: api.current,
          reason: api.failReason,
          time: api.elapsed,
          score: api.score,
        });
      }
    },

    // One line for the HUD: objective plus live progress.
    objectiveText() {
      if (!api.current) return 'Choose a mission from the menu.';
      const def = api.current;
      if (api.status === 'complete') {
        return def.name + ' complete! Score ' + api.score + '.';
      }
      if (api.status === 'failed') {
        return def.name + ' failed — ' + failText(api.failReason) + ' Press R to retry.';
      }
      if (def.id === freeFlight.id) return def.objective;
      if (def.id === 'takeoff') {
        const alt = flight && flight.state ? Math.round(flight.state.altitude) : 0;
        return 'Takeoff — climb past 100 m. Now ' + alt + ' m.';
      }
      if (def.id === 'rings') {
        return 'Ring Run — fly through the rings: ' + api.ringsPassed + '/' + def.ringCount + '.';
      }
      if (def.id === 'tour') {
        const next = nextCheckpointName();
        return (
          'Island Tour — checkpoints: ' +
          api.checkpointsVisited +
          '/' +
          def.checkpointCount +
          (next ? ' — next: ' + next + '.' : '.')
        );
      }
      if (def.id === 'landing') {
        return 'Precision Landing — land gently inside the yellow touchdown zone.';
      }
      if (def.id === 'storm') {
        const left = Math.max(0, Math.ceil((def.timeLimit || 0) - api.elapsed));
        return 'Storm Run — rings: ' + api.stormPassed + '/' + def.ringCount + ' — ' + left + 's left.';
      }
      return def.objective;
    },

    // The next target for the HUD arrow: world position, distance and label.
    // Null when there is no next target (free flight, finished mission).
    targetMarker() {
      if (!api.current || api.status !== 'active') return null;
      const def = api.current;
      const p = flight && flight.state ? flight.state.position : null;
      if (!p) return null;

      let target = null;
      if (def.id === 'takeoff') {
        target = {
          x: cfgWorld.runway.x,
          y: def.targetAltitude + 30,
          z: cfgWorld.runway.z,
          label: 'Climb above 100 m',
        };
      } else if (def.id === 'rings') {
        const ring = cfgWorld.rings[api.ringsPassed];
        if (ring) {
          target = { x: ring.x, y: ring.y, z: ring.z, label: 'Ring ' + (api.ringsPassed + 1) };
        }
      } else if (def.id === 'storm') {
        const ring = cfgWorld.stormRings[api.stormPassed];
        if (ring) {
          target = { x: ring.x, y: ring.y, z: ring.z, label: 'Storm ring ' + (api.stormPassed + 1) };
        }
      } else if (def.id === 'tour') {
        const cp = nextCheckpoint();
        if (cp) {
          target = { x: cp.x, y: cp.y, z: cp.z, label: 'Checkpoint: ' + cp.name };
        }
      } else if (def.id === 'landing') {
        const rw = cfgWorld.runway;
        target = {
          x: (rw.touchdownZoneStart + rw.touchdownZoneEnd) / 2,
          y: cfgWorld.runwayAltitude + 2,
          z: rw.z,
          label: 'Touchdown zone',
        };
      }
      if (!target) return null;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dz = target.z - p.z;
      target.distance = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
      return target;
    },

    // Best score recorded for a mission id, or 0.
    bestScore(id) {
      return api.best[id] || 0;
    },

    // True when mission i may be started (unlocked by finishing i - 1).
    isUnlocked(i) {
      return i <= api.unlocked;
    },
  };

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function failText(reason) {
    if (reason === 'time') return 'time ran out';
    if (reason === 'crashed') return 'the plane crashed';
    return 'mission failed';
  }

  // First checkpoint the plane has not visited yet, in config order.
  function nextCheckpoint() {
    const defs = cfgWorld.checkpoints;
    for (let i = 0; i < defs.length; i++) {
      if (api.visitedNames.indexOf(defs[i].name) === -1) return defs[i];
    }
    return null;
  }

  function nextCheckpointName() {
    const cp = nextCheckpoint();
    return cp ? cp.name : null;
  }

  // --- Flight events. The mission only counts in-order progress; a ring
  // flown out of order is ignored until its turn comes.
  if (flight && flight.onEvent) {
    flight.onEvent.onRing = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.id !== 'rings') return;
      if (index === api.ringsPassed) {
        api.ringsPassed += 1;
        if (api.ringsPassed >= api.current.ringCount) {
          api.complete('rings');
        }
      }
    };

    flight.onEvent.onStormRing = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.id !== 'storm') return;
      if (index === api.stormPassed) {
        api.stormPassed += 1;
        if (api.stormPassed >= api.current.ringCount) {
          api.complete('storm-rings');
        }
      }
    };

    flight.onEvent.onCheckpoint = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.id !== 'tour') return;
      const def = cfgWorld.checkpoints[index];
      if (!def) return;
      if (api.visitedNames.indexOf(def.name) === -1) {
        api.visitedNames.push(def.name);
        api.checkpointsVisited += 1;
        if (api.checkpointsVisited >= api.current.checkpointCount) {
          api.complete('tour');
        }
      }
    };

    flight.onEvent.onTouchdown = function (info) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.id !== 'landing') return;
      if (info.gentle && info.inZone) {
        api.landedGently = true;
        api.landedInZone = true;
        api.complete('landing');
      } else if (info.gentle) {
        // Safe landing but outside the painted zone: keep flying, the
        // mission is not failed — the pilot can take off and try again.
        api.landedGently = true;
      }
    };

    // A hard landing or terrain hit never completes a mission by itself;
    // the crash check in update() handles the failure case.
    flight.onEvent.onCrash = function () {
      if (api.status === 'active') api.fail('crashed');
    };
  }

  return api;
}
