import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { rolFamiliaDeVinculo } from '@/features/alta/schemas/alta-documentos'
import type { Database } from '@/types/database'

import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  borrarObjetosBucket,
} from '@/shared/lib/adjuntos/storage'

import {
  payloadDatosTutorDniSchema,
  payloadDatosTutorSchema,
  payloadDocumentoSchema,
  payloadNinosFamiliaSchema,
  type EntidadCambio,
} from '../schemas'

type Service = SupabaseClient<Database>

export interface CambioRow {
  entidad: string
  nino_id: string
  payload: unknown
}

/** Resuelve la familia del niño (NOT NULL desde F-2b-3); lanza si no la encuentra. */
async function familiaDeNino(service: Service, ninoId: string): Promise<string> {
  const { data: nino } = await service
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  if (!nino?.familia_id) throw new Error('familia_no_encontrada')
  return nino.familia_id
}

/**
 * F11-G-3 — APLICA un cambio pendiente aprobado por la dirección, con **service role**
 * (la autorización `es_admin` ya la hizo el action vía RLS antes de llamar aquí). Despacha
 * por `entidad`: parches de datos (`ninos`/`datos_tutor`) o confirmación de la ruta de un
 * documento ya subido (libro de familia / DNI), limpiando el documento anterior. Lanza si el
 * payload no valida o la entidad es desconocida (el action lo captura y revierte el estado).
 */
export async function aplicarCambioPendiente(service: Service, row: CambioRow): Promise<void> {
  const entidad = row.entidad as EntidadCambio

  if (entidad === 'ninos_familia') {
    const patch = payloadNinosFamiliaSchema.parse(row.payload)
    const limpio: Database['public']['Tables']['ninos']['Update'] = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    )
    if (Object.keys(limpio).length > 0) {
      const { error } = await service.from('ninos').update(limpio).eq('id', row.nino_id)
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entidad === 'ninos_libro_familia') {
    const { path } = payloadDocumentoSchema.parse(row.payload)
    const { data: nino } = await service
      .from('ninos')
      .select('libro_familia_path')
      .eq('id', row.nino_id)
      .maybeSingle()
    const { error } = await service
      .from('ninos')
      .update({ libro_familia_path: path })
      .eq('id', row.nino_id)
    if (error) throw new Error(error.message)
    if (nino?.libro_familia_path && nino.libro_familia_path !== path) {
      await borrarObjetosBucket(service, BUCKET_LIBRO_FAMILIA, [nino.libro_familia_path]).catch(
        () => undefined
      )
    }
    return
  }

  if (entidad === 'datos_tutor') {
    const p = payloadDatosTutorSchema.parse(row.payload)
    const identidad = {
      email: p.email ?? null,
      nombre_completo: p.nombre_completo ?? null,
      direccion_calle: p.direccion_calle ?? null,
      direccion_numero: p.direccion_numero ?? null,
      direccion_cp: p.direccion_cp ?? null,
      direccion_ciudad: p.direccion_ciudad ?? null,
    }
    // F-2b-3: escribe el perfil COMPARTIDO `familia_tutores` (no `datos_tutor`) → cierra el
    // split-brain (3b escribe familia_tutores antes de validar; la cola tras validar también).
    // service_role: exento del congelado (y además solo toca identidad/dirección).
    const familiaId = await familiaDeNino(service, row.nino_id)
    const rolFamilia = rolFamiliaDeVinculo(p.tipo_vinculo)
    const { data: existente } = await service
      .from('familia_tutores')
      .select('id')
      .eq('familia_id', familiaId)
      .eq('rol_familia', rolFamilia)
      .is('deleted_at', null)
      .maybeSingle()
    if (existente) {
      const { error } = await service
        .from('familia_tutores')
        .update(identidad)
        .eq('id', existente.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await service
        .from('familia_tutores')
        .insert({ familia_id: familiaId, rol_familia: rolFamilia, usuario_id: null, ...identidad })
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entidad === 'datos_tutor_dni') {
    const p = payloadDatosTutorDniSchema.parse(row.payload)
    const familiaId = await familiaDeNino(service, row.nino_id)
    const rolFamilia = rolFamiliaDeVinculo(p.tipo_vinculo)
    const { data: existente } = await service
      .from('familia_tutores')
      .select('id, dni_documento_path')
      .eq('familia_id', familiaId)
      .eq('rol_familia', rolFamilia)
      .is('deleted_at', null)
      .maybeSingle()
    if (existente) {
      const { error } = await service
        .from('familia_tutores')
        .update({ dni_documento_path: p.path })
        .eq('id', existente.id)
      if (error) throw new Error(error.message)
      if (existente.dni_documento_path && existente.dni_documento_path !== p.path) {
        await borrarObjetosBucket(service, BUCKET_DNI_TUTORES, [
          existente.dni_documento_path,
        ]).catch(() => undefined)
      }
    } else {
      const { error } = await service.from('familia_tutores').insert({
        familia_id: familiaId,
        rol_familia: rolFamilia,
        usuario_id: null,
        dni_documento_path: p.path,
      })
      if (error) throw new Error(error.message)
    }
    return
  }

  throw new Error(`entidad_desconocida:${row.entidad}`)
}

/**
 * F11-G-3 — DESCARTA un cambio rechazado: borra los objetos staged de los documentos
 * (libro de familia / DNI) que quedaron subidos a la espera de validación. Los parches de
 * datos no dejan nada que limpiar. Best-effort.
 */
export async function descartarCambioPendiente(service: Service, row: CambioRow): Promise<void> {
  const entidad = row.entidad as EntidadCambio
  if (entidad === 'ninos_libro_familia') {
    const { path } = payloadDocumentoSchema.parse(row.payload)
    await borrarObjetosBucket(service, BUCKET_LIBRO_FAMILIA, [path]).catch(() => undefined)
  } else if (entidad === 'datos_tutor_dni') {
    const { path } = payloadDatosTutorDniSchema.parse(row.payload)
    await borrarObjetosBucket(service, BUCKET_DNI_TUTORES, [path]).catch(() => undefined)
  }
}
