import 'server-only'

import type { Database } from '@/types/db'

import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'
import { createClient } from '@/lib/supabase/server'
import { leerFichaGestionDe } from '@/features/ninos/lib/ficha-gestion'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  firmarRuta,
  firmarRutasBucket,
} from '@/shared/lib/adjuntos/storage'

/** El estado del mandato, del enum de la base (2026-11-20: ganó 'propuesto' y 'rechazado'). */
type EstadoMandato = Database['public']['Enums']['estado_mandato_sepa']
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
  estado: EstadoMandato
  titular: string | null
  identificador_mandato: string
  fecha_firma: string | null
  /** URL firmada (~1 h) del PDF del mandato, o null si no hay documento. */
  /** El mandato con PDF: se abre por `/{locale}/mandato-sepa/{id}` (sin enlace, 2026-11-22). */
  mandato_id: string | null
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
  /** `false` si lo guardado del niño no se pudo leer: no se sabe si hay libro (no es «no hay»). */
  libroLeido: boolean
}

/**
 * PR-4g — resumen del ALTA para el panel de Dirección: tutores (familia_tutores, F-2b-3),
 * mandato SEPA (sin IBAN), consentimiento de datos médicos y documentos privados
 * (libro de familia, DNIs, PDF mandato) con URL firmada (~1 h).
 *
 * Todo se lee con el **cliente autenticado del admin**: la RLS de cada tabla y las
 * storage policies ya autorizan a `es_admin(centro)` (verificado; sin RLS nueva).
 * NO usa service role. NO expone el IBAN en ninguna forma.
 */
export async function getAltaDocumentacion(ninoId: string): Promise<AltaDocumentacion> {
  const supabase = await createClient()

  // Tutores desde el perfil COMPARTIDO `familia_tutores` (F-2b-3), resuelto por familia del
  // niño; el helper mapea rol_familia→tipo_vinculo y ordena titular primero.
  // F-2c-1: el mandato es de la FAMILIA → se resuelve por `ninos.familia_id`, no por
  // `nino_id`. Se lee primero la familia del niño y luego su mandato activo.
  const [lecturaTutores, { data: ninoBase }, gestion] = await Promise.all([
    leerTutoresDeNino(supabase, ninoId),
    supabase.from('ninos').select('familia_id').eq('id', ninoId).maybeSingle(),
    // El libro de familia es de gestión (`20270115120000`): de la función. `null` = la lectura
    // falló, y entonces no se sabe si hay libro: la ficha lo dice en vez de pintar «—».
    leerFichaGestionDe(supabase, ninoId),
  ])
  // Censo C (clase 1): sin los tutores, el panel decía «Sin datos de tutores» y el consentimiento médico (que
  // se busca por sus cuentas) salía como «sin»: no se pudo leer, y se dice (error.tsx de la sección).
  if (!lecturaTutores.leidos) throw new LecturaFallida('getAltaDocumentacion', lecturaTutores.error)
  const tutoresRows = lecturaTutores.tutores
  const libroLeido = gestion !== null
  const ninoRow = ninoBase
    ? { familia_id: ninoBase.familia_id, libro_familia_path: gestion?.libro_familia_path ?? null }
    : null

  let mandatoRow: {
    estado: EstadoMandato
    titular: string
    identificador_mandato: string
    fecha_firma: string | null
    documento_path: string | null
    id: string
  } | null = null
  if (ninoRow?.familia_id) {
    const { data } = await supabase
      .from('mandatos_sepa')
      .select('id, estado, titular, identificador_mandato, fecha_firma, documento_path')
      .eq('familia_id', ninoRow.familia_id)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .order('fecha_firma', { ascending: false })
      .limit(1)
      .maybeSingle()
    mandatoRow = data
  }

  // Consentimiento de datos médicos vigente de algún tutor (última fila sin revocar).
  // U-3: acotado a ESTE niño (`nino_id`), espejo exacto del gate de `finalizarAlta`. Antes
  // bastaba el acuse de un hermano y el panel de Dirección mostraba "hecho" un bloque que el
  // gate —ya endurecido— considera pendiente.
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
      .eq('nino_id', ninoId)
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
  const [dniUrls, libroFamiliaUrl] = await Promise.all([
    firmarRutasBucket(supabase, BUCKET_DNI_TUTORES, dniPaths),
    firmarRuta(supabase, BUCKET_LIBRO_FAMILIA, ninoRow?.libro_familia_path ?? null),
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
        mandato_id: mandatoRow.documento_path ? mandatoRow.id : null,
      }
    : null

  return { tutores, mandato, consentimientoMedico, libroFamiliaUrl, libroLeido }
}
