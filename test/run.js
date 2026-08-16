const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const mock = require('./mock');

const ROOT = path.resolve(__dirname, '..');

/* El respaldo data/ se genera al vuelo con el propio recolector, en un
   directorio temporal: el repositorio nunca se ensucia con datos de prueba. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-web-'));
fs.mkdirSync(path.join(TMP, 'scripts'));
fs.mkdirSync(path.join(TMP, 'test'));
fs.copyFileSync(path.join(ROOT, 'scripts/snapshot.mjs'), path.join(TMP, 'scripts/snapshot.mjs'));

/* Simulamos 10 días de capturas para que existan series, estadísticas y
   agregados de mercado. Ballenoil (id 4) baja de 1,500 a 1,320; el resto quieto. */
const PRECIOS_SIM = [1.500, 1.500, 1.460, 1.460, 1.400, 1.400, 1.400, 1.360, 1.320, 1.320];
const MEDIA_SIM = PRECIOS_SIM.reduce((a, b) => a + b, 0) / PRECIOS_SIM.length;
PRECIOS_SIM.forEach((p, i) => {
  const m = JSON.parse(JSON.stringify(mock));
  m.ListaEESSPrecio[3]['Precio Gasolina 95 E5'] = String(p).replace('.', ',');
  fs.writeFileSync(path.join(TMP, 'test/src.json'), JSON.stringify(m));
  execFileSync('node', ['scripts/snapshot.mjs'], {
    cwd: TMP, stdio: 'ignore',
    env: { ...process.env, FUEL_SOURCE: './test/src.json',
           FUEL_STAMP: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00.000Z` }
  });
});
const PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const base = p.startsWith('/data/') ? TMP : ROOT;
  const file = path.join(base, p);
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const fails = [];
function check(name, cond, extra = '') {
  (cond ? console.log : (m => { fails.push(name); console.log(m); }))(
    `${cond ? '  OK  ' : ' FAIL '} ${name}${extra ? ' → ' + extra : ''}`);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 36.1408, longitude: -5.4562 },  // Algeciras
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 400, height: 860 }
  });

  // El Ministerio nunca se llama de verdad: devolvemos la muestra.
  let apiHits = 0;
  await ctx.route('**/ServiciosRESTCarburantes/**', route => {
    apiHits++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock) });
  });
  await ctx.route('**tile.openstreetmap.org**', route => route.abort());  // sin red: sólo losetas

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    // Ignoramos los fallos de las losetas de OSM: el contenedor de test no tiene red.
    if (m.type() === 'error' && !/ERR_FAILED|tile\.openstreetmap/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  await page.goto(`http://localhost:${PORT}/index.html`);

  console.log('\n--- Pantalla de arranque ---');
  check('Se ve la marca mientras localiza y descarga', await page.isVisible('#splash'));
  check('Con el logo de Pelayo Ingeniería Digital',
        /logo-pid\.svg$/.test(await page.getAttribute('#splash img', 'src')),
        await page.getAttribute('#splash img', 'src'));
  await page.screenshot({ path: path.join(__dirname, 'shot-splash.png'), fullPage: false });

  await page.waitForSelector('#hero:not(.hidden)', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('#splash'), { timeout: 8000 });
  check('Y se quita sola en cuanto hay lista que enseñar', true);

  console.log('\n--- Gasolina 95, radio 10 km, orden por precio ---');
  const heroName = (await page.textContent('#hero .name')).trim();
  const heroPrice = (await page.textContent('#hero .price')).trim();
  check('Se llamó al endpoint del Ministerio', apiHits > 0, `${apiHits} peticiones`);
  check('La destacada es BALLENOIL (1,379 €, la más barata en 10 km)',
        heroName === 'Ballenoil', heroName);
  check('Precio destacado 1,379', heroPrice.startsWith('1,379'), heroPrice);

  const names = await page.$$eval('.card .name', els => els.map(e => e.textContent.trim()));
  const prices = await page.$$eval('.price-col .p', els =>
    els.map(e => parseFloat(e.textContent.replace(',', '.'))));
  console.log('  lista:', names.join(' | '));
  check('Precios en orden ascendente', prices.every((v, i, a) => i === 0 || a[i - 1] <= v), prices.join(', '));
  check('Excluye la venta restringida (FLOTA SL, 1,199 €)', !names.includes('Flota Sl'), names.join(','));
  check('Excluye la estación sin coordenadas', !names.includes('Sin Coord'));
  check('Excluye lo que está fuera del radio (San Fernando a ~85 km)', !names.includes('Carrefour'));
  check('5 estaciones válidas dentro de 10 km (1 destacada + 4 en lista)',
        names.length === 4, names.length + ' en lista');
  check('Petroprix (1,389) va en cabeza de la lista', names[0] === 'Petroprix', names[0]);

  // Enlace de navegación
  const href = await page.getAttribute('#hero .nav-btn', 'href');
  check('Enlace de Google Maps con las coordenadas de Ballenoil',
        href === 'https://www.google.com/maps/dir/?api=1&destination=36.185,-5.49&travelmode=driving', href);

  // Radio ampliado
  console.log('\n--- Radio 100 km ---');
  await page.selectOption('#radiusSelect', '100');
  await page.waitForTimeout(300);
  const hero2 = (await page.textContent('#hero .name')).trim();
  check('Ahora gana Carrefour San Fernando (1,349 €)', hero2 === 'Carrefour', hero2);

  // Cambio de combustible: gasóleo A
  console.log('\n--- Gasóleo A, radio 10 km ---');
  await page.selectOption('#radiusSelect', '10');
  await page.selectOption('#fuelSelect', 'gA');
  await page.waitForTimeout(300);
  const hero3 = (await page.textContent('#hero .name')).trim();
  const names3 = await page.$$eval('.card .name', els => els.map(e => e.textContent.trim()));
  check('Con gasóleo gana Ballenoil (1,339 €)', hero3 === 'Ballenoil', hero3);
  check('Petroprix desaparece (no vende gasóleo A)', !names3.includes('Petroprix'), names3.join(','));

  // Orden por distancia
  console.log('\n--- Orden por cercanía ---');
  await page.click('.chip[data-sort="distancia"]');
  await page.waitForTimeout(250);
  const hero4 = (await page.textContent('#hero .name')).trim();
  check('La más cercana es Cepsa (~0,4 km)', hero4 === 'Cepsa', hero4);

  // Orden por ahorro real
  console.log('\n--- Orden por ahorro real (50 L, 7 L/100km) ---');
  await page.click('.chip[data-sort="ahorro"]');
  await page.waitForTimeout(250);
  const hero5 = (await page.textContent('#hero .name')).trim();
  check('El ahorro real sigue eligiendo Ballenoil', hero5 === 'Ballenoil', hero5);

  // Filtro "abierto ahora"
  console.log('\n--- Filtro abierto ahora ---');
  await page.click('.chip[data-sort="precio"]');
  await page.click('#chipOpen');
  await page.waitForTimeout(250);
  const openTags = await page.$$eval('.tag.closed', els => els.length);
  check('Con el filtro activo no queda ninguna cerrada', openTags === 0, openTags + ' cerradas');
  await page.click('#chipOpen');

  // Búsqueda por municipio
  console.log('\n--- Búsqueda manual de municipio ---');
  await page.selectOption('#radiusSelect', '5');
  await page.click('.tab[data-panel="panelInfo"]');
  await page.fill('#townInput', 'linea');
  await page.waitForTimeout(400);
  const townBtn = await page.textContent('#townResults button');
  check('Encuentra La Línea', /Línea|Linea|LA LINEA/i.test(townBtn), townBtn);
  await page.click('#townResults button');
  await page.waitForTimeout(300);
  const hero6 = (await page.textContent('#hero .name')).trim();
  check('Centrado en La Línea (5 km) sólo queda Shell', hero6 === 'Shell', hero6);
  const cards6 = await page.$$eval('.card', els => els.length);
  check('Y no arrastra estaciones de Algeciras', cards6 === 0, cards6 + ' extra');
  await page.selectOption('#radiusSelect', '10');

  // Mapa (Leaflet incluido en el repo, sin CDN)
  console.log('\n--- Mapa ---');
  await page.click('.tab[data-panel="panelMap"]');
  await page.waitForSelector('.leaflet-container', { timeout: 10000 });
  await page.waitForTimeout(600);
  const pins = await page.$$eval('.map-pin', els => els.length);
  const shown = await page.evaluate(() => state.results.length);
  check('Leaflet arranca desde vendor/ (sin CDN)', pins > 0, pins + ' chinchetas');
  check('Una chincheta de precio por estación mostrada', pins === shown, `${pins} de ${shown}`);
  check('Las chinchetas llevan el precio', await page.$$eval('.map-pin', els =>
        els.every(e => /^\d,\d{3}$/.test(e.textContent.trim()))));
  await page.click('.tab[data-panel="panelList"]');

  // Persistencia / recarga sin red
  console.log('\n--- Recarga usando la caché (sin llegar al Ministerio) ---');
  const before = apiHits;
  await page.reload();
  await page.waitForSelector('#hero:not(.hidden)', { timeout: 15000 });
  check('No vuelve a descargar dentro de los 30 min', apiHits === before, `${apiHits - before} peticiones nuevas`);

  // Horarios
  console.log('\n--- Parser de horarios ---');
  const sched = await page.evaluate(() => {
    const d = (s, h, m) => { const x = new Date(2026, 7, 17, h, m); return x; }; // lunes
    const sun = (h, m) => new Date(2026, 7, 16, h, m);                          // domingo
    return {
      h24:        isOpenNow('L-D: 24H', d(0, 3, 0)),
      lunes8:     isOpenNow('L-V: 07:00-22:00; S: 08:00-14:00', d(0, 8, 0)),
      lunes23:    isOpenNow('L-V: 07:00-22:00; S: 08:00-14:00', d(0, 23, 0)),
      domingo10:  isOpenNow('L-V: 07:00-22:00; S: 08:00-14:00', sun(10, 0)),
      partido13:  isOpenNow('L-V: 08:00-13:30 Y 16:00-20:00', d(0, 13, 0)),
      partido15:  isOpenNow('L-V: 08:00-13:30 Y 16:00-20:00', d(0, 15, 0)),
      vacio:      isOpenNow('')
    };
  });
  check('24H abierto de madrugada', sched.h24 === true);
  check('L-V 07-22 abierto lunes 8:00', sched.lunes8 === true);
  check('L-V 07-22 cerrado lunes 23:00', sched.lunes23 === false);
  check('Domingo cerrado si sólo abre L-V y S', sched.domingo10 === false);
  check('Horario partido: abierto 13:00', sched.partido13 === true);
  check('Horario partido: cerrado 15:00', sched.partido15 === false);
  check('Horario vacío → desconocido', sched.vacio === null);

  /* ---------- Ficha de estación con su histórico ---------- */
  console.log('\n--- Ficha de estación: la curva de precios ---');
  await page.click('.tab[data-panel="panelList"]');
  await page.selectOption('#fuelSelect', 'g95e5');
  await page.waitForTimeout(250);

  await page.click('#hero .name');
  await page.waitForSelector('#sheet.is-open', { timeout: 5000 });
  await page.waitForSelector('#sheetCuerpo .veredicto', { timeout: 8000 });

  check('Se abre la ficha de la estación destacada',
        (await page.textContent('#sheetNombre .nombre')).trim() === 'Ballenoil',
        (await page.textContent('#sheetNombre .nombre')).trim());
  check('La ficha muestra el distintivo de la marca',
        (await page.textContent('#sheetNombre .marca')).trim() === 'BA',
        (await page.textContent('#sheetNombre .marca')).trim());
  const puntos = await page.$$eval('#sheetCuerpo svg path[stroke-width="2"]',
    els => els[0].getAttribute('d').split('L').length);
  check('Dibuja la curva con un punto por día', puntos >= 10, puntos + ' puntos');
  check('El gráfico lleva descripción accesible',
        /Ballenoil/.test(await page.getAttribute('#sheetCuerpo svg', 'aria-label')),
        await page.getAttribute('#sheetCuerpo svg', 'aria-label'));

  const tiles = await page.$$eval('.tile .val', els => els.map(e => e.textContent.trim()));
  check('Muestra hoy, mínimo y máximo', tiles.length === 3, tiles.join(' | '));
  check('Máximo = 1,500 (el precio del día 1)', tiles[2] === '1,500 €', tiles[2]);
  check('Mínimo = 1,320', tiles[1] === '1,320 €', tiles[1]);

  // Tooltip del gráfico
  const caja = await page.$('#sheetCuerpo svg');
  await caja.scrollIntoViewIfNeeded();
  const bb = await caja.boundingBox();
  await caja.hover({ position: { x: bb.width * 0.35, y: bb.height / 2 } });
  await caja.hover({ position: { x: bb.width * 0.45, y: bb.height / 2 } });
  const tipOk = await page.waitForSelector('#sheetCuerpo .viz-tip.is-on', { timeout: 4000 })
    .then(() => true).catch(() => false);
  check('La cruz y el tooltip responden al puntero', tipOk,
        (await page.textContent('#sheetCuerpo .viz-tip') || '').replace(/\s+/g, ' ').trim());
  check('El tooltip nombra la serie y da el valor',
        /Gasolina 95/.test(await page.textContent('#sheetCuerpo .viz-tip')));

  // Vista de tabla (accesibilidad: ningún valor queda sólo detrás del hover)
  await page.click('#sheetCuerpo .viz-toggle');
  await page.waitForSelector('#sheetCuerpo .viz-tabla');
  const filas = await page.$$eval('#sheetCuerpo .viz-tabla tbody tr',
    els => els.map(tr => [...tr.children].map(td => td.textContent.trim())));
  check('La vista de tabla lista todos los días', filas.length >= 10, filas.length + ' filas');

  // El veredicto tiene que cuadrar con los números que la propia ficha enseña
  const veredicto = (await page.textContent('#sheetCuerpo .veredicto')).replace(/\s+/g, ' ').trim();
  const serie30 = filas.map(f => parseFloat(f[1].replace(',', '.')))
    .slice(0, 30);
  const media30 = serie30.reduce((a, b) => a + b, 0) / serie30.length;
  const hoy = parseFloat(tiles[0].replace(',', '.'));
  const pct = (hoy - media30) / media30 * 100;
  const esperado = hoy <= Math.min(...serie30) ? /precio más bajo/
                 : pct <= -1.5 ? new RegExp(Math.abs(pct).toFixed(1) + ' % por debajo')
                 : pct >= 1.5 ? new RegExp(pct.toFixed(1) + ' % por encima')
                 : /precio habitual/;
  check('El veredicto cuadra con la media que muestra su propia tabla',
        esperado.test(veredicto), `${veredicto} (media ${media30.toFixed(4)}, hoy ${hoy})`);

  await page.screenshot({ path: path.join(__dirname, 'shot-ficha.png'), fullPage: false });
  await page.click('#sheetCerrar');
  await page.waitForTimeout(300);
  check('La ficha se cierra', !(await page.isVisible('#sheet.is-open')));

  console.log('\n--- Identidad de la app ---');
  const logo = await page.getAttribute('.topbar .logo', 'src');
  check('La cabecera lleva una marca propia en SVG, no un emoji',
        logo === 'assets/icono.svg', logo);
  check('Se sirve y se pinta de verdad (no es un enlace roto)',
        await page.$eval('.topbar .logo', img => img.complete && img.naturalWidth > 0));
  const emojis = await page.$$eval('.chip, .tabbar button',
    e => e.map(x => x.textContent).filter(t => /[\u{1F300}-\u{1FAFF}]/u.test(t)));
  check('Sin emojis en los controles', emojis.length === 0, emojis.join(' '));
  const fav = await page.$$eval('link[rel="icon"]', e => e.map(x => x.getAttribute('href')));
  check('Favicon en SVG con respaldo PNG',
        fav.includes('assets/icono.svg') && fav.some(h => h.endsWith('.png')), fav.join(' | '));

  console.log('\n--- Capa visual: marcas, medidor y resumen ---');
  const marcasVistas = await page.$$eval('.card > .marca, #hero .marca',
    e => e.map(x => x.textContent.trim()));
  check('Cada tarjeta lleva el distintivo de su cadena',
        marcasVistas.length >= 5, marcasVistas.join(' | '));
  check('Ballenoil sale con su color corporativo amarillo',
        await page.$eval('#hero .marca', e => e.style.background.replace(/\s/g, '')) === 'rgb(255,209,0)',
        await page.$eval('#hero .marca', e => e.style.background));
  check('Con fondo claro el texto del distintivo se pone oscuro',
        await page.$eval('#hero .marca', e => e.style.color.replace(/\s/g, '')) === 'rgb(17,22,31)',
        await page.$eval('#hero .marca', e => e.style.color));
  const anchos = await page.$$eval('.medidor i', e => e.map(x => parseFloat(x.style.width)));
  check('El medidor se vacía conforme sube el precio (lleno = la más barata)',
        anchos.length >= 4 && anchos.every((v, i, a) => i === 0 || a[i - 1] >= v), anchos.join(' > '));
  check('La más cara del radio deja el medidor casi vacío',
        Math.round(anchos.at(-1)) === 3, anchos.at(-1) + '%');
  const colores = await page.$$eval('.medidor i', e => e.map(x => x.style.background));
  check('Y cambia de color de barata a cara',
        colores[0].includes('31, 157, 87') && colores.at(-1).includes('217, 89, 38'),
        colores[0] + ' … ' + colores.at(-1));
  const resumen = (await page.textContent('#resumen')).replace(/\s+/g, ' ').trim();
  check('La tira de resumen da el rango de la zona',
        /5 estaciones en 10 km/.test(resumen) && /1,379/.test(resumen) && /1,629/.test(resumen), resumen);

  console.log('\n--- Distintivo en la lista (stats.csv) ---');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.stats && state.stats.size > 0, { timeout: 15000 });
  await page.waitForTimeout(400);
  const tags = await page.$$eval('.card .tag, #hero .tag', els => els.map(e => e.textContent.trim()));
  check('stats.csv se carga en segundo plano y marca las que están bajo su media',
        tags.some(t => /bajo su media|mínimo en 30/i.test(t)), tags.join(' | '));

  /* ---------- Panel de mercado ---------- */
  console.log('\n--- Panel de mercado ---');
  const pm = await ctx.newPage();
  pm.on('pageerror', e => errors.push('mercado: ' + e));
  await pm.goto(`http://localhost:${PORT}/mercado.html`);
  await pm.waitForSelector('#panel:not(.hidden)', { timeout: 10000 });

  await pm.waitForTimeout(400);
  await pm.screenshot({ path: path.join(__dirname, 'shot-mercado.png'), fullPage: false });
  await pm.evaluate(() => document.querySelector('#graf4').scrollIntoView({ block: 'center' }));
  await pm.waitForTimeout(300);
  await pm.screenshot({ path: path.join(__dirname, 'shot-rankings.png'), fullPage: false });

  check('El panel carga los agregados nacionales',
        /días registrados/.test(await pm.textContent('#statusLine')),
        (await pm.textContent('#statusLine')).trim());
  check('KPI de media nacional con valor',
        /^\d,\d{3}/.test((await pm.textContent('#kpiMedia')).trim()),
        (await pm.textContent('#kpiMedia')).trim());
  check('KPI del mínimo nacional = 1,320 (la estación que bajó)',
        (await pm.textContent('#kpiMin')).trim().startsWith('1,320'),
        (await pm.textContent('#kpiMin')).trim());
  check('La variación a 7 días indica bajada',
        /▼/.test(await pm.textContent('#kpiMinDelta')),
        (await pm.textContent('#kpiMinDelta')).trim());

  const nSeries1 = await pm.$$eval('#graf1 svg path[stroke-width="2"]', e => e.length);
  check('Gráfico 1: dos series (media y mínimo)', nSeries1 === 2, nSeries1 + ' series');
  check('Con leyenda, porque hay más de una serie',
        (await pm.$$eval('#leg1 span.viz-key', e => e.length)) === 2);

  const nSeries2 = await pm.$$eval('#graf2 svg path[stroke-width="2"]', e => e.length);
  check('Gráfico 2: una línea por combustible disponible', nSeries2 >= 2, nSeries2 + ' series');

  const provs = await pm.$$eval('#graf3 .viz-barra-lab', e => e.map(x => x.textContent));
  check('Ranking de provincias ordenado de más barata a más cara',
        provs.length >= 2 && provs[0] === 'Cádiz', provs.join(' | '));
  const destacada = await pm.$$eval('#graf3 .es-destacada .viz-barra-lab', e => e.map(x => x.textContent));
  check('Destaca la provincia del usuario si la app ya la conoce',
        destacada.length === 1 && destacada[0] === 'Cádiz', destacada.join(','));

  const marcas = await pm.$$eval('#graf4 .viz-barra-lab',
    e => e.map(x => x.lastChild.textContent.trim()));
  check('Ranking de marcas (sólo las que llegan al mínimo de estaciones)',
        marcas.includes('Repsol'), marcas.join(' | '));
  check('Las marcas del ranking llevan su distintivo de color',
        (await pm.$eval('#graf4 .viz-barra-lab .marca', e => e.style.background)).includes('245, 130, 32'),
        await pm.$eval('#graf4 .viz-barra-lab .marca', e => e.style.background));

  await pm.click('#tab3 ~ .viz-toggle, .viz-toggle[data-tabla="tab3"]');
  await pm.waitForSelector('#tab3 .viz-tabla');
  check('Cada bloque tiene su vista de tabla',
        (await pm.$$eval('#tab3 .viz-tabla tbody tr', e => e.length)) >= 2);

  const fuera = await pm.$$eval('#graf3 .viz-barra-val', e => e.map(x => x.textContent.trim()));
  check('Los valores van escritos junto a la barra, no sólo en el tooltip',
        fuera.every(t => /€$/.test(t)), fuera.slice(0, 3).join(' | '));

  await pm.close();

  /* ---------- Escenario 2: el Ministerio no responde ---------- */
  console.log('\n--- Respaldo: Ministerio caído y proxies caídos ---');
  const ctx2 = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 36.1408, longitude: -5.4562 },
    locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 400, height: 860 }
  });
  let proxyHits = 0;
  await ctx2.route('**/ServiciosRESTCarburantes/**', r => r.abort());            // simula bloqueo CORS
  await ctx2.route(/corsproxy|allorigins|codetabs/, r => { proxyHits++; r.abort(); });
  await ctx2.route('**tile.openstreetmap.org**', r => r.abort());

  const page2 = await ctx2.newPage();
  await page2.goto(`http://localhost:${PORT}/index.html`);
  await page2.waitForSelector('#hero:not(.hidden)', { timeout: 20000 });
  const heroFb = (await page2.textContent('#hero .name')).trim();
  const viaTxt = await page2.textContent('#dataMeta');
  const nFb = await page2.evaluate(() => state.stations.length);
  check('La app arranca igualmente con el snapshot del repositorio', heroFb === 'Ballenoil', heroFb);
  check('Carga las 12 estaciones del snapshot', nFb === 12, String(nFb));
  check('Ajustes indica el origen real de los datos', /snapshot/i.test(viaTxt), viaTxt.replace(/\s+/g, ' ').trim());
  check('Usa el snapshot ANTES que los proxies externos', proxyHits === 0, proxyHits + ' llamadas a proxy');

  const addrFb = await page2.textContent('#hero .addr');
  check('El CSV entrecomillado se lee bien (dirección con coma)',
        await page2.evaluate(() => state.stations.find(s => s.id === '1').addr) === 'Avda Virgen Del Carmen, 12 "el Cruce"',
        await page2.evaluate(() => state.stations.find(s => s.id === '1').addr));
  await ctx2.close();

  console.log('\n--- Errores de consola ---');
  check('Sin errores JavaScript', errors.length === 0, errors.slice(0, 3).join(' // '));

  await page.screenshot({ path: path.join(__dirname, 'shot-lista.png'), fullPage: false });

  await browser.close();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(fails.length ? `\n✖ ${fails.length} comprobaciones fallidas` : '\n✔ Todas las comprobaciones OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
