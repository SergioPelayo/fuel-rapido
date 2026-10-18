/* ============================================================
   Fuel Rápido — scripts/planes.mjs
   Registro oficial de planes de descuento del Ministerio.

   Las operadoras al por mayor y las emisoras de tarjetas están OBLIGADAS a
   comunicar al Ministerio sus planes de descuento: nombre, cuantía en céntimos
   por litro o porcentaje, y segmento de beneficiario. El Geoportal lo publica
   en abierto, sin clave:

       https://geoportalgasolineras.es/geoportal/rest/discountPlans

   Este script lo guarda en data/planes-oficiales.json. NO sustituye a
   promociones.json, que se revisa a mano, por tres motivos comprobados:

     · Las tres apps de fidelización grandes no están en el registro: ni
       Waylet, ni Moeve gow, ni Mundo Galp. De Repsol constan sus tarjetas,
       no su app.
     · Sólo 2 de 84 planes traen fecha de validez, así que un plan muerto
       puede quedarse ahí años sin que nada lo delate.
     · El registro no dice en qué estaciones aplica cada plan.

   Sirve para otra cosa: contrastar nuestras cifras con una segunda fuente
   oficial, y cubrir la cola larga de cadenas pequeñas. Ver la ficha
   fuel-rapido-geoportal-planes-descuento.md.

   Reglas de convivencia con el recolector de precios:
     · Falla SIEMPRE en blando. Que el Geoportal esté caído no puede tumbar
       la captura horaria de precios, que es el activo de verdad.
     · Se refresca una vez al día, no cada hora: esto cambia muy despacio.

   Variables de entorno (para pruebas):
     FUEL_PLANES_SOURCE   fichero XML local en vez de la red
     FUEL_PLANES_FORCE    '1' para saltarse el intervalo de refresco
     FUEL_STAMP           fecha simulada (ISO)
   ============================================================ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const URL_REGISTRO = 'https://geoportalgasolineras.es/geoportal/rest/discountPlans';
const DESTINO      = 'data/planes-oficiales.json';
const REFRESCO_H   = 20;          // margen holgado para que entre una vez al día

const ahora = () => (process.env.FUEL_STAMP ? new Date(process.env.FUEL_STAMP) : new Date());

/* ---------- Parseo ----------
   El XML es plano salvo tres bloques anidados. Los sacamos primero y luego
   leemos lo que queda, para que el <nombre> del operador no se confunda con
   el <nombre> del plan. Sin dependencias: el recolector no las tiene. */

const texto = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
};

const desescapa = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function parsea(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const planes = [];

  for (const item of items) {
    const bloque = tag => {
      const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? m[1] : '';
    };
    const operador     = bloque('operador');
    const tipoDesc     = bloque('tipoDescuento');
    const tipoDest     = bloque('tipoDestinatario');
    // Lo que queda tras quitar los anidados son los campos del propio plan
    const plano = item
      .replace(/<operador>[\s\S]*?<\/operador>/, '')
      .replace(/<tipoDescuento>[\s\S]*?<\/tipoDescuento>/, '')
      .replace(/<tipoDestinatario>[\s\S]*?<\/tipoDestinatario>/, '');

    const cifraCruda = texto(plano, 'cifraDescuento');
    const cifra = cifraCruda === '' ? null : Number(cifraCruda);
    const unidad = desescapa(texto(tipoDesc, 'tipo'));   // 'cts/litro' | '%'

    planes.push({
      id:           texto(plano, 'id'),
      nombre:       desescapa(texto(plano, 'nombre')),
      descripcion:  desescapa(texto(plano, 'descripcion')),
      cifra:        Number.isFinite(cifra) ? cifra : null,
      unidad:       unidad || null,
      // Sin cifra, sin unidad o con el cero de relleno no hay nada que comparar
      util:         Number.isFinite(cifra) && cifra > 0 && !!unidad,
      caduca:       desescapa(texto(plano, 'fechaValidez')) || null,
      operador:     desescapa(texto(operador, 'nombre')),
      destinatario: desescapa(texto(tipoDest, 'tipo'))
    });
  }
  return planes;
}

/* ---------- Descarga ---------- */

async function baja() {
  if (process.env.FUEL_PLANES_SOURCE) {
    return readFile(process.env.FUEL_PLANES_SOURCE, 'utf8');
  }
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined;
  const res = await fetch(URL_REGISTRO, {
    signal: ctl,
    headers: { 'Accept': 'application/xml', 'User-Agent': 'fuel-rapido/1.0 (+https://github.com/SergioPelayo/fuel-rapido)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ---------- Programa ---------- */

async function main() {
  const hoy = ahora();

  // Una vez al día basta: el registro cambia muy despacio y el workflow es horario.
  if (existsSync(DESTINO) && process.env.FUEL_PLANES_FORCE !== '1') {
    try {
      const previo = JSON.parse(await readFile(DESTINO, 'utf8'));
      const horas = (hoy - new Date(previo._leido)) / 3600000;
      if (horas < REFRESCO_H) {
        console.log(`· Registro de planes leído hace ${horas.toFixed(1)} h. No toca.`);
        return;
      }
    } catch (e) { /* fichero ilegible: lo regeneramos */ }
  }

  const xml = await baja();
  const planes = parsea(xml);
  if (!planes.length) throw new Error('El registro ha devuelto 0 planes');

  // Salvaguarda, igual que en el recolector de precios: una caída brusca del
  // número de planes es más probable que sea un fallo de la fuente que un
  // cambio real, y preferimos conservar lo anterior.
  if (existsSync(DESTINO)) {
    try {
      const previo = JSON.parse(await readFile(DESTINO, 'utf8'));
      const antes = (previo.planes || []).length;
      if (antes > 10 && planes.length < antes * 0.6) {
        throw new Error(`Respuesta anómala: ${planes.length} planes frente a ${antes} anteriores. No se escribe nada.`);
      }
    } catch (e) {
      if (/anómala/.test(e.message)) throw e;
    }
  }

  const salida = {
    _aviso: 'Planes declarados al Ministerio por cada operador. NO llevan fecha de validez ' +
            '(sólo unos pocos), así que pueden estar obsoletos. No sustituyen a promociones.json.',
    _fuente: URL_REGISTRO,
    _leido: hoy.toISOString(),
    _total: planes.length,
    _utiles: planes.filter(p => p.util).length,
    _operadores: [...new Set(planes.map(p => p.operador).filter(Boolean))].sort(),
    planes: planes.sort((a, b) =>
      a.operador.localeCompare(b.operador, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
  };

  // Sólo reescribimos si cambia algo más que la hora de lectura: así el bot no
  // ensucia el histórico del repositorio con un commit diario sin contenido.
  const cuerpo = JSON.stringify(salida.planes);
  if (existsSync(DESTINO)) {
    try {
      const previo = JSON.parse(await readFile(DESTINO, 'utf8'));
      if (JSON.stringify(previo.planes) === cuerpo) {
        console.log(`· Registro sin cambios (${planes.length} planes). No se reescribe.`);
        return;
      }
    } catch (e) { /* seguimos y reescribimos */ }
  }

  await mkdir(path.dirname(DESTINO), { recursive: true });
  await writeFile(DESTINO, JSON.stringify(salida, null, 1) + '\n');
  console.log(`✔ ${planes.length} planes (${salida._utiles} con cifra) de ${salida._operadores.length} operadores → ${DESTINO}`);
}

main().catch(e => {
  // En blando, siempre: esto es un extra y no puede tumbar la captura de precios.
  console.log(`· Registro de planes no disponible (${e.message}). Se continúa sin él.`);
  process.exit(0);
});
