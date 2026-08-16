/* ============================================================
   Fuel Rápido — marcas.js
   Distintivo visual por cadena de gasolineras.

   NO usamos los logotipos oficiales: son marcas registradas y empaquetarlos
   en el repositorio sería un problema legal. En su lugar generamos un
   distintivo propio con el COLOR CORPORATIVO de cada cadena y sus iniciales,
   que se reconoce igual de rápido, pesa cero y no depende de nadie.

   Para añadir una cadena: una línea en MARCAS. La clave se compara en
   mayúsculas y sin tildes contra el rótulo del Ministerio.
   ============================================================ */

'use strict';

const Marcas = (() => {

  /* clave (como aparece en el rótulo del Ministerio) → [color, iniciales] */
  const MARCAS = {
    'REPSOL':        ['#f58220', 'R'],
    'CAMPSA':        ['#e2001a', 'C'],
    'PETRONOR':      ['#f58220', 'PN'],
    'CEPSA':         ['#e4002b', 'CE'],
    'MOEVE':         ['#00a9a5', 'M'],
    'BP':            ['#009a44', 'BP'],
    'SHELL':         ['#fbce07', 'SH'],
    'GALP':          ['#ff6b00', 'G'],
    'BALLENOIL':     ['#ffd100', 'BA'],
    'PLENOIL':       ['#0075c9', 'PL'],
    'PLENERGY':      ['#0075c9', 'PE'],
    'PETROPRIX':     ['#f7941d', 'PX'],
    'CARREFOUR':     ['#004e9f', 'CA'],
    'ALCAMPO':       ['#e30613', 'AL'],
    'EROSKI':        ['#c8102e', 'ER'],
    'BONAREA':       ['#8dc63f', 'BN'],
    'DISA':          ['#e2001a', 'D'],
    'SHELL EXPRESS': ['#fbce07', 'SH'],
    'MEROIL':        ['#005ca9', 'ME'],
    'Q8':            ['#009ee0', 'Q8'],
    'AVIA':          ['#003c71', 'AV'],
    'TAMOIL':        ['#d81e05', 'TA'],
    'VALCARCE':      ['#00843d', 'VA'],
    'ESCLATOIL':     ['#7ab800', 'ES'],
    'ELEFANTE AZUL': ['#0091d2', 'EA'],
    'GM OIL':        ['#e94e1b', 'GM'],
    'AUTONETOIL':    ['#00a0df', 'AN'],
    'EASYGAS':       ['#76b82a', 'EG'],
    'ECOFUEL':       ['#5cb85c', 'EC'],
    'ANDAMUR':       ['#e30613', 'AM'],
    'AN ENERGIA':    ['#00953a', 'AN'],
    'PETROCAT':      ['#e30613', 'PC'],
    'SARAS':         ['#005baa', 'SA'],
    'OIL LAGO':      ['#f39200', 'OL'],
    'ARTEOIL':       ['#0069b4', 'AR'],
    'PETRONIEVES':   ['#0072bc', 'PV'],
    'ENERGY GAS':    ['#f7a600', 'EN']
  };

  /* Colores de reserva para cadenas y estaciones independientes que no están
     en la tabla. Tonos suficientemente separados entre sí y legibles. */
  const RESERVA = ['#3987e5', '#d95926', '#199e70', '#c98500', '#9085e9', '#e66767', '#00a0b0', '#b06fc4'];

  const limpia = s => String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* Contraste: texto oscuro sobre fondos claros, blanco sobre oscuros */
  function tinta(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.42 ? '#11161f' : '#ffffff';
  }

  function iniciales(nombre) {
    const p = limpia(nombre).split(' ').filter(w => w.length > 1 && !/^(DE|LA|EL|LOS|LAS|SL|SA|SLU|CB|ES|E|S)$/.test(w));
    if (!p.length) return limpia(nombre).slice(0, 2) || '?';
    return p.length === 1 ? p[0].slice(0, 2) : (p[0][0] + p[1][0]);
  }

  /* Devuelve {color, texto, tinta} para un rótulo cualquiera */
  function de(rotulo) {
    const clave = limpia(rotulo);
    for (const k in MARCAS) {
      if (clave === k || clave.startsWith(k + ' ') || clave.includes(' ' + k)) {
        const [color, texto] = MARCAS[k];
        return { color, texto, tinta: tinta(color) };
      }
    }
    let h = 0;
    for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
    const color = RESERVA[h % RESERVA.length];
    return { color, texto: iniciales(rotulo), tinta: tinta(color) };
  }

  /* Nodo listo para insertar. tam en píxeles. */
  function chip(rotulo, tam = 40) {
    const m = de(rotulo);
    const d = document.createElement('span');
    d.className = 'marca';
    d.style.cssText =
      `width:${tam}px;height:${tam}px;background:${m.color};color:${m.tinta};` +
      `font-size:${Math.round(tam * (m.texto.length > 1 ? 0.34 : 0.44))}px`;
    d.textContent = m.texto;
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  /* Misma pieza como cadena HTML, para las plantillas que ya usan innerHTML.
     El texto va escapado: los rótulos vienen de un CSV externo. */
  function html(rotulo, tam = 40) {
    const m = de(rotulo);
    const t = m.texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<span class="marca" aria-hidden="true" style="width:${tam}px;height:${tam}px;` +
           `background:${m.color};color:${m.tinta};` +
           `font-size:${Math.round(tam * (m.texto.length > 1 ? 0.34 : 0.44))}px">${t}</span>`;
  }

  return { de, chip, html, MARCAS };
})();
