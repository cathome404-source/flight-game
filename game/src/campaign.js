// Garuda Skies — campaign: 12 sorties in 3 acts, unlock order, coins.
// Written fresh from the R2 prose spec. Sorties 1–11 map onto the
// playable missions in config.js; sortie 12 (Badai Leviathan) is DATA
// ONLY here — its storm mechanics are built in R2-4, so it stays locked
// until sortie 11 is finished and can never be started from this file.
//
// THE SAVE (contract for later sessions — R2-5 refits, medals): one
// localStorage key holding exactly this shape:
//   { coins: number, medals: [], refits: {}, best: { <sortieId>: { score, time } } }
// medals and refits start empty; later sessions fill them. This module
// owns coins and best (synced from the missions api); it never touches
// medals/refits beyond preserving them on every write, so a later
// session's data survives. Unlocks stay owned by missions.js.

import { MISSIONS } from './config.js';

export const SAVE_KEY = 'garuda-skies-save-v1';
const LEGACY_COINS_KEY = 'garuda-skies-coins';

function emptySave() {
  return { coins: 0, medals: [], refits: {}, best: {} };
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
        if (Array.isArray(fresh.medals)) save.medals = fresh.medals;
        if (fresh.refits && typeof fresh.refits === 'object') save.refits = fresh.refits;
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

// One row per sortie: act (0..2), the playable mission id (null for the
// boss, which has no mission yet), the Indonesian name, the short
// objective shown in the menu, the coin reward and the target score.
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
  // Boss finale — data only. No mission id, no mechanics: R2-4 builds it.
  { n: 12, act: 2, missionId: null, name: 'Badai Leviathan', objective: 'Finale: 8 ring badai di tengah sel badai. Selesaikan sortie 11 untuk membuka.', coins: 500, targetScore: 3500 },
];

// Mission index (into MISSIONS) for a sortie number, or -1 for the boss.
export function missionIndexForSortie(n) {
  const sortie = SORTIES.find((s) => s.n === n);
  if (!sortie || !sortie.missionId) return -1;
  return MISSIONS.findIndex((m) => m.id === sortie.missionId);
}

function readCoins() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(COINS_KEY);
      const v = raw === null ? 0 : JSON.parse(raw);
      if (typeof v === 'number' && v >= 0) return v;
    }
  } catch (err) {
    // Storage unavailable or corrupt: start from zero in memory.
  }
  return 0;
}

function writeCoins(value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COINS_KEY, JSON.stringify(value));
    }
  } catch (err) {
    // Storage unavailable: the memory copy still holds the value.
  }
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

    // The whole save, in contract shape (a copy — mutate through
    // award/syncBest, never by editing this object).
    get save() {
      return {
        coins: save.coins,
        medals: save.medals.slice(),
        refits: { ...save.refits },
        best: JSON.parse(JSON.stringify(save.best)),
      };
    },

    // Re-sync best score/time from the missions api into the save.
    syncBest() {
      syncBestInto(save, missions);
      writeSave(save);
    },

    // Sortie n (1..12) may be started when every earlier sortie is
    // done. The boss (12) additionally needs a real mission, which
    // does not exist yet — it is never startable from this session.
    isUnlocked(n) {
      if (n <= 1) return true;
      if (n === 12) return false;
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
