// Filtros del histórico general de recibos (F-6), en la URL: año, mes, familia, niño y página.
// Puro: lo que llega de la URL se valida aquí y lo que no vale se ignora (sin filtro), nunca se
// pasa a la consulta.

export interface FiltroHistorial {
  anio: number | null
  mes: number | null
  familiaId: string | null
  ninoId: string | null
  pagina: number
}

export type ParamsHistorial = Partial<
  Record<'anio' | 'mes' | 'familia' | 'nino' | 'pagina', string>
>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function entero(v: string | undefined, min: number, max: number): number | null {
  if (v == null || !/^\d+$/.test(v)) return null
  const n = Number(v)
  return n >= min && n <= max ? n : null
}

/** Lee el filtro de la URL. Un valor que no vale (un mes 13, un id que no es uuid) no filtra. */
export function leerFiltroHistorial(params: ParamsHistorial): FiltroHistorial {
  return {
    anio: entero(params.anio, 2024, 2100),
    mes: entero(params.mes, 1, 12),
    familiaId: params.familia ? params.familia : null,
    ninoId: params.nino && UUID.test(params.nino) ? params.nino : null,
    pagina: entero(params.pagina, 1, 100_000) ?? 1,
  }
}

/** La URL del histórico con este filtro; sin los vacíos y sin `pagina=1`. */
export function hrefHistorial(base: string, filtro: FiltroHistorial): string {
  const p = new URLSearchParams()
  if (filtro.anio) p.set('anio', String(filtro.anio))
  if (filtro.mes) p.set('mes', String(filtro.mes))
  if (filtro.familiaId) p.set('familia', filtro.familiaId)
  if (filtro.ninoId) p.set('nino', filtro.ninoId)
  if (filtro.pagina > 1) p.set('pagina', String(filtro.pagina))
  const q = p.toString()
  return q ? `${base}?${q}` : base
}
