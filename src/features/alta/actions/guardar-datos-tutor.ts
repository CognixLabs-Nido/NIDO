'use server'

import { createClient } from '@/lib/supabase/server'
import { clavesQueCambian } from '@/features/cambios-pendientes/lib/diff'
import { registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { logger } from '@/shared/lib/logger'

import { normalizarTelefono } from '../lib/datos-tutor'
import {
  guardarDatosTutorSchema,
  rolFamiliaDeVinculo,
  type GuardarDatosTutorInput,
} from '../schemas/alta-documentos'

import { fail, ok, type ActionResult } from '../../centros/types'

/** Lo que la base devuelve al rechazar un dato, a su mensaje (los CHECK y el rango de la fecha). */
function errorDeDato(e: { code?: string; hint?: string; message?: string }): string | null {
  if (e.hint === 'fecha_nacimiento_fuera_de_rango') return 'alta.tutor.errors.fecha_nacimiento'
  if (e.code !== '23514') return null
  if (e.message?.includes('familia_tutores_telefono_formato')) return 'alta.tutor.errors.telefono'
  if (e.message?.includes('familia_tutores_dni_numero_valido'))
    return 'alta.tutor.errors.dni_numero'
  return 'alta.documentos.errors.datos_invalidos'
}

/**
 * El perfil del tutor (identidad, dirección y, desde la fase 6, teléfono, fecha de nacimiento, número
 * del DNI, estudios y empresa) en `familia_tutores`, el perfil COMPARTIDO por la familia.
 *
 * Escribe SOLO por `guardar_tutor` (`20270118120000`), que aplica en la base la regla única (cada tutor
 * lo suyo; el tutor 1, lo del tutor 2 mientras no tiene cuenta) y la cola: con el alta de la FAMILIA
 * validada, un cambio devuelve 42501 HINT `cola_validacion`, y entonces se encola entero para la
 * Dirección. Antes la cola la decidía la app por NIÑO, y por el alta de un hermano sin validar se
 * escribía directo (medido el 2026-11-13); y el tutor escribía la tabla directamente, también los
 * datos del otro tutor con cuenta. La base es ahora la única que decide.
 *
 * Solo se encola lo que cambia respecto a lo guardado (`clavesQueCambian`): una entrada que no cambia
 * nada enseña a aprobar sin mirar. El payload va ENTERO: al aprobar se escriben todos los campos.
 */
export async function guardarDatosTutor(
  input: GuardarDatosTutorInput
): Promise<ActionResult<{ id?: string; pendienteValidacion?: boolean }>> {
  const parsed = guardarDatosTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'alta.documentos.errors.datos_invalidos')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { nino_id, tipo_vinculo, ...campos } = parsed.data
  const vacio = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null)
  const propuesto = {
    email: vacio(campos.email),
    nombre_completo: vacio(campos.nombre_completo),
    direccion_calle: vacio(campos.direccion_calle),
    direccion_numero: vacio(campos.direccion_numero),
    direccion_cp: vacio(campos.direccion_cp),
    direccion_ciudad: vacio(campos.direccion_ciudad),
    telefono: campos.telefono ? normalizarTelefono(campos.telefono) : null,
    fecha_nacimiento: vacio(campos.fecha_nacimiento),
    dni_numero: vacio(campos.dni_numero)?.toUpperCase() ?? null,
    estudios: vacio(campos.estudios),
    empresa: vacio(campos.empresa),
  }

  // Niño → familia. Con `ninos.familia_id` NOT NULL esto no falla salvo niño inexistente o sin acceso.
  const { data: nino } = await supabase
    .from('ninos')
    .select('familia_id')
    .eq('id', nino_id)
    .maybeSingle()
  if (!nino?.familia_id) return fail('alta.errors.no_autorizado')
  const rolFamilia = rolFamiliaDeVinculo(tipo_vinculo)

  const { data: id, error } = await supabase.rpc('guardar_tutor', {
    p_familia_id: nino.familia_id,
    p_rol_familia: rolFamilia,
    p_datos: propuesto,
  })
  if (!error) return ok(id ? { id } : {})

  if (error.hint !== 'cola_validacion') {
    logger.warn('guardarDatosTutor: guardar_tutor', error.code ?? 'sin_codigo')
    const dato = errorDeDato(error)
    if (dato) return fail(dato)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    if (error.hint === 'titular_sin_fila') return fail('alta.documentos.errors.tutor_duplicado')
    return fail('alta.documentos.errors.guardado')
  }

  // Alta de la familia validada: a la cola, solo si algo cambia respecto a lo guardado.
  const { data: guardados, error: gErr } = await supabase.rpc('tutores_de_familia', {
    p_familia_id: nino.familia_id,
  })
  const guardado = guardados?.find((t) => t.rol_familia === rolFamilia) ?? null
  if (gErr || (guardado && !guardado.ve_personales)) {
    logger.warn('guardarDatosTutor: leer lo guardado', gErr?.code ?? 'sin_permiso')
    return fail('alta.documentos.errors.guardado')
  }
  if (Object.keys(clavesQueCambian(propuesto, guardado)).length === 0) return ok({})
  const r = await registrarCambioPendiente(supabase, {
    ninoId: nino_id,
    usuarioId: user.id,
    entidad: 'datos_tutor',
    payload: { tipo_vinculo, ...propuesto },
  })
  if (!r.ok) return fail(r.error)
  return ok({ pendienteValidacion: true })
}
