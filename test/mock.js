// Muestra sintética con la MISMA forma que devuelve el Ministerio.
const st = (id, rot, dir, mun, lat, lon, g95, gA, hor, venta = 'P') => ({
  'C.P.': '11207',
  'Dirección': dir,
  'Horario': hor,
  'Latitud': String(lat).replace('.', ','),
  'Localidad': mun,
  'Longitud (WGS84)': String(lon).replace('.', ','),
  'Margen': 'D',
  'Municipio': mun,
  'Precio Biodiesel': '',
  'Precio Bioetanol': '',
  'Precio Gas Natural Comprimido': '',
  'Precio Gas Natural Licuado': '',
  'Precio Gases licuados del petróleo': '',
  'Precio Gasoleo A': gA === null ? '' : String(gA).replace('.', ','),
  'Precio Gasoleo B': '',
  'Precio Gasoleo Premium': '',
  'Precio Gasolina 95 E10': '',
  'Precio Gasolina 95 E5': g95 === null ? '' : String(g95).replace('.', ','),
  'Precio Gasolina 95 E5 Premium': '',
  'Precio Gasolina 98 E10': '',
  'Precio Gasolina 98 E5': '',
  'Precio Hidrogeno': '',
  'Provincia': 'CÁDIZ',
  'Remisión': 'dm',
  'Rótulo': rot,
  'Tipo Venta': venta,
  'IDEESS': String(id),
  'IDMunicipio': '1234',
  'IDProvincia': '11',
  'IDCCAA': '01'
});

// Origen del test: 36.1408, -5.4562 (Algeciras)
module.exports = {
  Fecha: '16/08/2026 8:00:00',
  ListaEESSPrecio: [
    st(1, 'PLENOIL',   'AVDA VIRGEN DEL CARMEN, 12 "EL CRUCE"', 'ALGECIRAS', 36.1300, -5.4500, 1.399, 1.359, 'L-D: 24H'),
    st(2, 'REPSOL',    'CTRA N-340 KM 108',         'ALGECIRAS', 36.1500, -5.4600, 1.629, 1.579, 'L-D: 06:00-23:00'),
    st(3, 'CEPSA',     'CALLE PARAGUAY 3',          'ALGECIRAS', 36.1420, -5.4530, 1.589, 1.549, 'L-V: 07:00-22:00; S: 08:00-14:00'),
    st(4, 'BALLENOIL', 'POL IND EL FRESNO',         'LOS BARRIOS', 36.1850, -5.4900, 1.379, 1.339, 'L-D: 24H'),
    st(5, 'CARREFOUR', 'CC BAHIA SUR',              'SAN FERNANDO', 36.4600, -6.1900, 1.349, 1.309, 'L-S: 09:00-22:00'),   // lejos: >50 km
    st(6, 'PETROPRIX', 'AVDA DE LA HISPANIDAD',     'ALGECIRAS', 36.1360, -5.4480, 1.389, null,  'L-D: 24H'),               // sin gasóleo A
    st(7, 'FLOTA SL',  'ZONA PORTUARIA',            'ALGECIRAS', 36.1350, -5.4400, 1.199, 1.149, 'L-V: 08:00-15:00', 'R'),  // venta restringida
    st(8, 'SHELL',     'AVDA DE LAS FLORES',        'LA LINEA',  36.1650, -5.3480, 1.559, 1.519, 'L-D: 24H'),
    st(9, 'SIN COORD', 'DESCONOCIDA',               'X',         0,        0,      1.111, 1.111, 'L-D: 24H')                // debe descartarse
  ],
  Nota: 'Muestra de prueba'
};
