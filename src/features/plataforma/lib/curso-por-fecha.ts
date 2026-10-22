/**
 * El curso con el que nace un centro (Fase 5, PR 2), calculado por la fecha: el curso escolar va
 * del 1 de septiembre al 31 de julio, como el de CEI Ejemplo. Desde agosto, el que empieza en
 * septiembre; antes, el que está en marcha. El superusuario lo puede cambiar en el formulario.
 */
export function cursoPorFecha(fechaYmd: string): { nombre: string; inicio: string; fin: string } {
  const [anio, mes] = fechaYmd.split('-').map(Number)
  const empieza = mes >= 8 ? anio : anio - 1
  return {
    nombre: `${empieza}-${String((empieza + 1) % 100).padStart(2, '0')}`,
    inicio: `${empieza}-09-01`,
    fin: `${empieza + 1}-07-31`,
  }
}
