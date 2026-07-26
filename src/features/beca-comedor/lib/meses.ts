// Etiquetado de meses (año+mes) para los selectores de carga. `mesKey` es la clave estable
// que viaja en los <Select> ("2026-9"); `etiquetaMes` la formatea localizada ("septiembre
// de 2026") vía Intl, sin claves i18n por mes.

/** Clave estable de un (año, mes) para value de <Select>. */
export function mesKey(anio: number, mes: number): string {
  return `${anio}-${mes}`
}

/** Etiqueta localizada de un (año, mes), p. ej. "septiembre de 2026". */
export function etiquetaMes(locale: string, anio: number, mes: number): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(anio, mes - 1, 1)
  )
}
