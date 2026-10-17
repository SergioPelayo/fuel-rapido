/* Comprobaciones de promos.js — la lógica de descuentos, sin navegador.
   Lo que de verdad se vigila aquí: que nunca se muestre una cifra que no esté
   verificada en el fichero, y que lo caducado desaparezca solo. */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
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
check('promociones.json es la v1.1', FICHERO._version === '1.1', FICHERO._version);
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

console.log(fails.length ? `\n✖ ${fails.length} comprobaciones fallidas` : '\n✔ Todas las comprobaciones OK');
process.exit(fails.length ? 1 : 0);
