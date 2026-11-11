'use server'

import { createClient } from '@/lib/supabase/server'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { esAdminDeCentroDeNino } from '@/features/alta/lib/authz-tutor'
import { cambiosIdentidad } from '@/features/cambios-pendientes/lib/diff'
import { logger } from '@/shared/lib/logger'

import { leerFichaGestionDe } from '../lib/ficha-gestion'
import { parcheNinoDireccion } from '../lib/parche-nino'
import { actualizarNinoTutorSchema, type ActualizarNinoTutorInput } from '../schemas/nino'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3a — el TUTOR LEGAL escribe la identidad de su hijo vía la RPC
 * `actualizar_identidad_nino_tutor` (SECURITY DEFINER, gate `es_tutor_legal_de`, whitelist de
 * columnas). Nunca `UPDATE` directo a `ninos`: la RPC impide tocar aula/centro/flags/notas_admin.
 * NULL = preservar.
 *
 * Puerta de identidad (2026-11-08, `20270113120000`): con el alta YA validada, los campos que
 * identifican al niño (nombre, apellidos, fecha de nacimiento, sexo, nacionalidad; y lugar de
 * nacimiento y DNI cuando la 5b los pregunte) no se aplican: lo que CAMBIA respecto a lo guardado
 * va a la cola de Dirección (`ninos_identidad`), y a la RPC le llegan como NULL. El idioma sigue
 * directo. Si no cambia nada, no se encola nada. La base hace lo mismo como respaldo: rechaza un
 * cambio de esos campos con el alta validada.
 *
 * Fase 5b (2026-11-11): llegan del formulario el lugar de nacimiento y el DNI (identidad: con el
 * alta validada, a la cola) y los directos (hermanos, observaciones, cómo nos conoció).
 *
 * **La Dirección escribe directamente.** En «modo Dirección» (el alta en papel) la función de
 * arriba le contesta 42501: su puerta es `es_tutor_legal_de` (medido en producción el 2026-11-08 y
 * otra vez el 2026-11-11). La Dirección escribe la ficha con su sesión (`ninos_admin_all`, con los
 * mismos CHECK), igual que cuando aprueba la cola, y no pasa por la cola: Dirección no se valida a
 * sí misma. Quién es lo decide AQUÍ el servidor (`esAdminDeCentroDeNino`), nunca el cliente; a una
 * tutora la RLS no le deja escribir la tabla (0 filas), así que este camino no le sirve de nada.
 */
export async function actualizarNinoTutor(
  input: ActualizarNinoTutorInput
): Promise<ActionResult<{ id: string; pendienteValidacion: boolean }>> {
  const parsed = actualizarNinoTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'nino.validation.invalid')
  }

  const d = parsed.data
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('nino.errors.no_autorizado')

  if (await esAdminDeCentroDeNino(supabase, d.nino_id, user.id)) {
    const { data: escrita, error: errDireccion } = await supabase
      .from('ninos')
      .update(parcheNinoDireccion(d))
      .eq('id', d.nino_id)
      .select('id')
      .maybeSingle()
    if (errDireccion) {
      logger.warn('actualizarNinoTutor.direccion', errDireccion.code ?? 'sin_codigo')
      if (errDireccion.code === '23514') return fail('nino.validation.invalid')
      return fail('nino.errors.guardar_fallo')
    }
    // USING falso → 0 filas sin error: la RLS no la dejó escribir.
    if (!escrita) return fail('nino.errors.no_autorizado')
    return ok({ id: escrita.id, pendienteValidacion: false })
  }

  const propuesta = {
    nombre: d.nombre,
    primer_apellido: d.primer_apellido,
    // Los dos apellidos van en pareja: el segundo llega siempre con el primero, y vacío es «no
    // tiene» (así se puede quitar). La RPC rechaza el segundo sin el primero.
    segundo_apellido: d.segundo_apellido ?? '',
    fecha_nacimiento: d.fecha_nacimiento,
    sexo: d.sexo ?? null,
    nacionalidad: d.nacionalidad,
    lugar_nacimiento: d.lugar_nacimiento,
    // Vacío = «no tiene» (así se puede quitar); NULL lo dejaría como está.
    dni: d.dni ?? '',
  }

  let pendienteValidacion = false
  let identidadDirecta: typeof propuesta | null = propuesta
  if (await altaValidada(supabase, d.nino_id)) {
    // El DNI es de gestión: sale por `ficha_gestion_ninos` (`20270115120000`), no de la tabla.
    const [{ data: identidad }, gestion] = await Promise.all([
      supabase
        .from('ninos')
        .select(
          'nombre, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, nacionalidad, lugar_nacimiento'
        )
        .eq('id', d.nino_id)
        .maybeSingle(),
      leerFichaGestionDe(supabase, d.nino_id),
    ])
    if (!identidad || !gestion) return fail('nino.errors.no_autorizado')
    const guardada = { ...identidad, dni: gestion.dni }
    const cambios = cambiosIdentidad(propuesta, guardada)
    if (Object.keys(cambios).length > 0) {
      const r = await registrarCambioPendiente(supabase, {
        ninoId: d.nino_id,
        usuarioId: user.id,
        entidad: 'ninos_identidad',
        payload: cambios,
      })
      if (!r.ok) return fail(r.error)
      pendienteValidacion = true
    }
    identidadDirecta = null
  }

  // El tipo generado declara los args como no-nullable, pero la RPC acepta NULL
  // (contrato "NULL = preservar" del setter médico).
  const rpcArgs = {
    p_nino_id: d.nino_id,
    p_nombre: identidadDirecta?.nombre ?? null,
    p_primer_apellido: identidadDirecta?.primer_apellido ?? null,
    p_segundo_apellido: identidadDirecta?.segundo_apellido ?? null,
    p_fecha_nacimiento: identidadDirecta?.fecha_nacimiento ?? null,
    p_sexo: identidadDirecta?.sexo ?? null,
    p_nacionalidad: identidadDirecta?.nacionalidad ?? null,
    p_lugar_nacimiento: identidadDirecta?.lugar_nacimiento ?? null,
    p_dni: identidadDirecta?.dni ?? null,
    // Los directos: nunca a la cola (decidido el 2026-11-07).
    p_idioma_principal: d.idioma_principal,
    p_hermanos_total: d.hermanos_total,
    p_hermanos_lugar: d.hermanos_lugar,
    p_observaciones_familia: d.observaciones_familia ?? null,
    p_como_nos_conocio: d.como_nos_conocio ?? null,
    p_como_nos_conocio_otro: d.como_nos_conocio === 'otro' ? (d.como_nos_conocio_otro ?? '') : null,
  } as unknown as {
    p_nino_id: string
    p_nombre: string
    p_primer_apellido: string
    p_segundo_apellido: string
    p_fecha_nacimiento: string
    p_sexo: 'F' | 'M' | 'X'
    p_nacionalidad: string
    p_idioma_principal: string
    p_lugar_nacimiento: string
    p_dni: string
    p_hermanos_total: number
    p_hermanos_lugar: number
    p_observaciones_familia: string
    p_como_nos_conocio: string
    p_como_nos_conocio_otro: string
  }

  const { data, error } = await supabase.rpc('actualizar_identidad_nino_tutor', rpcArgs)
  if (error) {
    logger.warn('actualizarNinoTutor', error.message)
    if (error.code === '42501') return fail('nino.errors.no_autorizado')
    return fail('nino.errors.guardar_fallo')
  }
  if (!data) return fail('nino.errors.guardar_fallo')
  return ok({ id: data as string, pendienteValidacion })
}
