import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'
import { borrarObjetosBucket } from '@/shared/lib/adjuntos/storage'

import type { Database } from '@/types/database'

import { avisarFamilia } from '../lib/avisar'
import { recolectarAdjuntosDe } from '../lib/fuentes-adjuntos'
import { MARCADOR_PII, ok, fail, type ActionResult } from '../types'

type Service = SupabaseClient<Database>
type Pendiente = Database['public']['Functions']['olvido_pendientes']['Returns'][number]

export interface ResultadoPurga {
  total: number
  purgados: number
  fallidos: number
}

/**
 * Barrido de purga del derecho al olvido (D: RPC manual ahora; cron pg_cron en A6).
 * Solo backend (`server-only`, NO server action, D1): lo importa como módulo la ruta del
 * cron (`api/cron/retencion`, tras `CRON_SECRET`). Con `'use server'` cualquiera podía
 * dispararlo por POST.
 * Para cada solicitud cuya gracia ha vencido, ejecuta la purga del sujeto y la
 * marca como `purgado_en`. Idempotente y REINTENTABLE: las partes no-transaccionales
 * (Storage + `auth.users`, Decisión B) van ANTES del commit SQL, que es el punto
 * único que fija `purgado_en`. Si una falla, su solicitud sigue pendiente y se
 * reintenta en la siguiente pasada sin dañar a las demás.
 */
export async function purgarVencidos(): Promise<ActionResult<ResultadoPurga>> {
  const service = createServiceRoleClient()
  const { data: pendientes, error } = await service.rpc('olvido_pendientes')
  if (error) {
    logger.error('olvido: olvido_pendientes falló', error.message)
    return fail('No se pudieron listar las solicitudes vencidas')
  }

  let purgados = 0
  let fallidos = 0
  for (const p of pendientes ?? []) {
    try {
      // Antes de purgar, mientras aún se conoce la dirección de quien la pidió (spec,
      // «Avisos»). Si la purga falla y se reintenta mañana, el correo se repite.
      await avisarFamilia(service, p.solicitud_id, 'borrada')
      await purgarUno(service, p)
      purgados++
    } catch (e) {
      fallidos++
      logger.error(
        'olvido: purga de sujeto falló (se reintentará)',
        p.solicitud_id,
        e instanceof Error ? e.message : String(e)
      )
    }
  }

  return ok({ total: (pendientes ?? []).length, purgados, fallidos })
}

/**
 * Purga un único sujeto en el orden reintentable:
 *  0. ¿es su último centro? (multicentro, Fase 2) — solo usuario; un niño es de un centro;
 *  1. lee el email original (auth.users) — solo usuario;
 *  2. recolecta rutas de Storage vía el manifiesto (antes de anularlas en BD);
 *  3. borra los objetos de Storage (idempotente);
 *  4. redacta invitaciones por email (email y nombre) + anonimiza auth.users (Admin API,
 *     idempotente); `purgar_sujeto_db` redacta después sus copias en audit_log;
 *  5. punto de commit: `purgar_sujeto_db` anonimiza el schema public y fija purgado_en.
 *
 * Si no es el último centro, todo va acotado al de la solicitud: sus invitaciones y su DNI de
 * ese centro, y ni el avatar ni la cuenta de Auth, que son de la cuenta y se van con el último.
 * La respuesta sale de `olvido_es_ultimo_centro`, la misma función que usa `purgar_sujeto_db`,
 * así que la app y la BD deciden lo mismo. Queda un hueco: si entre esta pregunta y el commit le
 * dan un rol en otro centro, la cuenta de Auth ya se habrá bloqueado. Exportada para su test.
 */
export async function purgarUno(service: Service, p: Pendiente): Promise<void> {
  // 0. ¿Último centro?
  let esUltimo = true
  if (p.sujeto_tipo === 'usuario') {
    const { data, error: uErr } = await service.rpc('olvido_es_ultimo_centro', {
      p_solicitud_id: p.solicitud_id,
    })
    if (uErr || data === null) {
      throw new Error(`olvido_es_ultimo_centro falló: ${uErr?.message ?? 'sin respuesta'}`)
    }
    esUltimo = data
  }

  // 1. Email original ANTES de tocar auth.users (para redactar invitaciones).
  let emailOriginal: string | null = null
  let metadatos: Record<string, unknown> = {}
  if (p.sujeto_tipo === 'usuario') {
    const { data, error: getError } = await service.auth.admin.getUserById(p.sujeto_id)
    if (getError) throw new Error(`auth lectura falló: ${getError.message}`)
    emailOriginal = data.user?.email ?? null
    metadatos = data.user?.user_metadata ?? {}
  }

  // 2. Recolectar rutas de Storage mientras siguen siendo resolubles.
  const porBucket = await recolectarAdjuntosDe(service, p, esUltimo)

  // 3. Borrar objetos de Storage (best-effort idempotente).
  for (const [bucket, paths] of porBucket) {
    await borrarObjetosBucket(service, bucket, paths)
  }

  // 4. auth.users + invitaciones (solo usuarios; no van en la misma transacción). Las
  //    invitaciones de este centro; las de los demás, y la cuenta de Auth, con el último.
  if (p.sujeto_tipo === 'usuario') {
    if (emailOriginal) {
      // entre-centros: con su último centro, todas; si le queda otro, se acota abajo al de la
      // solicitud (ADR-0059).
      let inv = service
        .from('invitaciones')
        .update({ email: MARCADOR_PII, nombre_completo: MARCADOR_PII })
        .ilike('email', emailOriginal)
      if (!esUltimo) inv = inv.eq('centro_id', p.centro_id)
      await inv
    }
    if (esUltimo) await anonimizarCuentaAuth(service, p.sujeto_id, metadatos)
  }

  // 5. Commit: anonimización del schema public + marca de purga.
  const { error } = await service.rpc('purgar_sujeto_db', { p_solicitud_id: p.solicitud_id })
  if (error) throw new Error(`purgar_sujeto_db falló: ${error.message}`)
}

/**
 * Anonimiza la cuenta de Auth del sujeto: email ficticio, metadatos vacíos y baneo de ~100
 * años. GoTrue FUSIONA `user_metadata` (una clave con `null` se borra, una ausente se queda),
 * así que `{}` no vaciaba nada: el nombre y el idioma seguían en `raw_user_meta_data`. Se manda
 * cada clave que había con `null`. Idempotente. Exportada para su test contra el GoTrue real.
 */
export async function anonimizarCuentaAuth(
  service: Service,
  usuarioId: string,
  metadatos: Record<string, unknown>
): Promise<void> {
  const vaciar = Object.fromEntries(Object.keys(metadatos).map((k) => [k, null]))
  const { error } = await service.auth.admin.updateUserById(usuarioId, {
    email: `borrado+${usuarioId}@borrado.invalid`,
    user_metadata: vaciar,
    ban_duration: '876000h', // ~100 años: la cuenta deja de operar
  })
  if (error) throw new Error(`auth anonimización falló: ${error.message}`)
}
