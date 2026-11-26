// Garuda Skies — hangar store: refit shop + station ledger math.
// Written fresh from the prose spec (R2-5). Coins earned in the campaign
// buy per-aircraft upgrades; every upgrade changes the numbers the
// flight model actually flies with (flight.js reads effectiveStats).
// Prices rise per level but level 1 is cheap on purpose: with ~2220
// coins for a full campaign, a pilot should feel the first upgrade
// after two or three sorties, not after finishing the game.

import { REFIT_TRACKS } from './config.js';

export const MAX_REFIT_LEVEL = 3;

// Level table for one aircraft: { engine: 0..3, tank: 0..3, flaps: 0..3 }.
// Missing keys read as 0, so old saves (refits: {}) just work.
export function refitLevels(refits, aircraftId) {
  const all = refits && typeof refits === 'object' ? refits : {};
  const one = all[aircraftId] && typeof all[aircraftId] === 'object' ? all[aircraftId] : {};
  const out = {};
  for (const track of Object.keys(REFIT_TRACKS)) {
    const v = one[track];
    out[track] = typeof v === 'number' ? Math.max(0, Math.min(MAX_REFIT_LEVEL, Math.floor(v))) : 0;
  }
  return out;
}

// Price of the NEXT level of a track (null when already maxed).
export function priceFor(track, level) {
  const def = REFIT_TRACKS[track];
  if (!def) return null;
  if (level >= MAX_REFIT_LEVEL) return null;
  return def.prices[level];
}

// One-line human effect of the next level, shown on the buy button.
export function nextEffectText(track, level) {
  const def = REFIT_TRACKS[track];
  if (!def || level >= MAX_REFIT_LEVEL) return 'MAX';
  return def.effectText;
}

// Can this save afford the next level of this track on this aircraft?
export function canBuy(save, aircraftId, track) {
  if (!save || typeof save.coins !== 'number') return false;
  const levels = refitLevels(save.refits, aircraftId);
  const price = priceFor(track, levels[track]);
  return price !== null && save.coins >= price;
}

// Buy the next level: deducts coins, bumps the level, returns the
// price paid, or null when the purchase is not possible (maxed or
// broke). The caller owns persisting the save (campaign.buyRefit).
export function buyRefit(save, aircraftId, track) {
  if (!save || !REFIT_TRACKS[track]) return null;
  if (!save.refits || typeof save.refits !== 'object') save.refits = {};
  const levels = refitLevels(save.refits, aircraftId);
  const price = priceFor(track, levels[track]);
  if (price === null || save.coins < price) return null;
  save.coins -= price;
  const one = { ...levels, [track]: levels[track] + 1 };
  save.refits = { ...save.refits, [aircraftId]: one };
  return price;
}

// Effective flight stats for one aircraft after its refits. Base is the
// AIRCRAFT[aircraftId] block; every level adds its bonus on top:
//   engine: +6 m/s top speed and +0.8 m/s^2 throttle accel per level.
//   tank:   +20 fuel capacity per level.
//   flaps:  -2 m/s stall speed and +5 deg/s roll rate per level
//           (lower stall = gentler landings, tighter low-speed turn).
export function effectiveStats(base, levels) {
  const lv = levels || { engine: 0, tank: 0, flaps: 0 };
  const eng = lv.engine || 0;
  const tnk = lv.tank || 0;
  const flp = lv.flaps || 0;
  return {
    ...base,
    maxSpeed: base.maxSpeed + 6 * eng,
    throttleAccel: base.throttleAccel + 0.8 * eng,
    capacity: base.capacity + 20 * tnk,
    stallSpeed: Math.max(12, base.stallSpeed - 2 * flp),
    rollRate: base.rollRate + 5 * flp,
  };
}

// ---- Station ledger (Soundward pattern, our own numbers) ----
// Hull 0..100 persists in the save (save.hull, default 100). Damage
// taken in a sortie is subtracted from the hull when the sortie ends;
// it stays subtracted until repaired — a battered plane flies on
// battered, it does not heal between sorties.
// Repair costs 1 coin per 1% of hull restored (cheap on purpose: a
// repair must never punish a pilot for flying). If the pilot cannot
// afford a full repair, the coins they have buy a partial one.
// A low hull makes the plane more fragile: incoming damage is scaled
// by (1 + (100 - hull) / 200), so at 50% hull every hit hurts 25%
// more, and at 0% hull 50% more. Refuel is free in the hangar — the
// tank is always full when a sortie starts from the hangar.
export const REPAIR_COST_PER_HULL = 1;

export function hullOf(save) {
  if (!save || typeof save.hull !== 'number') return 100;
  return Math.max(0, Math.min(100, Math.floor(save.hull)));
}

// Coins a full repair would cost right now (0 at full hull).
export function repairCost(save) {
  return (100 - hullOf(save)) * REPAIR_COST_PER_HULL;
}

// Repair as much as the coins allow; returns { restored, cost }.
export function repairHull(save) {
  if (!save || typeof save.coins !== 'number') return { restored: 0, cost: 0 };
  const missing = 100 - hullOf(save);
  if (missing <= 0 || save.coins <= 0) return { restored: 0, cost: 0 };
  const restored = Math.min(missing, Math.floor(save.coins / REPAIR_COST_PER_HULL));
  const cost = restored * REPAIR_COST_PER_HULL;
  save.coins -= cost;
  save.hull = hullOf(save) + restored;
  return { restored, cost };
}

// Subtract sortie damage from the hull (clamped at 0). Returns the
// hull lost.
export function applyHullDamage(save, damage) {
  if (!save || !(damage > 0)) return 0;
  const before = hullOf(save);
  const after = Math.max(0, before - Math.round(damage));
  save.hull = after;
  return before - after;
}

// Damage multiplier for a given hull: 1.0 at full hull, 1.5 at 0 hull.
export function hullDamageFactor(hull) {
  const h = typeof hull === 'number' ? Math.max(0, Math.min(100, hull)) : 100;
  return 1 + (100 - h) / 200;
}
