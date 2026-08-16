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

/* ---------- 4b. series por estación ---------- */
/* Una gasolinera cambia de precio cada pocos días, así que su serie completa
   cabe en un fichero diminuto. Repartimos en 100 carpetas por los dos últimos
   dígitos del id para no dejar 11.000 ficheros en un mismo directorio.
   La app se descarga UN fichero (~2 KB) para pintar la curva de una estación. */

const SERIES_DAYS = 90;

function seriesPath(id) {
  const shard = String(id).padStart(2, '0').slice(-2);
  return path.join(DATA, 'series', shard, `${id}.csv`);
}

function appendSeries(changes, stampISO) {
  const ts = stampISO.slice(0, 16) + 'Z';
  const porEstacion = new Map();
  for (const c of changes) {
    if (!porEstacion.has(c.id)) porEstacion.set(c.id, []);
    porEstacion.get(c.id).push(`${ts},${c.fuel},${c.precio.toFixed(3)}`);
  }
  for (const [id, lines] of porEstacion) {
    const file = seriesPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const nuevo = !fs.existsSync(file);
    fs.appendFileSync(file, (nuevo ? 'ts,combustible,precio\n' : '') + lines.join('\n') + '\n');
  }
  return porEstacion.size;
}

function readSeries(id) {
  const file = seriesPath(id);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  rows.shift();
  return rows.map(r => ({ ts: r[0], fuel: r[1], precio: dec(r[2]) })).filter(e => e.precio !== null);
}

/* Reconstruye el cierre diario a partir de los cambios: entre dos cambios el
   precio se mantiene, así que se arrastra el último conocido. */
function cierresDiarios(eventos, hastaISO, dias) {
  if (!eventos.length) return [];
  const porDia = new Map();
  for (const e of eventos) porDia.set(e.ts.slice(0, 10), e.precio);   // último del día gana

  const fin = new Date(hastaISO.slice(0, 10) + 'T00:00:00Z');
  const ini = new Date(fin.getTime() - (dias - 1) * 86400000);
  const primero = eventos[0].ts.slice(0, 10);

  let vigente = null;
  for (const e of eventos) {                        // precio en vigor al abrir la ventana
    if (e.ts.slice(0, 10) < ini.toISOString().slice(0, 10)) vigente = e.precio; else break;
  }

  const out = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += 86400000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    if (porDia.has(dia)) vigente = porDia.get(dia);
    if (vigente !== null && dia >= primero) out.push({ dia, precio: vigente });
  }
  return out;
}

function writeStats(stations, stampISO) {
  const head = ['id', 'combustible', 'actual', 'min30', 'max30', 'media30', 'dias'];
  const body = [];
  for (const s of stations) {
    const eventos = readSeries(s.id);
    if (!eventos.length) continue;
    for (const f of FUEL_IDS) {
      const actual = s.prices[f];
      if (actual === undefined) continue;
      const serie = cierresDiarios(eventos.filter(e => e.fuel === f), stampISO, 30);
      if (serie.length < 2) continue;                // con un solo punto no hay nada que comparar
      const v = serie.map(p => p.precio);
      const media = v.reduce((a, b) => a + b, 0) / v.length;
      body.push(csvRow([s.id, f, actual.toFixed(3), Math.min(...v).toFixed(3),
                        Math.max(...v).toFixed(3), media.toFixed(4), v.length]));
    }
  }
  fs.writeFileSync(path.join(DATA, 'stats.csv'), head.join(',') + '\n' + body.join('\n') + (body.length ? '\n' : ''));
  return body.length;
}

/* ---------- 4c. agregados de mercado ---------- */

const FUELS_MERCADO = ['g95e5', 'g98e5', 'gA', 'gP', 'glp'];
const TOP_MARCAS = 40;

const mediana = a => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const media = a => a.reduce((x, y) => x + y, 0) / a.length;

/* Cada fichero guarda una fila por día; si el recolector vuelve a correr el
   mismo día, esa fila se sustituye en lugar de duplicarse. */
function upsertDia(file, head, dia, filas) {
  const full = path.join(DATA, 'market', file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  let previas = [];
  if (fs.existsSync(full)) {
    const rows = parseCsv(fs.readFileSync(full, 'utf8'));
    rows.shift();
    previas = rows.filter(r => r[0] !== dia).map(r => csvRow(r));
  }
  fs.writeFileSync(full, head.join(',') + '\n' + [...previas, ...filas].join('\n') + '\n');
}

function writeMarket(stations, stampISO) {
  const dia = stampISO.slice(0, 10);
  const publicas = stations.filter(s => s.venta.toUpperCase() !== 'R');

  const nacional = [], provincias = [], marcas = [];

  // Marcas con presencia suficiente para que la media signifique algo
  const cuenta = new Map();
  for (const s of publicas) {
    const m = s.rotulo.toUpperCase().trim();
    if (m) cuenta.set(m, (cuenta.get(m) || 0) + 1);
  }
  const top = new Set([...cuenta.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MARCAS).map(e => e[0]));

  for (const f of FUELS_MERCADO) {
    const conPrecio = publicas.filter(s => s.prices[f] !== undefined);
    if (conPrecio.length < 10) continue;
    const v = conPrecio.map(s => s.prices[f]);
    nacional.push(csvRow([dia, f, v.length, Math.min(...v).toFixed(3),
                          media(v).toFixed(4), mediana(v).toFixed(3), Math.max(...v).toFixed(3)]));

    const porProv = new Map(), porMarca = new Map();
    for (const s of conPrecio) {
      const p = s.provincia.toUpperCase().trim();
      if (p) { if (!porProv.has(p)) porProv.set(p, []); porProv.get(p).push(s.prices[f]); }
      const m = s.rotulo.toUpperCase().trim();
      if (top.has(m)) { if (!porMarca.has(m)) porMarca.set(m, []); porMarca.get(m).push(s.prices[f]); }
    }
    for (const [p, arr] of porProv) {
      if (arr.length < 3) continue;
      provincias.push(csvRow([dia, p, f, arr.length, media(arr).toFixed(4), Math.min(...arr).toFixed(3)]));
    }
    for (const [m, arr] of porMarca) {
      if (arr.length < 5) continue;
      marcas.push(csvRow([dia, m, f, arr.length, media(arr).toFixed(4), Math.min(...arr).toFixed(3)]));
    }
  }

  upsertDia('nacional.csv',   ['fecha', 'combustible', 'estaciones', 'min', 'media', 'mediana', 'max'], dia, nacional);
  upsertDia('provincias.csv', ['fecha', 'provincia', 'combustible', 'estaciones', 'media', 'min'],      dia, provincias);
  upsertDia('marcas.csv',     ['fecha', 'marca', 'combustible', 'estaciones', 'media', 'min'],          dia, marcas);
  return { nacional: nacional.length, provincias: provincias.length, marcas: marcas.length };
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

  // FUEL_STAMP permite fijar la fecha de captura en los tests (simular varios días)
  const stampISO = process.env.FUEL_STAMP || new Date().toISOString();
  const catalogo = writeStations(stations);
  writePrices(stations);
  const histFile = appendHistory(changes, stampISO);
  const seriesTocadas = appendSeries(changes, stampISO);
  const statsFilas = writeStats(stations, stampISO);
  const mercado = writeMarket(stations, stampISO);

  const meta = {
    fechaMinisterio: fecha,
    capturado: stampISO,
    estaciones: stations.length,
    cambiosEnEstaCaptura: changes.length,
    estacionesNuevas: prev ? nuevas : stations.length,
    primeraCaptura: !prev,
    seriesActualizadas: seriesTocadas,
    estadisticasCalculadas: statsFilas,
    mercado,
    diasSerie: SERIES_DAYS,
    fuente: API_URL,
    licencia: 'Datos del Ministerio para la Transición Ecológica y el Reto Demográfico. Reutilización citando fuente y fecha de actualización.'
  };
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log(`✔ ${stations.length} estaciones · ${changes.length} cambios · ` +
              `${seriesTocadas} series · ${statsFilas} estadísticas · ` +
              `mercado ${mercado.nacional}/${mercado.provincias}/${mercado.marcas}` +
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
