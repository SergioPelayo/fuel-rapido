/* Comprobaciones de promos.js — la lógica de descuentos, sin navegador.
   Lo que de verdad se vigila aquí: que nunca se muestre una cifra que no esté
   verificada en el fichero, y que lo caducado desaparezca solo. */

import { createRequire } from 'module';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* promos.js guarda el perfil en localStorage; en Node lo imitamos para poder
   comprobar también que persiste. */
const almacen = new Map();
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k)
};

const Promos = require(path.join(ROOT, 'promos.js'));
const FICHERO = JSON.parse(readFileSync(path.join(ROOT, 'promociones.json'), 'utf8'));

const fails = [];
function check(name, cond, extra = '') {
  (cond ? console.log : (m => { fails.push(name); console.log(m); }))(
    `${cond ? '  OK  ' : ' FAIL '} ${name}${extra ? ' → ' + extra : ''}`);
}
const ids = () => Promos.programas().map(p => p.id).sort().join(',');

console.log('--- El fichero de datos ---');
check('promociones.json es la v1.2', FICHERO._version === '1.2', FICHERO._version);
check('Cada programa declara con qué plan oficial se contrasta, o que no consta',
      FICHERO.programas.every(p => p.oficial && 'nombre' in p.oficial && p.oficial.nota));
check('Trae los seis programas', FICHERO.programas.length === 6, String(FICHERO.programas.length));
check('Todos declaran rótulos', FICHERO.programas.every(p => Array.isArray(p.rotulos) && p.rotulos.length));
check('Todos declaran fuente y fecha de verificación',
      FICHERO.programas.every(p => /^https?:/.test(p.fuente) && /^\d{4}-\d{2}-\d{2}$/.test(p.verificado)));
check('Ningún rótulo pertenece a dos programas', (() => {
  const v = {};
  FICHERO.programas.forEach(p => p.rotulos.forEach(r => { v[r] = (v[r] || 0) + 1; }));
  return Object.values(v).every(n => n === 1);
})());

console.log('\n--- Qué se muestra hoy (17/10/2026) ---');
Promos.cargar(FICHERO, '2026-10-17');
check('Se muestran cinco programas', Promos.programas().length === 5, ids());
check('Mundo Galp queda fuera por no estar verificado',
      !Promos.programas().some(p => p.id === 'mundo_galp'), ids());
check('Ballenoil entra aunque no tenga tramos, porque tiene promoción fija',
      Promos.programas().some(p => p.id === 'ballenoil'));
check('Los ocultos se explican', Promos.ocultos('2026-10-17').some(o => /Galp/.test(o.nombre) && /sin verificar/.test(o.motivo)),
      JSON.stringify(Promos.ocultos('2026-10-17')));

console.log('\n--- Emparejado de rótulos del Ministerio ---');
check('REPSOL → Waylet', Promos.para('REPSOL')?.id === 'waylet');
check('CAMPSA → Waylet', Promos.para('CAMPSA')?.id === 'waylet');
check('PETRONOR → Waylet', Promos.para('PETRONOR')?.id === 'waylet');
check('CEPSA → Moeve gow', Promos.para('CEPSA')?.id === 'moeve_gow');
check('MOEVE → Moeve gow', Promos.para('MOEVE')?.id === 'moeve_gow');
check('BP → Mi BP', Promos.para('BP')?.id === 'mibp');
check('SHELL → Mi Energía DISA', Promos.para('SHELL')?.id === 'mi_energia_disa');
check('SHELL EXPRESS → Mi Energía DISA', Promos.para('SHELL EXPRESS')?.id === 'mi_energia_disa');
check('DISA → Mi Energía DISA', Promos.para('DISA')?.id === 'mi_energia_disa');
check('Rótulo real con prefijo: «E.S. REPSOL LOS BARRIOS» → Waylet',
      Promos.para('E.S. REPSOL LOS BARRIOS')?.id === 'waylet');
check('Rótulo con tildes y signos: «Estación Cepsa, S.A.» → Moeve gow',
      Promos.para('Estación Cepsa, S.A.')?.id === 'moeve_gow');
check('GALP no empareja: está sin confirmar', Promos.para('GALP') === null);
check('PLENOIL no tiene programa', Promos.para('PLENOIL') === null);
check('PETROPRIX no tiene programa', Promos.para('PETROPRIX') === null);
check('Rótulo vacío no revienta', Promos.para('') === null && Promos.para(null) === null);
check('«BPOIL» no se confunde con BP', Promos.para('BPOIL') === null);

console.log('\n--- Nada se muestra sin que el usuario lo active ---');
check('Sin perfil no hay avisos', Promos.aviso('REPSOL') === null);
check('Sin perfil el descuento es cero', Promos.cts('REPSOL') === 0);
check('Sin perfil, cero programas elegidos', Promos.cuantos() === 0);

console.log('\n--- El usuario declara su tramo ---');
Promos.elegir('waylet', 'coche');
check('Waylet activado', Promos.activo('waylet') && Promos.cuantos() === 1);
check('Tramo base: 10 cts', Promos.aviso('REPSOL').cts === 10, String(Promos.aviso('REPSOL').cts));
Promos.elegir('waylet', 'coche_luzygas');
check('Sube a coche + luz + gas: 30 cts', Promos.aviso('REPSOL').cts === 30, String(Promos.aviso('REPSOL').cts));
check('El aviso dice qué tramo es', /luz \+ gas/i.test(Promos.aviso('REPSOL').tramo), Promos.aviso('REPSOL').tramo);
Promos.elegir('waylet', 'inventado');
check('Un tramo inexistente cae al más bajo, nunca al más alto',
      Promos.aviso('REPSOL').cts === 10, String(Promos.aviso('REPSOL').cts));
check('El perfil persiste en localStorage', /waylet/.test(almacen.get('fr.promos') || ''), almacen.get('fr.promos'));
check('Activar Waylet no afecta a otras cadenas', Promos.aviso('CEPSA') === null);
Promos.elegir('waylet', null);
check('Se puede desactivar', !Promos.activo('waylet') && Promos.aviso('REPSOL') === null);

console.log('\n--- Saldo no es precio ---');
Promos.elegir('waylet', 'coche');
Promos.elegir('moeve_gow', 'base');
Promos.elegir('mibp', 'base');
Promos.elegir('mi_energia_disa', 'premium');
check('Waylet es saldo', Promos.aviso('REPSOL').tipo === 'saldo' && Promos.aviso('REPSOL').inmediato === false);
check('Moeve gow es saldo', Promos.aviso('CEPSA').inmediato === false);
check('Mi BP es saldo', Promos.aviso('BP').inmediato === false);
check('Mi Energía DISA es el único inmediato',
      Promos.aviso('SHELL').inmediato === true && Promos.aviso('SHELL').tipo === 'inmediato');
check('El aviso explica la naturaleza del descuento',
      /saldo/i.test(Promos.aviso('REPSOL').tipoNota), Promos.aviso('REPSOL').tipoNota.slice(0, 50));
check('Mi BP arrastra su tope mensual', /24/.test(Promos.aviso('BP').topes), Promos.aviso('BP').topes);

console.log('\n--- Ninguna cifra sale de la nada ---');
const delFichero = new Set();
FICHERO.programas.forEach(p => (p.tramos || []).forEach(t => delFichero.add(p.id + ':' + t.cts)));
check('Todo céntimo mostrado está escrito en el fichero',
      ['REPSOL', 'CEPSA', 'BP', 'SHELL'].every(r => {
        const a = Promos.aviso(r);
        return a.cts === 0 || delFichero.has(a.id + ':' + a.cts);
      }));
check('Ballenoil no promete céntimos, sino su euro de bienvenida', (() => {
  Promos.elegir('ballenoil', null);
  Promos.elegir('ballenoil', '_');
  const a = Promos.aviso('BALLENOIL');
  return a && a.cts === 0 && a.euros === 1;
})());

console.log('\n--- Lo caducado desaparece solo ---');
Promos.cargar(FICHERO, '2026-11-05');
check('El 5 de noviembre Waylet ya no se muestra (caducó el 31/10)',
      !Promos.programas().some(p => p.id === 'waylet'), ids());
check('Y se explica por qué', Promos.ocultos('2026-11-05').some(o => /Waylet/.test(o.nombre) && /caducada/.test(o.motivo)),
      JSON.stringify(Promos.ocultos('2026-11-05').filter(o => /Waylet/.test(o.nombre))));
check('Al desaparecer, se limpia del perfil del usuario', !Promos.activo('waylet'));
check('REPSOL deja de emparejar', Promos.para('REPSOL') === null);
check('Moeve gow sigue vivo hasta el 30/11', Promos.programas().some(p => p.id === 'moeve_gow'));
Promos.cargar(FICHERO, '2026-12-05');
check('El 5 de diciembre tampoco está Moeve gow',
      !Promos.programas().some(p => p.id === 'moeve_gow'), ids());
check('Los permanentes aguantan: Mi BP y Mi Energía DISA',
      Promos.programas().some(p => p.id === 'mibp') && Promos.programas().some(p => p.id === 'mi_energia_disa'), ids());

console.log('\n--- La app avisa cuando la revisión se queda vieja ---');
Promos.cargar(FICHERO, '2026-10-17');
check('Hoy la revisión tiene 0 días', Promos.dias('2026-10-17') === 0, String(Promos.dias('2026-10-17')));
check('A los 30 días aún no avisa', Promos.vencida('2026-11-16') === false);
check('A los 45 días justos aún no avisa', Promos.vencida('2026-12-01') === false, String(Promos.dias('2026-12-01')));
check('A los 46 días avisa', Promos.vencida('2026-12-02') === true, String(Promos.dias('2026-12-02')));
check('Cuenta bien los días', Promos.dias('2026-12-05') === 49, String(Promos.dias('2026-12-05')));

console.log('\n--- Si el fichero falta o viene roto, la app no se rompe ---');
check('Sin fichero, lista vacía', Promos.cargar(null).length === 0 && Promos.hayDatos() === false);
check('Sin fichero no hay avisos', Promos.aviso('REPSOL') === null && Promos.cts('REPSOL') === 0);
check('Sin fichero no hay fecha de revisión', Promos.dias() === null && Promos.vencida() === false);
check('JSON sin la clave programas', Promos.cargar({ _version: 'x' }).length === 0);
check('Programa sin id se ignora', Promos.cargar({ programas: [{ nombre: 'X', confianza: 'alta', tramos: [{ cts: 99 }] }] }).length === 0);
check('Un programa verificado pero sin nada que contar se ignora',
      Promos.cargar({ programas: [{ id: 'z', nombre: 'Z', confianza: 'alta', rotulos: ['Z'], tramos: [], extras: [] }] }).length === 0);
check('Fecha formateada para la interfaz', Promos.fecha('2026-10-17') === '17/10', Promos.fecha('2026-10-17'));
check('Fecha vacía no revienta', Promos.fecha('') === '' && Promos.fecha(null) === '');

console.log('\n--- Registro oficial del Ministerio (scripts/planes.mjs) ---');
/* El parser se prueba de punta a punta: se ejecuta el recolector contra el
   fixture XML y se lee lo que escribe, igual que hará el bot cada día. */
const TMP = mkdtempSync(path.join(tmpdir(), 'fr-planes-'));
mkdirSync(path.join(TMP, 'scripts'));
execFileSync('node', [path.join(ROOT, 'scripts/planes.mjs')], {
  cwd: TMP, stdio: 'ignore',
  env: { ...process.env, FUEL_PLANES_SOURCE: path.join(ROOT, 'test/planes-mock.xml') }
});
const REG = JSON.parse(readFileSync(path.join(TMP, 'data/planes-oficiales.json'), 'utf8'));

check('Lee los diez planes del fixture', REG._total === 10, String(REG._total));
check('Marca como útiles sólo los que traen cifra y unidad', REG._utiles === 8, String(REG._utiles));
check('El cero de relleno no cuenta como cifra útil',
      REG.planes.find(p => p.nombre === 'Repsol Más').util === false);
check('Un plan sin cuantía declarada tampoco',
      REG.planes.find(p => p.nombre === 'Solred Más').util === false);
check('Distingue céntimos por litro de porcentaje',
      REG.planes.find(p => p.nombre === 'Repsol Máxima').unidad === '%' &&
      REG.planes.find(p => p.nombre === 'Programa miBP').unidad === 'cts/litro');
check('Convierte la cuantía a número', REG.planes.find(p => p.nombre === 'Programa miBP').cifra === 3);
check('Conserva los decimales reales',
      REG.planes.find(p => /EUROTRAFIC/.test(p.nombre)).cifra === 1.1);
check('Un mismo plan en dos operadores se guarda por separado',
      REG.planes.filter(p => p.nombre === 'MI ENERGIA DISA').length === 2,
      JSON.stringify(REG.planes.filter(p => p.nombre === 'MI ENERGIA DISA').map(p => p.cifra)));
check('Guarda el segmento de destinatario, que es lo que no usa nadie',
      [...new Set(REG.planes.map(p => p.destinatario))].length === 4,
      [...new Set(REG.planes.map(p => p.destinatario))].join(' | '));
check('Desescapa las entidades XML',
      REG.planes.some(p => p.nombre === 'tamoil club & co'),
      REG.planes.map(p => p.nombre).join(' | '));
check('Anota la fecha de lectura', /^\d{4}-\d{2}-\d{2}T/.test(REG._leido), REG._leido);
check('Y avisa de que el registro no lleva fechas de validez', /no sustituyen/i.test(REG._aviso));

console.log('\n--- Contraste: qué confirma el registro y qué no ---');
Promos.cargar(FICHERO, '2026-10-17');
check('Sin registro cargado no hay contraste', Promos.contraste().length === 0 && Promos.hayOficiales() === false);
Promos.cargarOficiales(REG);
check('Con registro cargado, hay contraste', Promos.hayOficiales() === true);
const porId = Object.fromEntries(Promos.contraste().map(x => [x.id, x]));
check('Mi BP: el registro confirma nuestra cifra',
      porId.mibp.estado === 'coincide' && porId.mibp.oficialCts === 3, JSON.stringify(porId.mibp));
check('Mi Energía DISA: el registro confirma los 5 cts',
      porId.mi_energia_disa.estado === 'coincide' && porId.mi_energia_disa.oficialCts === 5,
      JSON.stringify(porId.mi_energia_disa));
check('Waylet: no figura en el registro, y se dice',
      porId.waylet.estado === 'no_consta', JSON.stringify(porId.waylet));
check('Moeve gow tampoco', porId.moeve_gow.estado === 'no_consta');
check('Ballenoil tampoco', porId.ballenoil.estado === 'no_consta');
check('El contraste NO altera ninguna cifra mostrada',
      Promos.programa('mibp').tramos[0].cts === 3 && Promos.programa('mi_energia_disa').tramos[0].cts === 5);
check('Un programa cuyo plan desaparezca del registro se marca para revisar', (() => {
  const recortado = { ...REG, planes: REG.planes.filter(p => p.nombre !== 'Programa miBP') };
  Promos.cargarOficiales(recortado);
  const r = Promos.contraste().find(x => x.id === 'mibp');
  Promos.cargarOficiales(REG);
  return r.estado === 'desaparecido';
})());
check('Si el registro declara una cifra fuera de nuestro rango, se marca discrepancia', (() => {
  const torcido = { ...REG, planes: REG.planes.map(p => p.nombre === 'Programa miBP' ? { ...p, cifra: 25 } : p) };
  Promos.cargarOficiales(torcido);
  const r = Promos.contraste().find(x => x.id === 'mibp');
  Promos.cargarOficiales(REG);
  return r.estado === 'discrepa' && r.oficialCts === 25;
})());
check('Un registro vacío o roto no rompe nada',
      Promos.cargarOficiales(null) === null && Promos.contraste().length === 0 &&
      Promos.cargarOficiales({ planes: [] }) !== undefined);

rmSync(TMP, { recursive: true, force: true });

console.log(fails.length ? `\n✖ ${fails.length} comprobaciones fallidas` : '\n✔ Todas las comprobaciones OK');
process.exit(fails.length ? 1 : 0);
