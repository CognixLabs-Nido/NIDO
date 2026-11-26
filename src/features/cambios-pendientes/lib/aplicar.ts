import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { rolFamiliaDeVinculo } from '@/features/alta/schemas/alta-documentos'
import type { Database } from '@/types/db'

import {
  BUCKET_DNI_TUTORES,
  BUCKET_JUSTIFICANTES_GESTION,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_SIP_NINOS,
  borrarObjetosBucket,
} from '@/shared/lib/adjuntos/storage'
import { rutaJustificanteDelNino } from '@/features/gastos-gestion/lib/gastos'
import { leerFichaGestionDe } from '@/features/ninos/lib/ficha-gestion'
import { logger } from '@/shared/lib/logger'

import {
  payloadDatosTutorDniSchema,
  payloadDatosTutorSchema,
  payloadDocumentoSchema,
  payloadGastosGestionSchema,
  payloadMandatoSepaSchema,
  payloadNinosFamiliaSchema,
  payloadNinosIdentidadSchema,
  payloadPeticionServiciosSchema,
  rutaDocumentoDelNino,
  type EntidadCambio,
} from '../schemas'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'

type Client = SupabaseClient<Database>

export interface CambioRow {
  entidad: string
  centro_id: string
  nino_id: string
  payload: unknown
}

/**
 * R1b — la ruta del documento del payload no es `{centro_id}/{nino_id}/…` de la fila: no se
 * escribe (sería un puntero al documento de otra familia/centro). El action la distingue para
 * dar un mensaje propio en vez de "reintentar".
 */
export class RutaDocumentoInvalidaError extends Error {
  constructor() {
    super('ruta_documento_invalida')
    this.name = 'RutaDocumentoInvalidaError'
  }
}

/** Lanza `RutaDocumentoInvalidaError` si la ruta no es del niño de la fila. */
function exigirRutaDelNino(path: string, row: CambioRow): void {
  if (!rutaDocumentoDelNino(path, row.centro_id, row.nino_id))
    throw new RutaDocumentoInvalidaError()
}

/** Resuelve la familia del niño (NOT NULL desde F-2b-3); lanza si no la encuentra. */
async function familiaDeNino(db: Client, ninoId: string): Promise<string> {
  const { data: nino, error } = await db
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  // Censo C: una lectura caída no es «familia no encontrada».
  if (error) throw new LecturaFallida('familiaDeNino', error)
  if (!nino?.familia_id) throw new Error('familia_no_encontrada')
  return nino.familia_id
}

/**
 * F11-G-3 — APLICA un cambio pendiente aprobado por la dirección. Despacha por `entidad`:
 * parches de datos (`ninos`/`datos_tutor`) o confirmación de la ruta de un documento ya
 * subido (libro de familia / DNI), limpiando el documento anterior. Lanza si el payload no
 * valida o la entidad es desconocida (el action lo captura y revierte el estado).
 *
 * PR-D (D2): las escrituras de BD van con `db`, el cliente de SESIÓN de la directora que
 * aprueba: la RLS de admin (`ninos_admin_all`, `familia_tutores_insert/update`) las autoriza y
 * `audit_log` la registra a ELLA, no NULL. `storage` (service role) solo borra el documento
 * anterior de Storage.
 */
export async function aplicarCambioPendiente(
  db: Client,
  storage: Client,
  row: CambioRow
): Promise<void> {
  const entidad = row.entidad as EntidadCambio

  if (entidad === 'ninos_familia') {
    const patch = payloadNinosFamiliaSchema.parse(row.payload)
    const limpio: Database['public']['Tables']['ninos']['Update'] = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    )
    if (Object.keys(limpio).length > 0) {
      const { error } = await db.from('ninos').update(limpio).eq('id', row.nino_id)
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entidad === 'ninos_identidad') {
    // Puerta de identidad (2026-11-08): los campos que cambian, ya normalizados al encolar. Con la
    // sesión de la directora (`ninos_admin_all`): los CHECK de la base (el DNI con su letra, los
    // apellidos en pareja) valen también aquí. `strict`: una clave ajena hace fallar el parse.
    const patch = payloadNinosIdentidadSchema.parse(row.payload)
    // Con RETURNING: un UPDATE que la RLS deja en 0 filas no da error, y la entrada quedaría
    // aprobada sin aplicar.
    const { data, error } = await db
      .from('ninos')
      .update(patch)
      .eq('id', row.nino_id)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('identidad_no_aplicada')
    return
  }

  if (entidad === 'ninos_libro_familia') {
    const { path } = payloadDocumentoSchema.parse(row.payload)
    exigirRutaDelNino(path, row)
    // El libro anterior es de gestión: sale por `ficha_gestion_ninos` (`20270115120000`), que a la
    // Dirección que aprueba le contesta siempre. Sin leerlo no se sabe qué borrar: no se sigue.
    const nino = await leerFichaGestionDe(db, row.nino_id)
    if (!nino) throw new Error('libro_anterior_no_leido')
    const { error } = await db
      .from('ninos')
      .update({ libro_familia_path: path })
      .eq('id', row.nino_id)
    if (error) throw new Error(error.message)
    if (nino?.libro_familia_path && nino.libro_familia_path !== path) {
      await borrarObjetosBucket(storage, BUCKET_LIBRO_FAMILIA, [nino.libro_familia_path]).catch(
        () => undefined
      )
    }
    return
  }

  if (entidad === 'ninos_sip_documento') {
    // Fase 7: por `fijar_sip_documento_nino` con la sesión de la directora (la Dirección fija con el
    // alta validada: es quien aprueba). Devuelve la ruta anterior: esa imagen ya no la usa nadie.
    const { path } = payloadDocumentoSchema.parse(row.payload)
    exigirRutaDelNino(path, row)
    const { data: anterior, error } = await db.rpc('fijar_sip_documento_nino', {
      p_nino_id: row.nino_id,
      p_path: path,
    })
    if (error) throw new Error(error.message)
    if (anterior && anterior !== path) {
      await borrarObjetosBucket(storage, BUCKET_SIP_NINOS, [anterior]).catch(() => undefined)
    }
    return
  }

  if (entidad === 'datos_tutor') {
    // Fase 6 (`20270118120000`): por `guardar_tutor`, con la sesión de la directora (la Dirección
    // escribe con el alta validada: es quien aprueba). Solo las claves que trae el payload; una entrada
    // de antes de la fase 6 no lleva los cinco nuevos y no los toca.
    const { tipo_vinculo, ...campos } = payloadDatosTutorSchema.parse(row.payload)
    const datos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined))
    const familiaId = await familiaDeNino(db, row.nino_id)
    const { error } = await db.rpc('guardar_tutor', {
      p_familia_id: familiaId,
      p_rol_familia: rolFamiliaDeVinculo(tipo_vinculo),
      p_datos: datos,
    })
    if (error) throw new Error(error.message)
    return
  }

  if (entidad === 'datos_tutor_dni') {
    const p = payloadDatosTutorDniSchema.parse(row.payload)
    exigirRutaDelNino(p.path, row)
    const familiaId = await familiaDeNino(db, row.nino_id)
    // Por `fijar_dni_tutor`, que devuelve la ruta de antes: ese objeto se borra si cambió.
    const { data: anterior, error } = await db.rpc('fijar_dni_tutor', {
      p_familia_id: familiaId,
      p_rol_familia: rolFamiliaDeVinculo(p.tipo_vinculo),
      p_path: p.path,
    })
    if (error) throw new Error(error.message)
    if (anterior && anterior !== p.path) {
      await borrarObjetosBucket(storage, BUCKET_DNI_TUTORES, [anterior]).catch(() => undefined)
    }
    return
  }

  if (entidad === 'peticion_servicios') {
    // Fase 8b: guarda las respuestas y cambia lo que se cobra, con la sesión de la directora. La
    // base vuelve a mirar quién (Dirección del centro), que el alta esté validada y que cada opción
    // se siga ofreciendo; un fallo lanza y la aprobación vuelve a pendiente.
    const { respuestas } = payloadPeticionServiciosSchema.parse(row.payload)
    const { error } = await db.rpc('aplicar_peticion_servicios', {
      p_nino_id: row.nino_id,
      p_respuestas: respuestas,
    })
    if (error) throw new Error(`peticion_servicios: ${error.hint ?? error.code ?? ''}`)
    return
  }

  if (entidad === 'gastos_gestion') {
    // Fase 9: por `declarar_gastos_gestion` con la sesión de la directora (Dirección declara siempre:
    // es quien aprueba). Devuelve la ruta anterior si cambia: ese justificante ya no lo usa nadie.
    const p = payloadGastosGestionSchema.parse(row.payload)
    if (p.path !== undefined && !rutaJustificanteDelNino(p.path, row.centro_id, row.nino_id))
      throw new RutaDocumentoInvalidaError()
    const { data: anterior, error } = await db.rpc('declarar_gastos_gestion', {
      p_nino_id: row.nino_id,
      p_curso_academico_id: p.curso_academico_id,
      p_forma: p.forma,
      ...(p.path === undefined ? {} : { p_justificante_path: p.path }),
    })
    if (error) throw new Error(`gastos_gestion: ${error.hint ?? error.code ?? ''}`)
    if (anterior && anterior !== p.path) {
      await borrarObjetosBucket(storage, BUCKET_JUSTIFICANTES_GESTION, [anterior]).catch(
        () => undefined
      )
    }
    return
  }

  if (entidad === 'mandato_sepa') {
    // 2026-11-20: el mandato propuesto pasa a activo y el que había, a revocado (se conserva), por
    // `decidir_mandato_propuesto` con la sesión de la directora. Nada se borra en Storage: los PDF son
    // el histórico de lo firmado.
    const { mandato_id } = payloadMandatoSepaSchema.parse(row.payload)
    await decidirMandato(db, mandato_id, true)
    return
  }

  throw new Error(`entidad_desconocida:${row.entidad}`)
}

/**
 * 2026-11-20: Dirección decide un mandato propuesto. Lanza si la base no lo deja (no es de su centro, o
 * ya no está esperando): la acción revierte la entrada de la cola a pendiente.
 */
export async function decidirMandato(
  db: Client,
  mandatoId: string,
  aprobar: boolean
): Promise<void> {
  const { data, error } = await db.rpc('decidir_mandato_propuesto', {
    p_mandato_id: mandatoId,
    p_aprobar: aprobar,
  })
  if (error) throw new Error(`mandato_sepa: ${error.hint ?? error.code ?? ''}`)
  if (!data) throw new Error('mandato_sepa: sin_decidir')
}

/**
 * F11-G-3 — DESCARTA un cambio rechazado: borra los objetos staged de los documentos
 * (libro de familia / DNI) que quedaron subidos a la espera de validación. Los parches de
 * datos no dejan nada que limpiar. Best-effort.
 *
 * R1 — el borrado es con service role (salta la RLS de Storage), así que SOLO se borra si la
 * ruta es `{centro_id}/{nino_id}/…` de la fila. Una ruta ajena no se toca (el rechazo sigue
 * adelante: la fila ya quedó `'rechazado'`).
 */
export async function descartarCambioPendiente(service: Client, row: CambioRow): Promise<void> {
  const entidad = row.entidad as EntidadCambio
  let bucket: string
  let path: string
  if (entidad === 'ninos_libro_familia') {
    bucket = BUCKET_LIBRO_FAMILIA
    path = payloadDocumentoSchema.parse(row.payload).path
  } else if (entidad === 'ninos_sip_documento') {
    bucket = BUCKET_SIP_NINOS
    path = payloadDocumentoSchema.parse(row.payload).path
  } else if (entidad === 'datos_tutor_dni') {
    bucket = BUCKET_DNI_TUTORES
    path = payloadDatosTutorDniSchema.parse(row.payload).path
  } else if (entidad === 'gastos_gestion') {
    // Fase 9: el justificante, si lo había (efectivo no deja fichero). PDF o imagen.
    const p = payloadGastosGestionSchema.parse(row.payload).path
    if (p === undefined) return
    if (!rutaJustificanteDelNino(p, row.centro_id, row.nino_id)) {
      logger.warn('descartarCambioPendiente: ruta ajena al niño, no se borra', entidad)
      return
    }
    await borrarObjetosBucket(service, BUCKET_JUSTIFICANTES_GESTION, [p]).catch(() => undefined)
    return
  } else {
    return
  }
  if (!rutaDocumentoDelNino(path, row.centro_id, row.nino_id)) {
    logger.warn('descartarCambioPendiente: ruta ajena al niño, no se borra', entidad)
    return
  }
  await borrarObjetosBucket(service, bucket, [path]).catch(() => undefined)
}
