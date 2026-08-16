#!/usr/bin/env node
/* ============================================================
   Fuel Rápido — recolector de histórico de precios
   ------------------------------------------------------------
   Descarga la foto actual del Ministerio y:
     1. actualiza  data/stations.csv  (catálogo maestro)
     2. actualiza  data/prices.csv    (precios vigentes, sirve de respaldo a la app)
     3. añade      data/history/AAAA/AAAA-MM-DD.csv  SÓLO con los precios que han cambiado
     4. actualiza  data/meta.json

   Guardar sólo los cambios mantiene el repositorio pequeño: de ~12.000
   estaciones cambian unas pocas miles de líneas al día, no 12.000 cada hora.

   Uso:
     node scripts/snapshot.mjs
     FUEL_SOURCE=./test/mock.json node scripts/snapshot.mjs   (para pruebas)

   Requiere Node 18+ (fetch nativo).
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const API_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

/* Debe coincidir con FUELS de app.js (mismo orden, mismos identificadores) */
const FUELS = [
  ['g95e5',  'Precio Gasolina 95 E5'],
  ['gA',     'Precio Gasoleo A'],
  ['gP',     'Precio Gasoleo Premium'],
  ['g98e5',  'Precio Gasolina 98 E5'],
  ['g95e5p', 'Precio Gasolina 95 E5 Premium'],
  ['g95e10', 'Precio Gasolina 95 E10'],
  ['g98e10', 'Precio Gasolina 98 E10'],
  ['glp',    'Precio Gases licuados del petróleo'],
  ['gnc',    'Precio Gas Natural Comprimido'],
  ['gnl',    'Precio Gas Natural Licuado'],
  ['bio',    'Precio Biodiesel'],
  ['etanol', 'Precio Bioetanol'],
  ['h2',     'Precio Hidrogeno'],
  ['gB',     'Precio Gasoleo B']
];
const FUEL_IDS = FUELS.map(f => f[0]);

/* ---------- utilidades ---------- */

const dec = v => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const price = v => { const n = dec(v); return n !== null && n > 0 ? n : null; };

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvRow = arr => arr.map(csvCell).join(',');

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

const readIf = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

/* ---------- 1. descarga ---------- */

async function getRaw() {
  const local = process.env.FUEL_SOURCE;
  if (local) {
    console.log(`· Origen local (modo prueba): ${local}`);
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, local), 'utf8'));
  }
  for (let intento = 1; intento <= 4; intento++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(API_URL, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn(`· Intento ${intento}/4 fallido: ${e.message}`);
      if (intento === 4) throw e;
      await new Promise(r => setTimeout(r, intento * 5000));
    }
  }
}

/* ---------- 2. normalización ---------- */

function normalize(raw) {
  const list = raw.ListaEESSPrecio || [];
  const stations = [];
  for (const s of list) {
    const lat = dec(s['Latitud']);
    const lon = dec(s['Longitud (WGS84)'] ?? s['Longitud']);
    const id = String(s['IDEESS'] ?? '').trim();
    if (!id || lat === null || lon === null || (lat === 0 && lon === 0)) continue;

    const prices = {};
    let has = false;
    for (const [fid, key] of FUELS) {
      const p = price(s[key]);
      if (p !== null) { prices[fid] = p; has = true; }
    }
    if (!has) continue;

    stations.push({
      id,
      rotulo: (s['Rótulo'] || '').trim(),
      direccion: (s['Dirección'] || '').trim(),
      municipio: (s['Municipio'] || '').trim(),
      provincia: (s['Provincia'] || '').trim(),
      lat, lon,
      horario: (s['Horario'] || '').trim(),
      venta: (s['Tipo Venta'] || '').trim(),
      prices
    });
  }
  stations.sort((a, b) => (+a.id) - (+b.id) || a.id.localeCompare(b.id));
  return { fecha: raw.Fecha || '', stations };
}

/* ---------- 3. estado anterior ---------- */

function previousPrices() {
  const txt = readIf(path.join(DATA, 'prices.csv'));
  if (!txt) return null;
  const rows = parseCsv(txt);
  const head = rows.shift();
  const cols = head.slice(1);
  const map = new Map();
  for (const r of rows) {
    const o = {};
    cols.forEach((c, i) => { const v = dec(r[i + 1]); if (v !== null) o[c] = v; });
    map.set(r[0], o);
  }
  return map;
}

/* ---------- 4. escritura ---------- */

function writeStations(stations) {
  const head = ['id', 'rotulo', 'direccion', 'municipio', 'provincia', 'lat', 'lon', 'horario', 'venta'];
  const body = stations.map(s =>
    csvRow([s.id, s.rotulo, s.direccion, s.municipio, s.provincia,
            s.lat.toFixed(6), s.lon.toFixed(6), s.horario, s.venta]));
  const out = head.join(',') + '\n' + body.join('\n') + '\n';
  const file = path.join(DATA, 'stations.csv');
  const changed = readIf(file) !== out;
  if (changed) fs.writeFileSync(file, out);
  return changed;
}

function writePrices(stations) {
  const head = ['id', ...FUEL_IDS];
  const body = stations.map(s =>
    csvRow([s.id, ...FUEL_IDS.map(f => (s.prices[f] !== undefined ? s.prices[f].toFixed(3) : ''))]));
  fs.writeFileSync(path.join(DATA, 'prices.csv'), head.join(',') + '\n' + body.join('\n') + '\n');
}

function appendHistory(changes, stampISO) {
  if (!changes.length) return null;
  const day = stampISO.slice(0, 10);
  const dir = path.join(DATA, 'history', day.slice(0, 4));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day}.csv`);
  const nuevo = !fs.existsSync(file);
  const ts = stampISO.slice(0, 16) + 'Z';      // minuto UTC
  const lines = changes.map(c => `${ts},${c.id},${c.fuel},${c.precio.toFixed(3)}`);
  fs.appendFileSync(file, (nuevo ? 'ts,id,combustible,precio\n' : '') + lines.join('\n') + '\n');
  return path.relative(ROOT, file);
}

/* ---------- 5. principal ---------- */

(async () => {
  fs.mkdirSync(DATA, { recursive: true });

  const raw = await getRaw();
  const { fecha, stations } = normalize(raw);
  if (!stations.length) throw new Error('El Ministerio devolvió 0 estaciones válidas');

  const prev = previousPrices();

  // Salvaguarda: nunca sustituimos un catálogo grande por uno sospechosamente pequeño.
  if (prev && prev.size > 100 && stations.length < prev.size * 0.5) {
    throw new Error(`Respuesta anómala: ${stations.length} estaciones frente a ${prev.size} anteriores. No se escribe nada.`);
  }

  const changes = [];
  let nuevas = 0;
  for (const s of stations) {
    const before = prev ? prev.get(s.id) : undefined;
    if (prev && !before) nuevas++;
    for (const f of FUEL_IDS) {
      const now = s.prices[f];
      if (now === undefined) continue;
      const was = before ? before[f] : undefined;
      if (was === undefined || Math.abs(was - now) >= 0.0005) {
        changes.push({ id: s.id, fuel: f, precio: now });
      }
    }
  }

  const stampISO = new Date().toISOString();
  const catalogo = writeStations(stations);
  writePrices(stations);
  const histFile = appendHistory(changes, stampISO);

  const meta = {
    fechaMinisterio: fecha,
    capturado: stampISO,
    estaciones: stations.length,
    cambiosEnEstaCaptura: changes.length,
    estacionesNuevas: prev ? nuevas : stations.length,
    primeraCaptura: !prev,
    fuente: API_URL,
    licencia: 'Datos del Ministerio para la Transición Ecológica y el Reto Demográfico. Reutilización citando fuente y fecha de actualización.'
  };
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log(`✔ ${stations.length} estaciones · ${changes.length} cambios de precio` +
              (catalogo ? ' · catálogo actualizado' : '') +
              (histFile ? ` · ${histFile}` : ' · sin histórico que añadir'));

  // Para el resumen del workflow
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `cambios=${changes.length}\nestaciones=${stations.length}\n`);
  }
})().catch(e => {
  console.error('✖ ' + e.message);
  process.exit(1);
});
