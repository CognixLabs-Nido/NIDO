import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { parseEstructura, parseRespuestas } from '../lib/estructura'
import type { InformePdfData } from '../lib/informe-pdf'
import type { PeriodoInforme } from '../types'

/**
 * Datos del informe necesarios para el PDF, leídos **con el cliente del usuario**
 * (la RLS de F9-0 decide el acceso). Es la frontera de autorización: un tutor solo
 * obtiene aquí el informe de su propio hijo, y **solo si está publicado**. Devuelve
 * null si no es accesible o no está publicado → el route handler responde 404.
 *
 * No importa `@/lib/supabase/server` (next/headers) a propósito: recibe el cliente
 * por parámetro para ser ejercitable en los tests de control de acceso con
 * `clientFor(user)`.
 */
export interface InformeRowParaPdf {
  id: string
  centro_id: string
  nino_id: string
  curso_academico_id: string
  creado_por: string
  periodo: PeriodoInforme
  estado: 'borrador' | 'publicado'
  estructura_snapshot: unknown
  respuestas: unknown
  observaciones_generales: string | null
  publicado_at: string | null
  ninos: { nombre: string; apellidos: string } | { nombre: string; apellidos: string }[] | null
}

function unwrap<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function loadInformeParaPdf(
  client: SupabaseClient<Database>,
  id: string
): Promise<InformeRowParaPdf | null> {
  const { data, error } = await client
    .from('informes_evolucion')
    .select(
      'id, centro_id, nino_id, curso_academico_id, creado_por, periodo, estado, estructura_snapshot, respuestas, observaciones_generales, publicado_at, ninos(nombre, apellidos)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as InformeRowParaPdf
  // La familia nunca descarga un borrador (la RLS ya lo impide para ella; este guard
  // cubre además a un staff que llegara por la ruta a un borrador).
  if (row.estado !== 'publicado') return null
  return row
}

/**
 * Completa el view model del PDF con los metadatos (nombre del centro, del curso y
 * del **autor**) usando el **service client**, ya que `usuarios` solo es legible por
 * uno mismo/admin (la familia no podría leer el nombre del profe por RLS). Se invoca
 * **solo tras autorizar** con `loadInformeParaPdf`; es el mismo patrón de service
 * role tras verificación que el motor de push (ADR-0027). Lee `nino` del propio row.
 */
export async function assembleInformePdfData(
  serviceClient: SupabaseClient<Database>,
  row: InformeRowParaPdf
): Promise<InformePdfData> {
  const [centroRes, cursoRes, autorRes] = await Promise.all([
    serviceClient.from('centros').select('nombre').eq('id', row.centro_id).maybeSingle(),
    serviceClient
      .from('cursos_academicos')
      .select('nombre')
      .eq('id', row.curso_academico_id)
      .maybeSingle(),
    serviceClient.from('usuarios').select('nombre_completo').eq('id', row.creado_por).maybeSingle(),
  ])

  const nino = unwrap(row.ninos)

  return {
    centroNombre: centroRes.data?.nombre ?? '',
    ninoNombre: nino ? `${nino.nombre} ${nino.apellidos}` : '',
    periodo: row.periodo,
    cursoNombre: cursoRes.data?.nombre ?? null,
    publicadoEn: row.publicado_at,
    autorNombre: autorRes.data?.nombre_completo ?? null,
    estructura: parseEstructura(row.estructura_snapshot as never),
    respuestas: parseRespuestas(row.respuestas as never),
    observaciones: row.observaciones_generales,
  }
}
