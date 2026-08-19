# Fuel Rápido

**La gasolinera más barata cerca de ti, en dos segundos y sin tocar nada.**

Abres la web, das permiso de ubicación una vez, y ves inmediatamente qué estación
de servicio tiene el combustible más barato a tu alrededor y un botón grande para
ir hasta allí con Google Maps.

- Precios **oficiales** del Ministerio para la Transición Ecológica y el Reto Demográfico (todas las estaciones de España, actualizados cada ~30 min).
- **Sin claves de API, sin backend, sin registro, sin publicidad, sin cookies.**
- Web estática: se publica en GitHub Pages tal cual, gratis.
- Funciona como app instalable en el móvil (PWA) y sigue mostrando los últimos precios aunque te quedes sin cobertura.
- Tu ubicación **no se envía a ningún sitio**: todos los cálculos se hacen en tu navegador.

---

## Qué hace exactamente

| | |
|---|---|
| **Lista ultrarrápida** | Al abrir, geolocaliza y muestra la más barata en grande, con el ahorro estimado por depósito y el botón **Navegar**. |
| **14 combustibles** | Gasolina 95/98 (E5, E10, Premium), Gasóleo A, Premium y B, GLP, GNC, GNL, biodiésel, bioetanol e hidrógeno. |
| **Radio configurable** | 3, 5, 10, 20, 50 o 100 km en línea recta. |
| **Tres ordenaciones** | **Precio** · **Cerca** · **Ahorro real** (descuenta el combustible que gastas en el desvío de ida y vuelta, con tu consumo y el tamaño de tu depósito). |
| **Abierto ahora** | Interpreta el horario oficial (`L-D: 24H`, `L-V: 07:00-22:00; S: 08:00-14:00`, horarios partidos…) y filtra las cerradas. |
| **Mapa** | Leaflet + OpenStreetMap, con chinchetas de color según el precio. Leaflet va incluido en el repo, así que no depende de ningún CDN. |
| **Sin ubicación** | Si prefieres no dar el GPS, en *Ajustes* puedes buscar por municipio. |
| **Excluye lo que no te sirve** | Estaciones de venta restringida (flotas, cooperativas) y registros sin coordenadas válidas. |
| **Histórico propio** | Un workflow captura los precios cada hora y acumula en el repo sólo los que cambian. Ver [El histórico de precios](#el-histórico-de-precios). |
| **Ficha de estación** | Tocas una gasolinera y ves su curva de precios, su mínimo y su máximo, y si hoy está cara o barata **respecto a sí misma**. |
| **Panel de mercado** | Página aparte (`mercado.html`) con la evolución nacional, el ranking de provincias y el de marcas. |
| **Distintivo por cadena** | Cada gasolinera luce el color corporativo de su marca, así que la reconoces sin leer. |
| **Medidor de precio** | Una barra en cada tarjeta: llena y verde si es de las baratas de tu radio, corta y roja si es de las caras. |

---

## Publicarlo en GitHub Pages (guía paso a paso)

Tiempo estimado: **5 minutos**. No hace falta instalar nada.

### Opción A — desde la web de GitHub (la más sencilla)

1. **Crea el repositorio.**
   Entra en <https://github.com/new>.
   - *Repository name*: `fuel-rapido`
   - Marca **Public** (Pages es gratis en repos públicos).
   - **No** marques «Add a README file».
   - Pulsa **Create repository**.

2. **Sube los archivos.**
   En la pantalla que aparece, pulsa **uploading an existing file**.
   Arrastra **todo el contenido** de la carpeta `fuel-rapido` (no la carpeta en sí):
   `index.html`, `mercado.html`, `app.js`, `viz.js`, `marcas.js`, `styles.css`, `sw.js`,
   `manifest.webmanifest`, `.nojekyll`, y las carpetas `assets/`, `icons/`, `vendor/`,
   `scripts/`, `test/`, `.github/`.
   > Si el navegador no te deja arrastrar carpetas, sube primero los archivos sueltos y
   > después repite el proceso arrastrando cada carpeta.

   Escribe abajo un mensaje (`Primera versión`) y pulsa **Commit changes**.

3. **Activa GitHub Pages.**
   En el repositorio: pestaña **Settings** → menú lateral **Pages**.
   - *Source*: **Deploy from a branch**
   - *Branch*: **main** y carpeta **/ (root)**
   - **Save**

4. **Espera 1–2 minutos** y recarga esa misma página de Settings → Pages.
   Verás el enlace:

   ```
   https://TU-USUARIO.github.io/fuel-rapido/
   ```

   (Para ti sería `https://SergioPelayo.github.io/fuel-rapido/`.)

5. **Ábrelo en el móvil**, acepta el permiso de ubicación y listo.
   En Chrome/Android: menú ⋮ → *Añadir a pantalla de inicio*.
   En Safari/iPhone: botón *Compartir* → *Añadir a pantalla de inicio*.

### Opción B — desde la terminal con git

```bash
cd fuel-rapido
git init -b main
git add .
git commit -m "Fuel Rápido: primera versión"
git remote add origin https://github.com/TU-USUARIO/fuel-rapido.git
git push -u origin main
```

Después ve a **Settings → Pages** y haz el paso 3 de arriba.

### Opción C — despliegue automático con GitHub Actions

El repo ya trae `.github/workflows/deploy.yml`. Si prefieres esta vía:

**Settings → Pages → Source: _GitHub Actions_**

A partir de ahí, cada `git push` a `main` republica la web sola. Puedes seguir el
progreso en la pestaña **Actions**.

---

## Probarlo en tu ordenador antes de subirlo

La geolocalización del navegador **sólo funciona en `https://` o en `localhost`**
(abrir el `index.html` con doble clic no vale). Levanta un servidor local:

```bash
cd fuel-rapido
python3 -m http.server 8080
# y abre http://localhost:8080
```

o, si tienes Node:

```bash
npx serve .
```

---

## Cómo se obtienen los precios

Se hace una única petición a la API pública de datos abiertos del Ministerio:

```
https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/
```

Es gratuita y **no requiere clave ni registro**. Devuelve unas 12.000 estaciones con
sus precios y coordenadas. La app la descarga una vez, la guarda en **IndexedDB** y no
vuelve a pedirla hasta pasados 30 minutos, así que las siguientes aperturas son instantáneas.

**Sobre CORS.** El servidor del Ministerio no siempre envía las cabeceras que permiten
llamarlo desde otro dominio. Por eso `app.js` prueba varios orígenes en orden (constante
`SOURCES`, al principio del archivo):

1. **El Ministerio directamente** — lo más fresco.
2. **El snapshot de tu propio repositorio** (`data/`) — mismo origen, así que *nunca* falla
   por CORS y carga al instante. Se genera solo si activas el recolector (siguiente sección).
3. **Tres reenviadores públicos gratuitos** — `corsproxy.io`, `allorigins.win`, `codetabs.com`.

En *Ajustes* se indica de cuál de ellos vienen los datos que estás viendo.

---

## El histórico de precios

Los precios de hoy son públicos, **pero nadie guarda los de ayer**. El Ministerio te da la
foto de este momento, no la serie temporal. Este repositorio incluye un recolector que
construye ese histórico por ti, gratis, dentro del propio GitHub.

### Cómo activarlo

Sólo tienes que **activar Actions** en el repositorio (pestaña *Actions* → *I understand my
workflows, go ahead and enable them*). El workflow `.github/workflows/snapshot.yml` ya está
incluido y se ejecuta **cada hora**. En repositorios públicos los minutos de Actions son
gratuitos e ilimitados.

Para lanzar la primera captura sin esperar: *Actions* → **Capturar precios (histórico)** →
**Run workflow**.

### Qué genera

```
data/
├── stations.csv                    Catálogo maestro (~12.000 estaciones)
│                                   id, rótulo, dirección, municipio, provincia, lat, lon, horario, venta
├── prices.csv                      Precios vigentes — también sirve de respaldo a la app
├── meta.json                       Fecha del Ministerio, hora de captura, nº de cambios
├── history/2026/2026-08-16.csv     ts, id, combustible, precio  (el histórico nacional)
├── series/45/12345.csv             ts, combustible, precio      (la serie de UNA estación)
├── stats.csv                       id, combustible, actual, min30, max30, media30, dias
└── market/
    ├── nacional.csv                fecha, combustible, estaciones, min, media, mediana, max
    ├── provincias.csv              fecha, provincia, combustible, estaciones, media, min
    └── marcas.csv                  fecha, marca, combustible, estaciones, media, min
```

**Por qué hay dos copias del histórico.** `history/` es el fichero para explotar los
datos en bloque (todo lo que cambió un día); `series/` es el índice para la app, repartido
en 100 carpetas por los dos últimos dígitos del id. Gracias a eso, dibujar la curva de una
gasolinera cuesta **una petición de 2 KB** en lugar de descargar el histórico entero.

`stats.csv` y `market/` son resúmenes recalculados en cada pasada: alimentan los
distintivos de la lista y el panel de mercado sin que el navegador tenga que procesar nada.

La clave está en el fichero de histórico: **sólo guarda los precios que han cambiado**.
De 12.000 estaciones cambian unos pocos miles de precios al día, no 12.000 cada hora. Eso
mantiene el repositorio en unas decenas de MB al año en vez de varios GB, y hace que cada
`commit` sea un diff limpio de lo que se movió ese día.

### Reconstruir la serie de una estación

```bash
# Toda la historia de la estación 1234, en un solo fichero
cat data/series/34/1234.csv
```

o en Python:

```python
import pandas as pd, glob
h = pd.concat(pd.read_csv(f) for f in glob.glob('data/history/*/*.csv'))
serie = h[(h.id == 1234) & (h.combustible == 'g95e5')].set_index('ts').precio
```

### Salvaguardas

- Si el Ministerio devuelve menos de la mitad de estaciones que la última vez, el script
  **aborta sin escribir nada** (evita machacar el catálogo por un fallo puntual del origen).
- Reintenta la descarga 4 veces con espera creciente antes de darse por vencido.
- Ignora las variaciones por debajo de 0,0005 €/L, para no llenar el histórico de ruido.
- Si el recolector se ejecuta dos veces el mismo día, los agregados de mercado **sustituyen**
  la fila de ese día en lugar de duplicarla.

### Ejecutarlo en local

```bash
npm run snapshot                                   # descarga real
FUEL_SOURCE=./test/mock.json npm run snapshot      # con datos de prueba
```

---

## La ficha de estación y el panel de mercado

Ambas cosas viven del histórico: **hasta que el recolector no lleve un par de días
corriendo no tendrán gran cosa que enseñar**, y lo dicen claramente en pantalla en vez
de mostrar un gráfico vacío.

- **Ficha de estación** — toca cualquier tarjeta de la lista. Se abre un panel con su
  curva de precios (90 días), su mínimo y su máximo de 30 días, y una frase que responde a
  lo único que importa: *¿está hoy cara o barata para lo que suele estar?* Cada gráfico
  lleva su vista de tabla, así que ningún dato queda escondido detrás del ratón.
- **Distintivos en la lista** — con `stats.csv` cargado, las estaciones que están por
  debajo de su media habitual salen marcadas. Se descarga en segundo plano y nunca
  retrasa la primera pantalla.
- **Panel de mercado** (`mercado.html`) — media nacional frente a la más barata del país,
  comparativa entre combustibles, y rankings de provincias y marcas. Si la app ya conoce
  tu provincia, aparece destacada en el ranking.

La paleta de los gráficos está verificada para daltonismo y contraste sobre el fondo
oscuro de la app (separación CVD ΔE ≥ 8 y contraste ≥ 3:1 en todas las series).

---

## Marca e identidad visual

### Los distintivos de las cadenas

Cada estación se muestra con un distintivo circular en el **color corporativo de su
cadena** (Repsol naranja, Ballenoil amarillo, Plenoil azul…), definido en `marcas.js`.

**No son los logotipos oficiales, y es deliberado**: son marcas registradas y
empaquetarlas en un repositorio público —más aún si el proyecto se explota
comercialmente— es un problema legal. El distintivo propio se reconoce igual de rápido,
pesa cero, no depende de servidores ajenos y no infringe nada.

Añadir una cadena es una línea:

```js
'NUEVA CADENA': ['#0055aa', 'NC'],   // color corporativo, iniciales
```

Las que no están en la tabla reciben un color estable derivado de su nombre, así que
una misma estación siempre sale igual. El color del texto (blanco o negro) se calcula
por luminancia para que siempre tenga contraste.

### La marca de la app

`assets/icono.svg` — dos gotas de combustible, una con el rayo de la velocidad y otra
con el marcador. El símbolo lo aporta Pelayo Ingeniería Digital. De ahí salen también el
favicon y los iconos de la PWA (`icons/`), así que cabecera, pestaña del navegador y
pantalla de inicio del móvil llevan la misma marca.

Va **sin las palabras** del logotipo original a propósito: el nombre lo pone el texto de
la interfaz, y así el símbolo sigue leyéndose a 22 px. El surtidor anterior sigue en el
repo como `assets/icono-surtidor.svg` por si algún día se quiere recuperar.

Se descartaron los emoji (⛽ 📊 💶 📍) a propósito: cada sistema operativo los dibuja a
su manera, así que el mismo icono se veía distinto en Android, iPhone y escritorio.

Si prefieres el surtidor sin la flecha, el repo incluye `assets/icono-sin-flecha.svg`:
renómbralo a `icono.svg` y vuelve a generar los PNG.

### El logo de Pelayo Ingeniería Digital

Aparece en la **pantalla de arranque**, mientras la app localiza y descarga precios.
Se quita sola en cuanto hay lista que enseñar, con un mínimo de 0,7 s para que no
dé un pantallazo y un tope de 6 s por si algo se atasca.

El archivo es `assets/logo-pid.svg`. **Es una reconstrucción vectorial**, hecha para
fondo oscuro. Si tienes el original en SVG, sustituye ese archivo por el tuyo y
listo — no hay que tocar nada más. Si sólo lo tienes en PNG, cámbialo por
`assets/logo-pid.png` y ajusta el `src` en `index.html`.

---

## Personalizar

Casi todo está en las primeras 40 líneas de `app.js`:

```js
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;  // cada cuánto se refrescan los precios
const MAX_RESULTS      = 40;              // cuántas estaciones se listan
const FUELS = [ ... ];                    // orden del desplegable de combustibles
```

- **Colores y tipografía**: variables CSS al principio de `styles.css` (`--accent`, `--bg`…).
- **Radios disponibles**: el `<select id="radiusSelect">` de `index.html`.
- **Otra app de navegación**: cambia la función `navUrl()` en `app.js`.
  - Waze: `https://waze.com/ul?ll=${s.lat},${s.lon}&navigate=yes`
  - Apple Maps: `https://maps.apple.com/?daddr=${s.lat},${s.lon}&dirflg=d`
- **Depósito y consumo por defecto**: pestaña *Ajustes* de la propia app (se guardan en el dispositivo).

Después de cambiar `app.js`, `styles.css` o `sw.js`, sube también una versión nueva
en `sw.js` (`const VERSION = 'fuel-rapido-v2'`) para que los móviles que ya la
tengan instalada se actualicen.

---

## Tests

Tres baterías de comprobaciones automáticas, **131 en total**:

- `npm run test:snapshot` (25) — el recolector: detección de cambios, comillas del CSV,
  estaciones nuevas, ruido de redondeo y las salvaguardas ante respuestas anómalas.
- `npm run test:series` (30) — simula 10 días de capturas sobre 60 estaciones y verifica
  las series por estación, la reconstrucción de cierres diarios, las estadísticas de
  30 días y los agregados de mercado (sin duplicar días al reejecutar).
- `npm run test:web` (76) — la app en un navegador sin interfaz: orden por
  precio/distancia/ahorro, radios, filtros, parser de horarios, enlaces de navegación,
  mapa, caché, pantalla de arranque, marca propia sin emojis, distintivos de cadena y
  sus colores, medidor de
  precio, ficha de estación con su gráfico y tooltip, panel de mercado completo y el
  respaldo `data/` con el Ministerio caído.

```bash
npm install
npx playwright install chromium
npm test           # ejecuta las tres
```

---

## Estructura

```
fuel-rapido/
├── index.html               Estructura de la interfaz
├── styles.css               Todo el diseño (una sola hoja, sin frameworks)
├── app.js                   Datos, cálculo, render, mapa
├── sw.js                    Service worker (funciona sin cobertura)
├── manifest.webmanifest     Instalable como app
├── icons/                   Iconos 192/512 + maskable
├── vendor/leaflet/          Leaflet 1.9.4 incluido (sin CDN)
├── mercado.html             Panel de mercado (página aparte)
├── viz.js                   Gráficos en SVG puro, sin librerías
├── marcas.js                Colores y distintivos de las cadenas
├── assets/icono.svg         Marca de la app (cabecera, favicon, iconos PWA)
├── assets/logo-pid.svg      Logo de Pelayo Ingeniería Digital (pantalla de arranque)
├── scripts/snapshot.mjs     Recolector del histórico de precios
├── data/                    Lo genera el recolector (catálogo, precios, series, mercado)
├── test/                    Tests automáticos (recolector + Playwright)
├── .github/workflows/
│   ├── deploy.yml           Despliegue a Pages (opcional)
│   └── snapshot.yml         Captura de precios cada hora
└── .nojekyll                Evita que GitHub Pages procese el sitio con Jekyll
```

---

## Preguntas frecuentes

**¿Los precios son fiables?**
Son los que cada estación declara obligatoriamente al Ministerio. Suelen ser exactos,
pero pueden llevar hasta media hora de retraso. Confirma siempre en el surtidor.

**¿Por qué una gasolinera muy barata no aparece?**
Puede ser de *venta restringida* (sólo socios o flotas): la app las oculta a propósito.
También puede estar fuera del radio o no vender ese combustible.

**¿La distancia es la de la carretera?**
No, es en línea recta. Es lo que permite calcular al instante sin depender de ningún
servicio de rutas de pago. La distancia real por carretera será algo mayor.

**¿Funciona fuera de España?**
No. La fuente de datos es el registro español de instalaciones de suministro.

---

## Créditos y licencia

- Datos: **Ministerio para la Transición Ecológica y el Reto Demográfico** — [datos abiertos de precios de carburantes](https://geoportalgasolineras.es/).
- Mapas: **© colaboradores de OpenStreetMap**.
- Mapa interactivo: **Leaflet** (BSD-2-Clause).
- Código: MIT — ver `LICENSE`.
