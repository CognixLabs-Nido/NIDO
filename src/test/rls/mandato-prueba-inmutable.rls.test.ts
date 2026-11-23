import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import {
  actualizarMandato,
  borrarMandatos,
  borrarMandatoSinMarcador,
} from './mandatos-como-postgres'
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
 * El mandato SEPA como prueba, migración 2 (`20270204120000`; spec `docs/specs/mandato-sepa-cierre.md`,
 * «La migración 2»), contra la base de verdad. Una defensa por bloque, y cada una con su control:
 *
 *  - **El bucket**: ni Dirección ni la tutora actualizan, mueven ni borran el PDF con su sesión, y
 *    nadie sube por la ruta del niño. La sesión no llega al trigger: la para la RLS.
 *  - **El PDF no cambia**: tampoco `service_role` lo sobrescribe ni lo mueve. Sí borra un huérfano.
 *  - **La fila**: solo cambia el estado, por sus transiciones, y `nino_id` a NULL. Borrar, solo con el
 *    marcador de los borrados sin copia.
 *  - **El digital es v3**: un mandato digital v2 no entra, por ninguna función; el presencial v2, sí.
 *
 * El orden importa: los bloques que cambian el estado del mandato van al final.
 */

const h = vi.hoisted(() => ({ sesion: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!h.sesion) throw new Error('test: falta la sesión de quien actúa')
    return h.sesion
  },
}))

const { firmarMandatoDigital } = await import('@/features/alta/lib/mandato-v3-servidor')
const { acreedorDelCentro } = await import('@/features/alta/lib/mandato-v2-servidor')

const BUCKET = 'mandato-sepa'
const IBAN = 'ES9121000418450200051332'
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const OTROS_BYTES = new TextEncoder().encode('%PDF-1.4 otro fichero')
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('El mandato SEPA como prueba (migración 2, 2026-11-22)', () => {
  let centro: { id: string; nombre: string }
  let familia: string
  let nino: { id: string }
  let admin: TestUser
  let tutora: TestUser
  let cTutora: SupabaseClient<Database>
  let mandatoId: string
  let ruta: string
  let shaOriginal: string
  const usuarios: TestUser[] = []
  const ficheros: string[] = []

  const rol = (u: TestUser) =>
    new Map<string, string>([
      [admin.id, 'Dirección'],
      [tutora.id, 'tutora de la familia'],
    ]).get(u.id) ?? `¿${u.id}?`

  /** Los bytes que hay hoy en la ruta, leídos con el servicio. */
  async function shaEn(r: string): Promise<string | null> {
    const { data } = await serviceClient.storage.from(BUCKET).download(r)
    return data ? sha256(new Uint8Array(await data.arrayBuffer())) : null
  }

  /** Los argumentos de un mandato v2 (sin el PDF del servidor), digital o presencial. */
  function v2(metodo: 'digital' | 'presencial', identificador: string) {
    return {
      p_familia_id: familia,
      p_nino_id: null as unknown as string,
      p_iban: IBAN,
      p_titular: 'Titular Demo',
      p_identificador_mandato: identificador,
      p_documento_path:
        metodo === 'digital'
          ? `${centro.id}/familia/${familia}/mandato-v2.pdf`
          : (null as unknown as string),
      p_firma_imagen: metodo === 'digital' ? PNG : '',
      p_nombre_tecleado: 'Titular Demo',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null as unknown as string,
      p_user_agent: null as unknown as string,
      p_fecha_firma: new Date().toISOString(),
      p_metodo: metodo,
      p_titular_documento: 'X1234567L',
      p_titular_direccion: 'Calle Demo 1',
      p_acreedor_cid: 'ES81ZZZB00000000',
      p_acreedor_nombre: centro.nombre,
    }
  }

  beforeAll(async () => {
    centro = await createTestCentro('Mandato inmutable')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id)
    await matricular(nino.id, aula.id, curso.id)
    // En su alta: el mandato se registra directo, y la política de actualizar del tutor valía.
    const pend = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', nino.id)
    if (pend.error) throw new Error(`en alta: ${pend.error.message}`)
    const { data: n } = await serviceClient
      .from('ninos')
      .select('familia_id')
      .eq('id', nino.id)
      .single()
    familia = n!.familia_id

    admin = await createTestUser({ nombre: 'Admin Mandato Inmutable' })
    tutora = await createTestUser({ nombre: 'Tutora Mandato Inmutable' })
    usuarios.push(admin, tutora)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal', {})
    await crearFamiliaTutor(familia, tutora.id, 'titular')
    cTutora = await clientFor(tutora)

    // El mandato de verdad: con la función de la app y la sesión de la tutora.
    h.sesion = cTutora
    const acreedor = await acreedorDelCentro(cTutora, centro.id)
    if (!acreedor?.cid) throw new Error('test: el centro de prueba no tiene CID')
    const r = await firmarMandatoDigital(cTutora, {
      familiaId: familia,
      centroId: centro.id,
      ninoId: nino.id,
      usuarioId: tutora.id,
      acreedor: { ...acreedor, cid: acreedor.cid },
      iban: IBAN,
      titular: 'Titular Demo',
      titularDocumento: 'X1234567L',
      titularDireccion: 'Calle Demo 1',
      nombreTecleado: 'Titular Demo',
      firmaImagen: PNG,
      idioma: 'es',
      ipAddress: null,
      userAgent: 'vitest',
      via: 'registrar',
    })
    if (r.error || !r.mandatoId) throw new Error(`test: firmar: ${r.error?.message}`)
    mandatoId = r.mandatoId
    const { data: m } = await serviceClient
      .from('mandatos_sepa')
      .select('documento_path')
      .eq('id', mandatoId)
      .single()
    ruta = m!.documento_path!
    ficheros.push(ruta)
    shaOriginal = (await shaEn(ruta))!
  }, 60_000)

  afterAll(async () => {
    h.sesion = null
    if (ficheros.length > 0) await serviceClient.storage.from(BUCKET).remove(ficheros)
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 60_000)

  it('premisa: el mandato es v3 y activo, su PDF está, y quién es quién', async () => {
    const { data: m } = await serviceClient
      .from('mandatos_sepa')
      .select('version_canonico, estado, metodo_firma')
      .eq('id', mandatoId)
      .single()
    expect(m).toEqual({ version_canonico: 3, estado: 'activo', metodo_firma: 'digital' })
    expect(shaOriginal).toMatch(/^[0-9a-f]{64}$/)
    const ca = await clientFor(admin)
    expect((await ca.rpc('es_admin', { p_centro_id: centro.id })).data).toBe(true)
    expect((await cTutora.rpc('es_tutor_legal_de', { p_nino_id: nino.id })).data).toBe(true)
    // La familia está en su alta: antes de la migración 2 la tutora podía actualizar el PDF.
    expect((await cTutora.rpc('es_tutor_de_familia', { p_familia_id: familia })).data).toBe(true)
  })

  describe('1 · el bucket: la sesión ni lo cambia ni lo borra', () => {
    it('Dirección y la tutora no sobrescriben ni mueven el PDF', async () => {
      for (const u of [admin, tutora]) {
        const c = await clientFor(u)
        const up = await c.storage
          .from(BUCKET)
          .update(ruta, OTROS_BYTES, { contentType: 'application/pdf', upsert: true })
        // La sesión no llega al trigger: la para la RLS (sin política de actualizar). Con la política
        // puesta, el error sería el del trigger, y este aserto lo distingue.
        expect(up.error?.message ?? 'SIN ERROR: sobrescribió', `${rol(u)} sobrescribe`).toMatch(
          /row-level security|not found/i
        )
        const mv = await c.storage.from(BUCKET).move(ruta, `${centro.id}/familia/${familia}/x.pdf`)
        expect(mv.error?.message ?? 'SIN ERROR: movió', `${rol(u)} mueve`).toMatch(
          /row-level security|not found/i
        )
      }
      expect(await shaEn(ruta)).toBe(shaOriginal)
    })

    it('Dirección y la tutora no lo borran: sin política, la RLS no les deja ver la fila (sin error)', async () => {
      for (const u of [admin, tutora]) {
        const c = await clientFor(u)
        const r = await c.storage.from(BUCKET).remove([ruta])
        expect(r.error?.message ?? null, `${rol(u)} borra`).toBeNull()
        expect(r.data ?? [], `${rol(u)} borra`).toEqual([])
      }
      expect(await shaEn(ruta)).toBe(shaOriginal)
    })

    it('la tutora no sube por la ruta del niño; por la de la familia, sí', async () => {
      const delNino = `${centro.id}/${nino.id}/mandato-ruta-nino.pdf`
      const r = await cTutora.storage
        .from(BUCKET)
        .upload(delNino, OTROS_BYTES, { contentType: 'application/pdf', upsert: false })
      if (!r.error) ficheros.push(delNino)
      expect(r.error, 'por la ruta del niño').not.toBeNull()

      const deFamilia = `${centro.id}/familia/${familia}/mandato-control.pdf`
      const ok = await cTutora.storage
        .from(BUCKET)
        .upload(deFamilia, OTROS_BYTES, { contentType: 'application/pdf', upsert: false })
      if (!ok.error) ficheros.push(deFamilia)
      expect(ok.error?.message ?? null, 'por la ruta de la familia').toBeNull()
    })
  })

  describe('2 · el PDF no cambia, tampoco para service_role', () => {
    it('service_role no lo sobrescribe ni lo mueve', async () => {
      const up = await serviceClient.storage
        .from(BUCKET)
        .update(ruta, OTROS_BYTES, { contentType: 'application/pdf', upsert: true })
      expect(up.error, 'sobrescribe').not.toBeNull()
      const destino = `${centro.id}/familia/${familia}/movido.pdf`
      const mv = await serviceClient.storage.from(BUCKET).move(ruta, destino)
      if (!mv.error) ficheros.push(destino)
      expect(mv.error, 'mueve').not.toBeNull()
      expect(await shaEn(ruta)).toBe(shaOriginal)
    })

    it('control: service_role borra un huérfano (el barrido del cron)', async () => {
      const huerfano = `${centro.id}/familia/${familia}/huerfano.pdf`
      const sube = await serviceClient.storage
        .from(BUCKET)
        .upload(huerfano, OTROS_BYTES, { contentType: 'application/pdf', upsert: false })
      expect(sube.error?.message ?? null).toBeNull()
      const r = await serviceClient.storage.from(BUCKET).remove([huerfano])
      expect(r.error?.message ?? null).toBeNull()
      expect(await shaEn(huerfano)).toBeNull()
    })
  })

  describe('3 · de la fila solo cambia el estado', () => {
    it('el sello, el fichero y el titular no cambian', () => {
      for (const cambio of [
        { texto_hash: 'f'.repeat(64) },
        { documento_sha256: '0'.repeat(64) },
        { titular: 'Otro Titular' },
      ]) {
        const r = actualizarMandato(mandatoId, cambio)
        expect(r.error?.message ?? 'SIN ERROR: cambió', JSON.stringify(cambio)).toMatch(
          /una firma no cambia/
        )
      }
    })

    it('el estado, solo por sus transiciones', () => {
      for (const estado of ['propuesto', 'rechazado']) {
        const r = actualizarMandato(mandatoId, { estado })
        expect(r.error?.message ?? 'SIN ERROR: cambió', `activo → ${estado}`).toMatch(
          /no pasa de activo a/
        )
      }
    })

    it('nino_id solo pasa a NULL (lo hace anular_alta)', async () => {
      const otro = await createTestNino(centro.id)
      const a = actualizarMandato(mandatoId, { nino_id: otro.id })
      expect(a.error?.message ?? 'SIN ERROR: cambió', 'a otro niño').toMatch(/una firma no cambia/)
      const b = actualizarMandato(mandatoId, { nino_id: null })
      expect(b.error, 'a NULL').toBeNull()
    })

    it('borrarlo sin el marcador de los borrados sin copia, no', () => {
      const r = borrarMandatoSinMarcador(mandatoId)
      expect(r.error?.message ?? 'SIN ERROR: borrado').toMatch(/solo se borra con la anulación/)
    })
  })

  describe('4 · un mandato digital nuevo es v3', () => {
    it('la tutora no registra ni sustituye uno digital v2; Dirección registra uno presencial v2', async () => {
      for (const fn of ['registrar_mandato_sepa', 'sustituir_mandato_sepa'] as const) {
        const r = await cTutora.rpc(fn, v2('digital', `NIDO-INMUTABLE-${fn.slice(0, 4)}`))
        expect(r.error?.hint ?? 'SIN ERROR: entró', fn).toBe('digital_v3')
      }
      const ca = await clientFor(admin)
      const p = await ca.rpc('sustituir_mandato_sepa', v2('presencial', 'NIDO-INMUTABLE-PRES'))
      expect(p.error?.message ?? null, 'presencial').toBeNull()
      const { data: m } = await serviceClient
        .from('mandatos_sepa')
        .select('version_canonico, estado')
        .eq('identificador_mandato', 'NIDO-INMUTABLE-PRES')
        .single()
      expect(m).toEqual({ version_canonico: 2, estado: 'activo' })
    })

    it('control: el anterior quedó revocado (activo → revocado vale) y su PDF sigue igual', async () => {
      const { data: m } = await serviceClient
        .from('mandatos_sepa')
        .select('estado')
        .eq('id', mandatoId)
        .single()
      expect(m?.estado).toBe('revocado')
      expect(await shaEn(ruta)).toBe(shaOriginal)
    })
  })
})
