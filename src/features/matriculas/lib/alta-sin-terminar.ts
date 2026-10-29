import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { recolectarAdjuntosDe } from '@/features/olvido/lib/fuentes-adjuntos'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_MANDATO_SEPA,
  BUCKET_RECOGIDA_ADJUNTOS,
  BUCKET_USUARIOS_FOTOS,
} from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import { GRACIA_ESQUELETO_DIAS } from '@/features/retencion/types'

import type { Database } from '@/types/database'

type Service = SupabaseClient<Database>

/** Los días que tiene que llevar un alta sin terminar para proponérsela a Dirección. */
export const DIAS_ALTA_SIN_TERMINAR = GRACIA_ESQUELETO_DIAS

/** Lo que la base sabe del alta antes de tocarla (`datos_anular_alta`). */
interface DatosAlta {
  centro_id: string
  estado: 'invitacion_abierta' | 'sin_invitacion' | 'iniciada'
  accion: 'cancelar' | 'borrar'
  familia_nueva: boolean
  mandatos: string[]
  dnis: string[]
  recogida: string[]
}

export type ResultadoAnular =
  | { resultado: 'cancelada' }
  | { resultado: 'borrada'; cuentasBorradas: number; cuentasEsperan: number }
  | { resultado: 'ya_no' }

/**
 * El botón del alta sin terminar (20261209120000). Si la invitación está abierta, la cancela y el
 * alta se queda. Si no, borra todo lo del alta: primero sus ficheros de Storage, mientras sus rutas
 * siguen en la base; después la base, que vuelve a mirar el estado (si cambió entre medias, 40001 y
 * no hace nada); y al final las cuentas de Auth de quien ya no tiene nada. Si Storage falla, la base
 * no se toca: borrar la fila perdería la ruta. `ya_no`: ya no es un alta sin terminar.
 */
export async function anularAltaCore(
  service: Service,
  ninoId: string,
  actorId: string
): Promise<ResultadoAnular> {
  const { data, error } = await service.rpc('datos_anular_alta', { p_nino_id: ninoId })
  if (error) throw new Error(`datos_anular_alta: ${error.message}`)
  if (!data) return { resultado: 'ya_no' }
  const d = data as unknown as DatosAlta

  if (d.accion === 'borrar') {
    // Los del niño, con el manifiesto del olvido. Los de los tutores no: si la familia ya tuvo un
    // hijo, se quedan; si es nueva, sus DNI y sus mandatos vienen de la base (`dnis`, `mandatos`), y
    // el avatar de quien se borra entero se va después, por su prefijo.
    const porBucket = await recolectarAdjuntosDe(
      service,
      { sujeto_tipo: 'nino', sujeto_id: ninoId, centro_id: d.centro_id },
      true
    )
    for (const [bucket, paths] of [
      [BUCKET_MANDATO_SEPA, d.mandatos],
      [BUCKET_DNI_TUTORES, d.dnis],
      [BUCKET_RECOGIDA_ADJUNTOS, d.recogida],
    ] as const) {
      if (paths.length > 0) porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), ...paths])
    }
    for (const [bucket, paths] of porBucket) {
      const unicas = [...new Set(paths)]
      if (unicas.length === 0) continue
      const { error: errSt } = await service.storage.from(bucket).remove(unicas)
      if (errSt) throw new Error(`Storage ${bucket}: ${errSt.message}`)
    }
  }

  const { data: res, error: errAnular } = await service.rpc('anular_alta', {
    p_nino_id: ninoId,
    p_actor: actorId,
    p_accion: d.accion,
  })
  if (errAnular)
    throw Object.assign(new Error(errAnular.message), {
      code: errAnular.code,
      hint: errAnular.hint,
    })
  if (!res) return { resultado: 'ya_no' }
  const r = res as { accion: string; cuentas?: string[]; esperan?: number }
  if (r.accion === 'cancelada') return { resultado: 'cancelada' }

  const borradas = r.cuentas ?? []
  await borrarCuentasDeAuth(service, borradas)
  return { resultado: 'borrada', cuentasBorradas: borradas.length, cuentasEsperan: r.esperan ?? 0 }
}

/**
 * «Enviar una invitación nueva», la parte del servidor: corrige el email y borra lo del email viejo
 * (sus invitaciones, en la base; la cuenta de Auth que creó y nunca entró, aquí). La invitación
 * nueva la envía quien llama (`sendInvitation`). Devuelve el tipo de vínculo de la vieja, o null si
 * ya no es un alta sin terminar.
 */
export async function reinvitarAltaCore(
  service: Service,
  ninoId: string,
  email: string,
  actorId: string
): Promise<{ tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' } | null> {
  const { data, error } = await service.rpc('reinvitar_alta', {
    p_nino_id: ninoId,
    p_email: email,
    p_actor: actorId,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code, hint: error.hint })
  if (!data) return null
  const r = data as { tipo_vinculo: string; stubs: string[] }
  await borrarCuentasDeAuth(service, r.stubs ?? [])
  return {
    tipoVinculo:
      r.tipo_vinculo === 'tutor_legal_secundario'
        ? 'tutor_legal_secundario'
        : 'tutor_legal_principal',
  }
}

/**
 * Las cuentas que la base ya borró de `usuarios`: su avatar (vive bajo su id) y su cuenta de Auth.
 * Si la Admin API falla, se le deja el email de la purga (`borrado+<id>@borrado.invalid`): así
 * `cuentas_auth_huerfanas` la encuentra y el cron la vuelve a intentar. Ningún fallo para el resto.
 */
async function borrarCuentasDeAuth(service: Service, ids: string[]): Promise<void> {
  for (const id of ids) {
    const { data: avatares } = await service.storage.from(BUCKET_USUARIOS_FOTOS).list(id)
    const paths = (avatares ?? []).filter((o) => o.id !== null).map((o) => `${id}/${o.name}`)
    if (paths.length > 0) {
      const { error } = await service.storage.from(BUCKET_USUARIOS_FOTOS).remove(paths)
      if (error) logger.error('alta sin terminar: el avatar no se borró', id, error.message)
    }
    const { error } = await service.auth.admin.deleteUser(id)
    if (!error) continue
    logger.error(
      'alta sin terminar: la cuenta de Auth no se borró (se reintentará)',
      id,
      error.message
    )
    const { error: errAnon } = await service.auth.admin.updateUserById(id, {
      email: `borrado+${id}@borrado.invalid`,
    })
    if (errAnon) logger.error('alta sin terminar: tampoco se anonimizó', id, errAnon.message)
  }
}
