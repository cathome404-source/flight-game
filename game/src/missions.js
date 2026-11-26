// Garuda Skies — mission state machine: objectives, progress, score.
// Written fresh from the R2 prose spec. One generic engine drives all
// 11 playable campaign sorties: each mission def in config.js names its
// kind (takeoff / rings / tour / landing / rescue) and, for ring and
// checkpoint sorties, which WORLD list it flies (ringSet /
// checkpointSet). The flight module reports ring and checkpoint passes;
// this module only counts in-order progress for the active sortie.
// Best scores AND best times persist in localStorage (falling back to
// memory), and finishing a sortie unlocks the next one in order.

import { MISSIONS, FREE_FLIGHT, TUNING, WORLD } from './config.js';

const BEST_KEY = 'garuda-skies-best-scores';
const BEST_TIME_KEY = 'garuda-skies-best-times';
const UNLOCK_KEY = 'garuda-skies-unlocked';

// Flat points for finishing the Takeoff mission, which has no rings or
// checkpoints to count; every other mission scores from what it collects.
const TAKEOFF_POINTS = 300;
// Rescue pass limits: slower than 120 kt (61.7 m/s), lower than 60 m
// above the water, within 90 m of the boat.
const RESCUE_MAX_SPEED = 61.7;
const RESCUE_MAX_AGL = 60;
const RESCUE_RADIUS = 90;

let memoryBest = {};
let memoryBestTime = {};
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

function loadBestTime() {
  const stored = readStore(BEST_TIME_KEY, null);
  return stored && typeof stored === 'object' ? stored : memoryBestTime;
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
    checkpointsVisited: 0,
    visitedNames: [],
    landedGently: false,
    landedInZone: false,
    boatPass: false,
    unlocked: loadUnlocked(),
    best: loadBest(),
    bestTimes: loadBestTime(),
    failReason: null,

    // Completion / failure hooks; the game loop assigns these.
    onComplete: null,
    onFail: null,
    // Fired once when the rescue low pass over the boat is done.
    onBoatPass: null,

    // Start mission i (0..10) or 'free' for free flight. Locked missions
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
      api.checkpointsVisited = 0;
      api.visitedNames = [];
      api.landedGently = false;
      api.landedInZone = false;
      api.boatPass = false;
      api.failReason = null;
      if (flight && flight.reset) flight.reset();
      if (flight && flight.setWind) flight.setWind(def.wind || 0);
      if (flight && flight.setRefuelEnabled) {
        flight.setRefuelEnabled(def.allowRefuel !== false);
      }
      if (def.startFuel && flight && flight.state) {
        flight.state.fuel = Math.min(def.startFuel, flight.state.fuel);
      }
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
      if (def.kind === 'takeoff' && flight && flight.state) {
        if (flight.state.altitude >= def.targetAltitude) {
          api.complete('climbed');
          return;
        }
      }

      // Rescue: a slow, low pass over the stranded boat counts once.
      if (def.kind === 'rescue' && !api.boatPass && flight && flight.state) {
        const boat = cfgWorld.rescueBoat;
        const p = flight.state.position;
        if (boat && p) {
          const dx = p.x - boat.x;
          const dz = p.z - boat.z;
          const ground = flight.groundHeightAt
            ? flight.groundHeightAt(p.x, p.z)
            : 0;
          const agl = p.y - ground;
          if (
            Math.sqrt(dx * dx + dz * dz) < RESCUE_RADIUS &&
            agl < RESCUE_MAX_AGL &&
            flight.state.speed < RESCUE_MAX_SPEED
          ) {
            api.boatPass = true;
            if (api.onBoatPass) api.onBoatPass();
          }
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
      if (def.kind === 'takeoff') {
        points += TAKEOFF_POINTS;
      } else if (def.kind === 'rings') {
        points += api.ringsPassed * scoreCfg.ringPoints;
      } else if (def.kind === 'tour') {
        points += api.checkpointsVisited * scoreCfg.checkpointPoints;
      } else if (def.kind === 'landing' || def.kind === 'rescue') {
        if (api.landedGently) points += scoreCfg.landingPoints;
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
        const prevTime = api.bestTimes[def.id] || 0;
        if (prevTime === 0 || api.elapsed < prevTime) {
          api.bestTimes[def.id] = Math.round(api.elapsed * 10) / 10;
          memoryBestTime = api.bestTimes;
          writeStore(BEST_TIME_KEY, api.bestTimes);
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
      const left = def.timeLimit > 0
        ? ' — ' + Math.max(0, Math.ceil(def.timeLimit - api.elapsed)) + 's left'
        : '';
      if (def.kind === 'takeoff') {
        const alt = flight && flight.state ? Math.round(flight.state.altitude) : 0;
        return 'Lepas Landas — naik melewati 100 m. Sekarang ' + alt + ' m.';
      }
      if (def.kind === 'rings') {
        let line = def.name + ' — ring: ' + api.ringsPassed + '/' + def.ringCount + left + '.';
        if (def.id === 'crosswind') {
          line += ' Angin dari barat mendorong ke timur →';
        }
        if (def.id === 'chase') {
          const pct = def.timeLimit > 0
            ? Math.min(99, Math.round((api.elapsed / def.timeLimit) * 100))
            : 0;
          line += ' Target sudah ' + pct + '% jalan ke pulau jauh!';
        }
        if (def.id === 'timetrial') line += ' Tanpa refuel — hemat bahan bakar.';
        return line;
      }
      if (def.kind === 'tour') {
        const next = nextCheckpointName();
        return (
          def.name + ' — checkpoint: ' +
          api.checkpointsVisited + '/' + def.checkpointCount +
          (next ? ' — berikut: ' + next + '.' : '.') + left
        );
      }
      if (def.kind === 'landing') {
        return 'Mendarat Presisi — mendarat lembut di dalam zona touchdown kuning.';
      }
      if (def.kind === 'rescue') {
        if (!api.boatPass) {
          return 'Penyelamatan — lewat pelan di atas kapal (<120 kt, <60 m).' + left;
        }
        return 'Penyelamatan — kapal ditemukan! Sekarang mendarat di runway sebelum bahan bakar habis.' + left;
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
      if (def.kind === 'takeoff') {
        target = {
          x: cfgWorld.runway.x,
          y: def.targetAltitude + 30,
          z: cfgWorld.runway.z,
          label: 'Naik di atas 100 m',
        };
      } else if (def.kind === 'rings') {
        const set = ringSetFor(def);
        const ring = set ? set[api.ringsPassed] : null;
        if (ring) {
          target = { x: ring.x, y: ring.y, z: ring.z, label: 'Ring ' + (api.ringsPassed + 1) };
        }
      } else if (def.kind === 'tour') {
        const cp = nextCheckpoint();
        if (cp) {
          target = { x: cp.x, y: cp.y, z: cp.z, label: 'Checkpoint: ' + cp.name };
        }
      } else if (def.kind === 'landing') {
        const rw = cfgWorld.runway;
        target = {
          x: (rw.touchdownZoneStart + rw.touchdownZoneEnd) / 2,
          y: cfgWorld.runwayAltitude + 2,
          z: rw.z,
          label: 'Zona touchdown',
        };
      } else if (def.kind === 'rescue') {
        if (!api.boatPass) {
          const boat = cfgWorld.rescueBoat;
          if (boat) {
            target = { x: boat.x, y: 30, z: boat.z, label: 'Kapal terdampar' };
          }
        } else {
          const rw = cfgWorld.runway;
          target = {
            x: rw.x,
            y: cfgWorld.runwayAltitude + 2,
            z: rw.z,
            label: 'Mendarat di runway',
          };
        }
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

    // Best (fastest) completion time recorded for a mission id, or 0.
    bestTime(id) {
      return api.bestTimes[id] || 0;
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
    if (reason === 'time') return 'waktu habis';
    if (reason === 'crashed') return 'pesawat jatuh';
    return 'misi gagal';
  }

  // The WORLD ring list a ring sortie flies, or null.
  function ringSetFor(def) {
    if (!def || !def.ringSet) return null;
    const set = cfgWorld[def.ringSet];
    return Array.isArray(set) ? set : null;
  }

  // The WORLD checkpoint list a tour sortie flies, or null.
  function checkpointSetFor(def) {
    if (!def || !def.checkpointSet) return null;
    const set = cfgWorld[def.checkpointSet];
    return Array.isArray(set) ? set : null;
  }

  // First checkpoint the plane has not visited yet, in config order.
  function nextCheckpoint() {
    const defs = checkpointSetFor(api.current) || cfgWorld.checkpoints;
    for (let i = 0; i < defs.length; i++) {
      if (api.visitedNames.indexOf(defs[i].name) === -1) return defs[i];
    }
    return null;
  }

  function nextCheckpointName() {
    const cp = nextCheckpoint();
    return cp ? cp.name : null;
  }

  // Count one in-order ring pass; completes the sortie at the last ring.
  function countRing() {
    api.ringsPassed += 1;
    if (api.ringsPassed >= api.current.ringCount) {
      api.complete('rings');
    }
  }

  // Count one checkpoint visit (any order within the set is fine, each
  // name counts once); completes the sortie at the last checkpoint.
  function countCheckpoint(defs, index) {
    const def = defs ? defs[index] : null;
    if (!def) return;
    if (api.visitedNames.indexOf(def.name) === -1) {
      api.visitedNames.push(def.name);
      api.checkpointsVisited += 1;
      if (api.checkpointsVisited >= api.current.checkpointCount) {
        api.complete('tour');
      }
    }
  }

  // --- Flight events. Ring passes only count in order; a ring flown
  // out of order is ignored until its turn comes.
  if (flight && flight.onEvent) {
    flight.onEvent.onRing = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind !== 'rings' || api.current.ringSet !== 'rings') return;
      if (index === api.ringsPassed) countRing();
    };

    flight.onEvent.onStormRing = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind !== 'rings' || api.current.ringSet !== 'stormRings') return;
      if (index === api.ringsPassed) countRing();
    };

    flight.onEvent.onRingSet = function (setName, index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind !== 'rings' || api.current.ringSet !== setName) return;
      if (index === api.ringsPassed) countRing();
    };

    flight.onEvent.onCheckpoint = function (index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind !== 'tour' || api.current.checkpointSet !== 'checkpoints') return;
      countCheckpoint(cfgWorld.checkpoints, index);
    };

    flight.onEvent.onCheckpointSet = function (setName, index) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind !== 'tour' || api.current.checkpointSet !== setName) return;
      countCheckpoint(checkpointSetFor(api.current), index);
    };

    flight.onEvent.onTouchdown = function (info) {
      if (api.status !== 'active' || !api.current) return;
      if (api.current.kind === 'landing') {
        if (info.gentle && info.inZone) {
          api.landedGently = true;
          api.landedInZone = true;
          api.complete('landing');
        } else if (info.gentle) {
          // Safe landing but outside the painted zone: keep flying, the
          // mission is not failed — the pilot can take off and try again.
          api.landedGently = true;
        }
      } else if (api.current.kind === 'rescue') {
        if (info.gentle && api.boatPass) {
          api.landedGently = true;
          api.complete('rescue');
        }
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
