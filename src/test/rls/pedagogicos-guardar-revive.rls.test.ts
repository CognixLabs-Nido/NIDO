import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Guardar REVIVE el registro borrado (decisión del responsable, 2026-11-24). Sin eso, una familia
 * rellenaba los tres campos, el formulario decía «guardado», y el niño seguía contando como «sin datos»
 * para la profe: el upsert por `nino_id` actualizaba la fila borrada y la dejaba borrada. «Un
 * formulario que se traga lo que le escribes.»
 *
 * Es seguro porque se midió (2026-11-24): ningún código de la app borra en blando esta tabla (las
 * purgas hacen DELETE). Si algún día existiera ese borrado, esta decisión es la que hay que revisar.
 *
 * Por los dos que escriben (el tutor legal en el alta y la Dirección en la ficha), con la acción real y
 * su sesión: la fila queda viva, con lo escrito, y `nino_toma_comida_solida` deja de decir NULL.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { upsertDatosPedagogicos } =
  await import('@/features/datos-pedagogicos/actions/upsert-datos-pedagogicos')

describe('guardar sobre un registro borrado lo revive', () => {
  let centroId: string
  let ninos: Record<'tutor' | 'admin', { id: string; familia_id: string }>
  let legal: TestUser
  let admin: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pedagogicos Revive')
    centroId = centro.id
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    ninos = {
      tutor: await createTestNino(centro.id, 'Nino Revive Tutor'),
      admin: await createTestNino(centro.id, 'Nino Revive Admin'),
    }
    for (const n of Object.values(ninos)) {
      await matricular(n.id, aula.id, curso.id)
      // Borrado A MANO (ningún código de la app lo hace): lo borrado decía biberón.
      const { error } = await serviceClient.from('datos_pedagogicos_nino').insert({
        nino_id: n.id,
        lactancia_estado: 'biberon',
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
        deleted_at: new Date().toISOString(),
      })
      if (error) throw new Error(`fila borrada: ${error.message}`)
    }
    legal = await createTestUser({ nombre: 'Legal Pedagogicos Revive' })
    await crearFamiliaTutor(ninos.tutor.familia_id, legal.id)
    await crearVinculo(ninos.tutor.id, legal.id, 'tutor_legal_principal')
    admin = await createTestUser({ nombre: 'Admin Pedagogicos Revive' })
    await asignarRol(admin.id, centro.id, 'admin')
  }, 90_000)

  afterAll(async () => {
    sesion.actual = null
    if (ninos)
      await serviceClient
        .from('datos_pedagogicos_nino')
        .delete()
        .in('nino_id', [ninos.tutor.id, ninos.admin.id])
    await deleteTestCentro(centroId)
    if (legal) await deleteTestUser(legal.id)
    if (admin) await deleteTestUser(admin.id)
  }, 90_000)

  afterEach(() => {
    sesion.actual = null
  })

  it.each(['tutor', 'admin'] as const)(
    '%s: rellena los tres, «guardado», y el niño deja de estar sin datos',
    async (quien) => {
      const nino = ninos[quien]
      const antes = await serviceClient
        .from('datos_pedagogicos_nino')
        .select('deleted_at')
        .eq('nino_id', nino.id)
        .single()
      expect(antes.data?.deleted_at, 'premisa: el registro está borrado').not.toBeNull()
      const solidosAntes = await serviceClient.rpc('nino_toma_comida_solida', {
        p_nino_id: nino.id,
      })
      expect(solidosAntes.data, 'premisa: hoy cuenta como «sin datos»').toBeNull()

      sesion.actual = await clientFor(quien === 'tutor' ? legal : admin)
      const r = await upsertDatosPedagogicos('es', {
        nino_id: nino.id,
        lactancia_estado: 'finalizada',
        lactancia_observaciones: null,
        control_esfinteres: 'transicion',
        control_esfinteres_observaciones: null,
        siesta_horario_habitual: null,
        siesta_numero_diario: null,
        siesta_observaciones: null,
        tipo_alimentacion: 'omnivora',
        alimentacion_observaciones: null,
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      })
      expect(r.success, 'el formulario dice «guardado»').toBe(true)

      const despues = await serviceClient
        .from('datos_pedagogicos_nino')
        .select('deleted_at, lactancia_estado')
        .eq('nino_id', nino.id)
        .single()
      expect(despues.data?.lactancia_estado, 'premisa: lo escrito llegó a la fila').toBe(
        'finalizada'
      )
      expect(despues.data?.deleted_at, 'guardar la revive').toBeNull()
      const solidos = await serviceClient.rpc('nino_toma_comida_solida', { p_nino_id: nino.id })
      expect(solidos.data, 'y deja de decir «sin datos»: finalizada come sólidos').toBe(true)
    }
  )
})
