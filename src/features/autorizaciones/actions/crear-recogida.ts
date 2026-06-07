'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { hashFirma } from '../lib/hash'
import { getRequestContext } from '../lib/request-context'
import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import { crearRecogidaSchema, type CrearRecogidaInput } from '../schemas/autorizaciones'
import { fail, ok, type ActionResult } from '../types'

/** Compara nombres de forma laxa: minúsculas, sin acentos, espacios colapsados. */
function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * **Recogida B2 (la familia inicia).** El tutor crea una instancia de recogida
 * para SU hijo a partir de la **plantilla de recogida publicada** del centro, y
 * la **firma** con la lista de personas autorizadas — todo en un paso. La RLS
 * `autorizaciones_insert` (rama tutor de F8-RW-0) acota el INSERT a su propio hijo
 * + una plantilla publicada del centro; `firmas_insert` exige que sea tutor.
 *
 * `modalidad`:
 *  - **habitual**: vigencia abierta (`vigencia_hasta = NULL`) — la lista de
 *    siempre. Una por niño: si ya existe, se **reusa** (el 2.º tutor la firma con
 *    prefill — afinado multi-tutor #3).
 *  - **puntual**: válida **solo hoy** (`vigencia_desde = vigencia_hasta = hoy`) —
 *    la persona excepcional del día. Coexiste con la habitual.
 *
 * La lista viaja en `firmas_autorizacion.datos` y se ata al **hash compuesto**
 * (texto + lista). ⚖️ Contiene DNIs de terceros (RAT F11).
 */
export async function crearRecogida(
  input: CrearRecogidaInput
): Promise<ActionResult<{ autorizacion_id: string; firma_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearRecogidaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const d = parsed.data

  // Acto afirmativo: el nombre tecleado debe coincidir con el del perfil.
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil || normalizarNombre(perfil.nombre_completo) !== normalizarNombre(d.nombre_tecleado)) {
    return fail('autorizaciones.errors.nombre_no_coincide')
  }

  // rol_firmante = snapshot del vínculo del tutor con el niño (también valida tutela).
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('tipo_vinculo')
    .eq('nino_id', d.nino_id)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vinculo) return fail('autorizaciones.errors.no_es_tutor')

  // centro del niño (RLS deja al tutor leer su ficha).
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', d.nino_id)
    .maybeSingle()
  if (!nino) return fail('autorizaciones.errors.nino_no_encontrado')

  // Plantilla de recogida publicada del centro (el formato estándar).
  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id, titulo, texto, texto_version')
    .eq('centro_id', nino.centro_id)
    .eq('tipo', 'recogida')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .maybeSingle()
  if (!plantilla) return fail('autorizaciones.errors.recogida_sin_plantilla')

  const hoy = hoyMadridYmd()
  const vigenciaHasta = d.modalidad === 'puntual' ? hoy : null

  // Find-or-create: una habitual por niño (vigencia_hasta IS NULL) / una puntual
  // por día (vigencia_hasta = hoy). El 2.º tutor reusa la instancia y la firma
  // con prefill (multi-tutor).
  const buscar = supabase
    .from('autorizaciones')
    .select('id, texto, texto_version')
    .eq('nino_id', d.nino_id)
    .eq('tipo', 'recogida')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
  const { data: existentes } = await (
    vigenciaHasta === null
      ? buscar.is('vigencia_hasta', null)
      : buscar.eq('vigencia_hasta', vigenciaHasta)
  ).limit(1)
  let instancia = existentes?.[0]

  if (!instancia) {
    const { data: creada, error: insErr } = await supabase
      .from('autorizaciones')
      .insert({
        centro_id: nino.centro_id,
        tipo: 'recogida',
        es_plantilla: false,
        plantilla_id: plantilla.id,
        ambito: 'nino',
        nino_id: d.nino_id,
        titulo: plantilla.titulo,
        texto: plantilla.texto,
        texto_version: plantilla.texto_version,
        texto_definitivo: true,
        estado: 'publicada',
        firmantes_requeridos: 'uno_principal',
        vigencia_desde: hoy,
        vigencia_hasta: vigenciaHasta,
        creado_por: user.id,
      })
      .select('id, texto, texto_version')
      .maybeSingle()
    if (insErr || !creada) {
      logger.warn('crearRecogida: insert instancia', insErr?.message)
      if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
      return fail('autorizaciones.errors.creacion_fallo')
    }
    instancia = creada
  }

  // Firma append-only con la lista (hash compuesto texto + personas) + contexto.
  const personas = d.personas.map((p) => ({
    nombre: p.nombre.trim(),
    dni: p.dni.trim(),
    ...(p.parentesco?.trim() ? { parentesco: p.parentesco.trim() } : {}),
  }))
  const texto_hash = hashFirma(instancia.texto, { personas })
  const datos = {
    personas,
  } as Database['public']['Tables']['firmas_autorizacion']['Insert']['datos']
  const { ip, userAgent } = await getRequestContext()

  const { data: firma, error: firmaErr } = await supabase
    .from('firmas_autorizacion')
    .insert({
      autorizacion_id: instancia.id,
      nino_id: d.nino_id,
      firmante_id: user.id,
      rol_firmante: vinculo.tipo_vinculo,
      decision: 'firmado',
      texto_hash,
      texto_version: instancia.texto_version,
      nombre_tecleado: d.nombre_tecleado.trim(),
      firma_imagen: d.firma_imagen,
      comentario: d.comentario ?? null,
      datos,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select('id')
    .maybeSingle()

  if (firmaErr || !firma) {
    logger.warn('crearRecogida: insert firma', firmaErr?.message)
    if (firmaErr?.code === '42501') return fail('autorizaciones.errors.no_firmable')
    return fail('autorizaciones.errors.firma_fallo')
  }

  revalidarAutorizaciones()
  return ok({ autorizacion_id: instancia.id, firma_id: firma.id })
}
