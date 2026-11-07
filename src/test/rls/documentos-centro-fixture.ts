import { execFileSync } from 'node:child_process'

import type { SupabaseClient } from '@supabase/supabase-js'

import { subirVersionDocumento } from '@/features/documentos-centro/lib/versiones'
import type { Database } from '@/types/database'

import { serviceClient } from './setup'

/**
 * Documentos del centro de verdad para los tests de la BD efímera (fase 4): se crean y se suben con
 * las funciones de la app (`crear_documento_centro`, `subirVersionDocumento`), con la sesión de la
 * admin del centro, y se borran con el marcador de `borrar_version_documento` (J5). Lo usan los tests
 * del 4b-2; el del 4b-1 (`firmar-documentos-nino.rls.test.ts`) tiene su copia, de antes.
 */

type Cliente = SupabaseClient<Database>

const BUCKET = 'documentos-centro'

export function comoPostgres(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO: ${texto}\n%%EOF\n`)
}

/** Crea un documento del centro con la sesión de su admin. Devuelve su id. */
export async function creaDocumento(
  admin: Cliente,
  centroId: string,
  titulo: string,
  { deCurso = false, obligatorio = true, orden = 1 } = {}
): Promise<string> {
  const { data, error } = await admin.rpc('crear_documento_centro', {
    p_centro_id: centroId,
    p_titulo: titulo,
    p_de_curso: deCurso,
    p_obligatorio: obligatorio,
    p_orden: orden,
  })
  if (error || !data) throw new Error(`crear documento: ${error?.message}`)
  return data
}

/** Sube una versión (un PDF con ese texto) con la sesión de la admin; si se pide, pidiendo volver a firmar (4d). Devuelve su id. */
export async function subeVersion(
  admin: Cliente,
  centroId: string,
  documentoId: string,
  cursoId: string | null,
  texto: string,
  pideRefirma = false
): Promise<string> {
  const r = await subirVersionDocumento(admin, serviceClient, {
    centroId,
    documentoId,
    cursoId,
    bytes: pdf(texto),
    pideRefirma,
  })
  if (!r.ok) throw new Error(`subir: ${r.error}`)
  return r.data.versionId
}

/** Todo lo del centro en los documentos: firmas, versiones (por el marcador), documentos y ficheros. */
export async function borrarDocumentosDe(centroId: string): Promise<void> {
  comoPostgres(`DO $$ DECLARE r record; BEGIN
    DELETE FROM public.firmas_documentos_centro WHERE centro_id = '${centroId}';
    FOR r IN SELECT id FROM public.documentos_centro_versiones WHERE centro_id = '${centroId}' LOOP
      PERFORM set_config('app.borrar_version_documento', r.id::text, true);
      DELETE FROM public.documentos_centro_versiones WHERE id = r.id;
    END LOOP;
    DELETE FROM public.documentos_centro WHERE centro_id = '${centroId}';
  END $$;`)
  const { data: carpetas } = await serviceClient.storage.from(BUCKET).list(centroId)
  for (const d of carpetas ?? []) {
    const { data } = await serviceClient.storage.from(BUCKET).list(`${centroId}/${d.name}`)
    const rutas = (data ?? []).map((f) => `${centroId}/${d.name}/${f.name}`)
    if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
  }
}
