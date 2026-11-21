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
 *  - **La lista, con el mismo alcance que la foto** (2026-11-21): cualquier profe del centro abre la
 *    recogida (la lista, el DNI escrito, la foto, el nombre del niño y su estado), y solo la
 *    recogida: ni la medicación, ni el trazo o el nombre tecleado de quien firmó, ni el nombre de un
 *    niño que no tiene matrícula activa. Si alguien lo estrecha, se pone rojo.
 *
 * Cada aserto que recorre usuarios lleva el ROL de quien falla: un rojo por el usuario equivocado
 * tiene que decir cuál fue.
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
const { getAutorizacionDetalle } =
  await import('@/features/autorizaciones/queries/get-autorizacion-detalle')
const { getNombresDeRecogidas } =
  await import('@/features/autorizaciones/queries/get-nombres-recogidas')

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
  let plantillaRecogidaId: string
  /** El detalle con la sesión de `u`; si lanza, el error dice de quién era la sesión. */
  async function detalleComo(u: TestUser, id: string) {
    h.sesion = await clientFor(u)
    try {
      return await getAutorizacionDetalle(id)
    } catch (e) {
      throw new Error(`${rol(u)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  /** El rol de cada usuario, para que un rojo diga QUIÉN falló. */
  const rol = (u: TestUser) =>
    new Map<string, string>([
      [admin.id, 'Dirección'],
      [profeAula.id, 'profe del aula'],
      [profeOtra.id, 'profe de otra aula'],
      [profeSinAula.id, 'profe sin aula'],
      [tutora.id, 'tutora legal'],
      [autorizado.id, 'autorizado'],
    ]).get(u.id) ?? `¿${u.id}?`

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

    const { data: pl, error } = await serviceClient
      .from('autorizaciones')
      .insert({
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
      .select('id')
      .single()
    if (error || !pl) throw new Error(`plantilla de recogida: ${error?.message}`)
    plantillaRecogidaId = pl.id
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
    expect(await pregunta(profeAula, 'es_profe_de_nino'), rol(profeAula)).toBe(true)
    expect(await pregunta(profeOtra, 'es_profe_de_nino'), rol(profeOtra)).toBe(false)
    expect(await pregunta(profeSinAula, 'es_profe_de_nino'), rol(profeSinAula)).toBe(false)
    expect(await pregunta(tutora, 'es_tutor_legal_de'), rol(tutora)).toBe(true)
    expect(await pregunta(autorizado, 'es_tutor_legal_de'), rol(autorizado)).toBe(false)
    for (const u of [profeOtra, profeSinAula]) {
      const enCentro = await (
        await clientFor(u)
      ).rpc('es_profe_en_centro', { p_centro_id: centro.id })
      expect(enCentro.data, rol(u)).toBe(true)
    }
  })

  it('sube solo quien puede firmar la recogida: ni las profes, ni Dirección, ni el autorizado sin permiso', async () => {
    // Control positivo: la tutora, el camino de la app.
    expect((await subir(tutora, ruta())).error, rol(tutora)).toBeNull()

    for (const u of [profeAula, profeOtra, profeSinAula, admin, autorizado]) {
      const r = await subir(u, ruta())
      expect(r.error?.message ?? 'SIN ERROR: subió', rol(u)).toMatch(/row-level security/i)
    }

    // El mismo autorizado, con el permiso de firmar autorizaciones, sí sube.
    expect((await permisoAutorizado({ puede_firmar_autorizaciones: true })).error).toBeNull()
    try {
      expect((await subir(autorizado, ruta())).error, 'autorizado con permiso').toBeNull()
    } finally {
      expect((await permisoAutorizado({})).error).toBeNull()
    }
  })

  it('cualquier profe del centro VE la foto, a propósito (Jose, 2026-11-20); el autorizado, no', async () => {
    const foto = ruta()
    expect((await subir(tutora, foto)).error, rol(tutora)).toBeNull()
    for (const u of [profeAula, profeOtra, profeSinAula, admin]) {
      const r = await (await clientFor(u)).storage.from(BUCKET).createSignedUrl(foto, 60)
      expect(r.error?.message ?? null, rol(u)).toBeNull()
      expect(r.data?.signedUrl, rol(u)).toBeTruthy()
    }
    const ajeno = await (await clientFor(autorizado)).storage.from(BUCKET).createSignedUrl(foto, 60)
    expect(ajeno.error?.message ?? 'SIN ERROR: la vio', rol(autorizado)).not.toBe(
      'SIN ERROR: la vio'
    )
  })

  describe('el aviso al móvil y la lista, sobre la misma recogida', () => {
    let autorizacionId: string
    let fotoDni: string

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
      for (const u of [profeOtra, profeSinAula, tutora])
        expect(todos.includes(u.id), `avisado y no debía: ${rol(u)}`).toBe(false)
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

    it('añadir una persona (volver a firmar la lista, con la foto de su DNI) avisa igual', async () => {
      expect(autorizacionId).toBeTruthy()
      fotoDni = ruta()
      expect((await subir(tutora, fotoDni)).error, rol(tutora)).toBeNull()
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
        adjuntos: [
          {
            bucket: BUCKET,
            path: fotoDni,
            hash: 'a'.repeat(64),
            metadata: { tipo: 'dni_recogida', dni: '87654321X' },
          },
        ],
      })
      expect(r.success, JSON.stringify(r)).toBe(true)
      expect(destinos()).toEqual(esperado(autorizacionId))
      nadieMas()
    })

    // --- La lista, con el mismo alcance que la foto (Jose, 2026-11-21) ----------------------------

    it('cualquier profe del centro abre la recogida: la lista, el DNI, la foto, el niño y el estado', async () => {
      expect(autorizacionId).toBeTruthy()
      const { data: nn } = await serviceClient
        .from('ninos')
        .select('nombre')
        .eq('id', nino.id)
        .single()
      for (const u of [profeAula, profeOtra, profeSinAula, admin]) {
        const d = await detalleComo(u, autorizacionId)
        expect(d?.id ?? 'NO LA VE', rol(u)).toBe(autorizacionId)
        expect(d?.estado_firma_nino, rol(u)).toBe('firmado')
        expect(
          (d?.personas_vigentes ?? []).map((p) => `${p.nombre}|${p.dni}`),
          rol(u)
        ).toEqual(['Persona Uno|12345678Z', 'Persona Dos|87654321X'])
        expect(d?.adjuntos_recogida?.[0]?.dni, rol(u)).toBe('87654321X')
        expect(d?.adjuntos_recogida?.[0]?.url ?? 'SIN URL', rol(u)).toMatch(/^https?:\/\//)
        // El nombre del niño: la del aula y Dirección lo tienen por el roster; las demás, por
        // `nombres_de_recogidas`. Se mira lo que llega a la pantalla, venga de donde venga.
        const nombre =
          d?.nino_recogida?.nombre ?? d?.roster.find((r) => r.nino_id === nino.id)?.nino_nombre
        expect(nombre ?? 'SIN NOMBRE', rol(u)).toContain(nn?.nombre ?? '¿niño?')
      }
    })

    it('el listado de la puerta: el nombre de cada recogida, la suya primero', async () => {
      for (const [u, suya] of [
        [profeAula, true],
        [profeOtra, false],
        [profeSinAula, false],
        [admin, false],
      ] as const) {
        const c = await clientFor(u)
        const { data: lista, error } = await c
          .from('autorizaciones')
          .select('id')
          .eq('tipo', 'recogida')
          .eq('es_plantilla', false)
        expect(error?.message ?? null, rol(u)).toBeNull()
        expect(
          (lista ?? []).map((a) => a.id),
          rol(u)
        ).toContain(autorizacionId)
        h.sesion = c
        const nombres = await getNombresDeRecogidas([autorizacionId]).catch((e: unknown) => {
          throw new Error(`${rol(u)}: ${e instanceof Error ? e.message : String(e)}`)
        })
        expect(nombres.get(autorizacionId)?.nombre ?? 'SIN NOMBRE', rol(u)).toMatch(/^NinoTest-/)
        expect(nombres.get(autorizacionId)?.deMiAula, rol(u)).toBe(suya)
      }
    })

    it('de la firma, a la profe de otra aula le llega la lista y no el trazo ni quién tecleó', async () => {
      const { data: fs } = await serviceClient
        .from('firmas_autorizacion')
        .select('id')
        .eq('autorizacion_id', autorizacionId)
      const ids = (fs ?? []).map((f) => f.id)
      expect(ids.length).toBeGreaterThan(0)
      // Control positivo: la del aula lo recibe todo.
      const aula = await (await clientFor(profeAula)).rpc('contenido_firmas', { p_firma_ids: ids })
      expect(aula.data?.length, rol(profeAula)).toBe(ids.length)
      expect(
        aula.data?.every((f) => f.nombre_tecleado === NOMBRE_TUTORA && f.firma_imagen === TRAZO),
        rol(profeAula)
      ).toBe(true)
      for (const u of [profeOtra, profeSinAula]) {
        const r = await (await clientFor(u)).rpc('contenido_firmas', { p_firma_ids: ids })
        expect(r.error?.message ?? null, rol(u)).toBeNull()
        expect(r.data?.length, rol(u)).toBe(ids.length)
        for (const f of r.data ?? []) {
          expect(f.datos, rol(u)).not.toBeNull()
          expect(
            [f.nombre_tecleado, f.firma_imagen, f.ip_address, f.user_agent, f.comentario],
            rol(u)
          ).toEqual([null, null, null, null, null])
        }
      }
    })

    it('solo la recogida: ni la medicación, ni el nombre de un niño sin matrícula activa, ni al autorizado', async () => {
      const { data: plMed, error: e1 } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'medicacion',
          es_plantilla: true,
          titulo: 'Medicación',
          texto: 'Autorizo a administrar la medicación indicada.',
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        })
        .select('id')
        .single()
      expect(e1?.message ?? null).toBeNull()
      const { data: med, error: e2 } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'medicacion',
          nino_id: nino.id,
          plantilla_id: plMed!.id,
          ambito: 'nino',
          titulo: 'Medicación',
          texto: 'Autorizo a administrar la medicación indicada.',
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        })
        .select('id')
        .single()
      expect(e2?.message ?? null).toBeNull()

      const sinMatricula = await createTestNino(centro.id)
      const { data: recSin, error: e3 } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          nino_id: sinMatricula.id,
          plantilla_id: plantillaRecogidaId,
          ambito: 'nino',
          titulo: 'Recogida',
          texto: 'Autorizo a las personas indicadas a recoger a mi hijo o hija.',
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        })
        .select('id')
        .single()
      expect(e3?.message ?? null).toBeNull()
      const ids = [autorizacionId, med!.id, recSin!.id]

      // Control positivo: la medicación la ve la profe del aula.
      const medAula = await (await clientFor(profeAula))
        .from('autorizaciones')
        .select('id')
        .eq('id', med!.id)
      expect(medAula.data?.length, rol(profeAula)).toBe(1)

      for (const u of [profeOtra, profeSinAula]) {
        const c = await clientFor(u)
        const medOtra = await c.from('autorizaciones').select('id').eq('id', med!.id)
        expect(medOtra.data?.length, `${rol(u)} ve la medicación`).toBe(0)
        // En la misma llamada, la recogida del niño matriculado sí sale (control positivo).
        const r = await c.rpc('nombres_de_recogidas', { p_autorizacion_ids: ids })
        expect(r.error?.message ?? null, rol(u)).toBeNull()
        expect(
          (r.data ?? []).map((n) => n.autorizacion_id),
          rol(u)
        ).toEqual([autorizacionId])
      }

      const aut = await (
        await clientFor(autorizado)
      ).rpc('nombres_de_recogidas', {
        p_autorizacion_ids: ids,
      })
      expect(aut.data ?? [], rol(autorizado)).toEqual([])
    })

    it('revocar no manda push (el aviso de dentro de la app ya cuenta las revocaciones)', async () => {
      expect(autorizacionId).toBeTruthy()
      h.push.length = 0
      h.sesion = cTutora
      const r = await revocarFirma({ autorizacion_id: autorizacionId, nino_id: nino.id })
      expect(r.success, JSON.stringify(r)).toBe(true)
      expect(h.push).toEqual([])
    })

    it('revocada, la profe de otra aula la ve REVOCADA y sin lista (no «sin firmar», no vigente)', async () => {
      for (const u of [profeAula, profeOtra, profeSinAula]) {
        const d = await detalleComo(u, autorizacionId)
        expect(d?.estado_firma_nino ?? 'NO LA VE', rol(u)).toBe('revocado')
        expect(d?.personas_vigentes, rol(u)).toEqual([])
      }
    })
  })
})
