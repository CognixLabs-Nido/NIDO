import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { HijoEnCentro } from '@/features/centros/contexto/ambito-familiar'
import { firmarDocumentoNino } from '@/features/documentos-centro/lib/firmar-documentos'
import {
  getPendientesCentro,
  getPorFirmarFamilia,
} from '@/features/documentos-centro/queries/get-pendientes-firma'
import type { Database } from '@/types/database'

import { borrarDocumentosDe, creaDocumento, subeVersion } from './documentos-centro-fixture'
import {
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
  type TestCentro,
  type TestUser,
} from './setup'

type Cliente = SupabaseClient<Database>

/**
 * Firmar fuera del alta y lo pendiente en los inicios (fase 4, 4c), con las lecturas de la app
 * contra la base del CI. Lo que tiene que aguantar:
 *
 *  - una familia con el alta ya validada ve lo que debe y lo firma (sin esto, una familia que se
 *    matricula hoy no firma nunca y nadie se entera);
 *  - lo que se le reclama es lo obligatorio por firmar: ni lo opcional ni lo que el centro no ha
 *    subido;
 *  - la Dirección lo ve en su inicio, por documento y con desde cuándo, y lo sin subir aparte
 *    («no existía» no es «no ha firmado»);
 *  - el autorizado no lee: no se le pregunta, y por eso no sale como lectura fallida.
 *
 * Fixtures ficticios, del 2026-11-07.
 */
describe('Firmar fuera del alta y lo pendiente en los inicios (4c)', () => {
  let centro: TestCentro
  let fuera: TestCentro
  let admin: TestUser
  let directora: TestUser
  let adminFuera: TestUser
  let madre: TestUser
  let autorizada: TestUser
  let lucia: string
  let pablo: string
  let normas1: string
  const sesiones = new Map<string, Cliente>()
  const como = async (u: TestUser): Promise<Cliente> => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  const hijo = (id: string, tipo: HijoEnCentro['tipoVinculo']): HijoEnCentro => ({
    id,
    nombre: 'Lucía',
    apellidos: null,
    tipoVinculo: tipo,
  })

  beforeAll(async () => {
    centro = await createTestCentro('Centro Firmar Fuera del Alta')
    fuera = await createTestCentro('Otro Centro Firmar Fuera del Alta')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    admin = await createTestUser({ nombre: 'Admin Fuera del Alta' })
    directora = await createTestUser({ nombre: 'Directora Fuera del Alta' })
    adminFuera = await createTestUser({ nombre: 'Admin Otro Centro Fuera del Alta' })
    madre = await createTestUser({ nombre: 'Madre Fuera del Alta' })
    autorizada = await createTestUser({ nombre: 'Autorizada Fuera del Alta' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(adminFuera.id, fuera.id, 'admin')

    // Lucía y Pablo, con la matrícula activa: el alta ya está validada.
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    const aula = await createTestAula(centro.id, curso)
    await matricular(lucia, aula.id, curso)
    await matricular(pablo, aula.id, curso)
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    await crearVinculo(lucia, autorizada.id, 'autorizado')

    // Normas: obligatorio y subido. Presupuesto: obligatorio, de curso, sin subir. Excursiones:
    // opcional y subido.
    const sesionAdmin = await como(admin)
    const normas = await creaDocumento(sesionAdmin, centro.id, 'Normas')
    await creaDocumento(sesionAdmin, centro.id, 'Presupuesto', {
      deCurso: true,
      orden: 2,
    })
    const excursiones = await creaDocumento(sesionAdmin, centro.id, 'Excursiones', {
      obligatorio: false,
      orden: 3,
    })
    normas1 = await subeVersion(sesionAdmin, centro.id, normas, null, 'normas v1 4c')
    await subeVersion(sesionAdmin, centro.id, excursiones, null, 'excursiones v1 4c')
  })

  afterAll(async () => {
    if (centro) await borrarDocumentosDe(centro.id)
    if (centro) await deleteTestCentro(centro.id)
    if (fuera) await deleteTestCentro(fuera.id)
    for (const u of [admin, directora, adminFuera, madre, autorizada])
      if (u) await deleteTestUser(u.id)
  })

  it('premisa: las dos altas están validadas (matrícula activa), no en curso', async () => {
    const { data } = await serviceClient
      .from('matriculas')
      .select('nino_id, estado')
      .in('nino_id', [lucia, pablo])
    expect((data ?? []).map((m) => m.estado).sort()).toEqual(['activa', 'activa'])
  })

  it('la familia ve lo que debe: el obligatorio subido, ni el opcional ni el que no existe', async () => {
    expect(
      await getPorFirmarFamilia(await como(madre), [hijo(lucia, 'tutor_legal_principal')], [])
    ).toEqual([{ ninoId: lucia, nombre: 'Lucía', n: 1 }])
  })

  it('con el alta en curso no se le pregunta: el alta ya se lo pide', async () => {
    expect(
      await getPorFirmarFamilia(await como(madre), [hijo(lucia, 'tutor_legal_principal')], [lucia])
    ).toEqual([])
  })

  it('el autorizado no lee, y no se le pregunta: no sale como lectura fallida', async () => {
    // Control: preguntado, la base le contesta 42501, que la pantalla diría «no hemos podido».
    const { error } = await (
      await como(autorizada)
    ).rpc('documentos_firma_nino', { p_nino_id: lucia })
    expect(error?.code).toBe('42501')
    expect(
      await getPorFirmarFamilia(await como(autorizada), [hijo(lucia, 'autorizado')], [])
    ).toEqual([])
  })

  it('una lectura que falla sale como fallo, no desaparece: callar diría «nada que firmar»', async () => {
    // La madre no es nada de Pablo: la base le contesta 42501. La lista no puede perderlo.
    const r = await getPorFirmarFamilia(
      await como(madre),
      [{ ...hijo(pablo, 'tutor_legal_principal'), nombre: 'Pablo' }],
      []
    )
    expect(r).toEqual([{ ninoId: pablo, nombre: 'Pablo', n: null }])
  })

  it('la Dirección ve en su inicio lo por firmar, con desde cuándo, y lo sin subir aparte', async () => {
    for (const u of [admin, directora]) {
      const r = await getPendientesCentro(await como(u), centro.id)
      if (!r.ok) throw new Error(`${u.id}: ${r.error}`)
      expect(r.data.porFirmar.map((g) => [g.titulo, g.ninos.map((n) => n.ninoId).sort()])).toEqual([
        ['Normas', [lucia, pablo].sort()],
      ])
      for (const n of r.data.porFirmar[0]!.ninos) {
        expect(n.nombre).toMatch(/^(Lucía|Pablo) /)
        expect(Number.isNaN(Date.parse(n.desde))).toBe(false)
      }
      expect(r.data.sinSubir.map((g) => [g.titulo, g.ninos])).toEqual([['Presupuesto', 2]])
    }
  })

  it('la Dirección de otro centro no lo lee: la lectura falla y se devuelve como fallo', async () => {
    expect(await getPendientesCentro(await como(adminFuera), centro.id)).toEqual({
      ok: false,
      error: 'firmar_documentos.errors.leer',
    })
  })

  it('la madre firma fuera del alta, y deja de deberlo en los dos inicios', async () => {
    const r = await firmarDocumentoNino(
      await como(madre),
      madre.id,
      {
        ninoId: lucia,
        versionId: normas1,
        nombreTecleado: 'Madre Demo',
        firmaImagen: 'data:image/png;base64,AAAA',
      },
      { ip: '203.0.113.9', userAgent: 'ensayo 4c' }
    )
    expect(r).toMatchObject({ ok: true, data: { metodo: 'digital' } })
    expect(
      await getPorFirmarFamilia(await como(madre), [hijo(lucia, 'tutor_legal_principal')], [])
    ).toEqual([])
    const p = await getPendientesCentro(await como(admin), centro.id)
    if (!p.ok) throw new Error(p.error)
    expect(p.data.porFirmar.map((g) => g.ninos.map((n) => n.ninoId))).toEqual([[pablo]])
  })

  it('la admin registra en papel la de Pablo; lo sin subir sigue ahí, que no es de la familia', async () => {
    const r = await firmarDocumentoNino(
      await como(admin),
      admin.id,
      { ninoId: pablo, versionId: normas1, nombreTecleado: 'Padre de Pablo', firmaImagen: null },
      { ip: null, userAgent: null }
    )
    expect(r).toMatchObject({ ok: true, data: { metodo: 'presencial' } })
    const p = await getPendientesCentro(await como(admin), centro.id)
    if (!p.ok) throw new Error(p.error)
    expect(p.data.porFirmar).toEqual([])
    expect(p.data.sinSubir.map((g) => [g.titulo, g.ninos])).toEqual([['Presupuesto', 2]])
  })
})
