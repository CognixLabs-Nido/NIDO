'use server'

import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { fail, ok, type ActionResult } from '../../centros/types'
import { borrarFicheroSuelto, borrarVersionDocumento } from '../lib/versiones'

const uuid = z.string().uuid()

/** J5: borra una versión sin firmas y su fichero. La admin del centro; la base lo vuelve a mirar. */
export async function borrarVersionDocumentoAccion(
  versionId: string
): Promise<ActionResult<{ ficheroBorrado: boolean }>> {
  if (!uuid.safeParse(versionId).success) return fail('documentos_centro.errors.invalido')
  const r = await borrarVersionDocumento(await createClient(), createServiceRoleClient(), versionId)
  return r.ok ? ok(r.data) : fail(r.error)
}

/** Reintenta borrar el fichero de una versión ya borrada que quedó suelto. */
export async function borrarFicheroSueltoAccion(
  centroId: string,
  ruta: string
): Promise<ActionResult<{ ficheroBorrado: boolean }>> {
  if (!uuid.safeParse(centroId).success || !ruta.startsWith(`${centroId}/`))
    return fail('documentos_centro.errors.invalido')
  const r = await borrarFicheroSuelto(
    await createClient(),
    createServiceRoleClient(),
    centroId,
    ruta
  )
  return r.ok ? ok(r.data) : fail(r.error)
}
