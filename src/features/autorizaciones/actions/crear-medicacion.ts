'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { hashFirma } from '../lib/hash'
import { getRequestContext } from '../lib/request-context'
import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import { crearMedicacionSchema, type CrearMedicacionInput } from '../schemas/autorizaciones'
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
 * **Medicación B2 (la familia inicia).** El tutor crea una instancia de medicación
 * para SU hijo a partir de la **plantilla de medicación publicada** del centro,
 * con los **campos estructurados** (medicamento/dosis/vía/pauta/fechas) y la firma
 * en un paso. A diferencia de recogida, **siempre crea una instancia nueva**:
 * un niño puede tener varias medicaciones activas a la vez (distintos
 * tratamientos), cada una con su vigencia (`fecha_inicio → vigencia_desde`,
 * `fecha_fin → vigencia_hasta`).
 *
 * La política de firmantes respeta `ninos.requiere_ambos_firmantes`: con doble
 * firma, el roster queda **parcial** hasta que el 2.º tutor firme (en el detalle,
 * sobre la misma instancia). Hoy debe caer dentro de [fecha_inicio, fecha_fin]
 * para que la firma sea válida (la RLS `autorizacion_firmable` lo exige).
 *
 * Los campos viajan en `firmas.datos.medicacion` y se atan al **hash compuesto**.
 * El informe/receta (adjunto) se aplaza a F10 (`datos.adjuntos` reservado).
 */
export async function crearMedicacion(
  input: CrearMedicacionInput
): Promise<ActionResult<{ autorizacion_id: string; firma_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearMedicacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const d = parsed.data
  const med = {
    medicamento: d.medicacion.medicamento.trim(),
    dosis: d.medicacion.dosis.trim(),
    ...(d.medicacion.via?.trim() ? { via: d.medicacion.via.trim() } : {}),
    pauta: d.medicacion.pauta.trim(),
    fecha_inicio: d.medicacion.fecha_inicio,
    fecha_fin: d.medicacion.fecha_fin,
  }

  // La autorización solo es firmable si hoy ∈ [fecha_inicio, fecha_fin]
  // (la RLS lo enforza; pre-chequeo para un error claro).
  const hoy = hoyMadridYmd()
  if (med.fecha_inicio > hoy || med.fecha_fin < hoy) {
    return fail('autorizaciones.errors.med_fuera_de_vigencia')
  }

  // Acto afirmativo: el nombre tecleado debe coincidir con el del perfil.
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil || normalizarNombre(perfil.nombre_completo) !== normalizarNombre(d.nombre_tecleado)) {
    return fail('autorizaciones.errors.nombre_no_coincide')
  }

  // rol_firmante = snapshot del vínculo del tutor con el niño (valida tutela).
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('tipo_vinculo')
    .eq('nino_id', d.nino_id)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vinculo) return fail('autorizaciones.errors.no_es_tutor')

  // centro + política de doble firma desde el niño.
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id, requiere_ambos_firmantes')
    .eq('id', d.nino_id)
    .maybeSingle()
  if (!nino) return fail('autorizaciones.errors.nino_no_encontrado')

  // Plantilla de medicación publicada del centro (el formato estándar).
  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id, texto, texto_version')
    .eq('centro_id', nino.centro_id)
    .eq('tipo', 'medicacion')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .maybeSingle()
  if (!plantilla) return fail('autorizaciones.errors.medicacion_sin_plantilla')

  // Instancia NUEVA (multi-instancia): vigencia = [fecha_inicio, fecha_fin],
  // título = medicamento (para la lista). Tutor-insert acotado por RLS (F8-RW-0).
  const { data: instancia, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: nino.centro_id,
      tipo: 'medicacion',
      es_plantilla: false,
      plantilla_id: plantilla.id,
      ambito: 'nino',
      nino_id: d.nino_id,
      titulo: med.medicamento.slice(0, 200),
      texto: plantilla.texto,
      texto_version: plantilla.texto_version,
      texto_definitivo: true,
      estado: 'publicada',
      firmantes_requeridos: nino.requiere_ambos_firmantes
        ? 'todos_los_principales'
        : 'uno_principal',
      vigencia_desde: med.fecha_inicio,
      vigencia_hasta: med.fecha_fin,
      creado_por: user.id,
    })
    .select('id, texto, texto_version')
    .maybeSingle()
  if (insErr || !instancia) {
    logger.warn('crearMedicacion: insert instancia', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.creacion_fallo')
  }

  // Firma append-only con los campos (hash compuesto texto + medicacion) + contexto.
  const texto_hash = hashFirma(instancia.texto, { medicacion: med })
  const datos = {
    medicacion: med,
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
    logger.warn('crearMedicacion: insert firma', firmaErr?.message)
    if (firmaErr?.code === '42501') return fail('autorizaciones.errors.no_firmable')
    return fail('autorizaciones.errors.firma_fallo')
  }

  revalidarAutorizaciones()
  return ok({ autorizacion_id: instancia.id, firma_id: firma.id })
}
