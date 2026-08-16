# ⛽ Fuel Rápido

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
| **Tres ordenaciones** | 💶 **Precio** · 📍 **Cerca** · 🧠 **Ahorro real** (descuenta el combustible que gastas en el desvío de ida y vuelta, con tu consumo y el tamaño de tu depósito). |
| **Abierto ahora** | Interpreta el horario oficial (`L-D: 24H`, `L-V: 07:00-22:00; S: 08:00-14:00`, horarios partidos…) y filtra las cerradas. |
| **Mapa** | Leaflet + OpenStreetMap, con chinchetas de color según el precio. Leaflet va incluido en el repo, así que no depende de ningún CDN. |
| **Sin ubicación** | Si prefieres no dar el GPS, en *Ajustes* puedes buscar por municipio. |
| **Excluye lo que no te sirve** | Estaciones de venta restringida (flotas, cooperativas) y registros sin coordenadas válidas. |
| **Histórico propio** | Un workflow captura los precios cada hora y acumula en el repo sólo los que cambian. Ver [El histórico de precios](#el-histórico-de-precios). |

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
   `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `.nojekyll`,
   y las carpetas `icons/`, `vendor/`, `scripts/`, `test/`, `.github/`.
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
└── history/2026/2026-08-16.csv     ts, id, combustible, precio
```

La clave está en el fichero de histórico: **sólo guarda los precios que han cambiado**.
De 12.000 estaciones cambian unos pocos miles de precios al día, no 12.000 cada hora. Eso
mantiene el repositorio en unas decenas de MB al año en vez de varios GB, y hace que cada
`commit` sea un diff limpio de lo que se movió ese día.

### Reconstruir la serie de una estación

```bash
# Evolución de la gasolina 95 en la estación 1234
grep ',1234,g95e5,' data/history/2026/*.csv
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

### Ejecutarlo en local

```bash
npm run snapshot                                   # descarga real
FUEL_SOURCE=./test/mock.json npm run snapshot      # con datos de prueba
```

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

Dos baterías de comprobaciones automáticas, **61 en total**:

- `npm run test:snapshot` (25) — el recolector: detección de cambios, comillas del CSV,
  estaciones nuevas, ruido de redondeo y las salvaguardas ante respuestas anómalas.
- `npm run test:web` (36) — la app en un navegador sin interfaz con datos simulados:
  orden por precio/distancia/ahorro, radios, filtros, parser de horarios, enlaces de
  navegación, mapa, caché y el respaldo `data/` con el Ministerio caído.

```bash
npm install
npx playwright install chromium
npm test           # ejecuta las dos
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
├── scripts/snapshot.mjs     Recolector del histórico de precios
├── data/                    Lo genera el recolector (catálogo, precios, histórico)
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
