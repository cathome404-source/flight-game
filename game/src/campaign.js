// Garuda Skies — campaign: 12 sorties in 3 acts, unlock order, coins.
// Written fresh from the R2 prose spec. Sorties 1–12 map onto the
// playable missions in config.js; sortie 12 (Badai Leviathan) is the
// boss finale, wired to its storm mechanics in R2-4, and unlocks
// after sortie 11 is finished.
//
// THE SAVE (contract for later sessions — R2-5 refits, medals): one
// localStorage key holding exactly this shape:
//   { coins: number, medals: [], refits: {}, best: { <sortieId>: { score, time } },
//     aircraft: 'cendrawasih' | 'rajawali' | 'komodo', hull: 100 }
// medals and refits start empty; later sessions fill them. This module
// owns coins, best and aircraft (synced from the missions api / hangar);
// it never touches medals/refits beyond preserving them on every write,
// so a later session's data survives. Unlocks stay owned by missions.js.

import { MISSIONS } from './config.js';
import { buyRefit as storeBuyRefit, repairHull as storeRepairHull, applyHullDamage as storeApplyHullDamage, hullOf } from './store.js';

export const SAVE_KEY = 'garuda-skies-save-v1';
const LEGACY_COINS_KEY = 'garuda-skies-coins';

function emptySave() {
  return { coins: 0, medals: [], refits: {}, best: {}, aircraft: 'cendrawasih', hull: 100 };
}

export const AIRCRAFT_IDS = ['cendrawasih', 'rajawali', 'komodo'];

function validAircraftId(v) {
  return AIRCRAFT_IDS.includes(v) ? v : 'cendrawasih';
}

// The selected aircraft, read straight from storage (no missions
// needed) — main.js boots the 3D model from this before the campaign
// object exists.
export function selectedAircraftId() {
  const raw = readSaveRaw();
  return raw ? validAircraftId(raw.aircraft) : 'cendrawasih';
}

function readSaveRaw() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch (err) {
    // Storage unavailable or corrupt: start from an empty save.
  }
  return null;
}

function readLegacyCoins() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LEGACY_COINS_KEY);
      const v = raw === null ? 0 : JSON.parse(raw);
      if (typeof v === 'number' && v >= 0) return v;
    }
  } catch (err) {
    // Ignore: the unified save starts from zero.
  }
  return 0;
}

// Load the save, normalising the shape; a missing unified save is
// seeded once from the legacy coin key so older progress is kept.
function readSave(missions) {
  const raw = readSaveRaw();
  const save = emptySave();
  if (raw) {
    if (typeof raw.coins === 'number' && raw.coins >= 0) save.coins = raw.coins;
    if (Array.isArray(raw.medals)) save.medals = raw.medals;
    if (raw.refits && typeof raw.refits === 'object') save.refits = raw.refits;
    if (raw.best && typeof raw.best === 'object') save.best = raw.best;
    save.aircraft = validAircraftId(raw.aircraft);
    if (typeof raw.hull === 'number') save.hull = hullOf(raw);
    return save;
  }
  save.coins = readLegacyCoins();
  if (missions) syncBestInto(save, missions);
  return save;
}

// Copy best score/time per sortie from the missions api into a save.
function syncBestInto(save, missions) {
  if (!missions) return;
  for (const def of MISSIONS) {
    const score = missions.bestScore ? missions.bestScore(def.id) : 0;
    if (score > 0) {
      save.best[def.id] = {
        score,
        time: missions.bestTime ? missions.bestTime(def.id) || 0 : 0,
      };
    }
  }
}

// Persist the save, re-reading first so medals/refits written by a
// later session are never clobbered by this session's older copy.
function writeSave(save) {
  try {
    if (typeof localStorage !== 'undefined') {
      const fresh = readSaveRaw();
      if (fresh) {
        // Merge, never clobber: this session's refits win per aircraft,
        // fresh ones for other aircraft survive; medals union by value.
        if (fresh.refits && typeof fresh.refits === 'object') {
          const merged = { ...fresh.refits };
          for (const k of Object.keys(save.refits || {})) merged[k] = save.refits[k];
          save.refits = merged;
        }
        if (Array.isArray(fresh.medals)) {
          const seen = new Set(save.medals.map((m) => JSON.stringify(m)));
          for (const m of fresh.medals) {
            if (!seen.has(JSON.stringify(m))) save.medals.push(m);
          }
        }
        // aircraft is NOT re-read here: the campaign owns it in memory
        // (the hangar writes through setAircraft), and a stale stored
        // copy must never undo a fresh selection.
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    }
  } catch (err) {
    // Storage unavailable: the memory copy still holds the value.
  }
}

export const ACTS = [
  { id: 'act1', name: 'Sayap Pertama', note: 'Latihan — golden hour, tenang' },
  { id: 'act2', name: 'Angin Nusantara', note: 'Lebih sulit — senja, berangin' },
  { id: 'act3', name: 'Badai', note: 'Badai — malam/senja, tersulit' },
];

// One row per sortie: act (0..2), the playable mission id, the
// Indonesian name, the short objective shown in the menu, the coin
// reward and the target score.
export const SORTIES = [
  { n: 1, act: 0, missionId: 'takeoff', name: 'Lepas Landas', objective: 'Naik melewati 100 m.', coins: 100, targetScore: 300 },
  { n: 2, act: 0, missionId: 'rings', name: 'Lingkaran Pertama', objective: '8 ring sesuai urutan.', coins: 120, targetScore: 2200 },
  { n: 3, act: 0, missionId: 'tour', name: 'Tur Keliling Pulau', objective: '3 checkpoint di atas pulau jauh.', coins: 150, targetScore: 1500 },
  { n: 4, act: 0, missionId: 'landing', name: 'Mendarat Presisi', objective: 'Mendarat lembut di zona kuning.', coins: 150, targetScore: 600 },
  { n: 5, act: 1, missionId: 'crosswind', name: 'Selat Berangin', objective: '6 ring melawan angin samping.', coins: 150, targetScore: 1800 },
  { n: 6, act: 1, missionId: 'chase', name: 'Kejar Bayangan', objective: 'Kejar target lewat 5 gate.', coins: 200, targetScore: 1600 },
  { n: 7, act: 1, missionId: 'canyon', name: 'Ngarai Sempit', objective: '6 ring rendah di antara gunung.', coins: 200, targetScore: 1800 },
  { n: 8, act: 1, missionId: 'night', name: 'Malam di Atas Laut', objective: '4 checkpoint di malam hari.', coins: 250, targetScore: 1900 },
  { n: 9, act: 2, missionId: 'storm', name: 'Badai Datang', objective: '6 ring melawan waktu di badai.', coins: 250, targetScore: 1800 },
  { n: 10, act: 2, missionId: 'rescue', name: 'Penyelamatan', objective: 'Lewat pelan di atas kapal, lalu mendarat.', coins: 300, targetScore: 1200 },
  { n: 11, act: 2, missionId: 'timetrial', name: 'Ujian Waktu', objective: '10 ring, jam ketat, tanpa refuel.', coins: 350, targetScore: 2800 },
  { n: 12, act: 2, missionId: 'boss', name: 'Badai Leviathan', objective: 'Finale: 8 ring badai di tengah sel badai. Selesaikan sortie 11 untuk membuka.', coins: 500, targetScore: 3500 },
];

// Mission index (into MISSIONS) for a sortie number, or -1 for the boss.
export function missionIndexForSortie(n) {
  const sortie = SORTIES.find((s) => s.n === n);
  if (!sortie || !sortie.missionId) return -1;
  return MISSIONS.findIndex((m) => m.id === sortie.missionId);
}

// The campaign store: coin balance plus a read-through view of the
// missions api (best scores, unlocks, completion). The unified save is
// the contract shape other sessions read; awarding coins is the only
// write this session makes, and it syncs bests into the save too.
export function createCampaign(missions) {
  const save = readSave(missions);

  const api = {
    sorties: SORTIES,
    acts: ACTS,

    get coins() {
      return save.coins;
    },

    // Selected aircraft id; the hangar writes through setAircraft.
    get aircraft() {
      return save.aircraft;
    },

    setAircraft(id) {
      const next = validAircraftId(id);
      if (next === save.aircraft) return false;
      save.aircraft = next;
      writeSave(save);
      return true;
    },

    // The whole save, in contract shape (a copy — mutate through
    // award/syncBest/setAircraft, never by editing this object).
    get save() {
      return {
        coins: save.coins,
        medals: save.medals.slice(),
        refits: JSON.parse(JSON.stringify(save.refits)),
        best: JSON.parse(JSON.stringify(save.best)),
        aircraft: save.aircraft,
        hull: hullOf(save),
      };
    },

    // Hull condition 0..100: persists between sorties until repaired.
    get hull() {
      return hullOf(save);
    },

    // Buy the next refit level for the selected aircraft. Returns the
    // price paid, or null when maxed or unaffordable.
    buyRefit(track) {
      const paid = storeBuyRefit(save, save.aircraft, track);
      if (paid !== null) writeSave(save);
      return paid;
    },

    // Repair the hull (1 coin per 1% restored, partial when broke).
    // Returns { restored, cost }.
    repair() {
      const res = storeRepairHull(save);
      if (res.cost > 0) writeSave(save);
      return res;
    },

    // Subtract sortie damage from the hull; it stays until repaired.
    applyHullDamage(damage) {
      const lost = storeApplyHullDamage(save, damage);
      if (lost > 0) writeSave(save);
      return lost;
    },

    // Re-sync best score/time from the missions api into the save.
    syncBest() {
      syncBestInto(save, missions);
      writeSave(save);
    },

    // Sortie n (1..12) may be started when every earlier sortie is
    // done. The boss (12) opens once sortie 11 is finished, like any
    // other sortie — its mission now exists (R2-4).
    isUnlocked(n) {
      if (n <= 1) return true;
      const idx = missionIndexForSortie(n);
      if (idx < 0) return false;
      return missions ? missions.isUnlocked(idx) : false;
    },

    // Best score / time for a sortie, from the missions store.
    bestFor(n) {
      const sortie = SORTIES[n - 1];
      if (!sortie || !sortie.missionId || !missions) return { score: 0, time: 0 };
      return {
        score: missions.bestScore(sortie.missionId),
        time: missions.bestTime ? missions.bestTime(sortie.missionId) : 0,
      };
    },

    // How far the player has got: number of sorties finished.
    get completedCount() {
      let done = 0;
      for (const s of SORTIES) {
        if (s.missionId && missions && missions.bestScore(s.missionId) > 0) done += 1;
      }
      return done;
    },

    // Award a pilot medal (debrief, R2-5b). Medals are objects
    // { id, name, sortie }; the same id is never awarded twice.
    // Returns true when the medal is new.
    awardMedal(medal) {
      if (!medal || !medal.id) return false;
      if (save.medals.some((m) => m && (m.id === medal.id || m === medal.id))) {
        return false;
      }
      save.medals.push(medal);
      writeSave(save);
      return true;
    },

    // Pay out a finished sortie's coins once, when missions reports
    // the completion. Returns the coins actually awarded (0 when the
    // completion carried no sortie, e.g. free flight).
    award(info) {
      if (!info || !info.mission) return 0;
      const sortie = SORTIES.find((s) => s.missionId === info.mission.id);
      if (!sortie) return 0;
      save.coins += sortie.coins;
      syncBestInto(save, missions);
      writeSave(save);
      return sortie.coins;
    },
  };

  return api;
}
