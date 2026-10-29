import 'server-only'

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_CUENTA_TUTOR_ANIOS } from '../types'

export interface ResultadoCuentas {
  /** En simulación solo se cuentan: no se purga nada. */
  dryRun: boolean
  /** Cuentas vencidas, por centro. NULL si no se pudieron listar. */
  vencidas: number | null
  /** Purgadas (0 en simulación). */
  purgadas: number
  /** Las que fallaron: su petición por plazo queda abierta y se reintenta en la siguiente pasada. */
  fallidas: number
  /** Consentimientos de la cuenta (sin niño) con la cuenta entera vencida. NULL si falló. */
  consentimientosCuenta: number | null
}

/**
 * Purga la cuenta de los tutores y autorizados a los N años (`RETENCION_CUENTA_TUTOR_ANIOS`) de la
 * baja de su último hijo en el centro, si no les queda otro rol vivo allí (20261207120000). Es la
 * purga del olvido (`purgarUno`: Storage, invitaciones, la cuenta de Auth y la BD), sobre una
 * petición «por plazo» que abre la BD, sin gracia y sin correo. La BD respeta la retención y espera
 * al dinero vivo de la familia (20261208120000; un borrador sin deuda no frena). Después, los consentimientos de la cuenta (sin niño) de
 * las cuentas ya purgadas en todos sus centros. Respeta la simulación del cron.
 */
export async function purgarCuentas(opts: { dryRun: boolean }): Promise<ResultadoCuentas> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('cuentas_vencidas', {
    p_anios: RETENCION_CUENTA_TUTOR_ANIOS,
  })
  if (error || !Array.isArray(data)) {
    logger.error('retención: cuentas', error?.message ?? 'respuesta sin la forma esperada')
    return {
      dryRun: opts.dryRun,
      vencidas: null,
      purgadas: 0,
      fallidas: 0,
      consentimientosCuenta: await consentimientosCuenta(service, opts.dryRun),
    }
  }

  let purgadas = 0
  let fallidas = 0
  if (!opts.dryRun) {
    for (const v of data) {
      try {
        if (await purgarCuenta(service, v)) purgadas++
      } catch (e) {
        fallidas++
        logger.error(
          'retención: la cuenta de un tutor falló (se reintentará)',
          v.usuario_id,
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }
  return {
    dryRun: opts.dryRun,
    vencidas: data.length,
    purgadas,
    fallidas,
    consentimientosCuenta: await consentimientosCuenta(service, opts.dryRun),
  }
}

type Service = ReturnType<typeof createServiceRoleClient>
interface Vencida {
  usuario_id: string
  centro_id: string
}

/**
 * Abre (o recupera) la petición por plazo y la purga con la purga del olvido. `false` si la BD ya
 * no la abre: entre la lista y aquí le dieron un rol, la retuvieron o pidió ella el olvido.
 * Exportada para su test.
 */
export async function purgarCuenta(service: Service, v: Vencida): Promise<boolean> {
  const { data: solicitud, error } = await service.rpc('abrir_purga_cuenta', {
    p_usuario_id: v.usuario_id,
    p_centro_id: v.centro_id,
    p_anios: RETENCION_CUENTA_TUTOR_ANIOS,
  })
  if (error) throw new Error(`abrir_purga_cuenta falló: ${error.message}`)
  if (!solicitud) return false

  await purgarUno(service, {
    solicitud_id: solicitud,
    sujeto_tipo: 'usuario',
    sujeto_id: v.usuario_id,
    centro_id: v.centro_id,
    gracia_hasta: new Date().toISOString(),
  })
  return true
}

async function consentimientosCuenta(service: Service, dryRun: boolean): Promise<number | null> {
  const { data, error } = await service.rpc('destruir_consentimientos_cuenta', {
    p_anios: RETENCION_CUENTA_TUTOR_ANIOS,
    p_simular: dryRun,
  })
  if (error || typeof data !== 'number') {
    logger.error('retención: consentimientos de la cuenta', error?.message ?? 'sin recuento')
    return null
  }
  return data
}

export interface ResultadoCuentasOlvidadas {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Cuentas que se intentarían borrar (en simulación) o se intentaron. NULL si falló. */
  candidatas: number | null
  /** Borradas de la BD (0 en simulación). */
  borradas: number
  /** Las que algo nombra todavía (su actividad en audit_log, una petición suya): esperan. */
  esperan: number
  /** Cuentas de Auth sin fila en usuarios: las borradas ahora y las que quedaron de antes. */
  auth: { pendientes: number | null; borradas: number; fallidas: number }
}

/**
 * Borra la cuenta de quien ya no tiene nada en ningún centro (20261208120000): purgada en todos,
 * sin perfil de tutor en ninguna familia (lo fiscal ya se la llevó), sin rol vivo y sin retener.
 * Primero la fila de `usuarios`, en la BD, que no la borra si algo la nombra todavía; después su
 * cuenta de Auth, que no se borra por SQL. Las de Auth que quedaron de una pasada anterior se
 * reintentan: la BD las encuentra por el email que les dejó la purga. Respeta la simulación.
 */
export async function borrarCuentasOlvidadas(opts: {
  dryRun: boolean
}): Promise<ResultadoCuentasOlvidadas> {
  const service = createServiceRoleClient()
  const r: ResultadoCuentasOlvidadas = {
    dryRun: opts.dryRun,
    candidatas: null,
    borradas: 0,
    esperan: 0,
    auth: { pendientes: null, borradas: 0, fallidas: 0 },
  }

  const { data, error } = await service.rpc('destruir_cuentas_olvidadas', {
    p_simular: opts.dryRun,
  })
  const res = (data ?? null) as {
    candidatas?: number
    borradas?: string[]
    esperan?: number
  } | null
  if (error || !res) {
    logger.error('retención: cuentas olvidadas', error?.message ?? 'sin respuesta')
  } else if (opts.dryRun) {
    r.candidatas = typeof res.candidatas === 'number' ? res.candidatas : null
  } else if (Array.isArray(res.borradas) && typeof res.esperan === 'number') {
    r.borradas = res.borradas.length
    r.esperan = res.esperan
    r.candidatas = r.borradas + r.esperan
  } else {
    logger.error('retención: cuentas olvidadas', 'respuesta sin la forma esperada')
  }

  const { data: huerfanas, error: errHuerfanas } = await service.rpc('cuentas_auth_huerfanas')
  if (errHuerfanas || !Array.isArray(huerfanas)) {
    logger.error('retención: cuentas de Auth', errHuerfanas?.message ?? 'sin lista')
    return r
  }
  r.auth.pendientes = huerfanas.length
  if (opts.dryRun) return r
  for (const id of huerfanas) {
    const { error: errDel } = await service.auth.admin.deleteUser(id)
    if (errDel) {
      r.auth.fallidas++
      logger.error('retención: una cuenta de Auth falló (se reintentará)', id, errDel.message)
    } else {
      r.auth.borradas++
    }
  }
  return r
}
