import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_MANDATO_SEPA,
  firmarRuta,
  firmarRutasBucket,
} from '@/shared/lib/adjuntos/storage'

export interface TutorAltaItem {
  id: string
  tipo_vinculo: 'tutor_legal_principal' | 'tutor_legal_secundario'
  nombre_completo: string | null
  email: string | null
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
  /** URL firmada (~1 h) del PDF del DNI, o null si no hay documento. */
  dni_url: string | null
}

export interface MandatoAltaItem {
  estado: 'activo' | 'revocado'
  titular: string | null
  identificador_mandato: string
  fecha_firma: string | null
  /** URL firmada (~1 h) del PDF del mandato, o null si no hay documento. */
  pdf_url: string | null
  // ⚠️ Sin IBAN: nunca se selecciona `iban_cifrado` ni se descifra para la UI
  // (patrón de seguridad/RGPD; el IBAN vive solo cifrado, el PDF ya lo contiene).
}

export interface ConsentimientoAltaItem {
  version: string
  aceptado_en: string
}

export interface AltaDocumentacion {
  tutores: TutorAltaItem[]
  mandato: MandatoAltaItem | null
  consentimientoMedico: ConsentimientoAltaItem | null
  libroFamiliaUrl: string | null
}

/**
 * PR-4g — resumen del ALTA para el panel de Dirección: tutores (datos_tutor),
 * mandato SEPA (sin IBAN), consentimiento de datos médicos y documentos privados
 * (libro de familia, DNIs, PDF mandato) con URL firmada (~1 h).
 *
 * Todo se lee con el **cliente autenticado del admin**: la RLS de cada tabla y las
 * storage policies ya autorizan a `es_admin(centro)` (verificado; sin RLS nueva).
 * NO usa service role. NO expone el IBAN en ninguna forma.
 */
export async function getAltaDocumentacion(ninoId: string): Promise<AltaDocumentacion> {
  const supabase = await createClient()

  const [{ data: tutoresRows }, { data: mandatoRow }, { data: ninoRow }] = await Promise.all([
    supabase
      .from('datos_tutor')
      .select(
        'id, tipo_vinculo, usuario_id, nombre_completo, email, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'
      )
      .eq('nino_id', ninoId)
      .is('deleted_at', null)
      .order('tipo_vinculo', { ascending: true }),
    supabase
      .from('mandatos_sepa')
      .select('estado, titular, identificador_mandato, fecha_firma, documento_path')
      .eq('nino_id', ninoId)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .order('fecha_firma', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('ninos').select('libro_familia_path').eq('id', ninoId).maybeSingle(),
  ])

  // Consentimiento de datos médicos vigente de algún tutor (última fila sin revocar).
  const tutorUserIds = (tutoresRows ?? [])
    .map((t) => t.usuario_id)
    .filter((u): u is string => typeof u === 'string')
  let consentimientoMedico: ConsentimientoAltaItem | null = null
  if (tutorUserIds.length > 0) {
    const { data: consentRow } = await supabase
      .from('consentimientos')
      .select('version, aceptado_en')
      .in('usuario_id', tutorUserIds)
      .eq('tipo', 'datos_medicos')
      .is('revocado_en', null)
      .order('aceptado_en', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (consentRow) {
      consentimientoMedico = { version: consentRow.version, aceptado_en: consentRow.aceptado_en }
    }
  }

  // Firmado de documentos (cliente admin: la storage policy autoriza es_admin).
  const dniPaths = (tutoresRows ?? [])
    .map((t) => t.dni_documento_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  const [dniUrls, libroFamiliaUrl, mandatoPdfUrl] = await Promise.all([
    firmarRutasBucket(supabase, BUCKET_DNI_TUTORES, dniPaths),
    firmarRuta(supabase, BUCKET_LIBRO_FAMILIA, ninoRow?.libro_familia_path ?? null),
    firmarRuta(supabase, BUCKET_MANDATO_SEPA, mandatoRow?.documento_path ?? null),
  ])

  const tutores: TutorAltaItem[] = (tutoresRows ?? []).map((t) => ({
    id: t.id,
    tipo_vinculo: t.tipo_vinculo as TutorAltaItem['tipo_vinculo'],
    nombre_completo: t.nombre_completo,
    email: t.email,
    direccion_calle: t.direccion_calle,
    direccion_numero: t.direccion_numero,
    direccion_cp: t.direccion_cp,
    direccion_ciudad: t.direccion_ciudad,
    dni_url: t.dni_documento_path ? (dniUrls.get(t.dni_documento_path) ?? null) : null,
  }))

  const mandato: MandatoAltaItem | null = mandatoRow
    ? {
        estado: mandatoRow.estado as MandatoAltaItem['estado'],
        titular: mandatoRow.titular,
        identificador_mandato: mandatoRow.identificador_mandato,
        fecha_firma: mandatoRow.fecha_firma,
        pdf_url: mandatoPdfUrl,
      }
    : null

  return { tutores, mandato, consentimientoMedico, libroFamiliaUrl }
}
