import { randomUUID } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { errorDeclararGastos } from '@/features/gastos-gestion/lib/errores'
import { MAX_JUSTIFICANTE_BYTES, TIPOS_JUSTIFICANTE } from '@/features/gastos-gestion/lib/gastos'
import {
  BUCKET_JUSTIFICANTES_GESTION,
  borrarObjetosBucket,
  firmarRuta,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RespuestaOk {
  success: true
  documento: { path: string; url: string | null }
  pendienteValidacion?: boolean
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error }, { status })
}

/**
 * Fase 9 (D8) — el justificante de la transferencia de los gastos de gestión, PDF o imagen, en su
 * bucket `justificantes-gestion`. Como la tarjeta sanitaria (fase 7):
 *
 *  1. sube con el cliente del USUARIO: la RLS del bucket autoriza (Dirección o tutor legal, ruta del
 *     niño);
 *  2. la base fija la ruta con la sesión (`declarar_gastos_gestion`, forma transferencia) y decide la
 *     puerta: con el alta validada, el tutor recibe `alta_validada` y la app encola (`gastos_gestion`)
 *     con el fichero ya subido; al aprobar, Dirección lo fija;
 *  3. el fichero anterior, que ya no usa nadie, se borra.
 *
 * El service role, solo para Storage.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ninoId: string }> }
): Promise<Response> {
  const { ninoId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('alta.errors.no_autorizado', 401)

  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return err('alta.errors.no_autorizado', 403)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('gastos_gestion.errors.subida')
  }
  const file = form.get('file')
  const cursoId = form.get('curso_academico_id')
  if (!(file instanceof Blob)) return err('gastos_gestion.errors.subida')
  if (typeof cursoId !== 'string' || !UUID.test(cursoId))
    return err('gastos_gestion.errors.invalido')
  const ext = TIPOS_JUSTIFICANTE[file.type]
  if (!ext) return err('gastos_gestion.errors.tipo')
  if (file.size > MAX_JUSTIFICANTE_BYTES) return err('gastos_gestion.errors.tamano')

  const path = `${nino.centro_id}/${nino.id}/justificante-${randomUUID()}.${ext}`
  const service = createServiceRoleClient()

  // 1. Subida con el cliente del usuario: la RLS del bucket autoriza.
  const subida = await supabase.storage
    .from(BUCKET_JUSTIFICANTES_GESTION)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('justificante-gastos: upload', msg)
    return err('gastos_gestion.errors.subida', 500)
  }

  // 2. La base fija la ruta, o dice que va a la cola.
  const { data: anterior, error } = await supabase.rpc('declarar_gastos_gestion', {
    p_nino_id: nino.id,
    p_curso_academico_id: cursoId,
    p_forma: 'transferencia',
    p_justificante_path: path,
  })
  if (error) {
    if (error.hint === 'alta_validada') {
      const r = await registrarCambioPendiente(supabase, {
        ninoId: nino.id,
        usuarioId: user.id,
        entidad: 'gastos_gestion',
        payload: { curso_academico_id: cursoId, forma: 'transferencia', path },
      })
      if (!r.ok) {
        await borrarObjetosBucket(service, BUCKET_JUSTIFICANTES_GESTION, [path]).catch(
          () => undefined
        )
        return err(r.error, 403)
      }
      const urlStaged = await firmarRuta(service, BUCKET_JUSTIFICANTES_GESTION, path)
      return Response.json({
        success: true,
        documento: { path, url: urlStaged },
        pendienteValidacion: true,
      } satisfies RespuestaOk)
    }
    await borrarObjetosBucket(service, BUCKET_JUSTIFICANTES_GESTION, [path]).catch(() => undefined)
    const motivo = errorDeclararGastos(error)
    return err(motivo, motivo === 'alta.errors.no_autorizado' ? 403 : 400)
  }

  // 3. El justificante anterior ya no lo usa nadie: se borra (best-effort).
  if (anterior && anterior !== path) {
    await borrarObjetosBucket(service, BUCKET_JUSTIFICANTES_GESTION, [anterior]).catch(
      () => undefined
    )
  }
  const url = await firmarRuta(service, BUCKET_JUSTIFICANTES_GESTION, path)
  return Response.json({ success: true, documento: { path, url } } satisfies RespuestaOk)
}
