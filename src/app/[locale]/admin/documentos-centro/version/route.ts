import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { MAX_PDF_BYTES, subirVersionDocumento } from '@/features/documentos-centro/lib/versiones'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const camposSchema = z.object({
  centro_id: z.string().uuid(),
  documento_id: z.string().uuid(),
  curso_academico_id: z.string().uuid().nullable(),
  // 4d: dicho siempre, «true» o «false». Lo que no sea eso no se lee como «no pedir».
  pide_refirma: z.enum(['true', 'false']),
})

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error }, { status })
}

/**
 * Sube una versión de un documento del centro (3a, `20270101120000`): la admin del centro (J1). El
 * hash lo calcula el servidor con los bytes que llegan (`subirVersionDocumento`), y la base vuelve a
 * mirar quién sube, el documento y el curso al registrar.
 */
export async function POST(request: Request): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('documentos_centro.errors.subida')
  }
  const curso = form.get('curso_academico_id')
  const campos = camposSchema.safeParse({
    centro_id: form.get('centro_id'),
    documento_id: form.get('documento_id'),
    curso_academico_id: typeof curso === 'string' && curso !== '' ? curso : null,
    pide_refirma: form.get('pide_refirma'),
  })
  if (!campos.success) return err('documentos_centro.errors.invalido')
  const file = form.get('file')
  if (!(file instanceof Blob)) return err('documentos_centro.errors.subida')
  if (file.size > MAX_PDF_BYTES) return err('documentos_centro.errors.tamano')

  const r = await subirVersionDocumento(await createClient(), createServiceRoleClient(), {
    centroId: campos.data.centro_id,
    documentoId: campos.data.documento_id,
    cursoId: campos.data.curso_academico_id,
    bytes: new Uint8Array(await file.arrayBuffer()),
    pideRefirma: campos.data.pide_refirma === 'true',
  })
  if (!r.ok) return err(r.error, r.error.endsWith('.no_autorizado') ? 403 : 400)
  return Response.json({ success: true, data: r.data })
}
