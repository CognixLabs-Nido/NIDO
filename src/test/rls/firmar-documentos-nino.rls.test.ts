import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

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

vi.mock('server-only', () => ({}))

const { subirVersionDocumento } = await import('@/features/documentos-centro/lib/versiones')
const { enlaceDocumentoNino, firmarDocumentoNino, leerDocumentosNino, modoFirmaDocumento } =
  await import('@/features/documentos-centro/lib/firmar-documentos')

const BUCKET = 'documentos-centro'
type Cliente = SupabaseClient<Database>
const TRAZO = 'data:image/png;base64,AAAA'
interface Ctx {
  ip: string | null
  userAgent: string | null
}
const CTX: Ctx = { ip: '203.0.113.7', userAgent: 'ensayo 4b-1' }
const SIN_CTX: Ctx = { ip: null, userAgent: null }

function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO 4b-1: ${texto}\n%%EOF\n`)
}

function comoPostgres(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

/**
 * Firmar los documentos del centro desde el alta (fase 4, 4b-1), con las funciones de la app contra
 * la BD y el Storage del CI: el servidor decide cómo se firma (con vínculo, con el dedo; sin él y de
 * Dirección, en persona; nunca el navegador), el superusuario no registra en persona, con el dedo
 * hace falta el trazo, basta una firma por niño (J3), una versión nueva deja la vieja sin firmar, y el
 * PDF solo se abre de lo que al niño le toca. Fixtures ficticios, del 2026-11-06.
 */
describe('Firmar los documentos del centro en el alta', () => {
  let centro: TestCentro
  let fuera: TestCentro
  let admin: TestUser
  let superU: TestUser
  let profe: TestUser
  let madre: TestUser
  let padre: TestUser
  let otraMadre: TestUser
  let lucia: string
  let pablo: string
  let ajeno: string
  let normas: string
  let normas1: string
  let presupuesto1: string
  let ajeno1: string
  let adminFuera: TestUser
  let inigo: string
  let marta: string
  let sinTrazo: string
  let directoraMadre: TestUser
  const sesiones = new Map<string, Cliente>()
  const como = async (u: TestUser): Promise<Cliente> => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }
  const firma = async (
    u: TestUser,
    nino: string,
    version: string,
    firmaImagen: string | null = TRAZO,
    ctx = CTX
  ) =>
    firmarDocumentoNino(
      await como(u),
      u.id,
      { ninoId: nino, versionId: version, nombreTecleado: ' Firma Demo ', firmaImagen },
      ctx
    )
  const fila = (id: string) =>
    comoPostgres(
      `SELECT metodo_firma || '|' || rol_firmante || '|' || (firma_imagen IS NULL)::text || '|' || coalesce(host(ip_address), '-') || '|' || coalesce(user_agent, '-') || '|' || nombre_tecleado FROM public.firmas_documentos_centro WHERE id = '${id}'`
    )
  const firmasDe = (nino: string) =>
    Number(
      comoPostgres(`SELECT count(*) FROM public.firmas_documentos_centro WHERE nino_id = '${nino}'`)
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro Firmar en el Alta')
    fuera = await createTestCentro('Otro Centro Firmar en el Alta')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    const cursoFuera = (await createTestCurso(fuera.id, 'activo')).id
    admin = await createTestUser({ nombre: 'Admin Firmar Alta' })
    superU = await createTestUser({ nombre: 'Superusuario Firmar Alta' })
    profe = await createTestUser({ nombre: 'Profe Firmar Alta' })
    madre = await createTestUser({ nombre: 'Madre Firmar Alta' })
    padre = await createTestUser({ nombre: 'Padre Firmar Alta' })
    otraMadre = await createTestUser({ nombre: 'Otra Madre Firmar Alta' })
    directoraMadre = await createTestUser({ nombre: 'Directora y Madre Firmar Alta' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(directoraMadre.id, centro.id, 'directora')
    const { error: e } = await serviceClient
      .from('platform_admins')
      .insert({ usuario_id: superU.id })
    if (e) throw new Error(`sembrar superusuario: ${e.message}`)

    // Lucía, con su madre y su padre; Pablo, sin familia con cuenta (lo carga Dirección en papel);
    // Ajeno, de otro centro, hijo de otra madre.
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    ajeno = (await createTestNino(fuera.id, 'Ajeno')).id
    const aula = await createTestAula(centro.id, curso)
    await matricular(lucia, aula.id, curso)
    await matricular(pablo, aula.id, curso)
    inigo = (await createTestNino(centro.id, 'Íñigo')).id
    await matricular(inigo, aula.id, curso)
    // Marta: su madre es directora del centro. Firma como madre, con el dedo.
    marta = (await createTestNino(centro.id, 'Marta')).id
    await matricular(marta, aula.id, curso)
    await crearVinculo(marta, directoraMadre.id, 'tutor_legal_principal')
    // Un niño solo para el control del trazo: si la comprobación faltara, ese control firmaría de
    // verdad, y los tests de Lucía que vienen después medirían otra cosa.
    sinTrazo = (await createTestNino(centro.id, 'Sin Trazo')).id
    await matricular(sinTrazo, aula.id, curso)
    await crearVinculo(sinTrazo, madre.id, 'tutor_legal_principal')
    await matricular(ajeno, (await createTestAula(fuera.id, cursoFuera)).id, cursoFuera)
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    await crearVinculo(lucia, padre.id, 'tutor_legal_secundario')
    await crearVinculo(ajeno, otraMadre.id, 'tutor_legal_principal')

    const crea = async (c: TestCentro, quien: TestUser, titulo: string, deCurso: boolean) => {
      const { data, error } = await (
        await como(quien)
      ).rpc('crear_documento_centro', {
        p_centro_id: c.id,
        p_titulo: titulo,
        p_de_curso: deCurso,
        p_obligatorio: true,
        p_orden: 1,
      })
      if (error || !data) throw new Error(`crear documento: ${error?.message}`)
      return data
    }
    const sube = async (
      c: TestCentro,
      quien: TestUser,
      doc: string,
      cursoId: string | null,
      t: string
    ) => {
      const r = await subirVersionDocumento(await como(quien), serviceClient, {
        centroId: c.id,
        documentoId: doc,
        cursoId,
        bytes: pdf(t),
        pideRefirma: false,
      })
      if (!r.ok) throw new Error(`subir: ${r.error}`)
      return r.data.versionId
    }
    normas = await crea(centro, admin, 'Normas', false)
    const presupuesto = await crea(centro, admin, 'Presupuesto', true)
    await crea(centro, admin, 'Sin subir', false)
    normas1 = await sube(centro, admin, normas, null, 'normas v1')
    presupuesto1 = await sube(centro, admin, presupuesto, curso, 'presupuesto v1')
    adminFuera = await createTestUser({ nombre: 'Admin Fuera Firmar Alta' })
    await asignarRol(adminFuera.id, fuera.id, 'admin')
    const normasFuera = await crea(fuera, adminFuera, 'Normas de fuera', false)
    ajeno1 = await sube(fuera, adminFuera, normasFuera, null, 'normas de fuera v1')
  })

  afterAll(async () => {
    for (const c of [centro, fuera]) {
      if (!c) continue
      comoPostgres(`DO $$ DECLARE r record; BEGIN
        DELETE FROM public.firmas_documentos_centro WHERE centro_id = '${c.id}';
        FOR r IN SELECT id FROM public.documentos_centro_versiones WHERE centro_id = '${c.id}' LOOP
          PERFORM set_config('app.borrar_version_documento', r.id::text, true);
          DELETE FROM public.documentos_centro_versiones WHERE id = r.id;
        END LOOP;
        DELETE FROM public.documentos_centro WHERE centro_id = '${c.id}';
      END $$;`)
      const { data: carpetas } = await serviceClient.storage.from(BUCKET).list(c.id)
      for (const d of carpetas ?? []) {
        const { data } = await serviceClient.storage.from(BUCKET).list(`${c.id}/${d.name}`)
        const rutas = (data ?? []).map((f) => `${c.id}/${d.name}/${f.name}`)
        if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
      }
    }
    if (superU) await serviceClient.from('platform_admins').delete().eq('usuario_id', superU.id)
    if (centro) await deleteTestCentro(centro.id)
    if (fuera) await deleteTestCentro(fuera.id)
    for (const u of [admin, superU, profe, madre, padre, otraMadre, adminFuera, directoraMadre])
      if (u) await deleteTestUser(u.id)
  })

  it('premisa: lo que le toca a Lucía, con sus tres estados, y quién es quién', async () => {
    const r = await leerDocumentosNino(await como(madre), lucia)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.map((d) => `${d.titulo}=${d.estado}`).sort()).toEqual([
      'Normas=por_firmar',
      'Presupuesto=por_firmar',
      'Sin subir=falta_documento',
    ])
    expect(firmasDe(lucia)).toBe(0)
    expect(firmasDe(pablo)).toBe(0)
    const { data: esSuper } = await (await como(superU)).rpc('is_superadmin')
    expect(esSuper).toBe(true)
  })

  it('el modo lo decide el servidor: con vínculo, con el dedo; Dirección sin vínculo, en persona; la profe, nada', async () => {
    expect(await modoFirmaDocumento(await como(madre), lucia, madre.id)).toBe('digital')
    expect(await modoFirmaDocumento(await como(admin), lucia, admin.id)).toBe('presencial')
    expect(await modoFirmaDocumento(await como(profe), lucia, profe.id)).toBeNull()
    expect(await modoFirmaDocumento(await como(otraMadre), lucia, otraMadre.id)).toBeNull()
  })

  it('la directora que es madre de Marta firma como madre: con el dedo, no en persona (el vínculo va primero)', async () => {
    const { data: esDireccion } = await (
      await como(directoraMadre)
    ).rpc('es_admin', { p_centro_id: centro.id })
    expect(esDireccion).toBe(true)
    expect(await modoFirmaDocumento(await como(directoraMadre), marta, directoraMadre.id)).toBe(
      'digital'
    )
    const r = await firma(directoraMadre, marta, normas1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(fila(r.data.firmaId)).toBe(
      'digital|tutor_legal_principal|false|203.0.113.7|ensayo 4b-1|Firma Demo'
    )
  })

  it('con el dedo sin trazo: no se firma nada', async () => {
    expect(await firma(madre, sinTrazo, normas1, null)).toEqual({
      ok: false,
      error: 'firmar_documentos.errors.sin_trazo',
    })
    expect(firmasDe(sinTrazo)).toBe(0)
  })

  it('la madre firma con el dedo: su firma, digital, con su trazo, su IP y su navegador', async () => {
    const r = await firma(madre, lucia, normas1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.metodo).toBe('digital')
    expect(fila(r.data.firmaId)).toBe(
      'digital|tutor_legal_principal|false|203.0.113.7|ensayo 4b-1|Firma Demo'
    )
  })

  it('J3: el padre llega después y ya está firmado; no hay una segunda firma', async () => {
    expect(await firma(padre, lucia, normas1)).toEqual({
      ok: false,
      error: 'firmar_documentos.errors.ya_firmado',
    })
    expect(firmasDe(lucia)).toBe(1)
  })

  it('Dirección, en el modo Dirección: en persona, rol admin y SIN trazo aunque el navegador mande uno, también sin IP ni navegador', async () => {
    const r = await firma(admin, pablo, normas1, TRAZO, SIN_CTX)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.metodo).toBe('presencial')
    expect(fila(r.data.firmaId)).toBe('presencial|admin|true|-|-|Firma Demo')
  })

  it('el superusuario no registra en persona: ni la app ni la base, y no queda nada', async () => {
    expect(await modoFirmaDocumento(await como(superU), pablo, superU.id)).toBe('presencial')
    const antes = firmasDe(pablo)
    expect(await firma(superU, pablo, presupuesto1)).toEqual({
      ok: false,
      error: 'firmar_documentos.errors.presencial_solo_direccion',
    })
    expect(firmasDe(pablo)).toBe(antes)
  })

  it('quien no es de la familia ni de Dirección no firma: la profe y la madre de otro niño', async () => {
    for (const u of [profe, otraMadre]) {
      expect(await firma(u, lucia, presupuesto1)).toEqual({
        ok: false,
        error: 'firmar_documentos.errors.no_autorizado',
      })
    }
    expect(firmasDe(lucia)).toBe(1)
  })

  it('una versión nueva: la vieja ya no se firma (version_no_vigente) y la nueva sí; lo firmado con la vieja sigue firmado (J4)', async () => {
    expect(firmasDe(inigo)).toBe(0)
    const r = await subirVersionDocumento(await como(admin), serviceClient, {
      centroId: centro.id,
      documentoId: normas,
      cursoId: null,
      bytes: pdf('normas v2'),
      pideRefirma: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await firma(admin, inigo, normas1)).toEqual({
      ok: false,
      error: 'firmar_documentos.errors.version_no_vigente',
    })
    expect(firmasDe(inigo)).toBe(0)
    expect((await firma(admin, inigo, r.data.versionId)).ok).toBe(true)
    const pab = await leerDocumentosNino(await como(admin), pablo)
    expect(pab.ok && pab.data.find((d) => d.titulo === 'Normas')?.estado).toBe('firmado')
  })

  it('el PDF: la madre abre el de Lucía (control positivo: es ese PDF); el de otro centro, no', async () => {
    const ok = await enlaceDocumentoNino(await como(madre), serviceClient, lucia, presupuesto1)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    const bytes = new Uint8Array(await (await fetch(ok.data.url)).arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      createHash('sha256').update(pdf('presupuesto v1')).digest('hex')
    )
    // La versión de otro centro, ni con su niño ni con Lucía; y la otra madre, no el de Lucía.
    for (const [u, nino, version] of [
      [madre, lucia, ajeno1],
      [madre, ajeno, ajeno1],
      [otraMadre, lucia, presupuesto1],
      [profe, lucia, presupuesto1],
    ] as const) {
      expect(await enlaceDocumentoNino(await como(u), serviceClient, nino, version)).toEqual({
        ok: false,
        error: 'firmar_documentos.errors.no_autorizado',
      })
    }
  })
})
