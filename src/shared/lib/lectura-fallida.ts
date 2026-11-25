/**
 * Una lectura que falló NO es «no hay» (censo C, decisión de Jose del 2026-11-25). Antes, cientos de
 * lecturas tomaban el error de Supabase por una lista vacía, un cero o un null, y la pantalla decía «no hay
 * nada» cuando lo que pasaba es que no se pudo leer.
 *
 * La regla: quien lee mira `error` y, si lo hay, lanza `LecturaFallida` (en una consulta, una página o una
 * ruta) o contesta `fail('common.lectura_fallida')` (en una acción). Una página que lanza la pinta el
 * `error.tsx` de su sección («No se ha podido leer»); una sección aislada, `LimiteSeccion`. Lo vigila la
 * regla de lint `nido/lectura-mira-el-error`.
 *
 * El mensaje no lleva datos personales: el nombre de quien leía y el de Postgres/PostgREST.
 */
export class LecturaFallida extends Error {
  readonly donde: string
  readonly codigo: string | null

  constructor(donde: string, causa: { message?: string; code?: string } | null | undefined) {
    super(`No se pudo leer (${donde}): ${causa?.message ?? 'sin respuesta'}`)
    this.name = 'LecturaFallida'
    this.donde = donde
    this.codigo = causa?.code ?? null
  }
}

export function esLecturaFallida(e: unknown): e is LecturaFallida {
  return e instanceof LecturaFallida || (e instanceof Error && e.name === 'LecturaFallida')
}
