/* Comprobaciones del recolector de histórico (scripts/snapshot.mjs).
   Trabaja sobre una copia temporal del repo, nunca sobre data/ real. */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const fails = [];
const check = (n, ok, extra = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${n}${extra ? ' → ' + extra : ''}`);
  if (!ok) fails.push(n);
};

// Copia de trabajo aislada
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-snap-'));
fs.mkdirSync(path.join(TMP, 'scripts'));
fs.mkdirSync(path.join(TMP, 'test'));
fs.copyFileSync(path.join(ROOT, 'scripts/snapshot.mjs'), path.join(TMP, 'scripts/snapshot.mjs'));

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/mock.json'), 'utf8'));
const DATA = path.join(TMP, 'data');

function run(mock, expectFail = false) {
  fs.writeFileSync(path.join(TMP, 'test/src.json'), JSON.stringify(mock));
  try {
    const out = execFileSync('node', ['scripts/snapshot.mjs'], {
      cwd: TMP, encoding: 'utf8', env: { ...process.env, FUEL_SOURCE: './test/src.json' }
    });
    if (expectFail) throw new Error('debía haber fallado y no falló');
    return out.trim();
  } catch (e) {
    if (expectFail) return 'ERROR: ' + (e.stderr || e.message).trim();
    throw e;
  }
}

const readCsv = f => fs.readFileSync(path.join(DATA, f), 'utf8').trim().split('\n');
const meta = () => JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const historyFiles = () => {
  const dir = path.join(DATA, 'history');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .filter(f => String(f).endsWith('.csv'))
    .map(f => path.join(dir, String(f)));
};

console.log('\n--- Primera captura ---');
console.log('  ' + run(base));
let m = meta();
check('Marca primeraCaptura', m.primeraCaptura === true);
check('8 estaciones válidas (descarta la de coordenadas 0,0)', m.estaciones === 8, String(m.estaciones));
check('Registra la fecha del Ministerio', m.fechaMinisterio === '16/08/2026 8:00:00', m.fechaMinisterio);

const st = readCsv('stations.csv');
check('stations.csv con cabecera y 8 filas', st.length === 9, st.length - 1 + ' filas');
check('Cabecera correcta', st[0] === 'id,rotulo,direccion,municipio,provincia,lat,lon,horario,venta', st[0]);
check('Conserva la venta restringida en el catálogo (la filtra la app, no el histórico)',
      st.some(l => l.includes('FLOTA SL') && l.trim().endsWith(',R')));
check('Entrecomilla y escapa direcciones con comas y comillas',
      st.some(l => l.includes('"AVDA VIRGEN DEL CARMEN, 12 ""EL CRUCE"""')),
      st.find(l => l.includes('VIRGEN')));

const pr = readCsv('prices.csv');
check('prices.csv con las 14 columnas de combustible', pr[0].split(',').length === 15, pr[0]);
check('Petroprix sin gasóleo A deja la celda vacía',
      pr.find(l => l.startsWith('6,')).split(',')[2] === '', pr.find(l => l.startsWith('6,')));

let hist = historyFiles();
check('Crea un fichero de histórico del día', hist.length === 1, hist.join());
let rows = fs.readFileSync(hist[0], 'utf8').trim().split('\n');
check('Cabecera del histórico', rows[0] === 'ts,id,combustible,precio', rows[0]);
check('La primera captura guarda todos los precios como línea base',
      rows.length - 1 === m.cambiosEnEstaCaptura, `${rows.length - 1} filas / ${m.cambiosEnEstaCaptura} cambios`);
check('Timestamp en UTC al minuto', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(rows[1].split(',')[0]), rows[1]);
const baseRows = rows.length;

console.log('\n--- Segunda captura, precios idénticos ---');
console.log('  ' + run(base));
m = meta();
check('No detecta ningún cambio', m.cambiosEnEstaCaptura === 0, String(m.cambiosEnEstaCaptura));
check('No añade filas al histórico', fs.readFileSync(hist[0], 'utf8').trim().split('\n').length === baseRows);
check('Ya no es primera captura', m.primeraCaptura === false);

console.log('\n--- Tercera captura, baja un precio ---');
const cambiado = JSON.parse(JSON.stringify(base));
cambiado.ListaEESSPrecio[3]['Precio Gasolina 95 E5'] = '1,299';   // Ballenoil 1,379 → 1,299
cambiado.Fecha = '16/08/2026 9:00:00';
console.log('  ' + run(cambiado));
m = meta();
check('Detecta exactamente 1 cambio', m.cambiosEnEstaCaptura === 1, String(m.cambiosEnEstaCaptura));
rows = fs.readFileSync(hist[0], 'utf8').trim().split('\n');
const ultima = rows[rows.length - 1].split(',');
check('La fila registra estación, combustible y precio nuevo',
      ultima[1] === '4' && ultima[2] === 'g95e5' && ultima[3] === '1.299', ultima.join(','));
check('prices.csv refleja el precio nuevo',
      readCsv('prices.csv').find(l => l.startsWith('4,')).split(',')[1] === '1.299');

console.log('\n--- Cuarta captura, cambio por debajo de la décima de milésima ---');
const casiIgual = JSON.parse(JSON.stringify(cambiado));
casiIgual.ListaEESSPrecio[3]['Precio Gasolina 95 E5'] = '1,2992';
console.log('  ' + run(casiIgual));
check('Ignora el ruido de redondeo', meta().cambiosEnEstaCaptura === 0, String(meta().cambiosEnEstaCaptura));

console.log('\n--- Nueva estación en el catálogo ---');
const conNueva = JSON.parse(JSON.stringify(cambiado));
conNueva.ListaEESSPrecio.push({ ...base.ListaEESSPrecio[0], IDEESS: '99', 'Rótulo': 'NUEVA', 'Latitud': '36,20', 'Longitud (WGS84)': '-5,40' });
console.log('  ' + run(conNueva));
m = meta();
check('Cuenta 1 estación nueva', m.estacionesNuevas === 1, String(m.estacionesNuevas));
check('Y la añade al catálogo', readCsv('stations.csv').some(l => l.includes('NUEVA')));

console.log('\n--- Salvaguarda contra respuestas anómalas ---');
const grande = { Fecha: '16/08/2026 10:00:00', ListaEESSPrecio: [] };
for (let i = 0; i < 400; i++) {
  grande.ListaEESSPrecio.push({ ...base.ListaEESSPrecio[0], IDEESS: String(1000 + i) });
}
run(grande);
const antes = readCsv('stations.csv').length;
const salida = run({ Fecha: 'x', ListaEESSPrecio: base.ListaEESSPrecio.slice(0, 3) }, true);
check('Rechaza un catálogo que se desploma a la mitad', /anómala/i.test(salida), salida.slice(0, 120));
check('Y no toca los ficheros existentes', readCsv('stations.csv').length === antes,
      `${readCsv('stations.csv').length} vs ${antes}`);

console.log('\n--- Origen sin estaciones válidas ---');
const vacio = run({ Fecha: 'x', ListaEESSPrecio: [] }, true);
check('Falla de forma controlada', /0 estaciones/.test(vacio), vacio.slice(0, 120));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n✖ ${fails.length} comprobaciones fallidas` : '\n✔ Recolector OK');
process.exit(fails.length ? 1 : 0);
