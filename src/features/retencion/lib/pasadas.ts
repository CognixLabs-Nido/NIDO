import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'

import type { Database, Json } from '@/types/database'

import type { ResultadoPurga } from '@/features/olvido/actions/purgar-vencidos'

import type { ResultadoAuditLog } from './audit-log'
import type { ResultadoCuentas, ResultadoCuentasOlvidadas } from './cuentas'
import type { ResultadoExpediente } from './expediente'
import type { ResultadoExportLog } from './export-log'
import type { ResultadoFirmas } from './firmas'
import type { ResultadoFiscal } from './fiscal'
import type { ResultadoLecturas } from './lecturas-ficha-medica'
import type { ResultadoListaEspera } from './lista-espera'
import type { ResultadoOperativa } from './operativa'
import type { ActionResult, ResultadoBarrido } from '../types'

type Service = SupabaseClient<Database>

/** Un barrido que devuelve `ActionResult` y falló: el texto del error no entra en el registro. */
export interface FalloBarrido {
  fallo: true
}

/**
 * El recuento de cada uno de los doce barridos de una pasada, con las claves que exige el CHECK de
 * `retencion_pasadas` (20261213120000). Va a la base y a los logs: solo números, marcas y nulos.
 */
export interface RecuentosPasada {
  olvido: ResultadoPurga | FalloBarrido
  retencion: ResultadoBarrido | FalloBarrido
  lecturasFichaMedica: ResultadoLecturas
  auditLog: ResultadoAuditLog
  exportLog: ResultadoExportLog
  listaEspera: ResultadoListaEspera
  operativa: ResultadoOperativa
  expediente: ResultadoExpediente
  firmas: ResultadoFirmas
  cuentas: ResultadoCuentas
  fiscal: ResultadoFiscal
  cuentasOlvidadas: ResultadoCuentasOlvidadas
}

// Un recuento no lleva texto: un id, un nombre o un mensaje de error llegarían a la base y a los
// logs de Vercel. Si un resultado gana un campo de texto, esto deja de compilar.
type TieneTexto<T> = T extends string
  ? true
  : T extends object
    ? { [K in keyof T]-?: TieneTexto<T[K]> }[keyof T]
    : false
const recuentosSinTexto: TieneTexto<RecuentosPasada> extends false ? true : never = true
void recuentosSinTexto

/** El resultado de un barrido con `ActionResult`, sin el texto del error. */
export function recuentoDe<T>(r: ActionResult<T>): T | FalloBarrido {
  return r.success ? r.data : { fallo: true }
}

/**
 * Deja la fila de la pasada en `retencion_pasadas`, encuentre algo o no, y su resultado en los
 * logs. Va a `logger.warn` porque `logger.info` en producción no escribe nada: es el nivel que se
 * guarda en Vercel, no una alarma. Si la fila no entra, lo dice por `logger.error` (Sentry) y
 * devuelve false: la pasada no queda registrada y la ruta lo contesta.
 */
export async function registrarPasada(
  service: Service,
  dryRun: boolean,
  recuentos: RecuentosPasada
): Promise<boolean> {
  const modo = dryRun ? 'simulado' : 'purgado'
  logger.warn('cron retencion ejecutado', JSON.stringify({ modo, ...recuentos }))

  const { error } = await service
    .from('retencion_pasadas')
    // Json no admite interfaces; que no haya texto dentro lo comprueba `TieneTexto` arriba.
    .insert({ modo, recuentos: recuentos as unknown as Json })
  if (error) {
    logger.error('retención: la pasada no quedó registrada', error.message)
    return false
  }
  return true
}
