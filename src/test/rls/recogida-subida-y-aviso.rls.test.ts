import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { PushPayload } from '@/features/push/types'
import type { Database } from '@/types/db'

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
 * La recogida firmada, después de la decisión de Jose del 2026-11-20 (opción B,
 * `docs/specs/altas-serie.md`, «7, DECIDIDO por Jose el 2026-11-20»), con las sesiones de verdad y
 * la API real de Storage:
 *
 *  - **La subida** de la foto del DNI de recogida (`20270202120000`): solo quien puede firmar la
 *    recogida de ese niño (`puede_firmar_autorizaciones`). Ninguna profe, tampoco la del aula; ni
 *    Dirección (ADR-0046: «La dirección NO sube DNIs»); ni el autorizado sin el permiso.
 *  - **La lectura NO cambia, a propósito:** cualquier profe del centro ve la foto («puede que la
 *    profe titular no sea la que entrega a los niños»). Este test lo fija: si alguien la estrecha
 *    tomándola por un agujero, se pone rojo.
 *  - **El aviso al móvil:** firmar una recogida nueva y añadir una persona (volver a firmar la lista)
 *    avisan a la profe del aula y a Dirección, cada una con el enlace a la autorización en su panel;
 *    no a la profe de otra aula ni a quien firmó. Revocar no manda push.
 *
 * Se sustituye solo lo que es de Next o de fuera: el cliente de servidor (la sesión de quien actúa),
 * las cabeceras, la revalidación, las traducciones (con los mensajes reales) y el envío del push,
 * que se captura para mirar a quién va.
 */

const h = vi.hoisted(() => ({
  sesion: null as SupabaseClient<Database> | null,
  push: [] as { ids: string[]; payload: PushPayload }[],
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!h.sesion) throw new Error('test: falta la sesión de quien actúa')
    return h.sesion
  },
}))
vi.mock('@/features/autorizaciones/lib/request-context', () => ({
  getRequestContext: async () => ({ ip: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const es = (await import('@/../messages/es.json')).default
  return {
    getTranslations: async ({ namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale: 'es', messages: es, namespace } as never),
  }
})
vi.mock('@/features/push/lib/enviar-por-idioma', () => ({
  enviarPushPorIdioma: vi.fn(
    async (ids: string[], construir: (i: string) => Promise<PushPayload> | PushPayload) => {
      if (ids.length > 0) h.push.push({ ids, payload: await construir('es') })
      return { enviados: ids.length, expirados: 0, errores: 0, total: ids.length }
    }
  ),
}))

const { crearRecogida } = await import('@/features/autorizaciones/actions/crear-recogida')
const { firmarAutorizacion, revocarFirma } =
  await import('@/features/autorizaciones/actions/firmar-autorizacion')

const TRAZO = 'data:image/png;base64,iVBORw0KGgo='
const NOMBRE_TUTORA = 'Tutora Recogida Aviso'
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const BUCKET = 'recogida-adjuntos'

describe('Recogida: quién sube la foto del DNI, quién la ve y a quién avisa (2026-11-20)', () => {
  let centro: { id: string }
  let nino: { id: string }
  let admin: TestUser
  let profeAula: TestUser
  let profeOtra: TestUser
  let profeSinAula: TestUser
  let tutora: TestUser
  let autorizado: TestUser
  const usuarios: TestUser[] = []
  const ficheros: string[] = []
  let cTutora: SupabaseClient<Database>

  const ruta = () => `${centro.id}/${nino.id}/${randomUUID()}.jpg`
  async function subir(u: TestUser, path: string) {
    const r = await (await clientFor(u)).storage
      .from(BUCKET)
      .upload(path, JPG, { contentType: 'image/jpeg' })
    if (!r.error) ficheros.push(path)
    return r
  }
  const permisoAutorizado = (permisos: Record<string, boolean>) =>
    serviceClient
      .from('vinculos_familiares')
      .update({ permisos })
      .eq('nino_id', nino.id)
      .eq('usuario_id', autorizado.id)

  beforeAll(async () => {
    centro = await createTestCentro('Centro Recogida Aviso')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id, 'Aula Recogida Aviso')
    const otraAula = await createTestAula(centro.id, curso.id, 'Otra Aula Recogida Aviso')

    admin = await createTestUser({ nombre: 'Admin Recogida Aviso' })
    profeAula = await createTestUser({ nombre: 'Profe Aula Recogida Aviso' })
    profeOtra = await createTestUser({ nombre: 'Profe Otra Recogida Aviso' })
    profeSinAula = await createTestUser({ nombre: 'Profe Sin Aula Recogida Aviso' })
    tutora = await createTestUser({ nombre: NOMBRE_TUTORA })
    autorizado = await createTestUser({ nombre: 'Autorizado Recogida Aviso' })
    usuarios.push(admin, profeAula, profeOtra, profeSinAula, tutora, autorizado)
    await asignarRol(admin.id, centro.id, 'admin')
    for (const p of [profeAula, profeOtra, profeSinAula]) await asignarRol(p.id, centro.id, 'profe')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarProfeAula(profeAula.id, aula.id, curso.id)
    await asignarProfeAula(profeOtra.id, otraAula.id, curso.id)

    nino = await createTestNino(centro.id)
    await matricular(nino.id, aula.id, curso.id)
    await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

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
    cTutora = await clientFor(tutora)
  }, 60_000)

  afterAll(async () => {
    h.sesion = null
    if (ficheros.length > 0) await serviceClient.storage.from(BUCKET).remove(ficheros)
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 60_000)

  it('premisa: quién es quién', async () => {
    const pregunta = async (u: TestUser, fn: 'es_profe_de_nino' | 'es_tutor_legal_de') =>
      (await (await clientFor(u)).rpc(fn, { p_nino_id: nino.id })).data
    expect(await pregunta(profeAula, 'es_profe_de_nino')).toBe(true)
    expect(await pregunta(profeOtra, 'es_profe_de_nino')).toBe(false)
    expect(await pregunta(profeSinAula, 'es_profe_de_nino')).toBe(false)
    expect(await pregunta(tutora, 'es_tutor_legal_de')).toBe(true)
    expect(await pregunta(autorizado, 'es_tutor_legal_de')).toBe(false)
    const enCentro = await (
      await clientFor(profeOtra)
    ).rpc('es_profe_en_centro', { p_centro_id: centro.id })
    expect(enCentro.data).toBe(true)
  })

  it('sube solo quien puede firmar la recogida: ni las profes, ni Dirección, ni el autorizado sin permiso', async () => {
    // Control positivo: la tutora, el camino de la app.
    expect((await subir(tutora, ruta())).error).toBeNull()

    for (const u of [profeAula, profeOtra, profeSinAula, admin, autorizado]) {
      const r = await subir(u, ruta())
      expect(r.error?.message, u.email).toMatch(/row-level security/i)
    }

    // El mismo autorizado, con el permiso de firmar autorizaciones, sí sube.
    expect((await permisoAutorizado({ puede_firmar_autorizaciones: true })).error).toBeNull()
    try {
      expect((await subir(autorizado, ruta())).error).toBeNull()
    } finally {
      expect((await permisoAutorizado({})).error).toBeNull()
    }
  })

  it('cualquier profe del centro VE la foto, a propósito (Jose, 2026-11-20); el autorizado, no', async () => {
    const foto = ruta()
    expect((await subir(tutora, foto)).error).toBeNull()
    for (const u of [profeAula, profeOtra, profeSinAula, admin]) {
      const r = await (await clientFor(u)).storage.from(BUCKET).createSignedUrl(foto, 60)
      expect(r.error, u.email).toBeNull()
      expect(r.data?.signedUrl, u.email).toBeTruthy()
    }
    const ajeno = await (await clientFor(autorizado)).storage.from(BUCKET).createSignedUrl(foto, 60)
    expect(ajeno.error).not.toBeNull()
  })

  describe('el aviso al móvil', () => {
    let autorizacionId: string

    const destinos = () =>
      h.push.map((p) => ({ ids: [...p.ids].sort(), url: p.payload.url, cuerpo: p.payload.cuerpo }))
    const esperado = (id: string) =>
      expect.arrayContaining([
        expect.objectContaining({
          ids: [profeAula.id],
          url: expect.stringMatching(new RegExp(`^/es/teacher/autorizaciones/${id}\\?`)),
          cuerpo: 'Una familia ha firmado una autorización de recogida',
        }),
        expect.objectContaining({
          ids: [admin.id],
          url: expect.stringMatching(new RegExp(`^/es/admin/autorizaciones/${id}\\?`)),
        }),
      ])
    const nadieMas = () => {
      const todos = h.push.flatMap((p) => p.ids)
      expect(todos).not.toContain(profeOtra.id)
      expect(todos).not.toContain(profeSinAula.id)
      expect(todos).not.toContain(tutora.id)
      expect(todos).toHaveLength(2)
    }

    it('firmar una recogida nueva avisa a la profe del aula y a Dirección', async () => {
      h.push.length = 0
      h.sesion = cTutora
      const r = await crearRecogida({
        nino_id: nino.id,
        modalidad: 'habitual',
        nombre_tecleado: NOMBRE_TUTORA,
        firma_imagen: TRAZO,
        personas: [{ nombre: 'Persona Uno', dni: '12345678Z' }],
      })
      expect(r.success, JSON.stringify(r)).toBe(true)
      if (!r.success) return
      autorizacionId = r.data.autorizacion_id
      expect(destinos()).toEqual(esperado(autorizacionId))
      nadieMas()
    })

    it('añadir una persona (volver a firmar la lista) avisa igual', async () => {
      expect(autorizacionId).toBeTruthy()
      h.push.length = 0
      h.sesion = cTutora
      const r = await firmarAutorizacion({
        autorizacion_id: autorizacionId,
        nino_id: nino.id,
        nombre_tecleado: NOMBRE_TUTORA,
        firma_imagen: TRAZO,
        personas: [
          { nombre: 'Persona Uno', dni: '12345678Z' },
          { nombre: 'Persona Dos', dni: '87654321X' },
        ],
      })
      expect(r.success, JSON.stringify(r)).toBe(true)
      expect(destinos()).toEqual(esperado(autorizacionId))
      nadieMas()
    })

    it('revocar no manda push (el aviso de dentro de la app ya cuenta las revocaciones)', async () => {
      expect(autorizacionId).toBeTruthy()
      h.push.length = 0
      h.sesion = cTutora
      const r = await revocarFirma({ autorizacion_id: autorizacionId, nino_id: nino.id })
      expect(r.success, JSON.stringify(r)).toBe(true)
      expect(h.push).toEqual([])
    })
  })
})
