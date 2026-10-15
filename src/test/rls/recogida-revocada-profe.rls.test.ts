import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Recogida revocada: qué ve la profe en el detalle.
 *
 * Caso real, de punta a punta y con las sesiones de verdad: la familia crea y firma
 * su recogida habitual con una persona (`crearRecogida`), después la revoca
 * (`revocarFirma`), y la profe del aula abre el detalle (`getAutorizacionDetalle`).
 * Una persona que la familia ha quitado no puede seguir saliendo como autorizada.
 *
 * Solo se sustituye lo que es de Next: el cliente de servidor (que aquí es el cliente
 * con la sesión de quien actúa), las cabeceras de la petición y la revalidación.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))
vi.mock('@/features/autorizaciones/lib/request-context', () => ({
  getRequestContext: async () => ({ ip: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { crearRecogida } = await import('@/features/autorizaciones/actions/crear-recogida')
const { revocarFirma } = await import('@/features/autorizaciones/actions/firmar-autorizacion')
const { getAutorizacionDetalle } =
  await import('@/features/autorizaciones/queries/get-autorizacion-detalle')

const TRAZO = 'data:image/png;base64,iVBORw0KGgo='
const NOMBRE_TUTOR = 'Tutora Recogida Revocada'

describe('Recogida revocada — lo que ve la profe en el detalle', () => {
  let centro: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let nino: { id: string }
  let cProfe: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro Recogida Revocada')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id, 'Aula Recogida Revocada')

    admin = await createTestUser({ nombre: 'Admin Recogida Revocada' })
    profe = await createTestUser({ nombre: 'Profe Recogida Revocada' })
    tutor = await createTestUser({ nombre: NOMBRE_TUTOR })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id, curso.id)

    nino = await createTestNino(centro.id)
    await matricular(nino.id, aula.id, curso.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })

    // El formato de recogida publicado del centro (lo crea Dirección).
    const { error } = await serviceClient.from('autorizaciones').insert({
      centro_id: centro.id,
      tipo: 'recogida',
      es_plantilla: true,
      titulo: 'Recogida',
      texto: 'Autorizo a las personas indicadas a recoger a mi hijo o hija.',
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    if (error) throw new Error(`plantilla de recogida: ${error.message}`)

    cProfe = await clientFor(profe)
    cTutor = await clientFor(tutor)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await deleteTestCentro(centro.id)
    for (const u of [admin, profe, tutor]) await deleteTestUser(u.id)
  }, 60_000)

  it('tras revocar, la profe NO ve a la persona como autorizada', async () => {
    // 1. La familia firma su recogida habitual con una persona.
    sesion.actual = cTutor
    const creada = await crearRecogida({
      nino_id: nino.id,
      modalidad: 'habitual',
      nombre_tecleado: NOMBRE_TUTOR,
      firma_imagen: TRAZO,
      personas: [{ nombre: 'Persona Quitada', dni: '12345678Z' }],
    })
    expect(creada.success, JSON.stringify(creada)).toBe(true)
    if (!creada.success) return
    const autorizacionId = creada.data.autorizacion_id

    // Control: antes de revocar, la profe la ve autorizada y la firma está vigente.
    sesion.actual = cProfe
    const antes = await getAutorizacionDetalle(autorizacionId)
    expect(antes?.personas_vigentes?.map((p) => p.nombre)).toEqual(['Persona Quitada'])
    expect(antes?.roster.find((r) => r.nino_id === nino.id)?.estado).toBe('firmado')

    // 2. La familia revoca su firma.
    sesion.actual = cTutor
    const revocada = await revocarFirma({ autorizacion_id: autorizacionId, nino_id: nino.id })
    expect(revocada.success, JSON.stringify(revocada)).toBe(true)

    // Premisa: la última decisión de la tutora es la revocación.
    const { data: ultima } = await serviceClient
      .from('firmas_autorizacion')
      .select('decision')
      .eq('autorizacion_id', autorizacionId)
      .eq('firmante_id', tutor.id)
      .order('firmado_at', { ascending: false })
      .limit(1)
      .single()
    expect(ultima?.decision).toBe('revocado')

    // 3. Lo que ve la profe.
    sesion.actual = cProfe
    const despues = await getAutorizacionDetalle(autorizacionId)
    // Lo observado va en el mensaje de los asertos, para leerlo en el log si fallan.
    const observado = JSON.stringify({
      personas_vigentes: despues?.personas_vigentes?.map((p) => p.nombre),
      estado_roster: despues?.roster.find((r) => r.nino_id === nino.id)?.estado,
      estado_documento: despues?.estado,
    })
    expect(despues?.roster.find((r) => r.nino_id === nino.id)?.estado, observado).toBe('revocado')
    expect(despues?.personas_vigentes ?? [], observado).toEqual([])
  })
})
