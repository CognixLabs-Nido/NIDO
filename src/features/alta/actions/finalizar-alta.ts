'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getInfoMedica } from '@/features/ninos/queries/get-ninos'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { leerTutoresDeNino } from '../lib/tutores-familia'

import { fail, ok } from '../../centros/types'

/**
 * Bloques OBLIGATORIOS del alta que el gate de completitud exige antes de finalizar. El
 * orden de la lista es el orden en que se muestra el checklist "qué falta" en la UI.
 *
 * NOTA — `tutor2` es OPCIONAL (no aparece aquí): no bloquea.
 * TODO(PR-4e): añadir el acuse de NORMAS de régimen interno al gate cuando quede operativo.
 *   Hoy NO se incluye a propósito: el acuse de normas está roto (se difiere, bug 6), así que
 *   meterlo ahora bloquearía TODA finalización. Solo `imagen` entra como acuse obligatorio.
 */
export type BloqueAlta = 'identidad' | 'tutor1' | 'medico' | 'documentos' | 'sepa' | 'imagen'

const ORDEN_BLOQUES: BloqueAlta[] = [
  'identidad',
  'tutor1',
  'medico',
  'documentos',
  'sepa',
  'imagen',
]

/** Resultado de `finalizarAlta`: en fallo por completitud viaja `faltan` (bloques). */
export type FinalizarAltaResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; faltan?: BloqueAlta[] }

const ninoIdSchema = z.string().uuid()

/**
 * Pieza 3c — el TUTOR LEGAL finaliza el alta de su hijo: la matrícula pasa de
 * `'pendiente'` a `'lista'` (cola de validación de la dirección) vía la RPC
 * `marcar_matricula_lista` (SECURITY DEFINER, gate `es_tutor_legal_de`).
 *
 * ANTES de finalizar corre un GATE DE COMPLETITUD (PR-4b): valida que los bloques
 * obligatorios están completos leyendo las señales que ya derivan de BD (solo lectura, sin
 * columnas nuevas). Si falta alguno, NO finaliza y devuelve la lista `faltan` para que la UI
 * muestre un checklist claro. La identidad y el acuse médico ya se validaban; ahora se suman
 * tutor 1, documentos, SEPA e imagen. La RPC sigue siendo el backstop (llamadas directas).
 *
 * Idempotente: re-finalizar estando ya `'lista'` es no-op en la RPC (devuelve null) y se
 * trata como éxito — el gate vuelve a pasar porque los datos ya están completos.
 */
export async function finalizarAlta(ninoId: string): Promise<FinalizarAltaResult> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('alta.errors.finalizar_fallo')
  const id = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const faltan: BloqueAlta[] = []

  // Identidad del menor + libro de familia (documento del niño) en una sola lectura.
  const { data: nino } = await supabase
    .from('ninos')
    .select('apellidos, fecha_nacimiento, libro_familia_path')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return fail('alta.errors.finalizar_fallo')
  if (!nino.apellidos || !nino.fecha_nacimiento) faltan.push('identidad')

  // Tutor 1 (identidad) + su DNI (documento) desde el perfil COMPARTIDO `familia_tutores`
  // (F-2b-3): el titular. La señal de "tutor 1 hecho" es tener `nombre_completo`.
  const { tutores } = await leerTutoresDeNino(supabase, id)
  const tutor1 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_principal')
  if (!tutor1?.nombre_completo) faltan.push('tutor1')

  // Médico + emergencia: acuse `datos_medicos` vigente + teléfono de emergencia (el resto de
  // campos médicos pueden ser legítimamente nulos → no se exigen). `get_info_medica` descifra
  // server-side con autorización.
  const { data: acuse } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('tipo', 'datos_medicos')
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  const medica = await getInfoMedica(id)
  if (!acuse || !medica?.telefono_emergencia) faltan.push('medico')

  // Documentos: libro de familia (niño) + DNI del tutor 1. El DNI del tutor 2 NO se exige
  // (tutor 2 es opcional).
  if (!nino.libro_familia_path || !tutor1?.dni_documento_path) faltan.push('documentos')

  // SEPA: mandato activo del niño (lo registra `registrar_mandato_sepa` al firmar). Basta con
  // que exista uno `activo` no borrado.
  const { data: mandato } = await supabase
    .from('mandatos_sepa')
    .select('id')
    .eq('nino_id', id)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!mandato) faltan.push('sepa')

  // Autorización de IMAGEN firmada (acuse obligatorio que hoy funciona). Se busca la instancia
  // publicada por-niño y su última firma; `firmado` = acuse hecho. NORMAS NO entra en el gate
  // (rota, bug 6 / TODO PR-4e arriba) para no bloquear la finalización.
  const { data: imagenInst } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('tipo', 'autorizacion_imagenes')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .eq('nino_id', id)
    .limit(1)
    .maybeSingle()
  let imagenFirmada = false
  if (imagenInst) {
    const { data: firma } = await supabase
      .from('firmas_autorizacion')
      .select('decision')
      .eq('autorizacion_id', imagenInst.id)
      .eq('nino_id', id)
      .order('firmado_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    imagenFirmada = firma?.decision === 'firmado'
  }
  if (!imagenFirmada) faltan.push('imagen')

  if (faltan.length > 0) {
    faltan.sort((a, b) => ORDEN_BLOQUES.indexOf(a) - ORDEN_BLOQUES.indexOf(b))
    return { success: false, error: 'alta.errors.incompleto', faltan }
  }

  // Gate OK → finalizar. `null` (no había 'pendiente') = idempotente: ya estaba
  // 'lista'/'activa' → éxito.
  const { error } = await supabase.rpc('marcar_matricula_lista', { p_nino_id: id })
  if (error) {
    logger.warn('finalizarAlta', error.message)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.errors.finalizar_fallo')
  }

  // Revalida la ruta del alta (todas las locales) para que el RSC sirva la pantalla
  // "completado, pendiente de validación" tras una única navegación del cliente.
  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ id })
}
