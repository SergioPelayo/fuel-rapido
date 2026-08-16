/* ============================================================
   Fuel Rápido — app.js
   Precios oficiales del Ministerio para la Transición Ecológica.
   Sin claves de API, sin backend, sin dependencias obligatorias.
   ============================================================ */

'use strict';

/* ---------- 1. Configuración ---------- */

const API_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

// Orígenes de datos, en orden de preferencia:
//   1. El Ministerio directamente (lo más fresco).
//   2. El snapshot que este mismo repositorio captura cada hora — mismo origen,
//      así que nunca falla por CORS. Requiere tener activo el workflow snapshot.yml.
//   3. Reenviadores públicos y gratuitos, por si lo anterior falla.
const SOURCES = [
  { name: 'ministerio',  load: () => fetchMinisterio(API_URL) },
  { name: 'snapshot',    load: () => fetchRepoSnapshot() },
  { name: 'corsproxy',   load: () => fetchMinisterio('https://corsproxy.io/?url=' + encodeURIComponent(API_URL)) },
  { name: 'allorigins',  load: () => fetchMinisterio('https://api.allorigins.win/raw?url=' + encodeURIComponent(API_URL)) },
  { name: 'codetabs',    load: () => fetchMinisterio('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(API_URL)) }
];

const FUELS = [
  { id: 'g95e5',   label: 'Gasolina 95 E5',      key: 'Precio Gasolina 95 E5' },
  { id: 'gA',      label: 'Gasóleo A',            key: 'Precio Gasoleo A' },
  { id: 'gP',      label: 'Gasóleo Premium',      key: 'Precio Gasoleo Premium' },
  { id: 'g98e5',   label: 'Gasolina 98 E5',       key: 'Precio Gasolina 98 E5' },
  { id: 'g95e5p',  label: 'Gasolina 95 E5 Premium', key: 'Precio Gasolina 95 E5 Premium' },
  { id: 'g95e10',  label: 'Gasolina 95 E10',      key: 'Precio Gasolina 95 E10' },
  { id: 'g98e10',  label: 'Gasolina 98 E10',      key: 'Precio Gasolina 98 E10' },
  { id: 'glp',     label: 'GLP (autogas)',        key: 'Precio Gases licuados del petróleo' },
  { id: 'gnc',     label: 'Gas natural comprimido', key: 'Precio Gas Natural Comprimido' },
  { id: 'gnl',     label: 'Gas natural licuado',  key: 'Precio Gas Natural Licuado' },
  { id: 'bio',     label: 'Biodiésel',            key: 'Precio Biodiesel' },
  { id: 'etanol',  label: 'Bioetanol',            key: 'Precio Bioetanol' },
  { id: 'h2',      label: 'Hidrógeno',            key: 'Precio Hidrogeno' },
  { id: 'gB',      label: 'Gasóleo B (agrícola)', key: 'Precio Gasoleo B' }
];

const CACHE_MAX_AGE_MS = 30 * 60 * 1000;   // los datos oficiales cambian cada ~30 min
const MAX_RESULTS      = 40;

/* ---------- 2. Estado ---------- */

const state = {
  stations: [],
  fecha: '',
  fetchedAt: 0,
  origin: null,          // {lat, lon, label, manual:boolean}
  fuel: load('fr.fuel', 'g95e5'),
  radius: Number(load('fr.radius', 10)),
  sort: load('fr.sort', 'precio'),
  onlyOpen: load('fr.open', '0') === '1',
  tank: Number(load('fr.tank', 50)),
  consumption: Number(load('fr.cons', 7)),
  results: [],
  map: null,
  mapLayer: null,
  mapReady: false
};

function load(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
function save(k, v)   { try { localStorage.setItem(k, String(v)); } catch (e) { /* modo privado */ } }

/* ---------- 3. Utilidades ---------- */

const $ = sel => document.querySelector(sel);

// Decimal con coma española → número (admite negativos: longitudes al oeste)
function dec(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Igual, pero sólo válido si es estrictamente positivo (precios)
function num(raw) {
  const n = dec(raw);
  return n !== null && n > 0 ? n : null;
}

function eur(n, dec = 3) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(km) {
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(km < 10 ? 1 : 0) + ' km';
}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s(\/-])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase());
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function setStatus(txt, isError) {
  const el = $('#statusLine');
  el.textContent = txt;
  el.classList.toggle('err', !!isError);
}

/* ---------- 4. Horarios ---------- */
/* Formatos reales del Ministerio:
   "L-D: 24H"  ·  "L-V: 07:00-22:00; S: 08:00-14:00"  ·  "L-D: 06:00-23:00"
   "L-V: 08:00-13:30 y 16:00-20:00; S-D: 09:00-14:00"                        */

const DAY_INDEX = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
const DAY_ORDER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function isOpenNow(horario, when = new Date()) {
  if (!horario) return null;
  const h = horario.trim().toUpperCase();
  if (!h || h === '24H') return true;

  const dow = when.getDay();                       // 0 = domingo
  const mins = when.getHours() * 60 + when.getMinutes();

  for (const seg of h.split(';')) {
    const parts = seg.split(':');
    if (parts.length < 2) continue;
    const daysTxt = parts.shift().trim();
    const rangesTxt = parts.join(':').trim();
    if (!matchesDay(daysTxt, dow)) continue;
    if (rangesTxt.includes('24H')) return true;

    for (const r of rangesTxt.split(/\sY\s|,/)) {
      const m = r.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!m) continue;
      const from = +m[1] * 60 + +m[2];
      let to = +m[3] * 60 + +m[4];
      if (to <= from) to += 24 * 60;               // cierra después de medianoche
      if (mins >= from && mins <= to) return true;
      if (mins + 24 * 60 >= from && mins + 24 * 60 <= to) return true;
    }
  }
  return false;
}

function matchesDay(txt, dow) {
  for (const block of txt.split(/\s*,\s*/)) {
    const b = block.trim();
    if (!b) continue;
    const range = b.match(/^([LMXJVSD])\s*-\s*([LMXJVSD])$/);
    if (range) {
      let i = DAY_ORDER.indexOf(range[1]);
      const end = DAY_ORDER.indexOf(range[2]);
      if (i < 0 || end < 0) continue;
      for (let n = 0; n < 7; n++) {
        if (DAY_INDEX[DAY_ORDER[i]] === dow) return true;
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else if (/^[LMXJVSD]$/.test(b)) {
      if (DAY_INDEX[b] === dow) return true;
    }
  }
  return false;
}

/* ---------- 5. Almacén local (IndexedDB con respaldo en memoria) ---------- */

const store = (() => {
  const DB = 'fuelrapido', ST = 'kv';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('sin indexedDB'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(ST);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  return {
    async get(key) {
      try {
        const db = await open();
        return await new Promise((res, rej) => {
          const r = db.transaction(ST, 'readonly').objectStore(ST).get(key);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { return undefined; }
    },
    async set(key, val) {
      try {
        const db = await open();
        await new Promise((res, rej) => {
          const tx = db.transaction(ST, 'readwrite');
          tx.objectStore(ST).put(val, key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      } catch (e) { /* sin persistencia: seguimos en memoria */ }
    },
    async clear() {
      try {
        const db = await open();
        await new Promise(res => {
          const tx = db.transaction(ST, 'readwrite');
          tx.objectStore(ST).clear();
          tx.oncomplete = res; tx.onerror = res;
        });
      } catch (e) { /* nada */ }
    }
  };
})();

/* ---------- 6. Descarga y normalización ---------- */

function findKey(obj, needle) {
  const lower = needle.toLowerCase();
  return Object.keys(obj).find(k => k.toLowerCase().includes(lower));
}

function normalize(raw) {
  const list = raw.ListaEESSPrecio || raw.listaEESSPrecio || [];
  if (!list.length) return { fecha: raw.Fecha || '', stations: [] };

  const sample = list[0];
  const kLat = findKey(sample, 'latitud');
  const kLon = findKey(sample, 'longitud');
  const kRot = findKey(sample, 'rótulo') || findKey(sample, 'rotulo');
  const kDir = findKey(sample, 'direcci');
  const kMun = Object.keys(sample).find(k => k.toLowerCase() === 'municipio') || findKey(sample, 'municipio');
  const kPro = Object.keys(sample).find(k => k.toLowerCase() === 'provincia') || findKey(sample, 'provincia');
  const kHor = findKey(sample, 'horario');
  const kId  = findKey(sample, 'ideess');
  const kVta = findKey(sample, 'tipo venta');

  const stations = [];
  for (const s of list) {
    const latN = dec(s[kLat]);
    const lonN = dec(s[kLon]);
    if (latN === null || lonN === null || (latN === 0 && lonN === 0)) continue;

    const prices = {};
    let has = false;
    for (const f of FUELS) {
      const v = num(s[f.key]);
      if (v !== null) { prices[f.id] = v; has = true; }
    }
    if (!has) continue;

    stations.push({
      id: String(s[kId] || stations.length),
      name: titleCase(s[kRot]) || 'Estación de servicio',
      addr: titleCase(s[kDir]),
      town: titleCase(s[kMun]),
      prov: titleCase(s[kPro]),
      sched: s[kHor] || '',
      sale: String(s[kVta] || '').trim(),   // "P" = público, "R" = restringido
      lat: latN,
      lon: lonN,
      prices
    });
  }
  return { fecha: raw.Fecha || '', stations };
}

async function grab(url, tipo = 'json') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return tipo === 'json' ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMinisterio(url) {
  const data = normalize(await grab(url, 'json'));
  if (!data.stations.length) throw new Error('respuesta vacía');
  return data;
}

// Lector de CSV (comillas al estilo RFC 4180)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

// Snapshot propio: data/stations.csv + data/prices.csv, generados por scripts/snapshot.mjs
async function fetchRepoSnapshot() {
  const [stxt, ptxt, meta] = await Promise.all([
    grab('data/stations.csv', 'text'),
    grab('data/prices.csv', 'text'),
    grab('data/meta.json', 'json').catch(() => ({}))
  ]);

  const prows = parseCsv(ptxt);
  const pcols = prows.shift().slice(1);
  const byId = new Map();
  for (const r of prows) {
    const o = {};
    pcols.forEach((c, i) => { const v = dec(r[i + 1]); if (v !== null && v > 0) o[c] = v; });
    byId.set(r[0], o);
  }

  const srows = parseCsv(stxt);
  const scols = srows.shift();
  const ix = name => scols.indexOf(name);
  const iId = ix('id'), iRot = ix('rotulo'), iDir = ix('direccion'), iMun = ix('municipio'),
        iPro = ix('provincia'), iLat = ix('lat'), iLon = ix('lon'), iHor = ix('horario'), iVta = ix('venta');

  const stations = [];
  for (const r of srows) {
    const prices = byId.get(r[iId]);
    if (!prices || !Object.keys(prices).length) continue;
    const lat = dec(r[iLat]), lon = dec(r[iLon]);
    if (lat === null || lon === null) continue;
    stations.push({
      id: r[iId],
      name: titleCase(r[iRot]) || 'Estación de servicio',
      addr: titleCase(r[iDir]),
      town: titleCase(r[iMun]),
      prov: titleCase(r[iPro]),
      sched: r[iHor] || '',
      sale: (r[iVta] || '').trim(),
      lat, lon, prices
    });
  }
  if (!stations.length) throw new Error('snapshot vacío');
  return { fecha: meta.fechaMinisterio || '', stations };
}

async function fetchStations() {
  let lastErr = null;
  for (const src of SOURCES) {
    try {
      const data = await src.load();
      data.via = src.name;
      console.info('[FuelRápido] datos vía ' + src.name);
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se pudo descargar');
}

async function loadData({ force = false } = {}) {
  const cached = await store.get('dataset');
  const fresh = cached && (Date.now() - cached.fetchedAt) < CACHE_MAX_AGE_MS;

  if (cached && !force) {
    applyDataset(cached);
    if (fresh) { updateMeta(); return; }
  }

  try {
    setStatus(state.stations.length ? 'Actualizando precios…' : 'Descargando precios oficiales…');
    const data = await fetchStations();
    const payload = { ...data, fetchedAt: Date.now() };
    await store.set('dataset', payload);
    applyDataset(payload);
    updateMeta();
    if (state.origin) render();
  } catch (e) {
    console.warn('[FuelRápido] descarga fallida:', e);
    if (state.stations.length) {
      toast('Sin conexión: mostrando los últimos precios guardados.');
      updateMeta();
    } else {
      setStatus('No se pudieron descargar los precios', true);
      showEmpty('No hay conexión con el servidor del Ministerio.<br>Comprueba tu conexión y pulsa ⟳ para reintentar.');
    }
  }
}

function applyDataset(d) {
  state.stations = d.stations || [];
  state.fecha = d.fecha || '';
  state.fetchedAt = d.fetchedAt || 0;
  state.via = d.via || '';
}

const VIA_LABEL = {
  ministerio: 'API del Ministerio',
  snapshot: 'snapshot horario de este repositorio',
  corsproxy: 'Ministerio vía corsproxy.io',
  allorigins: 'Ministerio vía allorigins.win',
  codetabs: 'Ministerio vía codetabs.com'
};

function updateMeta() {
  const when = state.fetchedAt ? new Date(state.fetchedAt).toLocaleString('es-ES') : '—';
  $('#dataMeta').innerHTML =
    `${state.stations.length.toLocaleString('es-ES')} estaciones · ` +
    `Publicado por el Ministerio: <strong>${state.fecha || '—'}</strong><br>` +
    `Descargado en este dispositivo: ${when}` +
    (state.via ? `<br>Origen: ${VIA_LABEL[state.via] || state.via}` : '');
}

/* ---------- 7. Ubicación ---------- */

function locate() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Tu ubicación', manual: false }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

/* ---------- 8. Cálculo ---------- */

function compute() {
  const fuel = state.fuel;
  const o = state.origin;
  if (!o) return [];

  const rows = [];
  for (const s of state.stations) {
    const price = s.prices[fuel];
    if (price === undefined) continue;
    if (s.sale && s.sale.toUpperCase() === 'R') continue;   // venta restringida (flotas)
    const dist = haversine(o.lat, o.lon, s.lat, s.lon);
    if (dist > state.radius) continue;
    const open = isOpenNow(s.sched);
    if (state.onlyOpen && open === false) continue;
    rows.push({ s, price, dist, open });
  }

  // Coste real: llenar el depósito + el combustible del desvío (ida y vuelta)
  const tank = state.tank, cons = state.consumption;
  for (const r of rows) {
    r.total = tank * r.price + (2 * r.dist * cons / 100) * r.price;
  }

  const cmp = {
    precio:    (a, b) => a.price - b.price || a.dist - b.dist,
    distancia: (a, b) => a.dist - b.dist || a.price - b.price,
    ahorro:    (a, b) => a.total - b.total
  }[state.sort];

  rows.sort(cmp);
  return rows;
}

/* ---------- 9. Render ---------- */

function navUrl(s) {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;
}

function showEmpty(html) {
  $('#list').innerHTML = '';
  $('#hero').classList.add('hidden');
  $('#resumen').classList.add('hidden');
  const e = $('#empty');
  e.innerHTML = html;
  e.classList.remove('hidden');
}

/* La marca sólo se va cuando ya hay algo que enseñar, con un mínimo de
   700 ms para que no dé un pantallazo, y un tope de 6 s por si algo se atasca. */
function cerrarSplash() {
  const s = $('#splash');
  if (!s || s.classList.contains('se-va')) return;
  const falta = Math.max(0, 700 - (Date.now() - (window.__arranque || 0)));
  setTimeout(() => {
    s.classList.add('se-va');
    setTimeout(() => s.remove(), 500);
  }, falta);
}

function render() {
  const rows = compute();
  state.results = rows;
  const list = $('#list'), hero = $('#hero'), empty = $('#empty');

  if (!state.origin) {
    showEmpty('Necesitamos saber dónde estás.<br>Permite la ubicación o busca tu municipio en <strong>Ajustes</strong>.');
    return;
  }
  if (!rows.length) {
    const label = FUELS.find(f => f.id === state.fuel)?.label || '';
    showEmpty(`Ninguna estación con <strong>${label}</strong> en ${state.radius} km` +
      (state.onlyOpen ? ' abierta ahora mismo' : '') + '.<br>Prueba a ampliar el radio.');
    return;
  }
  empty.classList.add('hidden');

  const prices = rows.map(r => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const best = rows[0];

  /* --- Destacado --- */
  const savePerTank = (avg - best.price) * state.tank;
  hero.classList.remove('hidden');
  hero.dataset.i = 0;
  hero.innerHTML = `
    <div class="kicker">${sortKicker()}</div>
    <div class="cabecera">
      ${Marcas.html(best.s.name, 48)}
      <div style="min-width:0">
        <p class="name">${esc(best.s.name)}</p>
        <p class="addr">${esc(best.s.town)} · a ${fmtDist(best.dist)}</p>
      </div>
    </div>
    ${distintivo(best) ? `<div class="tags" style="margin-top:9px">${distintivo(best)}</div>` : ''}
    <div class="bottom">
      <div>
        <div class="price">${eur(best.price)}<small> €/L</small></div>
        ${savePerTank > 0.05
          ? `<div class="save">Ahorras ≈ ${eur(savePerTank, 2)} € por depósito de ${state.tank} L</div>`
          : `<div class="save">La más barata de la zona</div>`}
        <div class="hint">Toca para ver su histórico</div>
      </div>
      <a class="nav-btn" href="${navUrl(best.s)}" target="_blank" rel="noopener">▶ Navegar</a>
    </div>`;

  /* --- Resto de la lista --- */
  const frag = document.createDocumentFragment();
  rows.slice(0, MAX_RESULTS).forEach((r, i) => {
    if (i === 0) return;
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.i = i;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${r.s.name}, ${eur(r.price)} euros por litro. Ver su histórico`);
    const delta = r.price - min;
    const openTag = r.open === null ? ''
      : r.open ? '<span class="tag open">Abierto</span>'
               : '<span class="tag closed">Cerrado ahora</span>';
    // Medidor como puntuación: barra llena = la más barata del radio
    const pos = max === min ? 0 : (r.price - min) / (max - min);
    const lleno = (1 - pos) * 97 + 3;
    const colorPos = pos < 0.34 ? '#1f9d57' : pos < 0.67 ? '#c98500' : '#d95926';

    card.innerHTML = `
      ${Marcas.html(r.s.name, 38)}
      <div class="info-col">
        <div class="rank">#${i + 1}</div>
        <p class="name">${esc(r.s.name)}</p>
        <p class="meta">${esc(r.s.addr)}<br>${esc(r.s.town)} · ${fmtDist(r.dist)}</p>
        <div class="tags">
          ${openTag}
          ${distintivo(r)}
          <span class="tag">${esc(r.s.sched || 'Horario n/d')}</span>
        </div>
      </div>
      <div class="price-col">
        <div>
          <div class="p${delta === 0 ? ' best' : ''}">${eur(r.price)} €</div>
          <div class="delta">${delta === 0 ? '—' : '+' + eur(delta) + ' €/L'}</div>
        </div>
        <a class="nav-btn" href="${navUrl(r.s)}" target="_blank" rel="noopener">Navegar</a>
      </div>
      <div class="medidor" title="Lo barata que está respecto al resto de tu radio">
        <i style="width:${lleno.toFixed(1)}%;background:${colorPos}"></i>
      </div>`;
    frag.appendChild(card);
  });
  list.innerHTML = '';
  list.appendChild(frag);

  // Tira de contexto: de un vistazo, cuánto se mueve el precio en tu zona
  const res = $('#resumen');
  res.classList.remove('hidden');
  res.innerHTML =
    `<span><b>${rows.length}</b> estaciones en ${state.radius} km</span>` +
    `<span class="sep">·</span>` +
    `<span>de <b>${eur(min)}</b> a <b>${eur(max)}</b> €/L</span>` +
    (max - min > 0.001
      ? `<span class="sep">·</span><span>hasta <b>${eur((max - min) * state.tank, 2)} €</b> de diferencia por depósito</span>`
      : '');

  setStatus(`${rows.length} estaciones · ${state.origin.label} · ${state.radius} km`);
  // El panel de mercado usa esto para destacar tu provincia en el ranking
  if (best.s.prov) save('fr.prov', best.s.prov.toUpperCase());
  if (state.mapReady) drawMap();
}

function sortKicker() {
  return { precio: 'La más barata cerca de ti', distancia: 'La más cercana', ahorro: 'La que más te compensa' }[state.sort];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 9b. Ficha de estación: su historia de precios ---------- */

const COLOR_SERIE = '#1f9d57';   // validado sobre la superficie #161f2c

function seriePath(id) {
  return `data/series/${String(id).padStart(2, '0').slice(-2)}/${id}.csv`;
}

/* Mismo criterio que el recolector: entre dos cambios el precio se mantiene,
   así que se arrastra el último conocido hasta el siguiente cambio. */
function cierresDiarios(eventos, dias) {
  if (!eventos.length) return [];
  const porDia = new Map();
  for (const e of eventos) porDia.set(e.ts.slice(0, 10), e.precio);

  const hoy = new Date();
  const finMs = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const iniMs = finMs - (dias - 1) * 86400000;
  const primero = eventos[0].ts.slice(0, 10);

  let vigente = null;
  for (const e of eventos) {
    if (e.ts.slice(0, 10) < new Date(iniMs).toISOString().slice(0, 10)) vigente = e.precio; else break;
  }

  const out = [];
  for (let t = iniMs; t <= finMs; t += 86400000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    if (porDia.has(dia)) vigente = porDia.get(dia);
    if (vigente !== null && dia >= primero) out.push({ x: t, y: vigente });
  }
  return out;
}

async function cargarSerie(id, fuel) {
  const txt = await grab(seriePath(id), 'text');
  const rows = parseCsv(txt);
  rows.shift();
  return rows
    .filter(r => r[1] === fuel)
    .map(r => ({ ts: r[0], precio: dec(r[2]) }))
    .filter(e => e.precio !== null);
}

function abrirFicha(r) {
  const s = r.s;
  const fuelLabel = FUELS.find(f => f.id === state.fuel)?.label || '';

  const cab = $('#sheetNombre');
  const nom = document.createElement('span');
  nom.className = 'nombre';
  nom.textContent = s.name;
  cab.replaceChildren(Marcas.chip(s.name, 34), nom);
  $('#sheetSub').textContent =
    `${s.addr} · ${s.town} · a ${fmtDist(r.dist)}` + (s.sched ? ` · ${s.sched}` : '');
  $('#sheetNav').href = navUrl(s);

  const cuerpo = $('#sheetCuerpo');
  cuerpo.replaceChildren();
  const cargando = document.createElement('p');
  cargando.className = 'viz-vacio';
  cargando.textContent = 'Cargando su histórico…';
  cuerpo.appendChild(cargando);

  $('#sheetFondo').classList.add('is-open');
  $('#sheet').classList.add('is-open');
  $('#sheetCerrar').focus();

  cargarSerie(s.id, state.fuel).then(eventos => {
    const serie = cierresDiarios(eventos, 90);
    cuerpo.replaceChildren();

    if (serie.length < 2) {
      const p = document.createElement('p');
      p.className = 'viz-vacio';
      p.textContent = serie.length
        ? 'Su histórico acaba de empezar: mañana ya habrá curva que enseñar.'
        : 'Todavía no hay histórico de esta estación.';
      cuerpo.appendChild(p);
      return;
    }

    // El gráfico enseña 90 días; el veredicto y las cifras usan los últimos 30,
    // igual que stats.csv, para que la ficha y el distintivo de la lista digan lo mismo.
    const corte = Date.now() - 30 * 86400000;
    const v30 = serie.filter(p => p.x >= corte).map(p => p.y);
    const v = v30.length >= 2 ? v30 : serie.map(p => p.y);
    const min = Math.min(...v), max = Math.max(...v);
    const media = v.reduce((a, b) => a + b, 0) / v.length;
    const actual = r.price;
    const pct = ((actual - media) / media) * 100;

    // Veredicto: lo que el conductor quiere saber en una frase
    const ver = document.createElement('div');
    ver.className = 'veredicto ' + (pct <= -1.5 ? 'barata' : pct >= 1.5 ? 'cara' : '');
    const ic = document.createElement('span');
    ic.className = 'icono';
    const txt = document.createElement('span');
    if (actual <= min) {
      ic.textContent = '↓';
      txt.textContent = `Está en su precio más bajo de los últimos ${v.length} días.`;
    } else if (pct <= -1.5) {
      ic.textContent = '↓';
      txt.textContent = `Hoy está un ${Math.abs(pct).toFixed(1)} % por debajo de su media. Buen momento.`;
    } else if (pct >= 1.5) {
      ic.textContent = '↑';
      txt.textContent = `Hoy está un ${pct.toFixed(1)} % por encima de su media. Suele estar más barata.`;
    } else {
      ic.textContent = '=';
      txt.textContent = 'Está en su precio habitual.';
    }
    ver.append(ic, txt);
    cuerpo.appendChild(ver);

    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    [['Hoy', actual], [`Mín. ${v.length} d`, min], [`Máx. ${v.length} d`, max]].forEach(([lab, val]) => {
      const d = document.createElement('div');
      d.className = 'tile';
      const l = document.createElement('span'); l.className = 'lab'; l.textContent = lab;
      const x = document.createElement('span'); x.className = 'val'; x.textContent = eur(val) + ' €';
      d.append(l, x);
      tiles.appendChild(d);
    });
    cuerpo.appendChild(tiles);

    const secc = document.createElement('div');
    secc.className = 'sheet-secc';
    const h3 = document.createElement('h3');
    h3.textContent = `${fuelLabel} en esta estación · últimos ${serie.length} días`;
    const graf = document.createElement('div');
    graf.className = 'viz';
    secc.append(h3, graf);

    const btn = document.createElement('button');
    btn.className = 'viz-toggle';
    btn.textContent = 'Ver como tabla';
    const tabla = document.createElement('div');
    tabla.hidden = true;
    btn.addEventListener('click', () => {
      tabla.hidden = !tabla.hidden;
      btn.textContent = tabla.hidden ? 'Ver como tabla' : 'Ocultar tabla';
      if (!tabla.hidden && !tabla.dataset.hecha) {
        Viz.tabla(tabla, {
          columnas: ['Día', '€/L'],
          filas: [...serie].reverse().map(p =>
            [new Date(p.x).toLocaleDateString('es-ES'), eur(p.y)])
        });
        tabla.dataset.hecha = '1';
      }
    });
    secc.append(btn, tabla);
    cuerpo.appendChild(secc);

    Viz.lineas(graf, {
      series: [{ nombre: fuelLabel, color: COLOR_SERIE, puntos: serie }],
      area: true,
      descripcion: `Evolución del precio de ${fuelLabel} en ${s.name}`,
      formatoEtiqueta: y => eur(y)
    });
  }).catch(() => {
    cuerpo.replaceChildren();
    const p = document.createElement('p');
    p.className = 'viz-vacio';
    p.textContent = 'El histórico aún no está disponible. Se genera con el recolector horario del repositorio.';
    cuerpo.appendChild(p);
  });
}

function cerrarFicha() {
  $('#sheetFondo').classList.remove('is-open');
  $('#sheet').classList.remove('is-open');
}

/* ---------- 9c. Distintivos «barata para lo que suele estar» ---------- */

async function cargarStats() {
  if (state.stats || state.statsFallo) return;
  try {
    const txt = await grab('data/stats.csv', 'text');
    const rows = parseCsv(txt);
    rows.shift();
    const m = new Map();
    for (const r of rows) {
      const media = dec(r[5]), min = dec(r[3]), dias = Number(r[6]);
      if (media === null || dias < 5) continue;
      m.set(r[0] + '|' + r[1], { min, media, dias });
    }
    state.stats = m;
    if (m.size) render();
  } catch (e) {
    state.statsFallo = true;
  }
}

function distintivo(r) {
  if (!state.stats) return '';
  const st = state.stats.get(r.s.id + '|' + state.fuel);
  if (!st) return '';
  if (r.price <= st.min) return '<span class="tag cheap">↓ Su mínimo en 30 días</span>';
  const pct = ((r.price - st.media) / st.media) * 100;
  if (pct <= -1.5) return `<span class="tag cheap">↓ ${Math.abs(pct).toFixed(0)} % bajo su media</span>`;
  if (pct >= 2.5) return `<span class="tag closed">↑ ${pct.toFixed(0)} % sobre su media</span>`;
  return '';
}

/* ---------- 10. Mapa (Leaflet + OpenStreetMap, carga diferida) ---------- */

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (loadLeaflet._p) return loadLeaflet._p;
  // Leaflet va incluido en el propio repositorio: ni CDN ni claves.
  loadLeaflet._p = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'vendor/leaflet/leaflet.js';
    js.onload = res;
    js.onerror = () => rej(new Error('Leaflet no disponible'));
    document.head.appendChild(js);
  });
  return loadLeaflet._p;
}

async function initMap() {
  if (state.mapReady) { drawMap(); return; }
  try {
    await loadLeaflet();
  } catch (e) {
    $('#map').innerHTML = '<div class="empty">No se pudo cargar el mapa.<br>La lista sigue funcionando sin él.</div>';
    return;
  }
  state.map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(state.origin ? [state.origin.lat, state.origin.lon] : [40.4, -3.7], state.origin ? 12 : 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);
  state.mapLayer = L.layerGroup().addTo(state.map);
  state.mapReady = true;
  drawMap();
}

function drawMap() {
  if (!state.mapReady || !state.results.length) return;
  state.mapLayer.clearLayers();
  const prices = state.results.map(r => r.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const bounds = [];

  if (state.origin) {
    L.circleMarker([state.origin.lat, state.origin.lon], {
      radius: 7, color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: .9, weight: 2
    }).addTo(state.mapLayer).bindPopup('Tú');
    bounds.push([state.origin.lat, state.origin.lon]);
  }

  state.results.slice(0, MAX_RESULTS).forEach(r => {
    const t = max === min ? 0 : (r.price - min) / (max - min);
    const bg = t < .34 ? '#37d67a' : t < .67 ? '#ffb020' : '#ff5c5c';
    const marca = Marcas.de(r.s.name);
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-pin" style="background:${bg};border-color:${marca.color}">${eur(r.price)}</div>`,
      iconSize: [46, 20], iconAnchor: [23, 10]
    });
    L.marker([r.s.lat, r.s.lon], { icon }).addTo(state.mapLayer).bindPopup(
      `<strong>${esc(r.s.name)}</strong><br>${esc(r.s.addr)}<br>` +
      `<strong>${eur(r.price)} €/L</strong> · ${fmtDist(r.dist)}<br>` +
      `<a href="${navUrl(r.s)}" target="_blank" rel="noopener">Navegar con Google Maps</a>`
    );
    bounds.push([r.s.lat, r.s.lon]);
  });

  if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  setTimeout(() => state.map.invalidateSize(), 60);
}

/* ---------- 11. Búsqueda por municipio ---------- */

function searchTowns(q) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 3) return [];
  const acc = new Map();
  for (const s of state.stations) {
    const key = s.town + '|' + s.prov;
    if (!s.town.toLowerCase().includes(needle)) continue;
    let e = acc.get(key);
    if (!e) { e = { town: s.town, prov: s.prov, lat: 0, lon: 0, n: 0 }; acc.set(key, e); }
    e.lat += s.lat; e.lon += s.lon; e.n++;
  }
  return [...acc.values()]
    .map(e => ({ ...e, lat: e.lat / e.n, lon: e.lon / e.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
}

/* ---------- 12. Eventos e inicio ---------- */

function buildFuelSelect() {
  const sel = $('#fuelSelect');
  sel.innerHTML = FUELS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
  sel.value = state.fuel;
}

function wire() {
  $('#fuelSelect').addEventListener('change', e => {
    state.fuel = e.target.value; save('fr.fuel', state.fuel); render();
  });
  $('#radiusSelect').addEventListener('change', e => {
    state.radius = Number(e.target.value); save('fr.radius', state.radius); render();
  });

  document.querySelectorAll('.chip[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-sort]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.sort = btn.dataset.sort; save('fr.sort', state.sort); render();
    });
  });

  $('#chipOpen').addEventListener('click', () => {
    state.onlyOpen = !state.onlyOpen;
    $('#chipOpen').classList.toggle('is-active', state.onlyOpen);
    save('fr.open', state.onlyOpen ? '1' : '0');
    render();
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('is-active');
      $('#' + tab.dataset.panel).classList.remove('hidden');
      if (tab.dataset.panel === 'panelMap') initMap();
    });
  });

  $('#btnRefresh').addEventListener('click', async () => {
    const b = $('#btnRefresh');
    b.classList.add('spinning');
    const pos = await locate();
    if (pos) state.origin = pos;
    await loadData({ force: true });
    render();
    b.classList.remove('spinning');
  });

  $('#tankInput').value = state.tank;
  $('#tankInput').addEventListener('change', e => {
    state.tank = Math.max(5, Number(e.target.value) || 50); save('fr.tank', state.tank); render();
  });
  $('#consumptionInput').value = state.consumption;
  $('#consumptionInput').addEventListener('change', e => {
    state.consumption = Math.max(1, Number(e.target.value) || 7); save('fr.cons', state.consumption); render();
  });

  let tTimer;
  $('#townInput').addEventListener('input', e => {
    clearTimeout(tTimer);
    const q = e.target.value;
    tTimer = setTimeout(() => {
      const box = $('#townResults');
      const hits = searchTowns(q);
      box.innerHTML = '';
      hits.forEach(h => {
        const b = document.createElement('button');
        b.textContent = `${h.town} (${h.prov}) · ${h.n} estaciones`;
        b.addEventListener('click', () => {
          state.origin = { lat: h.lat, lon: h.lon, label: h.town, manual: true };
          box.innerHTML = '';
          document.querySelector('.tab[data-panel="panelList"]').click();
          render();
          toast('Centro de búsqueda: ' + h.town);
        });
        box.appendChild(b);
      });
    }, 200);
  });

  $('#btnPurge').addEventListener('click', async () => {
    await store.clear();
    toast('Caché borrada, descargando de nuevo…');
    await loadData({ force: true });
    render();
  });

  // Abrir la ficha: toda la tarjeta es pulsable menos el botón de navegar
  const abrirDesde = ev => {
    if (ev.target.closest('.nav-btn')) return;
    const cont = ev.target.closest('[data-i]');
    if (!cont) return;
    const r = state.results[Number(cont.dataset.i)];
    if (r) abrirFicha(r);
  };
  $('#list').addEventListener('click', abrirDesde);
  $('#hero').addEventListener('click', abrirDesde);
  $('#list').addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirDesde(ev); }
  });
  $('#sheetCerrar').addEventListener('click', cerrarFicha);
  $('#sheetFondo').addEventListener('click', cerrarFicha);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarFicha(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.fetchedAt > CACHE_MAX_AGE_MS) {
      loadData();
    }
  });
}

async function init() {
  window.__arranque = Date.now();
  setTimeout(cerrarSplash, 6000);          // red de seguridad
  buildFuelSelect();
  $('#radiusSelect').value = String(state.radius);
  document.querySelectorAll('.chip[data-sort]').forEach(b =>
    b.classList.toggle('is-active', b.dataset.sort === state.sort));
  $('#chipOpen').classList.toggle('is-active', state.onlyOpen);
  wire();

  $('#list').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  // Ubicación y datos en paralelo: lo que llegue primero adelanta trabajo.
  const [pos] = await Promise.all([locate(), loadData()]);

  if (pos) {
    state.origin = pos;
  } else {
    setStatus('Sin ubicación — busca tu municipio en Ajustes', true);
  }
  updateMeta();
  render();
  cerrarSplash();

  // Los distintivos «barata para lo que suele estar» son un extra: se cargan
  // cuando el navegador está ocioso y nunca retrasan la primera pantalla.
  const luego = window.requestIdleCallback || (f => setTimeout(f, 1500));
  luego(() => cargarStats());

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
