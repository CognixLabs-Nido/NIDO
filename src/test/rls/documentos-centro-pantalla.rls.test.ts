import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

vi.mock('server-only', () => ({}))

/** La sesión con la que corren la consulta y las acciones de la pantalla: la de quien se pruebe. */
let sesionActual: SupabaseClient<Database> | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesionActual) throw new Error('el test no ha fijado la sesión')
    return sesionActual
  },
}))

const { enlaceVersionDocumento, subirVersionDocumento } =
  await import('@/features/documentos-centro/lib/versiones')
const { getDocumentosAdmin } =
  await import('@/features/documentos-centro/queries/get-documentos-admin')
const { crearDocumentoAccion, editarDocumentoAccion } =
  await import('@/features/documentos-centro/actions/documentos')

const BUCKET = 'documentos-centro'
const E = 'documentos_centro.errors'

function pdf(texto: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Ensayo NIDO 1c: ${texto}\n%%EOF\n`)
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Como `postgres`, por psql contra la BD efímera del CI, como en los tests del 1a y del 1b. */
function comoPostgres(sql: string): { ok: boolean; salida: string } {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  try {
    const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, salida: salida.trim() }
  } catch (e) {
    return { ok: false, salida: String((e as { stderr?: string }).stderr ?? e) }
  }
}

/**
 * La pantalla de la admin (1c), contra la BD y el Storage del CI: lo que la pantalla lee y lo que
 * hacen sus acciones nuevas, con la sesión de cada persona. Fixtures ficticios, del 2026-11-05.
 */
describe('La pantalla de los documentos del centro', () => {
  let centro: TestCentro
  let otroCentro: TestCentro
  let admin: TestUser
  let directora: TestUser
  let adminOtro: TestUser
  let madre: TestUser
  let curso: string
  let presupuesto: string
  let firmada: string
  let sinFirmas: string
  const vFirmada = pdf('presupuesto firmado')
  const vSinFirmas = pdf('presupuesto corregido sin firmas')

  beforeAll(async () => {
    centro = await createTestCentro('Centro Pantalla Documentos')
    otroCentro = await createTestCentro('Otro Centro Pantalla Documentos')
    curso = (await createTestCurso(centro.id, 'activo')).id
    admin = await createTestUser({ nombre: 'Admin Pantalla Documentos' })
    directora = await createTestUser({ nombre: 'Directora Pantalla Documentos' })
    adminOtro = await createTestUser({ nombre: 'Admin Otro Pantalla Documentos' })
    madre = await createTestUser({ nombre: 'Madre Pantalla Documentos' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(adminOtro.id, otroCentro.id, 'admin')

    const sesion = await clientFor(admin)
    const { data, error } = await sesion.rpc('crear_documento_centro', {
      p_centro_id: centro.id,
      p_titulo: 'Presupuesto pantalla',
      p_de_curso: true,
      p_obligatorio: true,
      p_orden: 1,
    })
    expect(error).toBeNull()
    presupuesto = data!
    const a = await subirVersionDocumento(sesion, serviceClient, {
      centroId: centro.id,
      documentoId: presupuesto,
      cursoId: curso,
      bytes: vFirmada,
    })
    const b = await subirVersionDocumento(sesion, serviceClient, {
      centroId: centro.id,
      documentoId: presupuesto,
      cursoId: curso,
      bytes: vSinFirmas,
    })
    if (!a.ok || !b.ok) throw new Error('no se pudieron subir las dos versiones del ensayo')
    firmada = a.data.versionId
    sinFirmas = b.data.versionId
    // Una firma en la primera, como postgres: nadie firma con sesión hasta el paso 2.
    const lucia = (await createTestNino(centro.id, 'Lucía')).id
    const f = comoPostgres(`INSERT INTO public.firmas_documentos_centro
        (version_id, documento_id, centro_id, titulo, numero, sha256, nino_id, firmante_id,
         rol_firmante, metodo_firma, nombre_tecleado, firma_imagen)
      VALUES ('${firmada}', gen_random_uuid(), gen_random_uuid(), 'x', 1, repeat('0', 64),
              '${lucia}', '${madre.id}', 'tutor_legal_principal', 'digital', 'Madre Ensayo',
              'data:image/png;base64,AAAA');`)
    if (!f.ok) throw new Error(`no se pudo firmar: ${f.salida}`)
  })

  afterAll(async () => {
    sesionActual = null
    for (const c of [centro, otroCentro]) {
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
      for (const k of carpetas ?? []) {
        const { data } = await serviceClient.storage.from(BUCKET).list(`${c.id}/${k.name}`)
        const rutas = (data ?? []).map((x) => `${c.id}/${k.name}/${x.name}`)
        if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
      }
      await deleteTestCentro(c.id)
    }
    for (const u of [admin, directora, adminOtro, madre]) if (u) await deleteTestUser(u.id)
  })

  it('la admin ve sus documentos, sus cursos y cuántas firmas tiene cada versión', async () => {
    sesionActual = await clientFor(admin)
    const p = await getDocumentosAdmin(centro.id)
    expect(p).not.toBeNull()
    const doc = p!.lista.documentos.find((d) => d.id === presupuesto)
    // Premisa: las dos versiones están en la lista, del mismo curso, y la vigente es la 2.
    expect(doc?.versiones.map((v) => [v.numero, v.vigente]).sort()).toEqual([
      [1, false],
      [2, true],
    ])
    expect(p!.cursos.map((c) => c.id)).toEqual([curso])
    // La firmada cuenta 1 y la otra no sale (0): de esto depende ofrecer «borrar».
    expect(p!.firmas).toEqual({ [firmada]: 1 })
  })

  it('a la directora la base no le da la lista, y la pantalla no sale vacía: no sale', async () => {
    sesionActual = await clientFor(directora)
    // Premisa: es Dirección del centro (lee las firmas), pero no la admin.
    const { count, error } = await sesionActual
      .from('firmas_documentos_centro')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centro.id)
    expect(error).toBeNull()
    expect(count).toBe(1)
    expect(await getDocumentosAdmin(centro.id)).toBeNull()
  })

  it('el PDF de una versión: la admin recibe el enlace, y es ese fichero', async () => {
    const r = await enlaceVersionDocumento(
      await clientFor(admin),
      serviceClient,
      centro.id,
      firmada
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const res = await fetch(r.data.url)
    expect(res.status).toBe(200)
    expect(sha(new Uint8Array(await res.arrayBuffer()))).toBe(sha(vFirmada))
  })

  it('nadie más recibe el enlace: ni la directora, ni la admin de otro centro', async () => {
    // Premisa: con la admin, las dos versiones dan enlace (si no, los «no» de abajo no dicen nada).
    for (const v of [firmada, sinFirmas])
      expect
        .soft(
          (await enlaceVersionDocumento(await clientFor(admin), serviceClient, centro.id, v)).ok
        )
        .toBe(true)
    const casos: [string, TestUser, string][] = [
      ['la directora, con su centro', directora, centro.id],
      ['la admin de otro centro, con el centro de la versión', adminOtro, centro.id],
      ['la admin de otro centro, con su propio centro', adminOtro, otroCentro.id],
    ]
    for (const [nombre, u, c] of casos)
      expect
        .soft(await enlaceVersionDocumento(await clientFor(u), serviceClient, c, firmada), nombre)
        .toEqual({ ok: false, error: `${E}.no_autorizado` })
  })

  it('crear un documento con un título que ya está: lo dice, y no hay otro', async () => {
    sesionActual = await clientFor(admin)
    const r = await crearDocumentoAccion({
      centroId: centro.id,
      titulo: '  presupuesto PANTALLA ',
      deCurso: false,
      obligatorio: true,
      orden: 2,
    })
    expect(r).toEqual({ success: false, error: `${E}.titulo_repetido` })
    const p = await getDocumentosAdmin(centro.id)
    expect(p!.lista.documentos.map((d) => d.id)).toEqual([presupuesto])
  })

  it('«de curso» no cambia en un documento con versiones (J6), y lo demás sí', async () => {
    sesionActual = await clientFor(admin)
    expect(await editarDocumentoAccion({ documentoId: presupuesto, deCurso: false })).toEqual({
      success: false,
      error: `${E}.de_curso_fijo`,
    })
    // Control: el mismo documento sí cambia de orden, y sigue siendo de curso.
    expect(await editarDocumentoAccion({ documentoId: presupuesto, orden: 7 })).toEqual({
      success: true,
      data: undefined,
    })
    const doc = (await getDocumentosAdmin(centro.id))!.lista.documentos.find(
      (d) => d.id === presupuesto
    )
    expect([doc?.de_curso, doc?.orden]).toEqual([true, 7])
  })

  it('la directora no crea ni edita documentos (J1)', async () => {
    sesionActual = await clientFor(directora)
    expect
      .soft(
        await crearDocumentoAccion({
          centroId: centro.id,
          titulo: 'Normas de la directora',
          deCurso: false,
          obligatorio: true,
          orden: 3,
        })
      )
      .toEqual({ success: false, error: `${E}.no_autorizado` })
    expect
      .soft(await editarDocumentoAccion({ documentoId: presupuesto, retirado: true }))
      .toEqual({ success: false, error: `${E}.no_autorizado` })
    sesionActual = await clientFor(admin)
    const doc = (await getDocumentosAdmin(centro.id))!.lista.documentos
    expect(doc.map((d) => [d.id, d.retirado_at])).toEqual([[presupuesto, null]])
  })
})
