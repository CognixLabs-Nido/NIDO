'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { centroDelCurso, esAdminDelCentro } from '../lib/authz-admisiones'
import { resolverTutorPorEmail } from '../lib/resolver-tutor-email'
import { crearProspectoSchema, type CrearProspectoInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'
import { falloDeLectura } from '@/shared/lib/frontera-lectura'

/**
 * F11-H-3: añade un prospecto a la lista de espera de un curso. `posicion` la pone la base al
 * final de la cola (trigger con cerrojo por curso, 2026-11-24). `centro_id` lo deriva el trigger de BD
 * del curso; el insert va por el cliente autenticado → RLS exige admin del centro.
 *
 * U-5 (D7) — es la PUERTA ÚNICA de alta de alumnos. Antes había dos: esta ("añadir niño
 * nuevo") y `anadirHijoAFamilia` ("añadir hijo a familia existente"), y la dirección tenía
 * que acertar cuál abrir. Ahora se pide siempre lo mismo y el SERVIDOR decide por el email
 * del tutor: si la cuenta ya es operativa, el prospecto nace con `tutor_usuario_id` (D1/U-2)
 * como si hubiera venido de la puerta de "familia existente"; si no, nace normal.
 *
 * La resolución se hace AQUÍ, no en el cliente: el diálogo solo muestra una vista previa
 * (`resolverTutorParaProspecto`) y no puede fijar el `tutor_usuario_id` por payload.
 */
export async function crearProspecto(
  input: CrearProspectoInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = crearProspectoSchema.safeParse(input)
    if (!parsed.success)
      return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
    const data = parsed.data

    const supabase = await createClient()

    // Centro del registro: el del curso del prospecto (el trigger de BD lo deriva igual).
    const centroId = await centroDelCurso(supabase, data.curso_academico_id)
    if (!centroId) return fail('listaEspera.errors.sin_centro')

    // La detección lee por service role (auth.users + roles_usuario) → gate admin explícito,
    // además de la RLS que ya cubre el insert.
    if (!(await esAdminDelCentro(supabase, centroId)))
      return fail('auth.invitation.errors.forbidden')

    // Sin email → `familia_nueva` sin consultar nada. Si el servicio de cuentas falla, se
    // ABORTA en vez de crear el prospecto mal clasificado: un 2.º hijo guardado como familia
    // nueva volvería a abrirle una cuenta al tutor al promoverlo.
    const tutor = await resolverTutorPorEmail(createServiceRoleClient(), data.email_tutor, centroId)
    if (!tutor) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')

    const { data: creado, error } = await supabase
      .from('lista_espera')
      .insert({
        centro_id: centroId, // lo sobrescribe el trigger; se pasa para satisfacer el tipo
        curso_academico_id: data.curso_academico_id,
        nombre_nino: data.nombre_nino,
        primer_apellido_nino: data.primer_apellido_nino,
        segundo_apellido_nino: data.segundo_apellido_nino,
        fecha_nacimiento: data.fecha_nacimiento,
        telefono_tutor: data.telefono_tutor,
        email_tutor: data.email_tutor,
        nota: data.nota,
        // D1: la pista EXACTA para vincular al promover cuando el tutor ya existe.
        tutor_usuario_id: tutor.tutorUsuarioId,
        // La pone la base al insertar (trigger, con cerrojo por curso: C, 2026-11-24). Calcularla aquí
        // como «la última + 1» daba la misma a dos altas a la vez. Lo que se manda se ignora.
        posicion: 0,
      })
      .select('id')
      .single()
    if (error || !creado) {
      logger.warn('crearProspecto insert', error?.message)
      return fail('listaEspera.errors.crear_fallo')
    }

    revalidatePath('/[locale]/admin/admisiones', 'page')
    return ok({ id: creado.id })
  } catch (e) {
    return falloDeLectura(e)
  }
}
