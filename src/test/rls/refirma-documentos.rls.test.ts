import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  firmarDocumentoNino,
  leerDocumentosNino,
} from '@/features/documentos-centro/lib/firmar-documentos'
import { subirVersionDocumento } from '@/features/documentos-centro/lib/versiones'
import {
  getPendientesCentro,
  getPorFirmarFamilia,
} from '@/features/documentos-centro/queries/get-pendientes-firma'
import type { Database } from '@/types/database'

import {
  borrarDocumentosDe,
  comoPostgres,
  creaDocumento,
  subeVersion,
} from './documentos-centro-fixture'
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
 * La refirma (fase 4, 4d; `20270111120000`). Decidido (J4): una versión nueva no pide volver a firmar
 * sola; la admin lo PIDE al subirla. Lo que tiene que aguantar, con las funciones de la app contra la
 * base del CI:
 *
 *  - sin pedirlo, la firma de antes sigue valiendo (J4);
 *  - pidiéndolo, quien firmó una anterior vuelve a «por firmar», con su firma de antes a la vista y
 *    desde la subida de la versión que lo pidió, y sale donde sale lo pendiente (4c);
 *  - quien nunca firmó cuenta desde la primera versión, no desde la que lo pidió;
 *  - se firma la vigente, no la que se firmó antes ni una intermedia;
 *  - en la primera versión no se puede pedir.
 *
 * Fixtures ficticios, del 2026-11-07.
 */
describe('Volver a firmar un documento del centro (4d)', () => {
  let centro: TestCentro
  let admin: TestUser
  let madre: TestUser
  let lucia: string
  let pablo: string
  let normas: string
  let v1: string
  let v2: string
  let v3: string
  let firmaV1: string
  const sesiones = new Map<string, Cliente>()
  const como = async (u: TestUser): Promise<Cliente> => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  const firma = async (version: string) =>
    firmarDocumentoNino(
      await como(madre),
      madre.id,
      {
        ninoId: lucia,
        versionId: version,
        nombreTecleado: 'Madre Demo',
        firmaImagen: 'data:image/png;base64,AAAA',
      },
      { ip: '203.0.113.11', userAgent: 'ensayo 4d' }
    )
  const normasDe = async (nino: string) => {
    const r = await leerDocumentosNino(await como(admin), nino)
    if (!r.ok) throw new Error(r.error)
    return r.data.find((d) => d.documento_id === normas)!
  }
  const subidaDe = (version: string) =>
    comoPostgres(
      `SELECT to_char(subida_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') FROM public.documentos_centro_versiones WHERE id = '${version}'`
    )
  const mismoInstante = (a: string | null, b: string) =>
    a !== null && Date.parse(a) === Date.parse(`${b}Z`)

  beforeAll(async () => {
    centro = await createTestCentro('Centro Refirma')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    admin = await createTestUser({ nombre: 'Admin Refirma' })
    madre = await createTestUser({ nombre: 'Madre Refirma' })
    await asignarRol(admin.id, centro.id, 'admin')
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    const aula = await createTestAula(centro.id, curso)
    await matricular(lucia, aula.id, curso)
    await matricular(pablo, aula.id, curso)
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    normas = await creaDocumento(await como(admin), centro.id, 'Normas')
    v1 = await subeVersion(await como(admin), centro.id, normas, null, 'normas v1 4d')
    const r = await firma(v1)
    if (!r.ok) throw new Error(`firmar v1: ${r.error}`)
    firmaV1 = r.data.firmaId
  })

  afterAll(async () => {
    if (centro) await borrarDocumentosDe(centro.id)
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [admin, madre]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: Lucía tiene firmada la v1, y Pablo, por firmar desde la v1', async () => {
    expect(await normasDe(lucia)).toMatchObject({
      estado: 'firmado',
      version_id: v1,
      firma_id: firmaV1,
    })
    const p = await normasDe(pablo)
    expect(p).toMatchObject({ estado: 'por_firmar', version_id: v1, firma_id: null })
    expect(p.disponible_desde).not.toBeNull()
  })

  it('J4: una versión corregida subida sin pedirlo no toca la firma de antes', async () => {
    v2 = await subeVersion(await como(admin), centro.id, normas, null, 'normas v2 4d')
    expect(await normasDe(lucia)).toMatchObject({
      estado: 'firmado',
      version_id: v1,
      firma_id: firmaV1,
    })
    expect(
      await getPorFirmarFamilia(
        await como(madre),
        [{ id: lucia, nombre: 'Lucía', apellidos: null, tipoVinculo: 'tutor_legal_principal' }],
        []
      )
    ).toEqual([])
  })

  it('pidiéndolo, Lucía vuelve a «por firmar» la v3, con su firma de antes y desde la subida de la v3', async () => {
    v3 = await subeVersion(await como(admin), centro.id, normas, null, 'normas v3 4d', true)
    const l = await normasDe(lucia)
    expect(l).toMatchObject({ estado: 'por_firmar', version_id: v3, numero: 3, firma_id: firmaV1 })
    expect(mismoInstante(l.disponible_desde, subidaDe(v3))).toBe(true)
  })

  it('quien nunca firmó cuenta desde la primera versión, no desde la que pidió volver a firmar', async () => {
    const p = await normasDe(pablo)
    expect(p).toMatchObject({ estado: 'por_firmar', version_id: v3, firma_id: null })
    // Premisa: tiene fecha; lo que se mide es que no es la de la v3.
    expect(p.disponible_desde).not.toBeNull()
    expect(mismoInstante(p.disponible_desde, subidaDe(v3))).toBe(false)
  })

  it('sale donde sale lo pendiente: el inicio de la familia y el de Dirección', async () => {
    expect(
      await getPorFirmarFamilia(
        await como(madre),
        [{ id: lucia, nombre: 'Lucía', apellidos: null, tipoVinculo: 'tutor_legal_principal' }],
        []
      )
    ).toEqual([{ ninoId: lucia, nombre: 'Lucía', n: 1 }])
    const d = await getPendientesCentro(await como(admin), centro.id)
    if (!d.ok) throw new Error(d.error)
    expect(d.data.porFirmar.map((g) => g.ninos.map((n) => n.ninoId).sort())).toEqual([
      [lucia, pablo].sort(),
    ])
  })

  it('la lista de la admin dice qué versión lo pidió', async () => {
    const { data, error } = await (
      await como(admin)
    ).rpc('documentos_centro_admin', { p_centro_id: centro.id })
    expect(error).toBeNull()
    const doc = (
      data as { documentos: { id: string; versiones: { id: string; pide_refirma: boolean }[] }[] }
    ).documentos.find((x) => x.id === normas)!
    expect(Object.fromEntries(doc.versiones.map((x) => [x.id, x.pide_refirma]))).toEqual({
      [v1]: false,
      [v2]: false,
      [v3]: true,
    })
  })

  it('se firma la vigente: ni la v1 ni la v2; la v3 sí, y deja de deberlo', async () => {
    for (const v of [v1, v2])
      expect(await firma(v)).toEqual({
        ok: false,
        error: 'firmar_documentos.errors.version_no_vigente',
      })
    expect(await firma(v3)).toMatchObject({ ok: true, data: { metodo: 'digital' } })
    expect(await normasDe(lucia)).toMatchObject({ estado: 'firmado', version_id: v3 })
  })

  it('en la primera versión de un documento no se puede pedir, y no queda nada subido', async () => {
    const nuevo = await creaDocumento(await como(admin), centro.id, 'Presupuesto', { orden: 2 })
    const r = await subirVersionDocumento(await como(admin), serviceClient, {
      centroId: centro.id,
      documentoId: nuevo,
      cursoId: null,
      bytes: new TextEncoder().encode('%PDF-1.4\n% primera 4d\n%%EOF\n'),
      pideRefirma: true,
    })
    expect(r).toEqual({ ok: false, error: 'documentos_centro.errors.sin_version_anterior' })
    expect(
      comoPostgres(
        `SELECT count(*) FROM public.documentos_centro_versiones WHERE documento_id = '${nuevo}'`
      )
    ).toBe('0')
    const { data: ficheros } = await serviceClient.storage
      .from('documentos-centro')
      .list(`${centro.id}/${nuevo}`)
    expect(ficheros ?? []).toEqual([])
  })
})
