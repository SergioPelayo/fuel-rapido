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
fs.copyFileSync(path.join(ROOT, 'scripts/planes.mjs'), path.join(TMP, 'scripts/planes.mjs'));

/* El registro oficial de planes de descuento, desde el fixture: así la app
   encuentra data/planes-oficiales.json igual que lo encontrará en producción. */
execFileSync('node', ['scripts/planes.mjs'], {
  cwd: TMP, stdio: 'ignore',
  env: { ...process.env, FUEL_PLANES_SOURCE: path.join(ROOT, 'test/planes-mock.xml') }
});

/* Simulamos 10 días de capturas para que existan series, estadísticas y
   agregados de mercado. Ballenoil (id 4) baja de 1,500 a 1,320; el resto quieto.

   Las fechas son RELATIVAS a hoy (de hace 10 días a ayer), no fijas. Con fechas
   fijas el suite caducaba: la ficha resume los últimos 30 días, así que en
   cuanto la simulación se alejaba más de un mes, el máximo de la serie dejaba
   de ser el precio del primer día y el test fallaba solo con el paso del
   tiempo, sin que nadie hubiera tocado el código. */
const PRECIOS_SIM = [1.500, 1.500, 1.460, 1.460, 1.400, 1.400, 1.400, 1.360, 1.320, 1.320];
const MEDIA_SIM = PRECIOS_SIM.reduce((a, b) => a + b, 0) / PRECIOS_SIM.length;
const selloDia = atras => {
  const d = new Date(Date.now() - atras * 86400000);
  return `${d.toISOString().slice(0, 10)}T09:00:00.000Z`;
};
PRECIOS_SIM.forEach((p, i) => {
  const m = JSON.parse(JSON.stringify(mock));
  m.ListaEESSPrecio[3]['Precio Gasolina 95 E5'] = String(p).replace('.', ',');
  fs.writeFileSync(path.join(TMP, 'test/src.json'), JSON.stringify(m));
  execFileSync('node', ['scripts/snapshot.mjs'], {
    cwd: TMP, stdio: 'ignore',
    env: { ...process.env, FUEL_SOURCE: './test/src.json',
           FUEL_STAMP: selloDia(PRECIOS_SIM.length - i) }
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
  // FUEL_CHROMIUM permite usar un Chromium ya instalado (CI, contenedores sin
  // descarga de navegadores). Sin esa variable, Playwright usa el suyo.
  const browser = await chromium.launch(
    process.env.FUEL_CHROMIUM ? { executablePath: process.env.FUEL_CHROMIUM } : {});
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

  /* ---------- Descuentos de las cadenas ---------- */
  console.log('\n--- Descuentos de las cadenas ---');
  await page.selectOption('#radiusSelect', '20');     // para que entre Shell (10,1 km)
  await page.waitForTimeout(300);

  check('Quien no usa estas apps no ve ni una palabra de ellas',
        (await page.$$eval('.promo', e => e.length)) === 0);
  check('El chip «Con mi descuento» no existe mientras no haya perfil',
        await page.isHidden('#chipPromo'));

  await page.click('.tab[data-panel="panelInfo"]');
  await page.waitForTimeout(200);
  const progs = await page.$$eval('.promo-head b', e => e.map(x => x.textContent.trim()));
  check('Ajustes ofrece los cinco programas verificados', progs.length === 5, progs.join(' | '));
  check('Shell aparece como «Mi Energía DISA», que es su programa real en España',
        progs.includes('Mi Energía DISA') && !progs.some(p => /GO\s*\+/.test(p)), progs.join(' | '));
  /* Contraste con el registro oficial del Ministerio */
  await page.waitForSelector('.promo-contraste', { timeout: 8000 });
  const contraste = (await page.textContent('.promo-contraste')).replace(/\s+/g, ' ').trim();
  check('Ajustes contrasta nuestras cifras con el registro del Ministerio',
        /registro del Ministerio/i.test(contraste), contraste.slice(0, 70));
  check('El registro confirma Mi BP y Mi Energía DISA',
        /Mi BP: declara 3 cts\/L/.test(contraste) && /Mi Energía DISA: declara 5 cts\/L/.test(contraste),
        contraste.slice(0, 200));
  check('Y dice claramente que Waylet no figura en él',
        /Waylet: no figura en el registro/.test(contraste), contraste);
  check('Con la advertencia de que el registro no lleva fechas',
        /no lleva fechas de validez/.test(contraste));
  const cifrasTrasContraste = await page.evaluate(() =>
    [Promos.programa('mibp').tramos[0].cts, Promos.programa('mi_energia_disa').tramos[0].cts]);
  check('EL CONTRASTE NO TOCA NINGUNA CIFRA MOSTRADA',
        cifrasTrasContraste[0] === 3 && cifrasTrasContraste[1] === 5, cifrasTrasContraste.join('/'));

  const txtBox = await page.textContent('#promosBox');
  check('Y se dice que Mundo Galp queda fuera por no estar verificado',
        /Mundo Galp/.test(txtBox) && /sin verificar/.test(txtBox));
  check('Se indica la versión y la fecha de los datos',
        /v\d+\.\d+/.test(txtBox) && /\d{2}\/\d{2}\/\d{4}/.test(txtBox),
        (txtBox.match(/Datos v[^·]*·[^·]*/) || [''])[0].trim());

  await page.check('input[data-prog="waylet"]');
  await page.waitForTimeout(200);
  const tramo0 = await page.inputValue('select[data-tramo="waylet"]');
  check('Al activar un programa se elige el tramo MÁS BAJO, nunca el más alto',
        tramo0 === 'coche', tramo0);

  await page.click('.tab[data-panel="panelList"]');
  await page.waitForTimeout(300);
  const ordenConPromo = await page.$$eval('.card .name', e => e.map(x => x.textContent.trim()));
  const avisos1 = await page.$$eval('.promo', e => e.map(x => x.textContent.trim()));
  check('El aviso sale en Repsol y sólo en Repsol', avisos1.length === 1, avisos1.join(' | '));
  check('Dice los céntimos, la cadena y que es saldo, no surtidor',
        /−10 cts\/L en saldo Waylet/.test(avisos1[0]) && /no baja el surtidor/.test(avisos1[0]), avisos1[0]);
  check('Lleva la fecha en que se revisaron las condiciones',
        /rev\. \d{2}\/\d{2}/.test(avisos1[0]), avisos1[0]);

  /* Que se VEA. No basta con que el dato esté: tiene que saltar a la vista
     mientras bajas por la lista. */
  const senales = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find(x => /Repsol/i.test(x.querySelector('.name').textContent));
    const otra = [...document.querySelectorAll('.card')].find(x => /Plenoil/i.test(x.querySelector('.name').textContent));
    const b = c && c.querySelector('.promo-badge');
    return {
      badge: b ? b.textContent.trim() : null,
      badgeFondo: b ? getComputedStyle(b).backgroundColor : null,
      badgeTam: b ? parseFloat(getComputedStyle(b).fontSize) : 0,
      lineaTam: c ? parseFloat(getComputedStyle(c.querySelector('.promo b')).fontSize) : 0,
      marcada: c ? c.classList.contains('con-promo') : false,
      canto: c ? getComputedStyle(c, '::before').backgroundColor : null,
      sinPromoNoMarcada: otra ? !otra.classList.contains('con-promo') : false,
      resumen: document.querySelector('#resumen').textContent
    };
  });
  check('La pastilla con la cifra va pegada al precio', senales.badge === '−10 cts', senales.badge);
  check('Y es sólida, no un texto tenue', /rgb\(166, 180, 255\)/.test(senales.badgeFondo || ''), senales.badgeFondo);
  check('Con cuerpo suficiente para leerse de un vistazo (≥12px)',
        senales.badgeTam >= 12 && senales.lineaTam >= 13, `pastilla ${senales.badgeTam}px · línea ${senales.lineaTam}px`);
  check('La tarjeta queda marcada con un canto de color',
        senales.marcada && /rgb\(166, 180, 255\)/.test(senales.canto || ''), senales.canto);
  check('Y las estaciones sin descuento NO se marcan', senales.sinPromoNoMarcada);
  check('La tira de resumen dice en cuántas se te aplica',
        /con tus? descuentos?/.test(senales.resumen), senales.resumen.replace(/\s+/g, ' ').trim());

  const pRepsol = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find(x => /Repsol/i.test(x.querySelector('.name').textContent));
    return c ? c.querySelector('.price-col .p').textContent.trim() : null;
  });
  check('EL PRECIO QUE SE MUESTRA SIGUE SIENDO EL OFICIAL (1,629)',
        pRepsol && pRepsol.startsWith('1,629'), pRepsol);
  check('EL ORDEN NO CAMBIA al declarar un descuento', ordenConPromo[0] === 'Petroprix', ordenConPromo.join(' | '));
  check('La destacada sigue siendo la más barata de verdad',
        (await page.textContent('#hero .name')).trim() === 'Ballenoil');

  await page.click('.tab[data-panel="panelInfo"]');
  await page.selectOption('select[data-tramo="waylet"]', 'coche_completo');
  await page.click('.tab[data-panel="panelList"]');
  await page.waitForTimeout(300);
  check('Al declarar un tramo superior, el aviso sube a 40 cts',
        /−40 cts/.test(await page.textContent('.card .promo')),
        (await page.textContent('.card .promo')).trim());

  check('Con perfil, ya aparece el chip «Con mi descuento»', await page.isVisible('#chipPromo'));
  await page.click('#chipPromo');
  await page.waitForTimeout(300);
  check('Sólo en ese modo explícito se reordena: gana Repsol (1,629 − 40 cts)',
        (await page.textContent('#hero .name')).trim() === 'Repsol',
        (await page.textContent('#hero .name')).trim());
  check('Incluso ahí, el precio grande es el oficial del Ministerio',
        (await page.textContent('#hero .price')).trim().startsWith('1,629'),
        (await page.textContent('#hero .price')).trim());
  check('El estimado va aparte y marcado como aproximado',
        /≈ 1,229/.test(await page.textContent('#hero .promo')),
        (await page.textContent('#hero .promo')).trim());
  check('Y el rótulo del destacado avisa de que es con descuento',
        /con tu descuento/i.test(await page.textContent('#hero .kicker')),
        (await page.textContent('#hero .kicker')).trim());

  await page.click('.chip[data-sort="precio"]');
  await page.waitForTimeout(300);
  check('Al volver a «Precio», manda otra vez el dato oficial',
        (await page.textContent('#hero .name')).trim() === 'Ballenoil');

  await page.click('.tab[data-panel="panelInfo"]');
  await page.check('input[data-prog="mi_energia_disa"]');
  await page.click('.tab[data-panel="panelList"]');
  await page.waitForTimeout(300);
  const lineaShell = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find(x => /Shell/i.test(x.querySelector('.name').textContent));
    return c ? c.querySelector('.promo').textContent.trim() : null;
  });
  check('Mi Energía DISA se presenta como descuento inmediato, no como saldo',
        /al pagar/.test(lineaShell) && !/saldo/.test(lineaShell), lineaShell);

  await page.evaluate(() => {
    [...document.querySelectorAll('.card')].find(x => /Repsol/i.test(x.querySelector('.name').textContent)).click();
  });
  await page.waitForSelector('.promo-ficha', { timeout: 5000 });
  const ficha = (await page.textContent('.promo-ficha')).replace(/\s+/g, ' ').trim();
  check('La ficha detalla el tramo declarado', /Tu tramo/.test(ficha), ficha.slice(0, 90));
  check('La ficha explica que el saldo no baja el surtidor', /saldo/i.test(ficha));
  check('La ficha avisa de la caducidad de la campaña', /caduca el 31\/10\/2026/.test(ficha), ficha.slice(-120));
  check('La ficha enlaza la fuente oficial de la cadena',
        /repsol\.es/.test(await page.getAttribute('.promo-ficha-enl', 'href')),
        await page.getAttribute('.promo-ficha-enl', 'href'));
  await page.click('#sheetCerrar');
  await page.waitForTimeout(200);

  // Si el histórico no carga, el aviso de descuento tiene que seguir ahí:
  // son dos datos independientes y uno no debe llevarse al otro por delante.
  await page.route('**/series/**', r => r.abort());
  await page.evaluate(() => {
    [...document.querySelectorAll('.card')].find(x => /Repsol/i.test(x.querySelector('.name').textContent)).click();
  });
  await page.waitForSelector('#sheetCuerpo .viz-vacio', { timeout: 8000 });
  check('Si el histórico falla, el aviso de descuento se mantiene',
        await page.isVisible('.promo-ficha'));
  await page.click('#sheetCerrar');
  await page.unroute('**/series/**');
  await page.waitForTimeout(200);

  const alerta = await page.evaluate(async () => {
    const j = await fetch('promociones.json').then(r => r.json());
    j._revision.ultima = '2026-01-01';          // simula una revisión olvidada
    Promos.cargar(j);
    construirPromos();
    render();
    return {
      caja: document.querySelector('.promo-alerta')?.textContent || '',
      linea: document.querySelector('.promo')?.textContent || ''
    };
  });
  check('Si la revisión se queda vieja, Ajustes lo advierte solo',
        /sin revisar/.test(alerta.caja) && /\d+ días/.test(alerta.caja), alerta.caja.slice(0, 90));
  check('Y cada aviso de la lista queda marcado como sin revisar',
        /sin revisar/.test(alerta.linea), alerta.linea);

  await page.evaluate(async () => {
    Promos.cargar(await fetch('promociones.json').then(r => r.json()));
    construirPromos();
    render();
  });
  await page.click('.tab[data-panel="panelInfo"]');
  await page.uncheck('input[data-prog="waylet"]');
  await page.uncheck('input[data-prog="mi_energia_disa"]');
  await page.click('.tab[data-panel="panelList"]');
  await page.waitForTimeout(300);
  check('Al desmarcar todo, los avisos desaparecen y el chip se esconde',
        (await page.$$eval('.promo', e => e.length)) === 0 && await page.isHidden('#chipPromo'));
  await page.selectOption('#radiusSelect', '10');
  await page.waitForTimeout(300);

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
