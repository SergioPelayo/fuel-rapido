/* Comprobaciones de las series por estación, las estadísticas de 30 días
   y los agregados de mercado. Simula 10 días consecutivos de capturas
   sobre un parque sintético de 60 estaciones, 2 provincias y 3 marcas. */

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-serie-'));
fs.mkdirSync(path.join(TMP, 'scripts'));
fs.mkdirSync(path.join(TMP, 'test'));
fs.copyFileSync(path.join(ROOT, 'scripts/snapshot.mjs'), path.join(TMP, 'scripts/snapshot.mjs'));
const DATA = path.join(TMP, 'data');

const MARCAS = ['REPSOL', 'CEPSA', 'BALLENOIL'];
const PROVS = ['CÁDIZ', 'MÁLAGA'];

/* Estación 4 = la que se mueve. El resto, fijas y siempre más caras. */
function parque(precioMovil) {
  const lista = [];
  for (let i = 1; i <= 60; i++) {
    const esMovil = i === 4;
    const g95 = esMovil ? precioMovil : 1.550 + (i % 7) * 0.01;
    lista.push({
      'IDEESS': String(i),
      'Rótulo': MARCAS[i % 3],
      'Dirección': `CALLE ${i}`,
      'Municipio': `MUNI ${i % 5}`,
      'Provincia': PROVS[i % 2],
      'Latitud': String(36 + i / 1000).replace('.', ','),
      'Longitud (WGS84)': String(-5.4 - i / 1000).replace('.', ','),
      'Horario': 'L-D: 24H',
      'Tipo Venta': 'P',
      'Precio Gasolina 95 E5': g95.toFixed(3).replace('.', ','),
      'Precio Gasoleo A': (g95 - 0.05).toFixed(3).replace('.', ',')
    });
  }
  return { Fecha: '10/08/2026 9:00:00', ListaEESSPrecio: lista, Nota: 'sintético' };
}

function capturar(mock, fechaISO) {
  fs.writeFileSync(path.join(TMP, 'test/src.json'), JSON.stringify(mock));
  return execFileSync('node', ['scripts/snapshot.mjs'], {
    cwd: TMP, encoding: 'utf8',
    env: { ...process.env, FUEL_SOURCE: './test/src.json', FUEL_STAMP: fechaISO }
  }).trim();
}

const csv = f => fs.readFileSync(path.join(DATA, f), 'utf8').trim().split('\n');
const meta = () => JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));

const PRECIOS = [1.500, 1.500, 1.460, 1.460, 1.400, 1.400, 1.400, 1.360, 1.320, 1.320];
const MEDIA_ESPERADA = (PRECIOS.reduce((a, b) => a + b, 0) / PRECIOS.length).toFixed(4);

console.log('\n--- 10 días de capturas (60 estaciones) ---');
PRECIOS.forEach((p, i) => {
  capturar(parque(p), `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`);
});
console.log(`  del 1 al 10 de agosto · la estación 4 baja de ${PRECIOS[0]} a ${PRECIOS[9]}`);

console.log('\n--- Serie por estación ---');
const serieFile = path.join(DATA, 'series', '04', '4.csv');
check('El fichero va en su carpeta por los 2 últimos dígitos del id',
      fs.existsSync(serieFile), path.relative(DATA, serieFile));
const serie = fs.readFileSync(serieFile, 'utf8').trim().split('\n');
check('Cabecera de la serie', serie[0] === 'ts,combustible,precio', serie[0]);
const g95 = serie.slice(1).filter(l => l.includes(',g95e5,'));
check('Guarda los 5 cambios reales, no los 10 días',
      g95.length === 5, `${g95.length} filas: ${g95.map(l => l.split(',')[2]).join(' ')}`);
check('Del 1.500 inicial al 1.320 final',
      g95[0].endsWith(',1.500') && g95.at(-1).endsWith(',1.320'), g95[0] + ' … ' + g95.at(-1));
check('La serie completa de una estación cabe en menos de 1 KB',
      fs.statSync(serieFile).size < 1024, fs.statSync(serieFile).size + ' bytes');
const quieta = fs.readFileSync(path.join(DATA, 'series', '02', '2.csv'), 'utf8').trim().split('\n');
check('Una estación que no se mueve guarda sólo su línea base',
      quieta.length === 3, quieta.length - 1 + ' cambios');

console.log('\n--- Estadísticas de 30 días ---');
const stats = csv('stats.csv');
check('Cabecera de stats', stats[0] === 'id,combustible,actual,min30,max30,media30,dias', stats[0]);
const [, , actual, min30, max30, media30, dias] = stats.find(l => l.startsWith('4,g95e5,')).split(',');
check('actual = 1.320', actual === '1.320');
check('min30 = 1.320', min30 === '1.320');
check('max30 = 1.500', max30 === '1.500');
check('10 cierres diarios reconstruidos arrastrando el precio entre cambios',
      dias === '10', dias);
check(`media30 = ${MEDIA_ESPERADA} (media de cierres diarios, no de los cambios)`,
      media30 === MEDIA_ESPERADA, media30);
check('Todas las estaciones tienen estadística de los 2 combustibles',
      stats.length - 1 === 120, stats.length - 1 + ' filas');

console.log('\n--- Agregados de mercado ---');
const nac = csv('market/nacional.csv');
check('Cabecera nacional', nac[0] === 'fecha,combustible,estaciones,min,media,mediana,max', nac[0]);
check('10 días × 2 combustibles = 20 filas', nac.length - 1 === 20, nac.length - 1 + ' filas');
check('Sin días duplicados',
      new Set(nac.slice(1).map(l => l.split(',').slice(0, 2).join('|'))).size === 20);
const d10 = nac.slice(1).find(l => l.startsWith('2026-08-10,g95e5,')).split(',');
check('El mínimo nacional del día 10 es la estación que bajó (1.320)', d10[3] === '1.320', d10.join(','));
check('Cuenta las 60 estaciones', d10[2] === '60', d10[2]);
const d1 = nac.slice(1).find(l => l.startsWith('2026-08-01,g95e5,')).split(',');
check('El mínimo del día 1 era mayor', Number(d1[3]) > Number(d10[3]), `${d1[3]} → ${d10[3]}`);

const prov = csv('market/provincias.csv');
check('Cabecera provincias', prov[0] === 'fecha,provincia,combustible,estaciones,media,min', prov[0]);
check('10 días × 2 provincias × 2 combustibles = 40 filas', prov.length - 1 === 40, prov.length - 1 + ' filas');
check('Conserva las tildes de la provincia', prov.some(l => l.includes('CÁDIZ')));

const mar = csv('market/marcas.csv');
check('Cabecera marcas', mar[0] === 'fecha,marca,combustible,estaciones,media,min', mar[0]);
check('10 días × 3 marcas × 2 combustibles = 60 filas', mar.length - 1 === 60, mar.length - 1 + ' filas');
const marcaMovil = MARCAS[4 % 3];   // la marca a la que pertenece la estación 4
const delDia = mar.slice(1).filter(l => l.startsWith('2026-08-10,') && l.includes(',g95e5,'))
  .map(l => l.split(','));
const masBarata = delDia.sort((a, b) => Number(a[5]) - Number(b[5]))[0];
check(`La marca de la estación que bajó (${marcaMovil}) es la más barata del día 10`,
      masBarata[1] === marcaMovil && Number(masBarata[5]) === 1.320,
      `${masBarata[1]} min ${masBarata[5]}`);

console.log('\n--- Reejecutar el mismo día no duplica nada ---');
const antes = { nac: csv('market/nacional.csv').length, prov: csv('market/provincias.csv').length };
capturar(parque(1.320), '2026-08-10T21:00:00.000Z');
check('nacional.csv mantiene las filas', csv('market/nacional.csv').length === antes.nac,
      `${csv('market/nacional.csv').length} vs ${antes.nac}`);
check('provincias.csv mantiene las filas', csv('market/provincias.csv').length === antes.prov);
check('La serie no crece si el precio no ha cambiado',
      fs.readFileSync(serieFile, 'utf8').trim().split('\n').filter(l => l.includes(',g95e5,')).length === 5);

console.log('\n--- Volumen ---');
const du = Number(execFileSync('du', ['-sk', DATA], { encoding: 'utf8' }).split('\t')[0]);
check('60 estaciones × 10 días ocupan poco', du < 800, du + ' KB');
check('meta.json informa de lo generado',
      meta().estadisticasCalculadas === 120 && meta().mercado.nacional === 2,
      JSON.stringify(meta().mercado));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n✖ ${fails.length} comprobaciones fallidas` : '\n✔ Series y mercado OK');
process.exit(fails.length ? 1 : 0);
