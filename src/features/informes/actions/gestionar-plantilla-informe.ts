'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'

import { estructuraToJson } from '../lib/estructura'
import {
  archivarPlantillaInformeSchema,
  crearPlantillaInformeSchema,
  editarPlantillaInformeSchema,
  type ArchivarPlantillaInformeInput,
  type CrearPlantillaInformeInput,
  type EditarPlantillaInformeInput,
} from '../schemas/plantillas-informe'
import type { EstructuraInforme } from '../types'
import { fail, ok, type ActionResult } from '../types'

function revalidarInformes(): void {
  revalidatePath('/[locale]/admin/informes', 'page')
}

/**
 * Asigna un `id` estable a cada ítem que no lo traiga (ítems nuevos del editor).
 * Los existentes conservan su id → al editar la plantilla, las claves de ítem no
 * cambian. (El snapshot de F9-0 ya aísla los informes ya creados; esto solo
 * mantiene la coherencia dentro de la propia plantilla.)
 */
function normalizarEstructura(estructura: EstructuraInforme): EstructuraInforme {
  return estructura.map((area) => ({
    titulo: area.titulo,
    items: area.items.map((item) => ({
      id: item.id && item.id.length > 0 ? item.id : randomUUID(),
      texto: item.texto,
    })),
  }))
}

/**
 * Crea una plantilla de informe del centro. Queda **activa** y usable de inmediato
 * (no hay borrador/publicación para plantillas; eso es para los informes). Solo
 * **admin** (RLS `plantillas_informe_insert` → `es_admin` + `creado_por=auth.uid()`).
 * Varias plantillas por centro (Q1): el nombre las distingue.
 */
export async function crearPlantillaInforme(
  input: CrearPlantillaInformeInput
): Promise<ActionResult<{ plantilla_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = crearPlantillaInformeSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'informes.errors.creacion_fallo')
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail('informes.errors.no_autorizado')

  const estructura = normalizarEstructura(parsed.data.estructura as EstructuraInforme)

  const { data: creada, error } = await supabase
    .from('plantillas_informe')
    .insert({
      centro_id: centroId,
      titulo: parsed.data.titulo,
      estructura: estructuraToJson(estructura),
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (error || !creada) {
    logger.warn('crearPlantillaInforme: insert', error?.message)
    if (error?.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.creacion_fallo')
  }

  revalidarInformes()
  return ok({ plantilla_id: creada.id })
}

/**
 * Edita el nombre y/o la estructura de una plantilla existente. Editar **solo
 * afecta a informes NUEVOS**: los ya creados llevan su snapshot (F9-0) y no se
 * tocan. Solo **admin** (RLS `plantillas_informe_update`).
 */
export async function editarPlantillaInforme(
  input: EditarPlantillaInformeInput
): Promise<ActionResult<{ plantilla_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = editarPlantillaInformeSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'informes.errors.edicion_fallo')
  }

  const estructura = normalizarEstructura(parsed.data.estructura as EstructuraInforme)

  const { data: upd, error } = await supabase
    .from('plantillas_informe')
    .update({
      titulo: parsed.data.titulo,
      estructura: estructuraToJson(estructura),
    })
    .eq('id', parsed.data.plantilla_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarPlantillaInforme: update', error.message)
    if (error.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.edicion_fallo')
  }
  if (!upd) return fail('informes.errors.no_autorizado')

  revalidarInformes()
  return ok({ plantilla_id: upd.id })
}

/**
 * Archiva una plantilla (no se borra). Deja de ofrecerse para informes nuevos,
 * pero no rompe los pasados (que llevan su snapshot). `estado='archivada'` +
 * `archivada_at/por`. Solo **admin** (RLS `plantillas_informe_update`).
 */
export async function archivarPlantillaInforme(
  input: ArchivarPlantillaInformeInput
): Promise<ActionResult<{ plantilla_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = archivarPlantillaInformeSchema.safeParse(input)
  if (!parsed.success) return fail('informes.errors.archivar_fallo')

  const { data: upd, error } = await supabase
    .from('plantillas_informe')
    .update({
      estado: 'archivada',
      archivada_at: new Date().toISOString(),
      archivada_por: user.id,
    })
    .eq('id', parsed.data.plantilla_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('archivarPlantillaInforme: update', error.message)
    if (error.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.archivar_fallo')
  }
  if (!upd) return fail('informes.errors.no_autorizado')

  revalidarInformes()
  return ok({ plantilla_id: upd.id })
}
