'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'
import { borrarObjetosBucket } from '@/shared/lib/adjuntos/storage'

import type { Database } from '@/types/database'

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
 *  1. lee el email original (auth.users) — solo usuario;
 *  2. recolecta rutas de Storage vía el manifiesto (antes de anularlas en BD);
 *  3. borra los objetos de Storage (idempotente);
 *  4. redacta invitaciones por email + anonimiza auth.users (Admin API, idempotente);
 *  5. punto de commit: `purgar_sujeto_db` anonimiza el schema public y fija purgado_en.
 */
async function purgarUno(service: Service, p: Pendiente): Promise<void> {
  // 1. Email original ANTES de tocar auth.users (para redactar invitaciones).
  let emailOriginal: string | null = null
  if (p.sujeto_tipo === 'usuario') {
    const { data } = await service.auth.admin.getUserById(p.sujeto_id)
    emailOriginal = data.user?.email ?? null
  }

  // 2. Recolectar rutas de Storage mientras siguen siendo resolubles.
  const porBucket = await recolectarAdjuntosDe(service, p.sujeto_tipo, p.sujeto_id)

  // 3. Borrar objetos de Storage (best-effort idempotente).
  for (const [bucket, paths] of porBucket) {
    await borrarObjetosBucket(service, bucket, paths)
  }

  // 4. auth.users + invitaciones (solo usuarios; no van en la misma transacción).
  if (p.sujeto_tipo === 'usuario') {
    if (emailOriginal) {
      await service
        .from('invitaciones')
        .update({ email: MARCADOR_PII })
        .ilike('email', emailOriginal)
    }
    const { error: authError } = await service.auth.admin.updateUserById(p.sujeto_id, {
      email: `borrado+${p.sujeto_id}@borrado.invalid`,
      user_metadata: {},
      ban_duration: '876000h', // ~100 años: la cuenta deja de operar
    })
    if (authError) throw new Error(`auth anonimización falló: ${authError.message}`)
  }

  // 5. Commit: anonimización del schema public + marca de purga.
  const { error } = await service.rpc('purgar_sujeto_db', { p_solicitud_id: p.solicitud_id })
  if (error) throw new Error(`purgar_sujeto_db falló: ${error.message}`)
}
