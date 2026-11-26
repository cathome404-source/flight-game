// Garuda Skies — hangar screen: pick one of three aircraft, see its
// stats as bars, and read the dispatch board: a top-down archipelago
// map with the sortie route plus the pilot-medals row. Written fresh
// for R2-2 from the prose spec (dispatch-board pattern only — our own
// map, our own words, no copied names or layouts).
// The hangar is DOM over the live 3D scene: the selected plane sits
// parked on the tarmac behind the panel, so the model itself is the
// preview. No second renderer, no extra scene.

import { AIRCRAFT, AIRCRAFT_IDS, WORLD, REFIT_TRACKS } from './config.js';
import { refitLevels, priceFor, nextEffectText, effectiveStats } from './store.js';
import { SORTIES } from './campaign.js';

const BAR_LABELS = [
  ['speed', 'Kecepatan'],
  ['turn', 'Belok'],
  ['economy', 'Irit bahan bakar'],
  ['tank', 'Tangki'],
  ['tough', 'Tahan banting'],
];

// Livery swatches for the cards (the same colours the 3D model wears).
const SWATCH = {
  cendrawasih: ['#f3e2c0', '#2e8b8b'],
  rajawali: ['#f2ede4', '#c23b2e'],
  komodo: ['#d8c49a', '#6b7a3a'],
};

const MEDAL_SLOTS = 5;

// Project world metres onto the dispatch map (400 x 260, north up).
function mapX(x) {
  return ((x + 1700) / 3400) * 400;
}
function mapY(z) {
  return ((z + 1700) / 3400) * 260;
}

// The sortie route: one loop of the archipelago, home island first,
// far islands in campaign order, back home. The 12 sortie dots sit
// evenly along it.
const ROUTE = [
  { x: 0, z: 0 },
  { x: -1250, z: -350 },
  { x: 1150, z: -950 },
  { x: 950, z: 1150 },
  { x: -850, z: -1250 },
  { x: 0, z: 0 },
];

function routePoints(count) {
  const pts = ROUTE.map((p) => ({ x: mapX(p.x), y: mapY(p.z) }));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segs.push({ len, from: pts[i], to: pts[i + 1] });
    total += len;
  }
  const out = [];
  for (let n = 0; n < count; n++) {
    const target = (total * (n + 0.5)) / count;
    let acc = 0;
    for (const seg of segs) {
      if (acc + seg.len >= target || seg === segs[segs.length - 1]) {
        const f = seg.len > 0 ? Math.min(1, (target - acc) / seg.len) : 0;
        out.push({
          x: seg.from.x + (seg.to.x - seg.from.x) * f,
          y: seg.from.y + (seg.to.y - seg.from.y) * f,
        });
        break;
      }
      acc += seg.len;
    }
  }
  return { line: pts, dots: out };
}

function buildMapSvg() {
  const { line, dots } = routePoints(SORTIES.length);
  const lineAttr = line.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  let svg = '<svg viewBox="0 0 400 260" class="dispatch-map" role="img" aria-label="Peta kepulauan dengan rute sortie">';
  svg += '<rect x="0" y="0" width="400" height="260" class="map-sea"/>';
  for (const island of WORLD.islands) {
    const rx = (island.radius / 3400) * 400;
    const ry = (island.radius / 3400) * 260;
    svg += '<ellipse cx="' + mapX(island.x).toFixed(1) + '" cy="' + mapY(island.z).toFixed(1) +
      '" rx="' + Math.max(6, rx).toFixed(1) + '" ry="' + Math.max(5, ry).toFixed(1) +
      '" class="map-island"/>';
    svg += '<text x="' + mapX(island.x).toFixed(1) + '" y="' + (mapY(island.z) - 4).toFixed(1) +
      '" class="map-label">' + island.name + '</text>';
  }
  svg += '<polyline points="' + lineAttr + '" class="map-route"/>';
  // Home runway on Garuda island: the strip the sorties launch from.
  const rw = WORLD.runway;
  svg += '<rect x="' + mapX(rw.x - rw.length / 2).toFixed(1) + '" y="' + (mapY(rw.z) - 2).toFixed(1) +
    '" width="' + ((rw.length / 3400) * 400).toFixed(1) + '" height="4" class="map-runway"/>';
  dots.forEach((d, i) => {
    svg += '<circle cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1) + '" r="8" class="map-dot"/>';
    svg += '<text x="' + d.x.toFixed(1) + '" y="' + (d.y + 3.5).toFixed(1) + '" class="map-dot-num">' + (i + 1) + '</text>';
  });
  svg += '</svg>';
  return svg;
}

export function createHangar(opts) {
  const doc = (opts && opts.document) || document;
  const campaign = opts.campaign;
  const onSelect = opts.onSelect || (() => {});
  const root = doc.getElementById('screen-hangar');
  if (!root) return null;

  const coinsEl = doc.getElementById('hangar-coins');
  const cardsEl = doc.getElementById('hangar-cards');
  const statsEl = doc.getElementById('hangar-stats');
  const medalsEl = doc.getElementById('hangar-medals');
  const mapEl = doc.getElementById('hangar-map');
  const refitsEl = doc.getElementById('hangar-refits');
  const ledgerEl = doc.getElementById('hangar-ledger');
  const onRefit = opts.onRefit || (() => {});
  const onRepair = opts.onRepair || (() => {});
  const onRefuel = opts.onRefuel || (() => {});

  if (mapEl) mapEl.innerHTML = buildMapSvg();

  // One card per aircraft: name, role, livery swatches, stat bars.
  cardsEl.innerHTML = '';
  for (const id of AIRCRAFT_IDS) {
    const def = AIRCRAFT[id];
    const card = doc.createElement('div');
    card.className = 'hangar-card';
    card.dataset.aircraft = id;
    let bars = '';
    for (const [key, label] of BAR_LABELS) {
      const v = def.bars[key] || 0;
      bars += '<div class="stat-row"><span class="stat-label">' + label +
        '</span><span class="stat-bar"><span class="stat-fill" style="width:' + v + '%"></span></span>' +
        '<span class="stat-num">' + v + '</span></div>';
    }
    card.innerHTML =
      '<div class="hangar-card-head"><span class="hangar-name">' + def.name + '</span>' +
      '<span class="swatch" title="Livery"><i style="background:' + SWATCH[id][0] + '"></i>' +
      '<i style="background:' + SWATCH[id][1] + '"></i></span></div>' +
      '<div class="hangar-role">' + def.role + '</div>' + bars;
    card.addEventListener('click', () => onSelect(id));
    cardsEl.appendChild(card);
  }

  function refresh() {
    const selected = campaign ? campaign.aircraft : 'cendrawasih';
    const def = AIRCRAFT[selected] || AIRCRAFT.cendrawasih;
    for (const card of cardsEl.children) {
      card.classList.toggle('selected', card.dataset.aircraft === selected);
    }
    if (coinsEl && campaign) {
      coinsEl.textContent =
        '🪙 ' + campaign.coins + ' koin  ·  ' + campaign.completedCount + '/12 sortie selesai';
    }
    if (statsEl) {
      const tough = def.damageScale < 1
        ? 'tahan damage ' + Math.round((1 - def.damageScale) * 100) + '% lebih'
        : 'tahan damage standar';
      const lv0 = campaign ? refitLevels(campaign.save.refits, selected) : { engine: 0, tank: 0, flaps: 0 };
      const eff = effectiveStats(def, lv0);
      statsEl.textContent =
        def.name + ': top ' + Math.round(eff.maxSpeed * 3.6) + ' km/h · stall ' +
        Math.round(eff.stallSpeed * 3.6) + ' km/h · tangki ' + eff.capacity +
        ' · bakar ' + def.drainFullThrottle.toFixed(1) + '/dtk (penuh) · ' + tough +
        '  ·  Refit aktif: ENG ' + lv0.engine + ' · TNK ' + lv0.tank + ' · FLP ' + lv0.flaps;
    }
    // Refit shop: one row per track for the selected aircraft — level
    // pips, next-level effect + price, Buy button (disabled at max or
    // when the coins do not cover it). Buying retunes the plane live.
    if (refitsEl && campaign) {
      const lv = refitLevels(campaign.save.refits, selected);
      const coins = campaign.coins;
      let html = '';
      for (const track of Object.keys(REFIT_TRACKS)) {
        const def = REFIT_TRACKS[track];
        const level = lv[track];
        const price = priceFor(track, level);
        let pips = '';
        for (let i = 0; i < 3; i++) {
          pips += '<span class="refit-pip' + (i < level ? ' on' : '') + '">●</span>';
        }
        const maxed = price === null;
        const afford = !maxed && coins >= price;
        html += '<div class="refit-row"><span class="refit-name">' + def.name +
          '</span><span class="refit-pips">' + pips + '</span>' +
          '<span class="refit-desc">' + def.desc + '</span>' +
          '<button class="btn refit-buy" data-track="' + track + '"' +
          (maxed || !afford ? ' disabled' : '') + '>' +
          (maxed ? 'MAX' : 'Beli · ' + price + ' 🪙') + '</button></div>';
      }
      html += '<div class="refit-note">Harga level berikut: ' +
        Object.keys(REFIT_TRACKS).map((t) => REFIT_TRACKS[t].name + ' ' +
          (priceFor(t, lv[t]) === null ? 'MAX' : priceFor(t, lv[t]) + ' 🪙')).join(' · ') +
        '. Refit milik pesawat yang dipilih — ganti pesawat, refitnya beda.</div>';
      refitsEl.innerHTML = html;
      for (const btn of refitsEl.querySelectorAll('.refit-buy')) {
        btn.addEventListener('click', () => onRefit(btn.dataset.track));
      }
    }
    // Station ledger (Soundward pattern): fuel / hull / credits for
    // the selected aircraft, with free refuel and coin repair.
    if (ledgerEl && campaign) {
      const fuelPct = opts.fuelPercent ? Math.round(opts.fuelPercent()) : 100;
      const hull = campaign.hull;
      const missing = 100 - hull;
      const coins = campaign.coins;
      const repairCost = missing; // 1 koin per 1% hull
      const canRepair = missing > 0 && coins > 0;
      ledgerEl.innerHTML =
        '<div class="ledger-row"><span class="ledger-label">⛽ Bahan bakar</span>' +
        '<span class="ledger-bar"><span class="ledger-fill fuel" style="width:' + fuelPct + '%"></span></span>' +
        '<span class="ledger-num">' + fuelPct + '%</span>' +
        '<button class="btn ledger-btn" id="ledger-refuel">Isi Penuh · gratis</button></div>' +
        '<div class="ledger-row"><span class="ledger-label">🛠 Lambung (hull)</span>' +
        '<span class="ledger-bar"><span class="ledger-fill hull' + (hull < 50 ? ' low' : '') + '" style="width:' + hull + '%"></span></span>' +
        '<span class="ledger-num">' + hull + '%</span>' +
        '<button class="btn ledger-btn" id="ledger-repair"' + (canRepair ? '' : ' disabled') + '>' +
        (missing <= 0 ? 'Lambung mulus' : 'Perbaiki · ' + Math.min(repairCost, coins) + ' 🪙') + '</button></div>' +
        '<div class="ledger-row"><span class="ledger-label">🪙 Kredit</span>' +
        '<span class="ledger-num ledger-credits">' + coins + ' koin</span></div>' +
        '<div class="refit-note">Damage sortie mengurangi lambung dan bertahan sampai diperbaiki. ' +
        'Lambung rendah = pesawat lebih rapuh (damage masuk naik sampai +50% di 0%). ' +
        'Bahan bakar selalu penuh saat sortie dimulai dari hangar.</div>';
      const refuelBtn = ledgerEl.querySelector('#ledger-refuel');
      if (refuelBtn) refuelBtn.addEventListener('click', () => onRefuel());
      const repairBtn = ledgerEl.querySelector('#ledger-repair');
      if (repairBtn) repairBtn.addEventListener('click', () => onRepair());
    }
    if (medalsEl) {
      const medals = campaign ? campaign.save.medals : [];
      let html = '';
      for (let i = 0; i < MEDAL_SLOTS; i++) {
        const m = medals[i];
        html += '<span class="medal-slot' + (m ? ' earned' : '') + '" title="' +
          (m ? String(m.name || m) : 'Belum diraih') + '">' + (m ? '★' : '☆') + '</span>';
      }
      html += '<span class="medal-note">' +
        (medals.length > 0
          ? medals.length + ' medali pilot diraih.'
          : 'Belum ada medali — selesaikan sortie untuk meraih medali pilot pertama.') +
        '</span>';
      medalsEl.innerHTML = html;
    }
  }

  const api = {
    element: root,
    refresh,
    show() {
      refresh();
      root.classList.add('on');
    },
    hide() {
      root.classList.remove('on');
    },
  };
  return api;
}
