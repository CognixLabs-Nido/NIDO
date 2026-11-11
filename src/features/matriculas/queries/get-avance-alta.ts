import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerFichaGestion } from '@/features/ninos/lib/ficha-gestion'
import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import { avanceAlta, type LineaAvance, type SenalesAvance } from '../lib/avance-alta'

type Client = SupabaseClient<Database>

/**
 * Lo que lleva hecho cada alta (`avance-alta.ts`), leído con la **sesión de Dirección**. Cada fuente
 * la abre a Dirección del centro su RLS: `ninos`, `familia_tutores` y `mandatos_sepa` por `es_admin`
 * del centro; `consentimientos` si el tutor tiene rol en el centro (el que firma en el alta lo tiene
 * desde que acepta); la imagen por `existe_consentimiento_imagen` y los documentos del centro por
 * `documentos_firma_nino` (`es_admin` del centro del niño), las mismas señales que el gate de
 * `finalizarAlta`.
 *
 * NULL si alguna lectura falla: quien lo pinta dice que no se pudo leer, nunca «falta» por un error
 * (un «falta» falso manda a la directora a llamar por algo que la familia ya hizo).
 *
 * El médico es el acuse de **cualquier** tutor del niño; el gate pide el del tutor que finaliza.
 * Para enseñar si está hecho basta uno, y el gate sigue siendo quien decide al finalizar.
 */
export async function getAvanceAltas(
  supabase: Client,
  centroId: string,
  ninoIds: string[]
): Promise<Map<string, LineaAvance[]> | null> {
  const resultado = new Map<string, LineaAvance[]>()
  if (ninoIds.length === 0) return resultado

  const falla = (fuente: string, mensaje: string | undefined) => {
    logger.warn('avance del alta', fuente, mensaje ?? 'sin respuesta')
    return null
  }

  const [ninosR, gestion, medicoR, centroR] = await Promise.all([
    supabase.from('ninos').select('id, familia_id').eq('centro_id', centroId).in('id', ninoIds),
    // El libro de familia es de gestión (`20270115120000`): de la función, que a la Dirección le
    // contesta todos los de su centro.
    leerFichaGestion(supabase, ninoIds),
    supabase
      .from('consentimientos')
      .select('nino_id')
      .eq('tipo', 'datos_medicos')
      .is('revocado_en', null)
      .in('nino_id', ninoIds),
    supabase.from('centros').select('identificador_acreedor').eq('id', centroId).maybeSingle(),
  ])
  if (ninosR.error || !ninosR.data) return falla('ninos', ninosR.error?.message)
  if (!gestion) return falla('ninos', 'ficha_gestion_ninos no se lee')
  if (medicoR.error) return falla('consentimientos', medicoR.error.message)
  if (centroR.error || !centroR.data) return falla('centros', centroR.error?.message)

  const familias = [...new Set(ninosR.data.map((n) => n.familia_id))]
  const [tutoresR, mandatosR, imagenes, documentos] = await Promise.all([
    supabase
      .from('familia_tutores')
      .select('familia_id, rol_familia, nombre_completo, dni_documento_path')
      .in('familia_id', familias)
      .is('deleted_at', null),
    supabase
      .from('mandatos_sepa')
      .select('familia_id')
      .eq('centro_id', centroId)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .in('familia_id', familias),
    Promise.all(
      ninoIds.map((id) => supabase.rpc('existe_consentimiento_imagen', { p_nino_id: id }))
    ),
    Promise.all(ninoIds.map((id) => supabase.rpc('documentos_firma_nino', { p_nino_id: id }))),
  ])
  if (tutoresR.error || !tutoresR.data) return falla('familia_tutores', tutoresR.error?.message)
  if (mandatosR.error || !mandatosR.data) return falla('mandatos_sepa', mandatosR.error?.message)
  const imagenFallo = imagenes.find((r) => r.error)
  if (imagenFallo) return falla('existe_consentimiento_imagen', imagenFallo.error?.message)
  const documentosFallo = documentos.find((r) => r.error || !r.data)
  if (documentosFallo) return falla('documentos_firma_nino', documentosFallo.error?.message)

  const medico = new Set((medicoR.data ?? []).map((c) => c.nino_id))
  const conMandato = new Set(mandatosR.data.map((m) => m.familia_id))
  const centroConCid = Boolean(centroR.data.identificador_acreedor?.trim())

  for (const [i, ninoId] of ninoIds.entries()) {
    const nino = ninosR.data.find((n) => n.id === ninoId)
    if (!nino) return falla('ninos', 'un niño de la lista no se lee')
    const deFamilia = tutoresR.data.filter((t) => t.familia_id === nino.familia_id)
    const titular = deFamilia.find((t) => t.rol_familia === 'titular')
    const segundo = deFamilia.find((t) => t.rol_familia !== 'titular')
    const senales: SenalesAvance = {
      documentosCentro: documentos[i]?.data ?? [],
      libroFamilia: Boolean(gestion.get(nino.id)?.libro_familia_path),
      imagen: imagenes[i]?.data === true,
      dniTutor1: Boolean(titular?.dni_documento_path),
      tutor2: Boolean(segundo?.nombre_completo?.trim()),
      medico: medico.has(ninoId),
      mandato: conMandato.has(nino.familia_id),
      centroConCid,
    }
    resultado.set(ninoId, avanceAlta(senales))
  }
  return resultado
}
