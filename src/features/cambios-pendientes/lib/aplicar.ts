import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

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
    const { data: existente } = await service
      .from('datos_tutor')
      .select('id')
      .eq('nino_id', row.nino_id)
      .eq('tipo_vinculo', p.tipo_vinculo)
      .is('deleted_at', null)
      .maybeSingle()
    if (existente) {
      const { error } = await service.from('datos_tutor').update(identidad).eq('id', existente.id)
      if (error) throw new Error(error.message)
    } else {
      const { data: nino } = await service
        .from('ninos')
        .select('centro_id')
        .eq('id', row.nino_id)
        .maybeSingle()
      if (!nino) throw new Error('nino_no_encontrado')
      const { error } = await service.from('datos_tutor').insert({
        centro_id: nino.centro_id,
        nino_id: row.nino_id,
        tipo_vinculo: p.tipo_vinculo,
        usuario_id: null,
        ...identidad,
      })
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entidad === 'datos_tutor_dni') {
    const p = payloadDatosTutorDniSchema.parse(row.payload)
    const { data: existente } = await service
      .from('datos_tutor')
      .select('id, dni_documento_path')
      .eq('nino_id', row.nino_id)
      .eq('tipo_vinculo', p.tipo_vinculo)
      .is('deleted_at', null)
      .maybeSingle()
    if (existente) {
      const { error } = await service
        .from('datos_tutor')
        .update({ dni_documento_path: p.path })
        .eq('id', existente.id)
      if (error) throw new Error(error.message)
      if (existente.dni_documento_path && existente.dni_documento_path !== p.path) {
        await borrarObjetosBucket(service, BUCKET_DNI_TUTORES, [
          existente.dni_documento_path,
        ]).catch(() => undefined)
      }
    } else {
      const { data: nino } = await service
        .from('ninos')
        .select('centro_id')
        .eq('id', row.nino_id)
        .maybeSingle()
      if (!nino) throw new Error('nino_no_encontrado')
      const { error } = await service.from('datos_tutor').insert({
        centro_id: nino.centro_id,
        nino_id: row.nino_id,
        tipo_vinculo: p.tipo_vinculo,
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
