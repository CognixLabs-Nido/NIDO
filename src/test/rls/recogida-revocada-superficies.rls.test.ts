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
 * Una firma revocada no puede seguir valiendo en NINGUNA pantalla. Barrido de las
 * superficies que leían «la última firma `firmado`» sin mirar si se revocó después
 * (el detalle de la profe lo cubre `recogida-revocada-profe.rls.test.ts`):
 *
 *  - el aviso del detalle (`estado_firma_nino`), para que no quede un hueco en blanco;
 *  - el prefill de la familia (`getRecogidaContextoFamilia`);
 *  - el listado de recogidas de la profe (`getAutorizacionesAdmin`);
 *  - la medicación: ficha del detalle, listado (`getMedicacionesConActividad`) y
 *    registro de una dosis (`registrarAdministracion`);
 *  - dos tutores: si el titular revoca, la firma del segundo tutor no mantiene la lista.
 *
 * Cada caso empieza por su control (antes de revocar SÍ se ve) y usa las acciones y
 * consultas reales con las sesiones de verdad. Solo se sustituye lo que es de Next.
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
const { crearMedicacion } = await import('@/features/autorizaciones/actions/crear-medicacion')
const { revocarFirma } = await import('@/features/autorizaciones/actions/firmar-autorizacion')
const { registrarAdministracion } =
  await import('@/features/autorizaciones/actions/registrar-administracion')
const { getAutorizacionDetalle } =
  await import('@/features/autorizaciones/queries/get-autorizacion-detalle')
const { getRecogidaContextoFamilia } =
  await import('@/features/autorizaciones/queries/get-recogida-familia')
const { getAutorizacionesAdmin } =
  await import('@/features/autorizaciones/queries/get-autorizaciones-admin')
const { getMedicacionesConActividad } =
  await import('@/features/autorizaciones/queries/get-medicaciones-actividad')

const TRAZO = 'data:image/png;base64,iVBORw0KGgo='
const TITULAR = 'Titular Superficies'
const SEGUNDO = 'Segundo Superficies'
const TEXTO = 'Texto de prueba del formato, definitivo para el test.'

/** Hoy y dentro de 30 días en huso Madrid (la medicación exige hoy ∈ [inicio, fin]). */
function fechasMadrid(): { hoy: string; fin: string } {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
  const ahora = new Date()
  return { hoy: fmt(ahora), fin: fmt(new Date(ahora.getTime() + 30 * 86_400_000)) }
}

describe('Firma revocada — el resto de superficies', () => {
  let centro: { id: string }
  let aula: { id: string }
  let curso: { id: string }
  let admin: TestUser
  let profe: TestUser
  let titular: TestUser
  let segundo: TestUser
  let cProfe: SupabaseClient<Database>
  let cTitular: SupabaseClient<Database>
  let cSegundo: SupabaseClient<Database>

  /** Un niño del aula con el titular (principal) y, si se pide, el segundo tutor. */
  async function ninoConFamilia(conSegundo = false): Promise<string> {
    const nino = await createTestNino(centro.id)
    await matricular(nino.id, aula.id, curso.id)
    await crearVinculo(nino.id, titular.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    if (conSegundo) {
      await crearVinculo(nino.id, segundo.id, 'tutor_legal_secundario', {
        puede_firmar_autorizaciones: true,
      })
    }
    return nino.id
  }

  async function firmarHabitual(
    cliente: SupabaseClient<Database>,
    nombre: string,
    ninoId: string,
    personas: string[]
  ): Promise<string> {
    sesion.actual = cliente
    const r = await crearRecogida({
      nino_id: ninoId,
      modalidad: 'habitual',
      nombre_tecleado: nombre,
      firma_imagen: TRAZO,
      personas: personas.map((p, i) => ({ nombre: p, dni: `1234567${i}Z` })),
    })
    if (!r.success) throw new Error(`crearRecogida: ${JSON.stringify(r)}`)
    return r.data.autorizacion_id
  }

  async function revocar(
    cliente: SupabaseClient<Database>,
    autorizacionId: string,
    ninoId: string
  ): Promise<void> {
    sesion.actual = cliente
    const r = await revocarFirma({ autorizacion_id: autorizacionId, nino_id: ninoId })
    if (!r.success) throw new Error(`revocarFirma: ${JSON.stringify(r)}`)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Firma Revocada')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Firma Revocada')

    admin = await createTestUser({ nombre: 'Admin Superficies' })
    profe = await createTestUser({ nombre: 'Profe Superficies' })
    titular = await createTestUser({ nombre: TITULAR })
    segundo = await createTestUser({ nombre: SEGUNDO })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(titular.id, centro.id, 'tutor_legal')
    await asignarRol(segundo.id, centro.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id, curso.id)

    // Los formatos de recogida y de medicación publicados del centro.
    for (const tipo of ['recogida', 'medicacion'] as const) {
      const { error } = await serviceClient.from('autorizaciones').insert({
        centro_id: centro.id,
        tipo,
        es_plantilla: true,
        titulo: `Formato ${tipo}`,
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      if (error) throw new Error(`plantilla ${tipo}: ${error.message}`)
    }

    cProfe = await clientFor(profe)
    cTitular = await clientFor(titular)
    cSegundo = await clientFor(segundo)
  }, 90_000)

  afterAll(async () => {
    sesion.actual = null
    await deleteTestCentro(centro.id)
    for (const u of [admin, profe, titular, segundo]) await deleteTestUser(u.id)
  }, 90_000)

  it('detalle: tras revocar, avisa de que la familia revocó (no deja el hueco en blanco)', async () => {
    const ninoId = await ninoConFamilia()
    const autId = await firmarHabitual(cTitular, TITULAR, ninoId, ['Persona Aviso'])

    sesion.actual = cProfe
    const antes = await getAutorizacionDetalle(autId)
    expect(antes?.estado_firma_nino).toBe('firmado')

    await revocar(cTitular, autId, ninoId)
    sesion.actual = cProfe
    const despues = await getAutorizacionDetalle(autId)
    expect(despues?.estado_firma_nino).toBe('revocado')
    expect(despues?.personas_vigentes).toEqual([])
    expect(despues?.integridad_ok).toBeNull()
  })

  it('prefill de la familia: una lista revocada no se vuelve a ofrecer rellena', async () => {
    const ninoId = await ninoConFamilia()
    const autId = await firmarHabitual(cTitular, TITULAR, ninoId, ['Persona Prefill'])

    sesion.actual = cTitular
    const antes = await getRecogidaContextoFamilia()
    expect(antes.prefillPorNino[ninoId]?.map((p) => p.nombre)).toEqual(['Persona Prefill'])

    await revocar(cTitular, autId, ninoId)
    sesion.actual = cTitular
    const despues = await getRecogidaContextoFamilia()
    expect(despues.prefillPorNino[ninoId], JSON.stringify(despues.prefillPorNino)).toBeUndefined()
  })

  it('listado de recogidas de la profe: la recogida revocada sale como revocada', async () => {
    const ninoId = await ninoConFamilia()
    const autId = await firmarHabitual(cTitular, TITULAR, ninoId, ['Persona Listado'])

    sesion.actual = cProfe
    const antes = (await getAutorizacionesAdmin()).find((a) => a.id === autId)
    expect(antes?.estado_firma).toBe('firmado')

    await revocar(cTitular, autId, ninoId)
    sesion.actual = cProfe
    const despues = (await getAutorizacionesAdmin()).find((a) => a.id === autId)
    expect(despues?.estado).toBe('publicada') // el documento no cambia…
    expect(despues?.estado_firma).toBe('revocado') // …la firma sí, y se ve
  })

  it('dos tutores: si el titular revoca, la firma del segundo tutor no mantiene la lista', async () => {
    const ninoId = await ninoConFamilia(true)
    const autId = await firmarHabitual(cTitular, TITULAR, ninoId, ['Persona Doble'])
    // El segundo tutor firma la misma habitual (reusa la instancia), después.
    expect(await firmarHabitual(cSegundo, SEGUNDO, ninoId, ['Persona Doble'])).toBe(autId)

    sesion.actual = cProfe
    const antes = await getAutorizacionDetalle(autId)
    expect(antes?.personas_vigentes?.map((p) => p.nombre)).toEqual(['Persona Doble'])

    await revocar(cTitular, autId, ninoId)
    sesion.actual = cProfe
    const despues = await getAutorizacionDetalle(autId)
    const observado = JSON.stringify({
      personas: despues?.personas_vigentes?.map((p) => p.nombre),
      estado: despues?.estado_firma_nino,
    })
    expect(despues?.estado_firma_nino, observado).toBe('revocado')
    expect(despues?.personas_vigentes, observado).toEqual([])
  })

  it('medicación: tras revocar, ni ficha vigente, ni «firmada» en el listado, ni dosis registrable', async () => {
    const ninoId = await ninoConFamilia()
    const { hoy, fin } = fechasMadrid()
    sesion.actual = cTitular
    const creada = await crearMedicacion({
      nino_id: ninoId,
      nombre_tecleado: TITULAR,
      firma_imagen: TRAZO,
      medicacion: {
        medicamento: 'Jarabe de prueba',
        dosis: '5 ml',
        pauta: 'Cada 8 horas',
        fecha_inicio: hoy,
        fecha_fin: fin,
      },
    })
    expect(creada.success, JSON.stringify(creada)).toBe(true)
    if (!creada.success) return
    const autId = creada.data.autorizacion_id

    // Control: firmada, la profe ve la ficha, la ve firmada en el listado y puede registrar.
    sesion.actual = cProfe
    const antes = await getAutorizacionDetalle(autId)
    expect(antes?.medicacion_vigente?.medicamento).toBe('Jarabe de prueba')
    expect((await getMedicacionesConActividad()).find((m) => m.id === autId)?.estadoFirma).toBe(
      'firmado'
    )
    const dosisAntes = await registrarAdministracion({ autorizacion_id: autId })
    expect(dosisAntes.success, JSON.stringify(dosisAntes)).toBe(true)

    await revocar(cTitular, autId, ninoId)

    sesion.actual = cProfe
    const despues = await getAutorizacionDetalle(autId)
    expect(despues?.estado_firma_nino).toBe('revocado')
    expect(despues?.medicacion_vigente, JSON.stringify(despues?.medicacion_vigente)).toBeNull()
    expect((await getMedicacionesConActividad()).find((m) => m.id === autId)?.estadoFirma).toBe(
      'revocado'
    )

    const dosisDespues = await registrarAdministracion({ autorizacion_id: autId })
    expect(dosisDespues.success).toBe(false)
    const { count } = await serviceClient
      .from('administraciones_medicacion')
      .select('id', { count: 'exact', head: true })
      .eq('autorizacion_id', autId)
    expect(count).toBe(1) // solo la de antes de revocar
  })
})
