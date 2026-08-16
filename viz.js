/* ============================================================
   Fuel Rápido — viz.js
   Gráficos en SVG puro, sin librerías. Compartido por la ficha de
   estación (index.html) y el panel de mercado (mercado.html).

   Paleta validada para superficie oscura #161f2c:
     serie única / destacado  #1f9d57
     contexto                 #3987e5
     4 combustibles           #3987e5 #d95926 #199e70 #c98500
   ============================================================ */

'use strict';

const Viz = (() => {

  const NS = 'http://www.w3.org/2000/svg';
  const SUP = '#161f2c';        // superficie: los anillos y huecos se pintan de este color
  const GRID = '#243044';
  const INK2 = '#94a3b8';

  const el = (n, attrs = {}) => {
    const e = document.createElementNS(NS, n);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  const eur = (v, d = 3) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fechaCorta = ms => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  /* Escala con topes redondos: los ticks caen en números limpios */
  function escalaY(min, max, ticks = 4) {
    if (min === max) { min -= 0.05; max += 0.05; }
    const span = max - min;
    const paso = Math.pow(10, Math.floor(Math.log10(span / ticks)));
    const cands = [1, 2, 2.5, 5, 10].map(m => m * paso);
    const step = cands.find(c => span / c <= ticks) || cands[cands.length - 1];
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const vals = [];
    for (let v = lo; v <= hi + step / 2; v += step) vals.push(Number(v.toFixed(6)));
    return { lo, hi, vals };
  }

  function tooltip(host) {
    const t = document.createElement('div');
    t.className = 'viz-tip';
    t.setAttribute('role', 'status');
    host.appendChild(t);
    return t;
  }

  /* ---------------- Gráfico de líneas ---------------- */

  function lineas(host, cfg) {
    const dibuja = () => {
      host.querySelectorAll('svg,.viz-tip').forEach(n => n.remove());

      const series = cfg.series.filter(s => s.puntos && s.puntos.length);
      if (!series.length) { host.innerHTML = '<p class="viz-vacio">Sin datos todavía.</p>'; return; }

      const W = Math.max(260, host.clientWidth || 320);
      const H = cfg.alto || 190;
      const etiquetasDir = cfg.etiquetasDirectas !== false && series.length <= 4;
      const M = { t: 12, r: etiquetasDir ? 52 : 14, b: 22, l: 46 };

      const xs = series.flatMap(s => s.puntos.map(p => p.x));
      const ys = series.flatMap(s => s.puntos.map(p => p.y));
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const { lo, hi, vals } = escalaY(Math.min(...ys), Math.max(...ys), 4);

      const px = v => M.l + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * (W - M.l - M.r);
      const py = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

      const svg = el('svg', {
        viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
        role: 'img', 'aria-label': cfg.descripcion || 'Gráfico de evolución de precios'
      });

      // Rejilla horizontal, hairline sólida y recesiva
      vals.forEach(v => {
        svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: py(v), y2: py(v), stroke: GRID, 'stroke-width': 1 }));
        const t = el('text', { x: M.l - 7, y: py(v) + 4, 'text-anchor': 'end', class: 'viz-eje' });
        t.textContent = eur(v, cfg.decimales ?? 2);
        svg.appendChild(t);
      });

      // Marcas del eje X
      const nTicks = W < 340 ? 2 : 3;
      for (let i = 0; i <= nTicks; i++) {
        const v = x0 + (x1 - x0) * i / nTicks;
        const t = el('text', {
          x: px(v), y: H - 6, class: 'viz-eje',
          'text-anchor': i === 0 ? 'start' : i === nTicks ? 'end' : 'middle'
        });
        t.textContent = fechaCorta(v);
        svg.appendChild(t);
      }

      series.forEach(s => {
        const pts = [...s.puntos].sort((a, b) => a.x - b.x);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join('');

        if (cfg.area && series.length === 1) {
          svg.appendChild(el('path', {
            d: `${d}L${px(pts.at(-1).x).toFixed(1)},${py(lo)}L${px(pts[0].x).toFixed(1)},${py(lo)}Z`,
            fill: s.color, 'fill-opacity': 0.1, stroke: 'none'
          }));
        }
        svg.appendChild(el('path', {
          d, fill: 'none', stroke: s.color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));

        // Punto final con anillo del color de la superficie
        const fin = pts.at(-1);
        svg.appendChild(el('circle', { cx: px(fin.x), cy: py(fin.y), r: 6, fill: SUP }));
        svg.appendChild(el('circle', { cx: px(fin.x), cy: py(fin.y), r: 4, fill: s.color }));

        if (etiquetasDir) {
          const t = el('text', { x: px(fin.x) + 9, y: py(fin.y) + 4, class: 'viz-etiqueta' });
          t.textContent = cfg.formatoEtiqueta ? cfg.formatoEtiqueta(fin.y) : eur(fin.y);
          svg.appendChild(t);
        }
      });

      // Capa de cruz + tooltip
      const cruz = el('line', { y1: M.t, y2: H - M.b, stroke: INK2, 'stroke-width': 1, opacity: 0 });
      svg.appendChild(cruz);
      const focos = series.map(s => {
        const g = el('g', { opacity: 0 });
        g.appendChild(el('circle', { r: 6, fill: SUP }));
        g.appendChild(el('circle', { r: 4, fill: s.color }));
        svg.appendChild(g);
        return g;
      });

      host.appendChild(svg);
      const tip = tooltip(host);

      const mover = ev => {
        const r = svg.getBoundingClientRect();
        const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const xv = x0 + ((cx - r.left) / r.width * W - M.l) / (W - M.l - M.r) * (x1 - x0);

        let bestX = null;
        const filas = [];
        series.forEach((s, i) => {
          const p = s.puntos.reduce((a, b) => Math.abs(b.x - xv) < Math.abs(a.x - xv) ? b : a);
          if (bestX === null || Math.abs(p.x - xv) < Math.abs(bestX - xv)) bestX = p.x;
          filas.push({ s, p });
          focos[i].setAttribute('transform', `translate(${px(p.x)},${py(p.y)})`);
          focos[i].setAttribute('opacity', 1);
        });

        cruz.setAttribute('x1', px(bestX)); cruz.setAttribute('x2', px(bestX));
        cruz.setAttribute('opacity', 0.5);

        tip.replaceChildren();
        const cab = document.createElement('div');
        cab.className = 'viz-tip-fecha';
        cab.textContent = new Date(bestX).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        tip.appendChild(cab);
        filas.forEach(({ s, p }) => {
          const row = document.createElement('div');
          row.className = 'viz-tip-fila';
          const key = document.createElement('span');
          key.className = 'viz-key'; key.style.background = s.color;
          const val = document.createElement('strong');
          val.textContent = cfg.formatoEtiqueta ? cfg.formatoEtiqueta(p.y) : eur(p.y) + ' €/L';
          const nom = document.createElement('span');
          nom.className = 'viz-tip-nom'; nom.textContent = s.nombre || '';
          row.append(key, val, nom);
          tip.appendChild(row);
        });
        tip.classList.add('is-on');
        const left = Math.min(Math.max(px(bestX) / W * r.width - 70, 4), r.width - 148);
        tip.style.left = left + 'px';
      };

      const salir = () => {
        cruz.setAttribute('opacity', 0);
        focos.forEach(f => f.setAttribute('opacity', 0));
        tip.classList.remove('is-on');
      };

      svg.addEventListener('pointermove', mover);
      svg.addEventListener('pointerleave', salir);
      svg.addEventListener('touchmove', mover, { passive: true });
      svg.addEventListener('touchend', salir);
    };

    dibuja();
    host._vizW = host.clientWidth;

    /* Redibujar sólo si cambia el ANCHO. Sin esta guarda el propio dibujo
       altera el alto del contenedor, el observador se dispara otra vez y el
       gráfico se recrea en bucle (y se lleva por delante el tooltip abierto). */
    if (window.ResizeObserver && !host._viz) {
      host._viz = new ResizeObserver(() => {
        const w = host.clientWidth;
        if (Math.abs(w - host._vizW) < 2) return;
        host._vizW = w;
        clearTimeout(host._vizT);
        host._vizT = setTimeout(() => { dibuja(); host._vizW = host.clientWidth; }, 80);
      });
      host._viz.observe(host);
    }
  }

  /* ---------------- Barras horizontales ---------------- */

  function barras(host, cfg) {
    host.replaceChildren();
    const items = cfg.items || [];
    if (!items.length) { host.innerHTML = '<p class="viz-vacio">Sin datos todavía.</p>'; return; }

    const min = Math.min(...items.map(i => i.valor));
    const max = Math.max(...items.map(i => i.valor));
    // Base ligeramente por debajo del mínimo: si arrancara en 0 todas las
    // barras medirían casi lo mismo y no se vería nada.
    const base = min - (max - min) * 0.25 || min * 0.98;

    const lista = document.createElement('div');
    lista.className = 'viz-barras';

    items.forEach(it => {
      const fila = document.createElement('div');
      fila.className = 'viz-barra' + (it.destacado ? ' es-destacada' : '');
      fila.tabIndex = 0;

      const lab = document.createElement('span');
      lab.className = 'viz-barra-lab';
      // Las barras de marcas llevan su distintivo de color delante
      if (it.distintivo && typeof Marcas !== 'undefined') lab.appendChild(Marcas.chip(it.etiqueta, 20));
      lab.appendChild(document.createTextNode(it.etiqueta));

      const pista = document.createElement('span');
      pista.className = 'viz-barra-pista';
      const relleno = document.createElement('span');
      relleno.className = 'viz-barra-fill';
      relleno.style.width = Math.max(3, (it.valor - base) / (max - base) * 100) + '%';
      relleno.style.background = it.destacado ? '#1f9d57' : '#3987e5';
      pista.appendChild(relleno);

      const val = document.createElement('span');
      val.className = 'viz-barra-val';
      val.textContent = cfg.formatoValor ? cfg.formatoValor(it.valor) : eur(it.valor);

      fila.append(lab, pista, val);
      if (it.detalle) {
        fila.setAttribute('title', it.detalle);
        fila.setAttribute('aria-label', `${it.etiqueta}: ${val.textContent}. ${it.detalle}`);
      }
      lista.appendChild(fila);
    });

    host.appendChild(lista);
  }

  /* ---------------- Vista de tabla (accesibilidad) ---------------- */

  function tabla(host, { columnas, filas }) {
    host.replaceChildren();
    const t = document.createElement('table');
    t.className = 'viz-tabla';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    columnas.forEach(c => { const th = document.createElement('th'); th.textContent = c; trh.appendChild(th); });
    thead.appendChild(trh);
    const tb = document.createElement('tbody');
    filas.forEach(f => {
      const tr = document.createElement('tr');
      f.forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.append(thead, tb);
    host.appendChild(t);
  }

  return { lineas, barras, tabla, eur, escalaY };
})();
