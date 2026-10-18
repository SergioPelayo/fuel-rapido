/* ============================================================
   Fuel Rápido — promos.js
   Descuentos de las apps de fidelización de las cadenas.

   Tres reglas que no se negocian, porque son las que hacen honesto el dato:

   1. EL DESCUENTO NUNCA SE SUMA AL PRECIO OFICIAL. El orden por defecto lo
      sigue marcando el precio del Ministerio. Esto es un aviso al lado, no
      un recálculo. Sólo si el usuario activa a mano «Con mi descuento» se
      reordena, y entonces la cifra va etiquetada como estimada.

   2. SALDO NO ES PRECIO. Waylet, Moeve gow y Mi BP devuelven saldo en su
      app, no bajan el surtidor. Se dice en cada aviso. El único verificado
      que descuenta al pagar es Mi Energía DISA.

   3. LO NO VERIFICADO NO SE MUESTRA. Un programa con confianza
      «sin_confirmar», o con la campaña caducada, desaparece de la app hasta
      que una revisión lo confirme. Preferimos callar que mentir. Y si la
      revisión se queda vieja, la app lo dice sola.

   El fichero de datos es promociones.json, en la raíz. Lo mantiene a mano
   una revisión mensual: no hay API de descuentos, ni la habrá.
   ============================================================ */

'use strict';

const Promos = (() => {

  const CLAVE = 'fr.promos';

  let datos  = null;          // el fichero tal cual
  let lista  = [];            // sólo los mostrables
  let perfil = leerPerfil();  // { idPrograma: idTramo }

  /* Misma normalización que marcas.js: mayúsculas, sin tildes, sin signos.
     El rótulo del Ministerio llega sucio y desigual. */
  const limpia = s => String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hoy = () => new Date().toISOString().slice(0, 10);

  /* ---------- Perfil del usuario (sólo en su dispositivo) ---------- */

  function leerPerfil() {
    try {
      const v = JSON.parse(localStorage.getItem(CLAVE) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  function guardarPerfil() {
    try { localStorage.setItem(CLAVE, JSON.stringify(perfil)); } catch (e) { /* modo privado */ }
  }

  /* ---------- Carga ---------- */

  /* Un programa se muestra si está verificado y su campaña sigue viva.
     Que `caduca` haya pasado no significa que el programa haya muerto: significa
     que ya no respondemos de sus cifras. Así que se retira y la app lo marca
     como pendiente de revisión. Es el error conservador. */
  function vigente(p, ref) {
    if (!p || !p.id) return false;
    if (p.confianza === 'sin_confirmar') return false;
    if (p.caduca && p.caduca < ref) return false;
    return true;
  }

  function motivoOculto(p, ref) {
    if (p.confianza === 'sin_confirmar') return 'sin verificar';
    if (p.caduca && p.caduca < ref) return 'campaña caducada el ' + fecha(p.caduca);
    return '';
  }

  /* Puro, sin red: recibe el JSON ya parseado. `ref` permite simular la fecha. */
  function cargar(json, ref = hoy()) {
    datos = json || null;
    lista = [];
    if (!datos || !Array.isArray(datos.programas)) return lista;

    lista = datos.programas.filter(p => vigente(p, ref));

    // Un programa sin tramos ni extras no tiene nada que contar
    lista = lista.filter(p => (p.tramos && p.tramos.length) || (p.extras && p.extras.length));

    // Limpiamos del perfil lo que ya no existe o ha dejado de ser mostrable
    let toco = false;
    for (const id in perfil) {
      if (!lista.some(p => p.id === id)) { delete perfil[id]; toco = true; }
    }
    if (toco) guardarPerfil();
    return lista;
  }

  /* Con red. `grab` se inyecta para no duplicar la lógica de fetch de app.js. */
  async function init(grab, ref = hoy()) {
    try {
      const json = typeof grab === 'function'
        ? await grab('promociones.json', 'json')
        : await fetch('promociones.json').then(r => r.json());
      return cargar(json, ref);
    } catch (e) {
      datos = null; lista = [];
      return lista;
    }
  }

  /* ---------- Consultas ---------- */

  const programas = () => lista.slice();

  function ocultos(ref = hoy()) {
    if (!datos || !Array.isArray(datos.programas)) return [];
    return datos.programas
      .filter(p => !vigente(p, ref))
      .map(p => ({ nombre: p.nombre, cadena: p.cadena, motivo: motivoOculto(p, ref) }));
  }

  /* Programa que le corresponde a un rótulo, mostrable o no elegido aún. */
  function para(rotulo) {
    const clave = limpia(rotulo);
    if (!clave) return null;
    for (const p of lista) {
      for (const r of (p.rotulos || [])) {
        const k = limpia(r);
        if (!k) continue;
        if (clave === k || clave.startsWith(k + ' ') || clave.includes(' ' + k)) return p;
      }
    }
    return null;
  }

  const activo  = id => Object.prototype.hasOwnProperty.call(perfil, id);
  const elegido = id => perfil[id] || null;

  function programa(id) { return lista.find(p => p.id === id) || null; }

  function tramo(p, idTramo) {
    if (!p || !p.tramos || !p.tramos.length) return null;
    return p.tramos.find(t => t.id === idTramo) || p.tramos[0];
  }

  /* Activar, cambiar de tramo o desactivar. Al activar se elige el tramo más
     bajo: nunca prometemos de más por defecto. */
  function elegir(id, idTramo) {
    const p = programa(id);
    if (!p) return false;
    if (idTramo === null || idTramo === false) {
      delete perfil[id];
    } else {
      const t = tramo(p, idTramo);
      perfil[id] = t ? t.id : '_';
    }
    guardarPerfil();
    return true;
  }

  function olvidar() { perfil = {}; guardarPerfil(); }

  const nada = { n: 0 };
  const cuantos = () => Object.keys(perfil).length;

  /* El aviso de una estación, ya filtrado por lo que el usuario tiene activo.
     Devuelve null si no hay nada que decirle. */
  function aviso(rotulo) {
    const p = para(rotulo);
    if (!p || !activo(p.id)) return null;
    const t = tramo(p, elegido(p.id));
    const fijos = (p.extras || []).filter(e => e.euros);

    return {
      id: p.id,
      nombre: p.nombre,
      cadena: p.cadena,
      tipo: p.tipo,                        // 'saldo' | 'inmediato' | 'promocional'
      inmediato: p.tipo === 'inmediato',
      cts: t && t.cts ? t.cts : 0,
      tramo: t ? t.etiqueta : '',
      tramoNota: t && t.nota ? t.nota : '',
      euros: fijos.length ? fijos[0].euros : 0,
      eurosEtiqueta: fijos.length ? fijos[0].etiqueta : '',
      tipoNota: p.tipo_nota || '',
      requiere: p.requiere || '',
      topes: p.topes || '',
      caduca: p.caduca || null,
      extras: p.extras || [],
      fuente: p.fuente || '',
      verificado: p.verificado || '',
      confianza: p.confianza || ''
    };
  }

  /* Céntimos por litro que el usuario dice tener en esa estación. Es lo único
     que entra en el modo «Con mi descuento», y sólo si él lo activa. */
  function cts(rotulo) {
    const a = aviso(rotulo);
    return a ? a.cts : 0;
  }

  /* ---------- Frescura de la revisión ---------- */

  function revision() {
    return (datos && datos._revision) || {};
  }

  function dias(ref = hoy()) {
    const u = revision().ultima;
    if (!u) return null;
    const d = (Date.parse(ref) - Date.parse(u)) / 86400000;
    return Number.isFinite(d) ? Math.floor(d) : null;
  }

  function vencida(ref = hoy()) {
    const d = dias(ref);
    const tope = Number(revision().avisar_si_supera_dias) || 45;
    return d !== null && d > tope;
  }

  /* 2026-10-17 → 17/10 */
  function fecha(iso) {
    if (!iso || iso.length < 10) return '';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7);
  }

  const version = () => (datos && datos._version) || '';
  const hayDatos = () => lista.length > 0;

  /* ---------- Registro oficial del Ministerio ----------
     Las operadoras están obligadas a declarar sus planes de descuento, y el
     Geoportal los publica. Lo usamos SÓLO como segunda fuente para contrastar
     nuestras cifras, nunca como dato que se muestre al conductor: el registro
     no lleva fechas de validez (2 de 84 planes) y arrastra promociones de
     lanzamiento. Lo recoge scripts/planes.mjs una vez al día. */

  let oficial = null;

  function cargarOficiales(json) {
    oficial = (json && Array.isArray(json.planes)) ? json : null;
    return oficial;
  }

  async function initOficiales(grab) {
    try {
      const json = typeof grab === 'function'
        ? await grab('data/planes-oficiales.json', 'json')
        : await fetch('data/planes-oficiales.json').then(r => r.json());
      return cargarOficiales(json);
    } catch (e) { oficial = null; return null; }
  }

  const hayOficiales = () => !!(oficial && oficial.planes.length);
  const oficiales    = () => (oficial ? oficial.planes.slice() : []);
  const leidoEl      = () => (oficial && oficial._leido ? oficial._leido.slice(0, 10) : '');

  /* Para cada programa nuestro: ¿qué dice el registro? Cuatro respuestas
     posibles, y «no consta» es tan informativa como las demás. */
  function contraste() {
    if (!hayOficiales()) return [];
    return lista.map(p => {
      const enl = p.oficial || {};
      const nuestras = (p.tramos || []).map(t => t.cts).filter(n => typeof n === 'number');

      if (!enl.nombre) {
        return { id: p.id, nombre: p.nombre, estado: 'no_consta', nuestrasCts: nuestras, oficialCts: null, nota: enl.nota || '' };
      }
      const plan = oficial.planes.find(x =>
        limpia(x.nombre) === limpia(enl.nombre) &&
        (!enl.operador || limpia(x.operador) === limpia(enl.operador)));

      if (!plan) return { id: p.id, nombre: p.nombre, estado: 'desaparecido', nuestrasCts: nuestras, oficialCts: null, nota: enl.nota || '' };
      if (!plan.util || plan.unidad !== 'cts/litro') {
        return { id: p.id, nombre: p.nombre, estado: 'sin_cifra', nuestrasCts: nuestras, oficialCts: null, nota: enl.nota || '' };
      }

      const dentro = nuestras.length
        ? plan.cifra >= Math.min(...nuestras) && plan.cifra <= Math.max(...nuestras)
        : false;
      return {
        id: p.id, nombre: p.nombre,
        estado: dentro ? 'coincide' : 'discrepa',
        oficialCts: plan.cifra,
        nuestrasCts: nuestras,
        operador: plan.operador,
        nota: enl.nota || ''
      };
    });
  }

  return {
    cargar, init, programas, ocultos, para, programa, tramo,
    activo, elegido, elegir, olvidar, cuantos, aviso, cts,
    revision, dias, vencida, fecha, version, hayDatos, limpia, nada,
    cargarOficiales, initOficiales, hayOficiales, oficiales, leidoEl, contraste
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Promos;
