import { z } from 'zod'

/**
 * Lo que devuelve `resumen_reabrir_remesa` (`20261227120000`): la misma consulta con que
 * `reabrir_remesa` comprueba que nada cambió. Se valida al leerla: si la BD cambiara la forma, el
 * aviso daría error en vez de pintar «undefined familias».
 *  - `n_recibos`, `n_familias`, `total_centimos`: los cobrables (SEPA, pendientes o enviados, con
 *    importe), que son lo que el banco cobraría con el fichero anterior y lo que llevará el nuevo;
 *  - `n_devueltos`, `n_cobrados`: los que no se tocan y se quedan en la remesa.
 */
export const resumenReabrirSchema = z.object({
  estado: z.enum(['borrador', 'enviada']),
  fecha_envio_banco: z.string().nullable(),
  fichero_generado_at: z.string().nullable(),
  fichero_guardado: z.boolean(),
  n_recibos: z.number().int().min(0),
  n_familias: z.number().int().min(0),
  total_centimos: z.number().int().min(0),
  n_enviados: z.number().int().min(0),
  n_devueltos: z.number().int().min(0),
  n_cobrados: z.number().int().min(0),
})
export type ResumenReabrir = z.infer<typeof resumenReabrirSchema>

/**
 * Los tres avisos, según lo que sabe NIDO de la remesa. Lo que decide es la marca de la descarga
 * (`fichero_generado_at`), no que el fichero esté guardado: una remesa descargada antes de R-1
 * tiene la marca y no el fichero, y de ella NIDO sí sabe que se descargó.
 *  - `enviada`: se marcó enviada y su fichero se descargó; el banco puede tenerlo;
 *  - `enviada_sin_constancia`: se marcó enviada sin la marca de ninguna descarga (las marcadas antes
 *    de R-4, como la de CEI Ejemplo). No se sabe si el fichero llegó al banco por otro camino: el
 *    aviso dice el síntoma, no la causa;
 *  - `fichero_descargado`: en borrador, con el fichero descargado; pudo subirse al banco.
 */
export type CasoReabrir = 'enviada' | 'enviada_sin_constancia' | 'fichero_descargado'

export function casoReabrir(
  r: Pick<ResumenReabrir, 'estado' | 'fichero_generado_at'>
): CasoReabrir {
  if (r.estado === 'borrador') return 'fichero_descargado'
  return r.fichero_generado_at === null ? 'enviada_sin_constancia' : 'enviada'
}

/** Un recibo que no se toca al reabrir: ya volvió del banco o ya se cobró a mano. */
export interface ReciboQueNoSeToca {
  id: string
  familiaEtiqueta: string
  totalCentimos: number
  estado: 'devuelto' | 'cobrado_manual'
}

export interface AvisoReabrir {
  remesaId: string
  resumen: ResumenReabrir
  caso: CasoReabrir
  /** Los devueltos y los cobrados a mano, por familia: tantos como cuenta el resumen. */
  noSeTocan: ReciboQueNoSeToca[]
}

/**
 * Quién ve «Reabrir»: la admin del centro y no el superusuario, como `privado.es_titular` en la BD
 * (que a cualquier otro le contesta 42501). En la app el superusuario es responsable de todo centro,
 * así que `esResponsable` solo no basta.
 */
export function puedeReabrirRemesa(ctx: { esResponsable: boolean; esSuperusuario: boolean }) {
  return ctx.esResponsable && !ctx.esSuperusuario
}
