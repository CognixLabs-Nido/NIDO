'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { errorDeLaBase } from '../lib/versiones'
import {
  crearDocumentoSchema,
  editarDocumentoSchema,
  type CrearDocumentoInput,
  type EditarDocumentoInput,
} from '../schemas/documento'

const E = 'documentos_centro.errors'

/**
 * El error de crear o editar un documento. Aquí un 23505 solo puede ser el título: dos documentos
 * vivos del centro no se llaman igual (`documentos_centro_titulo_vivo`, 3a). Fuera de estas dos
 * funciones no se traduce así, porque las versiones tienen otros UNIQUE.
 */
function errorDelDocumento(e: { code?: string; hint?: string | null; message?: string }): string {
  if (e.code === '23505') return `${E}.titulo_repetido`
  const clave = errorDeLaBase(e)
  if (clave === `${E}.guardar`) logger.warn('documentos del centro: documento', e.message)
  return clave
}

/** Crea un documento del centro (J1: la admin; la base lo vuelve a mirar). */
export async function crearDocumentoAccion(
  input: CrearDocumentoInput
): Promise<ActionResult<{ documentoId: string }>> {
  const p = crearDocumentoSchema.safeParse(input)
  if (!p.success) return fail(`${E}.invalido`)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('crear_documento_centro', {
    p_centro_id: p.data.centroId,
    p_titulo: p.data.titulo,
    p_de_curso: p.data.deCurso,
    p_obligatorio: p.data.obligatorio,
    p_orden: p.data.orden,
  })
  if (error || !data) return fail(error ? errorDelDocumento(error) : `${E}.guardar`)
  return ok({ documentoId: data })
}

/**
 * Edita un documento: lo que no se pasa se queda como está (`NULL` en la función). «De curso» solo
 * cambia sin versiones (J6), y la base lo vuelve a mirar (`de_curso_fijo`). Retirar y volver a poner
 * van por aquí (`retirado`), sin borrar nada.
 */
export async function editarDocumentoAccion(input: EditarDocumentoInput): Promise<ActionResult> {
  const p = editarDocumentoSchema.safeParse(input)
  if (!p.success) return fail(`${E}.invalido`)
  const supabase = await createClient()
  const { error } = await supabase.rpc('editar_documento_centro', {
    p_documento_id: p.data.documentoId,
    p_titulo: p.data.titulo ?? null,
    p_de_curso: p.data.deCurso ?? null,
    p_obligatorio: p.data.obligatorio ?? null,
    p_orden: p.data.orden ?? null,
    p_retirado: p.data.retirado ?? null,
  })
  if (error) return fail(errorDelDocumento(error))
  return ok(undefined)
}
