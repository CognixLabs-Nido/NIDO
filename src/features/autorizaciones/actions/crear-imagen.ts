'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import { fail, ok, type ActionResult } from '../types'

const crearImagenSchema = z.object({ nino_id: z.string().uuid() })

/**
 * Resultado de instanciar (lazy) la autorización de imagen para el paso de
 * consentimiento del wizard del tutor (Pieza 3b-1):
 *  - `lista`: hay instancia (creada o reusada) → la UI renderiza el panel de firma.
 *  - `sin_plantilla`: el centro no tiene plantilla de imagen publicada → el wizard
 *    OMITE el paso con aviso (no bloquea; D3 / Comportamiento 1 edge).
 */
export type ResultadoImagen =
  | { estado: 'lista'; autorizacionId: string }
  | { estado: 'sin_plantilla' }

/**
 * **Imagen B2 (la familia instancia, NO firma aquí).** Crea —o reusa— la instancia
 * de `autorizacion_imagenes` (ámbito niño, 1 por niño) a partir de la plantilla
 * publicada del centro, y devuelve su id para que `FirmarAutorizacionPanel` la firme.
 * Al firmar, el trigger `firma_imagen_sync_trg` sincroniza `consentimientos('imagen')`
 * + `ninos.puede_aparecer_en_fotos`.
 *
 * `firmantes_requeridos` de la instancia se **deriva** de `ninos.requiere_ambos_firmantes`
 * (`true → 'todos_los_principales'`, `false → 'uno_principal'`): `imagen_consentida` lee
 * ese campo como política efectiva cuando el flag es `false`, así que el panel pide el
 * nº correcto de firmas. La RLS `autorizaciones_insert` (rama tutor imagen, 3b-1) acota
 * el INSERT a su hijo + plantilla publicada del centro.
 */
export async function crearImagenAutorizacion(
  input: z.infer<typeof crearImagenSchema>
): Promise<ActionResult<ResultadoImagen>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearImagenSchema.safeParse(input)
  if (!parsed.success) return fail('autorizaciones.errors.creacion_fallo')
  const ninoId = parsed.data.nino_id

  // Tutela (clave de error clara; la RLS también lo enforza en el INSERT).
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vinculo) return fail('autorizaciones.errors.no_es_tutor')

  // Centro del niño + requisito de doble firma (deriva firmantes_requeridos).
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id, requiere_ambos_firmantes')
    .eq('id', ninoId)
    .maybeSingle()
  if (!nino) return fail('autorizaciones.errors.nino_no_encontrado')

  // ¿Ya hay instancia de imagen para este niño? (find-or-create, 1 por niño).
  const { data: existente } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('tipo', 'autorizacion_imagenes')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .limit(1)
    .maybeSingle()
  if (existente) return ok({ estado: 'lista', autorizacionId: existente.id })

  // Plantilla de imagen publicada del centro. Sin ella → el paso se omite.
  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id, titulo, texto, texto_version')
    .eq('centro_id', nino.centro_id)
    .eq('tipo', 'autorizacion_imagenes')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .maybeSingle()
  if (!plantilla) return ok({ estado: 'sin_plantilla' })

  const firmantesRequeridos = nino.requiere_ambos_firmantes
    ? 'todos_los_principales'
    : 'uno_principal'

  const { data: creada, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: nino.centro_id,
      tipo: 'autorizacion_imagenes',
      es_plantilla: false,
      plantilla_id: plantilla.id,
      ambito: 'nino',
      nino_id: ninoId,
      titulo: plantilla.titulo,
      texto: plantilla.texto,
      texto_version: plantilla.texto_version,
      texto_definitivo: true,
      estado: 'publicada',
      firmantes_requeridos: firmantesRequeridos,
      vigencia_desde: hoyMadridYmd(),
      vigencia_hasta: null,
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !creada) {
    logger.warn('crearImagenAutorizacion: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.creacion_fallo')
  }

  revalidarAutorizaciones()
  return ok({ estado: 'lista', autorizacionId: creada.id })
}
