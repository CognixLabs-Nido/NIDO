import { createHash, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import { borrarMandatos } from './mandatos-como-postgres'
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
 * El mandato SEPA como prueba, migración 1 (`20270203120000`; spec `docs/specs/mandato-sepa-cierre.md`,
 * decisiones del 2026-11-22), contra la base de verdad y con las funciones de la app:
 *
 *  - **El sello v3** (2 y 7): el PDF lo compone el servidor, su sha256 entra en el sello, el fichero se
 *    llama por el sello y la base lo recalcula, mira la ruta y que el fichero esté. Cada defensa, con
 *    UNA cosa mal y lo demás bien.
 *  - **Volver a firmar** (3): crea un mandato nuevo; el anterior queda revocado, con su fichero.
 *  - **Quién lo abre** (4, «sin enlace, como la 10c»): la ruta deja la lectura ANTES de servir los
 *    bytes, y los sirve con la sesión.
 *  - **El alta anulada**: el mandato se va con ella y el evento del final deja su constancia.
 *  - **El huérfano**: el barrido del cron lo cuenta y lo borra.
 *
 * Cada aserto que recorre usuarios dice QUIÉN falló.
 */

const h = vi.hoisted(() => ({ sesion: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!h.sesion) throw new Error('test: falta la sesión de quien actúa')
    return h.sesion
  },
}))

const { firmarMandatoDigital } = await import('@/features/alta/lib/mandato-v3-servidor')
const { generarMandatoPdf } = await import('@/features/alta/lib/mandato-pdf')
const { textoCanonicoMandatoV3 } = await import('@/features/alta/lib/mandato-sepa')
const { acreedorDelCentro } = await import('@/features/alta/lib/mandato-v2-servidor')
const { barrerMandatosHuerfanos } = await import('@/features/retencion/lib/mandatos-huerfanos')
const { anularAltaCore } = await import('@/features/matriculas/lib/alta-sin-terminar')
const { GET } = await import('@/app/[locale]/mandato-sepa/[mandatoId]/route')

const BUCKET = 'mandato-sepa'
const IBAN = 'ES9121000418450200051332'
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

describe('El mandato SEPA como prueba (migración 1, 2026-11-22)', () => {
  let centro: { id: string; nombre: string }
  let curso: { id: string }
  let aula: { id: string }
  let familia: string
  let nino: { id: string }
  let admin: TestUser
  let tutora: TestUser
  let otra: TestUser
  let cTutora: SupabaseClient<Database>
  const usuarios: TestUser[] = []
  const ficheros: string[] = []

  const rol = (u: TestUser) =>
    new Map<string, string>([
      [admin.id, 'Dirección'],
      [tutora.id, 'tutora de la familia'],
      [otra.id, 'tutora de otra familia'],
    ]).get(u.id) ?? `¿${u.id}?`

  /** Firma de verdad, con la función de la app y la sesión de la tutora. */
  async function firmar(via: 'registrar' | 'sustituir' = 'registrar') {
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
      via,
    })
    return r
  }

  /** Lo que mandaría el servidor para un mandato, calculado aquí: para estropear UNA cosa. */
  function v3(identificador: string, direccionAcreedor = 'Calle Falsa 123') {
    const fecha = new Date().toISOString()
    const pdf = generarMandatoPdf({
      identificadorMandato: identificador,
      iban: IBAN,
      titular: 'Titular Demo',
      titularDocumento: 'X1234567L',
      titularDireccion: 'Calle Demo 1',
      acreedorNombre: centro.nombre,
      acreedorDireccion: direccionAcreedor,
      acreedorCid: 'ES81ZZZB00000000',
      firmaDataUrl: PNG,
      fechaFirmaIso: fecha,
      idioma: 'es',
      plantillaVersion: 1,
    })
    const documentoSha256 = sha256(pdf)
    const sello = sha256(
      textoCanonicoMandatoV3({
        identificadorMandato: identificador,
        iban: IBAN,
        titular: 'Titular Demo',
        titularDocumento: 'X1234567L',
        titularDireccion: 'Calle Demo 1',
        acreedorNombre: centro.nombre,
        acreedorCid: 'ES81ZZZB00000000',
        acreedorDireccion: direccionAcreedor,
        fechaFirmaIso: fecha,
        documentoSha256,
        idioma: 'es',
        plantillaPdfVersion: 1,
      })
    )
    return {
      pdf,
      sello,
      ruta: `${centro.id}/familia/${familia}/mandato-${sello}.pdf`,
      args: {
        p_familia_id: familia,
        p_nino_id: nino.id,
        p_iban: IBAN,
        p_titular: 'Titular Demo',
        p_identificador_mandato: identificador,
        p_documento_path: `${centro.id}/familia/${familia}/mandato-${sello}.pdf`,
        p_firma_imagen: PNG,
        p_nombre_tecleado: 'Titular Demo',
        p_texto_hash: sello,
        p_ip_address: null as unknown as string,
        p_user_agent: 'vitest',
        p_fecha_firma: fecha,
        p_metodo: 'digital' as const,
        p_titular_documento: 'X1234567L',
        p_titular_direccion: 'Calle Demo 1',
        p_acreedor_cid: 'ES81ZZZB00000000',
        p_acreedor_nombre: centro.nombre,
        p_documento_sha256: documentoSha256,
        p_documento_idioma: 'es',
        p_plantilla_pdf_version: 1,
        p_acreedor_direccion: direccionAcreedor,
      },
    }
  }

  async function subir(ruta: string, bytes: Uint8Array) {
    const r = await cTutora.storage
      .from(BUCKET)
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
    if (r.error) throw new Error(`test: subir ${ruta}: ${r.error.message}`)
    ficheros.push(ruta)
  }

  async function abrir(u: TestUser, mandatoId: string, origen = 'ficha') {
    h.sesion = await clientFor(u)
    return GET(new Request(`http://x/es/mandato-sepa/${mandatoId}?origen=${origen}`), {
      params: Promise.resolve({ locale: 'es', mandatoId }),
    })
  }

  const lecturasDe = async (mandatoId: string) =>
    (
      await serviceClient
        .from('lecturas_mandato_sepa')
        .select('rol_lector, origen, lector_id')
        .eq('mandato_id', mandatoId)
    ).data ?? []

  beforeAll(async () => {
    centro = await createTestCentro('Mandato prueba')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id)
    await matricular(nino.id, aula.id, curso.id)
    // En su alta: el mandato se registra directo (con el alta validada iría a la cola).
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

    admin = await createTestUser({ nombre: 'Admin Mandato Prueba' })
    tutora = await createTestUser({ nombre: 'Tutora Mandato Prueba' })
    otra = await createTestUser({ nombre: 'Otra Mandato Prueba' })
    usuarios.push(admin, tutora, otra)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal', {})
    await crearFamiliaTutor(familia, tutora.id, 'titular')
    const ninoOtra = await createTestNino(centro.id)
    await crearFamiliaTutor(ninoOtra.familia_id, otra.id, 'titular')
    cTutora = await clientFor(tutora)
  }, 60_000)

  afterAll(async () => {
    h.sesion = null
    if (ficheros.length > 0) await serviceClient.storage.from(BUCKET).remove(ficheros)
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 60_000)

  it('premisa: quién es quién, y el centro tiene CID y dirección', async () => {
    for (const [u, esperado] of [
      [tutora, true],
      [otra, false],
    ] as const) {
      const r = await (await clientFor(u)).rpc('es_tutor_de_familia', { p_familia_id: familia })
      expect(r.data, rol(u)).toBe(esperado)
    }
    const a = await acreedorDelCentro(cTutora, centro.id)
    expect(a?.cid).toBe('ES81ZZZB00000000')
    expect(a?.direccion).toBe('Calle Falsa 123')
  })

  describe('2 y 7 · el sello v3 ata el PDF a la firma', () => {
    it('control: un mandato firmado con la app entra como v3, con el sha256 de su fichero', async () => {
      const r = await firmar()
      expect(r.error?.message ?? null).toBeNull()
      const { data: m } = await serviceClient
        .from('mandatos_sepa')
        .select('version_canonico, documento_path, documento_sha256, texto_hash')
        .eq('id', r.mandatoId!)
        .single()
      expect(m?.version_canonico).toBe(3)
      expect(m?.documento_path).toBe(`${centro.id}/familia/${familia}/mandato-${m?.texto_hash}.pdf`)
      ficheros.push(m!.documento_path!)
      const { data: blob } = await serviceClient.storage.from(BUCKET).download(m!.documento_path!)
      expect(sha256(new Uint8Array(await blob!.arrayBuffer()))).toBe(m?.documento_sha256)
    })

    it.each([
      ['sello inventado', 'sello_distinto'],
      ['ruta que no es la del sello', 'ruta_distinta'],
      ['sin el fichero en el bucket', 'sin_documento'],
      ['dirección del acreedor que no es la del centro', 'acreedor_distinto'],
    ] as const)('%s: la base lo rechaza (%s)', async (caso, hint) => {
      const d = v3(`NIDO-TEST-${randomUUID().slice(0, 8)}`)
      const args = { ...d.args }
      if (caso === 'sello inventado') {
        await subir(d.ruta, d.pdf)
        args.p_texto_hash = 'e'.repeat(64)
      } else if (caso === 'ruta que no es la del sello') {
        const otraRuta = `${centro.id}/familia/${familia}/otra-${randomUUID().slice(0, 8)}.pdf`
        await subir(otraRuta, d.pdf)
        args.p_documento_path = otraRuta
      } else if (caso === 'dirección del acreedor que no es la del centro') {
        const o = v3(args.p_identificador_mandato, 'Otra calle 9')
        await subir(o.ruta, o.pdf)
        Object.assign(args, o.args)
      }
      const r = await cTutora.rpc('registrar_mandato_sepa', args)
      expect(r.error?.hint ?? 'SIN ERROR: entró', caso).toBe(hint)
    })

    it('control: con todo bien, el mismo camino entra', async () => {
      const d = v3(`NIDO-TEST-${randomUUID().slice(0, 8)}`)
      await subir(d.ruta, d.pdf)
      const r = await cTutora.rpc('registrar_mandato_sepa', d.args)
      expect(r.error?.message ?? null).toBeNull()
    })
  })

  describe('3 · volver a firmar crea un mandato nuevo y conserva el anterior', () => {
    it('el mismo IBAN otra vez: el anterior queda revocado, con su identificador y su fichero', async () => {
      const primero = await firmar()
      expect(primero.error?.message ?? null).toBeNull()
      const segundo = await firmar()
      expect(segundo.error?.message ?? null).toBeNull()
      expect(segundo.mandatoId).not.toBe(primero.mandatoId)
      const { data: ant } = await serviceClient
        .from('mandatos_sepa')
        .select('estado, identificador_mandato, documento_path')
        .eq('id', primero.mandatoId!)
        .single()
      expect(ant?.estado).toBe('revocado')
      expect(ant?.identificador_mandato).toBe(primero.identificador)
      ficheros.push(ant!.documento_path!)
      const { error } = await serviceClient.storage.from(BUCKET).download(ant!.documento_path!)
      expect(error?.message ?? null).toBeNull()
    })
  })

  describe('4 · quién abre el PDF, sin enlace', () => {
    let mandatoId: string
    let sha: string

    beforeAll(async () => {
      const r = await firmar()
      if (r.error || !r.mandatoId) throw new Error(`test: firmar: ${r.error?.message}`)
      mandatoId = r.mandatoId
      const { data } = await serviceClient
        .from('mandatos_sepa')
        .select('documento_sha256, documento_path')
        .eq('id', mandatoId)
        .single()
      sha = data!.documento_sha256!
      ficheros.push(data!.documento_path!)
    })

    it('la tutora y Dirección lo abren, y cada una deja su lectura; la otra familia, no', async () => {
      for (const [u, rolEsperado, origen] of [
        [tutora, 'tutor', 'ficha'],
        [admin, 'admin', 'export'],
      ] as const) {
        const antes = (await lecturasDe(mandatoId)).length
        const res = await abrir(u, mandatoId, origen)
        expect(res.status, rol(u)).toBe(200)
        expect(sha256(new Uint8Array(await res.arrayBuffer())), rol(u)).toBe(sha)
        expect(res.headers.get('cache-control'), rol(u)).toContain('no-store')
        const despues = await lecturasDe(mandatoId)
        expect(despues.length, rol(u)).toBe(antes + 1)
        expect(
          despues.some(
            (l) => l.lector_id === u.id && l.rol_lector === rolEsperado && l.origen === origen
          ),
          rol(u)
        ).toBe(true)
      }
      const antes = (await lecturasDe(mandatoId)).length
      const res = await abrir(otra, mandatoId)
      expect(res.status, rol(otra)).toBe(404)
      expect((await lecturasDe(mandatoId)).length, rol(otra)).toBe(antes)
    })

    it('la lectura se apunta ANTES de servir: sin los bytes, la fila ya está', async () => {
      const r = await firmar()
      const { data } = await serviceClient
        .from('mandatos_sepa')
        .select('documento_path')
        .eq('id', r.mandatoId!)
        .single()
      await serviceClient.storage.from(BUCKET).remove([data!.documento_path!])
      const res = await abrir(tutora, r.mandatoId!)
      expect(res.status).toBe(500)
      expect((await lecturasDe(r.mandatoId!)).length).toBe(1)
    })

    it('el registro lo leen la familia y Dirección; la otra familia, no; la tabla, nadie con sesión', async () => {
      for (const u of [tutora, admin]) {
        const r = await (await clientFor(u)).rpc('lecturas_mandato_sepa', { p_familia_id: familia })
        expect(r.error?.message ?? null, rol(u)).toBeNull()
        expect((r.data ?? []).length, rol(u)).toBeGreaterThan(0)
      }
      const o = await (
        await clientFor(otra)
      ).rpc('lecturas_mandato_sepa', { p_familia_id: familia })
      expect(o.error?.code ?? 'SIN ERROR', rol(otra)).toBe('42501')
      const t = await cTutora.from('lecturas_mandato_sepa').select('id')
      expect(t.error?.code ?? 'SIN ERROR', rol(tutora)).toBe('42501')
    })
  })

  describe('el huérfano: el cron lo cuenta y lo borra', () => {
    it('un fichero que ninguna fila nombra, de hace dos días, se cuenta y se borra', async () => {
      const ruta = `${centro.id}/familia/${familia}/huerfano-${randomUUID().slice(0, 8)}.pdf`
      await subir(ruta, new TextEncoder().encode('%PDF-1.4\n%%EOF\n'))
      comoPostgres(
        `UPDATE storage.objects SET created_at = now() - interval '2 days' WHERE bucket_id = '${BUCKET}' AND name = '${ruta}';`
      )
      const { data: lista } = await serviceClient.rpc('mandatos_sepa_huerfanos')
      expect((lista ?? []).map((l) => l.ruta)).toContain(ruta)
      const r = await barrerMandatosHuerfanos({ dryRun: false })
      expect(r.huerfanos).toBeGreaterThanOrEqual(1)
      expect(r.borrados).toBeGreaterThanOrEqual(1)
      const { data: despues } = await serviceClient.rpc('mandatos_sepa_huerfanos')
      expect((despues ?? []).map((l) => l.ruta)).not.toContain(ruta)
    })

    it('uno que una fila nombra no es huérfano', async () => {
      const { data: m } = await serviceClient
        .from('mandatos_sepa')
        .select('documento_path')
        .eq('familia_id', familia)
        .not('documento_path', 'is', null)
        .limit(1)
        .single()
      comoPostgres(
        `UPDATE storage.objects SET created_at = now() - interval '2 days' WHERE bucket_id = '${BUCKET}' AND name = '${m!.documento_path}';`
      )
      const { data: lista } = await serviceClient.rpc('mandatos_sepa_huerfanos')
      expect((lista ?? []).map((l) => l.ruta)).not.toContain(m!.documento_path)
    })
  })

  describe('el alta anulada: el mandato se va, y queda constancia', () => {
    it('el evento del final dice qué mandato se destruyó, cuándo y quién anuló', async () => {
      // Un alta sin terminar de una familia nueva, con su mandato firmado (el curso activo del centro:
      // solo hay uno por centro).
      const n2 = await createTestNino(centro.id)
      // Nace 'pendiente': `matricular` la crea 'activa' y el trigger le sella `activada_at`, y una
      // matrícula que se activó alguna vez ya no es un alta sin terminar (falló así en la CI).
      const { error: errMat } = await serviceClient.from('matriculas').insert({
        nino_id: n2.id,
        aula_id: aula.id,
        curso_academico_id: curso.id,
        estado: 'pendiente',
      })
      expect(errMat?.message ?? null).toBeNull()
      const t2 = await createTestUser({ nombre: 'Tutora Anulada' })
      usuarios.push(t2)
      await asignarRol(t2.id, centro.id, 'tutor_legal')
      await crearVinculo(n2.id, t2.id, 'tutor_legal_principal', {})
      await crearFamiliaTutor(n2.familia_id, t2.id, 'titular')
      const c2 = await clientFor(t2)
      h.sesion = c2
      const acreedor = await acreedorDelCentro(c2, centro.id)
      const firmado = await firmarMandatoDigital(c2, {
        familiaId: n2.familia_id,
        centroId: centro.id,
        ninoId: n2.id,
        usuarioId: t2.id,
        acreedor: { ...acreedor!, cid: acreedor!.cid! },
        iban: IBAN,
        titular: 'Titular Anulada',
        titularDocumento: 'X1234567L',
        titularDireccion: 'Calle Demo 1',
        nombreTecleado: 'Titular Anulada',
        firmaImagen: PNG,
        idioma: 'es',
        ipAddress: null,
        userAgent: 'vitest',
        via: 'registrar',
      })
      expect(firmado.error?.message ?? null).toBeNull()
      // La premisa: la base la ve como un alta sin terminar que se borra.
      const { data: premisa } = await serviceClient.rpc('datos_anular_alta', { p_nino_id: n2.id })
      expect((premisa as { accion?: string } | null)?.accion).toBe('borrar')

      const r = await anularAltaCore(serviceClient, n2.id, admin.id)
      expect(r.resultado).toBe('borrada')
      const { data: quedan } = await serviceClient
        .from('mandatos_sepa')
        .select('id')
        .eq('id', firmado.mandatoId!)
      expect(quedan ?? []).toHaveLength(0)

      const { data: ev } = await serviceClient
        .from('audit_log')
        .select('usuario_id, ts, valores_despues')
        .eq('tabla', 'alta_sin_terminar')
        .eq('registro_id', centro.id)
        .eq('accion', 'DELETE')
        .order('ts', { ascending: false })
        .limit(1)
        .single()
      expect(ev?.usuario_id).toBe(admin.id)
      const d = ev?.valores_despues as {
        mandatos_destruidos?: { identificador_mandato: string; iban_ultimos4: string }[]
      }
      expect(d.mandatos_destruidos?.map((m) => m.identificador_mandato)).toEqual([
        firmado.identificador,
      ])
      expect(d.mandatos_destruidos?.[0].iban_ultimos4).toBe('1332')
      expect(JSON.stringify(d)).not.toContain(IBAN)
      // Nada de la familia: en audit_log no entra lo que la purga no sabe redactar.
      expect(JSON.stringify(d)).not.toContain('Titular Anulada')
    })
  })
})
