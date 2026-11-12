'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { leerFichaGestionDe } from '@/features/ninos/lib/ficha-gestion'
import { logger } from '@/shared/lib/logger'

import { leerDocumentosNino } from '@/features/documentos-centro/lib/firmar-documentos'
import { frenaElAlta } from '../lib/regla-documentos-alta'
import { leerTutoresDeNino } from '../lib/tutores-familia'

import { fail, ok } from '../../centros/types'

/**
 * Bloques OBLIGATORIOS del alta que el gate de completitud exige antes de finalizar. El
 * orden de la lista es el orden en que se muestra el checklist "qué falta" en la UI.
 *
 * NOTA — `tutor2` es OPCIONAL (no aparece aquí): no bloquea.
 * El mandato SEPA tampoco (D10 de `docs/specs/altas-serie.md`): la familia que lo omite cierra
 *   el alta y paga en efectivo, que es el método por defecto de `familias.metodo_pago`.
 * `imagen` es OBLIGATORIO y lo cumple el consentimiento de imagen del niño (lo dan la casilla y
 *   la firma, IU-2).
 * `documentos_centro` (fase 4, 4b-2): ningún documento del centro OBLIGATORIO por firmar
 *   (`regla-documentos-alta.ts`). Las normas son uno de ellos: desde el 2026-11-06 ya no se
 *   cumplen con la autorización de normas ni con la casilla de `acuses_alta`. Uno que el centro
 *   todavía no ha subido no frena (P-6), así que hasta que suba las normas el alta se cierra sin
 *   ellas: el único momento de la historia del producto en que pasa.
 */
export type BloqueAlta =
  | 'identidad'
  | 'tutor1'
  | 'medico'
  | 'documentos'
  | 'imagen'
  | 'documentos_centro'

const ORDEN_BLOQUES: BloqueAlta[] = [
  'identidad',
  'tutor1',
  'medico',
  'documentos',
  'imagen',
  'documentos_centro',
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
 * muestre un checklist claro. La identidad y el acuse médico ya se validaban; se suman
 * tutor 1, documentos, imagen y los documentos del centro (fase 4, 4b-2). La RPC sigue siendo el
 * backstop (llamadas directas): exige el acuse médico y los documentos del centro, con la misma
 * regla.
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

  // Identidad del menor de la tabla; los hermanos y el libro de familia son de gestión y salen por
  // `ficha_gestion_ninos` (`20270115120000`), que al tutor legal y a la Dirección les contesta.
  const [{ data: identidad }, gestion] = await Promise.all([
    supabase
      .from('ninos')
      .select('apellidos, fecha_nacimiento, lugar_nacimiento, nacionalidad, familia_id, centro_id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    leerFichaGestionDe(supabase, id),
  ])
  if (!identidad || !gestion) return fail('alta.errors.finalizar_fallo')
  const nino = {
    ...identidad,
    hermanos_total: gestion.hermanos_total,
    libro_familia_path: gestion.libro_familia_path,
  }
  // Fase 5b: además de apellidos y fecha, los tres obligatorios (lugar de nacimiento, nacionalidad y
  // hermanos), con la misma regla que la base (`marcar_matricula_lista`, `datos_nino_por_completar`).
  if (
    !nino.apellidos ||
    !nino.fecha_nacimiento ||
    !nino.lugar_nacimiento?.trim() ||
    !nino.nacionalidad?.trim() ||
    nino.hermanos_total == null
  )
    faltan.push('identidad')

  // Tutor 1 (identidad) + su DNI (documento) desde el perfil COMPARTIDO `familia_tutores`
  // (F-2b-3): el titular. La señal de "tutor 1 hecho" es tener `nombre_completo`.
  const { tutores, leidos } = await leerTutoresDeNino(supabase, id)
  // Un fallo no es «falta el tutor 1»: no se cierra, y no se le pide a la familia lo que ya hizo.
  if (!leidos) return fail('alta.errors.finalizar_fallo')
  const tutor1 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_principal')
  if (!tutor1?.nombre_completo) faltan.push('tutor1')

  // Médico + emergencia: solo se exige el acuse de confidencialidad `datos_medicos` vigente
  // (consentimiento RGPD, con backstop en `marcar_matricula_lista`). El teléfono de emergencia
  // y el resto de campos médicos pueden ir en blanco → NO bloquean la finalización (opción A).
  //
  // U-3: el acuse es POR NIÑO (`nino_id`), no por tutor. Antes se filtraba SOLO por
  // `usuario_id` y el acuse del 1.er hijo satisfacía el bloque del 2.º → el hijo nuevo cerraba
  // el alta sin acuse propio. Filtro limpio (sin `OR nino_id IS NULL`): las filas antiguas
  // con NULL ya no cuentan para ningún niño.
  const { data: acuse } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('tipo', 'datos_medicos')
    .eq('nino_id', id)
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  if (!acuse) faltan.push('medico')

  // Documentos: libro de familia (niño) + DNI del tutor 1. El DNI del tutor 2 NO se exige
  // (tutor 2 es opcional).
  if (!nino.libro_familia_path || !tutor1?.dni_documento_path) faltan.push('documentos')

  // Autorización de IMAGEN (acuse obligatorio). Fuente de verdad = el CONSENTIMIENTO de
  // imagen del niño (IU-2): lo otorgan tanto el checkbox como la firma (vía A). La señal es
  // "existe consent vigente" (ANY) — equivalente EXACTO a la vieja "firma firmada O acuse"
  // (una aceptación basta); no se endurece con requiere_ambos. NO relaja la obligatoriedad,
  // solo cambia la señal (acuse → consent).
  const { data: imagenConsentida } = await supabase.rpc('existe_consentimiento_imagen', {
    p_nino_id: id,
  })
  if (!imagenConsentida) faltan.push('imagen')

  // Los documentos del centro (fase 4, 4b-2): ninguno obligatorio por firmar. La lista es la de la
  // pantalla (`documentos_firma_nino`, con la sesión) y la regla, la de la base. Si la lectura falla
  // no se cierra: una lista vacía diría «no hay nada que firmar».
  const documentosCentro = await leerDocumentosNino(supabase, id)
  if (!documentosCentro.ok) return fail('alta.errors.finalizar_fallo')
  if (documentosCentro.data.some(frenaElAlta)) faltan.push('documentos_centro')

  if (faltan.length > 0) {
    faltan.sort((a, b) => ORDEN_BLOQUES.indexOf(a) - ORDEN_BLOQUES.indexOf(b))
    return { success: false, error: 'alta.errors.incompleto', faltan }
  }

  // Gate OK → finalizar. `null` (no había 'pendiente') = idempotente: ya estaba. Desde la 5b es
  // lo único que da `null`: la falta de datos del niño ya no es silenciosa (`datos_nino_por_completar`).
  // 'lista'/'activa' → éxito.
  const { error } = await supabase.rpc('marcar_matricula_lista', { p_nino_id: id })
  if (error) {
    // La base frena con la misma regla (`documentos_por_firmar`): un documento subido entre el gate
    // y aquí, o una versión nueva. Se dice lo que falta, no «no se pudo».
    // Lo mismo con los datos del niño (5b): alguien los vació entre el gate y la llamada.
    if (error.hint === 'datos_nino_por_completar') {
      return { success: false, error: 'alta.errors.incompleto', faltan: ['identidad'] }
    }
    if (error.hint === 'documentos_por_firmar') {
      return { success: false, error: 'alta.errors.incompleto', faltan: ['documentos_centro'] }
    }
    logger.warn('finalizarAlta', error.message)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.errors.finalizar_fallo')
  }

  // Revalida la ruta del alta (todas las locales) para que el RSC sirva la pantalla
  // "completado, pendiente de validación" tras una única navegación del cliente.
  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ id })
}
